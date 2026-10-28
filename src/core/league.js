// League state machine: setup -> draft -> season (10 weeks) -> finished.
// All mutations go through these functions so the UI and tests share one rule set.
import { createRng, newSeed } from './rng.js';
import { NUM_MANAGERS, SQUAD_SIZE, FITNESS, DATA_VERSION, FORMATIONS, TACTIC_STYLES, MAX_SUBS } from './config.js';
import { snakeOrder, pickError, cpuChoosePick } from './draft.js';
import { buildSchedule } from './schedule.js';
import { autoLineup, validateLineup, availablePlayers } from './tactics.js';
import { simulateMatch } from './engine.js';
import { computeAwards } from './awards.js';
import { standings } from './stats.js';

export const MANAGER_COLORS = ['#e63946', '#2a9d8f', '#f4a261', '#4361ee', '#9b5de5'];

export function indexPlayers(pool) {
  const byId = {};
  for (const p of pool) byId[p.id] = p;
  return byId;
}

export function createLeague({ name = 'Draft Arena Ligi', seed, managers }) {
  if (!Array.isArray(managers) || managers.length !== NUM_MANAGERS) throw new Error(`${NUM_MANAGERS} menajer gerekli.`);
  const s = seed && String(seed).trim() ? String(seed).trim() : newSeed();
  const rng = createRng(`${s}|draft-order`);
  const mgrs = managers.map((m, i) => ({
    id: `m${i + 1}`,
    name: (m.name || `Menajer ${i + 1}`).trim().slice(0, 24) || `Menajer ${i + 1}`,
    isHuman: !!m.isHuman,
    color: MANAGER_COLORS[i],
    squad: [],
    tactics: { formation: '4-3-3', style: 'balanced', lineup: null, bench: [], subRules: [], autoManage: true },
  }));
  const order = rng.shuffle(mgrs.map((m) => m.id));
  return {
    dataVersion: DATA_VERSION,
    id: `L${s}`,
    name: name.trim().slice(0, 40) || 'Draft Arena Ligi',
    seed: s,
    createdAt: new Date().toISOString(),
    phase: 'draft',
    managers: mgrs,
    draft: { firstRoundOrder: order, order: snakeOrder(order, SQUAD_SIZE), picks: [], current: 0, taken: {} },
    playerState: {},
    form: {},
    schedule: [],
    matches: {},
    currentWeek: 1,
    awards: null,
    bonusApplied: false,
    log: [],
  };
}

export function currentPickSlot(state) {
  return state.phase === 'draft' ? state.draft.order[state.draft.current] || null : null;
}

export function getManager(state, id) {
  return state.managers.find((m) => m.id === id);
}

export function makePick(state, managerId, playerId, playerById) {
  const err = pickError(state, managerId, playerId, playerById);
  if (err) throw new Error(err);
  const slot = state.draft.order[state.draft.current];
  state.draft.picks.push({ ...slot, playerId });
  state.draft.taken[playerId] = managerId;
  getManager(state, managerId).squad.push(playerId);
  state.draft.current += 1;
  if (state.draft.current >= state.draft.order.length) finishDraft(state, playerById);
  return slot;
}

export function suggestPick(state, managerId, playerById, pool) {
  const rng = createRng(`${state.seed}|cpu-pick|${state.draft.current}`);
  return cpuChoosePick(state, managerId, playerById, pool, rng, state.form);
}

// Make picks for CPU managers until a human is on the clock (or limit reached).
export function runCpuPicks(state, playerById, pool, limit = Infinity) {
  let n = 0;
  while (state.phase === 'draft' && n < limit) {
    const slot = currentPickSlot(state);
    const m = getManager(state, slot.managerId);
    if (m.isHuman) break;
    makePick(state, m.id, suggestPick(state, m.id, playerById, pool), playerById);
    n++;
  }
  return n;
}

export function autoDraftAll(state, playerById, pool) {
  while (state.phase === 'draft') {
    const slot = currentPickSlot(state);
    makePick(state, slot.managerId, suggestPick(state, slot.managerId, playerById, pool), playerById);
  }
}

function finishDraft(state, playerById) {
  state.phase = 'season';
  for (const m of state.managers) for (const pid of m.squad) state.playerState[pid] = { condition: 100, injuredWeeks: 0 };
  const rng = createRng(`${state.seed}|schedule`);
  state.schedule = buildSchedule(rng.shuffle(state.managers.map((m) => m.id)));
  for (const w of state.schedule) {
    for (const mt of w.matches) state.matches[mt.id] = { id: mt.id, week: w.week, home: mt.home, away: mt.away, status: 'scheduled' };
  }
  for (const m of state.managers) {
    const { lineup, bench } = autoLineup({ squad: m.squad, formation: m.tactics.formation, playerById, playerState: state.playerState, formMap: state.form });
    m.tactics.lineup = lineup;
    m.tactics.bench = bench;
  }
}

