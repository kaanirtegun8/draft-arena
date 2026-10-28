// Event-based 90-minute match engine.
// The score is never decided up front: every minute, possession, chances,
// shots, saves, fouls, cards, injuries and substitutions are rolled from the
// players on the pitch. Same input + seed => identical output.

import { createRng } from './rng.js';
import {
  PERFORMANCE_WEIGHTS, TACTIC_STYLES, FORMATIONS, MAX_SUBS, FITNESS, POSITION_GROUP, positionFit,
} from './config.js';
import { eaScore, gkRating, isGK, staminaOf, formValue } from './players.js';

export const ENGINE_VERSION = 1;

// Tunable engine constants (calibrated by tests/engine.test.js)
export const ENGINE_TUNING = {
  chanceBase: 0.102,      // chance probability per team per minute at equal strength
  strengthPower: 3.0,     // how strongly attack/defence ratio scales chance rate
  possessionPower: 4.0,
  homeAdvantage: 1.1,
  foulRate: 0.115,
  yellowPerFoul: 0.16,
  redPerFoul: 0.0018,
  injuryPerPlayerMinute: 0.00008,
  penaltyShare: 0.025,
  maxSubWindows: 3,       // stoppages for subs (half-time is free)
};

// Unit weights by slot
const ATTACK_W = { ST: 1, CF: 1, LW: 0.9, RW: 0.9, CAM: 0.8, LM: 0.6, RM: 0.6, CM: 0.4, CDM: 0.15, LWB: 0.35, RWB: 0.35, LB: 0.25, RB: 0.25, CB: 0.05, GK: 0 };
const MID_W = { CM: 1, CDM: 0.9, CAM: 0.8, LM: 0.6, RM: 0.6, LW: 0.3, RW: 0.3, LWB: 0.35, RWB: 0.35, LB: 0.25, RB: 0.25, CB: 0.15, ST: 0.15, CF: 0.3, GK: 0 };
const DEF_W = { CB: 1, LB: 0.8, RB: 0.8, LWB: 0.7, RWB: 0.7, CDM: 0.7, CM: 0.35, LM: 0.3, RM: 0.3, CAM: 0.15, LW: 0.1, RW: 0.1, ST: 0.05, CF: 0.05, GK: 0 };
const SHOOT_W = { ST: 5, CF: 4.5, LW: 3.2, RW: 3.2, CAM: 2.6, LM: 1.6, RM: 1.6, CM: 1.2, CDM: 0.5, LWB: 0.6, RWB: 0.6, LB: 0.35, RB: 0.35, CB: 0.45, GK: 0 };
const CREATE_W = { CAM: 3, LW: 2.5, RW: 2.5, CM: 2.2, LM: 2.2, RM: 2.2, ST: 1.6, CF: 2.2, LWB: 1.6, RWB: 1.6, LB: 1.2, RB: 1.2, CDM: 1, CB: 0.4, GK: 0.05 };
const FOUL_W = { CB: 2, CDM: 2.2, CM: 1.5, LB: 1.6, RB: 1.6, LWB: 1.4, RWB: 1.4, LM: 1, RM: 1, CAM: 0.9, LW: 0.8, RW: 0.8, ST: 0.9, CF: 0.8, GK: 0.15 };

function unitNorm(w) {
  // average weight sum over all formations (fixed normaliser so formations differ)
  let total = 0;
  const f = Object.values(FORMATIONS);
  for (const slots of f) total += slots.reduce((s, sl) => s + (w[sl] || 0), 0);
  return total / f.length;
}
const NORM = { att: unitNorm(ATTACK_W), mid: unitNorm(MID_W), def: unitNorm(DEF_W) };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const avg = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);

