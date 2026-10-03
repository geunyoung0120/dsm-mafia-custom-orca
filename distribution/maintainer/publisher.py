"""One scheduled publication tick; only the maintainer installs this program."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import time
from source_merge import REPOSITORY, REMOTE, command, digest, git, merge_verified_delta, snapshot
from validate_source import repair_and_validate


def read(path, default=None):
    return json.loads(Path(path).read_text()) if Path(path).exists() else default


def write(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.new')
    with temporary.open('w') as stream:
        json.dump(value, stream, indent=2); stream.flush(); os.fsync(stream.fileno())
    temporary.replace(path)


def event_id(event):
    return hashlib.sha256((event['commit'] + ':' + event['patchHash']).encode()).hexdigest()


def gh(config, *args):
    output, _ = command([config['gh'], *args], timeout=180)
    return json.loads(output) if output.strip() else None


def check_identity(config):
    info = gh(config, 'api', 'repos/' + REPOSITORY)
    if info['id'] != config['repositoryId'] or info['full_name'] != REPOSITORY:
        raise ValueError('Public repository identity changed')


def valid_event(config, event):
    if not re.fullmatch('[0-9a-f]{40}', event.get('commit', '')): raise ValueError('Invalid upstream commit')
    if not re.fullmatch('[0-9a-f]{64}', event.get('patchHash', '')): raise ValueError('Invalid patch hash')
    if not re.fullmatch(r'\d+\.\d+\.\d+', event.get('version', '')): raise ValueError('Invalid upstream version')
    job = Path(event['job']).resolve()
    if not job.is_relative_to(Path(config['personalHome']).resolve() / 'jobs'):
        raise ValueError('Source job is outside the personal updater')
    if digest(job / 'feature.patch') != event['patchHash']: raise ValueError('Queued patch changed')
    if git(job / 'source', 'rev-parse', 'HEAD') != event['commit']: raise ValueError('Queued source commit changed')
    return job


def import_snapshot(config, repo, event):
    job = valid_event(config, event)
    git(repo, 'fetch', '--no-tags', str(job / 'source'), event['commit'])
    commit = snapshot(repo, event['commit'], job / 'feature.patch', event['patchHash'])
    git(repo, 'update-ref', 'refs/orca-verified/' + event_id(event), commit)
    return commit


def bootstrap(config, home, event):
    home = Path(home); repo = home / 'checkout'
    if (home / 'baseline.json').exists(): raise ValueError('Publisher baseline already exists')
    check_identity(config)
    if repo.exists(): raise ValueError('Refusing to initialize over an existing checkout')
    command(['git', 'clone', '--no-checkout', REMOTE, repo], timeout=600)
    write(home / 'checkout-owner.json', {'path': str(repo.resolve()), 'repository': REMOTE})
    git(repo, 'config', 'user.name', 'Orca Custom Publisher')
    git(repo, 'config', 'user.email', 'orca-custom-publisher@users.noreply.github.com')
    git(repo, 'config', 'core.hooksPath', str(repo / '.git/no-hooks'))
    git(repo, 'fetch', 'origin', 'main')
    public = git(repo, 'rev-parse', 'origin/main')
    metadata = json.loads(git(repo, 'show', public + ':distribution/release.json'))
    if metadata['upstreamCommit'] != event['commit'] or metadata['upstreamVersion'] != event['version']:
        raise ValueError('Initial verified source does not match the public upstream baseline')
    release_record = {'publicHead': public}
    if not confirmed_release(config, home, release_record):
        raise ValueError('Initial public source has no successful published release')
    verified = import_snapshot(config, repo, event)
    git(repo, 'checkout', '-B', 'publication', public)
    write(home / 'baseline.json', {'snapshot': verified, 'eventId': event_id(event),
                                 'commit': event['commit'], 'patchHash': event['patchHash'], 'publicHead': public})


def confirmed_release(config, home, record):
    runs = gh(config, 'run', 'list', '--repo', REPOSITORY, '--workflow', 'custom-release.yml',
              '--commit', record['publicHead'], '--limit', '10', '--json', 'databaseId,number,status,conclusion,url')
    if not runs: return False
    run = runs[0]; record['runUrl'] = run['url']; record['runId'] = run['databaseId']
    if run['status'] != 'completed': return False
    if run['conclusion'] != 'success': raise ValueError('Native release checks failed: ' + run['url'])
    tag = 'v1.0.' + str(run['number'])
    release = gh(config, 'api', 'repos/' + REPOSITORY + '/releases/tags/' + tag)
    ref = gh(config, 'api', 'repos/' + REPOSITORY + '/git/ref/tags/' + tag)
    if ref['object']['sha'] != record['publicHead'] or release['draft'] or release['prerelease']:
        raise ValueError('Release does not match the verified source commit')
    names = {a['name'] for a in release['assets']}
    expected = {f'Orca-Custom-{tag[1:]}-{p}.zip' for p in ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64']}
    if names != expected | {'release.json', 'SHA256SUMS.txt'}: raise ValueError('Published release is incomplete')
    record.update(release=tag, releaseUrl=release['html_url'])
    return True


def process_event(config, home, event, record):
    home = Path(home); repo = home / 'checkout'; identity = event_id(event)
    record_path = home / 'records' / (identity + '.json')
    owner = read(home / 'checkout-owner.json', {})
    if repo.is_symlink() or owner != {'path': str(repo.resolve()), 'repository': REMOTE}:
        raise ValueError('Checkout ownership verification failed')
    valid_event(config, event)
    baseline = read(home / 'baseline.json')
    if baseline['eventId'] == identity:
        record.update(status='already_published', publicHead=baseline['publicHead']); return
    check_identity(config)
    if git(repo, 'remote', 'get-url', 'origin') != REMOTE: raise ValueError('Publisher remote changed')
    git(repo, 'fetch', 'origin', 'main')
    if record.get('status') not in ('push_pending', 'pushed'):
        current = import_snapshot(config, repo, event)
        public = git(repo, 'rev-parse', 'origin/main')
        existing = json.loads(git(repo, 'show', public + ':distribution/release.json'))
        if tuple(map(int, existing['upstreamVersion'].split('.'))) > tuple(map(int, event['version'].split('.'))):
            record.update(status='superseded'); return
        if existing.get('personalPatchHash') == event['patchHash'] and existing['upstreamCommit'] == event['commit']:
            record.update(status='pushed', publicHead=public, snapshot=current)
        else:
            conflicts = merge_verified_delta(repo, baseline['snapshot'], current, public)
            metadata_path = repo / 'distribution/release.json'
            metadata = read(metadata_path)
            metadata.update(upstreamCommit=event['commit'], upstreamVersion=event['version'], personalPatchHash=event['patchHash'])
            write(metadata_path, metadata)
            record.update(status='validating', snapshot=current, baseHead=public)
            write(record_path, record)
            repair_and_validate(config, repo, home / 'logs' / identity, conflicts)
            git(repo, 'add', '--all')
            git(repo, 'commit', '-m', 'chore(upstream): sync verified Orca ' + event['version'])
            record.update(status='push_pending', publicHead=git(repo, 'rev-parse', 'HEAD'))
            write(record_path, record)
    if record['status'] == 'push_pending':
        _, ancestor_exit = command(['git', 'merge-base', '--is-ancestor', record['publicHead'], 'origin/main'], cwd=repo, check=False)
        if ancestor_exit:
            if git(repo, 'rev-parse', 'origin/main') != record['baseHead']:
                record.update(status='queued')
                write(record_path, record)
                return
            git(repo, 'push', 'origin', record['publicHead'] + ':refs/heads/main')
        record['status'] = 'pushed'; write(record_path, record)
    if record['status'] == 'pushed' and confirmed_release(config, home, record):
        write(home / 'baseline.json', {'snapshot': record['snapshot'], 'eventId': identity,
                                     'commit': event['commit'], 'patchHash': event['patchHash'], 'publicHead': record['publicHead']})
        record['status'] = 'published'


def tick(config, home):
    home = Path(home)
    for path in sorted((home / 'queue').glob('*.json'), key=lambda p: p.stat().st_mtime_ns):
        try:
            event = read(path); identity = event_id(event)
            if path.stem != identity: raise ValueError('Queue filename does not match its event')
        except (ValueError, KeyError, TypeError) as error:
            result = {'status': 'blocked', 'error': str(error), 'queueFile': str(path)}
            write(home / 'status.json', result); return result
        record_path = home / 'records' / (identity + '.json')
        record = read(record_path, {'status': 'queued', 'eventId': identity, 'version': event['version']})
        if record['status'] in ('published', 'already_published', 'superseded'): continue
        if record['status'] == 'blocked' or record.get('retryAt', 0) > time.time(): return record
        try:
            process_event(config, home, event, record)
            record.pop('error', None); record.pop('retryAt', None)
        except ValueError as error:
            record.update(status='blocked', error=str(error))
        except Exception as error:
            # Preserve push_pending across ambiguous network failures: never push a second commit.
            if record['status'] == 'validating':
                record.update(status='blocked', error=str(error))
            else: record.update(error=str(error), retryAt=time.time() + 300)
        record['updatedAt'] = datetime.now(timezone.utc).isoformat()
        write(record_path, record); write(home / 'status.json', record)
        return record
    return {'status': 'idle'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--home', required=True, type=Path)
    parser.add_argument('command', choices=['tick', 'status', 'retry'])
    args = parser.parse_args(); home = args.home.resolve()
    if args.command == 'status': print(json.dumps(read(home / 'status.json', {'status': 'idle'}))); return
    import fcntl
    with (home / 'publisher.lock').open('a') as lock:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: return
        if args.command == 'retry':
            for path in (home / 'records').glob('*.json'):
                record = read(path)
                if record['status'] == 'blocked':
                    if record.get('runId') and record.get('publicHead'):
                        config = read(home / 'config.json')
                        command([config['gh'], 'run', 'rerun', str(record['runId']), '--failed', '--repo', REPOSITORY])
                        record.update(status='pushed')
                    else: record.update(status='queued')
                    record.pop('retryAt', None); write(path, record)
                    break
        print(json.dumps(tick(read(home / 'config.json'), home), ensure_ascii=False))


if __name__ == '__main__': main()
