// After the draft: everyone sets up their team and says "ready"; the admin can
// only start the league when every squad is complete and everyone is ready.
import { h, confirmSheet } from '../dom.js';
import { toArray, squads } from '../../core/draft.js';
import { topbar, seatLabel } from '../components.js';
import { claimsCard, notifyCard } from './lobby.js';
import { fmtValue } from '../../core/abilities.js';

export function renderPrep(ctx) {
  const { app } = ctx;
  const room = app.room;
  const seat = ctx.seat;
  const seats = toArray(room.draft.firstRound);
  const ready = room.ready || {};
  const allReady = seats.every((s) => ready[s]);
  const mySaved = !!(room.tactics && room.tactics[seat]);
  const sq = squads(room.draft);
  return h('div', null,
    topbar(room.public.name, 'Draft bitti · kadrolar hazırlanıyor'),
    h('div', { class: 'banner' }, '✅ Draft tamamlandı. Herkes kadrosunu kurup "Kadrom hazır" deyince admin ligi başlatabilir.'),
    claimsCard(ctx),
    h('div', { class: 'card' },
      h('h3', null, 'Senin takımın'),
      h('button', { class: 'btn block primary', onclick: () => ctx.go('room', { sub: 'team', seat }) }, mySaved ? 'Taktik ve kadroyu düzenle' : 'Kadronu kur (diziliş, ilk 11, taktik)'),
      h('button', { class: `btn block mt ${ready[seat] ? '' : 'primary'}`, disabled: !mySaved && !ready[seat], onclick: () => ctx.run(() => app.api.setReady(app.code, seat, !ready[seat])) },
        ready[seat] ? '✓ Hazırım (geri al)' : mySaved ? 'Kadrom hazır' : 'Önce kadronu kaydet')),
    h('div', { class: 'card' },
      h('h3', null, `Hazır olanlar (${seats.filter((s) => ready[s]).length}/${seats.length})`),
      h('div', { class: 'list' }, seats.map((s) => {
        const value = (sq[s] || []).reduce((a, id) => a + (app.api.byId[id].mv || 0), 0);
        return h('button', { class: 'item', onclick: () => ctx.go('room', { sub: 'team', seat: s }) },
          h('span', null, ready[s] ? '✅' : '⏳'), h('div', { class: 'grow' }, seatLabel(room, s, { me: seat }), h('div', { class: 'mini' }, `${(sq[s] || []).length} oyuncu · kadro değeri ${fmtValue(value)}`)), h('span', { class: 'muted' }, '›'));
      }))),
    ctx.admin ? h('button', { class: 'btn block primary', disabled: !allReady, onclick: async () => {
      if (!(await confirmSheet('Ligi başlat', 'Fikstür çekilecek ve lig başlayacak. Haftaları sen oynatacaksın.', 'Başlat'))) return;
      ctx.run(() => app.api.startSeason(app.code, room));
    } }, allReady ? 'Ligi başlat' : 'Herkesin hazır olması bekleniyor') : h('div', { class: 'card small muted center' }, 'Admin herkes hazır olunca ligi başlatacak.'),
    notifyCard(ctx));
}
