#!/usr/bin/env python3
"""Match selected players to FotMob and pull 2026/27 season form (+ height).

Usage: python3 -I fetch_fotmob.py <selected.json> <cache_dir> <out_fotmob.json>

Endpoints (public JSON used by fotmob.com):
  search : https://www.fotmob.com/api/data/search/suggest?term=<name>&hits=20&lang=en
  player : https://www.fotmob.com/api/data/playerData?id=<fotmob id>
A FotMob candidate is accepted ONLY if its birth date equals the EA birth date exactly;
otherwise the player gets no form data. Responses are cached in <cache_dir>.
"""
import json, os, re, sys, time, unicodedata, urllib.parse, urllib.request

UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
SEASON_START = '2026-07-20'   # day after the 2026 World Cup final; 2026/27 club season starts after this
SLEEP = 0.8
# Extra search terms for players FotMob lists under a different name (results are still birth-date verified)
EXTRA_TERMS = {'Vini Jr.': ['Vinicius Junior'], 'André-Franck Zambo Anguissa': ['Frank Anguissa', 'Anguissa'],
               'Anderson Talisca': ['Talisca'], 'Pedro Gonçalves': ['Pedro Goncalves', 'Pote']}


def get_json(url, path):
    if os.path.exists(path):
        with open(path, encoding='utf8') as f:
            return json.load(f)
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            data = json.loads(r.read().decode('utf8'))
    except Exception as e:  # network/HTTP error: don't cache
        print('ERR', url, e, file=sys.stderr)
        time.sleep(SLEEP)
        return None
    with open(path, 'w', encoding='utf8') as f:
        json.dump(data, f, ensure_ascii=False)
    time.sleep(SLEEP)
    return data


def fold(s):
    return ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c))


def ea_birth(p):
    m, d, y = p['birthdate'].split(' ')[0].split('/')
    return f'{int(y):04d}-{int(m):02d}-{int(d):02d}'


def search(term, cache):
    key = re.sub(r'[^a-z0-9]+', '_', fold(term).lower())
    data = get_json('https://www.fotmob.com/api/data/search/suggest?' + urllib.parse.urlencode({'term': term, 'hits': 20, 'lang': 'en'}),
                    os.path.join(cache, f'search_{key}.json'))
    out = []
    for grp in data or []:
        for s in grp.get('suggestions', []):
            if s.get('type') == 'player' and not s.get('isCoach'):
                out.append(s)
    return out


def player(fid, cache):
    return get_json(f'https://www.fotmob.com/api/data/playerData?id={fid}', os.path.join(cache, f'player_{fid}.json'))


def form_of(pd):
    ms = []
    for m in pd.get('recentMatches') or []:
        date = ((m.get('matchDate') or {}).get('utcTime') or '')[:10]
        if date < SEASON_START or 'friendl' in (m.get('leagueName') or '').lower() and 'club' in (m.get('leagueName') or '').lower():
            continue
        if not m.get('playedInMatch') or m.get('onBench') and not m.get('minutesPlayed'):
            continue
        try:
            r = float((m.get('ratingProps') or {}).get('rating') or 0)
        except ValueError:
            r = 0
        ms.append((date, r, int(m.get('minutesPlayed') or 0), int(m.get('goals') or 0), int(m.get('assists') or 0)))
    ms.sort()
    if not ms:
        return None
    rated = [x[1] for x in ms if x[1] > 0]
    return {
        'rating': round(sum(rated) / len(rated), 2) if rated else None,
        'apps': len(ms),
        'last': [round(x[1], 1) for x in ms if x[1] > 0][-5:],
        'minutes': sum(x[2] for x in ms),
        'goals': sum(x[3] for x in ms),
        'assists': sum(x[4] for x in ms),
        'lastMatch': ms[-1][0],
    }


def info(pd, title):
    for it in pd.get('playerInformation') or []:
        if it.get('title') == title:
            return it.get('value') or {}
    return {}


def main():
    sel = json.load(open(sys.argv[1], encoding='utf8'))
    cache, outp = sys.argv[2], sys.argv[3]
    os.makedirs(cache, exist_ok=True)
    out = json.load(open(outp, encoding='utf8')) if os.path.exists(outp) else {}
    for i, p in enumerate(sel):
        k = str(p['id'])
        if k in out and out[k].get('fotmobId'):
            continue
        bd = ea_birth(p)
        full = f"{p['firstName']} {p['lastName']}".strip()
        terms = []
        for t in [p['commonName'], full, p['lastName'], fold(full) if fold(full) != full else None, p['commonName'] and fold(p['commonName'])] + EXTRA_TERMS.get(p['commonName'] or full, []):
            if t and t not in terms:
                terms.append(t)
        found = None
        tried = set()
        for t in terms:
            for s in search(t, cache)[:5]:
                if s['id'] in tried:
                    continue
                tried.add(s['id'])
                pd = player(s['id'], cache)
                if pd and ((pd.get('birthDate') or {}).get('utcTime') or '')[:10] == bd:
                    found = pd
                    break
            if found:
                break
        if not found:
            out[k] = {'fotmobId': None}
            print(f'[{i+1}/{len(sel)}] NO MATCH', p['commonName'] or full, bd, file=sys.stderr)
            continue
        h = info(found, 'Height').get('numberValue')
        foot = (info(found, 'Preferred foot').get('key') or '')
        out[k] = {'fotmobId': int(found['id']), 'fotmobName': found.get('name'),
                  'team': (found.get('primaryTeam') or {}).get('teamName'),
                  'height': int(h) if isinstance(h, (int, float)) else None, 'foot': foot or None,
                  'form': form_of(found)}
        print(f'[{i+1}/{len(sel)}]', p['commonName'] or full, '->', found.get('name'), out[k]['team'], (out[k]['form'] or {}).get('rating'), file=sys.stderr)
        if i % 20 == 0:
            json.dump(out, open(outp, 'w', encoding='utf8'), ensure_ascii=False)
    json.dump(out, open(outp, 'w', encoding='utf8'), ensure_ascii=False)


if __name__ == '__main__':
    main()
