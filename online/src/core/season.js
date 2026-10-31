// Season logic shared by every client. All season state (condition, injuries,
// suspensions, standings, statistics) is derived from the stored match results,
// so every phone computes the same numbers.
import { createRng } from './rng.js';
import { buildSchedule, legsOf } from './schedule.js';
import { squads, toArray } from './draft.js';
import { simulateMatch, fingerprint, ENGINE_VERSION } from './engine.js';
import { autoLineup, isAvailable, lineupError } from './lineup.js';
import { defaultInstructions } from './tactics.js';
import { currentLevel } from './abilities.js';
import { roleOf, isGK, customSlots } from './positions.js';
import { validRole } from './roles.js';

export const FITNESS = { recoverPlayed: 6, recoverBench: 16, recoverBye: 24, warn: 60 };
export const DISCIPLINE = { yellowsForBan: 3, yellowBan: 1, secondYellowBan: 1, redBan: 2 };
export const POINTS = { win: 3, draw: 1, loss: 0 };
export const BONUS = { topScorer: 2, topAssist: 1 };
export const BENCH_SIZE = 9;

export function createSeason(seats, seed, legs) {
  const rng = createRng(`${seed}|schedule`);
  return { seed, legs: legsOf(legs), schedule: buildSchedule(rng.shuffle(seats), legsOf(legs)), currentWeek: 1, matches: {}, finished: false };
}

export function weeksOf(season) { return toArray(season && season.schedule); }

export function matchesOfWeek(season, week) {
  const w = weeksOf(season).find((x) => x.week === week);
  return w ? toArray(w.matches) : [];
}

// ---------- derived player state up to (not including) a week
export function playerStateBefore(room, week) {
  const sq = squads(room.draft);
  const st = {};
  for (const seat of Object.keys(sq)) for (const pid of sq[seat]) st[pid] = { condition: 100, injuredWeeks: 0, banned: 0, yellows: 0, totalYellow: 0, totalRed: 0, seat };
  const season = room.season;
  if (!season) return st;
  for (const w of weeksOf(season)) {
    if (w.week >= week) break;
    const ms = toArray(w.matches).map((m) => season.matches && season.matches[m.id]).filter(Boolean);
    if (ms.length !== toArray(w.matches).length) break; // week not complete
    applyWeek(st, sq, w, ms);
  }
  return st;
}

function applyWeek(st, sq, w, results) {
  const playing = new Set();
  const played = new Set();
  const newInj = {};
  const newBan = {};
  for (const r of results) {
    playing.add(r.home); playing.add(r.away);
    for (const [pid, x] of Object.entries(r.players || {})) {
      const s = st[pid];
      if (!s) continue;
      if (x.played) { played.add(pid); s.condition = x.endCondition; }
      if (x.injured) newInj[pid] = x.injuryWeeks;
      // discipline
      if (x.red) {
        s.totalRed += 1;
        newBan[pid] = (newBan[pid] || 0) + (x.secondYellow ? DISCIPLINE.secondYellowBan : DISCIPLINE.redBan);
        if (x.secondYellow) s.totalYellow += 1;
      } else if (x.yellow) {
        s.totalYellow += 1;
        s.yellows += 1;
        if (s.yellows >= DISCIPLINE.yellowsForBan) { s.yellows = 0; newBan[pid] = (newBan[pid] || 0) + DISCIPLINE.yellowBan; }
      }
    }
  }
  for (const seat of Object.keys(sq)) {
    const teamPlayed = playing.has(seat);
    for (const pid of sq[seat]) {
      const s = st[pid];
      const rec = !teamPlayed ? FITNESS.recoverBye : played.has(pid) ? FITNESS.recoverPlayed : FITNESS.recoverBench;
      s.condition = Math.round(Math.min(100, s.condition + rec) * 10) / 10;
      if (s.injuredWeeks > 0) s.injuredWeeks -= 1;
      if (teamPlayed && s.banned > 0) s.banned -= 1; // a ban is served in the team's matches
      if (newInj[pid]) s.injuredWeeks = newInj[pid];
      if (newBan[pid]) s.banned += newBan[pid];
    }
  }
}

