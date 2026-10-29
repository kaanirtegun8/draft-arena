// Team & tactics: formation, instructions, XI on a pitch, sub rules and a live
// tactical analysis against the next opponent.
import { h, openSheet, closeSheet, toast, condBar, confirmSheet } from '../dom.js';
import { formationSlots, FORMATIONS, positionFit, roleOf, ROLES, ROLE_LABEL, isGK } from '../../core/positions.js';
import { INSTRUCTIONS, defaultInstructions, teamUnits, analyse } from '../../core/tactics.js';
import { autoLineup, isAvailable } from '../../core/lineup.js';
import { squads, toArray, draftDone } from '../../core/draft.js';
import { playerStateBefore, matchesOfWeek, BENCH_SIZE, DISCIPLINE, seasonStats } from '../../core/season.js';
import { RULE_TYPES } from '../../core/rules.js';
import { MAX_SUBS } from '../../core/engine.js';
import { topbar, posBadge, openPlayerSheet, seatLabel, levelBadge } from '../components.js';
import { fmtValue } from '../../core/abilities.js';

const ROW_Y = { GK: 91, CB: 74, LB: 70, RB: 70, LWB: 60, RWB: 60, CDM: 58, CM: 47, LM: 42, RM: 42, CAM: 33, LW: 21, RW: 21, CF: 18, ST: 12 };
const SX = { L: 0, C: 1, R: 2 };

export function slotCoords(formation) {
  const slots = formationSlots(formation);
  const rows = {};
  slots.forEach((s, i) => { (rows[ROW_Y[s.code]] = rows[ROW_Y[s.code]] || []).push({ ...s, i }); });
  const pos = [];
  for (const [y, items] of Object.entries(rows)) {
    items.sort((a, b) => SX[a.side] - SX[b.side] || a.i - b.i);
    items.forEach((it, k) => {
      let x = ((k + 1) / (items.length + 1)) * 100;
      if (items.length === 1 && it.side !== 'C') x = it.side === 'L' ? 14 : 86;
      if (items.length === 2 && items[0].side === 'L' && items[1].side === 'R' && ['LB', 'LWB', 'LM', 'LW'].includes(items[0].code)) x = k === 0 ? 14 : 86;
      pos[it.i] = { x, y: Number(y) };
    });
  }
  return pos;
}

export function currentTactics(ctx, seat) {
  const { app } = ctx;
  const room = app.room;
  const saved = room.tactics && room.tactics[seat];
  const sq = squads(room.draft)[seat] || [];
  const state = room.season ? playerStateBefore(room, room.season.currentWeek) : {};
  const t = saved ? { ...saved, lineup: toArray(saved.lineup), subRules: toArray(saved.subRules), instructions: { ...defaultInstructions(), ...(saved.instructions || {}) } } : null;
  if (t) return { t, saved: true, sq, state };
  const formation = '4-3-3';
  const r = autoLineup({ squad: sq, formation, byId: app.api.byId, state, levelOf: app.api.levelOf });
  return { t: { formation, instructions: defaultInstructions(), lineup: r.lineup, subRules: [], autoManage: true }, saved: false, sq, state };
}

