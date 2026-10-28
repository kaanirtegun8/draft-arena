// Team & tactics: formation, style, lineup on a pitch, bench, auto-sub rules, squad fitness.
import { h, openSheet, closeSheet, toast, condBar, seg } from '../dom.js';
import { getManager, setTactics, autoPickLineup, RULE_TYPES } from '../../core/league.js';
import { FORMATIONS, TACTIC_STYLES, positionFit, MAX_SUBS, FITNESS } from '../../core/config.js';
import { eaScore, groupOf, shortName } from '../../core/players.js';
import { availablePlayers } from '../../core/tactics.js';
import { seasonPlayerStats } from '../../core/stats.js';
import { topbar, posBadge, openPlayerSheet } from '../components.js';

const ROW_Y = { GK: 91, CB: 74, LB: 70, RB: 70, LWB: 60, RWB: 60, CDM: 58, CM: 47, LM: 42, RM: 42, CAM: 33, LW: 21, RW: 21, CF: 18, ST: 11 };
const SIDE = { LB: -1, LWB: -1, LM: -1, LW: -1, RB: 1, RWB: 1, RM: 1, RW: 1 };

export function slotCoords(formation) {
  const slots = FORMATIONS[formation];
  const rows = {};
  slots.forEach((s, i) => { const y = ROW_Y[s]; (rows[y] = rows[y] || []).push({ s, i }); });
  const pos = new Array(slots.length);
  for (const [y, items] of Object.entries(rows)) {
    items.sort((a, b) => (SIDE[a.s] || 0) - (SIDE[b.s] || 0) || a.i - b.i);
    items.forEach((it, k) => {
      let x = ((k + 1) / (items.length + 1)) * 100;
      if (items.length === 1 && SIDE[it.s]) x = SIDE[it.s] < 0 ? 15 : 85;
      if (items.length === 2 && SIDE[items[0].s] && SIDE[items[1].s]) x = k === 0 ? 15 : 85;
      pos[it.i] = { x, y: Number(y) };
    });
  }
  return pos;
}

