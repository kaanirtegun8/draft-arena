#!/usr/bin/env python3
"""Merge EA selection + FotMob + Transfermarkt into online/data/players.js.

Usage: python3 -I build_players.py <selected.json> <fotmob.json> <tm.json> <out players.js> [clubdiff.json]
"""
import json, sys, collections
from datetime import date

AS_OF = date(2026, 10, 29)
AS_OF_S = AS_OF.isoformat()

# EA nationality label -> FIFA trigram
FIFA = {
    'Albania': 'ALB', 'Algeria': 'ALG', 'Argentina': 'ARG', 'Australia': 'AUS', 'Austria': 'AUT', 'Belgium': 'BEL',
    'Bosnia and Herzegovina': 'BIH', 'Brazil': 'BRA', 'Burkina Faso': 'BFA', 'Cameroon': 'CMR', 'Canada': 'CAN',
    'Cape Verde Islands': 'CPV', 'Chile': 'CHI', 'China PR': 'CHN', 'Colombia': 'COL', 'Congo DR': 'COD', 'DR Congo': 'COD',
    'Costa Rica': 'CRC', 'Croatia': 'CRO', 'Czech Republic': 'CZE', 'Czechia': 'CZE', "Côte d'Ivoire": 'CIV',
    'Denmark': 'DEN', 'Ecuador': 'ECU', 'Egypt': 'EGY', 'England': 'ENG', 'Finland': 'FIN', 'France': 'FRA',
    'Gabon': 'GAB', 'Georgia': 'GEO', 'Germany': 'GER', 'Ghana': 'GHA', 'Greece': 'GRE', 'Guinea': 'GUI',
    'Holland': 'NED', 'Netherlands': 'NED', 'Hungary': 'HUN', 'Iceland': 'ISL', 'Iran': 'IRN', 'Israel': 'ISR',
    'Italy': 'ITA', 'Jamaica': 'JAM', 'Japan': 'JPN', 'Korea Republic': 'KOR', 'Kosovo': 'KVX', 'Mali': 'MLI',
    'Mexico': 'MEX', 'Montenegro': 'MNE', 'Morocco': 'MAR', 'Nigeria': 'NGA', 'North Macedonia': 'MKD',
    'Northern Ireland': 'NIR', 'Norway': 'NOR', 'Paraguay': 'PAR', 'Peru': 'PER', 'Poland': 'POL', 'Portugal': 'POR',
    'Republic of Ireland': 'IRL', 'Romania': 'ROU', 'Russia': 'RUS', 'Saudi Arabia': 'KSA', 'Scotland': 'SCO',
    'Senegal': 'SEN', 'Serbia': 'SRB', 'Slovakia': 'SVK', 'Slovenia': 'SVN', 'South Africa': 'RSA', 'Spain': 'ESP',
    'Sweden': 'SWE', 'Switzerland': 'SUI', 'Tunisia': 'TUN', 'Turkey': 'TUR', 'Türkiye': 'TUR', 'Ukraine': 'UKR',
    'United States': 'USA', 'Uruguay': 'URU', 'Uzbekistan': 'UZB', 'Venezuela': 'VEN', 'Wales': 'WAL',
    'Armenia': 'ARM', 'Azerbaijan': 'AZE', 'Benin': 'BEN', 'Bulgaria': 'BUL', 'Cyprus': 'CYP', 'Curaçao': 'CUW',
    'Gambia': 'GAM', 'Guinea-Bissau': 'GNB', 'Haiti': 'HAI', 'Iraq': 'IRQ', 'Jordan': 'JOR', 'Lithuania': 'LTU',
    'Luxembourg': 'LUX', 'Mozambique': 'MOZ', 'New Zealand': 'NZL', 'Panama': 'PAN', 'Qatar': 'QAT',
    'Suriname': 'SUR', 'Togo': 'TOG', 'Zambia': 'ZAM', 'Zimbabwe': 'ZIM', 'Angola': 'ANG', 'Belarus': 'BLR',
    'Estonia': 'EST', 'Latvia': 'LVA', 'Moldova': 'MDA', 'Faroe Islands': 'FRO', 'Honduras': 'HON', 'Bolivia': 'BOL',
}
# EA club labels -> common real names (EA uses unlicensed names for some Serie A clubs, short names elsewhere)
CLUB = {
    'Lombardia FC': 'Inter', 'Milano FC': 'AC Milan', 'Bergamo Calcio': 'Atalanta', 'Latium': 'SS Lazio',
    'Paris SG': 'Paris Saint-Germain', 'Man Utd': 'Manchester United', 'Spurs': 'Tottenham Hotspur',
    "Nott'm Forest": 'Nottingham Forest', 'Newcastle Utd': 'Newcastle United', 'OL': 'Olympique Lyonnais',
    'FC Bayern München': 'Bayern München', 'Atlético de Madrid': 'Atlético Madrid', 'Leverkusen': 'Bayer Leverkusen',
    'Frankfurt': 'Eintracht Frankfurt', 'West Ham': 'West Ham United', 'OM': 'Olympique de Marseille',
}
LEAGUE = {"Ligue 1 McDonald's": 'Ligue 1', 'LALIGA EA SPORTS': 'LaLiga', 'Serie A Enilive': 'Serie A',
          'ROSHN Saudi League': 'Saudi Pro League', 'LPF': 'Liga Profesional (ARG)', 'MLS': 'MLS',
          'Liga Portugal': 'Liga Portugal', 'Hellas Liga': 'Super League Greece', '1A Pro League': 'Belgian Pro League'}
