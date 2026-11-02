// Draft mode pickers shared by the create-room form and the lobby.
import { h } from './dom.js';
import { BUDGET_OPTIONS, DEFAULT_BUDGET } from '../core/prices.js';
import { SEALED_ROUND_OPTIONS } from '../core/auction.js';
import { fmtValue } from '../core/abilities.js';

export const MODE_OPTIONS = [
  { key: 'classic', label: 'Klasik draft', desc: 'Yılan sırasıyla seçim, bütçe yok.' },
  { key: 'budget', label: 'Sıralı + bütçe', desc: 'Yılan sırasıyla seçim; her oyuncunun bir fiyatı var, bütçen yetiyorsa alırsın.' },
  { key: 'auction', label: 'Gizli seçim + açık artırma', desc: 'Herkes aynı anda gizlice 3 oyuncu seçer. Aynı oyuncuyu seçenler arasında açık artırma yapılır, en çok veren alır.' },
];

// cur = { mode, budget, sealedRounds }, set(patch)
export function modeFields(cur, set, { disabled = false } = {}) {
  const mode = cur.mode || 'classic';
  const opt = MODE_OPTIONS.find((m) => m.key === mode) || MODE_OPTIONS[0];
  const budget = Number(cur.budget) || DEFAULT_BUDGET;
  const bOpt = BUDGET_OPTIONS.find((o) => o.amount === budget) || BUDGET_OPTIONS[2];
  return h('div', null,
    h('label', { class: 'field' }, h('span', null, 'Oyun modu'),
      h('select', { class: 'input', disabled, onchange: (e) => set({ mode: e.target.value }) }, MODE_OPTIONS.map((m) => h('option', { value: m.key, selected: m.key === mode }, m.label))),
      h('div', { class: 'mini' }, opt.desc)),
    mode !== 'classic' ? h('label', { class: 'field' }, h('span', null, 'Bütçe (18 kişilik kadro için; 16/20 kişide oranlanır)'),
      h('select', { class: 'input', disabled, onchange: (e) => set({ budget: Number(e.target.value) }) }, BUDGET_OPTIONS.map((o) => h('option', { value: o.amount, selected: o.amount === budget }, o.label))),
      h('div', { class: 'mini' }, bOpt.desc, ` Oyuncu fiyatı güncel güce (EA + gerçek form + piyasa değeri), yaşa, kaç mevki oynadığına ve mevkiye göre hesaplanır. Ortalama oyuncu ~€50M.`)) : null,
    mode === 'auction' ? h('label', { class: 'field' }, h('span', null, 'Gizli seçim turları'),
      h('select', { class: 'input', disabled, onchange: (e) => set({ sealedRounds: Number(e.target.value) }) }, SEALED_ROUND_OPTIONS.map((o) => h('option', { value: o.rounds, selected: (Number(cur.sealedRounds) || 1) === o.rounds }, o.label)))) : null);
}

export function modeSummary(pub, squadSize, total) {
  const mode = pub.mode || 'classic';
  if (mode === 'classic') return 'Mod: klasik draft (bütçe yok).';
  const t = total ? fmtValue(total) : '';
  if (mode === 'budget') return `Mod: sıralı + bütçe. Herkesin bütçesi ${t}. Bütçen yetmeyen oyuncuyu alamazsın; kadroyu tamamlayacak para hep ayrılır.`;
  const r = Number(pub.sealedRounds) || 1;
  return `Mod: gizli seçim + açık artırma. Herkesin bütçesi ${t}. ${r >= 99 ? 'Tüm draft' : `İlk ${r} tur`} gizli: herkes aynı anda 3 oyuncu seçer, aynı oyuncuyu seçenler sırayla teklif verir (en az +€1M), pas geçen çekilir, son kalan teklifini öder. ${r >= 99 ? '' : 'Sonra kalan kadro sıralı + bütçe ile tamamlanır.'}`;
}
