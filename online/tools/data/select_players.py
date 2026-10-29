#!/usr/bin/env python3
"""Pick the Draft Arena Online pool from the EA pool produced by fetch_ea.py.

Usage: python3 -I select_players.py <ea_pool.json> <selected.json>

Rules: highest OVR per position group (ties broken by EA rank), then swap in the best
Trendyol Süper Lig / Turkish-national players (OVR >= MIN_TR_OVR) for the lowest-rated
other players of the same group until TR_TARGET such players are in the pool.
"""
import json, sys, collections

GROUP = {'GK': 'GK', 'CB': 'CB', 'RB': 'RB', 'RWB': 'RB', 'LB': 'LB', 'LWB': 'LB', 'CDM': 'CDM',
         'CM': 'CM', 'CAM': 'CAM', 'LM': 'L', 'LW': 'L', 'RM': 'R', 'RW': 'R', 'ST': 'ST', 'CF': 'ST'}
TARGET = {'GK': 30, 'CB': 55, 'RB': 25, 'LB': 25, 'CDM': 28, 'CM': 40, 'CAM': 25, 'L': 30, 'R': 30, 'ST': 32}
TR_TARGET = 44          # Süper Lig + Turkish nationality players wanted in the pool
MIN_TR_OVR = 74
MAX_TR_SWAPS_PER_GROUP = 7


def is_tr(p):
    return p['nationality']['label'] == 'Turkey' or p['leagueName'] == 'Trendyol Süper Lig'


def main():
    pool = json.load(open(sys.argv[1], encoding='utf8'))
    by = collections.defaultdict(list)
    for p in pool:
        g = GROUP.get(p['position']['shortLabel'])
        if g:
            by[g].append(p)
    for g in by:
        by[g].sort(key=lambda p: (-p['overallRating'], p['rank']))
    sel = {g: by[g][:TARGET[g]] for g in TARGET}
    swaps = collections.Counter()
    while sum(is_tr(p) for g in sel for p in sel[g]) < TR_TARGET:
        best = None
        for g in TARGET:
            if swaps[g] >= MAX_TR_SWAPS_PER_GROUP:
                continue
            ids = {p['id'] for p in sel[g]}
            cand = next((p for p in by[g] if is_tr(p) and p['id'] not in ids and p['overallRating'] >= MIN_TR_OVR), None)
            victims = [p for p in sel[g] if not is_tr(p)]
            if cand and victims and (best is None or (cand['overallRating'], -cand['rank']) > (best[1]['overallRating'], -best[1]['rank'])):
                best = (g, cand, victims[-1])
        if not best:
            break
        g, cand, victim = best
        sel[g].remove(victim)
        sel[g].append(cand)
        sel[g].sort(key=lambda p: (-p['overallRating'], p['rank']))
        swaps[g] += 1
    out = []
    for g in TARGET:
        for p in sel[g]:
            p = dict(p)
            p['_group'] = g
            out.append(p)
    json.dump(out, open(sys.argv[2], 'w', encoding='utf8'), ensure_ascii=False)
    print({g: len(sel[g]) for g in sel}, 'total', len(out), 'TR/SL', sum(is_tr(p) for p in out), 'swaps', dict(swaps), file=sys.stderr)


if __name__ == '__main__':
    main()
