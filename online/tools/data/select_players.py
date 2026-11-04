#!/usr/bin/env python3
"""Pick the Draft Arena Online pool from the EA pool produced by fetch_ea.py.

Usage: python3 -I select_players.py <ea_pool.json> <selected.json> [min_ovr keep_ids.json]

Big pool (with min_ovr): every player rated min_ovr or more, every Trendyol Süper Lig
player, every Turkish-nationality player rated MIN_TR_NAT_OVR or more, plus the EA ids
in keep_ids.json (the previous pool, so running leagues keep all their players).

Small pool (no min_ovr, the original 320): highest OVR per position group (ties broken
by EA rank), then swap in the best Trendyol Süper Lig / Turkish-national players
(OVR >= MIN_TR_OVR) for the lowest-rated other players of the same group until
TR_TARGET such players are in the pool.
"""
import json, sys, collections

GROUP = {'GK': 'GK', 'CB': 'CB', 'RB': 'RB', 'RWB': 'RB', 'LB': 'LB', 'LWB': 'LB', 'CDM': 'CDM',
         'CM': 'CM', 'CAM': 'CAM', 'LM': 'L', 'LW': 'L', 'RM': 'R', 'RW': 'R', 'ST': 'ST', 'CF': 'ST'}
TARGET = {'GK': 30, 'CB': 55, 'RB': 25, 'LB': 25, 'CDM': 28, 'CM': 40, 'CAM': 25, 'L': 30, 'R': 30, 'ST': 32}
TR_TARGET = 44          # Süper Lig + Turkish nationality players wanted in the pool
MIN_TR_OVR = 74
MAX_TR_SWAPS_PER_GROUP = 7
MIN_TR_NAT_OVR = 65     # big pool: Turkish players abroad from this rating up


def is_tr(p):
    return p['nationality']['label'] == 'Turkey' or p['leagueName'] == 'Trendyol Süper Lig'


def big(pool, min_ovr, keep):
    sl = lambda p: p['leagueName'] == 'Trendyol Süper Lig'
    tr = lambda p: p['nationality']['label'] == 'Turkey'
    out = []
    for p in sorted(pool, key=lambda p: (-p['overallRating'], p['rank'])):
        g = GROUP.get(p['position']['shortLabel'])
        if not g:
            continue
        if p['overallRating'] >= min_ovr or sl(p) or (tr(p) and p['overallRating'] >= MIN_TR_NAT_OVR) or p['id'] in keep:
            p = dict(p)
            p['_group'] = g
            out.append(p)
    missing = keep - {p['id'] for p in out}
    print({'total': len(out), 'min_ovr': min_ovr, 'SL': sum(sl(p) for p in out), 'TR': sum(tr(p) for p in out), 'kept_missing': sorted(missing)}, file=sys.stderr)
    return out


def main():
    pool = json.load(open(sys.argv[1], encoding='utf8'))
    if len(sys.argv) > 3:
        keep = set(json.load(open(sys.argv[4], encoding='utf8'))) if len(sys.argv) > 4 else set()
        json.dump(big(pool, int(sys.argv[3]), keep), open(sys.argv[2], 'w', encoding='utf8'), ensure_ascii=False)
        return
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