// ---------- match preparation
export function levelFn(model, formOverrides = {}) {
  const cache = new Map();
  return (p) => {
    if (!cache.has(p.id)) cache.set(p.id, currentLevel(p, model, formOverrides[p.id]).level);
    return cache.get(p.id);
  };
}

export function teamSnapshot(room, seat, state, byId, levelOf) {
  const sq = squads(room.draft)[seat] || [];
  const member = room.members[seat] || {};
  const tac = (room.tactics && room.tactics[seat]) || {};
  const formation = tac.formation || '4-3-3';
  const slots = tacticSlots(tac);
  const notes = [];
  let lineup = toArray(tac.lineup);
  if (!lineup.length || lineupError(lineup, formation, sq, state)) {
    const unavailable = lineup.filter((pid) => pid && !isAvailable(state[pid]));
    const r = autoLineup({ squad: sq, formation, byId, state, levelOf, rotation: tac.lineup ? 0.6 : 1, keep: lineup.length ? lineup : null, slots });
    if (unavailable.length) notes.push(`${member.team || member.name}: ${unavailable.map((id) => byId[id].name).join(', ')} oynayamıyor (sakat/cezalı), yerine otomatik oyuncu seçildi.`);
    else if (!tac.lineup) notes.push(`${member.team || member.name}: kadro kurulmadığı için otomatik ilk 11 kullanıldı.`);
    lineup = r.lineup;
  }
  const inXI = new Set(lineup);
  const benchPref = toArray(tac.bench).filter((id) => sq.includes(id) && !inXI.has(id) && isAvailable(state[id]));
  const rest = sq.filter((id) => !inXI.has(id) && !benchPref.includes(id) && isAvailable(state[id]))
    .sort((a, b) => levelOf(byId[b]) - levelOf(byId[a]));
  const bench = [...benchPref, ...rest].slice(0, BENCH_SIZE);
  // keep at least one keeper on the bench if possible
  if (!bench.some((id) => isGK(byId[id]))) {
    const gk = sq.find((id) => isGK(byId[id]) && !inXI.has(id) && isAvailable(state[id]));
    if (gk) { if (bench.length >= BENCH_SIZE) bench.pop(); bench.push(gk); }
  }
  const players = {};
  for (const pid of [...lineup, ...bench]) {
    const p = byId[pid];
    players[pid] = { ...p, level: levelOf(p), condition: state[pid] ? state[pid].condition : 100 };
  }
  return {
    snapshot: {
      id: seat, name: member.team || member.name || seat, formation, slots,
      instructions: { ...defaultInstructions(), ...(tac.instructions || {}) },
      autoManage: tac.autoManage !== false,
      subRules: toArray(tac.subRules),
      subPlan: subPlanOf(tac),
      lineup, bench, players,
    },
    notes,
  };
}

export const DEFAULT_SUB_PLAN = { threshold: 62, fromMinute: 60, exceptions: [] };
export function subPlanOf(tac) {
  const p = tac.subPlan || {};
  return { threshold: p.threshold ?? DEFAULT_SUB_PLAN.threshold, fromMinute: p.fromMinute ?? DEFAULT_SUB_PLAN.fromMinute, exceptions: toArray(p.exceptions).filter((x) => x && x.pid) };
}

// Formation slots with the manager's position overrides (CM -> CDM etc.) and player roles.
export function tacticSlots(tac) {
  const base = customSlots(tac.formation || '4-3-3', tac.slotCodes || {}, tac.roles || {});
  return base.map((s) => ({ code: s.code, side: s.side, role: s.role ? validRole(s.code, s.role) : null }));
}

export function prepareWeek(room, byId, model) {
  const season = room.season;
  const week = season.currentWeek;
  const state = playerStateBefore(room, week);
  const levelOf = levelFn(model, room.formOverrides || {});
  const inputs = [];
  for (const m of matchesOfWeek(season, week)) {
    const h = teamSnapshot(room, m.home, state, byId, levelOf);
    const a = teamSnapshot(room, m.away, state, byId, levelOf);
    inputs.push({ match: m, input: { seed: season.seed, matchId: m.id, engine: ENGINE_VERSION, home: h.snapshot, away: a.snapshot }, notes: [...h.notes, ...a.notes] });
  }
  return { week, inputs, state };
}

