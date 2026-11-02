// Budget draft with sealed picks and auctions (mode 'auction').
import { h, toast, confirmSheet, closeSheet } from '../dom.js';
import { toArray } from '../../core/draft.js';
import { ROLES, ROLE_SHORT, ROLE_LABEL, roleOf } from '../../core/positions.js';
import { fmtValue } from '../../core/abilities.js';
import { MIN_RAISE } from '../../core/auction.js';
import { topbar, playerRow, openPlayerSheet, posBadge, seatLabel } from '../components.js';
import { claimsCard } from './lobby.js';
import { chemTag } from '../chem.js';
import { alertTurn, turnSplash, chime } from '../notify.js';

const HOW = { liste: 'liste fiyatı', 'artırma': 'açık artırma', 'sıralı': 'sıralı seçim', otomatik: 'otomatik seçim' };

export function renderAuction(ctx) {
  const { app } = ctx;
  const room = app.room;
  const api = app.api;
  const seat = ctx.seat;
  const admin = ctx.admin;
  const ui = app.ui.auction || (app.ui.auction = { sel: [], role: 'ALL', q: '', sort: 'level', tab: 'pick', affordOnly: true });
  const st = api.auction(room);
  const team = (s) => (room.members[s] || {}).team || s;
  const myTurn = st.waiting.includes(seat);
  const name = (pid) => (api.byId[pid] ? api.byId[pid].name : '?');
  const price = (pid) => api.prices[pid] || 0;
  const act = (fn, msg) => ctx.run(fn, msg);

  // turn alert (once per decision)
  const key = `${st.phase}|${st.round}|${st.sealedStep || ''}|${st.auction ? st.auction.pid + st.auction.bids.length : ''}|${st.snake ? st.snake.i : ''}`;
  if (myTurn && ui.alertKey !== key && !(st.phase === 'sealed' && st.sealedStep === 'reveal')) {
    ui.alertKey = key;
    alertTurn(st.phase === 'auction' ? 'Açık artırmada sıra sende!' : 'Sıra sende!');
    turnSplash(st.phase === 'auction' ? 'TEKLİF SIRASI SENDE!' : 'SIRA SENDE!');
  }
  // my sealed picks open automatically once everybody has committed
  if (st.phase === 'sealed' && st.sealedStep === 'reveal' && myTurn && ui.revealing !== key) {
    ui.revealing = key;
    api.revealPicks(app.code, room, seat).catch((e) => toast(e.message, 'err'));
  }
  // admin device: write the final squads when everything is decided
  if (st.done && admin && !ui.finalizing) {
    ui.finalizing = true;
    api.auctionFinalize(app.code, room).then(() => toast('Kadrolar kaydedildi!', 'ok')).catch((e) => { ui.finalizing = false; toast(e.message, 'err'); });
  }
  // pick timer: the admin device decides for whoever runs out of time
  const limit = room.public.pickSeconds || 0;
  const log = toArray(room.auction && room.auction.log);
  const lastAt = log.length ? log[log.length - 1].at : room.draft.startedAt;
  const timerEl = h('span', { class: 'timer' });
  if (limit && lastAt && !st.done) {
    const lim = (st.phase === 'sealed' ? limit * 2 : limit) * 1000;
    const tick = () => {
      const left = Math.max(0, Math.round((lastAt + lim - Date.now()) / 1000));
      timerEl.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      timerEl.className = `timer ${left <= 10 ? 'low' : ''}`;
      if (left === 0 && admin && ui.timeoutKey !== key) {
        ui.timeoutKey = key;
        (async () => { for (const s of st.waiting) await api.auctionSkip(app.code, room, s); })().catch(() => {});
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    app.cleanup = () => clearInterval(t);
  }

  const total = api.budget(room).total;
  const budgetCard = h('div', { class: 'card' },
    h('div', { class: 'row between' }, h('b', null, `Bütçen: ${fmtValue(st.left[seat] || 0)} kaldı`), h('span', { class: 'mini' }, `Kadro ${(st.own[seat] || []).length}/${room.public.squadSize}`)),
    h('div', { class: 'sb-progress', style: { marginTop: '6px' } }, h('i', { style: { width: `${Math.min(100, ((st.spent[seat] || 0) / total) * 100)}%` } })),
    h('div', { class: 'mini mt' }, `Harcanan ${st.spent[seat] ? fmtValue(st.spent[seat]) : "€0"} / ${fmtValue(total)}`, limit && !st.done ? h('span', null, ' · süre ', timerEl) : null));

  let phaseCard;
  const waitingLine = () => h('div', { class: 'small muted' }, 'Bekleniyor: ', st.waiting.map((s) => team(s)).join(', ') || '—');
  const adminSkips = () => (admin ? h('div', { class: 'btns mt' }, st.waiting.filter((s) => s !== seat || st.phase !== 'sealed').map((s) => h('button', { class: 'btn sm', onclick: async () => {
    if (await confirmSheet('Onun yerine karar ver', `${team(s)} için ${st.phase === 'auction' ? 'pas geçilsin' : 'otomatik seçim yapılsın'} mi?`, 'Evet')) act(() => api.auctionSkip(app.code, room, s));
  } }, `${team(s)}: ${st.phase === 'auction' ? 'pas geç' : 'otomatik seç'}`))) : null);

  if (st.done) {
    phaseCard = h('div', { class: 'card center' }, h('h3', null, '✅ Draft tamamlandı'), h('p', { class: 'small muted' }, admin ? 'Kadrolar kaydediliyor…' : 'Admin cihazı kadroları kaydediyor, birazdan hazırlık ekranı açılır.'));
  } else if (st.phase === 'sealed') {
    const k = st.picksAllowed[seat] || 0;
    const committed = !!st.commits[seat] || !!st.skips[seat];
    if (st.sealedStep === 'commit' && !committed && k > 0) {
      ui.sel = ui.sel.filter((pid) => !st.taken[pid]).slice(0, k);
      const sum = ui.sel.reduce((a, pid) => a + price(pid), 0);
      phaseCard = h('div', { class: 'card', style: { borderColor: 'var(--accent)' } },
        h('h3', null, `🔒 ${st.round}. gizli tur: ${k} oyuncu seç`),
        h('p', { class: 'small muted' }, 'Kimse kimin kimi seçtiğini görmez. Herkes mühürleyince seçimler aynı anda açılır. Tek seçen oyuncuyu liste fiyatına alır; birden fazla kişi seçerse aralarında açık artırma olur.'),
        h('div', { class: 'list' }, ui.sel.length ? ui.sel.map((pid) => h('div', { class: 'item' }, posBadge(api.byId[pid]), h('div', { class: 'grow' }, h('div', { class: 'name' }, name(pid)), h('div', { class: 'meta' }, fmtValue(price(pid)))),
          h('button', { class: 'btn sm', onclick: () => { ui.sel = ui.sel.filter((x) => x !== pid); ctx.render(); } }, 'Çıkar'))) : h('div', { class: 'item muted small' }, 'Aşağıdaki listeden oyuncu ekle.')),
        h('div', { class: 'row between mt' }, h('span', { class: 'small' }, `Toplam liste fiyatı: ${fmtValue(sum)}`),
          h('button', { class: 'btn primary', disabled: ui.sel.length !== k, onclick: () => act(async () => { await api.sealPicks(app.code, room, seat, ui.sel); ui.sel = []; }, 'Seçimin mühürlendi!') }, `Seçimi mühürle (${ui.sel.length}/${k})`)));
    } else {
      const mine = api.sealOf(app.code, st.round, seat);
      phaseCard = h('div', { class: 'card' },
        h('h3', null, st.sealedStep === 'reveal' ? `🔓 ${st.round}. tur: seçimler açılıyor…` : `🔒 ${st.round}. gizli tur`),
        committed ? h('p', { class: 'small' }, '✓ Seçimin mühürlendi', mine ? `: ${mine.picks.map(name).join(', ')}` : '', st.skips[seat] ? ' (otomatik)' : '') : k === 0 ? h('p', { class: 'small' }, 'Kadron dolu.') : null,
        waitingLine(), adminSkips());
    }
  } else if (st.phase === 'auction') {
    const a = st.auction;
    const p = api.byId[a.pid];
    const cur = a.bid == null ? a.base : a.bid;
    const max = st.maxPay(seat, a.pid);
    const amounts = a.bid == null ? [a.base, a.base + 5e6, a.base + 10e6] : [a.bid + MIN_RAISE, a.bid + 5e6, a.bid + 10e6];
    const input = h('input', { class: 'input grow', type: 'number', min: Math.round((a.bid == null ? a.base : a.bid + MIN_RAISE) / 1e6), step: 1, placeholder: 'Milyon €', 'data-k': 'bid-in' });
    phaseCard = h('div', { class: 'card auction-card', style: { borderColor: 'var(--gold)' } },
      h('div', { class: 'mini' }, '🔨 AÇIK ARTIRMA'),
      h('button', { class: 'item', style: { width: '100%' }, onclick: () => openPlayerSheet(ctx, a.pid) }, posBadge(p),
        h('div', { class: 'grow' }, h('div', { class: 'name' }, p.name), h('div', { class: 'meta' }, `${p.club || ''} · seviye ${api.levelOf(p).toFixed(0)} · liste ${fmtValue(a.base)}`))),
      h('div', { class: 'center mt' }, h('div', { class: 'mini' }, a.bid == null ? 'Açılış (liste fiyatı)' : 'En yüksek teklif'), h('div', { class: 'code-big', style: { fontSize: '30px' } }, fmtValue(cur)),
        a.leader ? h('div', { class: 'small' }, '👑 ', team(a.leader)) : null),
      h('div', { class: 'row wrap mt', style: { gap: '6px', justifyContent: 'center' } }, a.bidders.map((s) => h('span', { class: `tag ${!a.active.includes(s) ? '' : s === a.turn ? 'warn' : 'ok'}` },
        `${s === a.turn ? '▶ ' : ''}${team(s)}${!a.active.includes(s) ? ' (pas)' : s === a.leader ? ' 👑' : ''}`))),
      myTurn ? h('div', { class: 'mt' },
        h('div', { class: 'mini center mb' }, `Sıra sende! En fazla verebileceğin: ${fmtValue(Math.max(0, max))}`),
        h('div', { class: 'btns', style: { justifyContent: 'center' } }, amounts.filter((v) => v <= max).map((v) => h('button', { class: 'btn primary', onclick: () => act(() => api.auctionBid(app.code, room, seat, v)) }, fmtValue(v)))),
        h('div', { class: 'row mt' }, input, h('button', { class: 'btn', onclick: () => { const v = Number(input.value) * 1e6; if (!v) return; act(() => api.auctionBid(app.code, room, seat, v)); } }, 'Teklif ver')),
        h('button', { class: 'btn block danger mt', onclick: () => act(() => api.auctionPass(app.code, room, seat)) }, a.leader ? 'Pas geç (çekil)' : 'Pas geç')) : h('div', { class: 'small muted center mt' }, `Sıra: ${team(a.turn)}`),
      a.bids.length ? h('div', { class: 'mini mt' }, a.bids.slice(-6).map((b) => `${team(b.seat)} ${b.pass ? 'pas' : fmtValue(b.amount)}`).join(' → ')) : null,
      st.queue.length ? h('div', { class: 'mini mt' }, 'Sıradaki artırmalar: ', st.queue.map((q) => name(q.pid)).join(', ')) : null,
      adminSkips());
  } else if (st.phase === 'snake') {
    const s = st.waiting[0];
    phaseCard = myTurn
      ? h('div', { class: 'banner turn' }, '🔔 SIRA SENDE! Bütçene uyan bir oyuncu al.')
      : h('div', { class: 'card' }, h('h3', null, 'Sıralı seçim (bütçeli)'), h('div', { class: 'small' }, 'Sırada: ', seatLabel(room, s)), adminSkips());
  }

  const showList = !st.done && ((st.phase === 'sealed' && st.sealedStep === 'commit' && !st.commits[seat] && !st.skips[seat] && (st.picksAllowed[seat] || 0) > 0) || (st.phase === 'snake' && myTurn));
  const tabs = h('div', { class: 'chips mb' }, [['pick', showList ? 'Oyuncular' : 'Oyuncular'], ['teams', 'Kadrolar'], ['history', 'Olaylar']].map(([k2, l]) =>
    h('button', { class: `chip ${ui.tab === k2 ? 'on' : ''}`, onclick: () => { ui.tab = k2; ctx.render(); } }, l)));
  let body;
  if (ui.tab === 'teams') body = teamsView(ctx, st, team, name);
  else if (ui.tab === 'history') body = h('div', { class: 'list' }, st.history.length ? st.history.slice().reverse().map((x) => h('div', { class: 'item small' },
    h('div', { class: 'grow' }, h('b', null, team(x.seat)), ` · ${name(x.pid)}`), h('span', { class: `tag ${x.how === 'artırma' ? 'warn' : ''}` }, `${fmtValue(x.price)} · ${HOW[x.how] || x.how}`))) : h('div', { class: 'item muted small' }, 'Henüz alım yok.'));
  else body = playerList(ctx, room, st, { showList, myTurn });

  const sub = st.done ? 'Draft bitti' : st.phase === 'sealed' ? `Gizli seçim · ${st.round}. tur` : st.phase === 'auction' ? 'Açık artırma' : 'Sıralı seçim (bütçeli)';
  return h('div', null, topbar(room.public.name, sub), claimsCard(ctx), budgetCard, phaseCard, tabs, body);
}

function teamsView(ctx, st, team, name) {
  const api = ctx.app.api;
  return h('div', null, Object.keys(st.own).map((s) => h('div', { class: 'card' },
    h('div', { class: 'row between' }, h('b', null, team(s)), h('span', { class: 'mini' }, `${st.own[s].length} oyuncu · harcanan ${fmtValue(st.spent[s])} · kalan ${fmtValue(st.left[s])}`)),
    h('div', { class: 'list mt' }, st.own[s].map((pid) => h('div', { class: 'item small' }, posBadge(api.byId[pid]), h('div', { class: 'grow' }, name(pid)), h('span', { class: 'mini' }, fmtValue(st.paid[s][pid])))),
      !st.own[s].length ? h('div', { class: 'item muted small' }, 'Henüz oyuncu yok.') : null))));
}

function playerList(ctx, room, st, { showList, myTurn }) {
  const { app } = ctx;
  const api = app.api;
  const seat = ctx.seat;
  const ui = app.ui.auction;
  const listEl = h('div', { class: 'list' });
  const sealing = st.phase === 'sealed';
  const fill = () => {
    listEl.innerHTML = '';
    const q = ui.q.trim().toLocaleLowerCase('tr');
    let items = api.pool.filter((p) => !st.taken[p.id]);
    if (ui.role !== 'ALL') items = items.filter((p) => roleOf(p) === ui.role);
    if (q) items = items.filter((p) => `${p.name} ${p.club} ${p.nat} ${p.pos}`.toLocaleLowerCase('tr').includes(q));
    const lv = (p) => api.levelOf(p);
    const pr = (p) => api.prices[p.id] || 0;
    const sorts = { level: (a, b) => lv(b) - lv(a), price: (a, b) => pr(b) - pr(a), cheap: (a, b) => pr(a) - pr(b), value: (a, b) => lv(b) / Math.log10(pr(b)) - lv(a) / Math.log10(pr(a)) };
    items.sort((a, b) => sorts[ui.sort](a, b) || b.ovr - a.ovr);
    const fallback = showList && !sealing ? st.suggest(seat) : null;
    const status = (p) => {
      if (showList && sealing) {
        const inSel = ui.sel.includes(p.id);
        const ok = inSel || st.validSealed(seat, [...ui.sel, p.id]).length === ui.sel.length + 1;
        const full = !inSel && ui.sel.length >= (st.picksAllowed[seat] || 0);
        return { ok: ok && !full, fits: ok, why: inSel ? 'Çıkar' : full ? 'Dolu' : ok ? 'Ekle' : 'Uymaz' };
      }
      if (showList) { const ok = pr(p) <= st.maxPay(seat, p.id) || p.id === fallback; return { ok, fits: ok, why: ok ? 'Al' : 'Bütçe' }; }
      return { ok: false, fits: true, why: '' };
    };
    let rows = items.map((p) => ({ p, ...status(p) }));
    if (showList && ui.affordOnly) rows = rows.filter((r) => r.fits);
    const shown = rows.slice(0, 100);
    if (!shown.length) listEl.appendChild(h('div', { class: 'item muted small' }, 'Bu filtrede oyuncu yok.'));
    for (const { p, ok, why } of shown) {
      const onPick = () => {
        if (sealing) { ui.sel = ui.sel.includes(p.id) ? ui.sel.filter((x) => x !== p.id) : [...ui.sel, p.id]; ctx.render(); return; }
        ctx.run(async () => { await api.auctionPick(app.code, room, seat, p.id); closeSheet(); }, `${p.name} alındı!`);
      };
      listEl.appendChild(playerRow(api, p, {
        room,
        tag: chemTag(p, [...(st.own[seat] || []), ...(sealing ? ui.sel : [])], api.byId),
        onClick: () => openPlayerSheet(ctx, p.id, showList ? { actions: [h('button', { class: 'btn block primary', disabled: !ok, onclick: () => { closeSheet(); onPick(); } }, `${why} · ${fmtValue(pr(p))}`)] } : {}),
        right: h('div', { class: 'row', style: { gap: '8px' } },
          h('div', { class: 'center' }, h('div', { class: 'lvl' }, lv(p).toFixed(0)), h('div', { class: 'mini' }, fmtValue(pr(p)))),
          showList ? h('button', { class: `btn sm ${ui.sel.includes(p.id) ? '' : 'primary'}`, disabled: !ok, onclick: (e) => { e.stopPropagation(); onPick(); } }, why) : null),
      }));
    }
  };
  fill();
  return h('div', null,
    !showList ? h('p', { class: 'small muted' }, myTurn ? '' : 'Seçim sırası sende değilken oyuncuları ve fiyatlarını inceleyebilirsin.') : null,
    h('div', { class: 'chips mb' }, [['ALL', 'Tümü'], ...ROLES.map((r) => [r, ROLE_SHORT[r]])].map(([r, l]) =>
      h('button', { class: `chip ${ui.role === r ? 'on' : ''}`, title: ROLE_LABEL[r] || '', onclick: () => { ui.role = r; ctx.render(); } }, l))),
    h('div', { class: 'row mb' },
      h('input', { class: 'input grow', type: 'search', placeholder: 'İsim, kulüp, ülke…', value: ui.q, 'data-k': 'auc-q', oninput: (e) => { ui.q = e.target.value; fill(); } }),
      h('select', { class: 'input', style: { width: '140px' }, onchange: (e) => { ui.sort = e.target.value; fill(); } },
        [['level', 'Seviye'], ['price', 'Fiyat (pahalı)'], ['cheap', 'Fiyat (ucuz)'], ['value', 'Fiyat/performans']].map(([v, l]) => h('option', { value: v, selected: ui.sort === v }, l)))),
    showList ? h('label', { class: 'row small mb', style: { gap: '8px' } }, h('input', { type: 'checkbox', checked: ui.affordOnly, onchange: (e) => { ui.affordOnly = e.target.checked; fill(); } }), 'Sadece bütçeme ve kadroma uyanlar') : null,
    listEl);
}

export { chime };
