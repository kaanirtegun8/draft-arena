// Visual building blocks: player photos (avatars) and FUT-style player cards.
import { h } from './dom.js';
import { PHOTO_IDS } from '../data/photos.js';
import { roleOf, isGK, LINE_OF_ROLE } from '../core/positions.js';

const BASE = new URL('../../img/p/', import.meta.url).href;
export function photoUrl(p) {
  const id = p && String(p.id || '').replace(/^ea-/, '');
  return id && PHOTO_IDS.has(id) ? `${BASE}${id}.webp` : null;
}
export function initials(name = '') {
  const w = name.split(' ').filter(Boolean);
  return ((w[0] || '')[0] || '') + (w.length > 1 ? w[w.length - 1][0] : '');
}
const LINE_COLOR = { GK: '#f2a65a', DEF: '#5aa9ff', MID: '#22d3a6', ATT: '#ef4b5c' };

// round photo with a coloured ring; falls back to initials
export function avatar(p, { size = 40, ring = null, pos = false, cls = '', lazy = true } = {}) {
  const url = photoUrl(p);
  const line = LINE_OF_ROLE[roleOf(p)] || 'MID';
  const col = ring || LINE_COLOR[line];
  const box = h('span', { class: `avatar ${cls}`, style: { width: `${size}px`, height: `${size}px`, borderColor: col, background: `radial-gradient(circle at 50% 30%, ${col}55, #0b1220 75%)` } });
  if (url) {
    const img = h('img', { src: url, alt: '', loading: lazy ? 'lazy' : 'eager', decoding: 'async', draggable: 'false' });
    img.onerror = () => { img.remove(); box.appendChild(h('span', { class: 'ini', style: { fontSize: `${Math.round(size * 0.36)}px` } }, initials(p.name))); };
    box.appendChild(img);
  } else box.appendChild(h('span', { class: 'ini', style: { fontSize: `${Math.round(size * 0.36)}px` } }, initials(p && p.name)));
  if (pos) box.appendChild(h('span', { class: 'av-pos', style: { background: col } }, p.pos));
  return box;
}

export function cardTier(level) { return level >= 90 ? 'elite' : level >= 86 ? 'gold' : level >= 82 ? 'silver' : 'bronze'; }

// FUT-style card: rating, position, photo, name and the six face stats
export function playerCard(p, { level = p.ovr, size = 'md', extra = null } = {}) {
  const gk = isGK(p);
  const stats = gk
    ? [['DIV', p.div], ['HAN', p.han], ['KIC', p.kic], ['REF', p.ref], ['SPD', p.spd], ['POS', p.gkp]]
    : [['PAC', p.pac], ['SHO', p.sho], ['PAS', p.pas], ['DRI', p.dri], ['DEF', p.def], ['PHY', p.phy]];
  const a = p.a || {};
  const val = (k, v) => (v != null ? v : gk ? ({ DIV: a.gkdiv, HAN: a.gkhan, KIC: a.gkkic, REF: a.gkref, SPD: a.spr, POS: a.gkpos })[k] : null);
  const url = photoUrl(p);
  return h('div', { class: `fut ${cardTier(level)} ${size}` },
    h('div', { class: 'fut-shine' }),
    h('div', { class: 'fut-top' },
      h('div', { class: 'fut-rate' }, Math.round(level)),
      h('div', { class: 'fut-pos' }, p.pos),
      h('div', { class: 'fut-nat' }, (p.nat || '').slice(0, 3).toUpperCase())),
    url ? h('img', { class: 'fut-img', src: url, alt: '', decoding: 'async', draggable: 'false' }) : h('div', { class: 'fut-img fut-ini' }, initials(p.name)),
    h('div', { class: 'fut-name' }, p.name.split(' ').length > 2 ? p.name.split(' ').slice(-2).join(' ') : p.name),
    h('div', { class: 'fut-stats' }, stats.map(([k, v]) => h('div', null, h('b', null, val(k, v) ?? '—'), h('span', null, k)))),
    h('div', { class: 'fut-club' }, p.club || ''),
    extra);
}
