import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'maintainer'))
from source_merge import git, merge_verified_delta, snapshot, digest


class VerifiedSourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name) / 'repo'; self.repo.mkdir()
        git(self.repo, 'init', '-b', 'main')
        git(self.repo, 'config', 'user.name', 'Fixture')
        git(self.repo, 'config', 'user.email', 'fixture@example.invalid')
        (self.repo / 'src').mkdir()
        (self.repo / 'src/app.ts').write_text('base\n')
        (self.repo / '.github/workflows').mkdir(parents=True)
        (self.repo / '.github/workflows/upstream.yml').write_text('old workflow\n')
        git(self.repo, 'add', '.'); git(self.repo, 'commit', '-m', 'upstream')
        self.base = git(self.repo, 'rev-parse', 'HEAD')

    def commit_file(self, name, text):
        p = self.repo / name; p.parent.mkdir(parents=True, exist_ok=True); p.write_text(text)
        git(self.repo, 'add', '.'); git(self.repo, 'commit', '-m', name)
        return git(self.repo, 'rev-parse', 'HEAD')

    def test_new_source_keeps_distribution_and_blocks_new_upstream_workflows(self):
        newer = self.commit_file('src/new.ts', 'new feature\n')
        newer = self.commit_file('.github/workflows/untrusted-new.yml', 'must not publish\n')
        git(self.repo, 'checkout', '-B', 'distribution', self.base)
        (self.repo / '.github/workflows/upstream.yml').unlink()
        public = self.commit_file('distribution/release.json', json.dumps({'repository': 'fixture', 'upstreamCommit': self.base}))
        public = self.commit_file('.github/workflows/custom-release.yml', 'custom workflow\n')
        merge_verified_delta(self.repo, self.base, newer, public)
        self.assertEqual((self.repo / 'src/new.ts').read_text(), 'new feature\n')
        self.assertFalse((self.repo / '.github/workflows/untrusted-new.yml').exists())
        self.assertFalse((self.repo / '.github/workflows/upstream.yml').exists())
        self.assertEqual((self.repo / '.github/workflows/custom-release.yml').read_text(), 'custom workflow\n')
        self.assertEqual(json.loads((self.repo / 'distribution/release.json').read_text())['repository'], 'fixture')

    def test_conflict_is_reported_instead_of_overwriting_custom_code(self):
        newer = self.commit_file('src/app.ts', 'upstream edit\n')
        git(self.repo, 'checkout', '-B', 'distribution', self.base)
        public = self.commit_file('src/app.ts', 'custom edit\n')
        conflicts = merge_verified_delta(self.repo, self.base, newer, public)
        self.assertIn('src/app.ts', conflicts)
        self.assertIn('<<<<<<<', (self.repo / 'src/app.ts').read_text())

    def test_snapshot_uses_only_commit_and_verified_patch(self):
        (self.repo / 'src/app.ts').write_text('verified custom\n')
        patch = Path(self.temp.name) / 'feature.patch'
        patch.write_bytes(subprocess.check_output(['git', 'diff', '--binary', '--full-index'], cwd=self.repo))
        (self.repo / 'private-token.txt').write_text('never publish')
        tree = snapshot(self.repo, self.base, patch, digest(patch))
        self.assertEqual(git(self.repo, 'show', tree + ':src/app.ts'), 'verified custom')
        self.assertNotIn('private-token.txt', git(self.repo, 'ls-tree', '-r', '--name-only', tree))
        with self.assertRaises(ValueError): snapshot(self.repo, self.base, patch, '0' * 64)

from unittest.mock import patch
import publisher
from validate_source import protected_files, enforce_repair_scope


