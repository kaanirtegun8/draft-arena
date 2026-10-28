// End of season: awards and champion screen.
import { h } from '../dom.js';
import { getManager } from '../../core/league.js';
import { standings, seasonPlayerStats } from '../../core/stats.js';
import { AWARD_BONUS } from '../../core/config.js';
import { topbar, teamLabel, posBadge, openPlayerSheet } from '../components.js';
import { slotCoords } from './team.js';

export function renderAwards(ctx) {
  const { app } = ctx;
  const st = app.league;
  if (!st || st.phase !== 'finished' || !st.awards) { setTimeout(() => ctx.go('hub')); return h('div'); }
  const a = st.awards;
  const stats = seasonPlayerStats(st);
  const card = (icon, title, aw, detail, bonus) => {
    if (!aw) return h('div', { class: 'card award' }, h('div', { class: 'trophy' }, icon), h('div', { class: 'grow' }, h('div', { class: 'small muted' }, title), h('div', null, 'Aday yok')));
    const p = app.byId[aw.pid];
    return h('button', { class: 'card award', style: { width: '100%', textAlign: 'left', color: 'inherit' }, onclick: () => openPlayerSheet(ctx, aw.pid) },
      h('div', { class: 'trophy' }, icon),
      h('div', { class: 'grow' },
        h('div', { class: 'small muted' }, title),
        h('div', { class: 'name' }, p.name),
        h('div', { class: 'small muted' }, getManager(st, aw.managerId).name, ' · ', detail(aw, stats[aw.pid]))),
      bonus ? h('div', { class: 'bonus' }, `+${bonus} puan`) : null);
  };
  const tos = a.teamOfSeason;
  const order = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
  const slots = ['GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'CDM', 'CM', 'LW', 'ST', 'RW'];
  const sorted = tos.slice().sort((x, y) => order[x.group] - order[y.group]);
  const coords = slotCoords('4-3-3');
  const pitch = h('div', { class: 'pitch' }, sorted.map((r, i) => {
    const p = app.byId[r.pid];
    const c = coords[i];
    return h('button', { class: 'pslot', style: { left: `${c.x}%`, top: `${c.y}%` }, onclick: () => openPlayerSheet(ctx, r.pid) },
      h('div', { class: 'shirt', style: { background: getManager(st, r.managerId).color } }, r.avgRating.toFixed(1)),
      h('div', { class: 'pn' }, p.name.split(' ').slice(-1)[0]),
      h('span', { class: 'fitw', style: { color: '#fff' } }, slots[i]));
  }));
  const bp = a.bestPick;
  return h('div', null,
    topbar(ctx, 'Sezon Ödülleri', st.name, { back: () => ctx.go('hub') }),
    card('👟', 'Gol Kralı', a.topScorer, (aw, s) => `${s.goals} gol · ${s.apps} maç`, AWARD_BONUS.topScorer),
    card('🎯', 'Asist Kralı', a.topAssist, (aw, s) => `${s.assists} asist · ${s.apps} maç`, AWARD_BONUS.topAssist),
    card('🧤', 'En İyi Kaleci', a.bestKeeper, (aw, s) => `ort. ${s.avgRating.toFixed(2)} · ${s.cleanSheets} gol yemeden · ${s.saves} kurtarış`),
    card('⭐', 'Sezonun Oyuncusu', a.playerOfSeason, (aw, s) => `ort. ${s.avgRating.toFixed(2)} · ${s.goals} G · ${s.assists} A`),
    card('💎', 'En İyi Transfer (Draft) Seçimi', bp, (aw) => `${aw.pick}. sıradan seçildi, performansta ${aw.perfRank}. oldu`),
    h('div', { class: 'card' }, h('h3', null, 'Sezonun 11\'i (4-3-3)'), pitch,
      h('div', { class: 'list' }, sorted.map((r) => h('div', { class: 'item' }, posBadge({ pos: r.group === 'GK' ? 'GK' : r.group === 'DEF' ? 'CB' : r.group === 'MID' ? 'CM' : 'ST' }),
        h('div', { class: 'grow' }, h('div', { class: 'name' }, app.byId[r.pid].name), h('div', { class: 'meta' }, getManager(st, r.managerId).name)), h('b', null, r.avgRating.toFixed(2)))))),
    h('div', { class: 'card small muted' }, 'Bonus puanlar sadece sezon tamamlandıktan sonra eklendi: gol kralının takımı +2, asist kralının takımı +1. Eşitlikte daha az dakika oynayan, sonra daha çok asist/gol yapan öne geçer. Sezonun oyuncusu için en az 300 dakika gerekir.'),
    h('button', { class: 'btn block primary', onclick: () => ctx.go('champion') }, 'Şampiyonluk ekranı →'));
}

export function renderChampion(ctx) {
  const { app } = ctx;
  const st = app.league;
  if (!st || st.phase !== 'finished') { setTimeout(() => ctx.go('hub')); return h('div'); }
  app.ui.championSeen = true;
  const champ = getManager(st, st.champion);
  const rows = standings(st);
  const colors = ['#ffd166', '#22d3a6', '#ef4b5c', '#5aa9ff', '#9b5de5', '#fff'];
  const confetti = Array.from({ length: 36 }, (_, i) => h('i', { class: 'confetti', style: {
    left: `${(i * 37) % 100}%`, background: colors[i % colors.length], animationDuration: `${2.5 + (i % 7) * 0.4}s`, animationDelay: `${(i % 9) * 0.25}s`,
  } }));
  const r1 = rows[0];
  return h('div', null,
    topbar(ctx, 'Şampiyon', st.name, { back: () => ctx.go('hub') }),
    h('div', { class: 'card champion' }, confetti,
      h('div', { class: 'cup' }, '🏆'),
      h('h2', null, champ.name),
      h('p', { class: 'muted' }, `${r1.total} puan (${r1.points} maç puanı + ${r1.bonus} bonus) · ${r1.won}G ${r1.drawn}B ${r1.lost}M · Averaj ${r1.gd > 0 ? '+' : ''}${r1.gd}`),
      h('span', { class: 'dot', style: { background: champ.color, width: '18px', height: '18px' } })),
    h('div', { class: 'card' }, h('h3', null, 'Final puan durumu (bonuslar dahil)'),
      h('div', { class: 'list' }, rows.map((r) => h('div', { class: 'item' },
        h('b', { style: { width: '22px' } }, r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : r.rank),
        h('div', { class: 'grow' }, teamLabel(st, r.managerId), h('div', { class: 'meta' }, `${r.points} maç + ${r.bonus} bonus · AV ${r.gd > 0 ? '+' : ''}${r.gd}`)),
        h('b', { style: { fontSize: '18px' } }, r.total))))),
    h('div', { class: 'btns' },
      h('button', { class: 'btn', onclick: () => ctx.go('awards') }, 'Ödüller'),
      h('button', { class: 'btn', onclick: () => ctx.go('hub', { tab: 'stats' }) }, 'İstatistikler'),
      h('button', { class: 'btn primary', onclick: () => ctx.go('setup') }, 'Yeni lig')));
}
