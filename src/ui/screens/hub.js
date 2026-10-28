// League hub: overview, fixtures, table, statistics, teams.
import { h, toast, confirmSheet, openSheet, closeSheet, condBar } from '../dom.js';
import { nextMatch, playMatch, playRemaining, getManager, weekOf } from '../../core/league.js';
import { standings, seasonPlayerStats, finishedMatches } from '../../core/stats.js';
import { isGK } from '../../core/players.js';
import { FITNESS } from '../../core/config.js';
import { topbar, teamLabel, tabbar, posBadge, openPlayerSheet } from '../components.js';
import { openSaves, openHowTo } from './home.js';

export function renderHub(ctx) {
  const { app } = ctx;
  const st = app.league;
  if (!st) { setTimeout(() => ctx.go('home')); return h('div'); }
  if (st.phase === 'draft') { setTimeout(() => ctx.go('draft')); return h('div'); }
  const tab = app.params.tab || (app.ui.hubTab || 'overview');
  app.ui.hubTab = tab;
  const sub = st.phase === 'finished' ? 'Sezon tamamlandı' : `Hafta ${st.currentWeek}/10`;
  const header = topbar(ctx, st.name, sub, {
    right: h('button', { class: 'iconbtn', 'aria-label': 'Menü', onclick: () => openMenu(ctx) }, '☰'),
  });
  let body;
  if (tab === 'fixtures') body = fixtures(ctx, st);
  else if (tab === 'table') body = tableView(ctx, st);
  else if (tab === 'stats') body = statsView(ctx, st);
  else if (tab === 'teams') body = teamsView(ctx, st);
  else body = overview(ctx, st);
  return h('div', null, header, body,
    tabbar([['overview', '🏟️', 'Lig'], ['fixtures', '📅', 'Fikstür'], ['table', '🏆', 'Puan'], ['stats', '📈', 'İstatistik'], ['teams', '👥', 'Takımlar']],
      tab, (k) => ctx.go('hub', { tab: k })));
}

function openMenu(ctx) {
  openSheet('Menü', h('div', { class: 'stack' },
    h('button', { class: 'btn block', onclick: () => { closeSheet(); openSaves(ctx); } }, '💾 Kaydet / Yükle / Dışa aktar'),
    h('button', { class: 'btn block', onclick: () => ctx.go('data', { from: 'hub' }) }, '📊 Oyuncu verisi ve form'),
    h('button', { class: 'btn block', onclick: () => { closeSheet(); openHowTo(); } }, '❓ Nasıl oynanır'),
    ctx.app.league.phase === 'finished' ? h('button', { class: 'btn block', onclick: () => ctx.go('awards') }, '🏅 Sezon ödülleri') : null,
    h('button', { class: 'btn block ghost', onclick: () => ctx.go('home') }, '⌂ Ana menü')));
}

