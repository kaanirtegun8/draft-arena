#!/usr/bin/env python3
"""Look up current Transfermarkt market values for the selected players.

Usage: python3 -I fetch_tm.py <selected.json> <cache_dir> <out_tm.json>

1. Quick search page  https://www.transfermarkt.com/schnellsuche/ergebnis/schnellsuche?query=<name>
   -> rows with player id, club, age, nationalities, market value.
   A row is accepted only if its age is within 1 year of the EA-derived age AND one of
   its nationalities equals the EA nationality; if several rows qualify, the one whose
   club name best matches EA's club wins, otherwise the player is left without a value.
2. Market value history  https://www.transfermarkt.com/ceapi/marketValueDevelopment/graph/<id>
   -> last entry gives the current value (EUR) and the date it was set (datum_mw).
Responses are cached in <cache_dir>; ~1 request/second.
"""
import html as htmlmod, json, os, re, sys, time, unicodedata, urllib.parse, urllib.request
from datetime import date

UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
AS_OF = date(2026, 10, 29)
SLEEP = 1.0
# EA nationality label -> Transfermarkt nationality label (where they differ)
NAT = {'Holland': 'Netherlands', 'Korea Republic': 'Korea, South', "Côte d'Ivoire": "Cote d'Ivoire",
       'Turkey': 'Türkiye', 'United States': 'United States', 'Czech Republic': 'Czech Republic',
       'Republic of Ireland': 'Ireland', 'China PR': 'China', 'Cape Verde Islands': 'Cape Verde',
       'Bosnia and Herzegovina': 'Bosnia-Herzegovina', 'DR Congo': 'DR Congo', 'Congo DR': 'DR Congo'}


def fetch(url, path, accept='text/html'):
    if os.path.exists(path):
        return open(path, encoding='utf8').read()
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': accept, 'Accept-Language': 'en-US,en;q=0.9'})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            status = r.status
            body = r.read().decode('utf8', 'replace')
    except Exception as e:
        print('ERR', url, e, file=sys.stderr)
        time.sleep(SLEEP * 3)
        return None
    time.sleep(SLEEP)
    if status != 200:
        print('HTTP', status, url, file=sys.stderr)
        return None
    with open(path, 'w', encoding='utf8') as f:
        f.write(body)
    return body


def fold(s):
    return ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c)).lower()


def ea_age(p):
    m, d, y = map(int, p['birthdate'].split(' ')[0].split('/'))
    return AS_OF.year - y - ((AS_OF.month, AS_OF.day) < (m, d))


def parse_value(s):
    s = s.strip().replace('€', '')
    m = re.match(r'([\d.]+)\s*(bn|m|k)', s, re.I)
    if not m:
        return None
    mult = {'bn': 1e9, 'm': 1e6, 'k': 1e3}[m.group(2).lower()]
    return int(round(float(m.group(1)) * mult))


def parse_search(h):
    i = h.find('Search results for players')
    if i < 0:
        return []
    seg = h[i:]
    end = seg.find('</table> <div class="keys"')
    end = seg.find('<div class="keys"') if end < 0 else end
    seg = seg[:end] if end > 0 else seg
    rows = []
    for tr in re.findall(r'<tr class="(?:odd|even)">(.*?)</td></tr>\s*(?=<tr class="(?:odd|even)">|</tbody>)', seg, re.S):
        mid = re.search(r'/profil/spieler/(\d+)', tr)
        name = re.search(r'class="hauptlink"><a title="([^"]+)"', tr)
        club = re.search(r'<tr><td><a title="([^"]+)" href="/[^"]*/startseite/verein/', tr)
        tds = re.findall(r'<td class="zentriert">(.*?)</td>', tr, re.S)
        age = None
        for t in tds:
            if re.fullmatch(r'\s*\d{1,2}\s*', t):
                age = int(t)
        nats = re.findall(r'class="flaggenrahmen"', tr) and re.findall(r'<img src="[^"]*/flagge/[^"]*" title="([^"]+)"', tr)
        val = re.search(r'<td class="rechts hauptlink">([^<]*)</td>', tr)
        if mid:
            rows.append({'id': int(mid.group(1)), 'name': htmlmod.unescape(name.group(1)) if name else None,
                         'club': htmlmod.unescape(club.group(1)) if club else None, 'age': age,
                         'nats': [htmlmod.unescape(n) for n in (nats or [])],
                         'value': parse_value(val.group(1)) if val else None})
    return rows