function styleFit(style, p, slot) {
  if (isGK(p)) return 0.85;
  const g = POSITION_GROUP[slot];
  let attr;
  switch (style) {
    case 'attacking': attr = g === 'DEF' ? (p.pac + p.pas) / 2 : (p.sho + p.dri) / 2; break;
    case 'defensive': attr = g === 'FWD' ? (p.phy + p.pas) / 2 : (p.def + p.phy) / 2; break;
    case 'counter': attr = g === 'DEF' ? (p.def + p.pac) / 2 : p.pac; break;
    case 'press': attr = (p.phy + p.def * 0.5 + p.pac * 0.5) / 2; break;
    default: return 0.85;
  }
  return clamp(0.5 + (attr - 70) / 40, 0.3, 1);
}

function opponentProfile(team) {
  const byGroup = { DEF: [], MID: [], FWD: [] };
  let gk = 70;
  for (const { slot, player } of team.lineupForProfile) {
    if (slot === 'GK') { gk = gkRating(player); continue; }
    if (isGK(player)) continue;
    byGroup[POSITION_GROUP[slot]].push(player);
  }
  const m = (g, k) => avg(byGroup[g].map((p) => p[k])) || 65;
  return {
    defPac: m('DEF', 'pac'), defDef: m('DEF', 'def'), defPhy: m('DEF', 'phy'),
    midDef: m('MID', 'def'), midPhy: m('MID', 'phy'), midPas: m('MID', 'pas'),
    attPac: m('FWD', 'pac'), attDri: m('FWD', 'dri'), attPhy: m('FWD', 'phy'), attSho: m('FWD', 'sho'),
    gk,
  };
}

// Strength/weakness matchup score (0-100, 50 = even)
export function matchupScore(p, slot, opp) {
  let adv;
  if (slot === 'GK') adv = (gkRating(p) - opp.attSho) * 0.8;
  else if (isGK(p)) adv = -30;
  else {
    const g = POSITION_GROUP[slot];
    if (g === 'FWD') adv = 0.4 * (p.pac - opp.defPac) + 0.3 * (p.dri - opp.defDef) + 0.3 * (p.phy - opp.defPhy);
    else if (g === 'MID') adv = 0.4 * (p.pas - opp.midDef) + 0.3 * (p.dri - opp.midDef) + 0.3 * (p.phy - opp.midPhy);
    else adv = 0.4 * (p.def - opp.attDri) + 0.4 * (p.pac - opp.attPac) + 0.2 * (p.phy - opp.attPhy);
  }
  return clamp(50 + adv * 1.5, 10, 90);
}

// Composite performance score for one player in one slot (pure; exported for tests/UI)
export function performanceScore({ player, slot, form, style, opp, condition, randomU, weights = PERFORMANCE_WEIGHTS }) {
  const ea = eaScore(player, slot);
  const formScore = form == null ? ea : clamp(ea + (form - 50) * 0.4, 0, 100);
  const fit = positionFit(slot, player);
  const tactic = 100 * (0.8 * fit + 0.2 * styleFit(style, player, slot));
  const matchup = opp ? matchupScore(player, slot, opp) : 50;
  const cond = clamp(condition, 0, 100);
  const rand = 50 + 50 * clamp(randomU, -1, 1);
  const parts = {
    ea: weights.ea * ea,
    form: weights.form * formScore,
    tactic: weights.tactic * tactic,
    matchup: weights.matchup * matchup,
    condition: weights.condition * cond,
    random: weights.random * rand,
  };
  const total = parts.ea + parts.form + parts.tactic + parts.matchup + parts.condition + parts.random;
  return { total, parts, fit };
}

/**
 * input = {
 *   seed, matchId,
 *   home/away: { id, name, formation, style, autoManage, subRules: [],
 *     lineup: [{ slot, playerId }], bench: [playerId],
 *     players: { [id]: { ...playerData, condition } } },
 *   form: { [playerId]: { value } }, weights?
 * }
 */
