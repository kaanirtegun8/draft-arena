// League hub: week results, table + points chart, fixtures, statistics, teams.
import { h, confirmSheet, openSheet, closeSheet, toast } from '../dom.js';
import { toArray, squads } from '../../core/draft.js';
import { standings, seasonStats, weeksOf, matchesOfWeek, playerStateBefore, finishedMatches, DISCIPLINE } from '../../core/season.js';
import { roleOf, isGK } from '../../core/positions.js';
import { topbar, tabbar, seatLabel, posBadge, openPlayerSheet } from '../components.js';
import { lineChart } from '../charts.js';
import { claimsCard, notifyCard } from './lobby.js';

export function renderLeague(ctx) {
  const { app } = ctx;
  const room = app.room;
  const season = room.season;
  const tab = app.ui.leagueTab || 'week';
  const total = weeksOf(season).length;
  const finished = !!season.finished;
  const header = topbar(room.public.name, finished ? 'Sezon tamamlandı' : `${season.currentWeek}. hafta / ${total}`, {
    right: h('button', { class: 'iconbtn', 'aria-label': 'Menü', onclick: () => openMenu(ctx) }, '☰'),
  });
  let body;
  if (tab === 'table') body = tableView(ctx);
  else if (tab === 'fixtures') body = fixturesView(ctx);
  else if (tab === 'stats') body = statsView(ctx);
  else if (tab === 'teams') body = teamsView(ctx);
  else body = weekView(ctx);
  return h('div', null, header, claimsCard(ctx), body,
    tabbar([['week', '🗓️', 'Hafta'], ['table', '🏆', 'Puan'], ['stats', '📈', 'İstatistik'], ['fixtures', '📅', 'Fikstür'], ['teams', '👥', 'Takımlar']], tab,
      (k) => { app.ui.leagueTab = k; ctx.render(); window.scrollTo(0, 0); }));
}

function openMenu(ctx) {
  const { app } = ctx;
  openSheet('Menü', h('div', { class: 'stack' },
    h('button', { class: 'btn block', onclick: () => ctx.go('room', { sub: 'team', seat: ctx.seat }) }, '⚙️ Takımım / taktik'),
    app.room.season.finished ? h('button', { class: 'btn block', onclick: () => ctx.go('room', { sub: 'awards' }) }, '🏅 Sezon ödülleri ve karma') : null,
    app.room.season.finished ? h('button', { class: 'btn block', onclick: () => ctx.go('room', { sub: 'champion' }) }, '🏆 Şampiyonluk ekranı') : null,
    h('div', null, notifyCard(ctx)),
    h('button', { class: 'btn block ghost', onclick: () => { closeSheet(); ctx.leaveRoom(); } }, '⎋ Bu cihazda odadan çık')));
}

function goalLine(room, api, m) {
  const goals = toArray(m.goals);
  const side = (s) => goals.filter((g) => g.side === s).map((g) => h('div', null, '⚽ ', h('b', null, api.byId[g.playerId] ? api.byId[g.playerId].name : '?'), ` ${g.label}'`, g.penalty ? ' (pen)' : '',
    g.assistId && api.byId[g.assistId] ? h('span', null, ' · asist: ', api.byId[g.assistId].name) : null));
  const cards = toArray(m.cards).filter((c) => c.type === 'red');
  return h('div', { class: 'grid2 goalline mt' },
    h('div', null, side('home'), cards.filter((c) => c.side === 'home').map((c) => h('div', null, '🟥 ', api.byId[c.playerId].name, ` ${c.label}'`))),
    h('div', { style: { textAlign: 'right' } }, side('away'), cards.filter((c) => c.side === 'away').map((c) => h('div', null, '🟥 ', api.byId[c.playerId].name, ` ${c.label}'`))));
}

function matchCard(ctx, m, result) {
  const { app } = ctx;
  const room = app.room;
  return h('button', { class: 'card', style: { width: '100%', textAlign: 'left', color: 'inherit', display: 'block' }, onclick: () => result && ctx.go('room', { sub: 'match', id: m.id }) },
    h('div', { class: 'fixture', style: { border: 0, padding: 0, minHeight: 0 } },
      h('div', { class: 'h' }, seatLabel(room, m.home, { right: true, me: ctx.seat })),
      h('div', { class: `sc ${result ? '' : 'pending'}` }, result ? `${result.homeGoals} - ${result.awayGoals}` : 'vs'),
      h('div', { class: 'a' }, seatLabel(room, m.away, { me: ctx.seat }))),
    result ? goalLine(room, app.api, result) : null,
    result ? h('div', { class: 'mini center mt' }, 'Maçın oyuncusu: ', app.api.byId[result.motm] ? app.api.byId[result.motm].name : '—', ' · detay ve maç izleme için dokun') : null);
}