export function summarize(match, week, result, notes, input) {
  const players = {};
  for (const [pid, x] of Object.entries(result.playerStats)) {
    players[pid] = x.played ? {
      side: x.side, played: true, started: !!x.started, minutes: x.minutes, goals: x.goals, assists: x.assists, shots: x.shots, sot: x.sot,
      saves: x.saves, conceded: x.conceded, cleanSheet: !!x.cleanSheet, yellow: x.yellow, red: x.red, secondYellow: x.secondYellow,
      injured: !!x.injured, injuryWeeks: x.injuryWeeks, rating: x.rating, endCondition: x.endCondition,
    } : { side: x.side, played: false };
  }
  const goals = result.events.filter((e) => e.type === 'goal').map((e) => ({ side: e.side, label: e.label, playerId: e.playerId, assistId: e.assistId || null, penalty: !!e.penalty }));
  const cards = result.events.filter((e) => e.type === 'yellow' || e.type === 'red').map((e) => ({ side: e.side, label: e.label, playerId: e.playerId, type: e.type, second: !!e.second }));
  return {
    id: match.id, week, home: match.home, away: match.away, homeGoals: result.homeGoals, awayGoals: result.awayGoals,
    goals, cards, players, motm: result.motm, teamStats: result.teamStats, notes: notes || [], analysis: result.analysis, report: result.report,
    setup: input ? { home: setupOf(input.home), away: setupOf(input.away) } : null,
    fp: fingerprint(result),
  };
}

function setupOf(t) {
  return { formation: t.formation, instructions: t.instructions, slots: (t.slots || []).map((x) => ({ code: x.code, role: x.role || null })) };
}

// Simulate the current week (pure). Returns what the admin client writes.
export function simulateWeek(room, byId, model) {
  const { week, inputs } = prepareWeek(room, byId, model);
  const summaries = {};
  const logs = {};
  for (const { match, input, notes } of inputs) {
    const result = simulateMatch(input);
    summaries[match.id] = summarize(match, week, result, notes, input);
    logs[match.id] = { input, events: result.events, possession: result.possession };
  }
  return { week, summaries, logs };
}

export function replayFromLog(log) {
  return simulateMatch(log.input);
}

// ---------- standings & statistics
export function finishedMatches(season) {
  if (!season || !season.matches) return [];
  return Object.values(season.matches).sort((a, b) => a.week - b.week || (a.id < b.id ? -1 : 1));
}

export function seasonStats(room) {
  const out = {};
  const sq = squads(room.draft);
  for (const seat of Object.keys(sq)) for (const pid of sq[seat]) out[pid] = blank(seat);
  for (const m of finishedMatches(room.season)) {
    for (const [pid, x] of Object.entries(m.players || {})) {
      if (!x.played) continue;
      const s = out[pid] || (out[pid] = blank(null));
      s.apps += 1; if (x.started) s.starts += 1;
      s.minutes += x.minutes; s.goals += x.goals; s.assists += x.assists; s.shots += x.shots; s.sot += x.sot;
      s.yellow += x.yellow + (x.secondYellow ? 1 : 0); s.red += x.red; s.saves += x.saves; s.conceded += x.conceded;
      if (x.cleanSheet) s.cleanSheets += 1;
      if (m.motm === pid) s.motm += 1;
      s.ratingSum += x.rating;
      s.ratings.push({ week: m.week, rating: x.rating });
    }
  }
  for (const s of Object.values(out)) s.avgRating = s.apps ? Math.round((s.ratingSum / s.apps) * 100) / 100 : 0;
  return out;
}
function blank(seat) {
  return { seat, apps: 0, starts: 0, minutes: 0, goals: 0, assists: 0, shots: 0, sot: 0, yellow: 0, red: 0, saves: 0, conceded: 0, cleanSheets: 0, motm: 0, ratingSum: 0, avgRating: 0, ratings: [] };
}

