"""Per-user Python updater for the public Orca Custom distribution."""
import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import zipfile
from urllib.error import URLError
from install import recover, replace_app, blocking_pids, RecoveryWaitingForQuit
from process_exit import wait_for_any_exit
from cache import prune
from network import download, latest, release_manifest
import platforms
from policy import REPOSITORY, atomic_json, extract_payload, read_json, relative_path, verify_inventory, version

OUTPUT_STATE=None

def emit(value):
    if sys.stdout: print(json.dumps(value,ensure_ascii=False),flush=True)
    elif OUTPUT_STATE is not None: atomic_json(OUTPUT_STATE/'command-result.json',value)


@contextmanager
def lock(state, filename='updater.lock'):
    state.mkdir(parents=True,exist_ok=True)
    handle=(state/filename).open('a+b')
    try:
        if sys.platform=='win32':
            import msvcrt
            handle.seek(0); handle.write(b'0'); handle.flush(); handle.seek(0)
            try: msvcrt.locking(handle.fileno(),msvcrt.LK_NBLCK,1)
            except OSError as error:
                if error.errno in (11,13,36): raise BlockingIOError('Updater is already running') from error
                raise
        else:
            import fcntl
            fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
        yield
    finally: handle.close()


def notice(state, release_version, phase, permission=False):
    path=state/'notifications.json'; records=read_json(path,{})
    key=release_version+'-'+phase; previous=records.get(key,{})
    if previous.get('status')=='scheduled': return
    if not permission and time.time()-previous.get('time',0)<3600: return
    message=('Update is ready. Save your work and quit Orca Custom. Wait for the installation-complete notification before reopening.'
             if phase=='ready' else 'Installation and verification completed. You can now open Orca Custom.')
    try: receipt=platforms.notify(state,'Orca Custom '+release_version,message,permission)
    except Exception as error: receipt={'status':'error','reason':str(error)[-1000:]}
    records[key]={**receipt,'time':time.time()}
    atomic_json(path,dict(list(records.items())[-100:]))


def validate_bundle(bundle):
    version(bundle['version'])
    if bundle.get('repository')!=REPOSITORY or bundle.get('platform')!=platforms.target():
        raise ValueError('Installer belongs to a different repository or platform')
    for name in ('updater','executable'):
        relative_path(bundle[name])
    if bundle['updater'] not in ('OrcaCustomUpdater','OrcaCustomUpdater.exe'):
        raise ValueError('Unexpected updater executable')


def prepare(state, package):
    bundle=read_json(package/'bundle.json'); validate_bundle(bundle)
    release_version=bundle['version']; folder=state/'prepared'/release_version
    folder.mkdir(parents=True,exist_ok=True)
    payload=folder/'payload'
    if payload.exists(): shutil.rmtree(payload)
    extract_payload(package/'payload.tar.gz',payload)
    files=read_json(package/'files.json'); verify_inventory(payload/'app',files)
    runtime=state/'runtimes'/release_version; runtime.mkdir(parents=True,exist_ok=True)
    executable=runtime/bundle['updater']
    if executable.resolve()!=Path(sys.executable).resolve():
        shutil.copy2(package/bundle['updater'],executable); executable.chmod(0o755)
    current={**bundle,'runtime':str(executable),'installedAt':time.time()}
    pending={'version':release_version,'candidate':str(payload/'app'),'files':files,'current':current}
    atomic_json(state/'pending.json',pending)
    return pending


def apply(state, pending, request_permission=False):
    failure=read_json(state/'failure.json',{})
    if failure.get('version')==pending['version']:
        return {'status':'blocked_after_failure','version':pending['version'],'reason':failure['reason']}
    try:
        journal=read_json(state/'install-journal.json',{})
        if (journal.get('status')=='installed' and journal.get('current')==pending['current']
                and read_json(state/'current.json')==pending['current']):
            result='installed'
        else:
            result=replace_app(state,state/'app',Path(pending['candidate']),pending['files'],pending['version'],pending['current'])
    except Exception as error:
        result={'status':'failed','version':pending['version'],'reason':str(error)}
        atomic_json(state/'failure.json',result); return result
    if result=='installed':
        (state/'pending.json').unlink(missing_ok=True)
        (state/'failure.json').unlink(missing_ok=True)
        notice(state,pending['version'],'installed',request_permission)
        try: prune(state)
        except Exception as error: atomic_json(state/'cleanup-error.json',{'reason':str(error)})
    elif result=='waiting_for_quit':
        notice(state,pending['version'],'ready',request_permission)
    result={'status':result,'version':pending['version'],'updatedAt':time.time()}
    atomic_json(state/'status.json',result)
    return result