function overview(ctx, st) {
  const { app } = ctx;
  const parts = [];
  if (st.phase === 'finished') {
    const champ = getManager(st, st.champion);
    parts.push(h('div', { class: 'card champion' },
      h('div', { class: 'cup' }, '🏆'),
      h('h2', null, champ.name),
      h('p', { class: 'muted' }, 'Sezonun şampiyonu'),
      h('div', { class: 'btns mt' },
        h('button', { class: 'btn primary', onclick: () => ctx.go('champion') }, 'Şampiyonluk ekranı'),
        h('button', { class: 'btn', onclick: () => ctx.go('awards') }, 'Sezon ödülleri'))));
  } else {
    const mt = nextMatch(st);
    const w = weekOf(st, st.currentWeek);
    const idx = w.matches.findIndex((x) => x.id === mt.id) + 1;
    parts.push(h('div', { class: 'card' },
      h('h3', null, `Hafta ${st.currentWeek} · Maç ${idx}/2`),
      h('div', { class: 'fixture', style: { border: 0, padding: '6px 0' } },
        h('div', { class: 'h' }, teamLabel(st, mt.home, { right: true })),
        h('div', { class: 'sc pending' }, 'vs'),
        h('div', { class: 'a' }, teamLabel(st, mt.away))),
      h('div', { class: 'muted small center mb' }, 'BAY: ', getManager(st, w.bye).name, ' (dinleniyor, kondisyon +', FITNESS.recoverBye, ')'),
      h('button', { class: 'btn block primary', onclick: () => ctx.go('prematch', { id: mt.id }) }, 'Maça Hazırlan →'),
      h('div', { class: 'btns mt' },
        h('button', { class: 'btn sm', onclick: () => {
          const res = ctx.commit((s) => playMatch(s, mt.id, app.byId), { rerender: false });
          if (res) ctx.go('match', { id: mt.id, mode: 'report' });
        } }, 'Sonucu hemen al'),
        h('button', { class: 'btn sm', onclick: async () => {
          if (!(await confirmSheet('Haftayı hızlı oyna', `Hafta ${st.currentWeek}'in kalan maçları izlemeden oynanacak. Sonuçlar kesinleşir.`, 'Oyna'))) return;
          ctx.commit((s) => playRemaining(s, app.byId, s.currentWeek));
          toast('Hafta tamamlandı.', 'ok');
        } }, 'Haftayı hızlı oyna'),
        h('button', { class: 'btn sm', onclick: async () => {
          if (!(await confirmSheet('Sezonu hızlı oyna', 'Kalan tüm maçlar izlemeden oynanacak. İnsan menajerlerin mevcut taktikleri kullanılır.', 'Hepsini oyna'))) return;
          ctx.commit((s) => playRemaining(s, app.byId));
          if (ctx.app.league.phase === 'finished') ctx.go('champion');
        } }, 'Sezonu hızlı oyna'))));
  }
  // human manager quick panel
  const humans = st.managers.filter((m) => m.isHuman);
  if (humans.length && st.phase === 'season') {
    parts.push(h('div', { class: 'card' },
      h('h3', null, 'Menajer paneli'),
      h('div', { class: 'list' }, humans.map((m) => {
        const tired = m.squad.filter((pid) => st.playerState[pid].condition < FITNESS.lowConditionWarn).length;
        const inj = m.squad.filter((pid) => st.playerState[pid].injuredWeeks > 0).length;
        const xiTired = (m.tactics.lineup || []).filter((l) => l.playerId && st.playerState[l.playerId].condition < FITNESS.lowConditionWarn).length;
        return h('button', { class: 'item', onclick: () => ctx.go('team', { id: m.id }) },
          h('span', { class: 'dot', style: { background: m.color } }),
          h('div', { class: 'grow' }, h('div', { class: 'name' }, m.name),
            h('div', { class: 'meta' }, `${m.tactics.formation} · ${tired} yorgun · ${inj} sakat`, xiTired ? ` · İlk 11'de ${xiTired} yorgun oyuncu!` : '')),
          h('span', { class: 'btn sm' }, 'Taktik'));
      }))));
  }
  // mini table
  const tbl = standings(st).slice(0, 5);
  parts.push(h('div', { class: 'card' }, h('h3', null, 'Puan durumu'),
    h('div', { class: 'list' }, tbl.map((r) => h('div', { class: 'item', style: { minHeight: '44px' } },
      h('b', { style: { width: '18px' } }, r.rank), h('div', { class: 'grow' }, teamLabel(st, r.managerId)),
      h('span', { class: 'muted small' }, `${r.played} M · ${r.gd > 0 ? '+' : ''}${r.gd}`), h('b', null, r.total))))));
  // last results
  const done = finishedMatches(st).slice(-4).reverse();
  if (done.length) {
    parts.push(h('div', { class: 'card' }, h('h3', null, 'Son sonuçlar'),
      h('div', { class: 'list' }, done.map((m) => fixtureRow(ctx, st, m)))));
  }
  return h('div', null, parts);
}

function fixtureRow(ctx, st, m) {
  const fin = m.status === 'finished';
  return h('button', { class: 'fixture', onclick: () => fin ? ctx.go('match', { id: m.id, mode: 'report' }) : (m.week === st.currentWeek ? ctx.go('prematch', { id: m.id }) : toast('Bu maç henüz oynanmadı.')) },
    h('div', { class: 'h' }, teamLabel(st, m.home, { right: true })),
    h('div', { class: `sc ${fin ? '' : 'pending'}` }, fin ? `${m.result.homeGoals} - ${m.result.awayGoals}` : '–'),
    h('div', { class: 'a' }, teamLabel(st, m.away)));
}

