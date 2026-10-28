// Draft room: snake draft with quotas, CPU picks, board view.
import { h, toast, confirmSheet, closeSheet } from '../dom.js';
import { currentPickSlot, getManager, makePick, suggestPick, autoDraftAll } from '../../core/league.js';
import { remainingNeeds, pickError } from '../../core/draft.js';
import { groupOf } from '../../core/players.js';
import { POSITION_QUOTAS } from '../../core/config.js';
import { topbar, playerRow, openPlayerSheet, posBadge, keyStats, GROUP_SHORT } from '../components.js';
import { openSaves } from './home.js';

export function renderDraft(ctx) {
  const { app } = ctx;
  const st = app.league;
  if (!st) { setTimeout(() => ctx.go('home')); return h('div'); }
  if (st.phase !== 'draft') { setTimeout(() => ctx.go('hub')); return h('div'); }
  const ui = app.ui.draft || (app.ui.draft = { tab: 'players', group: 'ALL', q: '', sort: 'ovr', fast: false });
  const slot = currentPickSlot(st);
  const mgr = getManager(st, slot.managerId);
  const need = remainingNeeds(mgr.squad, app.byId);
  const suggestion = suggestPick(st, mgr.id, app.byId, app.pool);

  const doPick = (pid) => {
    const err = pickError(st, mgr.id, pid, app.byId);
    if (err) { toast(err, 'err'); return; }
    const p = app.byId[pid];
    ctx.commit((s) => makePick(s, mgr.id, pid, app.byId), { rerender: false });
    closeSheet();
    toast(`${mgr.name}: ${p.name} (${p.pos})`, 'ok');
    afterPick();
  };
  const afterPick = () => {
    if (st.phase !== 'draft') { toast('Draft tamamlandı! Sezon başlıyor.', 'ok'); ctx.go('hub'); return; }
    ctx.render();
  };

  // CPU on the clock: pick after a short delay so humans can follow the draft
  if (!mgr.isHuman) {
    const timer = setTimeout(() => {
      if (app.league !== st || st.phase !== 'draft' || currentPickSlot(st) !== slot) return;
      const pid = suggestPick(st, mgr.id, app.byId, app.pool);
      ctx.commit((s) => makePick(s, mgr.id, pid, app.byId), { rerender: false });
      afterPick();
    }, ui.fast ? 60 : 650);
    app.cleanup = () => clearTimeout(timer);
  }

  const header = topbar(ctx, st.name, `Draft · Tur ${slot.round}/18 · Seçim ${slot.pick}/90`, {
    back: () => ctx.go('home'),
    right: h('button', { class: 'iconbtn', 'aria-label': 'Kayıtlar', onclick: () => openSaves(ctx) }, '💾'),
  });

  const clock = h('div', { class: `clock ${mgr.isHuman ? '' : 'cpu'}` },
    h('span', { class: 'dot', style: { background: mgr.color, width: '14px', height: '14px' } }),
    h('div', { class: 'grow' },
      h('div', { class: 'name' }, mgr.isHuman ? `Sıra sende: ${mgr.name}` : `${mgr.name} (CPU) seçiyor…`),
      h('div', { class: 'small muted' }, `Kadro ${mgr.squad.length}/18 · İhtiyaç: `,
        Object.keys(POSITION_QUOTAS).map((g) => `${GROUP_SHORT[g]} ${need[g]}`).join(' · '))),
    mgr.isHuman
      ? h('button', { class: 'btn sm primary', onclick: () => doPick(suggestion) }, 'Otomatik seç')
      : h('button', { class: 'btn sm', onclick: () => { ui.fast = !ui.fast; ctx.render(); } }, ui.fast ? 'Normal hız' : 'Hızlandır'));

  const tabs = h('div', { class: 'chips mb' },
    [['players', 'Oyuncular'], ['board', 'Draft Tahtası'], ['squad', `${mgr.name} Kadrosu`], ['order', 'Sıra']].map(([k, label]) =>
      h('button', { class: `chip ${ui.tab === k ? 'on' : ''}`, onclick: () => { ui.tab = k; ctx.render(); } }, label)));

  let body;
  if (ui.tab === 'board') body = board(ctx, st);
  else if (ui.tab === 'squad') body = squadView(ctx, st, mgr);
  else if (ui.tab === 'order') body = orderView(st);
  else body = playerList(ctx, st, mgr, need, suggestion, doPick, ui);

  return h('div', null, header, clock, tabs, body,
    h('div', { class: 'card mt' },
      h('h3', null, 'Hızlı işlemler'),
      h('button', { class: 'btn block', onclick: async () => {
        if (!(await confirmSheet('Draft\'ı otomatik bitir', 'Kalan tüm seçimler (insan menajerler dahil) otomatik yapılacak.', 'Bitir'))) return;
        if (app.cleanup) { app.cleanup(); app.cleanup = null; }
        ctx.commit((s) => autoDraftAll(s, app.byId, app.pool), { rerender: false });
        toast('Draft tamamlandı!', 'ok');
        ctx.go('hub');
      } }, 'Kalan draftı otomatik tamamla')));
}

