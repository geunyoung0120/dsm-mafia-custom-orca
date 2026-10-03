"""Build publication trees from verified Git objects, never a working-directory copy."""
import hashlib
import os
from pathlib import Path
import signal
import subprocess
import tempfile

REPOSITORY = 'geunyoung0120/dsm-mafia-custom-orca'
REMOTE = 'https://github.com/' + REPOSITORY + '.git'


def environment():
    env = {k: v for k, v in os.environ.items() if not k.startswith(('ORCA_', 'GIT_INDEX_'))}
    env.update(ORCA_BACKGROUND_LAUNCH='1', GIT_TERMINAL_PROMPT='0', GH_PROMPT_DISABLED='1')
    return env


def command(argv, cwd=None, data=None, env=None, log=None, timeout=300, check=True):
    options = {'start_new_session': True} if os.name != 'nt' else {'creationflags': subprocess.CREATE_NO_WINDOW}
    with subprocess.Popen(list(map(str, argv)), cwd=cwd, env=env or environment(),
                          stdin=subprocess.PIPE if data is not None else subprocess.DEVNULL,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, **options) as process:
        try:
            stdout, stderr = process.communicate(data, timeout=timeout)
        finally:
            if os.name != 'nt':
                try: os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError: pass
            elif process.poll() is None: process.kill()
            if process.poll() is None:
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    if os.name != 'nt': os.killpg(process.pid, signal.SIGKILL)
                    else: process.kill()
                    process.wait()
    if log: Path(log).write_bytes(stdout + stderr)
    if check and process.returncode:
        raise RuntimeError(f'{Path(str(argv[0])).name} failed ({process.returncode}): ' + (stdout + stderr).decode(errors='replace')[-6000:])
    return stdout, process.returncode


def git(repo, *args, data=None, env=None, check=True):
    output, _ = command(['git', '-c', 'core.hooksPath=' + str(Path(repo) / '.git/no-hooks'), *args],
                        cwd=repo, data=data, env=env, check=check)
    return output.decode().strip()


def digest(path):
    with Path(path).open('rb') as stream: return hashlib.file_digest(stream, 'sha256').hexdigest()


def snapshot(repo, upstream, patch, expected_hash):
    if digest(patch) != expected_hash: raise ValueError('Verified source patch changed')
    with tempfile.TemporaryDirectory(prefix='orca-source-index-') as temporary:
        env = {**environment(), 'GIT_INDEX_FILE': str(Path(temporary) / 'index')}
        git(repo, 'read-tree', upstream, env=env)
        if Path(patch).stat().st_size:
            git(repo, 'apply', '--cached', '--binary', '-', data=Path(patch).read_bytes(), env=env)
        tree = git(repo, 'write-tree', env=env)
        return git(repo, 'commit-tree', tree, '-p', upstream, '-m', 'Verified personal source snapshot')


def merge_verified_delta(repo, previous, current, public_head):
    git(repo, 'reset', '--hard', public_head)
    # Only called for the publisher-owned clone; remove leftovers from interrupted repair.
    git(repo, 'clean', '-fd')
    # A new official workflow must never become an executable public workflow.
    delta, _ = command(['git', 'diff', '--binary', '--full-index', previous, current, '--', '.',
                        ':(exclude).github', ':(exclude)distribution'], cwd=repo)
    if delta:
        _, code = command(['git', 'apply', '--3way', '--index', '--binary', '-'], cwd=repo, data=delta, check=False)
        conflicts = git(repo, 'diff', '--name-only', '--diff-filter=U').splitlines()
        if code and not conflicts: raise RuntimeError('Verified source delta could not be applied')
        return conflicts
    return []
