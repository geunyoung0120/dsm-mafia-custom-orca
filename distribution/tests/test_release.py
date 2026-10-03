import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import build
import assemble_release
import main
import policy
import platforms


class BundleTests(unittest.TestCase):
    def test_native_pnpm_is_executed_without_node(self):
        with patch.dict('os.environ',{},clear=True),patch('build.shutil.which',return_value='/usr/local/bin/pnpm'),patch('build.run') as run:
            build.pnpm('run','build:relay')
        self.assertEqual(str(run.call_args.args[0][0]),str(Path('/usr/local/bin/pnpm').resolve()))

    def test_real_package_extraction_and_verified_install(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            app=root/'source'; app.mkdir()
            name={'darwin':'Contents/MacOS/Orca','win32':'Orca.exe','linux':'orca'}[sys.platform]
            executable=app/name; executable.parent.mkdir(parents=True,exist_ok=True)
            executable.write_bytes(b'fixture executable'); executable.chmod(0o755)
            updater=root/('OrcaCustomUpdater.exe' if sys.platform=='win32' else 'OrcaCustomUpdater')
            updater.write_bytes(b'fixture updater')
            with patch('build.BUILD',root/'build'):
                archive=build.package_app(app,updater,'1.0.2',root/'release')
            main.unpack_download(archive,root/'unpacked')
            pending=main.prepare(root/'state',root/'unpacked')
            with patch('install.app_running',return_value=False),patch('main.notice'):
                result=main.apply(root/'state',pending)
            self.assertEqual(result['status'],'installed')
            current=policy.read_json(root/'state/current.json')
            self.assertEqual(current['version'],'1.0.2')
            installed=root/'state/app'/current['executable']
            self.assertEqual(installed.read_bytes(),b'fixture executable')
            if sys.platform!='win32': self.assertTrue(installed.stat().st_mode & 0o100)
            self.assertFalse((root/'state/pending.json').exists())

    def test_release_requires_every_platform_and_matching_hashes(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with self.assertRaises(ValueError): assemble_release.assemble(root,'1.0.1')
            targets=('darwin-arm64','darwin-x64','win32-x64','linux-x64')
            for target in targets:
                name=f'Orca-Custom-1.0.1-{target}.zip'
                archive=root/name; archive.write_bytes(target.encode())
                policy.atomic_json(root/(target+'.json'),{'platform':target,'version':'1.0.1',
                    'name':name,'size':archive.stat().st_size,'sha256':policy.sha256(archive),
                    'url':f'https://github.com/{policy.REPOSITORY}/releases/download/v1.0.1/{name}'})
            assemble_release.assemble(root,'1.0.1')
            self.assertEqual(set(policy.read_json(root/'release.json')['platforms']),set(targets))
            archive.write_bytes(b'corrupted')
            with self.assertRaises(ValueError): assemble_release.assemble(root,'1.0.1')

    def test_archive_cannot_replace_files_outside_package(self):
        import zipfile
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); archive=root/'bad.zip'
            with zipfile.ZipFile(archive,'w') as stream: stream.writestr('../escaped',b'bad')
            with self.assertRaises(ValueError): main.unpack_download(archive,root/'package')
            self.assertFalse((root/'escaped').exists())


if __name__=='__main__': unittest.main()