export function standings(room) {
  const rows = {};
  const seats = toArray(room.draft && room.draft.firstRound);
  for (const seat of seats) {
    const m = room.members[seat] || {};
    rows[seat] = { seat, name: m.team || m.name || seat, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0, bonus: 0, total: 0, form: [], history: [] };
  }
  for (const m of finishedMatches(room.season)) {
    const h = rows[m.home], a = rows[m.away];
    if (!h || !a) continue;
    h.played++; a.played++;
    h.gf += m.homeGoals; h.ga += m.awayGoals; a.gf += m.awayGoals; a.ga += m.homeGoals;
    if (m.homeGoals > m.awayGoals) { h.won++; a.lost++; h.points += POINTS.win; h.form.push('G'); a.form.push('M'); }
    else if (m.homeGoals < m.awayGoals) { a.won++; h.lost++; a.points += POINTS.win; h.form.push('M'); a.form.push('G'); }
    else { h.drawn++; a.drawn++; h.points += POINTS.draw; a.points += POINTS.draw; h.form.push('B'); a.form.push('B'); }
    h.history.push({ week: m.week, points: h.points }); a.history.push({ week: m.week, points: a.points });
  }
  const aw = room.season && room.season.finished && room.season.awards;
  if (aw) for (const b of toArray(aw.bonuses)) if (rows[b.seat]) rows[b.seat].bonus += b.points;
  const list = Object.values(rows);
  for (const r of list) { r.gd = r.gf - r.ga; r.total = r.points + r.bonus; r.form = r.form.slice(-5); }
  list.sort((x, y) => y.total - x.total || y.gd - x.gd || y.gf - x.gf || y.won - x.won || seats.indexOf(x.seat) - seats.indexOf(y.seat));
  list.forEach((r, i) => { r.rank = i + 1; });
  return list;
}

// ---------- awards (computed once the last week has been played)
export function computeAwards(room, byId) {
  const stats = seasonStats(room);
  const rows = Object.entries(stats).filter(([, s]) => s.seat).map(([pid, s]) => ({ pid, ...s, p: byId[pid] }));
  const idc = (a, b) => (a.pid < b.pid ? -1 : a.pid > b.pid ? 1 : 0);
  const by = (...fs) => (a, b) => { for (const f of fs) { const d = f(a, b); if (d) return d; } return 0; };
  const scorers = rows.filter((r) => r.goals > 0).sort(by((a, b) => b.goals - a.goals, (a, b) => a.minutes - b.minutes, (a, b) => b.assists - a.assists, idc));
  const assisters = rows.filter((r) => r.assists > 0).sort(by((a, b) => b.assists - a.assists, (a, b) => a.minutes - b.minutes, (a, b) => b.goals - a.goals, idc));
  const nWeeks = weeksOf(room.season).length;
  const minMin = Math.round(nWeeks * 0.8 * 45);
  const perf = (r) => r.avgRating + 0.12 * r.goals + 0.08 * r.assists + (isGK(r.p) ? 0.08 * r.cleanSheets : 0) + 0.05 * r.motm;
  const keepers = rows.filter((r) => isGK(r.p) && r.apps >= Math.max(2, Math.floor(nWeeks / 4))).sort(by((a, b) => perf(b) - perf(a), idc));
  const qualified = rows.filter((r) => r.minutes >= minMin).sort(by((a, b) => perf(b) - perf(a), idc));
  // team of the season ("sezonun karması"): 4-3-3 with real roles
  const slots = [['GK'], ['RB'], ['CB'], ['CB'], ['LB'], ['CDM', 'CM'], ['CM', 'CAM', 'CDM'], ['CAM', 'CM'], ['RW', 'ST'], ['ST'], ['LW', 'ST']];
  const labels = ['KL', 'SĞB', 'STP', 'STP', 'SLB', 'DOS', 'MO', 'OOS', 'SĞK', 'FV', 'SLK'];
  const pool = rows.filter((r) => r.minutes >= Math.round(minMin * 0.7)).sort(by((a, b) => perf(b) - perf(a), idc));
  const used = new Set();
  const karma = [];
  const anyPlayed = rows.filter((r) => r.apps > 0).sort(by((a, b) => perf(b) - perf(a), idc));
  // pass 1: natural position only; pass 2: allowed alternatives
  const chosen = new Array(slots.length).fill(null);
  for (const pass of [0, 1]) {
    slots.forEach((roles, i) => {
      if (chosen[i]) return;
      const allowed = pass === 0 ? [roles[0]] : roles;
      const pick = pool.find((r) => !used.has(r.pid) && allowed.includes(roleOf(r.p)))
        || (pass === 1 && anyPlayed.find((r) => !used.has(r.pid) && allowed.includes(roleOf(r.p))));
      if (pick) { used.add(pick.pid); chosen[i] = pick; }
    });
  }
  chosen.forEach((pick, i) => { if (pick) karma.push({ slot: labels[i], pid: pick.pid, seat: pick.seat, avgRating: pick.avgRating }); });
  // best draft pick: biggest gap between pick number and performance rank
  const pickNo = {};
  toArray(room.draft.picks).forEach((p, i) => { if (p) pickNo[p.pid] = i + 1; });
  let bestPick = null;
  qualified.forEach((r, i) => {
    const steal = (pickNo[r.pid] || 0) - (i + 1);
    if (!bestPick || steal > bestPick.steal) bestPick = { pid: r.pid, seat: r.seat, pick: pickNo[r.pid], perfRank: i + 1, steal };
  });
  const aw = (r, extra) => (r ? { pid: r.pid, seat: r.seat, ...extra } : null);
  const topScorer = aw(scorers[0], scorers[0] && { goals: scorers[0].goals });
  const topAssist = aw(assisters[0], assisters[0] && { assists: assisters[0].assists });
  const bonuses = [];
  if (topScorer) bonuses.push({ seat: topScorer.seat, points: BONUS.topScorer, reason: 'Gol kralı' });
  if (topAssist) bonuses.push({ seat: topAssist.seat, points: BONUS.topAssist, reason: 'Asist kralı' });
  return {
    topScorer, topAssist,
    bestKeeper: aw(keepers[0], keepers[0] && { avgRating: keepers[0].avgRating, cleanSheets: keepers[0].cleanSheets }),
    playerOfSeason: aw(qualified[0], qualified[0] && { avgRating: qualified[0].avgRating }),
    karma, bestPick, bonuses,
  };
}

