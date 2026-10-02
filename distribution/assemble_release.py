"""Publish metadata only when every native build is present and matches its checksum."""
import argparse
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).parent/'updater'))
from policy import REPOSITORY, atomic_json, read_json, sha256, validate_asset_url, version


def assemble(directory, release_version):
    version(release_version)
    config=read_json(Path(__file__).with_name('release.json'))
    platforms={}; checksums=[]
    for platform in config['platforms']:
        entry=read_json(directory/(platform+'.json'))
        if not entry or entry['platform']!=platform or entry['version']!=release_version:
            raise ValueError('Missing or mismatched native build: '+platform)
        expected=f'Orca-Custom-{release_version}-{platform}.zip'
        if entry['name']!=expected: raise ValueError('Unexpected artifact name')
        validate_asset_url(entry['url'],release_version)
        archive=directory/expected
        if sha256(archive)!=entry['sha256'] or archive.stat().st_size!=entry['size']:
            raise ValueError('Artifact checksum or size mismatch')
        platforms[platform]={key:entry[key] for key in ('name','url','size','sha256')}
        checksums.append(entry['sha256']+'  '+expected)
    atomic_json(directory/'release.json',{'schema':1,'repository':REPOSITORY,'version':release_version,
        'upstreamVersion':config['upstreamVersion'],'platforms':platforms})
    (directory/'SHA256SUMS.txt').write_text('\n'.join(checksums)+'\n',encoding='utf-8')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory',type=Path); parser.add_argument('--version',required=True)
    args=parser.parse_args(); assemble(args.directory,args.version)
