"""Durable handoff after installation; publishing never runs under the installer lock."""
from datetime import datetime, timezone
import hashlib
from pathlib import Path
from update_policy import atomic_json, sha256


def enqueue_publication(config, pending):
    target = config.get('publisherHome')
    if not target:
        return None
    home = Path(target)
    if not (home / 'baseline.json').is_file():
        raise ValueError('Publisher has not been initialized')
    if sha256(Path(pending['job']) / 'feature.patch') != pending['patchHash']:
        raise ValueError('Verified publication patch changed')
    identity = hashlib.sha256((pending['commit'] + ':' + pending['patchHash']).encode()).hexdigest()
    path = home / 'queue' / (identity + '.json')
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_json(path, {key: pending[key] for key in ('commit', 'patchHash', 'version', 'job')} |
                    {'installedAt': datetime.now(timezone.utc).isoformat(), 'candidateHash': pending['candidateHash']})
    return identity