function weekView(ctx) {
  const { app } = ctx;
  const room = app.room;
  const season = room.season;
  const total = weeksOf(season).length;
  const cur = Math.min(season.currentWeek, total);
  const lastPlayed = season.currentWeek - 1;
  const w = app.ui.week || (season.finished ? total : lastPlayed >= 1 ? lastPlayed : cur);
  const weekObj = weeksOf(season).find((x) => x.week === w);
  const played = !!(season.weeksPlayed && season.weeksPlayed[w]) || w < season.currentWeek;
  const results = matchesOfWeek(season, w).map((m) => ({ m, r: season.matches && season.matches[m.id] }));
  const parts = [];
  if (season.finished) {
    parts.push(h('div', { class: 'card champion' }, h('div', { class: 'cup' }, '🏆'), h('h2', null, (room.members[season.champion] || {}).team || '—'), h('p', { class: 'muted' }, 'Sezonun şampiyonu'),
      h('div', { class: 'btns' }, h('button', { class: 'btn primary', onclick: () => ctx.go('room', { sub: 'champion' }) }, 'Şampiyonluk'), h('button', { class: 'btn', onclick: () => ctx.go('room', { sub: 'awards' }) }, 'Ödüller ve karma'))));
  } else {
    const next = matchesOfWeek(season, season.currentWeek);
    const nw = weeksOf(season).find((x) => x.week === season.currentWeek);
    const mine = next.find((m) => m.home === ctx.seat || m.away === ctx.seat);
    parts.push(h('div', { class: 'card' },
      h('h3', null, `Sıradaki: ${season.currentWeek}. hafta`),
      mine ? h('div', { class: 'small mb' }, 'Senin maçın: ', seatLabel(room, mine.home, { me: ctx.seat }), ' – ', seatLabel(room, mine.away, { me: ctx.seat })) : h('div', { class: 'small mb' }, 'Bu hafta BAY geçiyorsun; oyuncuların dinlenecek.'),
      nw && nw.bye ? h('div', { class: 'mini mb' }, 'BAY: ', seatLabel(room, nw.bye, { me: ctx.seat })) : null,
      h('button', { class: 'btn block', onclick: () => ctx.go('room', { sub: 'team', seat: ctx.seat }) }, 'Kadromu / taktiğimi ayarla'),
      ctx.admin ? h('button', { class: 'btn block primary mt', onclick: async () => {
        if (!(await confirmSheet('Haftayı oyna', `${season.currentWeek}. haftanın maçları simüle edilecek. Herkesin son kaydettiği kadro kullanılır; sonuçlar kesinleşir.`, 'Oynat'))) return;
        const sim = await ctx.run(() => app.api.playWeek(app.code, room));
        if (sim) { app.ui.week = sim.week; app.ui.leagueTab = 'week'; ctx.render(); }
      } }, `▶︎ ${season.currentWeek}. haftayı oynat`) : h('div', { class: 'mini mt center' }, 'Haftayı admin oynatır; sonuçlar gelince bildirim alırsın.')));
  }
  parts.push(h('div', { class: 'row between mb' },
    h('button', { class: 'btn sm', disabled: w <= 1, onclick: () => { app.ui.week = w - 1; ctx.render(); } }, '‹'),
    h('b', null, `${w}. hafta ${played ? 'sonuçları' : 'fikstürü'}`),
    h('button', { class: 'btn sm', disabled: w >= total, onclick: () => { app.ui.week = w + 1; ctx.render(); } }, '›')));
  for (const { m, r } of results) parts.push(matchCard(ctx, m, r));
  if (weekObj && weekObj.bye) parts.push(h('div', { class: 'small muted center mb' }, 'BAY: ', seatLabel(room, weekObj.bye)));
  if (played && results.every((x) => x.r)) parts.push(weekHighlights(ctx, results.map((x) => x.r)));
  return h('div', null, parts);
}

function weekHighlights(ctx, results) {
  const api = ctx.app.api;
  const scorers = {};
  const assists = {};
  let best = null;
  for (const r of results) {
    for (const g of toArray(r.goals)) { scorers[g.playerId] = (scorers[g.playerId] || 0) + 1; if (g.assistId) assists[g.assistId] = (assists[g.assistId] || 0) + 1; }
    for (const [pid, x] of Object.entries(r.players || {})) if (x.played && x.minutes >= 45 && (!best || x.rating > best.rating)) best = { pid, rating: x.rating };
  }
  const list = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([pid, n]) => `${api.byId[pid] ? api.byId[pid].name : pid} (${n})`).join(', ') || '—';
  return h('div', { class: 'card' }, h('h3', null, 'Haftanın özeti'),
    h('div', { class: 'small' }, h('div', null, '⚽ Golcüler: ', list(scorers)), h('div', { class: 'mt' }, '🅰️ Asistler: ', list(assists)),
      best ? h('div', { class: 'mt' }, '⭐ Haftanın oyuncusu: ', h('b', null, api.byId[best.pid].name), ` (${best.rating.toFixed(1)})`) : null));
}

