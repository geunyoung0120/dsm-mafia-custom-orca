import json
from pathlib import Path
import ssl
import re
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import certifi
from policy import REPOSITORY, atomic_json, read_json, sha256, validate_asset_url, version

TLS=ssl.create_default_context(cafile=certifi.where())


def request(url, headers=None):
    return urlopen(Request(url,headers={'User-Agent':'Orca-Custom-Updater','Accept':'application/vnd.github+json',**(headers or {})}),context=TLS,timeout=45)


def latest(state):
    cache=read_json(Path(state)/'release-cache.json',{})
    headers={'If-None-Match':cache['etag']} if cache.get('etag') else {}
    try:
        with request(f'https://api.github.com/repos/{REPOSITORY}/releases/latest',headers) as response:
            release=json.load(response)
            atomic_json(Path(state)/'release-cache.json',{'etag':response.headers.get('ETag'),'release':release})
            return release
    except HTTPError as error:
        if error.code==304: return cache['release']
        if error.code==404: return None
        raise


def download(url, destination, release_version, digest=None, size=None, limit=3*1024**3):
    validate_asset_url(url,release_version)
    destination=Path(destination); destination.parent.mkdir(parents=True,exist_ok=True)
    temporary=destination.with_suffix(destination.suffix+'.part')
    try:
        count=0
        with request(url,{'Accept':'application/octet-stream'}) as response, temporary.open('wb') as output:
            if not response.url.startswith('https://'): raise ValueError('Insecure download redirect')
            while block:=response.read(1024*1024):
                count+=len(block)
                if count>limit: raise ValueError('Download exceeds size limit')
                output.write(block)
        if size is not None and count!=size: raise ValueError('Download size mismatch')
        if digest is not None and sha256(temporary)!=digest: raise ValueError('Download checksum mismatch')
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def release_manifest(state, release):
    value=release['tag_name'].removeprefix('v'); version(value)
    if release.get('draft') or release.get('prerelease'): raise ValueError('Only complete stable releases are installable')
    assets=[a for a in release.get('assets',[]) if a['name']=='release.json']
    if len(assets)!=1: raise ValueError('Release manifest is missing')
    path=Path(state)/'downloads'/value/'release.json'
    digest=assets[0].get('digest','')
    download(assets[0]['browser_download_url'],path,value,digest.removeprefix('sha256:') if digest.startswith('sha256:') else None,
             assets[0]['size'],limit=1024*1024)
    manifest=read_json(path)
    if manifest.get('schema')!=1 or manifest.get('repository')!=REPOSITORY or manifest.get('version')!=value:
        raise ValueError('Release manifest identity mismatch')
    expected={'darwin-arm64','darwin-x64','win32-x64','linux-x64'}
    if set(manifest.get('platforms',{}))!=expected: raise ValueError('Incomplete release')
    for platform,entry in manifest['platforms'].items():
        name=f'Orca-Custom-{value}-{platform}.zip'
        if entry.get('name')!=name or not re.fullmatch('[0-9a-f]{64}',entry.get('sha256','')):
            raise ValueError('Invalid artifact identity or checksum')
        if type(entry.get('size')) is not int or not 0<entry['size']<=3*1024**3:
            raise ValueError('Invalid artifact size')
        validate_asset_url(entry['url'],value)
        matching=[asset for asset in release['assets'] if asset['name']==name]
        if (len(matching)!=1 or matching[0]['browser_download_url']!=entry['url']
                or matching[0]['size']!=entry['size']):
            raise ValueError('Manifest does not match published assets')
        digest=matching[0].get('digest')
        if digest and digest!='sha256:'+entry['sha256']: raise ValueError('GitHub artifact checksum differs')
    return manifest