// The update the admin client writes after simulating the current week.
export function weekUpdate(room, byId, model) {
  const sim = simulateWeek(room, byId, model);
  const season = room.season;
  const nextWeek = sim.week + 1;
  const total = weeksOf(season).length;
  const updates = {};
  for (const [id, s] of Object.entries(sim.summaries)) updates[`season/matches/${id}`] = s;
  for (const [id, l] of Object.entries(sim.logs)) updates[`logs/${id}`] = l;
  updates['season/currentWeek'] = nextWeek;
  updates[`season/weeksPlayed/${sim.week}`] = Date.now();
  if (nextWeek > total) {
    // compute awards on the would-be state
    const after = { ...room, season: { ...season, matches: { ...(season.matches || {}), ...sim.summaries }, currentWeek: nextWeek } };
    const awards = computeAwards(after, byId);
    updates['season/finished'] = true;
    updates['season/awards'] = awards;
    const champ = standings({ ...after, season: { ...after.season, finished: true, awards } })[0];
    updates['season/champion'] = champ.seat;
    updates['public/status'] = 'finished';
  }
  return { updates, sim };
}

// Summary of a finished season, kept in the room history when a new season starts.
export function seasonHistoryEntry(room, byId) {
  const st = standings(room);
  const aw = room.season && room.season.awards;
  const nm = (pid) => (pid && byId[pid] ? byId[pid].name : null);
  return {
    at: Date.now(),
    champion: room.season && room.season.champion,
    table: st.map((r) => ({ seat: r.seat, name: r.name, total: r.total, gd: r.gd })),
    topScorer: aw && aw.topScorer ? { name: nm(aw.topScorer.pid), seat: aw.topScorer.seat, goals: aw.topScorer.goals } : null,
    topAssist: aw && aw.topAssist ? { name: nm(aw.topAssist.pid), seat: aw.topAssist.seat, assists: aw.topAssist.assists } : null,
    playerOfSeason: aw && aw.playerOfSeason ? { name: nm(aw.playerOfSeason.pid), seat: aw.playerOfSeason.seat } : null,
  };
}
