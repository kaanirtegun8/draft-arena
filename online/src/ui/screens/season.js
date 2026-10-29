// End of season: awards, team of the season ("karma") and the champion.
import { h } from '../dom.js';
import { toArray } from '../../core/draft.js';
import { standings, seasonStats, BONUS } from '../../core/season.js';
import { topbar, seatLabel, openPlayerSheet } from '../components.js';
import { slotCoords } from './team.js';

export function renderAwards(ctx) {
  const { app } = ctx;
  const room = app.room;
  const api = app.api;
  const a = room.season && room.season.awards;
  const back = () => ctx.go('room', {});
  if (!a) return h('div', null, topbar('Ödüller', '', { back }), h('div', { class: 'card muted' }, 'Sezon bitince ödüller açıklanır.'));
  const stats = seasonStats(room);
  const card = (icon, title, aw, detail, bonus) => {
    if (!aw) return h('div', { class: 'card award' }, h('div', { class: 'trophy' }, icon), h('div', { class: 'grow' }, h('div', { class: 'small muted' }, title), 'Aday yok'));
    return h('button', { class: 'card award', style: { width: '100%', textAlign: 'left', color: 'inherit' }, onclick: () => openPlayerSheet(ctx, aw.pid) },
      h('div', { class: 'trophy' }, icon),
      h('div', { class: 'grow' }, h('div', { class: 'small muted' }, title), h('div', { class: 'name' }, api.byId[aw.pid].name), h('div', { class: 'small muted' }, (room.members[aw.seat] || {}).team || '', ' · ', detail(aw, stats[aw.pid] || {}))),
      bonus ? h('div', { class: 'bonus' }, `+${bonus} puan`) : null);
  };
  const karma = toArray(a.karma);
  const coords = slotCoords('4-3-3');
  // karma order: KL, SĞB, STP, STP, SLB, DOS, MO, OOS, SĞK, FV, SLK -> map to 4-3-3 slots (GK, LB, CB, CB, RB, CM, CDM, CM, LW, ST, RW)
  const map = { KL: 0, SLB: 1, STP: [2, 3], SĞB: 4, MO: 5, DOS: 6, OOS: 7, SLK: 8, FV: 9, SĞK: 10 };
  let stp = 0;
  const pitch = h('div', { class: 'pitch' }, karma.map((k) => {
    let idx = map[k.slot];
    if (Array.isArray(idx)) idx = idx[stp++] ?? 2;
    const c = coords[idx] || { x: 50, y: 50 };
    return h('button', { class: 'pslot', style: { left: `${c.x}%`, top: `${c.y}%` }, onclick: () => openPlayerSheet(ctx, k.pid) },
      h('div', { class: 'shirt', style: { background: (room.members[k.seat] || {}).color || '#888' } }, Number(k.avgRating).toFixed(1)),
      h('div', { class: 'pn' }, api.byId[k.pid].name.split(' ').slice(-1)[0]), h('span', { class: 'fitw', style: { color: '#fff' } }, k.slot));
  }));
  return h('div', null,
    topbar('Sezon ödülleri', room.public.name, { back }),
    card('👟', 'Gol Kralı', a.topScorer, (aw, s) => `${s.goals} gol · ${s.apps} maç`, BONUS.topScorer),
    card('🎯', 'Asist Kralı', a.topAssist, (aw, s) => `${s.assists} asist · ${s.apps} maç`, BONUS.topAssist),
    card('🧤', 'En İyi Kaleci', a.bestKeeper, (aw, s) => `ort. ${Number(s.avgRating).toFixed(2)} · ${s.cleanSheets} gol yemeden`),
    card('⭐', 'Sezonun Oyuncusu', a.playerOfSeason, (aw, s) => `ort. ${Number(s.avgRating).toFixed(2)} · ${s.goals} G · ${s.assists} A`),
    card('💎', 'Draftın En İyi Seçimi', a.bestPick, (aw) => `${aw.pick}. sırada seçildi, performansta ${aw.perfRank}. oldu`),
    h('div', { class: 'card' }, h('h3', null, 'Sezonun karması (4-3-3)'), pitch,
      h('div', { class: 'list' }, karma.map((k) => h('div', { class: 'item' }, h('b', { style: { width: '42px' } }, k.slot), h('div', { class: 'grow' }, h('div', { class: 'name' }, api.byId[k.pid].name), h('div', { class: 'meta' }, (room.members[k.seat] || {}).team || '')), h('b', null, Number(k.avgRating).toFixed(2)))))),
    h('button', { class: 'btn block primary', onclick: () => ctx.go('room', { sub: 'champion' }) }, 'Şampiyonluk ekranı →'));
}

export function renderChampion(ctx) {
  const { app } = ctx;
  const room = app.room;
  const back = () => ctx.go('room', {});
  if (!room.season || !room.season.finished) return h('div', null, topbar('Şampiyon', '', { back }), h('div', { class: 'card muted' }, 'Sezon henüz bitmedi.'));
  const rows = standings(room);
  const champ = room.members[room.season.champion] || {};
  const colors = ['#ffd166', '#22d3a6', '#ef4b5c', '#5aa9ff', '#9b5de5', '#fff'];
  const r1 = rows[0];
  return h('div', null,
    topbar('Şampiyon', room.public.name, { back }),
    h('div', { class: 'card champion' },
      Array.from({ length: 36 }, (_, i) => h('i', { class: 'confetti', style: { left: `${(i * 37) % 100}%`, background: colors[i % colors.length], animationDuration: `${2.5 + (i % 7) * 0.4}s`, animationDelay: `${(i % 9) * 0.25}s` } })),
      h('div', { class: 'cup' }, '🏆'), h('h2', null, champ.team || '—'), h('p', { class: 'muted' }, champ.name || ''),
      h('p', { class: 'muted' }, `${r1.total} puan (${r1.points} maç puanı + ${r1.bonus} bonus) · ${r1.won}G ${r1.drawn}B ${r1.lost}M · Averaj ${r1.gd > 0 ? '+' : ''}${r1.gd}`)),
    h('div', { class: 'card' }, h('h3', null, 'Final puan durumu (bonuslar dahil)'),
      h('div', { class: 'list' }, rows.map((r) => h('div', { class: 'item' },
        h('b', { style: { width: '24px' } }, r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : r.rank),
        h('div', { class: 'grow' }, seatLabel(room, r.seat, { me: ctx.seat }), h('div', { class: 'meta' }, `${r.points} maç + ${r.bonus} bonus · AV ${r.gd > 0 ? '+' : ''}${r.gd}`)),
        h('b', { style: { fontSize: '18px' } }, r.total))))),
    h('button', { class: 'btn block', onclick: () => ctx.go('room', { sub: 'awards' }) }, 'Ödüller ve karma'));
}