CODES = {'GK', 'CB', 'RB', 'LB', 'RWB', 'LWB', 'CDM', 'CM', 'CAM', 'RM', 'LM', 'RW', 'LW', 'ST', 'CF'}
ATTR = [('acc', 'acceleration'), ('spr', 'sprintSpeed'), ('pos', 'positioning'), ('fin', 'finishing'), ('spw', 'shotPower'),
        ('lsh', 'longShots'), ('vol', 'volleys'), ('pen', 'penalties'), ('vis', 'vision'), ('cro', 'crossing'),
        ('fk', 'freeKickAccuracy'), ('spa', 'shortPassing'), ('lpa', 'longPassing'), ('cur', 'curve'), ('agi', 'agility'),
        ('bal', 'balance'), ('rea', 'reactions'), ('bco', 'ballControl'), ('dri', 'dribbling'), ('com', 'composure'),
        ('int', 'interceptions'), ('hea', 'headingAccuracy'), ('daw', 'defensiveAwareness'), ('stt', 'standingTackle'),
        ('slt', 'slidingTackle'), ('jmp', 'jumping'), ('sta', 'stamina'), ('str', 'strength'), ('agg', 'aggression'),
        ('gkdiv', 'gkDiving'), ('gkhan', 'gkHandling'), ('gkkic', 'gkKicking'), ('gkpos', 'gkPositioning'), ('gkref', 'gkReflexes')]
GROUP = {'GK': 'GK', 'CB': 'CB', 'RB': 'RB', 'RWB': 'RB', 'LB': 'LB', 'LWB': 'LB', 'CDM': 'CDM', 'CM': 'CM', 'CAM': 'CAM',
         'LM': 'LW', 'LW': 'LW', 'RM': 'RW', 'RW': 'RW', 'ST': 'ST', 'CF': 'ST'}


def js(v):
    return json.dumps(v, ensure_ascii=False)


def obj(d):
    return '{ ' + ', '.join(f'{k}: ' + (obj(v) if isinstance(v, dict) else js(v)) for k, v in d.items()) + ' }'


