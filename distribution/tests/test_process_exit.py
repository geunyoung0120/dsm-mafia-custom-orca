from pathlib import Path
import subprocess
import sys
import time
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'updater'))

class ProcessExitTests(unittest.TestCase):
    def wait(self, pids, cancelled=lambda: False):
        import process_exit
        return process_exit.wait_for_any_exit(pids, cancelled)

    def test_native_exit_wakes_without_timer_delay(self):
        process = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(0.2)'])
        try:
            start = time.monotonic()
            self.assertTrue(self.wait([process.pid]))
            self.assertLess(time.monotonic() - start, 3)
        finally:
            if process.poll() is None: process.terminate()
            process.wait(timeout=5)

    def test_cancel_does_not_wait_for_live_process(self):
        process = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])
        try:
            self.assertFalse(self.wait([process.pid], lambda: True))
            self.assertIsNone(process.poll())
        finally:
            process.terminate(); process.wait(timeout=5)

    def test_process_that_already_exited_does_not_block(self):
        process = subprocess.Popen([sys.executable, '-c', 'pass'])
        process.wait(timeout=5)
        self.assertTrue(self.wait([process.pid]))

    def test_empty_process_list_is_ready(self):
        self.assertTrue(self.wait([]))
