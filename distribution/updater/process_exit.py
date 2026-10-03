"""Wait for process exits without an application polling timer.

The one-second native wait timeout checks cancellation only; it does not defer
exit delivery. Never terminate a process or wait for the persistent terminal daemon.
"""
from contextlib import closing
import errno
import os
import select
import selectors
import sys


def wait_for_any_exit(pids, cancelled=lambda: False):
    pids = list(dict.fromkeys(pids))
    if cancelled():
        return False
    if not pids:
        return True
    if sys.platform == 'darwin':
        with closing(select.kqueue()) as queue:
            for pid in pids:
                event = select.kevent(pid, filter=select.KQ_FILTER_PROC,
                                      flags=select.KQ_EV_ADD | select.KQ_EV_ONESHOT,
                                      fflags=select.KQ_NOTE_EXIT)
                try:
                    queue.control([event], 0, 0)
                except ProcessLookupError:
                    return True
            while not cancelled():
                if queue.control(None, 1, 1):
                    return True
        return False
    if sys.platform == 'win32':
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel.CloseHandle.restype = wintypes.BOOL
        kernel.WaitForMultipleObjects.argtypes = [wintypes.DWORD,
            ctypes.POINTER(wintypes.HANDLE), wintypes.BOOL, wintypes.DWORD]
        kernel.WaitForMultipleObjects.restype = wintypes.DWORD
        handles = []
        try:
            for pid in pids[:64]:
                handle = kernel.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
                if not handle:
                    error = ctypes.get_last_error()
                    if error == 87:  # PID exited before registration.
                        return True
                    raise ctypes.WinError(error)
                handles.append(handle)
            array = (wintypes.HANDLE * len(handles))(*handles)
            while not cancelled():
                result = kernel.WaitForMultipleObjects(len(handles), array, False, 1000)
                if result < len(handles):
                    return True
                if result != 258:  # WAIT_TIMEOUT
                    raise ctypes.WinError(ctypes.get_last_error())
            return False
        finally:
            for handle in handles:
                kernel.CloseHandle(handle)
    descriptors = []
    try:
        with selectors.DefaultSelector() as selector:
            for pid in pids:
                try:
                    descriptor = os.pidfd_open(pid)
                except ProcessLookupError:
                    return True
                except OSError as error:
                    if error.errno != errno.ENOSYS:
                        raise
                    return _portable_wait(pids, cancelled)
                except AttributeError:
                    return _portable_wait(pids, cancelled)
                descriptors.append(descriptor)
                selector.register(descriptor, selectors.EVENT_READ)
            while not cancelled():
                if selector.select(1):
                    return True
            return False
    finally:
        for descriptor in descriptors:
            os.close(descriptor)


def _portable_wait(pids, cancelled):
    # Compatibility for older Linux kernels without pidfd_open.
    import psutil
    processes = []
    for pid in pids:
        try:
            processes.append(psutil.Process(pid))
        except psutil.NoSuchProcess:
            return True
    while not cancelled():
        gone, _ = psutil.wait_procs(processes, timeout=1)
        if gone:
            return True
    return False