def main():
    sel = json.load(open(sys.argv[1], encoding='utf8'))
    fm = json.load(open(sys.argv[2], encoding='utf8'))
    tm = json.load(open(sys.argv[3], encoding='utf8'))
    players, missing_nat, club_diff = [], set(), []
    for p in sel:
        s = {k: v['value'] for k, v in p['stats'].items()}
        m, d, y = map(int, p['birthdate'].split(' ')[0].split('/'))
        age = AS_OF.year - y - ((AS_OF.month, AS_OF.day) < (m, d))
        nat = FIFA.get(p['nationality']['label'])
        if not nat:
            missing_nat.add(p['nationality']['label'])
        f = fm.get(str(p['id'])) or {}
        t = tm.get(str(p['id'])) or {}
        pos = p['position']['shortLabel']
        club = CLUB.get(p['team']['label'], p['team']['label'])
        o = {
            'id': f"ea-{p['id']}", 'name': p['commonName'] or f"{p['firstName']} {p['lastName']}".strip(),
            'nat': nat, 'club': club, 'league': LEAGUE.get(p['leagueName'], p['leagueName']), 'age': age,
            'height': f.get('height'), 'foot': {1: 'R', 2: 'L'}.get(p['preferredFoot']),
            'weakFoot': p['weakFootAbility'], 'skillMoves': p['skillMoves'], 'workAtt': None, 'workDef': None,
            'pos': pos, 'alt': [a['shortLabel'] for a in (p.get('alternatePositions') or []) if a['shortLabel'] in CODES and a['shortLabel'] != pos],
            'ovr': p['overallRating'],
        }
        if pos == 'GK':
            o.update(div=s['pac'], han=s['sho'], kic=s['pas'], ref=s['dri'], spd=s['def'], gkp=s['phy'])
        else:
            o.update(pac=s['pac'], sho=s['sho'], pas=s['pas'], dri=s['dri'], def_=s['def'], phy=s['phy'])
        o['a'] = {k: s.get(ek) for k, ek in ATTR}
        if t.get('tmId') and t.get('value'):
            o.update(mv=int(t['value']), mvSource='transfermarkt', mvDate=t.get('date') or AS_OF_S)
        else:
            o.update(mv=None, mvSource=None, mvDate=None)
        form = f.get('form')
        if form and form.get('apps'):
            o['form'] = {'rating': form['rating'], 'apps': form['apps'], 'last': form['last'], 'minutes': form['minutes'],
                         'goals': form['goals'], 'assists': form['assists'], 'source': 'fotmob', 'season': '2026/27', 'date': AS_OF_S}
        else:
            o['form'] = None
        if f.get('team'):
            o['_fmTeam'] = f['team']
        players.append(o)
    # report
    for o in players:
        fmteam = o.pop('_fmTeam', None)
        if fmteam:
            club_diff.append((o['name'], o['club'], fmteam))
    cnt = collections.Counter(GROUP[o['pos']] for o in players)
    order = ['GK', 'CB', 'RB', 'LB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST']
    counts = {g: cnt[g] for g in order}
    n_mv = sum(o['mv'] is not None for o in players)
    n_form = sum(o['form'] is not None for o in players)
    n_h = sum(o['height'] is not None for o in players)
    mv_dates = sorted(o['mvDate'] for o in players if o['mvDate'])
    meta = {
        'ea': 'EA SPORTS FC 27 official ratings database (ea.com/games/ea-sports-fc/ratings, embedded __NEXT_DATA__ JSON), fetched 2026-10-29: OVR, face stats, all 29 outfield + 5 GK detailed attributes, positions, weak foot, skill moves, preferred foot, club, league, nationality, birth date',
        'marketValue': f'Transfermarkt (transfermarkt.com quick search + ceapi market-value history), fetched 2026-10-29; mvDate = date Transfermarkt set the value (range {mv_dates[0] if mv_dates else "-"}..{mv_dates[-1] if mv_dates else "-"}); {n_mv}/{len(players)} players matched',
        'form': f'FotMob public JSON (playerData recentMatches), fetched 2026-10-29: all competitive matches since 2026-07-20 (club friendlies excluded, national-team games included); {n_form}/{len(players)} players with data',
        'height': f'FotMob player profile (EA ratings site publishes no height); {n_h}/{len(players)} players',
        'workRates': 'not available (EA ratings site does not publish work rates) -> workAtt/workDef are null',
        'gkFaceStats': 'GK face stats: div/han/kic/ref/spd/gkp from EA card slots',
        'asOf': AS_OF_S,
        'counts': counts,
    }
    lines = ['// Draft Arena Online player database. Generated by online/tools/data/build_players.py — do not edit by hand.',
             '// See online/data/README.md for sources, field mapping and how to regenerate.',
             '', 'export const DATA_META = ' + json.dumps(meta, ensure_ascii=False, indent=2) + ';', '', 'export const PLAYERS = [']
    for o in players:
        lines.append('  ' + obj(o).replace('def_:', 'def:') + ',')
    lines.append('];')
    open(sys.argv[4], 'w', encoding='utf8').write('\n'.join(lines) + '\n')
    print('counts', counts, 'mv', n_mv, 'form', n_form, 'height', n_h, file=sys.stderr)
    if missing_nat:
        print('MISSING NAT CODES', missing_nat, file=sys.stderr)
    if len(sys.argv) > 5:  # optional: EA club vs FotMob team, for reviewing transfers EA has not picked up
        json.dump(club_diff, open(sys.argv[5], 'w', encoding='utf8'), ensure_ascii=False, indent=0)


if __name__ == '__main__':
    main()
