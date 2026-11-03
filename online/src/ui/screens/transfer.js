// Mid-season transfer window: one transfer per manager (players + money for players).
import { avatar } from '../visual.js';
import { h, confirmSheet } from '../dom.js';
import { roleOf, ROLES } from '../../core/positions.js';
import { fmtValue } from '../../core/abilities.js';
import { proposals, dealError, MAX_SWAP } from '../../core/transfers.js';
import { topbar, posBadge, openPlayerSheet } from '../components.js';

const money = (v) => (v ? fmtValue(v) : '€0');

export function renderTransfer(ctx) {
  const { app } = ctx;
  const room = app.room;
  const api = app.api;
  const seat = ctx.seat;
  const back = () => ctx.go('room', {});
  const info = api.transferInfo(room, seat);
  const ui = app.ui.transfer || (app.ui.transfer = { to: null, give: [], want: [], money: 0 });
  const team = (s) => (room.members[s] || {}).team || s;
  const name = (pid) => (api.byId[pid] ? api.byId[pid].name : '?');
  const val = (ids) => ids.reduce((a, pid) => a + (api.prices[pid] || 0), 0);
  const all = proposals(room);
  const incoming = all.filter((d) => d.to === seat && d.status === 'pending');
  const mine = all.filter((d) => d.from === seat && d.status === 'pending');
  const doneIds = new Set(info.done.map((d) => d.id));

  const dealLine = (d) => h('div', { class: 'small' },
    h('div', null, '➡️ ', h('b', null, team(d.from)), ' verir: ', d.give.map(name).join(', '), d.money ? ` + ${money(d.money)}` : ''),
    h('div', null, '⬅️ ', h('b', null, team(d.to)), ' verir: ', d.want.map(name).join(', ')),
    h('div', { class: 'mini mt' }, `Oyun değeri: ${money(val(d.give) + d.money)} ↔ ${money(val(d.want))}`));

  const parts = [topbar('Transfer penceresi', info.open ? 'Sezon ortası · 1 transfer hakkı' : 'Pencere kapalı', { back })];
  parts.push(h('div', { class: 'card' },
    h('div', { class: 'row between' }, h('b', null, info.open ? '🔁 Pencere açık' : '🔒 Pencere kapalı'), h('span', { class: `tag ${info.used ? '' : 'ok'}` }, info.used ? 'Hakkını kullandın' : '1 transfer hakkın var')),
    h('div', { class: 'small mt' }, `Transfer için paran: ${money(info.money)}`),
    h('p', { class: 'mini' }, 'Bir takıma oyuncu (+ istersen para) karşılığında oyuncu teklif edersin. Kabul edilirse takas hemen olur ve hakkın biter. Verdiğin ve aldığın oyuncu sayısı eşit olmalı (en fazla 3\'e 3). Pencere admin bir sonraki haftayı oynatınca kapanır.')));

  for (const d of incoming) {
    parts.push(h('div', { class: 'card', style: { borderColor: 'var(--gold)' } },
      h('h3', null, `📨 ${team(d.from)} sana teklif yaptı`), dealLine(d),
      info.open ? h('div', { class: 'btns mt' },
        h('button', { class: 'btn primary', onclick: async () => { if (await confirmSheet('Teklifi kabul et', 'Takas hemen gerçekleşir. Emin misin?', 'Kabul et')) ctx.run(() => api.respondTransfer(app.code, room, seat, d.id, true), 'Transfer tamamlandı!'); } }, 'Kabul et'),
        h('button', { class: 'btn danger', onclick: () => ctx.run(() => api.respondTransfer(app.code, room, seat, d.id, false), 'Teklif reddedildi.') }, 'Reddet')) : null));
  }
  for (const d of mine) {
    parts.push(h('div', { class: 'card' }, h('h3', null, `⏳ ${team(d.to)} cevabını bekliyor`), dealLine(d),
      h('button', { class: 'btn sm mt', onclick: () => ctx.run(() => api.withdrawTransfer(app.code, room, seat, d.id), 'Teklif geri çekildi.') }, 'Teklifi geri çek')));
  }

  if (info.open && !info.used && !mine.length) parts.push(offerForm(ctx, info, ui, team, name, val));

  const news = info.done.slice().reverse();
  parts.push(h('div', { class: 'card' }, h('h3', null, '📰 Transfer haberleri'),
    news.length ? news.map((d) => h('div', { class: 'item', style: { display: 'block' } }, dealLine(d))) : h('div', { class: 'small muted' }, 'Henüz transfer yok.'),
    all.filter((d) => d.status === 'rejected' && (d.from === seat || d.to === seat)).map((d) => h('div', { class: 'mini mt' }, `❌ ${team(d.from)} → ${team(d.to)} teklifi reddedildi.`))));
  void doneIds;
  return h('div', null, parts);
}

