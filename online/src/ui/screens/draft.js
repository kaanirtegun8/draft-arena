// Draft room: everyone watches live, only the manager on the clock can pick.
import { h, toast, confirmSheet, closeSheet } from '../dom.js';
import { onClock, squads, toArray, pickError } from '../../core/draft.js';
import { ROLES, ROLE_SHORT, ROLE_LABEL, roleOf, unmetNeeds, roleCounts, ROLE_MIN, quotaError } from '../../core/positions.js';
import { fmtValue } from '../../core/abilities.js';
import { topbar, playerRow, openPlayerSheet, posBadge, seatLabel } from '../components.js';
import { notifyCard, claimsCard } from './lobby.js';

export function renderDraft(ctx) {
  const { app } = ctx;
  const room = app.room;
  const d = room.draft;
  const api = app.api;
  const seat = ctx.seat;
  const admin = ctx.admin;
  const ui = app.ui.draft || (app.ui.draft = { tab: 'players', role: 'ALL', q: '', sort: 'level', needOnly: true });
  const clock = onClock(d);
  const order = toArray(d.order);
  const n = toArray(d.firstRound).length;
  const pickNo = d.current + 1;
  const round = Math.floor(d.current / n) + 1;
  const myTurn = clock === seat;
  const sq = squads(d);
  const mine = sq[seat] || [];
  const squadSize = room.public.squadSize;
  const myNeeds = unmetNeeds(mine, api.byId);
  const myPicksLeft = order.slice(d.current).map((s, i) => (s === seat ? d.current + i + 1 : null)).filter(Boolean);
  const nextMine = myPicksLeft[0];

  // pick timer (admin device enforces it)
  const picks = toArray(d.picks);
  const lastAt = picks.length ? picks[picks.length - 1].at : d.startedAt;
  const limit = room.public.pickSeconds || 0;
  const timerEl = h('span', { class: 'timer' });
  if (limit && lastAt) {
    const tick = () => {
      const left = Math.max(0, Math.round((lastAt + limit * 1000 - Date.now()) / 1000));
      timerEl.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      timerEl.className = `timer ${left <= 15 ? 'low' : ''}`;
      if (left === 0 && admin && !app.ui.autoPicking) {
        app.ui.autoPicking = true;
        api.autoPick(app.code, room).then((pid) => { if (pid) toast(`Süre doldu: ${api.byId[pid].name} otomatik seçildi.`); }).catch(() => {}).finally(() => { setTimeout(() => { app.ui.autoPicking = false; }, 1500); });
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    app.cleanup = () => clearInterval(t);
  }

  const doPick = (pid) => ctx.run(async () => {
    await api.makePick(app.code, room, clock, pid);
    closeSheet();
    toast(`${api.byId[pid].name} seçildi!`, 'ok');
  });

  const header = topbar(room.public.name, `Draft · Tur ${round}/${squadSize} · Seçim ${pickNo}/${order.length}`);
  const clockCard = myTurn
    ? h('div', { class: 'banner turn' }, '🔔 SIRA SENDE! Oyuncunu seç', limit ? h('div', { class: 'small' }, 'Kalan süre: ', timerEl) : null)
    : h('div', { class: 'clock cpu' },
      h('div', { class: 'grow' },
        h('div', { class: 'name' }, 'Sırada: ', seatLabel(room, clock)),
        h('div', { class: 'small muted' }, nextMine ? `Senin sıran ${nextMine}. seçimde (${nextMine - pickNo} seçim sonra)` : 'Seçimlerin tamamlandı', limit ? ' · ' : '', limit ? timerEl : null)),
      admin ? h('button', { class: 'btn sm', onclick: async () => {
        if (!(await confirmSheet('Onun yerine seç', 'Sıradaki menajer için en uygun oyuncu otomatik seçilsin mi?', 'Seç'))) return;
        ctx.run(() => api.autoPick(app.code, room));
      } }, 'Onun yerine seç') : null);

  const needChips = h('div', { class: 'row wrap', style: { gap: '6px' } },
    ROLES.filter((r) => ROLE_MIN[r] > 0).map((r) => h('span', { class: `tag ${myNeeds[r] ? 'warn' : 'ok'}` }, `${ROLE_SHORT[r]} ${roleCounts(mine, api.byId)[r]}/${ROLE_MIN[r]}`)),
    h('span', { class: 'tag' }, `Kadro ${mine.length}/${squadSize}`));

  const tabs = h('div', { class: 'chips mb' },
    [['players', 'Oyuncular'], ['mine', 'Kadrom'], ['board', 'Draft tahtası'], ['order', 'Sıra'], ['info', 'Ayarlar']].map(([k, l]) =>
      h('button', { class: `chip ${ui.tab === k ? 'on' : ''}`, onclick: () => { ui.tab = k; ctx.render(); } }, l)));

  let body;
  if (ui.tab === 'mine') body = squadList(ctx, mine);
  else if (ui.tab === 'board') body = board(ctx, room, sq);
  else if (ui.tab === 'order') body = orderView(room, order, d.current, seat);
  else if (ui.tab === 'info') body = h('div', null, notifyCard(ctx), claimsCard(ctx));
  else body = playerList(ctx, room, { myTurn, clock, mine, squadSize, doPick, ui });

  return h('div', null, header, clockCard, claimsCard(ctx), h('div', { class: 'card' }, h('h3', null, 'Kadro ihtiyaçların'), needChips), tabs, body);
}

function playerList(ctx, room, { myTurn, mine, squadSize, doPick, ui }) {
  const { app } = ctx;
  const api = app.api;
  const d = room.draft;
  const listEl = h('div', { class: 'list' });
  const suggestion = myTurn ? api.suggest(room, ctx.seat) : null;
  const fill = () => {
    listEl.innerHTML = '';
    const q = ui.q.trim().toLocaleLowerCase('tr');
    let items = api.pool.filter((p) => !(d.taken && d.taken[p.id]));
    if (ui.role !== 'ALL') items = items.filter((p) => roleOf(p) === ui.role);
    if (ui.needOnly) items = items.filter((p) => !quotaError(mine, p, squadSize, api.byId));
    if (q) items = items.filter((p) => `${p.name} ${p.club} ${p.nat} ${p.pos} ${p.league || ''}`.toLocaleLowerCase('tr').includes(q));
    const lv = (p) => api.levelOf(p);
    const sorts = {
      level: (a, b) => lv(b) - lv(a), ea: (a, b) => b.ovr - a.ovr, mv: (a, b) => (b.mv || 0) - (a.mv || 0),
      form: (a, b) => ((b.form && b.form.rating) || 0) - ((a.form && a.form.rating) || 0), age: (a, b) => a.age - b.age,
    };
    items.sort((a, b) => sorts[ui.sort](a, b) || b.ovr - a.ovr);
    const shown = items.slice(0, 120);
    if (!shown.length) {
      const need = unmetNeeds(mine, api.byId);
      const miss = ROLES.filter((r) => need[r] > 0).map((r) => `${ROLE_SHORT[r]} ${need[r]}`).join(', ');
      listEl.appendChild(h('div', { class: 'item muted small' }, ui.needOnly && myTurn ? `Bu filtrede seçebileceğin oyuncu yok.${miss ? ` Eksiklerin: ${miss}.` : ''} "Tümü" filtresine dön.` : 'Oyuncu yok.'));
    }
    for (const p of shown) {
      const err = myTurn ? pickError(d, ctx.seat, p.id, squadSize, api.byId) : 'Sıra sende değil';
      listEl.appendChild(playerRow(api, p, {
        room,
        cls: p.id === suggestion ? 'suggested' : '',
        onClick: () => openPlayerSheet(ctx, p.id, { actions: [h('button', { class: 'btn block primary', disabled: !!err, onclick: () => doPick(p.id) }, err || 'Bu oyuncuyu seç')] }),
        right: h('div', { class: 'row', style: { gap: '8px' } },
          p.id === suggestion ? h('span', { class: 'tag ok' }, 'öneri') : null,
          h('div', { class: 'center' }, h('div', { class: `lvl` }, lv(p).toFixed(0)), h('div', { class: 'mini' }, 'seviye')),
          myTurn ? h('button', { class: 'btn sm primary', disabled: !!err, title: err || '', onclick: (e) => { e.stopPropagation(); doPick(p.id); } }, 'Seç') : null),
      }));
    }
    if (items.length > shown.length) listEl.appendChild(h('div', { class: 'item muted small' }, `+${items.length - shown.length} oyuncu daha (aramayı daralt)`));
  };
  fill();
  return h('div', null,
    h('div', { class: 'chips mb' }, [['ALL', 'Tümü'], ...ROLES.map((r) => [r, ROLE_SHORT[r]])].map(([r, l]) =>
      h('button', { class: `chip ${ui.role === r ? 'on' : ''}`, title: ROLE_LABEL[r] || '', onclick: () => { ui.role = r; ctx.render(); } }, l))),
    h('div', { class: 'row mb' },
      h('input', { class: 'input grow', type: 'search', placeholder: 'İsim, kulüp, ülke…', value: ui.q, 'data-k': 'draft-q', oninput: (e) => { ui.q = e.target.value; fill(); } }),
      h('select', { class: 'input', style: { width: '120px' }, onchange: (e) => { ui.sort = e.target.value; fill(); } },
        [['level', 'Seviye'], ['ea', 'EA puanı'], ['mv', 'Piyasa değeri'], ['form', 'Form'], ['age', 'Yaş']].map(([v, l]) => h('option', { value: v, selected: ui.sort === v }, l)))),
    h('label', { class: 'row small mb', style: { gap: '8px' } }, h('input', { type: 'checkbox', checked: ui.needOnly, onchange: (e) => { ui.needOnly = e.target.checked; fill(); } }), 'Sadece kadroma seçebileceğim oyuncular'),
    h('p', { class: 'mini' }, 'Seviye = %40 EA FC + %35 gerçek form + %25 piyasa değeri. Veri yoksa nötr.'),
    listEl);
}

function squadList(ctx, ids) {
  const api = ctx.app.api;
  if (!ids.length) return h('div', { class: 'card muted small center' }, 'Henüz oyuncu seçmedin.');
  return h('div', null, ROLES.map((r) => {
    const ps = ids.map((id) => api.byId[id]).filter((p) => roleOf(p) === r);
    if (!ps.length) return null;
    return h('div', { class: 'card' }, h('h3', null, `${ROLE_LABEL[r]} (${ps.length})`), h('div', { class: 'list' }, ps.map((p) => playerRow(api, p, { room: ctx.app.room, onClick: () => openPlayerSheet(ctx, p.id) }))));
  }));
}

function board(ctx, room, sq) {
  const api = ctx.app.api;
  const seats = toArray(room.draft.firstRound);
  const picks = toArray(room.draft.picks);
  return h('div', { class: 'board', style: { gridTemplateColumns: `repeat(${seats.length}, minmax(120px, 1fr))` } }, seats.map((s) => h('div', { class: 'col' },
    h('div', { class: 'small mb' }, seatLabel(room, s, { me: ctx.seat })),
    picks.map((p, i) => ({ ...p, n: i + 1 })).filter((p) => p.seat === s).map((p) => {
      const pl = api.byId[p.pid];
      return h('div', { class: 'cell' }, h('span', { class: 'muted' }, `#${p.n} `), posBadge(pl), ' ', pl.name, h('div', { class: 'mini' }, fmtValue(pl.mv)));
    }))));
}

function orderView(room, order, current, mySeatId) {
  const seats = toArray(room.draft.firstRound);
  return h('div', { class: 'card' },
    h('h3', null, 'Kura sonucu ve yılan sırası'),
    h('p', { class: 'small muted' }, 'Tek turlar kura sırasıyla, çift turlar ters sırayla. Kadro çift sayıda olduğu için herkesin seçim numaraları toplamı eşit.'),
    h('div', { class: 'list mb' }, seats.map((s, i) => h('div', { class: 'item' }, h('b', null, i + 1), h('div', { class: 'grow' }, seatLabel(room, s, { me: mySeatId })),
      h('span', { class: 'mini' }, 'Σ ', order.reduce((a, x, k) => a + (x === s ? k + 1 : 0), 0))))),
    h('h3', null, 'Sıradaki seçimler'),
    h('div', { class: 'list' }, order.slice(current, current + 12).map((s, i) => h('div', { class: 'item', style: { minHeight: '40px' } }, h('b', null, `#${current + i + 1}`), h('div', { class: 'grow' }, seatLabel(room, s, { me: mySeatId }))))));
}
