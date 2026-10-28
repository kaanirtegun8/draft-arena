// Shared UI pieces: player rows, player detail sheet, team labels, top bar.
import { h, openSheet, condBar, ratingClass, toast } from './dom.js';
import { groupOf, isGK, formFromMatchRating } from '../core/players.js';
import { GROUP_LABEL } from '../core/config.js';
import { getManager, setForm } from '../core/league.js';
import { seasonPlayerStats } from '../core/stats.js';

export const GROUP_SHORT = { GK: 'KL', DEF: 'DEF', MID: 'OS', FWD: 'FV' };
export function posBadge(p, slot) {
  const pos = slot || p.pos;
  return h('span', { class: `badge pos-${groupOf({ pos })}` }, pos);
}

export function topbar(ctx, title, sub, { back, right } = {}) {
  return h('div', { class: 'topbar' },
    back ? h('button', { class: 'iconbtn', 'aria-label': 'Geri', onclick: back }, '‹') : null,
    h('h1', null, title, sub ? h('span', { class: 'sub' }, sub) : null),
    right || null);
}

export function teamLabel(state, managerId, opts = {}) {
  const m = getManager(state, managerId);
  if (!m) return h('span', null, '—');
  return h('span', { class: 'row', style: { gap: '6px', display: 'inline-flex', minWidth: 0, justifyContent: opts.right ? 'flex-end' : 'flex-start' } },
    opts.right ? null : h('span', { class: 'dot', style: { background: m.color } }),
    h('span', { class: 'ellipsis' }, m.name),
    opts.right ? h('span', { class: 'dot', style: { background: m.color } }) : null);
}

export function keyStats(p) {
  if (isGK(p)) return `DIV ${p.div} · REF ${p.ref} · HAN ${p.han}`;
  return `HIZ ${p.pac} · ŞUT ${p.sho} · PAS ${p.pas} · DRİ ${p.dri} · DEF ${p.def} · FİZ ${p.phy}`;
}

export function playerRow(p, { onClick, right, extra, cls = '' } = {}) {
  return h(onClick ? 'button' : 'div', { class: `item ${cls}`, onclick: onClick },
    posBadge(p),
    h('div', { class: 'grow' },
      h('div', { class: 'name ellipsis' }, p.name),
      h('div', { class: 'meta ellipsis' }, `${p.club} · ${p.nat} · ${p.age}`),
      extra || null),
    right !== undefined ? right : h('div', { class: 'ovr' }, p.ovr));
}

export function attrGrid(p) {
  const items = isGK(p)
    ? [['DIV', p.div], ['TUT', p.han], ['VUR', p.kic], ['REF', p.ref], ['HIZ', p.spd], ['POZ', p.gkp]]
    : [['HIZ', p.pac], ['ŞUT', p.sho], ['PAS', p.pas], ['DRİ', p.dri], ['DEF', p.def], ['FİZ', p.phy]];
  return h('div', { class: 'attrs' }, items.map(([k, v]) => h('div', { class: 'attr' }, h('b', null, v), h('span', null, k))));
}

export function formText(state, pid) {
  const f = state && state.form[pid];
  if (!f) return 'Veri yok (nötr)';
  return `${f.value}/100${f.source ? ' · ' + f.source : ''}${f.date ? ' · ' + f.date : ''}`;
}

