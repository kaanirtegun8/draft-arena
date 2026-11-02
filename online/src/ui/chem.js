// Chemistry helpers for the UI.
import { h } from './dom.js';
import { teamChemistry, chemLabel, linkOf } from '../core/chemistry.js';

// links a candidate would bring to my squad (shown in draft lists)
export function chemTag(p, squadIds, byId) {
  const clubs = squadIds.filter((id) => byId[id] && byId[id].club && byId[id].club === p.club).length;
  const nats = squadIds.filter((id) => byId[id] && byId[id].nat && byId[id].nat === p.nat).length;
  if (!clubs && !nats) return null;
  const parts = [];
  if (clubs) parts.push(`${p.club.length > 14 ? p.club.split(' ').slice(-1)[0] : p.club} ×${clubs}`);
  if (nats) parts.push(`${p.nat} ×${nats}`);
  return h('span', { class: `tag ${clubs ? 'ok' : ''}`, title: 'Kadrondaki oyuncularla kimya bağı' }, `🔗 ${parts.join(' · ')}`);
}

export function chemDots(c) {
  const n = Math.round(c);
  return h('span', { class: `chemdots c${n}` }, '●'.repeat(n) + '○'.repeat(3 - n));
}

const WHY = { club: '🏟️ aynı kulüp', nation: '🌍 aynı milli takım', league: '🏆 aynı lig' };
export function chemCard(xi, byId) {
  const c = teamChemistry(xi);
  const pct = Math.round((c.mult - 1) * 1000) / 10;
  const top = c.links.slice().sort((a, b) => b.w - a.w).slice(0, 8);
  return h('div', { class: 'card' },
    h('div', { class: 'row between' }, h('h3', { style: { margin: 0 } }, '🧪 Takım kimyası'), h('b', { class: `tag ${c.team >= 58 ? 'ok' : c.team < 30 ? 'danger' : ''}` }, `${c.team}/100 · ${chemLabel(c.team)}`)),
    h('div', { class: 'sb-progress', style: { marginTop: '8px' } }, h('i', { style: { width: `${c.team}%`, background: c.team >= 58 ? 'var(--accent)' : c.team < 30 ? 'var(--danger)' : 'var(--warn)' } })),
    h('p', { class: 'small mt' }, pct >= 0 ? `Takımın kimya sayesinde %${pct} daha iyi oynuyor.` : `Kimya düşük: takımın %${Math.abs(pct)} daha kötü oynuyor.`),
    h('p', { class: 'mini' }, 'Aynı kulüpten oyuncular en güçlü bağı kurar, sonra aynı milli takım, sonra aynı lig. Bağ, sahada yakın oynayanlar arasında daha çok sayılır; mevkisi dışında oynayanın kimyası düşer. Sahadaki noktalar her oyuncunun kimyası (0-3).'),
    top.length ? h('div', { class: 'list' }, top.map((l) => h('div', { class: 'item small' },
      h('div', { class: 'grow' }, `${byId[l.a].name.split(' ').slice(-1)[0]} – ${byId[l.b].name.split(' ').slice(-1)[0]}`),
      h('span', { class: 'mini' }, l.why.map((w) => WHY[w]).join(' + ')))))
      : h('div', { class: 'small muted' }, 'İlk 11\'de birbirini tanıyan oyuncu yok.'));
}
export { teamChemistry, linkOf };
