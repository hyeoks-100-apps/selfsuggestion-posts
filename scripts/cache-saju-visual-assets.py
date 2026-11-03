#!/usr/bin/env python3
"""Cache explicitly selected web references as same-origin editor photo assets.

The observed image URL and source credit remain in the manifest. Files are saved
byte for byte: this script never crops, redraws, recompresses, or edits a photo.
"""
import concurrent.futures
import hashlib
import json
import re
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'sajupinggye'
DIRECTORY = BASE / 'assets' / 'references'
MANIFEST = BASE / 'visual-assets.json'
MAX_BYTES = 20 * 1024 * 1024
WORKERS = 6
USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'


def image_type(data):
    if data.startswith(b'\xff\xd8\xff'):
        return 'jpg', 'image/jpeg'
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'png', 'image/png'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'webp', 'image/webp'
    raise ValueError('Only JPEG, PNG and WebP image bytes are allowed')


def verify_url(value):
    u = urlsplit(value)
    if u.scheme != 'https' or not u.hostname or u.username or u.password:
        raise ValueError('Expected a public HTTPS image URL')


def asset(ref, previous):
    rid = ref['id']
    if not re.fullmatch(r'[a-z][a-z0-9-]{1,79}', rid):
        raise ValueError('Invalid reference ID')
    verify_url(ref['imageUrl'])
    old = previous.get(rid)
    data = None
    response_type = old.get('responseType', old.get('type')) if old else None
    if old and old.get('imageUrl') == ref['imageUrl'] and re.fullmatch(r'assets/references/[a-z0-9-]+\.(jpg|png|webp)', old.get('path', '')):
        saved = BASE / old['path']
        if saved.is_file():
            candidate = saved.read_bytes()
            if 0 < len(candidate) <= MAX_BYTES and hashlib.sha256(candidate).hexdigest() == old.get('sha256'):
                image_type(candidate)
                data = candidate
    if data is None:
        request = Request(ref['imageUrl'], headers={'User-Agent': USER_AGENT, 'Accept': 'image/jpeg,image/png,image/webp,*/*;q=0.5'})
        with urlopen(request, timeout=35) as response:
            verify_url(response.geturl())
            mime = response.headers.get_content_type().lower()
            response_type = mime
            if mime not in ('image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/octet-stream', 'binary/octet-stream'):
                raise ValueError('Rejected response content type: ' + mime)
            length = response.headers.get('Content-Length')
            if length and int(length) > MAX_BYTES:
                raise ValueError('Image exceeds 20 MB')
            data = response.read(MAX_BYTES + 1)
            if not data or len(data) > MAX_BYTES:
                raise ValueError('Empty image or image exceeds 20 MB')
            # Some CDNs mislabel a JPEG as WebP. Both the header and byte format
            # must be on the safe raster allowlist; bytes decide the local type.
            image_type(data)
    extension, mime = image_type(data)
    path = DIRECTORY / f'{rid}.{extension}'
    if not path.is_file() or path.read_bytes() != data:
        temporary = path.with_suffix(path.suffix + '.tmp')
        temporary.write_bytes(data)
        temporary.replace(path)
    return {'path': path.relative_to(BASE).as_posix(), 'type': mime,
            'responseType': response_type, 'mimeMismatch': response_type is not None and response_type.replace('image/jpg', 'image/jpeg') != mime,
            'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
            'imageUrl': ref['imageUrl'], 'sourceUrl': ref['sourceUrl'],
            'title': ref['title'], 'creator': ref['creator'], 'checkedAt': ref['checkedAt']}


def main():
    source = json.loads((BASE / 'visual-references.json').read_text())
    previous = json.loads(MANIFEST.read_text()).get('assets', {}) if MANIFEST.is_file() else {}
    DIRECTORY.mkdir(parents=True, exist_ok=True)
    assets, errors = {}, []
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as executor:
        jobs = {executor.submit(asset, ref, previous): ref for ref in source['references']}
        for future in concurrent.futures.as_completed(jobs):
            ref = jobs[future]
            try:
                result = future.result()
                assets[ref['id']] = result
                print(f"OK {ref['id']} {result['bytes']:,} bytes", flush=True)
            except (HTTPError, URLError, OSError, ValueError) as error:
                errors.append({'id': ref['id'], 'imageUrl': ref['imageUrl'], 'sourceUrl': ref['sourceUrl'], 'error': str(error)})
                print(f"FAILED {ref['id']}: {error}", flush=True)
    order = {ref['id']: index for index, ref in enumerate(source['references'])}
    output = {'version': 1, 'checkedAt': source['checkedAt'], 'maxBytesPerImage': MAX_BYTES,
              'assets': dict(sorted(assets.items(), key=lambda pair: order[pair[0]])),
              'errors': sorted(errors, key=lambda item: order[item['id']])}
    MANIFEST.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
    total = sum(value['bytes'] for value in assets.values())
    print(f"Saved {len(assets)}/{len(source['references'])} editor images, {total:,} bytes; {len(errors)} failed")
    return bool(errors)


if __name__ == '__main__':
    sys.exit(main())
