// Shared UI pieces for the online game.
import { h, openSheet, condBar, ratingClass } from './dom.js';
import { roleOf, ROLE_SHORT, LINE_OF_ROLE, isGK, altOf } from '../core/positions.js';
import { currentLevel, abilities, fmtValue, formRating, workRates, workRateLabel } from '../core/abilities.js';
import { seasonStats, playerStateBefore, DISCIPLINE } from '../core/season.js';
import { squads } from '../core/draft.js';
import { lineChart } from './charts.js';

const LINE_CLASS = { GK: 'pos-GK', DEF: 'pos-DEF', MID: 'pos-MID', ATT: 'pos-FWD' };

export function posBadge(p, code) {
  const role = code ? roleOf({ pos: code }) : roleOf(p);
  return h('span', { class: `badge ${LINE_CLASS[LINE_OF_ROLE[role]]}`, title: ROLE_SHORT[role] }, code || p.pos);
}

export function topbar(title, sub, { back, right } = {}) {
  return h('div', { class: 'topbar' },
    back ? h('button', { class: 'iconbtn', 'aria-label': 'Geri', onclick: back }, '‹') : null,
    h('h1', null, title, sub ? h('span', { class: 'sub' }, sub) : null),
    right || null);
}

export function seatLabel(room, seat, { right = false, me = null } = {}) {
  const m = (room.members || {})[seat];
  if (!m) return h('span', { class: 'muted' }, '—');
  const dot = h('span', { class: 'dot', style: { background: m.color || '#888' } });
  return h('span', { class: 'row', style: { gap: '6px', display: 'inline-flex', minWidth: 0, justifyContent: right ? 'flex-end' : 'flex-start' } },
    right ? null : dot, h('span', { class: 'ellipsis' }, m.team || m.name, me === seat ? ' (sen)' : ''), right ? dot : null);
}

export function tabbar(items, active, onSelect) {
  return h('nav', { class: 'tabbar' }, h('div', { class: 'inner' },
    items.map(([key, icon, label, badge]) => h('button', { class: key === active ? 'on' : '', onclick: () => onSelect(key) },
      h('span', { class: 'ic' }, icon, badge ? h('sup', { style: { color: 'var(--danger)', fontSize: '10px' } }, '●') : null), label))));
}

export function levelInfo(api, p, room) {
  return currentLevel(p, api.model, room && room.formOverrides ? room.formOverrides[p.id] : undefined);
}

export function levelBadge(lv, ovr) {
  const d = lv - ovr;
  return h('span', { class: `lvl ${d >= 1 ? 'up' : d <= -1 ? 'down' : ''}`, title: 'Güncel seviye (EA + form + piyasa değeri)' }, lv.toFixed(0));
}

export function formChip(p) {
  const f = p.form;
  if (!f || typeof f.rating !== 'number') return h('span', { class: 'tag' }, 'form —');
  const cls = f.rating >= 7.3 ? 'ok' : f.rating >= 6.8 ? '' : 'danger';
  return h('span', { class: `tag ${cls}`, title: `${f.apps} maç ortalaması` }, `form ${f.rating.toFixed(1)}`);
}

export function playerRow(api, p, { onClick, right, extra, cls = '', room } = {}) {
  const li = levelInfo(api, p, room);
  return h(onClick ? 'button' : 'div', { class: `item ${cls}`, onclick: onClick },
    posBadge(p),
    h('div', { class: 'grow' },
      h('div', { class: 'name ellipsis' }, p.name),
      h('div', { class: 'meta ellipsis' }, `${p.club || ''} · ${p.age || '?'} · ${fmtValue(p.mv)}`),
      extra || h('div', { class: 'row', style: { gap: '6px', marginTop: '3px' } }, formChip(p), h('span', { class: 'mini' }, `EA ${p.ovr}`))),
    right !== undefined ? right : levelBadge(li.level, p.ovr));
}

export function ratingBadge(r) {
  return h('span', { class: ratingClass(r) }, Number(r).toFixed(1));
}