function tableView(ctx) {
  const { app } = ctx;
  const room = app.room;
  const rows = standings(room);
  const showBonus = !!room.season.finished;
  const chartSeries = rows.map((r) => ({ label: r.name, color: (room.members[r.seat] || {}).color || '#888', points: [{ x: 0, y: 0 }, ...r.history.map((p) => ({ x: p.week, y: p.points }))] }));
  return h('div', null,
    h('div', { class: 'tablewrap' }, h('table', null,
      h('thead', null, h('tr', null, ['#', 'Takım', 'O', 'G', 'B', 'M', 'AG', 'YG', 'AV', ...(showBonus ? ['Bonus'] : []), 'P', 'Form'].map((c, i) => h('th', { class: i === 1 ? 'l' : '' }, c)))),
      h('tbody', null, rows.map((r) => h('tr', { onclick: () => ctx.go('room', { sub: 'team', seat: r.seat }) },
        h('td', { class: 'strong' }, r.rank), h('td', { class: 'l' }, seatLabel(room, r.seat, { me: ctx.seat })),
        h('td', null, r.played), h('td', null, r.won), h('td', null, r.drawn), h('td', null, r.lost), h('td', null, r.gf), h('td', null, r.ga), h('td', null, r.gd > 0 ? `+${r.gd}` : r.gd),
        showBonus ? h('td', { style: { color: 'var(--gold)' } }, r.bonus ? `+${r.bonus}` : '0') : null,
        h('td', { class: 'strong' }, r.total), h('td', null, r.form.map((f) => h('span', { class: `form-chip form-${f}` }, f)))))))),
    h('p', { class: 'mini mt' }, showBonus ? 'Bonus: gol kralının takımı +2, asist kralının takımı +1 (sezon sonunda eklendi).' : 'Gol ve asist kralı bonusları sezon bitince eklenir. Sıralama: puan, averaj, atılan gol, galibiyet.'),
    rows.some((r) => r.history.length) ? h('div', { class: 'card mt' }, h('h3', null, 'Puan grafiği'), lineChart(chartSeries, { yMin: 0, xLabel: (x) => (x ? `H${x}` : ''), height: 180 }),
      h('div', { class: 'row wrap mt', style: { gap: '8px' } }, rows.map((r) => h('span', { class: 'mini row', style: { gap: '4px' } }, h('span', { class: 'dot', style: { background: (room.members[r.seat] || {}).color } }), r.name)))) : null);
}

function fixturesView(ctx) {
  const { app } = ctx;
  const room = app.room;
  const season = room.season;
  return h('div', null, weeksOf(season).map((w) => h('div', { class: 'list mb' },
    h('div', { class: `weekhead ${w.week === season.currentWeek ? 'current' : ''}` }, h('span', null, `${w.week}. hafta`), w.bye ? h('span', { class: 'muted' }, 'BAY: ', (room.members[w.bye] || {}).team || '') : null),
    toArray(w.matches).map((m) => {
      const r = season.matches && season.matches[m.id];
      return h('button', { class: 'fixture', onclick: () => r ? ctx.go('room', { sub: 'match', id: m.id }) : toast('Henüz oynanmadı.') },
        h('div', { class: 'h' }, seatLabel(room, m.home, { right: true, me: ctx.seat })),
        h('div', { class: `sc ${r ? '' : 'pending'}` }, r ? `${r.homeGoals} - ${r.awayGoals}` : '–'),
        h('div', { class: 'a' }, seatLabel(room, m.away, { me: ctx.seat })));
    }))));
}

