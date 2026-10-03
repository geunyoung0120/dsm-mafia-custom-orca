import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import tarfile
import tempfile
from urllib.parse import urlparse

REPOSITORY = 'geunyoung0120/gy-custom-orca'


def version(value):
    if not isinstance(value,str) or not re.fullmatch(r'\d+\.\d+\.\d+',value):
        raise ValueError('Expected a stable numeric version')
    return tuple(map(int,value.split('.')))


def read_json(path, default=None):
    return json.loads(Path(path).read_text(encoding='utf-8')) if Path(path).exists() else default


def atomic_json(path, value):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    descriptor, temporary=tempfile.mkstemp(prefix='.'+path.name,dir=path.parent)
    try:
        with os.fdopen(descriptor,'w',encoding='utf-8') as handle:
            json.dump(value,handle,ensure_ascii=False,indent=2); handle.flush(); os.fsync(handle.fileno())
        os.replace(temporary,path)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)


def sha256(path):
    with Path(path).open('rb') as handle:
        return hashlib.file_digest(handle,'sha256').hexdigest()


def validate_asset_url(url, release_version):
    version(release_version)
    parsed=urlparse(url)
    prefix=f'/{REPOSITORY}/releases/download/v{release_version}/'
    if (parsed.scheme!='https' or parsed.netloc!='github.com' or not parsed.path.startswith(prefix)
            or parsed.query or parsed.fragment or '/' in parsed.path[len(prefix):]
            or not re.fullmatch(r'[A-Za-z0-9_.-]+',parsed.path[len(prefix):])):
        raise ValueError('Asset URL does not belong to this release')


def relative_path(name):
    p=PurePosixPath(name)
    if not name or not p.parts or p.is_absolute() or '..' in p.parts or '\\' in name or ':' in name or '\x00' in name:
        raise ValueError('Unsafe relative path')
    return p


def extract_payload(archive, destination):
    destination=Path(destination); destination.mkdir(parents=True,exist_ok=True)
    with tarfile.open(archive,'r:gz') as stream:
        members=stream.getmembers(); seen=set(); total=0
        if len(members)>100_000: raise ValueError('Too many archive members')
        for entry in members:
            relative_path(entry.name)
            key=entry.name.casefold().rstrip('/')
            if key in seen: raise ValueError('Duplicate archive member')
            seen.add(key); total+=entry.size
            if total>8*1024**3: raise ValueError('Archive exceeds size limit')
            if not (entry.isfile() or entry.isdir() or entry.issym()):
                raise ValueError('Unsupported archive member')
            if entry.issym():
                if '\\' in entry.linkname or ':' in entry.linkname or Path(entry.linkname).is_absolute():
                    raise ValueError('Unsafe archive link')
                target=(destination/entry.name).parent/entry.linkname
                if not target.resolve().is_relative_to(destination.resolve()):
                    raise ValueError('Archive symlink escapes extraction directory')
        stream.extractall(destination,members=members,filter='data')


def inventory(root):
    root=Path(root); result={}
    for path in sorted(root.rglob('*')):
        key=path.relative_to(root).as_posix()
        if path.is_symlink(): result[key]={'link':os.readlink(path)}
        elif path.is_file(): result[key]={'sha256':sha256(path),'size':path.stat().st_size}
    return result


def verify_inventory(root, expected):
    if not expected or inventory(root)!=expected:
        raise ValueError('Application file integrity check failed')
