import os
from pathlib import Path
import shutil
import tempfile
from policy import atomic_json, read_json, verify_inventory


def app_running(app):
    import psutil
    app=Path(app).resolve()
    for process in psutil.process_iter(['exe','cmdline','name']):
        try:
            info=process.info; executable=info['exe']
            if not executable:
                if (info['name'] or '').lower() in ('orca','orca.exe','orca-ide'): return True
                continue
            if not Path(executable).resolve().is_relative_to(app): continue
            args=info['cmdline'] or []
            # Orca keeps its terminal daemon alive after the GUI quits.
            if (len(args)>1 and Path(args[1]).name=='daemon-entry.js' and
                    Path(args[1]).resolve().is_relative_to(app) and '--socket' in args and '--pid-record' in args):
                continue
            return True
        except psutil.NoSuchProcess:
            continue
        except psutil.AccessDenied:
            if (process.info.get('name') or '').lower() in ('orca','orca.exe','orca-ide'): return True
    return False


def restore_metadata(state, journal):
    previous=journal.get('previousCurrent')
    if previous is None: (Path(state)/'current.json').unlink(missing_ok=True)
    else: atomic_json(Path(state)/'current.json',previous)


def recover(state, app):
    state,app=Path(state),Path(app)
    journal=read_json(Path(state)/'install-journal.json',{})
    if journal.get('status')!='swapping': return
    backup=Path(state)/'previous-app'
    if app.exists():
        try:
            verify_inventory(app,journal['files'])
        except ValueError:
            if not backup.exists(): raise
            if app_running(app): raise RuntimeError('Interrupted installation is waiting for app exit')
            shutil.rmtree(app)
        else:
            atomic_json(state/'current.json',journal['current'])
            atomic_json(state/'install-journal.json',{**journal,'status':'installed'})
            return
    if backup.exists(): backup.rename(app)
    restore_metadata(state,journal)
    atomic_json(Path(state)/'install-journal.json',{**journal,'status':'rolled_back'})


def replace_app(state, app, candidate, files, release_version, current=None):
    state,app,candidate=Path(state),Path(app),Path(candidate)
    state.mkdir(parents=True,exist_ok=True)
    if app.is_symlink(): raise ValueError('Installation must not be a symlink')
    if app_running(app): return 'waiting_for_quit'
    verify_inventory(candidate,files)
    app.parent.mkdir(parents=True,exist_ok=True)
    backup=state/'previous-app'
    # The installation and backup share the same state directory/filesystem.
    if state.stat().st_dev != app.parent.stat().st_dev:
        raise ValueError('Backup and application must share a filesystem')
    stage=Path(tempfile.mkdtemp(prefix='.orca-stage-',dir=app.parent))
    try:
        shutil.copytree(candidate,stage,dirs_exist_ok=True,symlinks=True)
        verify_inventory(stage,files)
        if app_running(app) or (state/'paused').exists(): return 'waiting_for_quit'
        if backup.exists(): shutil.rmtree(backup)
        journal={'status':'swapping','version':release_version,'files':files,
                 'current':current or {'version':release_version},'previousCurrent':read_json(state/'current.json')}
        atomic_json(state/'install-journal.json',journal)
        if app.exists(): app.rename(backup)
        try:
            stage.rename(app)
            verify_inventory(app,files)
            if current: atomic_json(state/'current.json',current)
            atomic_json(state/'install-journal.json',{**journal,'status':'installed'})
        except BaseException:
            if app.exists(): app.rename(stage)
            if backup.exists(): backup.rename(app)
            restore_metadata(state,journal)
            atomic_json(state/'install-journal.json',{**journal,'status':'rolled_back'})
            raise
        return 'installed'
    finally:
        if stage.exists(): shutil.rmtree(stage)
