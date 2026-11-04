#!/usr/bin/env python3
"""Fetch EA SPORTS FC player ratings from EA's official ratings site.

EA's ratings pages (https://www.ea.com/games/ea-sports-fc/ratings) are a Next.js app that
embeds the current page of results as JSON in <script id="__NEXT_DATA__">. Each item
carries face stats, all detailed attributes, weak foot, skill moves, preferred foot,
positions, club, league, nationality and birth date. (Height and work rates are present
as empty strings / absent, so they are not available from this source.)

Usage (run Python isolated, the downloaded HTML is untrusted data and is only parsed):
    python3 -I fetch_ea.py <cache_dir> <out_pool.json> [min_ovr]

Always fetched: the top pages per position, every Trendyol Süper Lig page and every page
of Turkish-nationality players. With min_ovr (e.g. 74) the overall list (sorted by OVR)
is also walked down to that rating, so every player at or above it is in the pool.

Pages are cached in <cache_dir>; delete the cache to refresh.
"""
import json, os, re, sys, time, urllib.request

UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
BASE = 'https://www.ea.com/games/ea-sports-fc/ratings'
# EA position filter ids (from pageProps.ratingsFilters.positions)
POSITIONS = {'GK': 0, 'CB': 5, 'RB': 3, 'LB': 7, 'CDM': 10, 'CM': 14, 'CAM': 18,
             'RM': 12, 'LM': 16, 'RW': 23, 'LW': 27, 'ST': 25}
PAGES_PER_POS = 2          # 100 players per page, men only (gender=0), sorted by OVR
SUPER_LIG = BASE + '/leagues-ratings/trendyol-super-lig/68'
TURKEY_NAT_ID = 48


def fetch(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 10000:
        return open(path, encoding='utf8').read()
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9'})
    with urllib.request.urlopen(req, timeout=60) as r:
        html = r.read().decode('utf8')
    with open(path, 'w', encoding='utf8') as f:
        f.write(html)
    time.sleep(1.0)
    return html


def items_of(html):
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        return [], 0
    pp = json.loads(m.group(1)).get('props', {}).get('pageProps', {})

    def find(o):
        if isinstance(o, dict):
            if isinstance(o.get('items'), list) and o['items'] and isinstance(o['items'][0], dict) and 'overallRating' in o['items'][0]:
                return o
            for v in o.values():
                r = find(v)
                if r:
                    return r
        elif isinstance(o, list):
            for v in o:
                r = find(v)
                if r:
                    return r
        return None
    rd = find(pp) or {}
    return rd.get('items', []), rd.get('totalItems', 0)


def main():
    cache, out = sys.argv[1], sys.argv[2]
    min_ovr = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    os.makedirs(cache, exist_ok=True)
    pool = {}

    def take(key, url):
        html = fetch(url, os.path.join(cache, key + '.html'))
        its, total = items_of(html)
        print(f'{key}: {len(its)} items (total {total})', file=sys.stderr)
        for it in its:
            if (it.get('gender') or {}).get('id') != 0:
                continue
            pool[it['id']] = it
        return its, total

    for pos, pid in POSITIONS.items():
        for page in range(1, PAGES_PER_POS + 1):
            take(f'pos_{pos}_{page}', f'{BASE}?gender=0&position={pid}&page={page}')
    # every page of a list (100 per page) until it runs out
    def all_pages(prefix, url_of, max_pages=40):
        for page in range(1, max_pages + 1):
            its, total = take(f'{prefix}_{page}', url_of(page))
            if not its or page * 100 >= (total or 0):
                break
    all_pages('superlig', lambda n: f'{SUPER_LIG}?page={n}')
    all_pages('nat_tur', lambda n: f'{BASE}?gender=0&nationality={TURKEY_NAT_ID}&page={n}')
    if min_ovr:
        for page in range(1, 200):
            its, _ = take(f'all_{page}', f'{BASE}?gender=0&page={page}')
            if not its or its[-1]['overallRating'] < min_ovr:
                break
    with open(out, 'w', encoding='utf8') as f:
        json.dump(list(pool.values()), f, ensure_ascii=False)
    print(f'{len(pool)} unique men players -> {out}', file=sys.stderr)


if __name__ == '__main__':
    main()