const ATTR_GROUPS = [
  ['Hız', [['acc', 'Hızlanma'], ['spr', 'Sprint']]],
  ['Hücum', [['fin', 'Bitiricilik'], ['pos', 'Pozisyon alma'], ['spw', 'Şut gücü'], ['lsh', 'Uzaktan şut'], ['hea', 'Kafa']]],
  ['Pas', [['vis', 'Vizyon'], ['spa', 'Kısa pas'], ['lpa', 'Uzun pas'], ['cro', 'Orta']]],
  ['Top tekniği', [['dri', 'Dripling'], ['bco', 'Top kontrolü'], ['agi', 'Çeviklik'], ['com', 'Soğukkanlılık']]],
  ['Savunma', [['daw', 'Savunma bilinci'], ['stt', 'Ayakta müdahale'], ['slt', 'Kayarak müdahale'], ['int', 'Top kapma']]],
  ['Fizik', [['sta', 'Dayanıklılık'], ['str', 'Güç'], ['jmp', 'Zıplama'], ['agg', 'Agresiflik']]],
  ['Kalecilik', [['gkdiv', 'Uçma'], ['gkhan', 'Elle kontrol'], ['gkpos', 'Pozisyon'], ['gkref', 'Refleks'], ['gkkic', 'Vuruş']]],
];