export function renderTeam(ctx) {
  const { app } = ctx;
  const room = app.room;
  const api = app.api;
  const seat = app.params.seat || ctx.seat;
  const mine = seat === ctx.seat;
  const member = room.members[seat] || {};
  const back = () => ctx.go('room', {});
  if (!mine) return otherTeam(ctx, seat, back);
  const { t, saved, sq, state } = currentTactics(ctx, seat);
  const finished = room.public.status === 'finished';
  const editable = !finished;
  const slots = formationSlots(t.formation);
  const coords = slotCoords(t.formation);
  const save = (patch, msg) => ctx.run(async () => { await api.saveTactics(app.code, room, seat, { ...t, ...patch }); }, msg);
  const lineup = t.lineup;
  const inXI = new Set(lineup);
  const lineupProblems = lineup.filter((pid) => pid && !isAvailable(state[pid]));

  const pickForSlot = (i) => {
    const code = slots[i].code;
    const cands = sq.map((id) => ({ id, p: api.byId[id], fit: positionFit(code, api.byId[id]), lv: api.levelOf(api.byId[id]), st: state[id] }))
      .sort((a, b) => b.lv * b.fit - a.lv * a.fit);
    openSheet(`${code} pozisyonu`, h('div', { class: 'list' }, cands.map((c) => {
      const unavailable = !isAvailable(c.st);
      return h('button', { class: 'item', disabled: unavailable, style: unavailable ? { opacity: 0.5 } : null, onclick: () => {
        const nl = lineup.slice();
        const j = nl.indexOf(c.id);
        if (j >= 0) nl[j] = nl[i];
        nl[i] = c.id;
        closeSheet();
        save({ lineup: nl });
      } },
        posBadge(c.p),
        h('div', { class: 'grow' },
          h('div', { class: 'name ellipsis' }, c.p.name, c.id === lineup[i] ? ' (şu an)' : inXI.has(c.id) ? ' · ilk 11' : ''),
          h('div', { class: 'meta' }, `Uyum %${Math.round(c.fit * 100)}${c.p.foot ? ` · ${c.p.foot === 'L' ? 'sol' : 'sağ'} ayak` : ''}${c.st ? ` · Kondisyon ${Math.round(c.st.condition)}` : ''}`, statusTags(c.st)),
          c.st ? condBar(c.st.condition, '110px') : null),
        h('div', { class: 'lvl' }, Math.round(c.lv * (0.55 + 0.45 * c.fit))));
    })));
  };

  const pitch = h('div', { class: 'pitch' }, lineup.map((pid, i) => {
    const p = api.byId[pid];
    if (!p) return h('button', { class: 'pslot', style: { left: `${coords[i].x}%`, top: `${coords[i].y}%` }, onclick: () => editable && pickForSlot(i) }, h('div', { class: 'shirt', style: { background: '#555' } }, slots[i].code), h('div', { class: 'pn' }, 'Boş'));
    const st = state[pid];
    const fit = positionFit(slots[i].code, p);
    const cond = st ? st.condition : 100;
    return h('button', { class: 'pslot', style: { left: `${coords[i].x}%`, top: `${coords[i].y}%` }, onclick: () => (editable ? pickForSlot(i) : openPlayerSheet(ctx, pid)) },
      h('div', { class: 'shirt', style: { background: member.color || '#e63946' } }, slots[i].code),
      h('div', { class: 'pn' }, p.name.split(' ').slice(-1)[0]),
      h('div', { class: 'pc' }, h('i', { style: { width: `${cond}%`, background: cond >= 75 ? '#22d3a6' : cond >= 55 ? '#f4c542' : '#ef4b5c' } })),
      fit < 0.9 ? h('span', { class: 'fitw' }, `uyum %${Math.round(fit * 100)}`) : null,
      !isAvailable(st) ? h('span', { class: 'fitw', style: { color: '#ef4b5c' } }, st.banned > 0 ? 'CEZALI' : 'SAKAT') : null);
  }));

  const insCard = h('div', { class: 'card' },
    h('div', { class: 'grid2' },
      h('label', { class: 'field' }, h('span', null, 'Diziliş'),
        h('select', { class: 'input', disabled: !editable, onchange: (e) => {
          const f = e.target.value;
          const r = autoLineup({ squad: sq, formation: f, byId: api.byId, state, levelOf: api.levelOf, rotation: 0.5 });
          save({ formation: f, lineup: r.lineup }, `${f} dizilişine geçildi; ilk 11 yeniden kuruldu.`);
        } }, Object.keys(FORMATIONS).map((f) => h('option', { value: f, selected: f === t.formation }, f)))),
      ...Object.entries(INSTRUCTIONS).filter(([k]) => k !== 'strikers' || slots.filter((s) => s.code === 'ST').length >= 2).map(([k, def]) => h('label', { class: 'field' }, h('span', null, def.label),
        h('select', { class: 'input', disabled: !editable, onchange: (e) => save({ instructions: { ...t.instructions, [k]: e.target.value } }) },
          Object.entries(def.options).map(([v, l]) => h('option', { value: v, selected: t.instructions[k] === v }, l)))))),
    h('div', { class: 'row between' }, h('span', { class: 'small' }, 'Otomatik değişiklik (yorulanlar, geride kalınca forvet)'),
      h('div', { class: 'seg' }, [[true, 'Açık'], [false, 'Kapalı']].map(([v, l]) => h('button', { class: (t.autoManage !== false) === v ? 'on' : '', onclick: () => editable && save({ autoManage: v }) }, l)))),
    editable ? h('div', { class: 'btns mt' },
      h('button', { class: 'btn sm primary', onclick: () => {
        const r = autoLineup({ squad: sq, formation: t.formation, byId: api.byId, state, levelOf: api.levelOf, rotation: 1 });
        save({ lineup: r.lineup }, 'Kondisyon ve uyuma göre en iyi 11 kuruldu.');
      } }, 'Otomatik diz (rotasyon)')) : null);

  return h('div', null,
    topbar(member.team || 'Takımım', saved ? 'Taktik ve kadro' : 'Taktik henüz kaydedilmedi', { back }),
    !saved && editable ? h('div', { class: 'banner warn' }, 'Kadron henüz kaydedilmedi. Bir değişiklik yap veya "Otomatik diz" ile kaydet.') : null,
    lineupProblems.length ? h('div', { class: 'banner warn' }, `İlk 11'de oynayamayacak ${lineupProblems.length} oyuncu var (sakat/cezalı). Değiştirmezsen maçta otomatik yerine biri girer.`) : null,
    insCard,
    h('div', { class: 'small muted mb' }, editable ? 'Bir pozisyona dokun, oyuncu seç (ilk 11 içindeki oyuncuyla yer değiştirir).' : ''),
    pitch,
    analysisCard(ctx, seat, t, state),
    benchCard(ctx, sq, inXI, state),
    editable ? rulesCard(ctx, t, sq, inXI, save) : null,
    squadCard(ctx, sq, state));
}

