#!/usr/bin/env python3
"""Player portraits: EA's ratings-site portrait (avatarUrl) resized to a 160x160 WebP.

Usage: python3 -I fetch_photos.py <selected.json> <img_dir> <photos.js>

Writes <img_dir>/<EA id>.webp for every selected player that does not have one yet
(the raw 512px PNGs are not kept), then rewrites <photos.js> with the ids of all
portraits present for the pool. Needs Pillow. ~0.3 s per new photo.
"""
import io, json, os, sys, time, urllib.request
from PIL import Image

UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
SIZE = 160
SLEEP = 0.25


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'image/png,image/*'})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read()


def main():
    sel = json.load(open(sys.argv[1], encoding='utf8'))
    img_dir, out_js = sys.argv[2], sys.argv[3]
    os.makedirs(img_dir, exist_ok=True)
    new = failed = 0
    for i, p in enumerate(sel):
        path = os.path.join(img_dir, f"{p['id']}.webp")
        if os.path.exists(path) or not p.get('avatarUrl'):
            continue
        try:
            im = Image.open(io.BytesIO(fetch(p['avatarUrl']))).convert('RGBA')
            im = im.resize((SIZE, SIZE), Image.LANCZOS)
            im.save(path, 'WEBP', quality=72, method=6)
            new += 1
        except Exception as e:  # missing portrait or network error: the app shows initials
            failed += 1
            print('ERR', p['id'], e, file=sys.stderr)
        time.sleep(SLEEP)
        if (i + 1) % 200 == 0:
            print(f'{i + 1}/{len(sel)} new {new} failed {failed}', file=sys.stderr)
    ids = sorted(str(p['id']) for p in sel if os.path.exists(os.path.join(img_dir, f"{p['id']}.webp")))
    with open(out_js, 'w', encoding='utf8') as f:
        f.write('// Player ids that have a portrait in img/p/<id>.webp (resized from the EA FC ratings site).\n')
        f.write('export const PHOTO_IDS = new Set(' + json.dumps(ids) + ');\n')
    print(f'done: new {new}, failed {failed}, photos for {len(ids)}/{len(sel)} players', file=sys.stderr)


if __name__ == '__main__':
    main()