def club_score(a, b):
    a, b = set(re.findall(r'[a-z]{3,}', fold(a or ''))), set(re.findall(r'[a-z]{3,}', fold(b or '')))
    return len(a & b)


def main():
    sel = json.load(open(sys.argv[1], encoding='utf8'))
    cache, outp = sys.argv[2], sys.argv[3]
    os.makedirs(cache, exist_ok=True)
    out = json.load(open(outp, encoding='utf8')) if os.path.exists(outp) else {}
    for i, p in enumerate(sel):
        k = str(p['id'])
        if k in out and out[k].get('tmId') and out[k].get('date'):
            continue
        if k in out and out[k].get('tmId'):  # matched earlier but history request failed: retry only that
            rec = out[k]
            g = fetch(f"https://www.transfermarkt.com/ceapi/marketValueDevelopment/graph/{rec['tmId']}",
                      os.path.join(cache, f"mv_{rec['tmId']}.json"), accept='application/json')
            try:
                lst = json.loads(g)['list'] if g else []
            except ValueError:
                lst = []
            if lst:
                dd, mm, yy = lst[-1]['datum_mw'].split('/')
                rec.update(value=int(lst[-1]['y']), date=f'{yy}-{mm}-{dd}')
            continue
        full = f"{p['firstName']} {p['lastName']}".strip()
        age, nat = ea_age(p), NAT.get(p['nationality']['label'], p['nationality']['label'])
        terms = []
        for t in [p['commonName'], full, fold(p['commonName'] or full), p['lastName']]:
            if t and t not in terms:
                terms.append(t)
        pick = None
        for t in terms:
            key = re.sub(r'[^a-z0-9]+', '_', fold(t))
            h = fetch('https://www.transfermarkt.com/schnellsuche/ergebnis/schnellsuche?' + urllib.parse.urlencode({'query': t}),
                      os.path.join(cache, f'search_{key}.html'))
            if not h:
                continue
            ok = [r for r in parse_search(h) if r['age'] is not None and abs(r['age'] - age) <= 1 and nat in r['nats']]
            if len(ok) > 1:
                ok.sort(key=lambda r: (-club_score(r['club'], p['team']['label']), -(r['value'] or 0)))
                if club_score(ok[0]['club'], p['team']['label']) == club_score(ok[1]['club'], p['team']['label']):
                    ok = [r for r in ok if r['age'] == age]
                    if len(ok) != 1:
                        ok = []
            if ok:
                pick = ok[0]
                break
        if not pick:
            out[k] = {'tmId': None}
            print(f'[{i+1}/{len(sel)}] NO MATCH', p['commonName'] or full, age, nat, file=sys.stderr)
            continue
        rec = {'tmId': pick['id'], 'tmName': pick['name'], 'tmClub': pick['club'], 'searchValue': pick['value']}
        g = fetch(f"https://www.transfermarkt.com/ceapi/marketValueDevelopment/graph/{pick['id']}",
                  os.path.join(cache, f"mv_{pick['id']}.json"), accept='application/json')
        try:
            lst = json.loads(g)['list'] if g else []
        except ValueError:
            lst = []
        if lst:
            last = lst[-1]
            dd, mm, yy = last['datum_mw'].split('/')
            rec.update(value=int(last['y']), date=f'{yy}-{mm}-{dd}')
        else:
            rec.update(value=pick['value'], date=None)
        out[k] = rec
        print(f'[{i+1}/{len(sel)}]', p['commonName'] or full, '->', pick['name'], pick['club'], rec.get('value'), rec.get('date'), file=sys.stderr)
        if i % 20 == 0:
            json.dump(out, open(outp, 'w', encoding='utf8'), ensure_ascii=False)
    json.dump(out, open(outp, 'w', encoding='utf8'), ensure_ascii=False)


if __name__ == '__main__':
    main()