function statusTags(st) {
  if (!st) return null;
  return [
    st.injuredWeeks > 0 ? h('span', { class: 'tag danger', style: { marginLeft: '6px' } }, `sakat ${st.injuredWeeks}h`) : null,
    st.banned > 0 ? h('span', { class: 'tag danger', style: { marginLeft: '6px' } }, `cezalı ${st.banned}m`) : null,
    st.yellows === DISCIPLINE.yellowsForBan - 1 ? h('span', { class: 'tag warn', style: { marginLeft: '6px' } }, 'ceza sınırında 🟨') : null,
  ];
}

// Analysis of my XI against the next opponent (or a reference 4-3-3)
function analysisCard(ctx, seat, t, state) {
  const { app } = ctx;
  const room = app.room;
  const api = app.api;
  const view = (lineup, formation) => formationSlots(formation).map((s, i) => {
    const p = api.byId[lineup[i]];
    return p ? { slot: s, player: p, level: api.levelOf(p), cond: state[p.id] ? state[p.id].condition : 100, day: 1 } : null;
  }).filter(Boolean);
  let opp = null, oppSeat = null;
  if (room.season && !room.season.finished) {
    const m = matchesOfWeek(room.season, room.season.currentWeek).find((x) => x.home === seat || x.away === seat);
    if (m) {
      oppSeat = m.home === seat ? m.away : m.home;
      // the opponent's real tactics stay secret: assume their best XI in a balanced 4-3-3
      const osq = squads(room.draft)[oppSeat] || [];
      const ol = autoLineup({ squad: osq, formation: '4-3-3', byId: api.byId, state, levelOf: api.levelOf }).lineup;
      opp = { formation: '4-3-3', lineup: ol, ins: defaultInstructions() };
    }
  }
  if (!opp) {
    // reference opponent: the average squad in the pool playing a balanced 4-3-3
    const ref = room.draft ? Object.values(squads(room.draft)).flat().filter((id) => !squads(room.draft)[seat].includes(id)) : [];
    const r = autoLineup({ squad: ref, formation: '4-3-3', byId: api.byId, state: {}, levelOf: api.levelOf });
    opp = { formation: '4-3-3', lineup: r.lineup, ins: defaultInstructions() };
  }
  const mine = teamUnits(view(t.lineup, t.formation), t.instructions);
  const theirs = teamUnits(view(opp.lineup, opp.formation), opp.ins);
  const a = analyse(mine, theirs, t.instructions, opp.ins);
  const b = analyse(theirs, mine, opp.ins, t.instructions);
  const bar = (label, mv, tv) => h('div', null,
    h('div', { class: 'statrow' }, h('span', { class: 'v' }, mv.toFixed(0)), h('span', { class: 'lbl' }, label), h('span', { class: 'v' }, tv.toFixed(0))),
    h('div', { class: 'splitbar' }, h('i', { style: { width: `${(mv / (mv + tv)) * 100}%`, background: 'var(--accent)' } }), h('i', { style: { width: `${(tv / (mv + tv)) * 100}%`, background: 'var(--danger)' } })));
  return h('div', { class: 'card' },
    h('h3', null, 'Taktik analizi'),
    h('div', { class: 'small muted mb' }, oppSeat ? h('span', null, 'Bu haftaki rakip: ', seatLabel(room, oppSeat), ' (taktiği gizli; en iyi 11\'i 4-3-3 varsayıldı)') : 'Ortalama bir rakibe (4-3-3) göre'),
    bar('Sol kanat hücumun / onların sağ savunması', a.att.L, b.def.R),
    bar('Merkez hücumun / onların merkez savunması', a.att.C, b.def.C),
    bar('Sağ kanat hücumun / onların sol savunması', a.att.R, b.def.L),
    bar('Orta saha hakimiyeti', a.control, b.control),
    bar('Senin sol savunman / onların sağ hücumu', a.def.L, b.att.R),
    bar('Senin merkez savunman / onların merkez hücumu', a.def.C, b.att.C),
    bar('Senin sağ savunman / onların sol hücumu', a.def.R, b.att.L),
    h('div', { class: 'mt' }, a.notes.length ? a.notes.map((n) => h('div', { class: 'note' }, h('span', { class: 'ni' }, n.kind === 'good' ? '✅' : n.kind === 'warn' ? '⚠️' : 'ℹ️'), h('span', null, n.text))) : h('div', { class: 'small muted' }, 'Belirgin bir yapısal zaaf yok.')),
    h('p', { class: 'mini mt' }, 'Maçta takımlar rakibin zayıf olduğu bölgeden daha çok atak yapar. Değerler mevki uyumu, kondisyon ve güncel seviyeyi içerir.'));
}