function statsView(ctx) {
  const { app } = ctx;
  const room = app.room;
  const api = app.api;
  const ui = app.ui.stats || (app.ui.stats = { tab: 'goals' });
  const stats = seasonStats(room);
  const rows = Object.entries(stats).map(([pid, s]) => ({ pid, p: api.byId[pid], ...s })).filter((r) => r.p);
  const team = (r) => (room.members[r.seat] || {}).team || '';
  const leader = (list, val, sub) => h('div', { class: 'list' }, list.length ? list.map((r, i) => h('button', { class: 'item', onclick: () => openPlayerSheet(ctx, r.pid) },
    h('b', { style: { width: '22px' } }, i + 1), posBadge(r.p), h('div', { class: 'grow' }, h('div', { class: 'name ellipsis' }, r.p.name), h('div', { class: 'meta ellipsis' }, team(r), sub ? ` · ${sub(r)}` : '')),
    h('b', { style: { fontSize: '18px' } }, val(r)))) : h('div', { class: 'item muted' }, 'Henüz veri yok.'));
  const state = playerStateBefore(room, room.season.currentWeek);
  let body;
  if (ui.tab === 'assists') body = leader(rows.filter((r) => r.assists).sort((a, b) => b.assists - a.assists || a.minutes - b.minutes).slice(0, 25), (r) => r.assists, (r) => `${r.apps} maç · ${r.goals} gol`);
  else if (ui.tab === 'rating') body = leader(rows.filter((r) => r.apps >= 2).sort((a, b) => b.avgRating - a.avgRating).slice(0, 25), (r) => r.avgRating.toFixed(2), (r) => `${r.apps} maç`);
  else if (ui.tab === 'gk') body = leader(rows.filter((r) => isGK(r.p) && r.apps).sort((a, b) => b.cleanSheets - a.cleanSheets || b.saves - a.saves), (r) => r.cleanSheets, (r) => `${r.apps} maç · ${r.saves} kurtarış · ${r.conceded} gol yedi · gol yemeden`);
  else if (ui.tab === 'cards') {
    const banned = Object.entries(state).filter(([, s]) => s.banned > 0);
    const risk = Object.entries(state).filter(([, s]) => s.yellows === DISCIPLINE.yellowsForBan - 1);
    body = h('div', null,
      h('div', { class: 'card' }, h('h3', null, 'Cezalılar (sıradaki maçı kaçırır)'), banned.length ? banned.map(([pid, s]) => h('div', { class: 'small' }, '🚫 ', api.byId[pid].name, ` · ${s.banned} maç · ${(room.members[s.seat] || {}).team || ''}`)) : h('div', { class: 'small muted' }, 'Yok')),
      h('div', { class: 'card' }, h('h3', null, `Ceza sınırında (${DISCIPLINE.yellowsForBan - 1} sarı)`), risk.length ? risk.map(([pid, s]) => h('div', { class: 'small' }, '🟨🟨 ', api.byId[pid].name, ` · ${(room.members[s.seat] || {}).team || ''}`)) : h('div', { class: 'small muted' }, 'Yok')),
      h('p', { class: 'mini' }, `Kural: ${DISCIPLINE.yellowsForBan} sarı = ${DISCIPLINE.yellowBan} maç, ikinci sarıdan kırmızı = ${DISCIPLINE.secondYellowBan} maç, direkt kırmızı = ${DISCIPLINE.redBan} maç ceza.`),
      leader(rows.filter((r) => r.yellow + r.red).sort((a, b) => b.red - a.red || b.yellow - a.yellow).slice(0, 25), (r) => `${r.yellow}🟨 ${r.red}🟥`));
  } else body = leader(rows.filter((r) => r.goals).sort((a, b) => b.goals - a.goals || a.minutes - b.minutes).slice(0, 25), (r) => r.goals, (r) => `${r.apps} maç · ${r.shots} şut · ${r.assists} asist`);
  return h('div', null,
    h('div', { class: 'chips mb' }, [['goals', 'Gol krallığı'], ['assists', 'Asist'], ['rating', 'Ort. puan'], ['gk', 'Kaleciler'], ['cards', 'Kart & ceza']].map(([k, l]) => h('button', { class: `chip ${ui.tab === k ? 'on' : ''}`, onclick: () => { ui.tab = k; ctx.render(); } }, l))),
    body,
    h('p', { class: 'mini mt' }, 'Gol kralının takımı +2, asist kralının takımı +1 puan alır (sezon sonunda). Eşitlikte daha az dakika oynayan önde.'));
}

function teamsView(ctx) {
  const { app } = ctx;
  const room = app.room;
  const sq = squads(room.draft);
  const st = standings(room);
  return h('div', { class: 'list' }, st.map((r) => h('button', { class: 'item', onclick: () => ctx.go('room', { sub: 'team', seat: r.seat }) },
    h('b', { style: { width: '20px' } }, r.rank), h('div', { class: 'grow' }, seatLabel(room, r.seat, { me: ctx.seat }), h('div', { class: 'mini' }, `${(sq[r.seat] || []).length} oyuncu · ${r.total} puan`)), h('span', { class: 'muted' }, '›'))));
}

export { roleOf, finishedMatches };
