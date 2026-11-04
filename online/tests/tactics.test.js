import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateMatch } from '../src/core/engine.js';
import { teamUnits, analyse, defaultInstructions, INSTRUCTIONS } from '../src/core/tactics.js';
import { styleStrength, styleReport, STYLE_KEYS } from '../src/core/styles.js';
import { ageDrain, ageRecovery } from '../src/core/fitness.js';
import { formationSlots, roleOf } from '../src/core/positions.js';
import { liveWeeks } from '../src/ui/livestate.js';
import { POOL, byId, makeRoom, startLeague } from './helpers.js';

const SLOT_ROLE = { GK: 'GK', CB: 'CB', RB: 'RB', LB: 'LB', CDM: 'CDM', CM: 'CM', CAM: 'CAM', RM: 'RW', LM: 'LW', RW: 'RW', LW: 'LW', ST: 'ST' };
// XI for a formation; sort decides who is picked per position (best first)
function xi(formation, { sort = {}, roles = {}, skip = new Set() } = {}) {
  const used = new Set(skip);
  const slots = formationSlots(formation).map((s) => ({ ...s, role: roles[s.code] || null }));
  const lineup = slots.map((s) => {
    const want = SLOT_ROLE[s.code];
    const f = sort[s.code] || ((a, b) => b.ovr - a.ovr);
    const p = POOL.filter((x) => roleOf(x) === want && !used.has(x.id)).sort(f)[0];
    used.add(p.id);
    return p;
  });
  return { slots, lineup, used };
}
const view = (t) => t.lineup.map((p, i) => ({ slot: t.slots[i], player: p, level: p.ovr, cond: 100, day: 1 }));
const units = (t, ins) => teamUnits(view(t), ins);
const wingQ = (p) => p.pac + p.dri + p.pas;

test('play style strength follows the players: great wingers make wing play strong, poor ones weak', () => {
  const opp = xi('4-3-3');
  const good = xi('4-3-3', { sort: { LW: (a, b) => wingQ(b) - wingQ(a), RW: (a, b) => wingQ(b) - wingQ(a) }, skip: opp.used });
  const poor = xi('4-3-3', { sort: { LW: (a, b) => wingQ(a) - wingQ(b), RW: (a, b) => wingQ(a) - wingQ(b) }, skip: opp.used });
  const ins = { ...defaultInstructions(), style: 'wing' };
  const sGood = styleStrength('wing', units(good, ins).men, units(opp, defaultInstructions()).men, ins).s;
  const sPoor = styleStrength('wing', units(poor, ins).men, units(opp, defaultInstructions()).men, ins).s;
  assert.ok(sGood > sPoor + 0.2, `iyi kanatlar ${sGood} / zayıf kanatlar ${sPoor}`);
  // the effect on the flanks: a lift with good wingers, a loss with poor ones (vs balanced)
  const flank = (t, insX) => { const a = analyse(units(t, insX), units(opp, defaultInstructions()), insX, defaultInstructions()); return a.att.L + a.att.R; };
  assert.ok(flank(good, ins) > flank(good, defaultInstructions()) * 1.05, 'iyi kanatlarla kanat oyunu kanat hücumunu artırır');
  assert.ok(flank(poor, ins) < flank(poor, defaultInstructions()) * 1.03, 'zayıf kanatlarla kanat oyunu pek işe yaramaz');
  const rep = styleReport(units(good, ins), units(opp, defaultInstructions()), ins, defaultInstructions());
  assert.equal(rep.length, STYLE_KEYS.length - 1);
  assert.ok(rep.every((r) => r.stars >= 1 && r.stars <= 5 && r.why));
});

test('passing game: a passing midfield keeps the ball much better, a poor one loses it', () => {
  const pass = (p) => p.pas + p.dri;
  const opp = xi('4-3-3');
  const good = xi('4-3-3', { sort: { CM: (a, b) => pass(b) - pass(a), CDM: (a, b) => pass(b) - pass(a) }, skip: opp.used });
  const poor = xi('4-3-3', { sort: { CM: (a, b) => pass(a) - pass(b), CDM: (a, b) => pass(a) - pass(b) }, skip: opp.used });
  const ins = { ...defaultInstructions(), style: 'possession' };
  const oU = units(opp, defaultInstructions());
  const control = (t, insX) => analyse(units(t, insX), oU, insX, defaultInstructions()).control;
  const gain = (t) => control(t, ins) / control(t, defaultInstructions());
  assert.ok(gain(good) > 1.08, `pasçı orta saha: top hakimiyeti x${gain(good).toFixed(3)}`);
  assert.ok(gain(poor) < gain(good) - 0.06, `zayıf pasçılar x${gain(poor).toFixed(3)} / iyi pasçılar x${gain(good).toFixed(3)}`);
});