// Player detail sheet with attributes, condition, form editor and season stats.
export function openPlayerSheet(ctx, pid, { actions } = {}) {
  const { app } = ctx;
  const p = app.byId[pid];
  const st = app.league;
  const ps = st && st.playerState[pid];
  const owner = st && st.managers.find((m) => m.squad.includes(pid));
  const stats = st && st.phase !== 'draft' ? seasonPlayerStats(st)[pid] : null;
  const formInput = h('input', { class: 'input', type: 'number', min: 0, max: 100, step: 1, placeholder: 'boş = nötr', value: st && st.form[pid] ? st.form[pid].value : '' });
  const ratingInput = h('input', { class: 'input', type: 'number', min: 3, max: 10, step: 0.01, placeholder: 'örn. 7.12' });
  const srcInput = h('input', { class: 'input', placeholder: 'Kaynak (örn. Sofascore son 5 maç)', value: st && st.form[pid] ? st.form[pid].source : '' });
  const content = h('div', null,
    h('div', { class: 'row mb' }, posBadge(p),
      h('div', { class: 'grow' }, h('div', { class: 'name' }, p.name), h('div', { class: 'muted small' }, `${p.club} · ${p.nat} · ${p.age} yaş · ${GROUP_LABEL[groupOf(p)]}${p.alt && p.alt.length ? ' · Alt: ' + p.alt.join(', ') : ''}`)),
      h('div', { class: 'ovr', style: { fontSize: '28px' } }, p.ovr)),
    attrGrid(p),
    owner ? h('div', { class: 'card mt' },
      h('div', { class: 'row between' }, h('span', null, 'Takım'), teamLabel(st, owner.id))) : null,
    ps ? h('div', { class: 'card' },
      h('div', { class: 'row between mb' }, h('span', null, 'Kondisyon'), h('b', null, Math.round(ps.condition))),
      condBar(ps.condition),
      ps.injuredWeeks > 0 ? h('div', { class: 'mt' }, h('span', { class: 'tag danger' }, `Sakat · ${ps.injuredWeeks} hafta`)) : null) : null,
    stats ? h('div', { class: 'card' }, h('h3', null, 'Sezon İstatistikleri'), statsTable(p, stats)) : null,
    st ? h('div', { class: 'card' },
      h('h3', null, 'Gerçek Hayat Formu'),
      h('p', { class: 'muted small' }, 'Form verisi girilmezse oyuncu nötr (kendi normal seviyesinde) değerlendirilir. 50 = normal, 100 = çok iyi, 0 = çok kötü. Değişiklik sadece sonraki maçları etkiler.'),
      h('div', { class: 'muted small mb' }, 'Şu an: ', formText(st, pid)),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', null, 'Form (0-100)'), formInput),
        h('label', { class: 'field' }, h('span', null, 'veya ortalama maç puanı'), ratingInput)),
      h('label', { class: 'field' }, h('span', null, 'Kaynak'), srcInput),
      h('div', { class: 'btns' },
        h('button', { class: 'btn sm', onclick: () => {
          ctx.commit((s) => setForm(s, pid, null), { rerender: false });
          toast('Form verisi silindi (nötr).', 'ok'); openPlayerSheet(ctx, pid, { actions });
        } }, 'Temizle'),
        h('button', { class: 'btn sm primary', onclick: () => {
          let v = formInput.value;
          if (ratingInput.value) v = formFromMatchRating(parseFloat(ratingInput.value));
          ctx.commit((s) => setForm(s, pid, v === '' ? null : v, srcInput.value, new Date().toISOString().slice(0, 10)), { rerender: false });
          toast('Form kaydedildi.', 'ok'); openPlayerSheet(ctx, pid, { actions });
        } }, 'Kaydet'))) : null,
    actions ? h('div', { class: 'btns mt' }, actions) : null);
  openSheet(p.name, content, () => ctx.render());
}

export function statsTable(p, s) {
  const rows = [
    ['Maç', s.apps], ['İlk 11', s.starts], ['Dakika', s.minutes], ['Gol', s.goals], ['Asist', s.assists],
    ['Şut', s.shots], ['İsabetli şut', s.shotsOnTarget], ['Sarı kart', s.yellow], ['Kırmızı kart', s.red],
    ['Ort. puan', s.apps ? s.avgRating.toFixed(2) : '—'], ['Maçın oyuncusu', s.motm],
  ];
  if (isGK(p)) rows.push(['Kurtarış', s.saves], ['Yenilen gol', s.conceded], ['Gol yemeden', s.cleanSheets]);
  return h('div', { class: 'grid2' }, rows.map(([k, v]) => h('div', { class: 'row between small' }, h('span', { class: 'muted' }, k), h('b', null, v))));
}

export function ratingBadge(r) {
  return h('span', { class: ratingClass(r) }, r.toFixed(1));
}

export function tabbar(items, active, onSelect) {
  return h('nav', { class: 'tabbar' }, h('div', { class: 'inner' },
    items.map(([key, icon, label]) => h('button', { class: key === active ? 'on' : '', onclick: () => onSelect(key) }, h('span', { class: 'ic' }, icon), label))));
}