function benchCard(ctx, sq, inXI, state) {
  const api = ctx.app.api;
  const avail = sq.filter((id) => !inXI.has(id) && isAvailable(state[id])).sort((a, b) => api.levelOf(api.byId[b]) - api.levelOf(api.byId[a]));
  const bench = avail.slice(0, BENCH_SIZE);
  if (!bench.some((id) => isGK(api.byId[id]))) { const gk = avail.find((id) => isGK(api.byId[id])); if (gk) { bench.pop(); bench.push(gk); } }
  const out = sq.filter((id) => !inXI.has(id) && !bench.includes(id));
  return h('div', { class: 'card' },
    h('h3', null, `Yedekler (${bench.length}) · maçta en fazla ${MAX_SUBS} değişiklik`),
    h('div', { class: 'list' }, bench.map((id) => sqItem(ctx, id, state))),
    out.length ? h('div', { class: 'mt' }, h('h3', null, 'Kadro dışı'), h('div', { class: 'list' }, out.map((id) => sqItem(ctx, id, state)))) : null);
}

function sqItem(ctx, id, state, extra) {
  const api = ctx.app.api;
  const p = api.byId[id];
  const st = state[id];
  return h('button', { class: 'item', onclick: () => openPlayerSheet(ctx, id) },
    posBadge(p),
    h('div', { class: 'grow' }, h('div', { class: 'name ellipsis' }, p.name, statusTags(st)), extra || h('div', { class: 'meta' }, `${ROLE_LABEL[roleOf(p)]} · ${fmtValue(p.mv)}`), st ? condBar(st.condition, '110px') : null),
    levelBadge(api.levelOf(p), p.ovr));
}

function squadCard(ctx, sq, state) {
  const api = ctx.app.api;
  const stats = ctx.app.room.season ? seasonStats(ctx.app.room) : null;
  return h('div', { class: 'card' }, h('h3', null, 'Tüm kadro'),
    h('div', { class: 'list' }, ROLES.flatMap((r) => sq.filter((id) => roleOf(api.byId[id]) === r)).map((id) => sqItem(ctx, id, state,
      stats && stats[id] ? h('div', { class: 'meta' }, `${stats[id].apps} maç · ${stats[id].goals} G · ${stats[id].assists} A · ort ${stats[id].apps ? stats[id].avgRating.toFixed(1) : '—'} · 🟨${stats[id].yellow}`) : null))));
}

