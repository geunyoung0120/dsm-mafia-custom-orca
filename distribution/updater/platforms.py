import getpass
from datetime import datetime, timedelta
import json
import os
from pathlib import Path
import platform
import plistlib
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET


def target():
    machine=platform.machine().lower()
    architecture={'arm64':'arm64','aarch64':'arm64','amd64':'x64','x86_64':'x64'}.get(machine)
    value=f'{sys.platform}-{architecture}'
    if value not in ('darwin-arm64','darwin-x64','win32-x64','linux-x64'):
        raise ValueError(f'No published build for {value}')
    return value


def state_home():
    if sys.platform=='darwin': return Path.home()/'Library/Application Support/Orca Custom Manager'
    if sys.platform=='win32': return Path(os.environ['LOCALAPPDATA'])/'OrcaCustomManager'
    return Path(os.environ.get('XDG_DATA_HOME',Path.home()/'.local/share'))/'orca-custom-manager'


def run(argv, **kwargs):
    if sys.platform=='win32': kwargs['creationflags']=subprocess.CREATE_NO_WINDOW
    return subprocess.run([str(arg) for arg in argv],check=True,capture_output=True,text=True,timeout=60,**kwargs).stdout.strip()


def schedule(state, bootstrap, windows_task_name='Orca Custom Updater'):
    state,bootstrap=Path(state),Path(bootstrap)
    args=[str(bootstrap),'tick','--state',str(state)]
    if sys.platform=='darwin':
        label='io.github.geunyoung0120.orca-custom.updater'
        plist=Path.home()/'Library/LaunchAgents'/f'{label}.plist'
        plist.parent.mkdir(parents=True,exist_ok=True)
        plist.write_bytes(plistlib.dumps({'Label':label,'ProgramArguments':args,'StartInterval':60,'RunAtLoad':True,
            'WorkingDirectory':str(state),'ProcessType':'Background','StandardOutPath':str(state/'scheduled.log'),
            'StandardErrorPath':str(state/'scheduled-error.log')}))
        try: run(['/bin/launchctl','bootout',f'gui/{os.getuid()}/{label}'])
        except subprocess.CalledProcessError: pass
        run(['/bin/launchctl','bootstrap',f'gui/{os.getuid()}',plist])
    elif sys.platform=='win32':
        namespace='http://schemas.microsoft.com/windows/2004/02/mit/task'
        ET.register_namespace('',namespace)
        def element(parent,name,text=None,**attrs):
            item=ET.SubElement(parent,f'{{{namespace}}}{name}',attrs); item.text=text; return item
        task=ET.Element(f'{{{namespace}}}Task',{'version':'1.2'})
        triggers=element(task,'Triggers')
        element(element(triggers,'LogonTrigger'),'Enabled','true')
        trigger=element(triggers,'TimeTrigger')
        element(trigger,'StartBoundary',(datetime.now()+timedelta(minutes=1)).isoformat(timespec='seconds'))
        element(trigger,'Enabled','true')
        repetition=element(trigger,'Repetition'); element(repetition,'Interval','PT1M')
        principal=element(element(task,'Principals'),'Principal',id='Author')
        domain=os.environ.get('USERDOMAIN','')
        element(principal,'UserId',(domain+'\\' if domain else '')+getpass.getuser())
        element(principal,'LogonType','InteractiveToken'); element(principal,'RunLevel','LeastPrivilege')
        settings=element(task,'Settings')
        for key,value in {'MultipleInstancesPolicy':'IgnoreNew','DisallowStartIfOnBatteries':'false',
                'StopIfGoingOnBatteries':'false','StartWhenAvailable':'true','ExecutionTimeLimit':'PT20M'}.items():
            element(settings,key,value)
        action=element(element(task,'Actions',Context='Author'),'Exec')
        element(action,'Command',str(bootstrap)); element(action,'Arguments',subprocess.list2cmdline(args[1:]))
        filename=state/'schedule.xml'; filename.write_bytes(ET.tostring(task,encoding='utf-16',xml_declaration=True))
        run(['schtasks','/Create','/TN',windows_task_name,'/XML',filename,'/F'])
        run(['schtasks','/Run','/TN',windows_task_name])
    else:
        units=Path.home()/'.config/systemd/user'; units.mkdir(parents=True,exist_ok=True)
        def quote(value):
            if '\n' in value or '\r' in value: raise ValueError('Invalid systemd argument')
            return '"'+value.replace('\\','\\\\').replace('"','\\"').replace('%','%%')+'"'
        (units/'orca-custom-updater.service').write_text('[Unit]\nDescription=Orca Custom update check\n[Service]\nType=oneshot\nExecStart='+
            ' '.join(map(quote,args))+'\nTimeoutStartSec=20min\n',encoding='utf-8')
        (units/'orca-custom-updater.timer').write_text('[Unit]\nDescription=Orca Custom update timer\n[Timer]\nOnStartupSec=1min\nOnUnitActiveSec=1min\n[Install]\nWantedBy=timers.target\n',encoding='utf-8')
        run(['systemctl','--user','daemon-reload']); run(['systemctl','--user','enable','--now','orca-custom-updater.timer'])


