import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'updater'))
import policy
import install


class PolicyTests(unittest.TestCase):
    def test_versions_are_numeric_and_strict(self):
        self.assertGreater(policy.version('1.0.10'), policy.version('1.0.9'))
        for value in ('../1.0.1', '1.0.1\n', '1.0.1-rc.1', '1.0'):
            with self.assertRaises(ValueError): policy.version(value)

    def test_assets_must_belong_to_our_exact_repository_and_release(self):
        good = 'https://github.com/geunyoung0120/gy-custom-orca/releases/download/v1.0.1/app.zip'
        policy.validate_asset_url(good, '1.0.1')
        for bad in (good.replace('geunyoung0120','attacker'), good.replace('https:','http:'), good+'?other=1',good.replace('v1.0.1','v1.0.2')):
            with self.assertRaises(ValueError): policy.validate_asset_url(bad, '1.0.1')

    def test_archive_escape_and_external_symlinks_rejected(self):
        for name, target in (('../outside', None), ('app/link','../../outside'), ('app/link','/etc/passwd')):
            with self.subTest(name=name, target=target), tempfile.TemporaryDirectory() as directory:
                archive=Path(directory)/'bad.tar.gz'
                with tarfile.open(archive,'w:gz') as stream:
                    info=tarfile.TarInfo(name)
                    if target: info.type=tarfile.SYMTYPE; info.linkname=target
                    stream.addfile(info)
                with self.assertRaises(ValueError): policy.extract_payload(archive,Path(directory)/'extracted')
                self.assertFalse((Path(directory)/'outside').exists())

    @unittest.skipIf(sys.platform=='win32','Windows payloads contain no framework symlinks')
    def test_regular_files_and_internal_framework_links_allowed(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); archive=root/'good.tar.gz'
            with tarfile.open(archive,'w:gz') as stream:
                info=tarfile.TarInfo('app/real'); info.size=2; stream.addfile(info,io.BytesIO(b'ok'))
                info=tarfile.TarInfo('app/link'); info.type=tarfile.SYMTYPE; info.linkname='real'; stream.addfile(info)
            policy.extract_payload(archive,root/'out')
            self.assertEqual((root/'out/app/link').read_bytes(),b'ok')


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name); self.app=self.root/'installed'; self.app.mkdir()
        (self.app/'app.bin').write_bytes(b'old')
        self.candidate=self.root/'candidate'; self.candidate.mkdir()
        (self.candidate/'app.bin').write_bytes(b'new')
        self.files=policy.inventory(self.candidate)

    def test_running_app_is_not_touched(self):
        with patch('install.app_running',return_value=True):
            self.assertEqual(install.replace_app(self.root,self.app,self.candidate,self.files,'1.0.1'),'waiting_for_quit')
        self.assertEqual((self.app/'app.bin').read_bytes(),b'old')

    def test_full_backup_is_kept_after_success(self):
        with patch('install.app_running',return_value=False):
            self.assertEqual(install.replace_app(self.root,self.app,self.candidate,self.files,'1.0.1'),'installed')
        self.assertEqual((self.app/'app.bin').read_bytes(),b'new')
        self.assertEqual((self.root/'previous-app/app.bin').read_bytes(),b'old')

    def test_modified_candidate_rejected(self):
        (self.candidate/'app.bin').write_bytes(b'tampered')
        with patch('install.app_running',return_value=False):
            with self.assertRaises(ValueError): install.replace_app(self.root,self.app,self.candidate,self.files,'1.0.1')
        self.assertEqual((self.app/'app.bin').read_bytes(),b'old')

    def test_failed_post_install_check_rolls_back(self):
        real=policy.verify_inventory
        def verify(path,files):
            if path == self.app: raise ValueError('post-install failure')
            return real(path,files)
        with patch('install.app_running',return_value=False),patch('install.verify_inventory',side_effect=verify):
            with self.assertRaises(ValueError): install.replace_app(self.root,self.app,self.candidate,self.files,'1.0.1')
        self.assertEqual((self.app/'app.bin').read_bytes(),b'old')

    def test_reopened_app_prevents_swap(self):
        with patch('install.app_running',side_effect=[False,True]):
            self.assertEqual(install.replace_app(self.root,self.app,self.candidate,self.files,'1.0.1'),'waiting_for_quit')
        self.assertEqual((self.app/'app.bin').read_bytes(),b'old')

    def test_state_write_failure_restores_previous_version_metadata(self):
        old={'version':'1.0.0'}
        policy.atomic_json(self.root/'current.json',old)
        real=policy.atomic_json
        def write(path,value):
            if path.name=='install-journal.json' and value['status']=='installed':
                raise OSError('disk write failed')
            real(path,value)
        with patch('install.app_running',return_value=False),patch('install.atomic_json',side_effect=write):
            with self.assertRaises(OSError):
                install.replace_app(self.root,self.app,self.candidate,self.files,'1.0.1',{'version':'1.0.1'})
        self.assertEqual((self.app/'app.bin').read_bytes(),b'old')
        self.assertEqual(policy.read_json(self.root/'current.json'),old)

    def test_recovery_of_completed_swap_does_not_require_quit(self):
        (self.app/'app.bin').write_bytes(b'new')
        policy.atomic_json(self.root/'install-journal.json',{
            'status':'swapping','files':self.files,'current':{'version':'1.0.1'}})
        with patch('install.app_running',return_value=True): install.recover(self.root,self.app)
        self.assertEqual(policy.read_json(self.root/'current.json')['version'],'1.0.1')


