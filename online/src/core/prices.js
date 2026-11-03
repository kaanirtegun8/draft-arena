// Budget mode: every player gets a game price from what really matters on the pitch
// this season: current level (EA rating + real form + market value), age, positional
// versatility and position. Prices are deterministic so every phone shows the same.
import { currentLevel } from './abilities.js';
import { roleOf, altOf, isGK } from './positions.js';

export const BUDGET_OPTIONS = [
  { key: 'tight', amount: 500e6, label: 'Kısıtlı · €500M', desc: 'Birkaç yıldız ve çok sayıda ucuz oyuncu. Her seçim düşündürür.' },
  { key: 'low', amount: 700e6, label: 'Düşük · €700M', desc: 'Dengeli kadro kurmak için iyi planlamak gerekir.' },
  { key: 'mid', amount: 900e6, label: 'Orta · €900M', desc: 'Yıldızlar alınabilir ama her mevki yıldız olamaz.' },
  { key: 'high', amount: 1.15e9, label: 'Yüksek · €1.15B', desc: 'Güçlü kadrolar; en pahalı birkaç oyuncu yine de seçim ister.' },
  { key: 'rich', amount: 1.4e9, label: 'Zengin · €1.4B', desc: 'Bütçe neredeyse rahat; draft sırası daha çok önem kazanır.' },
];
export const DEFAULT_BUDGET = 900e6;
export function budgetOf(pub) {
  if (!pub || (pub.mode !== 'budget' && pub.mode !== 'auction')) return null;
  const v = Number(pub.budget);
  return BUDGET_OPTIONS.some((o) => o.amount === v) ? v : DEFAULT_BUDGET;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// level 70 -> €4M, doubles every 4 points (84 -> €45M, 88 -> €90M, 92 -> €180M)
export function playerPrice(p, model) {
  const level = currentLevel(p, model).level;
  let price = 4e6 * Math.pow(2, (level - 70) / 4);
  const age = p.age || 27;
  // young legs last longer (and grow), old legs tire fast: age weighs heavily on the price
  price *= age <= 21 ? 1.2 : age <= 24 ? 1.12 : age <= 27 ? 1 : age <= 29 ? 0.95 : age <= 31 ? 0.82 : age <= 32 ? 0.7 : age <= 33 ? 0.6 : age <= 34 ? 0.5 : 0.42;
  price *= 1 + Math.min(2, altOf(p).length) * 0.05; // plays several positions
  if (isGK(p)) price *= 0.75;
  else if (['ST', 'LW', 'RW', 'CAM'].includes(roleOf(p))) price *= 1.05;
  // a little of the real transfer value, so stars of famous clubs are not bargains
  if (p.mv) price = price * 0.85 + clamp(p.mv, 0.5e6, 250e6) * 0.15;
  return Math.max(1e6, Math.round(price / 5e5) * 5e5);
}

export function priceTable(pool, model) {
  const t = {};
  for (const p of pool) t[p.id] = playerPrice(p, model);
  return t;
}

export function spent(ids, prices) { return ids.reduce((a, id) => a + (prices[id] || 0), 0); }
