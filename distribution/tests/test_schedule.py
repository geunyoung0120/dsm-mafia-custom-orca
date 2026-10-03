from pathlib import Path
import os
import sys
import tempfile
import unittest
import uuid
from unittest.mock import patch
import xml.etree.ElementTree as ET

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'updater'))
import platforms


class ScheduleTests(unittest.TestCase):
    def test_linux_launcher_preserves_unicode_and_quotes(self):
        with tempfile.TemporaryDirectory() as directory:
            home=Path(directory); state=home/'사용자 폴더'
            with patch('platforms.sys.platform','linux'),patch('platforms.Path.home',return_value=home):
                platforms.shortcut(state)
            entry=(home/'.local/share/applications/orca-custom.desktop').read_text()
            self.assertIn('Exec="'+str(state/'app/orca')+'"',entry)
            self.assertNotIn('\\u',entry)

    def test_mac_notification_registers_its_bundle_before_requesting_permission(self):
        with patch('platforms.sys.platform','darwin'),patch('platforms.run',side_effect=['','{"status":"scheduled"}']) as run:
            result=platforms.notify(Path('/fixture'),'title','message',True)
        self.assertTrue(str(run.call_args_list[0].args[0][0]).endswith('/lsregister'))
        self.assertIn('--request-permission',run.call_args_list[1].args[0])
        self.assertEqual(result['status'],'scheduled')

    @unittest.skipUnless(sys.platform=='win32' and os.environ.get('GITHUB_ACTIONS')=='true',
                         'Registers a disposable task only on the isolated Windows CI runner')
    def test_windows_scheduler_accepts_and_runs_task(self):
        with tempfile.TemporaryDirectory() as directory:
            state=Path(directory); task='OrcaCustomTest-'+uuid.uuid4().hex
            try:
                platforms.schedule(state,Path(sys.executable),windows_task_name=task)
                output=platforms.run(['schtasks','/Query','/TN',task,'/XML'])
                self.assertIn('TimeTrigger',output)
            finally:
                platforms.run(['schtasks','/Delete','/TN',task,'/F'])

    def test_windows_polling_starts_without_needing_another_logon(self):
        with tempfile.TemporaryDirectory() as directory:
            state=Path(directory); bootstrap=state/'OrcaCustomBootstrap.exe'
            with patch('platforms.sys.platform','win32'),patch('platforms.run'):
                platforms.schedule(state,bootstrap)
            task=ET.parse(state/'schedule.xml')
            namespace={'t':'http://schemas.microsoft.com/windows/2004/02/mit/task'}
            trigger=task.find('t:Triggers/t:TimeTrigger',namespace)
            self.assertIsNotNone(trigger)
            self.assertEqual(trigger.find('t:Repetition/t:Interval',namespace).text,'PT1M')
            self.assertIsNotNone(trigger.find('t:StartBoundary',namespace))


if __name__=='__main__': unittest.main()