class ClientTests(unittest.TestCase):
    def test_cleanup_removes_downloads_but_keeps_rollback_and_active_runtimes(self):
        from cache import prune
        with tempfile.TemporaryDirectory() as directory:
            state=Path(directory)
            policy.atomic_json(state/'current.json',{'version':'1.0.3'})
            policy.atomic_json(state/'install-journal.json',{'previousCurrent':{'version':'1.0.2'}})
            for category in ('downloads','prepared','runtimes'):
                for value in ('1.0.1','1.0.2','1.0.3'):
                    folder=state/category/value; folder.mkdir(parents=True)
                    (folder/'payload').write_bytes(b'fixture')
            (state/'previous-app').mkdir(); (state/'previous-app/old').write_bytes(b'old app')
            prune(state)
            self.assertEqual(list((state/'downloads').iterdir()),[])
            self.assertEqual(list((state/'prepared').iterdir()),[])
            self.assertEqual({p.name for p in (state/'runtimes').iterdir()},{'1.0.2','1.0.3'})
            self.assertEqual((state/'previous-app/old').read_bytes(),b'old app')

    def test_temporary_network_failure_does_not_permanently_block_release(self):
        import main
        from urllib.error import URLError
        with tempfile.TemporaryDirectory() as directory:
            state=Path(directory)
            with patch('main.latest',return_value={'tag_name':'v1.0.2'}),patch('main.release_manifest',side_effect=URLError('offline')):
                result=main.tick(state,force=True)
            self.assertEqual(result['status'],'network_error')
            self.assertFalse((state/'failure.json').exists())

    def test_recovered_install_clears_pending_without_replacing_running_app(self):
        import main
        with tempfile.TemporaryDirectory() as directory:
            state=Path(directory); current={'version':'1.0.1','runtime':'example'}
            policy.atomic_json(state/'current.json',current)
            policy.atomic_json(state/'install-journal.json',{'status':'installed','current':current})
            policy.atomic_json(state/'pending.json',{'version':'1.0.1'})
            with patch('main.replace_app') as replace,patch('main.notice'):
                result=main.apply(state,{'version':'1.0.1','current':current})
            self.assertEqual(result['status'],'installed')
            replace.assert_not_called()
            self.assertFalse((state/'pending.json').exists())


if __name__ == '__main__': unittest.main()