export function renderTeam(ctx) {
  const { app } = ctx;
  const st = app.league;
  const m = st && getManager(st, app.params.id);
  if (!m) { setTimeout(() => ctx.go('hub')); return h('div'); }
  const editable = m.isHuman && st.phase === 'season';
  const t = m.tactics;
  const ui = app.ui.team || (app.ui.team = { sel: null });
  const stats = seasonPlayerStats(st);
  const back = () => (app.params.back ? ctx.go(app.params.back.view, app.params.back.params) : ctx.go('hub', { tab: 'teams' }));

  const lineup = t.lineup || [];
  const inXI = new Set(lineup.map((l) => l.playerId));
  const bench = availablePlayers(m.squad, st.playerState).filter((id) => !inXI.has(id));
  const injured = m.squad.filter((id) => st.playerState[id].injuredWeeks > 0);
  const coords = slotCoords(t.formation);

  const setLineup = (newLineup) => ctx.commit((s) => setTactics(s, m.id, { lineup: newLineup }, app.byId));

  const pickForSlot = (i) => {
    const slot = lineup[i].slot;
    const cands = availablePlayers(m.squad, st.playerState).map((id) => {
      const p = app.byId[id];
      return { id, p, fit: positionFit(slot, p), ea: eaScore(p, slot), cond: st.playerState[id].condition, inXI: inXI.has(id) };
    }).sort((a, b) => b.ea * b.fit - a.ea * a.fit);
    openSheet(`${slot} pozisyonu`, h('div', { class: 'list' }, cands.map((c) => h('button', { class: 'item', onclick: () => {
      const nl = lineup.map((l) => ({ ...l }));
      const j = nl.findIndex((l) => l.playerId === c.id);
      if (j >= 0) nl[j].playerId = nl[i].playerId; // swap positions
      nl[i].playerId = c.id;
      closeSheet();
      setLineup(nl);
    } },
      posBadge(c.p),
      h('div', { class: 'grow' },
        h('div', { class: 'name ellipsis' }, c.p.name, c.id === lineup[i].playerId ? ' (şu an)' : c.inXI ? ' · ilk 11' : ' · yedek'),
        h('div', { class: 'meta' }, `Uyum %${Math.round(c.fit * 100)} · Kondisyon ${Math.round(c.cond)}`),
        condBar(c.cond, '110px')),
      h('div', { class: 'ovr' }, Math.round(c.ea * c.fit))))));
  };

  const pitch = h('div', { class: 'pitch' }, lineup.map((l, i) => {
    const p = app.byId[l.playerId];
    if (!p) return null;
    const cond = st.playerState[l.playerId].condition;
    const fit = positionFit(l.slot, p);
    const c = coords[i];
    return h('button', { class: 'pslot', style: { left: `${c.x}%`, top: `${c.y}%` }, onclick: () => (editable ? pickForSlot(i) : openPlayerSheet(ctx, p.id)) },
      h('div', { class: 'shirt', style: { background: m.color } }, l.slot),
      h('div', { class: 'pn' }, shortName(p.name)),
      h('div', { class: 'pc' }, h('i', { style: { width: `${cond}%`, background: cond >= 75 ? '#22d3a6' : cond >= 55 ? '#f4c542' : '#ef4b5c' } })),
      fit < 0.9 ? h('span', { class: 'fitw' }, `uyum %${Math.round(fit * 100)}`) : null);
  }));

  const controls = editable ? h('div', { class: 'card' },
    h('div', { class: 'grid2' },
      h('label', { class: 'field' }, h('span', null, 'Diziliş'),
        h('select', { class: 'input', onchange: (e) => ctx.commit((s) => setTactics(s, m.id, { formation: e.target.value }, app.byId)) },
          Object.keys(FORMATIONS).map((f) => h('option', { value: f, selected: f === t.formation }, f)))),
      h('label', { class: 'field' }, h('span', null, 'Oyun stili'),
        h('select', { class: 'input', onchange: (e) => ctx.commit((s) => setTactics(s, m.id, { style: e.target.value }, app.byId)) },
          Object.entries(TACTIC_STYLES).map(([k, v]) => h('option', { value: k, selected: k === t.style }, v.label))))),
    h('p', { class: 'small muted' }, styleHelp(t.style)),
    h('div', { class: 'row between mb' }, h('span', { class: 'small' }, 'Otomatik menajer (yorulanları ve geride kalınca hücumcu değiştir)'),
      seg([[true, 'Açık'], [false, 'Kapalı']], t.autoManage, (v) => ctx.commit((s) => setTactics(s, m.id, { autoManage: v }, app.byId)))),
    h('div', { class: 'btns' },
      h('button', { class: 'btn sm primary', onclick: () => { ctx.commit((s) => autoPickLineup(s, m.id, app.byId)); toast('Kondisyona göre en iyi 11 kuruldu.', 'ok'); } }, 'Otomatik diz (rotasyon)'))) : h('div', { class: 'card small muted' },
    m.isHuman ? 'Sezon aktif değil; taktik değiştirilemez.' : `CPU menajer. Diziliş ${t.formation}, stil ${TACTIC_STYLES[t.style].label}. Her maçtan önce kondisyona göre rotasyonla ilk 11 kurar; aşağıdaki diziliş son önerilen kadrodur.`);

  const benchList = h('div', { class: 'card' }, h('h3', null, `Yedekler (${bench.length}) · maçta en fazla ${MAX_SUBS} değişiklik`),
    bench.length ? h('div', { class: 'list' }, bench.map((id) => squadItem(ctx, st, id, stats))) : h('div', { class: 'muted small' }, 'Yedek yok'),
    injured.length ? h('div', { class: 'mt' }, h('h3', null, 'Sakatlar'), h('div', { class: 'list' }, injured.map((id) => squadItem(ctx, st, id, stats)))) : null);

  return h('div', null,
    topbar(ctx, m.name, editable ? 'Taktik ve kadro' : 'Kadro', { back }),
    controls,
    h('div', { class: 'small muted mb' }, editable ? 'Bir pozisyona dokunup oyuncu seç (ilk 11 içindeki oyuncuyla yer değiştirir).' : ''),
    pitch,
    lowCondWarning(st, lineup),
    benchList,
    editable ? rulesEditor(ctx, st, m) : null,
    h('div', { class: 'card' }, h('h3', null, 'Tüm kadro'), h('div', { class: 'list' },
      m.squad.slice().sort((a, b) => ['GK', 'DEF', 'MID', 'FWD'].indexOf(groupOf(app.byId[a])) - ['GK', 'DEF', 'MID', 'FWD'].indexOf(groupOf(app.byId[b])) || app.byId[b].ovr - app.byId[a].ovr)
        .map((id) => squadItem(ctx, st, id, stats)))));
}

function lowCondWarning(st, lineup) {
  const low = lineup.filter((l) => l.playerId && st.playerState[l.playerId].condition < FITNESS.lowConditionWarn);
  if (!low.length) return null;
  return h('div', { class: 'card', style: { borderColor: 'var(--warn)' } }, h('span', { class: 'tag warn' }, 'Uyarı'), ` İlk 11'de kondisyonu ${FITNESS.lowConditionWarn}'ın altında ${low.length} oyuncu var. Performansları düşer ve sakatlık riski artar.`);
}

function squadItem(ctx, st, id, stats) {
  const p = ctx.app.byId[id];
  const ps = st.playerState[id];
  const s = stats[id];
  return h('button', { class: 'item', onclick: () => openPlayerSheet(ctx, id) },
    posBadge(p),
    h('div', { class: 'grow' },
      h('div', { class: 'name ellipsis' }, p.name, ps.injuredWeeks > 0 ? h('span', { class: 'tag danger', style: { marginLeft: '6px' } }, `Sakat ${ps.injuredWeeks}h`) : null),
      h('div', { class: 'meta' }, s ? `${s.apps} maç · ${s.goals} G · ${s.assists} A · ort ${s.apps ? s.avgRating.toFixed(1) : '—'}` : ''),
      condBar(ps.condition, '110px')),
    h('div', { class: 'center' }, h('div', { class: 'ovr' }, p.ovr), h('div', { class: 'small muted' }, Math.round(ps.condition))));
}

