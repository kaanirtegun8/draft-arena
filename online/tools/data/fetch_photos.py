#!/usr/bin/env python3
"""Player portraits: EA's ratings-site portrait (avatarUrl) resized to a 160x160 WebP.

Usage: python3 -I fetch_photos.py <selected.json> <img_dir> <photos.js> [fotmob.json]

Writes <img_dir>/<EA id>.webp for every selected player that does not have one yet
(the raw PNGs are not kept), then rewrites <photos.js> with the ids of all portraits
present for the pool. EA has no portrait for some players (HTTP 403); with fotmob.json
(fetch_fotmob.py output) those get FotMob's player photo instead
(images.fotmob.com/image_resources/playerimages/<fotmob id>.png, the same kind of
cut-out headshot). FotMob's generic silhouette is recognised (the same image for many
players) and dropped. Needs Pillow. ~0.3 s per new photo.
"""
import collections, hashlib, io, json, os, sys, time, urllib.request
from PIL import Image

UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
SIZE = 160
SLEEP = 0.25


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'image/png,image/*'})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read()


FOTMOB_IMG = 'https://images.fotmob.com/image_resources/playerimages/{}.png'


def save(raw, path):
    im = Image.open(io.BytesIO(raw)).convert('RGBA')
    im = im.resize((SIZE, SIZE), Image.LANCZOS)
    im.save(path, 'WEBP', quality=72, method=6)


def fotmob_fallback(sel, img_dir, fm):
    """FotMob photos for players still without a portrait; drops FotMob's placeholder."""
    got, digests = {}, collections.Counter()
    for p in sel:
        path = os.path.join(img_dir, f"{p['id']}.webp")
        fid = (fm.get(str(p['id'])) or {}).get('fotmobId')
        if os.path.exists(path) or not fid:
            continue
        try:
            raw = fetch(FOTMOB_IMG.format(fid))
            save(raw, path)
            d = hashlib.md5(raw).hexdigest()
            got[path] = d
            digests[d] += 1
        except Exception as e:
            print('ERR fotmob', p['id'], fid, e, file=sys.stderr)
        time.sleep(SLEEP)
    placeholder = {d for d, n in digests.items() if n >= 3}
    for path, d in got.items():
        if d in placeholder:
            os.remove(path)
    print(f'fotmob fallback: {len(got) - sum(digests[d] for d in placeholder)} photos, {sum(digests[d] for d in placeholder)} placeholders dropped', file=sys.stderr)


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
            save(fetch(p['avatarUrl']), path)
            new += 1
        except Exception as e:  # missing portrait or network error: the app shows initials
            failed += 1
            print('ERR', p['id'], e, file=sys.stderr)
        time.sleep(SLEEP)
        if (i + 1) % 200 == 0:
            print(f'{i + 1}/{len(sel)} new {new} failed {failed}', file=sys.stderr)
    if len(sys.argv) > 4:
        fotmob_fallback(sel, img_dir, json.load(open(sys.argv[4], encoding='utf8')))
    ids = sorted(str(p['id']) for p in sel if os.path.exists(os.path.join(img_dir, f"{p['id']}.webp")))
    with open(out_js, 'w', encoding='utf8') as f:
        f.write('// Player ids that have a portrait in img/p/<id>.webp (EA FC ratings site; FotMob where EA has none).\n')
        f.write('export const PHOTO_IDS = new Set(' + json.dumps(ids) + ');\n')
    print(f'done: new {new}, failed {failed}, photos for {len(ids)}/{len(sel)} players', file=sys.stderr)


if __name__ == '__main__':
    main()