class PublisherStateTests(VerifiedSourceTests):
    def prepare_event(self):
        home = Path(self.temp.name) / 'publisher'; home.mkdir()
        # Use our owned fixture clone as the checkout, without touching any real repository.
        self.repo.rename(home / 'checkout'); self.repo = home / 'checkout'
        job = Path(self.temp.name) / 'personal/jobs/fixture'; job.mkdir(parents=True)
        subprocess.run(['git', 'clone', str(self.repo), str(job / 'source')], check=True, capture_output=True)
        feature = job / 'feature.patch'; feature.write_text('')
        event = {'commit': self.base, 'patchHash': digest(feature), 'version': '1.2.3', 'job': str(job)}
        identity = publisher.event_id(event)
        publisher.write(home / 'queue' / (identity + '.json'), event)
        publisher.write(home / 'checkout-owner.json', {'path': str(self.repo.resolve()), 'repository': publisher.REMOTE})
        publisher.write(home / 'baseline.json', {'snapshot': self.base, 'eventId': 'older'})
        git(self.repo, 'remote', 'add', 'origin', publisher.REMOTE)
        git(self.repo, 'update-ref', 'refs/remotes/origin/main', self.base)
        config = {'personalHome': str(job.parent.parent)}
        return home, config, event, identity

    def test_interrupted_push_is_not_duplicated_and_baseline_waits_for_ci(self):
        home, config, event, identity = self.prepare_event()
        record = {'status': 'push_pending', 'publicHead': self.base, 'baseHead': self.base, 'snapshot': self.base}
        real_git = publisher.git
        def local_git(repo, *args, **kwargs):
            if args[0] == 'fetch': return ''
            if args[0] == 'push': self.fail('Already-pushed commit must not be pushed again')
            return real_git(repo, *args, **kwargs)
        with patch.object(publisher, 'check_identity'), patch.object(publisher, 'git', side_effect=local_git), \
             patch.object(publisher, 'confirmed_release', return_value=False):
            publisher.process_event(config, home, event, record)
        self.assertEqual(record['status'], 'pushed')
        self.assertEqual(publisher.read(home / 'baseline.json')['eventId'], 'older')
        with patch.object(publisher, 'check_identity'), patch.object(publisher, 'git', side_effect=local_git), \
             patch.object(publisher, 'confirmed_release', return_value=True):
            publisher.process_event(config, home, event, record)
        self.assertEqual(record['status'], 'published')
        self.assertEqual(publisher.read(home / 'baseline.json')['eventId'], identity)

    def test_failed_ci_blocks_without_advancing_baseline(self):
        home, config, event, identity = self.prepare_event()
        record = {'status': 'pushed', 'publicHead': self.base, 'snapshot': self.base}
        publisher.write(home / 'records' / (identity + '.json'), record)
        real_git = publisher.git
        with patch.object(publisher, 'check_identity'), \
             patch.object(publisher, 'git', side_effect=lambda repo, *args, **kw: '' if args[0] == 'fetch' else real_git(repo, *args, **kw)), \
             patch.object(publisher, 'confirmed_release', side_effect=ValueError('CI failed')):
            result = publisher.tick(config, home)
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(publisher.read(home / 'baseline.json')['eventId'], 'older')

    def test_network_failure_retries_without_blocking_or_new_commit(self):
        home, config, event, identity = self.prepare_event()
        with patch.object(publisher, 'check_identity', side_effect=RuntimeError('offline')):
            result = publisher.tick(config, home)
        self.assertEqual(result['status'], 'queued')
        self.assertGreater(result['retryAt'], 0)
        self.assertEqual(git(self.repo, 'rev-parse', 'HEAD'), self.base)

    def test_malformed_queue_is_reported(self):
        home = Path(self.temp.name) / 'publisher'
        publisher.write(home / 'queue/bad.json', {'version': 'bad'})
        self.assertEqual(publisher.tick({}, home)['status'], 'blocked')

    def test_unowned_checkout_is_rejected_before_reset(self):
        home, config, event, identity = self.prepare_event()
        (home / 'checkout-owner.json').unlink()
        with self.assertRaisesRegex(ValueError, 'ownership'):
            publisher.process_event(config, home, event, {'status': 'queued'})

    def test_agent_cannot_change_tests_or_workflows(self):
        self.commit_file('src/example.test.ts', 'original assertion')
        protected = protected_files(self.repo)
        (self.repo / 'src/example.test.ts').write_text('weakened assertion')
        with self.assertRaisesRegex(ValueError, 'protected'):
            enforce_repair_scope(self.repo, protected, {'src/example.test.ts'})

    def test_interrupted_repair_untracked_file_is_removed(self):
        (self.repo / 'src/unfinished.ts').write_text('must not leak into next publication')
        merge_verified_delta(self.repo, self.base, self.base, self.base)
        self.assertFalse((self.repo / 'src/unfinished.ts').exists())


class PublicationIntegrationTests(VerifiedSourceTests):
    def test_real_merge_push_and_release_acknowledgement(self):
        upstream = self.repo
        public_base = self.commit_file('distribution/release.json', json.dumps({'upstreamVersion': '1.0.0', 'upstreamCommit': self.base}))
        remote = Path(self.temp.name) / 'remote.git'
        subprocess.run(['git', 'clone', '--bare', str(upstream), str(remote)], check=True, capture_output=True)
        home = Path(self.temp.name) / 'publisher'; home.mkdir()
        repo = home / 'checkout'
        subprocess.run(['git', 'clone', str(remote), str(repo)], check=True, capture_output=True)
        git(repo, 'config', 'user.name', 'Fixture'); git(repo, 'config', 'user.email', 'fixture@example.invalid')
        newer = self.commit_file('src/new-feature.ts', 'upstream feature\n')
        job = Path(self.temp.name) / 'personal/jobs/new'; job.mkdir(parents=True)
        subprocess.run(['git', 'clone', str(upstream), str(job / 'source')], check=True, capture_output=True)
        feature = job / 'feature.patch'; feature.write_text('')
        event = {'commit': newer, 'patchHash': digest(feature), 'version': '1.0.1', 'job': str(job)}
        identity = publisher.event_id(event)
        publisher.write(home / 'queue' / (identity + '.json'), event)
        publisher.write(home / 'baseline.json', {'snapshot': public_base, 'eventId': 'older'})
        publisher.write(home / 'checkout-owner.json', {'path': str(repo.resolve()), 'repository': str(remote)})
        config = {'personalHome': str(job.parent.parent)}
        with patch.object(publisher, 'REMOTE', str(remote)), patch.object(publisher, 'check_identity'), \
             patch.object(publisher, 'repair_and_validate') as validation, \
             patch.object(publisher, 'confirmed_release', return_value=False):
            result = publisher.tick(config, home)
        self.assertEqual(result['status'], 'pushed', result)
        validation.assert_called_once()
        pushed = git(repo, 'rev-parse', 'HEAD')
        self.assertEqual(git(remote, 'rev-parse', 'main'), pushed)
        self.assertEqual(git(repo, 'show', pushed + ':src/new-feature.ts'), 'upstream feature')
        self.assertEqual(publisher.read(home / 'baseline.json')['eventId'], 'older')
        with patch.object(publisher, 'REMOTE', str(remote)), patch.object(publisher, 'check_identity'), \
             patch.object(publisher, 'repair_and_validate') as validation, \
             patch.object(publisher, 'confirmed_release', return_value=True):
            result = publisher.tick(config, home)
        self.assertEqual(result['status'], 'published', result)
        validation.assert_not_called()
        self.assertEqual(git(remote, 'rev-parse', 'main'), pushed)
        self.assertEqual(publisher.read(home / 'baseline.json')['eventId'], identity)
