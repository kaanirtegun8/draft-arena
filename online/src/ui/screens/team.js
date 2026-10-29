// Team & tactics: formation, instructions, XI on a pitch, sub rules and a live
// tactical analysis against the next opponent.
import { h, openSheet, closeSheet, toast, condBar, confirmSheet } from '../dom.js';
import { formationSlots, FORMATIONS, positionFit, roleOf, ROLES, ROLE_LABEL, isGK, SLOT_VARIANTS, POS_LABEL, altOf } from '../../core/positions.js';
import { ROLES as PLAYER_ROLES, rolesFor, roleFit, fitStars } from '../../core/roles.js';
import { abilities } from '../../core/abilities.js';
import { INSTRUCTIONS, defaultInstructions, teamUnits, analyse } from '../../core/tactics.js';
import { autoLineup, isAvailable } from '../../core/lineup.js';
import { squads, toArray, draftDone } from '../../core/draft.js';
import { playerStateBefore, matchesOfWeek, BENCH_SIZE, DISCIPLINE, seasonStats, tacticSlots, subPlanOf } from '../../core/season.js';
import { RULE_TYPES } from '../../core/rules.js';
import { MAX_SUBS } from '../../core/engine.js';
import { topbar, posBadge, openPlayerSheet, seatLabel, levelBadge } from '../components.js';
import { fmtValue } from '../../core/abilities.js';

const ROW_Y = { GK: 91, CB: 74, LB: 70, RB: 70, LWB: 60, RWB: 60, CDM: 58, CM: 47, LM: 42, RM: 42, CAM: 33, LW: 21, RW: 21, CF: 18, ST: 12 };
const SX = { L: 0, C: 1, R: 2 };

