"""Remove verified-install staging data without touching the rollback app."""
import shutil
from policy import atomic_json, read_json, version


def prune(state):
    current=read_json(state/'current.json',{})
    previous=read_json(state/'install-journal.json',{}).get('previousCurrent') or {}
    keep={current.get('version'),previous.get('version')}
    errors=[]
    for category in ('downloads','prepared','runtimes'):
        folder=state/category
        if not folder.is_dir() or folder.is_symlink(): continue
        for entry in folder.iterdir():
            if not entry.is_dir() or entry.is_symlink(): continue
            try: version(entry.name)
            except ValueError: continue
            if category=='runtimes' and entry.name in keep: continue
            try: shutil.rmtree(entry)
            except OSError as error: errors.append({'path':str(entry),'reason':str(error)})
    if errors: atomic_json(state/'cleanup-error.json',errors)
    else: (state/'cleanup-error.json').unlink(missing_ok=True)