function fixtures(ctx, st) {
  return h('div', null, st.schedule.map((w) => h('div', { class: 'list mb' },
    h('div', { class: `weekhead ${w.week === st.currentWeek && st.phase === 'season' ? 'current' : ''}` },
      h('span', null, `Hafta ${w.week}${w.week <= 5 ? ' · 1. devre' : ' · 2. devre'}`), h('span', { class: 'muted' }, 'BAY: ', getManager(st, w.bye).name)),
    w.matches.map((x) => fixtureRow(ctx, st, st.matches[x.id])))));
}

function tableView(ctx, st) {
  const rows = standings(st);
  const showBonus = st.bonusApplied;
  return h('div', null,
    h('div', { class: 'tablewrap' }, h('table', null,
      h('thead', null, h('tr', null, ['#', 'Takım', 'O', 'G', 'B', 'M', 'AG', 'YG', 'AV', ...(showBonus ? ['Bonus'] : []), 'P', 'Form'].map((c, i) => h('th', { class: i === 1 ? 'l' : '' }, c)))),
      h('tbody', null, rows.map((r) => h('tr', null,
        h('td', { class: 'strong' }, r.rank), h('td', { class: 'l' }, teamLabel(st, r.managerId)),
        h('td', null, r.played), h('td', null, r.won), h('td', null, r.drawn), h('td', null, r.lost),
        h('td', null, r.gf), h('td', null, r.ga), h('td', null, r.gd > 0 ? '+' + r.gd : r.gd),
        showBonus ? h('td', { style: { color: 'var(--gold)' } }, r.bonus ? '+' + r.bonus : '0') : null,
        h('td', { class: 'strong' }, r.total),
        h('td', null, r.form.map((f) => h('span', { class: `form-chip form-${f}` }, f)))))))),
    h('p', { class: 'small muted mt' }, 'Sıralama: puan, averaj, atılan gol, galibiyet. G=galibiyet B=beraberlik M=mağlubiyet. ',
      showBonus ? 'Bonus: gol kralı +2, asist kralı +1 (sezon sonunda uygulandı).' : 'Gol/asist kralı bonusları sezon bitince eklenir.'));
}

const STAT_TABS = [
  ['goals', 'Gol'], ['assists', 'Asist'], ['rating', 'Ort. Puan'], ['gk', 'Kaleciler'], ['cards', 'Kartlar'], ['all', 'Tüm Oyuncular'],
];