test('role combinations have real effects: a false nine needs runners', () => {
  const opp = xi('4-3-3');
  const ins = defaultInstructions();
  const oU = units(opp, ins);
  const withRunners = xi('4-3-3', { roles: { ST: 'f9', LW: 'inside', RW: 'inside' }, skip: opp.used });
  const without = xi('4-3-3', { roles: { ST: 'f9', LW: 'trackback', RW: 'trackback' }, skip: opp.used });
  const a = analyse(units(withRunners, ins), oU, ins, ins);
  const b = analyse(units(without, ins), oU, ins, ins);
  assert.ok(a.att.C > b.att.C * 1.1, `koşucularla merkez ${a.att.C.toFixed(1)} / koşucusuz ${b.att.C.toFixed(1)}`);
  assert.ok(a.notes.some((n) => n.kind === 'good' && /Sahte 9/.test(n.text)));
  assert.ok(b.notes.some((n) => n.kind === 'warn' && /Sahte 9/.test(n.text)));
});

test('every instruction option runs through the engine', () => {
  const H = xi('4-3-3'), A = xi('4-2-3-1', { skip: H.used });
  const side = (t, id, ins) => { const players = {}; for (const p of t.lineup) players[p.id] = { ...p, level: p.ovr, condition: 100 }; return { id, name: id, formation: '4-3-3', slots: t.slots, instructions: ins, lineup: t.lineup.map((p) => p.id), bench: [], players, autoManage: false, subRules: [] }; };
  for (const [k, d] of Object.entries(INSTRUCTIONS)) for (const v of Object.keys(d.options)) {
    const r = simulateMatch({ seed: `i-${k}-${v}`, matchId: 'm', home: side(H, 'H', { ...defaultInstructions(), [k]: v }), away: side(A, 'A', defaultInstructions()) });
    assert.ok(Number.isFinite(r.teamStats.home.xg) && r.homeGoals >= 0, `${k}=${v}`);
  }
});

test('age: a 34-year-old can play two full matches in a row without collapsing', () => {
  const perMatch = 92 * 0.28 * (1.3 - 0.75 * 0.6) * ageDrain(34); // stamina 75, 90+2 minutes
  let c = 100;
  c -= perMatch;
  assert.ok(c >= 78, `1. maç sonu ${c.toFixed(1)}`);
  c = Math.min(100, c + ageRecovery(34, 'played'));
  assert.ok(c >= 85, `2. maç başı ${c.toFixed(1)}`);
  assert.ok(ageDrain(24) < ageDrain(30) && ageDrain(30) < ageDrain(34), 'yaşlılar yine daha çabuk yorulur');
  assert.ok(ageRecovery(24) > ageRecovery(34));
});

test('penalties and red cards happen at a lively but realistic rate', () => {
  let pens = 0, reds = 0, n = 0;
  for (let i = 0; i < 250; i++) {
    const H = xi(['4-3-3', '4-2-3-1', '4-4-2'][i % 3]), A = xi('4-3-3', { skip: H.used });
    const side = (t, id, f) => { const players = {}; for (const p of t.lineup) players[p.id] = { ...p, level: p.ovr, condition: 100 }; return { id, name: id, formation: f, slots: t.slots, instructions: defaultInstructions(), lineup: t.lineup.map((p) => p.id), bench: [], players, autoManage: false, subRules: [] }; };
    const r = simulateMatch({ seed: 'pen' + i, matchId: 'm', home: side(H, 'H', '4-3-3'), away: side(A, 'A', '4-3-3') });
    pens += r.events.filter((e) => e.type === 'penalty').length;
    reds += r.events.filter((e) => e.type === 'red').length;
    n++;
  }
  assert.ok(pens / n > 0.33 && pens / n < 0.7, `penaltı/maç ${pens / n}`);
  assert.ok(reds / n > 0.15 && reds / n < 0.5, `kırmızı/maç ${reds / n}`);
});

test('admin can end the live broadcast for everyone; unknown instructions are not saved', async () => {
  const ctx = await makeRoom(4);
  let room = await startLeague(ctx);
  await ctx.admin.playWeek(ctx.code, room);
  room = await ctx.read();
  assert.deepEqual(liveWeeks(room, Date.now()), [1]);
  await ctx.admin.endBroadcast(ctx.code, room, 1);
  room = await ctx.read();
  assert.deepEqual(liveWeeks(room, Date.now()), []);
  assert.ok(room.season.matches && Object.keys(room.season.matches).length === 2, 'sonuçlar duruyor');
  // instructions: only known options are stored
  const seat = Object.keys(room.members).find((s) => room.members[s].uid === 'u2');
  const api = ctx.apis.u2;
  const { squads } = await import('../src/core/draft.js');
  const sq = squads(room.draft)[seat];
  const { autoLineup } = await import('../src/core/lineup.js');
  const lineup = autoLineup({ squad: sq, formation: '4-3-3', byId, state: {}, levelOf: (p) => p.ovr }).lineup;
  await api.saveTactics(ctx.code, room, seat, { formation: '4-3-3', lineup, instructions: { style: 'wing', tempo: 'turbo', hack: 'x' } });
  room = await ctx.read();
  const ins = room.tactics[seat].instructions;
  assert.equal(ins.style, 'wing');
  assert.equal(ins.tempo, 'normal');
  assert.equal(ins.hack, undefined);
});