export function slotCoords(formation, customSlots) {
  const slots = customSlots || formationSlots(formation);
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
  const t = saved ? { ...saved, lineup: toArray(saved.lineup), subRules: toArray(saved.subRules), instructions: { ...defaultInstructions(), ...(saved.instructions || {}) }, slotCodes: { ...(saved.slotCodes || {}) }, roles: { ...(saved.roles || {}) }, subPlan: subPlanOf(saved) } : null;
  if (t) return { t, saved: true, sq, state };
  const formation = '4-3-3';
  const r = autoLineup({ squad: sq, formation, byId: app.api.byId, state, levelOf: app.api.levelOf });
  return { t: { formation, instructions: defaultInstructions(), lineup: r.lineup, subRules: [], autoManage: true, slotCodes: {}, roles: {}, subPlan: subPlanOf({}) }, saved: false, sq, state };
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
  const slots = tacticSlots(t);
  const coords = slotCoords(t.formation, slots);
  const save = (patch, msg) => ctx.run(async () => { await api.saveTactics(app.code, room, seat, { ...t, ...patch }); }, msg);
  const lineup = t.lineup;
  const inXI = new Set(lineup);
  const lineupProblems = lineup.filter((pid) => pid && !isAvailable(state[pid]));

  const pickForSlot = (i, tab = 'player') => openSlotSheet(ctx, { i, tab, t, slots, sq, state, lineup, inXI, save });

  const pitch = h('div', { class: 'pitch' }, lineup.map((pid, i) => {
    const p = api.byId[pid];
    if (!p) return h('button', { class: 'pslot', style: { left: `${coords[i].x}%`, top: `${coords[i].y}%` }, onclick: () => editable && pickForSlot(i) }, h('div', { class: 'shirt', style: { background: '#555' } }, slots[i].code), h('div', { class: 'pn' }, 'Boş'));
    const st = state[pid];
    const fit = positionFit(slots[i].code, p);
    const cond = st ? st.condition : 100;
    return h('button', { class: 'pslot', style: { left: `${coords[i].x}%`, top: `${coords[i].y}%` }, onclick: () => (editable ? pickForSlot(i) : openPlayerSheet(ctx, pid)) },
      h('div', { class: 'shirt', style: { background: member.color || '#e63946' } }, slots[i].code),
      h('div', { class: 'pn' }, p.name.split(' ').slice(-1)[0]),
      slots[i].role && PLAYER_ROLES[slots[i].role] ? h('span', { class: 'prole' }, shortRole(slots[i].role)) : null,
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
          save({ formation: f, lineup: r.lineup, slotCodes: {}, roles: {} }, `${f} dizilişine geçildi; ilk 11 yeniden kuruldu.`);
        } }, Object.keys(FORMATIONS).map((f) => h('option', { value: f, selected: f === t.formation }, f)))),
      ...Object.entries(INSTRUCTIONS).filter(([k]) => k !== 'strikers' || slots.filter((s) => s.code === 'ST').length >= 2).map(([k, def]) => h('label', { class: 'field' }, h('span', null, def.label),
        h('select', { class: 'input', disabled: !editable, onchange: (e) => save({ instructions: { ...t.instructions, [k]: e.target.value } }) },
          Object.entries(def.options).map(([v, l]) => h('option', { value: v, selected: t.instructions[k] === v }, l)))))),
    h('div', { class: 'row between' }, h('span', { class: 'small' }, 'Geride kalınca otomatik forvet sok (70. dk)'),
      h('div', { class: 'seg' }, [[true, 'Açık'], [false, 'Kapalı']].map(([v, l]) => h('button', { class: (t.autoManage !== false) === v ? 'on' : '', onclick: () => editable && save({ autoManage: v }) }, l)))),
    editable ? h('div', { class: 'btns mt' },
      h('button', { class: 'btn sm primary', onclick: () => {
        const r = autoLineup({ squad: sq, formation: t.formation, byId: api.byId, state, levelOf: api.levelOf, rotation: 1, slots });
        save({ lineup: r.lineup }, 'Kondisyon ve uyuma göre en iyi 11 kuruldu.');
      } }, 'Otomatik diz (rotasyon)')) : null);

  return h('div', null,
    topbar(member.team || 'Takımım', saved ? 'Taktik ve kadro' : 'Taktik henüz kaydedilmedi', { back }),
    !saved && editable ? h('div', { class: 'banner warn' }, 'Kadron henüz kaydedilmedi. Bir değişiklik yap veya "Otomatik diz" ile kaydet.') : null,
    lineupProblems.length ? h('div', { class: 'banner warn' }, `İlk 11'de oynayamayacak ${lineupProblems.length} oyuncu var (sakat/cezalı). Değiştirmezsen maçta otomatik yerine biri girer.`) : null,
    insCard,
    h('div', { class: 'small muted mb' }, editable ? 'Bir oyuncuya dokun: oyuncuyu değiştir, mevkisini (ör. MO → DOS) veya rolünü (ör. sahte 9, pres forvet, ön libero) seç.' : ''),
    pitch,
    analysisCard(ctx, seat, t, state),
    benchCard(ctx, sq, inXI, state),
    editable ? subPlanCard(ctx, t, sq, save) : null,
    editable && toArray(t.subRules).length ? oldRulesNote(t, save) : null,
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
  const view = (lineup, formation, custom) => (custom || formationSlots(formation)).map((s, i) => {
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
  const mine = teamUnits(view(t.lineup, t.formation, tacticSlots(t)), t.instructions);
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

const ROLE_SHORT_TR = { gk: '', sweeper: 'Libero KL', cb: '', bpd: 'Oyun kurucu', stopper: 'Sert', cover: 'Süpürücü', fb: '', dfb: 'Savunmacı', wbk: 'Bindiren', ifb: 'İçe kat', wbd: 'Savunmacı', wba: 'Hücumcu', anchor: 'Çapa', dlp: 'Regista', bwm: 'Top kapıcı', halfback: 'Pivot (inen)', b2b: 'B2B', cmp: 'Oyun kurucu', mezzala: 'Mezzala', cmd: 'Savunmacı', am: '10 numara', shadow: 'Gölge forvet', treq: 'Serbest', wm: '', dwm: 'Savunmacı', wp: 'Oyun kurucu', winger: 'Klasik kanat', inside: 'İçe kat eden', invw: 'Ters kanat', trackback: 'Savunmaya döner', complete: 'Komple', poacher: 'Golcü', target: 'Hedef', f9: 'Sahte 9', pressf: 'Pres', advanced: 'Arkaya koşan' };
function shortRole(key) { return ROLE_SHORT_TR[key] || (PLAYER_ROLES[key] ? PLAYER_ROLES[key].label.split(' ')[0] : ''); }

// Sheet for one position: change player, position variant or player role.
function openSlotSheet(ctx, { i, tab, t, slots, sq, state, lineup, inXI, save }) {
  const api = ctx.app.api;
  const slot = slots[i];
  const base = formationSlots(t.formation)[i].code;
  const pid = lineup[i];
  const p = api.byId[pid];
  const tabs = h('div', { class: 'chips mb' }, [['player', 'Oyuncu'], ['pos', 'Mevki'], ['role', 'Rol / görev']].map(([k, l]) =>
    h('button', { class: `chip ${tab === k ? 'on' : ''}`, onclick: () => openSlotSheet(ctx, { i, tab: k, t, slots, sq, state, lineup, inXI, save }) }, l)));
  let body;
  if (tab === 'pos') {
    const opts = SLOT_VARIANTS[base] || [base];
    body = h('div', null,
      h('p', { class: 'small muted' }, 'Bu pozisyonu dizilişin izin verdiği şekilde oynatabilirsin. Örneğin merkez orta sahayı ön libero (DOS) ya da on numara (OOS) olarak.'),
      h('div', { class: 'list' }, opts.map((code) => h('button', { class: 'item', onclick: () => {
        const sc = { ...(t.slotCodes || {}) };
        if (code === base) delete sc[i]; else sc[i] = code;
        const rl = { ...(t.roles || {}) };
        if (rl[i] && !rolesFor(code).includes(rl[i])) delete rl[i];
        closeSheet();
        save({ slotCodes: sc, roles: rl }, `${POS_LABEL[code]} olarak ayarlandı.`);
      } },
        posBadge({ pos: code }, code),
        h('div', { class: 'grow' }, h('div', { class: 'name' }, POS_LABEL[code] || code, code === slot.code ? ' (şu an)' : ''),
          p ? h('div', { class: 'meta' }, `${p.name} bu mevkide: uyum %${Math.round(positionFit(code, p) * 100)}`) : null)))));
  } else if (tab === 'role') {
    const ab = p ? abilities(p) : null;
    const opts = rolesFor(slot.code);
    body = h('div', null,
      h('p', { class: 'small muted' }, 'Rol, oyuncunun maçtaki görevini belirler. Yıldızlar oyuncunun o role uygunluğu: uygun oyuncu rolün avantajını tam alır, uygun olmayanda avantaj azalır ama bedeli yine ödenir.'),
      h('div', { class: 'list' },
        h('button', { class: 'item', onclick: () => { const rl = { ...(t.roles || {}) }; delete rl[i]; closeSheet(); save({ roles: rl }, 'Standart görev.'); } },
          h('div', { class: 'grow' }, h('div', { class: 'name' }, 'Standart', !slot.role ? ' (şu an)' : ''), h('div', { class: 'meta' }, 'Mevkinin klasik görevi, ek talimat yok.'))),
        opts.map((key) => {
          const r = PLAYER_ROLES[key];
          const fit = ab ? roleFit(key, ab) : 0.6;
          const stars = fitStars(fit);
          return h('button', { class: 'item', onclick: () => { const rl = { ...(t.roles || {}) }; rl[i] = key; closeSheet(); save({ roles: rl }, `${r.label} rolü verildi.`); } },
            h('div', { class: 'grow' },
              h('div', { class: 'name' }, r.label, key === slot.role ? ' (şu an)' : ''),
              h('div', { class: 'meta', style: { whiteSpace: 'normal' } }, r.desc)),
            h('div', { class: 'center', style: { minWidth: '62px' } }, h('div', { style: { color: stars >= 4 ? 'var(--accent)' : stars <= 2 ? 'var(--danger)' : 'var(--warn)', fontSize: '13px' } }, '★'.repeat(stars) + '☆'.repeat(5 - stars)), h('div', { class: 'mini' }, 'uygunluk')));
        })));
  } else {
    const cands = sq.map((id) => ({ id, p: api.byId[id], fit: positionFit(slot.code, api.byId[id]), lv: api.levelOf(api.byId[id]), st: state[id] }))
      .sort((a, b) => b.lv * b.fit - a.lv * a.fit);
    body = h('div', { class: 'list' }, cands.map((c) => {
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
          h('div', { class: 'meta' }, `Uyum %${Math.round(c.fit * 100)}${altOf(c.p).length ? ` · ${[c.p.pos, ...altOf(c.p)].join('/')}` : ''}${c.st ? ` · Kondisyon ${Math.round(c.st.condition)}` : ''}`, statusTags(c.st)),
          c.st ? condBar(c.st.condition, '110px') : null),
        h('div', { class: 'lvl' }, Math.round(c.lv * (0.55 + 0.45 * c.fit))));
    }));
  }
  openSheet(`${POS_LABEL[slot.code] || slot.code}${p ? ' · ' + p.name : ''}`, h('div', null, tabs, body));
}

// Simple substitution plan + up to 3 per-player exceptions.
function subPlanCard(ctx, t, sq, save) {
  const api = ctx.app.api;
  const plan = subPlanOf(t);
  const num = (v, a, b, f) => h('input', { class: 'input', type: 'number', min: a, max: b, value: v, onchange: (e) => f(e.target.value) });
  const setPlan = (patch) => save({ subPlan: { ...plan, ...patch } });
  const ex = plan.exceptions.slice();
  const xi = t.lineup.filter(Boolean);
  return h('div', { class: 'card' },
    h('h3', null, 'Oyuncu değişikliği planı'),
    h('p', { class: 'small muted' }, `Değişiklikleri tek tek yapman gerekmiyor: kondisyonu aşağıdaki değerin altına düşen oyuncu, belirlediğin dakikadan sonra çıkar ve yedeklerden o mevkiye en uygun oyuncu otomatik girer. Sakatlananlar her zaman değişir. En fazla ${MAX_SUBS} değişiklik.`),
    h('div', { class: 'grid2' },
      h('label', { class: 'field' }, h('span', null, 'Kondisyon şunun altına düşünce'), num(plan.threshold, 30, 95, (v) => setPlan({ threshold: Number(v) }))),
      h('label', { class: 'field' }, h('span', null, 'Şu dakikadan sonra'), num(plan.fromMinute, 30, 89, (v) => setPlan({ fromMinute: Number(v) })))),
    h('h3', { class: 'mt' }, 'İstisnalar (en fazla 3)'),
    ex.map((x, k) => h('div', { class: 'card', style: { background: 'var(--bg2)' } },
      h('div', { class: 'row between mb' }, h('b', null, api.byId[x.pid] ? api.byId[x.pid].name : '?'), h('button', { class: 'btn sm danger', onclick: () => { ex.splice(k, 1); setPlan({ exceptions: ex }); } }, 'Sil')),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', null, 'Kondisyon altı'), num(x.threshold, 0, 100, (v) => { ex[k] = { ...x, threshold: Number(v) }; setPlan({ exceptions: ex }); })),
        h('label', { class: 'field' }, h('span', null, 'Dakikadan sonra'), num(x.fromMinute, 1, 90, (v) => { ex[k] = { ...x, fromMinute: Number(v) }; setPlan({ exceptions: ex }); }))),
      h('p', { class: 'mini' }, 'İpucu: kondisyonu 0 yaparsan bu oyuncu yorulsa da oyundan çıkmaz.'))),
    ex.length < 3 ? h('div', { class: 'row mt' },
      h('select', { class: 'input grow', id: 'exsel' }, xi.filter((id) => !ex.some((x) => x.pid === id)).map((id) => h('option', { value: id }, `${api.byId[id].pos} ${api.byId[id].name}`))),
      h('button', { class: 'btn sm primary', onclick: () => { const v = document.getElementById('exsel').value; if (!v) return; ex.push({ pid: v, threshold: 50, fromMinute: 70 }); setPlan({ exceptions: ex }); } }, 'Ekle')) : null);
}

function oldRulesNote(t, save) {
  return h('div', { class: 'card small' }, `Eski sürümden ${toArray(t.subRules).length} özel değişiklik kuralın var; hâlâ geçerli.`,
    h('button', { class: 'btn sm mt', onclick: () => save({ subRules: [] }, 'Eski kurallar silindi.') }, 'Eski kuralları sil'));
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
