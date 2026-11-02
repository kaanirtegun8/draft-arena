// Archived seasons: the final table, awards and every match of a finished season,
// with match details and replays loaded from archive/{n}.
import { h, toast } from '../dom.js';
import { toArray } from '../../core/draft.js';
import { standings, weeksOf, archiveRoom } from '../../core/season.js';
import { topbar, seatLabel } from '../components.js';
import { renderMatch } from './match.js';
import { exportSeasonPdf } from '../pdf.js';

function withRoom(ctx, room, extra = {}) {
  return Object.create(ctx, { app: { value: Object.assign(Object.create(ctx.app), { room }) }, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, { value: v }])) });
}

// Loads (once per visit) and caches archive n; returns null while loading.
function useArchive(ctx, n) {
  const { app } = ctx;
  const cache = app.ui.archives || (app.ui.archives = {});
  const entry = cache[n];
  if (!entry) {
    cache[n] = { loading: true };
    app.api.getArchive(app.code, n)
      .then((data) => { cache[n] = data ? { data } : { error: 'Bu sezonun arşivi bulunamadı.' }; ctx.render(); })
      .catch((e) => { cache[n] = { error: e.message || String(e) }; ctx.render(); });
    return { loading: true };
  }
  return entry;
}

export function renderArchiveMatch(ctx) {
  const { app } = ctx;
  const n = app.params.archive;
  const a = useArchive(ctx, n);
  const back = () => ctx.go('room', { sub: 'archive', n });
  if (!a.data) return h('div', null, topbar(`${n}. sezon`, 'Arşiv', { back }), h('div', { class: 'card muted center' }, a.error || 'Arşiv yükleniyor…'));
  const room = archiveRoom(app.code, a.data);
  return renderMatch(withRoom(ctx, room, { getLog: (id) => app.api.getArchiveLog(app.code, n, id) }));
}

export function renderArchive(ctx0) {
  const { app } = ctx0;
  const n = app.params.n;
  const back = () => { app.ui.leagueTab = 'analysis'; ctx0.go('room', {}); };
  const a = useArchive(ctx0, n);
  if (!a.data) return h('div', null, topbar(`${n}. sezon`, 'Arşiv', { back }), h('div', { class: 'card muted center' }, a.error || 'Arşiv yükleniyor…'));
  const data = a.data;
  const room = archiveRoom(app.code, data);
  const ctx = withRoom(ctx0, room);
  const api = app.api;
  const season = room.season;
  const nm = (pid) => (api.byId[pid] ? api.byId[pid].name : (data.players && data.players[pid] && data.players[pid].name) || '?');
  const rows = standings(room);
  const champ = room.members[season.champion] || {};
  const aw = season.awards || {};
  const ui = app.ui.archiveView && app.ui.archiveView.n === n ? app.ui.archiveView : (app.ui.archiveView = { n, open: {} });
  const openMatch = (id) => ctx0.go('room', { sub: 'match', id, archive: n, back: { sub: 'archive', n } });
  const pdf = () => exportSeasonPdf(room, api.byId, { seasonNo: n, names: data.players || {} }).catch((e) => toast(e.message || String(e), 'err'));
  const date = data.at ? new Date(data.at).toLocaleDateString('tr-TR') : '';

  return h('div', null,
    topbar(`${n}. sezon`, `${data.name}${date ? ` · ${date}` : ''}`, { back }),
    h('div', { class: 'card champion' }, h('div', { class: 'cup' }, '🏆'), h('h2', null, champ.team || '—'), h('p', { class: 'muted' }, `${n}. sezonun şampiyonu`)),
    h('button', { class: 'btn block primary mb', onclick: pdf }, '📄 Sezon raporunu PDF olarak paylaş'),
    h('div', { class: 'card' }, h('h3', null, 'Final puan durumu'),
      h('div', { class: 'tablewrap' }, h('table', null,
        h('thead', null, h('tr', null, ['#', 'Takım', 'O', 'G', 'B', 'M', 'AV', 'Bonus', 'P'].map((c, i) => h('th', { class: i === 1 ? 'l' : '' }, c)))),
        h('tbody', null, rows.map((r) => h('tr', null,
          h('td', { class: 'strong' }, r.rank), h('td', { class: 'l' }, seatLabel(room, r.seat, { me: ctx.seat })),
          h('td', null, r.played), h('td', null, r.won), h('td', null, r.drawn), h('td', null, r.lost), h('td', null, r.gd > 0 ? `+${r.gd}` : r.gd),
          h('td', { style: { color: 'var(--gold)' } }, r.bonus ? `+${r.bonus}` : '0'), h('td', { class: 'strong' }, r.total))))))),
    h('div', { class: 'card small' }, h('h3', null, 'Ödüller'),
      aw.topScorer ? h('div', null, '👟 Gol kralı: ', h('b', null, nm(aw.topScorer.pid)), ` (${aw.topScorer.goals}) · ${(room.members[aw.topScorer.seat] || {}).team || ''}`) : null,
      aw.topAssist ? h('div', null, '🎯 Asist kralı: ', h('b', null, nm(aw.topAssist.pid)), ` (${aw.topAssist.assists}) · ${(room.members[aw.topAssist.seat] || {}).team || ''}`) : null,
      aw.playerOfSeason ? h('div', null, '⭐ Sezonun oyuncusu: ', h('b', null, nm(aw.playerOfSeason.pid)), ` · ${(room.members[aw.playerOfSeason.seat] || {}).team || ''}`) : null,
      aw.bestKeeper ? h('div', null, '🧤 En iyi kaleci: ', h('b', null, nm(aw.bestKeeper.pid)), ` · ${(room.members[aw.bestKeeper.seat] || {}).team || ''}`) : null),
    h('h3', { class: 'mt' }, 'Tüm maçlar'),
    h('p', { class: 'mini mb' }, 'Haftaya dokun, maçlar açılsın. Maça dokununca detaylar ve tekrar izleme açılır.'),
    weeksOf(season).map((w) => {
      const open = !!ui.open[w.week];
      const ms = toArray(w.matches);
      return h('div', { class: 'list mb' },
        h('button', { class: 'weekhead', style: { width: '100%', color: 'inherit' }, onclick: () => { ui.open[w.week] = !open; ctx0.render(); } },
          h('span', null, `${open ? '▾' : '▸'} ${w.week}. hafta`),
          h('span', { class: 'muted' }, ms.map((m) => { const r = season.matches && season.matches[m.id]; return r ? `${r.homeGoals}-${r.awayGoals}` : '–'; }).join(' · '))),
        open ? ms.map((m) => {
          const r = season.matches && season.matches[m.id];
          return h('button', { class: 'fixture', onclick: () => (r ? openMatch(m.id) : toast('Bu maç oynanmamış.')) },
            h('div', { class: 'h' }, seatLabel(room, m.home, { right: true, me: ctx.seat })),
            h('div', { class: `sc ${r ? '' : 'pending'}` }, r ? `${r.homeGoals} - ${r.awayGoals}` : '–'),
            h('div', { class: 'a' }, seatLabel(room, m.away, { me: ctx.seat })));
        }) : null,
        open && w.bye ? h('div', { class: 'mini muted center' }, 'BAY: ', (room.members[w.bye] || {}).team || '') : null);
    }));
}
