"""Enroll a maintainer Mac; never invoked by consumer installers."""
import argparse
import fcntl
import os
from pathlib import Path
import plistlib
import shutil
import sys
from publisher import bootstrap, read, write
from source_merge import command, digest

LABEL = 'local.orca.custom-publisher'
FILES = ('publisher.py', 'source_merge.py', 'validate_source.py')


def install(personal, home, gh):
    personal, home = Path(personal).resolve(), Path(home).expanduser().absolute()
    if home.is_symlink() or (home / 'config.json').exists():
        raise ValueError('Refusing to overwrite an enrolled publisher')
    if 'enqueue_publication(config, pending)' not in (personal / 'updater.py').read_text():
        raise ValueError('Install the personal updater publication hook before enrollment')
    settings = read(personal / 'config.json')
    event = read(personal / 'pending.json')
    if not event:
        raise ValueError('Enrollment needs a reviewed, verified personal pending source matching the current public release')
    job = Path(event['job'])
    if digest(job / 'feature.patch') != event['patchHash']:
        raise ValueError('Pending feature patch changed')
    if digest(Path(event['candidate']) / 'Contents/Resources/app.asar') != event['candidateHash']:
        raise ValueError('Pending candidate changed')
    home.mkdir(parents=True, mode=0o700)
    os.chmod(home, 0o700)
    for name in ('queue', 'records', 'logs'):
        (home / name).mkdir(exist_ok=True)
    config = {k: settings[k] for k in ('node', 'pnpm', 'codex', 'model', 'maxAgentAttempts', 'agentTimeoutSeconds')}
    config.update(personalHome=str(personal), python=sys.executable, gh=str(Path(gh).absolute()),
                  toolingBin=str(personal / 'tooling/bin'), repositoryId=1401946642)
    bootstrap(config, home, event)
    for name in FILES: shutil.copy2(Path(__file__).parent / name, home / name)
    write(home / 'code-manifest.json', {name: digest(home / name) for name in FILES})
    write(home / 'config.json', config)
    write(home / 'status.json', {'status': 'idle', 'baselineVersion': event['version'], 'baselineEvent': read(home / 'baseline.json')['eventId']})
    # Installer hooks are updated separately; opt-in only after a valid baseline exists.
    with (personal / 'updater.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        settings = read(personal / 'config.json'); settings['publisherHome'] = str(home)
        write(personal / 'config.json', settings)
    path = os.pathsep.join([config['toolingBin'], str(Path(config['node']).parent),
                            str(Path(config['gh']).parent), '/usr/bin', '/bin', '/usr/sbin', '/sbin'])
    schedule = {'Label': LABEL, 'ProgramArguments': [sys.executable, str(home / 'publisher.py'), '--home', str(home), 'tick'],
                'WorkingDirectory': str(home), 'RunAtLoad': True, 'StartInterval': 60,
                'ProcessType': 'Background', 'Nice': 10, 'LowPriorityIO': True,
                'EnvironmentVariables': {'PATH': path, 'GIT_TERMINAL_PROMPT': '0', 'GH_PROMPT_DISABLED': '1'},
                'StandardOutPath': str(home / 'logs/scheduler.log'), 'StandardErrorPath': str(home / 'logs/scheduler-error.log')}
    target = Path.home() / 'Library/LaunchAgents' / (LABEL + '.plist')
    if target.exists(): raise ValueError('Publisher LaunchAgent already exists')
    target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(plistlib.dumps(schedule))
    command(['/bin/launchctl', 'bootstrap', f'gui/{os.getuid()}', target])
    print('Publisher enrolled: ' + str(home))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--personal-home', type=Path, required=True)
    parser.add_argument('--home', type=Path, default=Path.home() / 'Library/Application Support/Orca Custom Publisher')
    parser.add_argument('--gh', default='/opt/homebrew/bin/gh')
    args = parser.parse_args()
    install(args.personal_home, args.home, args.gh)