export function openPlayerSheet(ctx, pid, { actions } = {}) {
  const { api } = ctx.app;
  const room = ctx.app.room;
  const p = api.byId[pid];
  if (!p) return;
  const li = levelInfo(api, p, room);
  const sq = room && room.draft ? squads(room.draft) : {};
  const ownerSeat = Object.keys(sq).find((s) => sq[s].includes(pid));
  const inSeason = room && room.season;
  const st = inSeason ? playerStateBefore(room, room.season.currentWeek)[pid] : null;
  const stats = inSeason ? seasonStats(room)[pid] : null;
  const ab = abilities(p);
  const parts = [];
  parts.push(h('div', { class: 'row mb' }, posBadge(p),
    h('div', { class: 'grow' }, h('div', { class: 'name' }, p.name),
      h('div', { class: 'muted small' }, [p.club, p.league, p.nat, p.age && `${p.age} yaş`, p.height && `${p.height} cm`, p.foot && (p.foot === 'L' ? 'Sol ayak' : 'Sağ ayak')].filter(Boolean).join(' · '),
        altOf(p).length ? ` · Alt mevki: ${altOf(p).join(', ')}` : '')),
    h('div', { class: 'center' }, h('div', { class: 'ovr', style: { fontSize: '26px' } }, li.level.toFixed(0)), h('div', { class: 'mini' }, 'güncel'))));
  parts.push(h('div', { class: 'card' }, h('h3', null, 'Güncel seviye nasıl hesaplandı?'),
    h('div', { class: 'kpi' },
      h('div', null, h('b', null, p.ovr), h('span', null, 'EA FC (%40)')),
      h('div', null, h('b', null, li.hasForm ? li.parts.form.toFixed(1) : '—'), h('span', null, li.hasForm ? 'Form (%35)' : 'Form yok · nötr')),
      h('div', null, h('b', null, li.hasMv ? li.parts.mv.toFixed(1) : '—'), h('span', null, li.hasMv ? `Değer ${fmtValue(p.mv)} (%25)` : 'Değer yok · nötr'))),
    h('p', { class: 'mini mt' }, 'Eksik veri nötr sayılır (EA puanı kullanılır). Maçta ayrıca mevki uyumu, kondisyon, taktik yapı ve rakip etkiler.')));
  if (p.form && typeof p.form.rating === 'number') {
    const last = Array.isArray(p.form.last) ? p.form.last : Object.values(p.form.last || {});
    parts.push(h('div', { class: 'card' }, h('h3', null, `Gerçek form · ${p.form.season || ''}`),
      h('div', { class: 'kpi mb' },
        h('div', null, h('b', null, p.form.rating.toFixed(2)), h('span', null, `${p.form.apps} maç ort.`)),
        h('div', null, h('b', null, `${p.form.goals ?? '—'} / ${p.form.assists ?? '—'}`), h('span', null, 'Gol / Asist')),
        h('div', null, h('b', null, p.form.minutes ?? '—'), h('span', null, 'Dakika'))),
      last.length ? lineChart([{ label: 'Puan', color: '#22d3a6', points: last.map((r, i) => ({ x: i + 1, y: r })) }], { yMin: 5, yMax: 10, yTicks: [6, 7, 8, 9], xLabel: (x) => `${x}.`, height: 120 }) : null,
      h('p', { class: 'mini' }, `Kaynak: ${p.form.source || '—'} · ${p.form.date || ''}`)));
  } else parts.push(h('div', { class: 'card small muted' }, 'Bu oyuncu için gerçek form verisi yok; nötr değerlendiriliyor.'));
  if (st) {
    parts.push(h('div', { class: 'card' }, h('h3', null, 'Ligdeki durumu'),
      h('div', { class: 'row between mb' }, h('span', null, 'Kondisyon'), h('b', null, Math.round(st.condition))), condBar(st.condition),
      h('div', { class: 'row wrap mt', style: { gap: '6px' } },
        st.injuredWeeks > 0 ? h('span', { class: 'tag danger' }, `Sakat · ${st.injuredWeeks} hafta`) : null,
        st.banned > 0 ? h('span', { class: 'tag danger' }, `Cezalı · ${st.banned} maç`) : null,
        h('span', { class: 'tag' }, `Sarı kart serisi ${st.yellows}/${DISCIPLINE.yellowsForBan}`),
        h('span', { class: 'tag' }, `Toplam 🟨${st.totalYellow} 🟥${st.totalRed}`))));
  }
  if (stats && stats.apps) {
    const pts = stats.ratings.map((r) => ({ x: r.week, y: r.rating }));
    parts.push(h('div', { class: 'card' }, h('h3', null, 'Bu sezon (form grafiği)'),
      lineChart([{ label: 'Maç puanı', color: '#5aa9ff', points: pts }], { yMin: 4, yMax: 10, yTicks: [5, 6, 7, 8, 9], xLabel: (x) => `H${x}`, band: [6.5, 7.5], height: 130 }),
      h('div', { class: 'grid2 mt' }, [
        ['Maç', stats.apps], ['İlk 11', stats.starts], ['Dakika', stats.minutes], ['Gol', stats.goals], ['Asist', stats.assists], ['Şut / İsabet', `${stats.shots} / ${stats.sot}`],
        ['Ort. puan', stats.avgRating.toFixed(2)], ['Maçın oyuncusu', stats.motm], ...(isGK(p) ? [['Kurtarış', stats.saves], ['Yenilen', stats.conceded], ['Gol yemeden', stats.cleanSheets]] : []),
      ].map(([k, v]) => h('div', { class: 'row between small' }, h('span', { class: 'muted' }, k), h('b', null, v))))));
  }
  const a = p.a || {};
  const hasDetail = Object.keys(a).length > 0;
  parts.push(h('div', { class: 'card' }, h('h3', null, hasDetail ? 'EA FC özellikleri' : 'EA FC kart değerleri'),
    h('div', { class: 'row wrap mb', style: { gap: '6px' } },
      ...(() => { const wr = workRates(p); return [
        h('span', { class: 'tag' }, `Hücum çalışkanlığı: ${workRateLabel(wr.att)}${wr.estimated ? ' (tahmini)' : ''}`),
        h('span', { class: `tag ${wr.def < 0.5 ? 'warn' : ''}` }, `Savunmaya yardım: ${workRateLabel(wr.def)}${wr.estimated ? ' (tahmini)' : ''}`)]; })(),
      p.weakFoot ? h('span', { class: 'tag' }, `Zayıf ayak ${p.weakFoot}★`) : null,
      p.skillMoves ? h('span', { class: 'tag' }, `Yetenek ${p.skillMoves}★`) : null),
    hasDetail
      ? ATTR_GROUPS.filter(([g]) => (g === 'Kalecilik') === isGK(p) || g === 'Fizik').map(([g, items]) => h('div', { class: 'attrgroup' }, h('h4', null, g),
        items.filter(([k]) => typeof a[k] === 'number').map(([k, label]) => h('div', { class: 'attrline' },
          h('div', null, h('div', { class: 'row between' }, h('span', null, label), h('span', { class: 'muted' }, '')), condBar(a[k])), h('b', null, a[k])))))
      : h('div', { class: 'attrs' }, (isGK(p) ? [['DIV', p.div], ['TUT', p.han], ['VUR', p.kic], ['REF', p.ref], ['HIZ', p.spd], ['POZ', p.gkp]] : [['HIZ', p.pac], ['ŞUT', p.sho], ['PAS', p.pas], ['DRİ', p.dri], ['DEF', p.def], ['FİZ', p.phy]]).map(([k, v]) => h('div', { class: 'attr' }, h('b', null, v), h('span', null, k)))),
    h('div', { class: 'mini mt' }, `Maç motoru için: hız ${ab.pace.toFixed(0)} · bitiricilik ${ab.finishing.toFixed(0)} · yaratıcılık ${ab.creation.toFixed(0)} · savunma ${ab.defending.toFixed(0)} · hava (savunma) ${ab.aerialDef.toFixed(0)} · pres ${ab.pressing.toFixed(0)}`)));
  if (ownerSeat) parts.unshift(h('div', { class: 'small muted mb' }, 'Takım: ', seatLabel(room, ownerSeat)));
  if (actions) parts.splice(1, 0, h('div', { class: 'btns mb' }, actions));
  openSheet(p.name, h('div', null, parts));
}

export function emptyState(text) { return h('div', { class: 'card muted small center' }, text); }

export { fmtValue, formRating, ROLE_SHORT };