def unpack_download(archive, destination):
    destination.mkdir(parents=True,exist_ok=True)
    allowed={'bundle.json','files.json','payload.tar.gz','OrcaCustomUpdater','OrcaCustomUpdater.exe'}
    with zipfile.ZipFile(archive) as stream:
        total=0; seen=set()
        for entry in stream.infolist():
            relative_path(entry.filename)
            if '/' in entry.filename or entry.filename in seen: raise ValueError('Unexpected installer archive layout')
            seen.add(entry.filename); total+=entry.file_size
            if total>4*1024**3: raise ValueError('Installer archive exceeds size limit')
            if entry.filename in allowed:
                with stream.open(entry) as source,(destination/entry.filename).open('wb') as output:
                    shutil.copyfileobj(source,output)


def tick(state, force=False):
    if (state/'paused').exists(): return {'status':'paused'}
    recover(state,state/'app')
    pending=read_json(state/'pending.json')
    if pending: return apply(state,pending)
    checked=read_json(state/'last-check.json',{}).get('time',0)
    if not force and time.time()-checked<600: return {'status':'idle'}
    atomic_json(state/'last-check.json',{'time':time.time()})
    release=latest(state)
    if not release: return {'status':'no_release'}
    current=read_json(state/'current.json',{'version':'0.0.0'})
    new_version=release['tag_name'].removeprefix('v')
    if version(new_version)<=version(current['version']): return {'status':'up_to_date','version':current['version']}
    failure=read_json(state/'failure.json',{})
    if failure.get('version')==new_version: return {**failure,'status':'blocked_after_failure'}
    try:
        manifest=release_manifest(state,release)
        asset=manifest['platforms'][platforms.target()]
        folder=state/'downloads'/new_version
        archive=folder/'installer.zip'
        download(asset['url'],archive,new_version,asset['sha256'],asset['size'])
        package=folder/'package'; unpack_download(archive,package)
        bundle=read_json(package/'bundle.json')
        if bundle['version']!=new_version: raise ValueError('Installer version differs from release')
        pending=prepare(state,package)
        return apply(state,pending)
    except (URLError,TimeoutError,ConnectionError) as error:
        result={'status':'network_error','version':new_version,'reason':str(error)[-2000:],'time':time.time()}
        atomic_json(state/'last-error.json',result)
        return result
    except Exception as error:
        failure={'status':'failed','version':new_version,'reason':str(error)[-2000:]}
        atomic_json(state/'failure.json',failure)
        return failure


def install_initial(state, package):
    if not getattr(sys,'frozen',False):
        raise ValueError('Use the packaged installer to install the scheduled updater')
    current=read_json(state/'current.json')
    incoming=read_json(package/'bundle.json'); validate_bundle(incoming)
    if current and version(incoming['version'])<version(current['version']): raise ValueError('Downgrade refused')
    pending=prepare(state,package)
    result=apply(state,pending,request_permission=True)
    if result['status'] not in ('installed','waiting_for_quit'): return result
    bootstrap=state/('OrcaCustomBootstrap.exe' if sys.platform=='win32' else 'OrcaCustomBootstrap')
    if not bootstrap.exists(): shutil.copy2(sys.executable,bootstrap); bootstrap.chmod(0o755)
    platforms.shortcut(state)
    platforms.schedule(state,bootstrap)
    return result


