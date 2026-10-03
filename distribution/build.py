"""Build a native Orca app and its independently scheduled Python updater."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tarfile
import zipfile

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'distribution/updater'))
from policy import REPOSITORY, atomic_json, inventory, sha256, version
from platforms import target

BUILD=ROOT/'distribution/build'


def run(argv, **kwargs):
    print('+',*map(str,argv),flush=True)
    subprocess.run(list(map(str,argv)),cwd=ROOT,check=True,**kwargs)


def pnpm(*args):
    # Execute the JS entry directly so Windows never needs shell=True.
    override=os.environ.get('ORCA_CUSTOM_PNPM')
    if override: return run(['node',override,*args])
    executable=shutil.which('pnpm')
    if not executable: raise RuntimeError('Install pnpm 12 with Node 24 first')
    path=Path(executable).resolve()
    if path.suffix in ('.cmd','.ps1'):
        path=path.parent/'node_modules/pnpm/bin/pnpm.cjs'
        if not path.exists(): path=path.with_suffix('.mjs')
    prefix=['node',path] if path.suffix in ('.js','.cjs','.mjs') else [path]
    run([*prefix,*args])


def notifier():
    bundle=BUILD/'custom-notifier.app'; contents=bundle/'Contents'
    binary=contents/'MacOS/OrcaUpdateNotifier'; binary.parent.mkdir(parents=True,exist_ok=True)
    resources=contents/'Resources'; resources.mkdir(exist_ok=True)
    shutil.copy2(ROOT/'resources/build/icon.icns',resources/'orca.icns')
    identifier='io.github.geunyoung0120.orca-custom.notifications'
    (contents/'Info.plist').write_bytes(plistlib.dumps({
        'CFBundleIdentifier':identifier,'CFBundleName':'Orca Custom Updates',
        'CFBundleDisplayName':'Orca Custom Updates','CFBundleExecutable':binary.name,
        'CFBundlePackageType':'APPL','CFBundleVersion':'1','CFBundleShortVersionString':'1.0',
        'CFBundleIconFile':'orca.icns','LSUIElement':True,'LSMinimumSystemVersion':'12.0'}))
    run(['xcrun','swiftc',ROOT/'distribution/native/OrcaUpdateNotifier.swift','-O',
         '-module-cache-path',BUILD/'swift-cache','-o',binary])
    run(['codesign','--force','--sign','-','--identifier',identifier,bundle])
    run(['codesign','--verify','--deep','--strict',bundle])


def build_updater():
    run([sys.executable,'-m','PyInstaller','--noconfirm','--clean','--onefile',
         '--name','OrcaCustomUpdater','--distpath',BUILD/'updater',
         '--workpath',BUILD/'pyinstaller','--specpath',BUILD,
         *(['--noconsole'] if sys.platform=='win32' else []),
         ROOT/'distribution/updater/main.py'],env={**os.environ,'PYINSTALLER_CONFIG_DIR':str(BUILD/'pyinstaller-cache')})
    executable=BUILD/'updater'/('OrcaCustomUpdater.exe' if sys.platform=='win32' else 'OrcaCustomUpdater')
    run([executable,'self-test'])
    return executable


def application(release_version):
    package_path=ROOT/'package.json'; package=json.loads(package_path.read_text())
    package['version']=release_version
    package_path.write_text(json.dumps(package,indent=2)+'\n',encoding='utf-8')
    if sys.platform=='darwin': notifier()
    # These match build:release, without its developer-only global CLI symlink.
    for script in ('build:relay','build:native'):
        pnpm('run',script)
    if sys.platform=='linux':
        # apt's GObject introspection bindings belong to the system Python.
        run([shutil.which('node'),'config/scripts/verify-computer-native.mjs'],
            env={**os.environ,'PATH':'/usr/bin:'+os.environ['PATH']})
    else:
        pnpm('run','verify:computer-native')
    run(['node','node_modules/typescript/bin/tsc','-p','config/tsconfig.cli.json',
         '--outDir','out','--composite','false','--incremental','false'])
    run(['node','config/scripts/verify-cli-bin.mjs','--fix-executable','--fix-package-json'])
    for script in ('build:electron-vite','verify:built-skills-cli','build:web-from-renderer','build:mobile-web'):
        pnpm('run',script)
    selector={'darwin':'--mac','win32':'--win','linux':'--linux'}[sys.platform]
    architecture=target().split('-')[1]
    pnpm('exec','electron-builder','--dir','--config','distribution/electron-builder.cjs',
         selector,'--'+architecture,'--publish','never','-c.directories.output=distribution/build/electron')
    if sys.platform=='darwin':
        matches=list((BUILD/'electron').glob('mac*/Orca.app'))
        if len(matches)!=1: raise ValueError('Expected exactly one native Mac app')
        return matches[0]
    return BUILD/'electron'/('win-unpacked' if sys.platform=='win32' else 'linux-unpacked')


def package_app(app, updater, release_version, output):
    version(release_version); output.mkdir(parents=True,exist_ok=True)
    package=BUILD/'bundle'; package.mkdir(parents=True,exist_ok=True)
    if sys.platform=='darwin':
        files={'Orca.app/'+key:value for key,value in inventory(app).items()}
        executable='Orca.app/Contents/MacOS/Orca'
    else:
        files=inventory(app); executable='Orca.exe' if sys.platform=='win32' else 'orca-ide'
    if executable not in files: raise ValueError('Packaged app executable is missing')
    with tarfile.open(package/'payload.tar.gz','w:gz',dereference=False) as stream:
        stream.add(app,arcname='app/Orca.app' if sys.platform=='darwin' else 'app')
    atomic_json(package/'files.json',files)
    atomic_json(package/'bundle.json',{'repository':REPOSITORY,'version':release_version,
        'platform':target(),'executable':executable,'updater':updater.name})
    shutil.copy2(updater,package/updater.name)
    if sys.platform=='win32':
        starter='Install Orca Custom.cmd'
        body=('@echo off\r\nstart /wait "" "%~dp0OrcaCustomUpdater.exe" install\r\n'
              'type "%LOCALAPPDATA%\\OrcaCustomManager\\command-result.json"\r\npause\r\n')
    else:
        starter='Install Orca Custom.command' if sys.platform=='darwin' else 'install-orca-custom.sh'
        body='#!/bin/sh\nset -eu\ncd -- "$(dirname -- "$0")"\n./OrcaCustomUpdater install\n'
    (package/starter).write_bytes(body.encode()); (package/starter).chmod(0o755)
    (package/'README.txt').write_text(
        'Orca Custom '+release_version+' ('+target()+')\n\n'
        'Extract the entire archive, then run '+starter+'.\n'
        'Python is included; no developer tools or AI subscription are needed for updates.\n'
        'The updater checks github.com/'+REPOSITORY+' every 10 minutes while logged in.\n'
        'When notified, save your work and quit Orca Custom. Wait for completion before reopening.\n'
        'Unsigned distribution: follow your OS first-launch approval flow.\n'
        'Details: https://github.com/'+REPOSITORY+'\n',encoding='utf-8')
    name=f'Orca-Custom-{release_version}-{target()}.zip'; archive=output/name
    entries=('payload.tar.gz','files.json','bundle.json',updater.name,starter,'README.txt')
    with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_STORED) as stream:
        for entry in entries: stream.write(package/entry,entry)
    fragment={'platform':target(),'version':release_version,'name':name,'size':archive.stat().st_size,
              'sha256':sha256(archive),'url':f'https://github.com/{REPOSITORY}/releases/download/v{release_version}/{name}'}
    atomic_json(output/(target()+'.json'),fragment)
    print(json.dumps(fragment),flush=True)
    return archive


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version',required=True)
    parser.add_argument('--app',type=Path,help='Package an already built application')
    parser.add_argument('--output',type=Path,default=ROOT/'release')
    parser.add_argument('--updater-only',action='store_true')
    args=parser.parse_args(); version(args.version)
    updater=build_updater()
    if args.updater_only: return
    app=args.app or application(args.version)
    package_app(app.resolve(),updater,args.version,args.output.resolve())


if __name__=='__main__': main()
