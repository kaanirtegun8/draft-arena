// Player data and real-life form editor.
import { h, toast, downloadText } from '../dom.js';
import { setForm } from '../../core/league.js';
import { formFromMatchRating } from '../../core/players.js';
import { PLAYER_DATA_META } from '../../data/players.js';
import { PERFORMANCE_WEIGHTS } from '../../core/config.js';
import { topbar, playerRow, openPlayerSheet, formText } from '../components.js';

export function renderData(ctx) {
  const { app } = ctx;
  const st = app.league;
  const ui = app.ui.data || (app.ui.data = { q: '', only: st ? 'drafted' : 'all' });
  const back = () => ctx.go(app.params.from === 'hub' ? 'hub' : app.params.from === 'draft' ? 'draft' : 'home');
  const w = PERFORMANCE_WEIGHTS;
  const listEl = h('div', { class: 'list' });
  const fill = () => {
    listEl.innerHTML = '';
    const q = ui.q.trim().toLocaleLowerCase('tr');
    let items = app.pool.slice();
    if (st && ui.only === 'drafted') items = items.filter((p) => st.draft.taken[p.id]);
    if (st && ui.only === 'withform') items = items.filter((p) => st.form[p.id]);
    if (q) items = items.filter((p) => (p.name + ' ' + p.club).toLocaleLowerCase('tr').includes(q));
    items.sort((a, b) => b.ovr - a.ovr);
    for (const p of items) {
      listEl.appendChild(playerRow(p, {
        onClick: () => openPlayerSheet(ctx, p.id),
        extra: st ? h('div', { class: 'meta' }, 'Form: ', formText(st, p.id)) : null,
      }));
    }
    if (!items.length) listEl.appendChild(h('div', { class: 'item muted' }, 'Oyuncu yok.'));
  };
  fill();

  const importBox = h('textarea', { class: 'input', placeholder: '{"Kylian Mbappé": 72, "p005": {"rating": 7.4, "source": "Sofascore"}}' });
  const doImport = () => {
    let obj;
    try { obj = JSON.parse(importBox.value); } catch { toast('Geçersiz JSON.', 'err'); return; }
    const byName = {};
    for (const p of app.pool) byName[p.name.toLocaleLowerCase('tr')] = p.id;
    let ok = 0, miss = [];
    ctx.commit((s) => {
      for (const [k, v] of Object.entries(obj)) {
        const pid = app.byId[k] ? k : byName[k.toLocaleLowerCase('tr')];
        if (!pid) { miss.push(k); continue; }
        let value, source = 'içe aktarma';
        if (typeof v === 'number') value = v;
        else if (v && typeof v === 'object') {
          value = typeof v.rating === 'number' ? formFromMatchRating(v.rating) : v.value;
          source = v.source || source;
        }
        if (value == null) { miss.push(k); continue; }
        setForm(s, pid, value, source, new Date().toISOString().slice(0, 10));
        ok++;
      }
    }, { rerender: false });
    toast(`${ok} oyuncunun formu güncellendi${miss.length ? `, ${miss.length} kayıt eşleşmedi` : ''}.`, miss.length ? 'err' : 'ok');
    fill();
  };

  return h('div', null,
    topbar(ctx, 'Oyuncu Verisi', 'EA FC özellikleri ve gerçek form', { back }),
    h('div', { class: 'card small' },
      h('div', null, h('b', null, 'Kaynak: '), PLAYER_DATA_META.version),
      h('div', { class: 'muted' }, PLAYER_DATA_META.note),
      h('div', { class: 'muted' }, `Havuz: ${app.pool.length} oyuncu · Tarih: ${PLAYER_DATA_META.asOf}`),
      h('div', { class: 'hr' }),
      h('div', null, h('b', null, 'Performans ağırlıkları: '), `EA ${pct(w.ea)} · Form ${pct(w.form)} · Taktik ${pct(w.tactic)} · Rakip ${pct(w.matchup)} · Kondisyon ${pct(w.condition)} · Rastgele ${pct(w.random)}`),
      h('div', { class: 'muted' }, 'Gerçek hayat form verisi oyunla birlikte gelmez ve uydurulmaz. Girilmeyen oyuncular nötr (50) kabul edilir. Formu oyuncuya dokunarak veya aşağıdan toplu olarak gir.')),
    st ? h('div', { class: 'card' },
      h('h3', null, 'Toplu form içe aktar (JSON)'),
      h('p', { class: 'small muted' }, 'Anahtar: oyuncu adı veya id. Değer: 0-100 form puanı ya da {"rating": 7.2} şeklinde ortalama maç puanı (6.8 = nötr).'),
      importBox,
      h('div', { class: 'btns mt' },
        h('button', { class: 'btn sm primary', onclick: doImport }, 'İçe aktar'),
        h('button', { class: 'btn sm', onclick: () => downloadText('draft-arena-form.json', JSON.stringify(Object.fromEntries(Object.entries(st.form).map(([k, v]) => [app.byId[k].name, v.value])), null, 2)) }, 'Mevcut formu indir'),
        h('button', { class: 'btn sm danger', onclick: () => { ctx.commit((s) => { for (const k of Object.keys(s.form)) setForm(s, k, null); }, { rerender: false }); toast('Tüm form verisi silindi (nötr).', 'ok'); fill(); } }, 'Tümünü sıfırla'))) : h('div', { class: 'card small muted' }, 'Form girmek için önce bir lig kur.'),
    h('div', { class: 'row mb' },
      h('input', { class: 'input grow', type: 'search', placeholder: 'Ara', value: ui.q, oninput: (e) => { ui.q = e.target.value; fill(); } }),
      st ? h('select', { class: 'input', style: { width: '130px' }, onchange: (e) => { ui.only = e.target.value; fill(); } },
        [['drafted', 'Seçilenler'], ['all', 'Tüm havuz'], ['withform', 'Formu olan']].map(([v, l]) => h('option', { value: v, selected: ui.only === v }, l))) : null),
    listEl);
}

function pct(v) { return `%${Math.round(v * 100)}`; }