// ---- tactics
export function setTactics(state, managerId, patch, playerById) {
  const m = getManager(state, managerId);
  const t = m.tactics;
  if (patch.formation && FORMATIONS[patch.formation] && patch.formation !== t.formation) {
    t.formation = patch.formation;
    const r = autoLineup({ squad: m.squad, formation: t.formation, playerById, playerState: state.playerState, formMap: state.form, rotation: 0.5 });
    t.lineup = r.lineup; t.bench = r.bench;
  }
  if (patch.style && TACTIC_STYLES[patch.style]) t.style = patch.style;
  if (typeof patch.autoManage === 'boolean') t.autoManage = patch.autoManage;
  if (Array.isArray(patch.subRules)) t.subRules = sanitizeRules(patch.subRules);
  if (Array.isArray(patch.lineup)) {
    const err = validateLineup({ lineup: patch.lineup, squad: m.squad, playerState: state.playerState, formation: t.formation });
    if (err) throw new Error(err);
    t.lineup = patch.lineup.map((l) => ({ slot: l.slot, playerId: l.playerId }));
    t.bench = availablePlayers(m.squad, state.playerState).filter((id) => !t.lineup.some((l) => l.playerId === id));
  }
}

export const RULE_TYPES = {
  fatigue: 'Kondisyon düşünce değiştir',
  minute: 'Belirli dakikada değiştir',
  losing: 'Geride isek değiştir',
  winning: 'Öndeysek değiştir',
  drawing: 'Berabereysek değiştir',
  yellow: 'Sarı kartlıyı değiştir',
};

export function sanitizeRules(rules) {
  return rules.filter((r) => r && RULE_TYPES[r.type]).slice(0, 8).map((r) => {
    const o = { type: r.type };
    if (r.type === 'fatigue') { o.threshold = clampInt(r.threshold, 30, 90, 60); o.fromMinute = clampInt(r.fromMinute, 46, 89, 60); }
    else if (r.type === 'yellow') { o.fromMinute = clampInt(r.fromMinute, 46, 89, 60); }
    else { o.minute = clampInt(r.minute, 46, 89, 65); o.outId = r.outId || null; o.inId = r.inId || null; }
    return o;
  });
}
function clampInt(v, a, b, d) { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(a, Math.min(b, n)) : d; }

export function autoPickLineup(state, managerId, playerById) {
  const m = getManager(state, managerId);
  const r = autoLineup({ squad: m.squad, formation: m.tactics.formation, playerById, playerState: state.playerState, formMap: state.form, rotation: 1 });
  m.tactics.lineup = r.lineup; m.tactics.bench = r.bench;
}

// ---- matches
export function weekOf(state, week) { return state.schedule.find((w) => w.week === week); }

export function nextMatch(state) {
  if (state.phase !== 'season') return null;
  const w = weekOf(state, state.currentWeek);
  if (!w) return null;
  const mt = w.matches.find((x) => state.matches[x.id].status !== 'finished');
  return mt ? state.matches[mt.id] : null;
}

function teamSnapshot(state, managerId, playerById) {
  const m = getManager(state, managerId);
  const t = m.tactics;
  let lineup = t.lineup;
  const notes = [];
  // CPU managers rotate automatically; humans keep their XI, injured players are auto-replaced.
  if (!m.isHuman) {
    const r = autoLineup({ squad: m.squad, formation: t.formation, playerById, playerState: state.playerState, formMap: state.form, rotation: 1 });
    lineup = r.lineup;
  } else if (!lineup || validateLineup({ lineup, squad: m.squad, playerState: state.playerState, formation: t.formation })) {
    const injuredOut = (lineup || []).filter((l) => l.playerId && state.playerState[l.playerId]?.injuredWeeks > 0).map((l) => l.playerId);
    const keep = (lineup || []).filter((l) => l.playerId && !injuredOut.includes(l.playerId));
    const r = autoLineup({ squad: m.squad, formation: t.formation, playerById, playerState: state.playerState, formMap: state.form, rotation: 0.6 });
    // keep the manager's choices where possible
    const fixed = r.lineup.map((l, i) => {
      const prev = keep.find((k) => k.slot === l.slot && (lineup || [])[i] && (lineup || [])[i].playerId === k.playerId);
      return prev || l;
    });
    const ids = new Set();
    lineup = fixed.every((l) => !ids.has(l.playerId) && ids.add(l.playerId)) ? fixed : r.lineup;
    if (injuredOut.length) notes.push(`${injuredOut.length} sakat oyuncu ilk 11'den otomatik çıkarıldı.`);
    m.tactics.lineup = lineup;
  }
  const inXI = new Set(lineup.map((l) => l.playerId));
  const bench = availablePlayers(m.squad, state.playerState).filter((id) => !inXI.has(id));
  const players = {};
  for (const pid of m.squad) players[pid] = { ...playerById[pid], condition: state.playerState[pid].condition };
  return {
    snapshot: {
      id: m.id, name: m.name, formation: t.formation, style: t.style,
      autoManage: m.isHuman ? t.autoManage : true,
      subRules: m.isHuman ? t.subRules : [],
      lineup: lineup.map((l) => ({ slot: l.slot, playerId: l.playerId })), bench, players,
    },
    notes,
  };
}