function rulesCard(ctx, t, sq, inXI, save) {
  const api = ctx.app.api;
  const rules = (t.subRules || []).map((r) => ({ ...r }));
  const xi = t.lineup.filter(Boolean);
  const bench = sq.filter((id) => !inXI.has(id));
  const sel = (ids, value, onChange, empty) => h('select', { class: 'input', onchange: (e) => onChange(e.target.value || null) },
    h('option', { value: '' }, empty), ids.map((id) => h('option', { value: id, selected: id === value }, `${api.byId[id].pos} ${api.byId[id].name}`)));
  const num = (v, a, b, f) => h('input', { class: 'input', type: 'number', min: a, max: b, value: v, onchange: (e) => f(e.target.value) });
  const card = (r, i) => {
    const upd = (patch) => { rules[i] = { ...rules[i], ...patch }; save({ subRules: rules }); };
    let fields;
    if (r.type === 'fatigue') fields = h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', null, 'Kondisyon altı'), num(r.threshold, 30, 90, (v) => upd({ threshold: v }))), h('label', { class: 'field' }, h('span', null, 'Dakikadan sonra'), num(r.fromMinute, 46, 89, (v) => upd({ fromMinute: v }))));
    else if (r.type === 'yellow') fields = h('label', { class: 'field' }, h('span', null, 'Dakikadan sonra'), num(r.fromMinute, 46, 89, (v) => upd({ fromMinute: v })));
    else fields = h('div', null, h('label', { class: 'field' }, h('span', null, 'Dakika'), num(r.minute, 46, 89, (v) => upd({ minute: v }))),
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', null, 'Çıkacak'), sel(xi, r.outId, (v) => upd({ outId: v }), 'Seç…')), h('label', { class: 'field' }, h('span', null, 'Girecek'), sel(bench, r.inId, (v) => upd({ inId: v }), 'En uygun yedek'))));
    return h('div', { class: 'card', style: { background: 'var(--bg2)' } },
      h('div', { class: 'row between mb' }, h('b', null, `${i + 1}. ${RULE_TYPES[r.type]}`), h('button', { class: 'btn sm danger', onclick: () => { rules.splice(i, 1); save({ subRules: rules }); } }, 'Sil')), fields);
  };
  const add = h('select', { class: 'input grow' }, Object.entries(RULE_TYPES).map(([k, v]) => h('option', { value: k }, v)));
  return h('div', { class: 'card' },
    h('h3', null, 'Maç öncesi değişiklik kuralları'),
    h('p', { class: 'small muted' }, `Maç sırasında sırayla kontrol edilir. Sakatlanan oyuncu her zaman değişir. En fazla ${MAX_SUBS} değişiklik ve devre arası hariç 3 duraklama.`),
    rules.map(card),
    rules.length < 8 ? h('div', { class: 'row mt' }, add, h('button', { class: 'btn sm primary', onclick: () => {
      const type = add.value;
      rules.push(type === 'fatigue' ? { type, threshold: 60, fromMinute: 60 } : type === 'yellow' ? { type, fromMinute: 60 } : { type, minute: 65 });
      save({ subRules: rules });
    } }, 'Ekle')) : null);
}

function otherTeam(ctx, seat, back) {
  const { app } = ctx;
  const room = app.room;
  const sq = squads(room.draft)[seat] || [];
  const state = room.season ? playerStateBefore(room, room.season.currentWeek) : {};
  const m = room.members[seat] || {};
  const lv = sq.reduce((a, id) => a + app.api.levelOf(app.api.byId[id]), 0) / Math.max(1, sq.length);
  const value = sq.reduce((a, id) => a + (app.api.byId[id].mv || 0), 0);
  return h('div', null,
    topbar(m.team || seat, `${m.name || ''} · kadro`, { back }),
    h('div', { class: 'card' }, h('div', { class: 'kpi' },
      h('div', null, h('b', null, lv.toFixed(1)), h('span', null, 'Ort. seviye')),
      h('div', null, h('b', null, fmtValue(value)), h('span', null, 'Kadro değeri')),
      h('div', null, h('b', null, sq.length), h('span', null, 'Oyuncu'))),
      h('p', { class: 'mini mt' }, 'Rakiplerin taktiği ve ilk 11\'i maç başlayana kadar gizlidir.')),
    squadCard(ctx, sq, state));
}

export { draftDone, confirmSheet, toast };