function playerList(ctx, st, mgr, need, suggestion, doPick, ui) {
  const { app } = ctx;
  const listEl = h('div', { class: 'list' });
  const fill = () => {
    listEl.innerHTML = '';
    const q = ui.q.trim().toLocaleLowerCase('tr');
    let items = app.pool.filter((p) => !st.draft.taken[p.id]);
    if (ui.group !== 'ALL') items = items.filter((p) => groupOf(p) === ui.group);
    if (q) items = items.filter((p) => (p.name + ' ' + p.club + ' ' + p.nat + ' ' + p.pos).toLocaleLowerCase('tr').includes(q));
    if (ui.sort === 'name') items.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    else if (ui.sort === 'age') items.sort((a, b) => a.age - b.age || b.ovr - a.ovr);
    else items.sort((a, b) => b.ovr - a.ovr || a.name.localeCompare(b.name, 'tr'));
    if (!items.length) listEl.appendChild(h('div', { class: 'item muted' }, 'Oyuncu bulunamadı.'));
    for (const p of items) {
      const full = need[groupOf(p)] <= 0;
      const canPick = mgr.isHuman && !full;
      listEl.appendChild(playerRow(p, {
        cls: p.id === suggestion && mgr.isHuman ? 'suggested' : '',
        extra: h('div', { class: 'meta ellipsis' }, keyStats(p)),
        onClick: () => openPlayerSheet(ctx, p.id, {
          actions: mgr.isHuman ? [h('button', { class: 'btn block primary', disabled: !canPick, onclick: () => doPick(p.id) }, full ? 'Kontenjan dolu' : `${mgr.name} için seç`)] : null,
        }),
        right: h('div', { class: 'row', style: { gap: '8px' } },
          p.id === suggestion && mgr.isHuman ? h('span', { class: 'tag ok' }, 'Öneri') : null,
          h('div', { class: 'ovr' }, p.ovr),
          mgr.isHuman ? h('button', { class: 'btn sm primary', disabled: !canPick, onclick: (e) => { e.stopPropagation(); doPick(p.id); } }, 'Seç') : null),
      }));
    }
  };
  fill();
  const chips = h('div', { class: 'chips mb' },
    [['ALL', 'Tümü'], ['GK', 'Kaleci'], ['DEF', 'Defans'], ['MID', 'Orta Saha'], ['FWD', 'Forvet']].map(([g, label]) =>
      h('button', { class: `chip ${ui.group === g ? 'on' : ''} ${g !== 'ALL' && need[g] <= 0 ? 'full' : ''}`, onclick: () => { ui.group = g; ctx.render(); } },
        label, g !== 'ALL' ? ` (${need[g]})` : '')));
  const search = h('input', { class: 'input grow', type: 'search', placeholder: 'Oyuncu, kulüp, ülke ara', value: ui.q, oninput: (e) => { ui.q = e.target.value; fill(); } });
  const sort = h('select', { class: 'input', style: { width: '110px' }, onchange: (e) => { ui.sort = e.target.value; fill(); } },
    [['ovr', 'Güç'], ['name', 'İsim'], ['age', 'Yaş']].map(([v, l]) => h('option', { value: v, selected: ui.sort === v }, l)));
  return h('div', null, chips, h('div', { class: 'row mb' }, search, sort), listEl);
}

function board(ctx, st) {
  const cols = st.draft.firstRoundOrder.map((mid) => {
    const m = getManager(st, mid);
    const picks = st.draft.picks.filter((p) => p.managerId === mid);
    return h('div', { class: 'col' },
      h('div', { class: 'row small mb', style: { gap: '6px' } }, h('span', { class: 'dot', style: { background: m.color } }), h('b', { class: 'ellipsis' }, m.name)),
      picks.map((p) => {
        const pl = ctx.app.byId[p.playerId];
        return h('div', { class: 'cell' }, h('span', { class: 'muted' }, `#${p.pick} `), posBadge(pl), ' ', pl.name);
      }));
  });
  return h('div', { class: 'board' }, cols);
}

function squadView(ctx, st, mgr) {
  const groups = ['GK', 'DEF', 'MID', 'FWD'];
  return h('div', null, groups.map((g) => {
    const ps = mgr.squad.map((id) => ctx.app.byId[id]).filter((p) => groupOf(p) === g);
    return h('div', { class: 'card' },
      h('h3', null, `${GROUP_SHORT[g]} ${ps.length}/${POSITION_QUOTAS[g]}`),
      ps.length ? h('div', { class: 'list' }, ps.map((p) => playerRow(p, { onClick: () => openPlayerSheet(ctx, p.id) }))) : h('div', { class: 'muted small' }, 'Henüz yok'));
  }));
}

function orderView(st) {
  return h('div', { class: 'card' },
    h('h3', null, 'Yılan draft sırası'),
    h('p', { class: 'small muted' }, 'Tek turlar 1→5, çift turlar 5→1. 18 tur sonunda her menajerin seçim numaraları toplamı eşittir.'),
    h('div', { class: 'list' }, st.draft.firstRoundOrder.map((mid, i) => {
      const m = getManager(st, mid);
      const mine = st.draft.order.filter((o) => o.managerId === mid);
      return h('div', { class: 'item' }, h('b', null, i + 1), h('span', { class: 'dot', style: { background: m.color } }),
        h('div', { class: 'grow' }, h('div', { class: 'name' }, m.name, m.isHuman ? ' 👤' : ' 🤖'),
          h('div', { class: 'meta ellipsis' }, 'Seçimler: ', mine.map((o) => o.pick).join(', '))));
    })));
}