def shortcut(state):
    app=Path(state)/'app'
    if sys.platform=='darwin':
        destination=Path.home()/'Applications/Orca Custom.app'; destination.parent.mkdir(exist_ok=True)
        target=app/'Orca.app'
        if destination.is_symlink() and destination.resolve()==target.resolve(): return
        if destination.exists() or destination.is_symlink(): raise ValueError('An unrelated Orca Custom.app already exists')
        destination.symlink_to(target,target_is_directory=True)
    elif sys.platform=='win32':
        path=Path(os.environ['APPDATA'])/'Microsoft/Windows/Start Menu/Programs/Orca Custom.lnk'
        environment={**os.environ,'ORCA_CUSTOM_SHORTCUT':str(path),'ORCA_CUSTOM_EXE':str(app/'Orca.exe')}
        run(['powershell','-NoProfile','-NonInteractive','-Command',
             '$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:ORCA_CUSTOM_SHORTCUT); '
             '$s.TargetPath=$env:ORCA_CUSTOM_EXE; $s.WorkingDirectory=[IO.Path]::GetDirectoryName($env:ORCA_CUSTOM_EXE); $s.Save()'],env=environment)
    else:
        path=Path.home()/'.local/share/applications/orca-custom.desktop'; path.parent.mkdir(parents=True,exist_ok=True)
        executable=str(app/'orca-ide').replace('%','%%')
        if '\n' in executable or '\r' in executable: raise ValueError('Invalid launcher path')
        for character in ('\\','"','`','$'):
            executable=executable.replace(character,'\\'+character)
        executable='"'+executable.replace('\\','\\\\')+'"'
        path.write_text('[Desktop Entry]\nType=Application\nName=Orca Custom\nExec='+executable+'\nTerminal=false\nCategories=Development;IDE;\n',encoding='utf-8')


def notify(state, title, message, request_permission=False):
    if sys.platform=='darwin':
        bundle=Path(state)/'app/Orca.app/Contents/Resources/custom-notifier.app'
        run(['/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister','-f',bundle])
        helper=bundle/'Contents/MacOS/OrcaUpdateNotifier'
        args=[helper,'--id','orca-custom-update','--title',title,'--message',message]
        if request_permission: args.append('--request-permission')
        return json.loads(run(args))
    if sys.platform=='win32':
        env={**os.environ,'ORCA_CUSTOM_TITLE':title,'ORCA_CUSTOM_MESSAGE':message}
        run(['powershell','-NoProfile','-NonInteractive','-Command',
            'Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; '
            '$n=New-Object System.Windows.Forms.NotifyIcon; $n.Icon=[System.Drawing.SystemIcons]::Information; '
            '$n.Visible=$true; $n.ShowBalloonTip(10000,$env:ORCA_CUSTOM_TITLE,$env:ORCA_CUSTOM_MESSAGE,[System.Windows.Forms.ToolTipIcon]::Info); '
            'Start-Sleep -Seconds 10; $n.Dispose()'],env=env)
        return {'status':'scheduled'}
    run(['notify-send','--app-name=Orca Custom',title,message])
    return {'status':'scheduled'}
