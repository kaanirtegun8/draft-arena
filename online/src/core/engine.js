// Event-based 90-minute match engine (zone model).
// Nothing is decided in advance: each minute the team units (left/centre/right
// attack & defence, midfield control, pressing) are rebuilt from the players on
// the pitch, and possession, attacks, crosses, through balls, counters, set
// pieces, shots, saves, fouls, cards, injuries and substitutions are rolled.
// Same input + seed => identical match.
import { createRng } from './rng.js';
import { formationSlots, isGK, roleOf, positionFit } from './positions.js';
import { abilities } from './abilities.js';
import { teamUnits, analyse, defaultInstructions } from './tactics.js';

export const ENGINE_VERSION = 2;
export const MAX_SUBS = 5;
export const MAX_SUB_WINDOWS = 3;

export const TUNING = {
  chanceBase: 0.058,
  cornerBase: 0.028,
  strengthPower: 2.6,
  possessionPower: 4,
  counterBase: 0.012,
  homeAdvantage: 1.12,
  foulRate: 0.11,
  yellowPerFoul: 0.15,
  redPerFoul: 0.0012,
  injuryPerPlayerMinute: 0.00006,
  penaltyShare: 0.022,
  cornerAfterFlank: 0.3,
  drain: 0.28,
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Realtime Database may hand arrays back as index-keyed objects
const arr = (v) => (!v ? [] : Array.isArray(v) ? v : Object.keys(v).sort((x, y) => Number(x) - Number(y)).map((k) => v[k]));
const round2 = (v) => Math.round(v * 100) / 100;

// shooter weights by chance type and slot code
const W = {
  cross: { ST: 5, CF: 4, CAM: 1.4, LW: 1.2, RW: 1.2, CM: 0.9, CB: 0.5, LM: 0.8, RM: 0.8, CDM: 0.4 },
  cutback: { ST: 4, CF: 3.5, CAM: 2.5, CM: 1.6, LW: 1.5, RW: 1.5, LM: 1.1, RM: 1.1, CDM: 0.5 },
  wide: { LW: 4, RW: 4, LM: 3, RM: 3, LWB: 1.2, RWB: 1.2, LB: 0.6, RB: 0.6, ST: 1 },
  through: { ST: 5, CF: 4, LW: 2.4, RW: 2.4, CAM: 1.8, CM: 0.7, LM: 1.2, RM: 1.2 },
  combo: { ST: 4.5, CF: 4.5, CAM: 3, LW: 2, RW: 2, CM: 1.4, LM: 1.2, RM: 1.2, CDM: 0.4 },
  long: { CM: 3, CAM: 3, CDM: 1.6, LW: 1.4, RW: 1.4, ST: 1.2, LM: 1.2, RM: 1.2, CB: 0.3, LB: 0.4, RB: 0.4 },
  counter: { ST: 4, CF: 3.5, LW: 3.2, RW: 3.2, CAM: 1.6, LM: 1.6, RM: 1.6, CM: 0.6 },
  corner: { CB: 3.5, ST: 3, CF: 2, CDM: 1.4, CM: 0.9, LB: 0.5, RB: 0.5, LW: 0.5, RW: 0.5, CAM: 0.6 },
};
const FOUL_W = { CB: 2, CDM: 2.3, CM: 1.5, LB: 1.6, RB: 1.6, LWB: 1.4, RWB: 1.4, LM: 1, RM: 1, CAM: 0.9, LW: 0.8, RW: 0.8, ST: 0.9, CF: 0.8, GK: 0.15 };

/**
 * input = { seed, matchId,
 *   home/away: { id, name, formation, instructions, autoManage, subRules,
 *     lineup: [playerId x11 in formation slot order], bench: [playerId],
 *     players: { [id]: { ...playerData, level, condition } } } }
 */
export function simulateMatch(input) {
  const rng = createRng(`${input.seed}|${input.matchId || ''}|e${ENGINE_VERSION}`);
  const T = TUNING;
  const sides = ['home', 'away'];
  const other = (s) => (s === 'home' ? 'away' : 'home');
  const events = [];
  const possessionByMinute = [];
  const push = (e) => { events.push(e); return e; };
  const label = (m, x) => (x ? `${m}+${x}` : `${m}`);

  const teams = {};
  for (const side of sides) {
    const t = input[side];
    const slots = formationSlots(t.formation);
    const ins = { ...defaultInstructions(), ...(t.instructions || {}) };
    teams[side] = {
      side, id: t.id, name: t.name, ins, players: t.players,
      onPitch: arr(t.lineup).map((pid, i) => ({ pid, slot: { ...slots[i] } })),
      bench: arr(t.bench).slice(), used: new Set(), subsUsed: 0, windows: new Set(), goals: 0,
      autoManage: t.autoManage !== false,
      subRules: arr(t.subRules).map((r) => ({ ...r, done: false })),
    };
  }

  // per-player match state
  const ps = {};
  const day = {};
  const initP = (side, pid, started) => {
    const p = teams[side].players[pid];
    day[pid] = 1 + clamp(rng.normal() * 0.03, -0.07, 0.07);
    ps[pid] = {
      side, started, minuteIn: started ? 0 : null, minuteOut: null, stamina: clamp(p.condition ?? 100, 0, 100),
      goals: 0, assists: 0, shots: 0, sot: 0, saves: 0, conceded: 0, yellow: 0, red: 0, fouls: 0, xg: 0,
      injured: false, injuryWeeks: 0, keyPasses: 0, tackles: 0, concededOn: 0,
    };
  };
  for (const side of sides) {
    for (const o of teams[side].onPitch) initP(side, o.pid, true);
    for (const pid of teams[side].bench) initP(side, pid, false);
  }

  const onPitchView = (side) => teams[side].onPitch.map((o) => {
    const p = teams[side].players[o.pid];
    return { slot: o.slot, player: p, level: p.level ?? p.ovr, cond: ps[o.pid].stamina, day: day[o.pid] };
  });

  let analysis = null;
  const computeUnits = () => {
    const raw = { home: teamUnits(onPitchView('home'), teams.home.ins), away: teamUnits(onPitchView('away'), teams.away.ins) };
    const a = { home: analyse(raw.home, raw.away, teams.home.ins, teams.away.ins), away: analyse(raw.away, raw.home, teams.away.ins, teams.home.ins) };
    return a;
  };

  const effPlayer = (side, pid) => {
    const p = teams[side].players[pid];
    return { p, ab: abilities(p), stamina: ps[pid].stamina };
  };

  // ---------- substitutions
  const canSub = (t, minute, ht) => t.subsUsed < MAX_SUBS && (ht || t.windows.has(minute) || t.windows.size < MAX_SUB_WINDOWS);
  const available = (t) => t.bench.filter((pid) => !t.used.has(pid) && !ps[pid].injured && !ps[pid].red);
  const bestReplacement = (t, slotCode, prefer) => {
    const av = available(t);
    if (prefer && av.includes(prefer)) return prefer;
    let best = null, bv = -1;
    for (const pid of av) {
      const p = t.players[pid];
      const v = (p.level ?? p.ovr) * positionFit(slotCode, p) * (0.6 + 0.4 * ps[pid].stamina / 100);
      if (v > bv) { bv = v; best = pid; }
    }
    return best;
  };
  const doSub = (side, outPid, inPid, minute, extra, reason, ht = false) => {
    const t = teams[side];
    if (!inPid || !canSub(t, minute, ht)) return false;
    const idx = t.onPitch.findIndex((o) => o.pid === outPid);
    if (idx < 0) return false;
    const slot = t.onPitch[idx].slot;
    t.onPitch[idx] = { pid: inPid, slot };
    t.bench = t.bench.filter((b) => b !== inPid);
    t.used.add(outPid);
    t.subsUsed += 1;
    if (!ht) t.windows.add(minute);
    ps[outPid].minuteOut = minute;
    ps[inPid].minuteIn = minute;
    push({ type: 'sub', side, minute, extra, label: label(minute, extra), out: outPid, in: inPid, slot: slot.code, reason });
    return true;
  };
  const ensureKeeper = (side) => {
    const t = teams[side];
    if (t.onPitch.some((o) => o.slot.code === 'GK') || !t.onPitch.length) return;
    const weakest = t.onPitch.slice().sort((a, b) => (t.players[a.pid].ovr) - (t.players[b.pid].ovr))[0];
    weakest.slot = { code: 'GK', side: 'C' };
  };
  const removePlayer = (side, pid, minute) => {
    const t = teams[side];
    t.onPitch = t.onPitch.filter((o) => o.pid !== pid);
    t.used.add(pid);
    ps[pid].minuteOut = minute;
  };

  const runSubs = (side, minute, extra, ht) => {
    const t = teams[side];
    const diff = t.goals - teams[other(side)].goals;
    // forced: injuries
    for (const o of t.onPitch.slice()) {
      if (ps[o.pid].injured && ps[o.pid].minuteOut == null) {
        const rep = bestReplacement(t, o.slot.code);
        if (!doSub(side, o.pid, rep, minute, extra, 'injury', ht)) {
          removePlayer(side, o.pid, minute);
          push({ type: 'down', side, minute, extra, label: label(minute, extra), playerId: o.pid });
          ensureKeeper(side);
        }
        analysis = null;
      }
    }
    // manager rules
    for (const r of t.subRules) {
      if (t.subsUsed >= MAX_SUBS) break;
      const onPitch = (pid) => t.onPitch.find((o) => o.pid === pid);
      if (['minute', 'losing', 'winning', 'drawing'].includes(r.type)) {
        if (r.done || minute < (r.minute || 60)) continue;
        r.done = true;
        const ok = r.type === 'minute' || (r.type === 'losing' && diff < 0) || (r.type === 'winning' && diff > 0) || (r.type === 'drawing' && diff === 0);
        const o = onPitch(r.outId);
        if (!ok || !o) continue;
        if (doSub(side, r.outId, bestReplacement(t, o.slot.code, r.inId), minute, extra, `rule:${r.type}`, ht)) analysis = null;
      } else if (r.type === 'fatigue' && minute >= (r.fromMinute || 60)) {
        const tired = t.onPitch.filter((o) => o.slot.code !== 'GK' && ps[o.pid].stamina < (r.threshold || 60)).sort((a, b) => ps[a.pid].stamina - ps[b.pid].stamina);
        for (const o of tired) { if (!doSub(side, o.pid, bestReplacement(t, o.slot.code), minute, extra, 'rule:fatigue', ht)) break; analysis = null; }
      } else if (r.type === 'yellow' && minute >= (r.fromMinute || 60)) {
        const booked = t.onPitch.filter((o) => ps[o.pid].yellow === 1 && o.slot.code !== 'GK');
        for (const o of booked) { if (!doSub(side, o.pid, bestReplacement(t, o.slot.code), minute, extra, 'rule:yellow', ht)) break; analysis = null; }
      }
    }
    // automatic manager
    const cps = { 60: 2, 70: 2, 80: 1 };
    if (t.autoManage && !ht && cps[minute] && t.subsUsed < MAX_SUBS) {
      const tired = t.onPitch.filter((o) => o.slot.code !== 'GK' && ps[o.pid].stamina < 70)
        .sort((a, b) => ps[a.pid].stamina - ps[b.pid].stamina).slice(0, cps[minute]);
      for (const o of tired) if (doSub(side, o.pid, bestReplacement(t, o.slot.code), minute, extra, 'auto:fatigue')) analysis = null;
      if (minute === 70 && diff < 0 && t.subsUsed < MAX_SUBS) {
        const fw = available(t).filter((pid) => ['ST', 'LW', 'RW'].includes(roleOf(t.players[pid])));
        const victim = t.onPitch.filter((o) => ['CDM', 'CB'].includes(o.slot.code)).sort((a, b) => t.players[a.pid].ovr - t.players[b.pid].ovr)[0];
        if (fw.length && victim && t.onPitch.filter((o) => o.slot.code === 'CB').length >= 2) {
          const inPid = fw.sort((a, b) => (t.players[b].level ?? 0) - (t.players[a].level ?? 0))[0];
          if (doSub(side, victim.pid, inPid, minute, extra, 'auto:chase')) analysis = null;
        }
      }
    }
  };

  // ---------- chance resolution
  const pickShooter = (side, type, zone) => {
    const t = teams[side];
    const wt = W[type] || W.combo;
    let cands = t.onPitch.filter((o) => o.slot.code !== 'GK');
    if (zone === 'L' || zone === 'R') {
      // wide shots come from that flank; crosses are attacked by central/far players
      if (type === 'wide') cands = cands.filter((o) => o.slot.side === zone || ['ST', 'CF'].includes(o.slot.code));
    }
    if (!cands.length) cands = t.onPitch;
    return rng.weighted(cands, (o) => {
      const ab = abilities(t.players[o.pid]);
      const skill = type === 'cross' || type === 'corner' ? ab.aerialAtt : type === 'long' ? ab.longShot : ab.finishing;
      return (wt[o.slot.code] || 0.25) * Math.pow(Math.max(20, skill) / 70, 2);
    });
  };
  const pickCreator = (side, type, zone, shooterPid) => {
    const t = teams[side];
    let cands = t.onPitch.filter((o) => o.pid !== shooterPid && o.slot.code !== 'GK');
    if (!cands.length) return null;
    if (type === 'cross' || type === 'cutback') {
      const flank = cands.filter((o) => o.slot.side === zone && !['CB'].includes(o.slot.code));
      if (flank.length) cands = flank;
      return rng.weighted(cands, (o) => Math.pow(abilities(t.players[o.pid]).crossing / 70, 2) * (['LW', 'RW', 'LM', 'RM', 'LB', 'RB', 'LWB', 'RWB'].includes(o.slot.code) ? 2 : 0.6));
    }
    if (type === 'corner') return cands.slice().sort((a, b) => abilities(t.players[b.pid]).crossing - abilities(t.players[a.pid]).crossing)[0];
    return rng.weighted(cands, (o) => {
      const cw = { CAM: 3, CM: 2.2, LW: 2.2, RW: 2.2, CF: 2.2, ST: 1.4, LM: 2, RM: 2, CDM: 1, LB: 0.8, RB: 0.8, LWB: 1.1, RWB: 1.1, CB: 0.3 }[o.slot.code] || 0.5;
      return cw * Math.pow(abilities(t.players[o.pid]).creation / 70, 2);
    });
  };

  const resolveChance = (side, type, zone, ratio, minute, extra, A) => {
    const t = teams[side];
    const o = teams[other(side)];
    if (!t.onPitch.length) return;
    const isPen = type !== 'corner' && rng.chance(T.penaltyShare);
    const shooterOp = isPen ? t.onPitch.slice().sort((a, b) => abilities(t.players[b.pid]).finishing - abilities(t.players[a.pid]).finishing)[0] : pickShooter(side, type, zone);
    const sp = t.players[shooterOp.pid];
    const sab = abilities(sp);
    const lvl = (sp.level ?? sp.ovr) - sp.ovr;
    const fatigue = 0.85 + 0.15 * ps[shooterOp.pid].stamina / 100;
    let xg;
    const r = rng.next();
    const tier = (a, b, c) => (r < 0.72 ? rng.float(a[0], a[1]) : r < 0.93 ? rng.float(b[0], b[1]) : rng.float(c[0], c[1]));
    const defA = A[other(side)];
    if (isPen) xg = 0.76;
    else {
      switch (type) {
        case 'cross': {
          const duel = clamp(1 + (sab.aerialAtt - 70) / 60 + defA.aerialGapSelf / 80, 0.5, 1.7);
          xg = tier([0.03, 0.09], [0.09, 0.2], [0.2, 0.35]) * duel; break;
        }
        case 'corner': {
          const duel = clamp(1 + (sab.aerialAtt - 70) / 60, 0.5, 1.6);
          xg = tier([0.02, 0.06], [0.06, 0.14], [0.14, 0.3]) * duel; break;
        }
        case 'cutback': xg = tier([0.05, 0.14], [0.14, 0.28], [0.28, 0.5]); break;
        case 'wide': xg = tier([0.02, 0.07], [0.07, 0.15], [0.15, 0.3]); break;
        case 'through': {
          const paceEdge = clamp(1 + (sab.pace - 75) / 80, 0.7, 1.4);
          xg = tier([0.06, 0.16], [0.16, 0.35], [0.35, 0.6]) * paceEdge; break;
        }
        case 'long': xg = tier([0.015, 0.04], [0.04, 0.07], [0.07, 0.12]) * clamp(sab.longShot / 75, 0.6, 1.4); break;
        case 'counter': xg = tier([0.06, 0.16], [0.16, 0.35], [0.35, 0.55]); break;
        default: xg = tier([0.03, 0.1], [0.1, 0.22], [0.22, 0.45]);
      }
      const skill = type === 'cross' || type === 'corner' ? sab.aerialAtt : type === 'long' ? sab.longShot : sab.finishing;
      xg *= Math.pow(clamp((skill + lvl) * fatigue, 20, 110) / 80, 1.1) * clamp(Math.pow(ratio, 0.6), 0.65, 1.5) * 0.92;
      xg = clamp(xg, 0.01, 0.85);
    }
    const s = ps[shooterOp.pid];
    s.shots += 1; s.xg += xg;
    const composure = clamp((sab.composure + lvl) / 75, 0.7, 1.3);
    const pOn = isPen ? 0.82 : clamp(0.22 + (sab.finishing + lvl - 70) / 230 + xg * 0.5 + (composure - 1) * 0.08, 0.12, 0.9);
    const gk = o.onPitch.find((x) => x.slot.code === 'GK');
    const ev = { side, minute, extra, label: label(minute, extra), playerId: shooterOp.pid, xg: round2(xg), penalty: isPen, chance: type, zone };
    if (!rng.chance(pOn)) {
      push({ type: 'miss', ...ev });
      if ((zone === 'L' || zone === 'R') && type !== 'corner' && rng.chance(0.15)) setPiece(side, minute, extra, A);
      return;
    }
    s.sot += 1;
    const gkRating = gk ? (() => { const g = o.players[gk.pid]; const ab = abilities(g); return (isGK(g) ? ab.keeping + ((g.level ?? g.ovr) - g.ovr) : 25) * (0.85 + 0.15 * ps[gk.pid].stamina / 100); })() : 20;
    const pGoal = clamp((xg / pOn) * Math.pow(75 / clamp(gkRating, 20, 99), 1.5), 0.02, 0.95);
    if (rng.chance(pGoal)) {
      s.goals += 1; t.goals += 1;
      let assistId = null;
      const pAssist = { cross: 0.95, corner: 0.9, cutback: 0.95, through: 0.9, combo: 0.75, counter: 0.8, wide: 0.45, long: 0.25 }[type] ?? 0.7;
      if (!isPen && rng.chance(pAssist)) {
        const c = pickCreator(side, type, zone, shooterOp.pid);
        if (c) { assistId = c.pid; ps[assistId].assists += 1; ps[assistId].keyPasses += 1; }
      }
      if (gk) ps[gk.pid].conceded += 1;
      for (const x of o.onPitch) if (x.slot.code !== 'GK') ps[x.pid].concededOn += 1;
      push({ type: 'goal', ...ev, assistId, score: [teams.home.goals, teams.away.goals] });
      analysis = null;
    } else {
      if (gk) ps[gk.pid].saves += 1;
      push({ type: 'save', ...ev, keeperId: gk ? gk.pid : null });
      if (type !== 'corner' && rng.chance(0.3)) setPiece(side, minute, extra, A);
    }
  };

  const setPiece = (side, minute, extra, A) => {
    // corner: an aerial chance, quality depends on aerial duel
    const t = teams[side];
    const ratio = 1 + clamp(A[other(side)].aerialGapSelf / 60, -0.4, 0.5);
    push({ type: 'corner', side, minute, extra, label: label(minute, extra) });
    if (rng.chance(0.28 * ratio)) resolveChance(side, 'corner', 'C', ratio, minute, extra, A);
    void t;
  };

  // ---------- one minute of play
  const playMinute = (minute, extra) => {
    if (!analysis) analysis = computeUnits();
    else if (minute % 5 === 0 && !extra) analysis = computeUnits(); // fatigue updates
    const A = analysis;
    // aerial gap seen from each defending side (positive = opponent forwards win headers)
    A.home.aerialGapSelf = A.home.aerialGap; A.away.aerialGapSelf = A.away.aerialGap;
    const lbl = label(minute, extra);
    const late = minute >= 70;
    const mods = {};
    for (const side of sides) {
      const diff = teams[side].goals - teams[other(side)].goals;
      mods[side] = { a: late && diff < 0 ? 1.1 : late && diff > 0 ? 0.93 : 1, d: late && diff < 0 ? 0.95 : late && diff > 0 ? 1.05 : 1 };
    }
    // possession: control vs control, pressing disrupts
    const ch = A.home.control * (1 + (A.home.press - A.away.press) / 600);
    const ca = A.away.control * (1 + (A.away.press - A.home.press) / 600);
    const pHome = Math.pow(ch, T.possessionPower) / (Math.pow(ch, T.possessionPower) + Math.pow(ca, T.possessionPower));
    possessionByMinute.push(Math.round(pHome * 100));

    for (const side of sides) {
      const t = teams[side];
      const oSide = other(side);
      const U = A[side], D = A[oSide];
      const poss = side === 'home' ? pHome : 1 - pHome;
      // zone ratios: my left attack meets their right defence
      const zr = {
        L: (U.att.L * mods[side].a) / (D.def.R * mods[oSide].d),
        C: (U.att.C * mods[side].a) / (D.def.C * mods[oSide].d),
        R: (U.att.R * mods[side].a) / (D.def.L * mods[oSide].d),
      };
      // teams attack where they are strong and the opponent is weak
      const zw = { L: U.att.L * zr.L * zr.L, C: U.att.C * 1.25 * zr.C * zr.C, R: U.att.R * zr.R * zr.R };
      const totalW = zw.L + zw.C + zw.R;
      const effRatio = (zw.L * zr.L + zw.C * zr.C + zw.R * zr.R) / totalW;
      let pChance = T.chanceBase * Math.sqrt(2 * poss) * Math.pow(effRatio, T.strengthPower);
      if (side === 'home') pChance *= T.homeAdvantage;
      pChance *= Math.pow(t.onPitch.length / 11, 1.4) * Math.pow(11 / Math.max(7, teams[oSide].onPitch.length), 1.1);
      pChance = clamp(pChance, 0.008, 0.35);
      if (rng.chance(pChance)) {
        const zone = rng.weighted(['L', 'C', 'R'], (z) => zw[z]);
        let type;
        const rr = rng.next();
        if (zone === 'C') type = rr < 0.33 ? 'through' : rr < 0.73 ? 'combo' : 'long';
        else type = rr < 0.5 ? 'cross' : rr < 0.78 ? 'cutback' : 'wide';
        resolveChance(side, type, zone, zr[zone], minute, extra, A);
      } else if (rng.chance(T.cornerBase * Math.sqrt(2 * poss) * clamp(effRatio, 0.6, 1.6) * (zw.L + zw.R) / totalW * 1.6)) {
        setPiece(side, minute, extra, A);
      } else if (rng.chance(T.counterBase * (1 - poss) * 2 * D.counterExposure * Math.pow(avgPace(side) / 75, 2))) {
        // counter attack after winning the ball
        push({ type: 'counter', side, minute, extra, label: lbl });
        if (rng.chance(0.55)) resolveChance(side, 'counter', 'C', Math.max(1, zr.C), minute, extra, A);
      }
    }

    // fouls & cards (committed by the defending side)
    for (const side of sides) {
      const t = teams[side];
      const defShare = side === 'home' ? 1 - pHome : pHome;
      const pressF = t.ins.press === 'high' ? 1.15 : t.ins.press === 'low' ? 0.9 : 1;
      if (!rng.chance(T.foulRate * (0.6 + 0.8 * defShare) * pressF)) continue;
      const f = rng.weighted(t.onPitch, (o) => (FOUL_W[o.slot.code] || 1) * (abilities(t.players[o.pid]).aggression / 65) * (ps[o.pid].yellow ? 0.4 : 1));
      if (!f) continue;
      const s = ps[f.pid];
      s.fouls += 1;
      push({ type: 'foul', side, minute, extra, label: lbl, playerId: f.pid });
      const agg = abilities(t.players[f.pid]).aggression;
      if (rng.chance(T.redPerFoul * (agg / 65))) sendOff(side, f.pid, minute, extra, 'straight');
      else if (rng.chance(T.yellowPerFoul * (0.7 + 0.6 * agg / 100))) {
        s.yellow += 1;
        if (s.yellow >= 2) { push({ type: 'yellow', side, minute, extra, label: lbl, playerId: f.pid, second: true }); sendOff(side, f.pid, minute, extra, 'second'); }
        else push({ type: 'yellow', side, minute, extra, label: lbl, playerId: f.pid });
      }
    }

    // injuries
    for (const side of sides) {
      for (const o of teams[side].onPitch) {
        const s = ps[o.pid];
        if (!s.injured && rng.chance(T.injuryPerPlayerMinute * (1 + (100 - s.stamina) / 35))) {
          s.injured = true;
          s.injuryWeeks = rng.weighted([1, 2, 3, 4], (w) => [5, 3, 1.5, 0.5][w - 1]);
          push({ type: 'injury', side, minute, extra, label: lbl, playerId: o.pid, weeks: s.injuryWeeks });
        }
      }
    }

    // fatigue (pressing and mentality cost energy)
    for (const side of sides) {
      const t = teams[side];
      const pressF = t.ins.press === 'high' ? 1.2 : t.ins.press === 'low' ? 0.88 : 1;
      const mentF = t.ins.mentality === 'attacking' ? 1.04 : t.ins.mentality === 'defensive' ? 0.97 : 1;
      for (const o of t.onPitch) {
        const st = abilities(t.players[o.pid]).stamina;
        const f = (1.3 - (st / 100) * 0.6) * (o.slot.code === 'GK' ? 0.35 : 1) * pressF * mentF;
        ps[o.pid].stamina = Math.max(0, ps[o.pid].stamina - T.drain * f);
      }
    }
  };

  const avgPace = (side) => {
    const t = teams[side];
    const f = t.onPitch.filter((o) => ['ST', 'CF', 'LW', 'RW', 'LM', 'RM'].includes(o.slot.code));
    if (!f.length) return 65;
    return f.reduce((a, o) => a + abilities(t.players[o.pid]).pace, 0) / f.length;
  };

  const sendOff = (side, pid, minute, extra, kind) => {
    ps[pid].red = 1;
    removePlayer(side, pid, minute);
    push({ type: 'red', side, minute, extra, label: label(minute, extra), playerId: pid, kind });
    const t = teams[side];
    if (!t.onPitch.some((o) => o.slot.code === 'GK') && t.onPitch.length) {
      const benchGk = available(t).find((b) => isGK(t.players[b]));
      const victim = t.onPitch.slice().sort((a, b) => t.players[a.pid].ovr - t.players[b.pid].ovr)[0];
      if (benchGk && doSub(side, victim.pid, benchGk, minute, extra, 'gk-red')) {
        t.onPitch.find((o) => o.pid === benchGk).slot = { code: 'GK', side: 'C' };
      } else ensureKeeper(side);
    }
    analysis = null;
  };

  // ---------- run the match
  const e1 = rng.int(1, 4), e2 = rng.int(2, 6);
  push({ type: 'kickoff', minute: 0, extra: 0, label: '0' });
  const kickoffAnalysis = computeUnits();
  for (let m = 1; m <= 45; m++) { playMinute(m, 0); for (const s of sides) runSubs(s, m, 0, false); }
  for (let x = 1; x <= e1; x++) { playMinute(45, x); for (const s of sides) runSubs(s, 45, x, false); }
  push({ type: 'halftime', minute: 45, extra: e1, label: 'İY', score: [teams.home.goals, teams.away.goals] });
  for (const s of sides) runSubs(s, 46, 0, true);
  for (let m = 46; m <= 90; m++) { playMinute(m, 0); for (const s of sides) runSubs(s, m, 0, false); }
  for (let x = 1; x <= e2; x++) { playMinute(90, x); for (const s of sides) runSubs(s, 90, x, false); }
  push({ type: 'fulltime', minute: 90, extra: e2, label: 'MS', score: [teams.home.goals, teams.away.goals] });

  // ---------- ratings & summaries
  const hg = teams.home.goals, ag = teams.away.goals;
  const playerStats = {};
  for (const [pid, s] of Object.entries(ps)) {
    if (s.minuteIn == null) { playerStats[pid] = { side: s.side, played: false, minutes: 0, endCondition: Math.round(s.stamina * 10) / 10 }; continue; }
    const out = s.minuteOut == null ? 90 : Math.min(90, s.minuteOut);
    const minutes = Math.max(1, out - Math.min(90, s.minuteIn));
    const p = teams[s.side].players[pid];
    const role = roleOf(p);
    const gk = isGK(p);
    const def = ['CB', 'RB', 'LB'].includes(role);
    const own = s.side === 'home' ? hg : ag, against = s.side === 'home' ? ag : hg;
    const res = own > against ? 1 : own < against ? -1 : 0;
    const concededWhileOn = gk ? s.conceded : s.concededOn;
    const clean = minutes >= 60 && concededWhileOn === 0 && (gk || def);
    let r = 6.0;
    r += s.goals * (def ? 1.2 : 1.0) + s.assists * 0.7;
    r += s.sot * 0.12 - (s.shots - s.sot) * 0.04;
    r += s.saves * 0.3;
    if (gk) r -= s.conceded * 0.35; else if (def || role === 'CDM') r -= concededWhileOn * 0.15;
    if (clean) r += gk ? 0.8 : 0.5;
    r -= s.yellow * 0.3 + s.red * 1.5;
    r += res === 1 ? 0.35 : res === -1 ? -0.25 : 0;
    r += clamp(((p.level ?? p.ovr) - 80) / 25, -0.4, 0.5) + (day[pid] - 1) * 4;
    r += clamp(rng.normal() * 0.2, -0.4, 0.4);
    if (minutes < 25) r = 6 + (r - 6) * (minutes / 25);
    r = Math.round(clamp(r, 3, 10) * 10) / 10;
    playerStats[pid] = {
      side: s.side, played: true, started: s.started, minutes, goals: s.goals, assists: s.assists, shots: s.shots, sot: s.sot,
      saves: s.saves, conceded: gk ? s.conceded : 0, cleanSheet: gk && clean, yellow: s.yellow >= 1 ? 1 : 0, red: s.red,
      secondYellow: s.yellow >= 2 ? 1 : 0, fouls: s.fouls, xg: round2(s.xg), injured: s.injured, injuryWeeks: s.injured ? s.injuryWeeks : 0,
      rating: r, endCondition: Math.round(s.stamina * 10) / 10,
    };
  }
  const teamStats = {};
  const possAvg = possessionByMinute.reduce((a, b) => a + b, 0) / possessionByMinute.length;
  for (const side of sides) {
    const list = Object.values(playerStats).filter((x) => x.side === side && x.played);
    const sum = (k) => list.reduce((a, x) => a + (x[k] || 0), 0);
    teamStats[side] = {
      goals: teams[side].goals, shots: sum('shots'), sot: sum('sot'), saves: sum('saves'), yellow: sum('yellow'), red: sum('red'),
      fouls: sum('fouls'), xg: round2(sum('xg')), subs: teams[side].subsUsed,
      corners: events.filter((e) => e.type === 'corner' && e.side === side).length,
      possession: Math.round(side === 'home' ? possAvg : 100 - possAvg),
    };
  }
  let motm = null, best = -1;
  for (const [pid, x] of Object.entries(playerStats)) {
    if (!x.played || x.minutes < 20) continue;
    const v = x.rating + x.goals * 0.01;
    if (v > best) { best = v; motm = pid; }
  }
  return {
    engineVersion: ENGINE_VERSION, seed: input.seed, matchId: input.matchId,
    homeGoals: hg, awayGoals: ag, events, possession: possessionByMinute, teamStats, playerStats, motm,
    subsUsed: { home: teams.home.subsUsed, away: teams.away.subsUsed },
    analysis: { home: kickoffAnalysis.home.notes, away: kickoffAnalysis.away.notes },
  };
}

export function fingerprint(res) {
  return JSON.stringify([res.homeGoals, res.awayGoals, res.events.map((e) => [e.type, e.label, e.playerId || e.out || '', e.in || '', e.assistId || ''])]);
}