function styleHelp(style) {
  return {
    balanced: 'Dengeli: artı/eksi yok.',
    attacking: 'Hücum: daha çok pozisyon, savunma zayıflar, biraz daha yorar. Şut/dripling yüksek oyunculara uyar.',
    defensive: 'Savunma: az pozisyon verir ve az bulur. Defans/fizik güçlü kadrolara uyar.',
    counter: 'Kontra: topa daha az sahip olur ama etkili hücum eder. Hızlı oyunculara uyar.',
    press: 'Yüksek pres: hücum ve savunma artar, kondisyon çok daha hızlı düşer, faul artar.',
  }[style];
}

function rulesEditor(ctx, st, m) {
  const { app } = ctx;
  const t = m.tactics;
  const rules = t.subRules.map((r) => ({ ...r }));
  const save = (nr) => ctx.commit((s) => setTactics(s, m.id, { subRules: nr }, app.byId));
  const xi = (t.lineup || []).map((l) => l.playerId).filter(Boolean);
  const bench = availablePlayers(m.squad, st.playerState).filter((id) => !xi.includes(id));
  const playerSel = (ids, value, onChange, emptyLabel) => h('select', { class: 'input', onchange: (e) => onChange(e.target.value || null) },
    h('option', { value: '' }, emptyLabel), ids.map((id) => h('option', { value: id, selected: id === value }, `${app.byId[id].pos} ${app.byId[id].name}`)));
  const numInput = (value, min, max, onChange) => h('input', { class: 'input', type: 'number', min, max, value, onchange: (e) => onChange(e.target.value) });

  const ruleCard = (r, i) => {
    const upd = (patch) => { rules[i] = { ...rules[i], ...patch }; save(rules); };
    const fields = [];
    if (r.type === 'fatigue') {
      fields.push(h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', null, 'Kondisyon altı'), numInput(r.threshold, 30, 90, (v) => upd({ threshold: v }))),
        h('label', { class: 'field' }, h('span', null, 'Şu dakikadan sonra'), numInput(r.fromMinute, 46, 89, (v) => upd({ fromMinute: v })))));
    } else if (r.type === 'yellow') {
      fields.push(h('label', { class: 'field' }, h('span', null, 'Şu dakikadan sonra'), numInput(r.fromMinute, 46, 89, (v) => upd({ fromMinute: v }))));
    } else {
      fields.push(h('label', { class: 'field' }, h('span', null, 'Dakika'), numInput(r.minute, 46, 89, (v) => upd({ minute: v }))),
        h('div', { class: 'grid2' },
          h('label', { class: 'field' }, h('span', null, 'Çıkacak'), playerSel(xi, r.outId, (v) => upd({ outId: v }), 'Seç…')),
          h('label', { class: 'field' }, h('span', null, 'Girecek'), playerSel(bench, r.inId, (v) => upd({ inId: v }), 'En uygun yedek'))));
      if (r.outId && !xi.includes(r.outId)) fields.push(h('div', { class: 'tag warn' }, 'Çıkacak oyuncu şu an ilk 11\'de değil; kural uygulanmaz.'));
    }
    return h('div', { class: 'card', style: { background: 'var(--bg2)' } },
      h('div', { class: 'row between mb' }, h('b', null, `${i + 1}. ${RULE_TYPES[r.type]}`),
        h('button', { class: 'btn sm danger', onclick: () => { rules.splice(i, 1); save(rules); } }, 'Sil')),
      fields);
  };
  const addSel = h('select', { class: 'input grow' }, Object.entries(RULE_TYPES).map(([k, v]) => h('option', { value: k }, v)));
  return h('div', { class: 'card' },
    h('h3', null, 'Otomatik değişiklik kuralları'),
    h('p', { class: 'small muted' }, `Maçtan önce belirlenir; maç sırasında sırayla kontrol edilir. Sakatlanan oyuncu her zaman değiştirilir. Toplam en fazla ${MAX_SUBS} değişiklik ve devre arası hariç 3 duraklama yapılabilir.`),
    rules.map(ruleCard),
    rules.length < 8 ? h('div', { class: 'row mt' }, addSel, h('button', { class: 'btn sm primary', onclick: () => {
      const type = addSel.value;
      const base = type === 'fatigue' ? { type, threshold: 60, fromMinute: 60 } : type === 'yellow' ? { type, fromMinute: 60 } : { type, minute: 65, outId: null, inId: null };
      rules.push(base); save(rules);
    } }, 'Ekle')) : null);
}