export function simulateMatch(input) {
  const rng = createRng(`${input.seed}|${input.matchId || ''}|v${ENGINE_VERSION}`);
  const weights = input.weights || PERFORMANCE_WEIGHTS;
  const T = ENGINE_TUNING;
  const sides = ['home', 'away'];
  const events = [];
  const possessionByMinute = [];

  // ---- set up teams
  const teams = {};
  for (const side of sides) {
    const t = input[side];
    const styleKey = TACTIC_STYLES[t.style] ? t.style : 'balanced';
    teams[side] = {
      side, id: t.id, name: t.name, style: styleKey, styleCfg: TACTIC_STYLES[styleKey],
      autoManage: t.autoManage !== false, subRules: (t.subRules || []).map((r, i) => ({ ...r, _i: i, done: false })),
      players: t.players,
      onPitch: t.lineup.map((l) => ({ pid: l.playerId, slot: l.slot })),
      bench: t.bench.slice(),
      used: new Set(),     // players who already left the pitch
      subsUsed: 0, windows: new Set(), goals: 0,
      lineupForProfile: t.lineup.map((l) => ({ slot: l.slot, player: t.players[l.playerId] })),
    };
  }
  const profiles = { home: opponentProfile(teams.away), away: opponentProfile(teams.home) };
  const other = (s) => (s === 'home' ? 'away' : 'home');

  // ---- per-player match state
  const ps = {};
  const rngDay = {};
  const initPlayer = (side, pid, started) => {
    const pdata = teams[side].players[pid];
    rngDay[pid] = clamp(rng.normal() / 2.2, -1, 1);
    ps[pid] = {
      side, started, minuteIn: started ? 0 : null, minuteOut: null,
      stamina: clamp(pdata.condition ?? 100, 0, 100),
      goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, saves: 0, conceded: 0,
      yellow: 0, red: 0, injured: false, fouls: 0, xg: 0, perfSum: 0, perfMin: 0,
      keyPasses: 0,
    };
  };
  for (const side of sides) {
    for (const op of teams[side].onPitch) initPlayer(side, op.pid, true);
    for (const pid of teams[side].bench) initPlayer(side, pid, false);
  }

  const perf = (side, op) => {
    const p = teams[side].players[op.pid];
    return performanceScore({
      player: p, slot: op.slot, form: formValue(input.form, op.pid), style: teams[side].style,
      opp: profiles[side], condition: ps[op.pid].stamina, randomU: rngDay[op.pid], weights,
    }).total;
  };

  const units = (side) => {
    const t = teams[side];
    let att = 0, mid = 0, def = 0, gk = 45;
    for (const op of t.onPitch) {
      const r = perf(side, op);
      const s = ps[op.pid];
      s.perfSum += r; s.perfMin += 1;
      att += (ATTACK_W[op.slot] || 0) * r;
      mid += (MID_W[op.slot] || 0) * r;
      def += (DEF_W[op.slot] || 0) * r;
      if (op.slot === 'GK') {
        const p = t.players[op.pid];
        // goalkeeper unit uses the shot-stopping rating with the same condition/form/random shape
        gk = r * 0.55 + gkRating(p) * (isGK(p) ? 0.45 : 0.1);
      }
    }
    return { att: att / NORM.att, mid: mid / NORM.mid, def: def / NORM.def, gk };
  };

  const minuteLabel = (min, extra) => (extra ? `${min}+${extra}` : `${min}`);
  const push = (e) => { events.push(e); return e; };

  // ---- substitutions
  const canSub = (t, minute, halftime) => {
    if (t.subsUsed >= MAX_SUBS) return false;
    if (halftime || t.windows.has(minute)) return true;
    return t.windows.size < T.maxSubWindows;
  };
  const bestReplacement = (t, slot, preferId) => {
    const avail = t.bench.filter((pid) => !t.used.has(pid) && !ps[pid].injured && !ps[pid].red);
    if (preferId && avail.includes(preferId)) return preferId;
    let best = null, bestV = -1;
    for (const pid of avail) {
      const p = t.players[pid];
      const v = eaScore(p, slot) * positionFit(slot, p) * (0.6 + 0.4 * ps[pid].stamina / 100);
      if (v > bestV) { bestV = v; best = pid; }
    }
    return best;
  };
  const doSub = (side, outPid, inPid, minute, extra, reason, halftime = false) => {
    const t = teams[side];
    if (!inPid || !canSub(t, minute, halftime)) return false;
    const idx = t.onPitch.findIndex((o) => o.pid === outPid);
    if (idx < 0) return false;
    const slot = t.onPitch[idx].slot;
    t.onPitch[idx] = { pid: inPid, slot };
    t.bench = t.bench.filter((b) => b !== inPid);
    t.used.add(outPid);
    t.subsUsed += 1;
    if (!halftime) t.windows.add(minute);
    ps[outPid].minuteOut = minute;
    ps[inPid].minuteIn = minute;
    push({ type: 'sub', side, minute, extra, label: minuteLabel(minute, extra), out: outPid, in: inPid, slot, reason });
    return true;
  };

  const runSubLogic = (side, minute, extra, halftime) => {
    const t = teams[side];
    const opp = teams[other(side)];
    const diff = t.goals - opp.goals;
    // 1) forced: injured players still on pitch
    for (const op of t.onPitch.slice()) {
      if (ps[op.pid].injured && ps[op.pid].minuteOut == null) {
        const rep = bestReplacement(t, op.slot);
        if (!doSub(side, op.pid, rep, minute, extra, 'injury', halftime)) {
          // no sub possible: player leaves, team plays a man down
          t.onPitch = t.onPitch.filter((o) => o.pid !== op.pid);
          t.used.add(op.pid);
          ps[op.pid].minuteOut = minute;
          push({ type: 'down', side, minute, extra, label: minuteLabel(minute, extra), playerId: op.pid });
          if (op.slot === 'GK' && t.onPitch.length) {
            t.onPitch.slice().sort((a, b) => perf(side, a) - perf(side, b))[0].slot = 'GK';
          }
        }
      }
    }
    // 2) manager rules (pre-match automatic substitution rules)
    for (const r of t.subRules) {
      if (t.subsUsed >= MAX_SUBS) break;
      if (r.done && r.type !== 'fatigue' && r.type !== 'yellow') continue;
      const onPitch = (pid) => t.onPitch.some((o) => o.pid === pid);
      if (r.type === 'minute' || r.type === 'losing' || r.type === 'winning' || r.type === 'drawing') {
        if (minute < (r.minute || 60)) continue;
        r.done = true; // evaluated once when its minute arrives
        const cond = r.type === 'minute' || (r.type === 'losing' && diff < 0) || (r.type === 'winning' && diff > 0) || (r.type === 'drawing' && diff === 0);
        if (!cond || !onPitch(r.outId)) continue;
        const slot = t.onPitch.find((o) => o.pid === r.outId).slot;
        const rep = bestReplacement(t, slot, r.inId);
        doSub(side, r.outId, rep, minute, extra, `rule:${r.type}`, halftime);
      } else if (r.type === 'fatigue') {
        if (minute < (r.fromMinute || 60)) continue;
        const tired = t.onPitch.filter((o) => o.slot !== 'GK' && ps[o.pid].stamina < (r.threshold || 60))
          .sort((a, b) => ps[a.pid].stamina - ps[b.pid].stamina);
        for (const op of tired) {
          if (!doSub(side, op.pid, bestReplacement(t, op.slot), minute, extra, 'rule:fatigue', halftime)) break;
        }
      } else if (r.type === 'yellow') {
        if (minute < (r.fromMinute || 60)) continue;
        const booked = t.onPitch.filter((o) => ps[o.pid].yellow === 1 && o.slot !== 'GK');
        for (const op of booked) {
          if (!doSub(side, op.pid, bestReplacement(t, op.slot), minute, extra, 'rule:yellow', halftime)) break;
        }
      }
    }
    // 3) automatic manager (CPU or human with auto-manage enabled)
    if (t.autoManage && !halftime && minute >= 58 && t.subsUsed < MAX_SUBS) {
      const checkpoints = { 60: 2, 70: 2, 80: 1 };
      if (checkpoints[minute]) {
        // replace the most tired outfield players when a fresher bench option exists
        const tired = t.onPitch.filter((o) => o.slot !== 'GK' && ps[o.pid].stamina < 88)
          .sort((a, b) => ps[a.pid].stamina - ps[b.pid].stamina).slice(0, checkpoints[minute]);
        for (const op of tired) doSub(side, op.pid, bestReplacement(t, op.slot), minute, extra, 'auto:fatigue');
        // chasing the game: swap the weakest defensive player for an attacker
        if (minute === 70 && diff < 0 && t.subsUsed < MAX_SUBS) {
          const att = t.bench.filter((pid) => !ps[pid].injured && ['FWD'].includes(POSITION_GROUP[t.players[pid].pos]));
          const victim = t.onPitch.filter((o) => ['CDM', 'CB', 'LB', 'RB'].includes(o.slot))
            .sort((a, b) => perf(side, a) - perf(side, b))[0];
          if (att.length && victim) {
            const inPid = att.sort((a, b) => t.players[b].ovr - t.players[a].ovr)[0];
            doSub(side, victim.pid, inPid, minute, extra, 'auto:chase');
          }
        }
      }
    }
  };

  // ---- one minute of play
  const playMinute = (minute, extra) => {
    const u = { home: units('home'), away: units('away') };
    const label = minuteLabel(minute, extra);
    const late = minute >= 70;
    const mods = {};
    for (const side of sides) {
      const t = teams[side];
      const diff = t.goals - teams[other(side)].goals;
      let a = t.styleCfg.attack, d = t.styleCfg.defense;
      if (late && diff < 0) { a *= 1.1; d *= 0.95; }
      if (late && diff > 0) { a *= 0.93; d *= 1.05; }
      mods[side] = { a, d };
    }
    const mh = u.home.mid * teams.home.styleCfg.possession;
    const ma = u.away.mid * teams.away.styleCfg.possession;
    const possHome = Math.pow(mh, T.possessionPower) / (Math.pow(mh, T.possessionPower) + Math.pow(ma, T.possessionPower));
    possessionByMinute.push(Math.round(possHome * 100));

    for (const side of sides) {
      const t = teams[side];
      const o = teams[other(side)];
      const poss = side === 'home' ? possHome : 1 - possHome;
      const ratio = (u[side].att * mods[side].a) / (u[o.side].def * mods[o.side].d);
      let pChance = T.chanceBase * Math.sqrt(2 * poss) * Math.pow(ratio, T.strengthPower);
      if (side === 'home') pChance *= T.homeAdvantage;
      // fewer players => fewer chances; facing fewer => more
      pChance *= Math.pow(t.onPitch.length / 11, 1.5) * Math.pow(11 / Math.max(7, o.onPitch.length), 1.2);
      pChance = clamp(pChance, 0.01, 0.4);
      if (rng.chance(pChance)) chance(side, minute, extra, label, ratio, u[o.side].gk);
    }

    // fouls & cards (committed by defending team, weighted by role)
    for (const side of sides) {
      const t = teams[side];
      const poss = side === 'home' ? 1 - possHome : possHome; // defending share
      if (!rng.chance(T.foulRate * (0.6 + 0.8 * poss) * (t.style === 'press' ? 1.15 : 1))) continue;
      const fouler = rng.weighted(t.onPitch, (op) => (FOUL_W[op.slot] || 1) * (ps[op.pid].yellow ? 0.35 : 1));
      if (!fouler) continue;
      const s = ps[fouler.pid];
      s.fouls += 1;
      push({ type: 'foul', side, minute, extra, label, playerId: fouler.pid });
      if (rng.chance(T.redPerFoul)) {
        sendOff(side, fouler.pid, minute, extra, label, 'straight');
      } else if (rng.chance(T.yellowPerFoul)) {
        s.yellow += 1;
        if (s.yellow >= 2) {
          push({ type: 'yellow', side, minute, extra, label, playerId: fouler.pid, second: true });
          sendOff(side, fouler.pid, minute, extra, label, 'second');
        } else {
          push({ type: 'yellow', side, minute, extra, label, playerId: fouler.pid });
        }
      }
    }

    // injuries
    for (const side of sides) {
      for (const op of teams[side].onPitch) {
        const s = ps[op.pid];
        const risk = T.injuryPerPlayerMinute * (1 + (100 - s.stamina) / 35);
        if (!s.injured && rng.chance(risk)) {
          s.injured = true;
          s.injuryWeeks = rng.int(FITNESS.injuryWeeksMin, FITNESS.injuryWeeksMax);
          push({ type: 'injury', side, minute, extra, label, playerId: op.pid, weeks: s.injuryWeeks });
        }
      }
    }

    // fatigue
    for (const side of sides) {
      const t = teams[side];
      for (const op of t.onPitch) {
        const p = t.players[op.pid];
        const staminaFactor = 1.3 - (staminaOf(p) / 100) * 0.6;
        const gkFactor = op.slot === 'GK' ? 0.35 : 1;
        ps[op.pid].stamina = Math.max(0, ps[op.pid].stamina - FITNESS.drainPerMinute * staminaFactor * t.styleCfg.fatigue * gkFactor);
      }
    }
  };

  const sendOff = (side, pid, minute, extra, label, kind) => {
    const t = teams[side];
    ps[pid].red = 1;
    ps[pid].minuteOut = minute;
    t.onPitch = t.onPitch.filter((o) => o.pid !== pid);
    t.used.add(pid);
    push({ type: 'red', side, minute, extra, label, playerId: pid, kind });
    // if the goalkeeper is sent off, an outfield player goes in goal
    if (!t.onPitch.some((o) => o.slot === 'GK') && t.onPitch.length) {
      const benchGk = t.bench.find((b) => isGK(t.players[b]) && !t.used.has(b));
      const outfield = t.onPitch.slice().sort((a, b) => perf(side, a) - perf(side, b))[0];
      if (benchGk && doSub(side, outfield.pid, benchGk, minute, extra, 'gk-red')) {
        const op = t.onPitch.find((o) => o.pid === benchGk); op.slot = 'GK';
      } else {
        outfield.slot = 'GK';
      }
    }
  };

  const chance = (side, minute, extra, label, ratio, oppGk) => {
    const t = teams[side];
    const o = teams[other(side)];
    if (!t.onPitch.length) return;
    const isPen = rng.chance(T.penaltyShare);
    const shooterOp = isPen
      ? t.onPitch.slice().sort((a, b) => (t.players[b.pid].sho || 0) - (t.players[a.pid].sho || 0))[0]
      : rng.weighted(t.onPitch, (op) => (SHOOT_W[op.slot] || 0.3) * Math.pow(((t.players[op.pid].sho) || 30) / 70, 2));
    const shooter = t.players[shooterOp.pid];
    const sho = isGK(shooter) ? 20 : shooter.sho;
    let xg;
    if (isPen) xg = 0.76;
    else {
      const r = rng.next();
      if (r < 0.75) xg = rng.float(0.02, 0.12);
      else if (r < 0.94) xg = rng.float(0.12, 0.3);
      else xg = rng.float(0.3, 0.6);
      xg *= 0.94 * Math.pow(sho / 75, 1.1) * clamp(Math.pow(ratio, 0.8), 0.6, 1.6);
      xg = clamp(xg, 0.01, 0.85);
    }
    const s = ps[shooterOp.pid];
    s.shots += 1; s.xg += xg;
    const pOn = isPen ? 0.82 : clamp(0.24 + (sho - 70) / 220 + xg * 0.5, 0.12, 0.9);
    const onTarget = rng.chance(pOn);
    const gkOp = o.onPitch.find((x) => x.slot === 'GK');
    if (!onTarget) {
      push({ type: 'miss', side, minute, extra, label, playerId: shooterOp.pid, xg: round2(xg), penalty: isPen });
      return;
    }
    s.shotsOnTarget += 1;
    const gkFactor = Math.pow(75 / clamp(oppGk, 30, 99), 1.6);
    const pGoal = clamp((xg / pOn) * gkFactor, 0.02, 0.95);
    if (rng.chance(pGoal)) {
      s.goals += 1;
      t.goals += 1;
      let assistId = null;
      if (!isPen && rng.chance(0.74)) {
        const mates = t.onPitch.filter((x) => x.pid !== shooterOp.pid);
        if (mates.length) {
          const a = rng.weighted(mates, (op) => (CREATE_W[op.slot] || 1) * Math.pow(((t.players[op.pid].pas) || 40) / 70, 2));
          assistId = a.pid;
          ps[assistId].assists += 1;
          ps[assistId].keyPasses += 1;
        }
      }
      if (gkOp) ps[gkOp.pid].conceded += 1;
      // every opponent on the pitch is "on the pitch for a goal against"
      for (const x of o.onPitch) if (x.slot !== 'GK') ps[x.pid].onPitchConceded = (ps[x.pid].onPitchConceded || 0) + 1;
      push({
        type: 'goal', side, minute, extra, label, playerId: shooterOp.pid, assistId, xg: round2(xg), penalty: isPen,
        score: [teams.home.goals, teams.away.goals],
      });
    } else {
      if (gkOp) ps[gkOp.pid].saves += 1;
      push({ type: 'save', side, minute, extra, label, playerId: shooterOp.pid, keeperId: gkOp ? gkOp.pid : null, xg: round2(xg), penalty: isPen });
    }
  };

  // ---- play the match
  const firstExtra = rng.int(1, 4);
  const secondExtra = rng.int(2, 6);
  push({ type: 'kickoff', minute: 0, extra: 0, label: '0' });
  for (let m = 1; m <= 45; m++) { playMinute(m, 0); for (const s of sides) runSubLogic(s, m, 0, false); }
  for (let e = 1; e <= firstExtra; e++) { playMinute(45, e); for (const s of sides) runSubLogic(s, 45, e, false); }
  push({ type: 'halftime', minute: 45, extra: firstExtra, label: 'İY', score: [teams.home.goals, teams.away.goals] });
  for (const s of sides) runSubLogic(s, 46, 0, true);
  for (let m = 46; m <= 90; m++) { playMinute(m, 0); for (const s of sides) runSubLogic(s, m, 0, false); }
  for (let e = 1; e <= secondExtra; e++) { playMinute(90, e); for (const s of sides) runSubLogic(s, 90, e, false); }
  push({ type: 'fulltime', minute: 90, extra: secondExtra, label: 'MS', score: [teams.home.goals, teams.away.goals] });

  // ---- player summaries & ratings
  const hg = teams.home.goals, ag = teams.away.goals;
  const playerStats = {};
  for (const [pid, s] of Object.entries(ps)) {
    const played = s.minuteIn != null;
    if (!played) {
      playerStats[pid] = { side: s.side, played: false, started: false, minutes: 0, endCondition: s.stamina };
      continue;
    }
    const out = s.minuteOut == null ? 90 : Math.min(90, s.minuteOut);
    const minutes = Math.max(1, out - Math.min(90, s.minuteIn));
    const t = teams[s.side];
    const p = t.players[pid];
    const own = s.side === 'home' ? hg : ag;
    const against = s.side === 'home' ? ag : hg;
    const res = own > against ? 1 : own < against ? -1 : 0;
    const wasGK = isGK(p);
    const g = POSITION_GROUP[p.pos];
    const concededWhileOn = wasGK ? s.conceded : (s.onPitchConceded || 0);
    const cleanSheet = minutes >= 60 && concededWhileOn === 0 && (g === 'GK' || g === 'DEF');
    let r = 6.0;
    r += s.goals * (g === 'DEF' ? 1.2 : 1.0) + s.assists * 0.7;
    r += s.shotsOnTarget * 0.12 - (s.shots - s.shotsOnTarget) * 0.04;
    r += s.saves * 0.3;
    if (g === 'GK') r -= s.conceded * 0.35;
    else if (g === 'DEF') r -= concededWhileOn * 0.18;
    if (cleanSheet) r += g === 'GK' ? 0.8 : 0.55;
    r -= s.yellow * 0.35 + s.red * 1.5;
    r += res === 1 ? 0.35 : res === -1 ? -0.25 : 0;
    const avgPerf = s.perfMin ? s.perfSum / s.perfMin : 70;
    r += clamp((avgPerf - 75) / 12, -0.8, 0.8);
    r += clamp(rng.normal() * 0.2, -0.4, 0.4);
    if (minutes < 25) r = 6.0 + (r - 6.0) * (minutes / 25);
    r = Math.round(clamp(r, 3.0, 10.0) * 10) / 10;
    playerStats[pid] = {
      side: s.side, played: true, started: s.started, minutes,
      goals: s.goals, assists: s.assists, shots: s.shots, shotsOnTarget: s.shotsOnTarget,
      saves: s.saves, conceded: wasGK ? s.conceded : 0, cleanSheet: wasGK && cleanSheet, defCleanSheet: !wasGK && cleanSheet,
      yellow: s.yellow >= 1 ? 1 : 0, red: s.red, fouls: s.fouls, xg: round2(s.xg),
      injured: s.injured, injuryWeeks: s.injured ? s.injuryWeeks : 0,
      rating: r, endCondition: Math.round(s.stamina * 10) / 10,
    };
  }

  // team stats
  const teamStats = {};
  for (const side of sides) {
    const list = Object.values(playerStats).filter((x) => x.side === side && x.played);
    const sum = (k) => list.reduce((acc, x) => acc + (x[k] || 0), 0);
    const possAvg = avg(possessionByMinute);
    teamStats[side] = {
      goals: teams[side].goals, shots: sum('shots'), shotsOnTarget: sum('shotsOnTarget'), saves: sum('saves'),
      yellow: sum('yellow'), red: sum('red'), fouls: sum('fouls'), xg: round2(sum('xg')),
      subs: teams[side].subsUsed,
      possession: Math.round(side === 'home' ? possAvg : 100 - possAvg),
    };
  }

  let motm = null, best = -1;
  for (const [pid, x] of Object.entries(playerStats)) {
    if (!x.played || x.minutes < 20) continue;
    const v = x.rating + (x.goals || 0) * 0.01;
    if (v > best) { best = v; motm = pid; }
  }

  return {
    engineVersion: ENGINE_VERSION,
    seed: input.seed,
    matchId: input.matchId,
    homeGoals: hg, awayGoals: ag,
    events, possession: possessionByMinute,
    teamStats, playerStats, motm,
    subsUsed: { home: teams.home.subsUsed, away: teams.away.subsUsed },
  };
}

function round2(v) { return Math.round(v * 100) / 100; }

// Stable fingerprint of a result (for replay verification)
export function resultFingerprint(res) {
  return JSON.stringify([res.homeGoals, res.awayGoals, res.events.map((e) => [e.type, e.label, e.playerId || e.out || '', e.in || '', e.assistId || ''])]);
}