export function prepareMatchInput(state, matchId, playerById) {
  const mt = state.matches[matchId];
  const h = teamSnapshot(state, mt.home, playerById);
  const a = teamSnapshot(state, mt.away, playerById);
  const form = {};
  for (const pid of [...Object.keys(h.snapshot.players), ...Object.keys(a.snapshot.players)]) {
    if (state.form[pid]) form[pid] = { value: state.form[pid].value };
  }
  return { input: { seed: state.seed, matchId, home: h.snapshot, away: a.snapshot, form }, notes: [...h.notes, ...a.notes] };
}

// Plays and finalises a match exactly once.
export function playMatch(state, matchId, playerById) {
  const mt = state.matches[matchId];
  if (!mt) throw new Error('Maç bulunamadı.');
  if (mt.status === 'finished') throw new Error('Bu maç zaten oynandı ve sonucu kesinleşti.');
  if (state.phase !== 'season') throw new Error('Sezon aktif değil.');
  if (mt.week !== state.currentWeek) throw new Error('Bu maç bu haftanın maçı değil.');
  const { input, notes } = prepareMatchInput(state, matchId, playerById);
  const result = simulateMatch(input);
  mt.input = input;
  mt.result = result;
  mt.notes = notes;
  mt.status = 'finished';
  mt.playedAt = new Date().toISOString();
  for (const [pid, x] of Object.entries(result.playerStats)) {
    if (x.played && state.playerState[pid]) state.playerState[pid].condition = round1(x.endCondition);
  }
  const w = weekOf(state, mt.week);
  if (w.matches.every((x) => state.matches[x.id].status === 'finished')) closeWeek(state, mt.week, playerById);
  return mt;
}

export function replayMatch(state, matchId) {
  const mt = state.matches[matchId];
  if (!mt || mt.status !== 'finished') throw new Error('Tekrar için maç oynanmış olmalı.');
  return simulateMatch(mt.input);
}

function closeWeek(state, week, playerById) {
  const w = weekOf(state, week);
  const played = new Set();
  const newInjuries = {};
  const playingTeams = new Set();
  for (const x of w.matches) {
    const mt = state.matches[x.id];
    playingTeams.add(mt.home); playingTeams.add(mt.away);
    for (const [pid, ps] of Object.entries(mt.result.playerStats)) {
      if (ps.played) played.add(pid);
      if (ps.injured) newInjuries[pid] = ps.injuryWeeks;
    }
  }
  for (const m of state.managers) {
    for (const pid of m.squad) {
      const st = state.playerState[pid];
      let rec;
      if (!playingTeams.has(m.id)) rec = FITNESS.recoverBye;
      else if (played.has(pid)) rec = FITNESS.recoverAfterPlaying;
      else rec = FITNESS.recoverBench;
      st.condition = round1(Math.min(100, st.condition + rec));
      if (st.injuredWeeks > 0) st.injuredWeeks -= 1;
      if (newInjuries[pid]) st.injuredWeeks = newInjuries[pid];
    }
  }
  state.log.push({ week, bye: w.bye, at: new Date().toISOString() });
  state.currentWeek = week + 1;
  if (state.currentWeek > state.schedule.length) completeSeason(state, playerById);
}

function completeSeason(state, playerById) {
  if (state.bonusApplied) return;
  state.awards = computeAwards(state, playerById);
  state.bonusApplied = true;
  state.phase = 'finished';
  state.champion = standings(state)[0].managerId;
}

// Simulate everything that is left (used by "sezonu hızlı oynat" and tests)
export function playRemaining(state, playerById, untilWeek = Infinity) {
  let mt;
  while ((mt = nextMatch(state)) && mt.week <= untilWeek) playMatch(state, mt.id, playerById);
}

export function setForm(state, playerId, value, source = '', date = '') {
  if (value === null || value === '' || value === undefined) { delete state.form[playerId]; return; }
  const v = Number(value);
  if (!Number.isFinite(v) || v < 0 || v > 100) throw new Error('Form değeri 0-100 arasında olmalı.');
  state.form[playerId] = { value: Math.round(v), source: String(source).slice(0, 60), date: String(date).slice(0, 20) };
}

function round1(v) { return Math.round(v * 10) / 10; }

export { MAX_SUBS };