function statsView(ctx, st) {
  const { app } = ctx;
  const ui = app.ui.stats || (app.ui.stats = { tab: 'goals', sort: 'goals', dir: -1, team: 'ALL' });
  const stats = seasonPlayerStats(st);
  const rows = Object.entries(stats).map(([pid, s]) => ({ pid, p: app.byId[pid], ...s }))
    .filter((r) => ui.team === 'ALL' || r.managerId === ui.team);
  const chips = h('div', { class: 'chips mb' }, STAT_TABS.map(([k, l]) => h('button', { class: `chip ${ui.tab === k ? 'on' : ''}`, onclick: () => { ui.tab = k; ctx.render(); } }, l)));
  const teamSel = h('select', { class: 'input mb', onchange: (e) => { ui.team = e.target.value; ctx.render(); } },
    h('option', { value: 'ALL' }, 'Tüm takımlar'), st.managers.map((m) => h('option', { value: m.id, selected: ui.team === m.id }, m.name)));

  const leader = (title, list, valFn, sub) => h('div', { class: 'list' },
    list.length ? list.map((r, i) => h('button', { class: 'item', onclick: () => openPlayerSheet(ctx, r.pid) },
      h('b', { style: { width: '22px' } }, i + 1), posBadge(r.p),
      h('div', { class: 'grow' }, h('div', { class: 'name ellipsis' }, r.p.name), h('div', { class: 'meta ellipsis' }, getManager(st, r.managerId).name, sub ? ' · ' + sub(r) : '')),
      h('b', { style: { fontSize: '18px' } }, valFn(r)))) : h('div', { class: 'item muted' }, 'Henüz veri yok.'));

  let body;
  if (ui.tab === 'goals') body = leader('Gol', rows.filter((r) => r.goals > 0).sort((a, b) => b.goals - a.goals || a.minutes - b.minutes).slice(0, 20), (r) => r.goals, (r) => `${r.apps} maç · ${r.shots} şut · ${r.shotsOnTarget} isabetli`);
  else if (ui.tab === 'assists') body = leader('Asist', rows.filter((r) => r.assists > 0).sort((a, b) => b.assists - a.assists || a.minutes - b.minutes).slice(0, 20), (r) => r.assists, (r) => `${r.apps} maç · ${r.goals} gol`);
  else if (ui.tab === 'rating') body = leader('Puan', rows.filter((r) => r.apps >= 2).sort((a, b) => b.avgRating - a.avgRating).slice(0, 20), (r) => r.avgRating.toFixed(2), (r) => `${r.apps} maç · ${r.minutes} dk`);
  else if (ui.tab === 'cards') body = leader('Kart', rows.filter((r) => r.yellow + r.red > 0).sort((a, b) => b.red - a.red || b.yellow - a.yellow).slice(0, 20), (r) => `${r.yellow}🟨 ${r.red}🟥`);
  else if (ui.tab === 'gk') {
    const gks = rows.filter((r) => isGK(r.p)).sort((a, b) => b.cleanSheets - a.cleanSheets || b.saves - a.saves);
    body = h('div', { class: 'tablewrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Kaleci', 'M', 'Dk', 'Kurt.', 'YG', 'GYM', 'Ort'].map((c, i) => h('th', { class: i === 0 ? 'l' : '' }, c)))),
      h('tbody', null, gks.map((r) => h('tr', { onclick: () => openPlayerSheet(ctx, r.pid) },
        h('td', { class: 'l' }, r.p.name, h('div', { class: 'small muted' }, getManager(st, r.managerId).name)),
        h('td', null, r.apps), h('td', null, r.minutes), h('td', null, r.saves), h('td', null, r.conceded), h('td', { class: 'strong' }, r.cleanSheets), h('td', null, r.apps ? r.avgRating.toFixed(2) : '—'))))));
  } else {
    const cols = [['apps', 'M'], ['starts', 'İ11'], ['minutes', 'Dk'], ['goals', 'G'], ['assists', 'A'], ['shots', 'Ş'], ['shotsOnTarget', 'İŞ'], ['yellow', 'SK'], ['red', 'KK'], ['avgRating', 'Ort']];
    const sorted = rows.slice().sort((a, b) => ui.dir * ((a[ui.sort] || 0) - (b[ui.sort] || 0)) || a.p.name.localeCompare(b.p.name, 'tr'));
    body = h('div', { class: 'tablewrap' }, h('table', null,
      h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Oyuncu'), cols.map(([k, l]) => h('th', { class: `sortable ${ui.sort === k ? 'sorted' : ''}`, onclick: () => { if (ui.sort === k) ui.dir *= -1; else { ui.sort = k; ui.dir = -1; } ctx.render(); } }, l)))),
      h('tbody', null, sorted.map((r) => h('tr', { onclick: () => openPlayerSheet(ctx, r.pid) },
        h('td', { class: 'l' }, posBadge(r.p), ' ', r.p.name),
        cols.map(([k]) => h('td', { class: k === ui.sort ? 'strong' : '' }, k === 'avgRating' ? (r.apps ? r.avgRating.toFixed(2) : '—') : r[k])))))));
  }
  return h('div', null, chips, teamSel, body,
    h('p', { class: 'small muted mt' }, 'Tüm istatistikler oynanan maçların olay kayıtlarından hesaplanır. GYM = gol yemeden tamamlanan maç (en az 60 dk).'));
}

function teamsView(ctx, st) {
  return h('div', { class: 'list' }, st.managers.map((m) => {
    const conds = m.squad.map((pid) => st.playerState[pid].condition);
    const avgC = conds.reduce((a, b) => a + b, 0) / conds.length;
    const avgOvr = m.squad.reduce((a, pid) => a + ctx.app.byId[pid].ovr, 0) / m.squad.length;
    return h('button', { class: 'item', onclick: () => ctx.go('team', { id: m.id }) },
      h('span', { class: 'dot', style: { background: m.color } }),
      h('div', { class: 'grow' },
        h('div', { class: 'name' }, m.name, m.isHuman ? ' 👤' : ' 🤖'),
        h('div', { class: 'meta' }, `Ort. güç ${avgOvr.toFixed(1)} · ${m.tactics.formation} · Kondisyon ${Math.round(avgC)}`),
        condBar(avgC, '120px')),
      h('span', { class: 'muted' }, '›'));
  }));
}

