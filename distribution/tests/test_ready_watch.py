from pathlib import Path
import tempfile
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'updater'))
import main
import policy

class ReadyWatchTests(unittest.TestCase):
    def test_install_waits_for_exit_then_uses_existing_installer_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            policy.atomic_json(state/'pending.json', {'version':'1.0.15'})
            events=[]
            def installed(*args):
                events.append('install')
                (state/'pending.json').unlink()
                return {'status':'installed'}
            with patch('main.blocking_pids', side_effect=[[123], []], create=True), \
                 patch('main.wait_for_any_exit', side_effect=lambda *a: (events.append('exit') or True), create=True), \
                 patch('main.apply', side_effect=installed):
                self.assertTrue(hasattr(main, 'watch_ready'), 'Pending exit watcher is missing')
                main.watch_ready(state)
            self.assertEqual(events, ['exit', 'install'])

    def test_paused_watcher_keeps_ownership_until_resume_or_cancel(self):
        import threading
        with tempfile.TemporaryDirectory() as directory:
            state=Path(directory); (state/'paused').touch()
            policy.atomic_json(state/'pending.json', {'version':'1.0.15'})
            exited=threading.Event()
            with patch('main.apply') as apply:
                thread=threading.Thread(target=lambda:(main.watch_ready(state),exited.set()))
                thread.start()
                try:
                    self.assertFalse(exited.wait(0.1), 'Paused watcher lost ownership')
                    apply.assert_not_called()
                finally:
                    (state/'pending.json').unlink(missing_ok=True)
                    thread.join(timeout=3)
            self.assertFalse(thread.is_alive())

    def test_interrupted_swap_recovers_backup_before_install(self):
        import install
        with tempfile.TemporaryDirectory() as directory:
            state=Path(directory); app=state/'app'; backup=state/'previous-app'; candidate=state/'candidate'
            backup.mkdir(); candidate.mkdir()
            (backup/'marker').write_text('old'); (candidate/'marker').write_text('new')
            files=policy.inventory(candidate)
            current={'version':'1.0.15'}
            policy.atomic_json(state/'pending.json',{'version':'1.0.15','candidate':str(candidate),'files':files,'current':current})
            policy.atomic_json(state/'install-journal.json',{'status':'swapping','files':files,'current':current,'previousCurrent':{'version':'1.0.14'}})
            with patch('main.blocking_pids',return_value=[]), patch('install.app_running',return_value=False), patch('main.notice'):
                main.watch_ready(state)
            self.assertEqual((app/'marker').read_text(),'new')
            self.assertTrue(backup.exists(), 'Interrupted update destroyed the rollback app')
            self.assertEqual((backup/'marker').read_text(),'old')

    def test_watcher_is_activated_immediately_after_a_waiting_result(self):
        with tempfile.TemporaryDirectory() as directory:
            state=Path(directory)
            with patch('main.sys.argv', ['updater','tick','--state',str(state)]), \
                 patch('main.tick', return_value={'status':'waiting_for_quit'}), \
                 patch('main.start_ready_watcher', create=True) as start:
                main.main()
                start.assert_called_once_with(state.resolve())

    def test_new_pending_runtime_is_not_delegated_to_old_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            state=Path(directory).resolve(); runtime=state/'runtimes/old/updater'
            runtime.parent.mkdir(parents=True); runtime.touch()
            policy.atomic_json(state/'current.json',{'runtime':str(runtime)})
            with patch('main.sys.argv',['updater','watch-ready','--state',str(state)]), \
                 patch('main.sys.frozen',True,create=True), patch('main.watch_ready') as watch, \
                 patch('main.subprocess.call') as delegate:
                main.main(); watch.assert_called_once_with(state); delegate.assert_not_called()

    def test_existing_watcher_prevents_another_child_process(self):
        with tempfile.TemporaryDirectory() as directory:
            state=Path(directory)
            with main.lock(state,'installation-watch.lock'), patch('main.subprocess.Popen') as spawn:
                main.start_ready_watcher(state)
                spawn.assert_not_called()

    def test_reopened_app_during_recovery_rearms_exit_watch(self):
        import install
        with tempfile.TemporaryDirectory() as directory:
            state=Path(directory); app=state/'app'; backup=state/'previous-app'; candidate=state/'candidate'
            for folder in (app,backup,candidate): folder.mkdir()
            (app/'marker').write_text('invalid'); (backup/'marker').write_text('old'); (candidate/'marker').write_text('new')
            files=policy.inventory(candidate);current={'version':'1.0.15'}
            policy.atomic_json(state/'pending.json',{'version':'1.0.15','candidate':str(candidate),'files':files,'current':current})
            policy.atomic_json(state/'install-journal.json',{'status':'swapping','files':files,'current':current,'previousCurrent':{'version':'1.0.14'}})
            with patch('main.blocking_pids',side_effect=[[],[31],[]]), \
                 patch('main.wait_for_any_exit',return_value=True) as wait, \
                 patch('install.app_running',side_effect=[True,False,False,False]), patch('main.notice'):
                main.watch_ready(state)
                wait.assert_called_once()
            self.assertEqual((app/'marker').read_text(),'new')
            self.assertEqual((backup/'marker').read_text(),'old')