def watch_ready(state):
    """Wait outside the installer lock; only one pending watcher per installation."""
    try:
        with lock(state, 'installation-watch.lock'):
            cancelled = lambda: (state/'paused').exists() or not (state/'pending.json').exists()
            while (state/'pending.json').exists():
                if (state/'paused').exists():
                    time.sleep(0.2)
                    continue
                pids = blocking_pids(state/'app')
                if pids:
                    if not wait_for_any_exit(pids, cancelled): continue
                    continue
                try:
                    with lock(state):
                        if cancelled(): continue
                        try:
                            recover(state, state/'app')
                        except RecoveryWaitingForQuit:
                            continue
                        pending = read_json(state/'pending.json')
                        if not pending: return
                        result = apply(state, pending)
                except BlockingIOError:
                    time.sleep(0.2)  # Contended installer lock only, never a quit timer.
                    continue
                emit(result)
                if result['status'] not in ('waiting_for_quit', 'paused'): return
    except BlockingIOError:
        return


def start_ready_watcher(state):
    try:
        with lock(state, 'installation-watch.lock'):
            pass
    except BlockingIOError:
        return
    # Start after releasing the probe lock so the child can acquire ownership.
    pending = read_json(state/'pending.json', {})
    runtime = Path(pending.get('current', {}).get('runtime', sys.executable))
    argv = [str(runtime)]
    if not getattr(sys, 'frozen', False): argv.append(str(Path(__file__).resolve()))
    argv += ['watch-ready', '--state', str(state)]
    if sys.platform == 'linux':
        platforms.start_watch_service(argv)
        return
    options = {'creationflags': subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS} if sys.platform == 'win32' else {'start_new_session': True}
    with (state/'installation-watch.log').open('ab') as log:
        subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=log, stderr=log, **options)


def main():
    global OUTPUT_STATE
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',nargs='?',default='install',choices=['install','tick','check','status','pause','resume','retry','notify','self-test','watch-ready'])
    parser.add_argument('--state',type=Path,default=platforms.state_home())
    args=parser.parse_args(); state=args.state.resolve()
    if args.command=='self-test': emit({'platform':platforms.target(),'repository':REPOSITORY}); return
    OUTPUT_STATE=state
    # A stable bootstrap delegates to the verified versioned Python executable.
    current=read_json(state/'current.json',{})
    runtime=Path(current.get('runtime',sys.executable))
    if (getattr(sys,'frozen',False) and args.command not in ('install','watch-ready') and runtime.exists() and
            runtime.resolve()!=Path(sys.executable).resolve() and runtime.resolve().is_relative_to((state/'runtimes').resolve())):
        options={'creationflags':subprocess.CREATE_NO_WINDOW} if sys.platform=='win32' else {}
        raise SystemExit(subprocess.call([str(runtime),*sys.argv[1:]],**options))
    if args.command=='status':
        emit({'state':str(state),'current':current,'status':read_json(state/'status.json'),
              'failure':read_json(state/'failure.json'),'notifications':read_json(state/'notifications.json'),'paused':(state/'paused').exists()})
        return
    state.mkdir(parents=True,exist_ok=True)
    if args.command=='pause': (state/'paused').touch(); return
    try:
        if args.command == 'watch-ready':
            watch_ready(state)
            return
        with lock(state):
            if args.command=='resume': (state/'paused').unlink(missing_ok=True)
            if args.command=='retry': (state/'failure.json').unlink(missing_ok=True)
            if args.command=='install': result=install_initial(state,Path(sys.executable).parent)
            elif args.command=='notify':
                pending=read_json(state/'pending.json')
                if pending: notice(state,pending['version'],'ready',True)
                result={'status':'notification_requested'}
            else: result=tick(state,force=args.command in ('check','retry','resume'))
            emit(result)
            if result.get('status')=='failed': raise SystemExit(1)
        if result.get('status') == 'waiting_for_quit': start_ready_watcher(state)
    except BlockingIOError:
        emit({'status':'already_running'})
    except Exception as error:
        atomic_json(state/'last-error.json',{'error':str(error)[-2000:],'time':time.time()})
        emit({'status':'error','reason':str(error)}); raise SystemExit(1)


if __name__=='__main__': main()