function offerForm(ctx, info, ui, team, name, val) {
  const { app } = ctx;
  const room = app.room;
  const api = app.api;
  const seat = ctx.seat;
  const others = Object.keys(info.squads).filter((s) => s !== seat && !(room.members[s] || {}).bot); // bots do not trade
  if (!others.length) return h('div', { class: 'card small muted' }, 'Teklif yapabileceğin takım yok (botlar transfer yapmaz).');
  if (!ui.to || !others.includes(ui.to)) ui.to = others[0];
  const mySq = info.squads[seat] || [];
  const theirSq = info.squads[ui.to] || [];
  ui.give = ui.give.filter((p) => mySq.includes(p));
  ui.want = ui.want.filter((p) => theirSq.includes(p));
  const m = Math.max(0, Math.min(info.money, Math.round(ui.money || 0)));
  const deal = { from: seat, to: ui.to, give: ui.give, want: ui.want, money: m };
  const err = ui.give.length || ui.want.length ? dealError(info.squads, deal, api.byId) : 'Vereceğin ve istediğin oyuncuları seç.';
  const toggle = (key, pid) => {
    const l = ui[key];
    ui[key] = l.includes(pid) ? l.filter((x) => x !== pid) : l.length < MAX_SWAP ? [...l, pid] : l;
    ctx.render();
  };
  const list = (ids, key) => h('div', { class: 'list' }, ROLES.flatMap((r) => ids.filter((id) => roleOf(api.byId[id]) === r)).map((pid) => {
    const p = api.byId[pid];
    const on = ui[key].includes(pid);
    return h('div', { class: `item ${on ? 'suggested' : ''}` }, avatar(p, { size: 40, pos: true }),
      h('button', { class: 'grow', style: { textAlign: 'left', background: 'none', border: 0, color: 'inherit', padding: 0 }, onclick: () => openPlayerSheet(ctx, pid) },
        h('div', { class: 'name ellipsis' }, p.name), h('div', { class: 'meta' }, `seviye ${api.levelOf(p).toFixed(0)} · ${money(api.prices[pid])}`)),
      h('button', { class: `btn sm ${on ? '' : 'primary'}`, onclick: () => toggle(key, pid) }, on ? 'Çıkar' : key === 'give' ? 'Ver' : 'İste'));
  }));
  return h('div', { class: 'card', style: { borderColor: 'var(--accent)' } },
    h('h3', null, '✍️ Yeni teklif'),
    h('div', { class: 'chips mb' }, others.map((s) => h('button', { class: `chip ${ui.to === s ? 'on' : ''}`, onclick: () => { ui.to = s; ui.want = []; ctx.render(); } }, team(s)))),
    h('div', { class: 'grid2' },
      h('div', null, h('div', { class: 'mini mb' }, `Vereceklerin (${ui.give.length})`), h('div', { class: 'small' }, ui.give.map(name).join(', ') || '—')),
      h('div', null, h('div', { class: 'mini mb' }, `İstediklerin (${ui.want.length})`), h('div', { class: 'small' }, ui.want.map(name).join(', ') || '—'))),
    h('label', { class: 'field mt' }, h('span', null, `Üstüne para (milyon €, en fazla ${Math.floor(info.money / 1e6)})`),
      h('input', { class: 'input', type: 'number', min: 0, max: Math.floor(info.money / 1e6), step: 1, value: Math.round(m / 1e6), 'data-k': 'tr-money', onchange: (e) => { ui.money = Math.max(0, Number(e.target.value) || 0) * 1e6; setTimeout(() => ctx.render(), 0); } })),
    h('div', { class: 'mini' }, `Oyun değeri: sen ${money(val(ui.give) + m)} ↔ ${team(ui.to)} ${money(val(ui.want))}`),
    err ? h('div', { class: 'banner warn mt' }, err) : null,
    h('button', { class: 'btn block primary mt', disabled: !!err, onclick: async () => {
      if (!(await confirmSheet('Teklifi gönder', `${team(ui.to)} kabul ederse takas hemen gerçekleşir ve transfer hakkın biter.`, 'Gönder'))) return;
      const ok = await ctx.run(() => api.proposeTransfer(app.code, room, seat, deal), 'Teklif gönderildi!');
      if (ok) { ui.give = []; ui.want = []; ui.money = 0; ctx.render(); }
    } }, 'Teklifi gönder'),
    h('h3', { class: 'mt' }, `${team(ui.to)} kadrosu: istediğini seç`), list(theirSq, 'want'),
    h('h3', { class: 'mt' }, 'Senin kadron: vereceğini seç'), list(mySq, 'give'));
}
