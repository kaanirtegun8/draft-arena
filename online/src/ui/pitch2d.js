// 2D match view: a top-down pitch with both XIs in their formations and the ball.
// It follows the match events: the team on the ball pushes up, a dangerous attack sends
// the ball into the box and pops the shooter's photo, a goal ripples the net.
import { photoUrl, initials } from './visual.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent = null) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};
const W = 100, H = 64;
// depth of each position for a team attacking to the right (x in the own half)
const DEPTH = { GK: 4, CB: 15, LB: 18, RB: 18, LWB: 25, RWB: 25, CDM: 27, CM: 33, LM: 35, RM: 35, CAM: 39, LW: 42, RW: 42, CF: 41, ST: 45 };
const SIDE = { L: 0, C: 1, R: 2 };
const arr = (v) => (!v ? [] : Array.isArray(v) ? v : Object.keys(v).sort((a, b) => a - b).map((k) => v[k]));

function formationSpots(slots) {
  const rows = {};
  slots.forEach((s, i) => { const d = DEPTH[s.code] ?? 30; (rows[d] = rows[d] || []).push({ ...s, i }); });
  const pos = [];
  for (const [d, items] of Object.entries(rows)) {
    items.sort((a, b) => SIDE[a.side] - SIDE[b.side] || a.i - b.i);
    items.forEach((it, k) => {
      let y = ((k + 1) / (items.length + 1)) * H;
      if (items.length === 1 && it.side !== 'C') y = it.side === 'L' ? H * 0.16 : H * 0.84;
      if (items.length === 2 && items[0].side === 'L' && items[1].side === 'R' && /^(L|R)/.test(items[0].code)) y = k === 0 ? H * 0.14 : H * 0.86;
      pos[it.i] = { x: Number(d), y };
    });
  }
  return pos;
}

// team = { color, slots, lineup, players }
export function createPitch2D({ home, away }) {
  const svg = el('svg', { viewBox: `-3 -3 ${W + 6} ${H + 6}`, class: 'p2d', preserveAspectRatio: 'xMidYMid meet' });
  const defs = el('defs', {}, svg);
  const grad = el('linearGradient', { id: 'p2dGrass', x1: 0, x2: 1, y1: 0, y2: 0 }, defs);
  for (let i = 0; i <= 10; i++) el('stop', { offset: `${i * 10}%`, 'stop-color': i % 2 ? '#1a7d4d' : '#168246' }, grad);
  el('rect', { x: -3, y: -3, width: W + 6, height: H + 6, rx: 3, fill: '#126b3d' }, svg);
  el('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#p2dGrass)' }, svg);
  const line = { fill: 'none', stroke: 'rgba(255,255,255,.75)', 'stroke-width': 0.35 };
  el('rect', { x: 0, y: 0, width: W, height: H, ...line }, svg);
  el('line', { x1: W / 2, y1: 0, x2: W / 2, y2: H, ...line }, svg);
  el('circle', { cx: W / 2, cy: H / 2, r: 8.5, ...line }, svg);
  el('circle', { cx: W / 2, cy: H / 2, r: 0.6, fill: 'rgba(255,255,255,.8)' }, svg);
  for (const x0 of [0, W]) {
    const s = x0 ? -1 : 1;
    el('rect', { x: x0 ? W - 16 : 0, y: H / 2 - 20, width: 16, height: 40, ...line }, svg);
    el('rect', { x: x0 ? W - 5.5 : 0, y: H / 2 - 9, width: 5.5, height: 18, ...line }, svg);
    el('circle', { cx: x0 + s * 11, cy: H / 2, r: 0.5, fill: 'rgba(255,255,255,.8)' }, svg);
    el('path', { d: `M ${x0 + s * 16} ${H / 2 - 7} A 8.5 8.5 0 0 ${x0 ? 0 : 1} ${x0 + s * 16} ${H / 2 + 7}`, ...line }, svg);
  }
  // goals + nets
  const nets = {};
  for (const [side, x0] of [['left', 0], ['right', W]]) {
    const gx = x0 ? W : -2.6;
    const g = el('g', { class: 'p2d-net' }, svg);
    el('rect', { x: gx, y: H / 2 - 4, width: 2.6, height: 8, fill: 'rgba(255,255,255,.12)', stroke: 'rgba(255,255,255,.9)', 'stroke-width': 0.4 }, g);
    for (let k = 1; k < 4; k++) el('line', { x1: gx, x2: gx + 2.6, y1: H / 2 - 4 + k * 2, y2: H / 2 - 4 + k * 2, stroke: 'rgba(255,255,255,.35)', 'stroke-width': 0.15 }, g);
    nets[side] = g;
  }
  const flash = el('rect', { x: 0, y: 0, width: W, height: H, fill: '#fff', opacity: 0, class: 'p2d-flash' }, svg);

  const teams = {};
  for (const [side, t, dir] of [['home', home, 1], ['away', away, -1]]) {
    const slots = arr(t.slots).length ? arr(t.slots) : [];
    const lineup = arr(t.lineup);
    const spots = formationSpots(slots);
    const g = el('g', { class: 'p2d-team' }, svg);
    const dots = {};
    lineup.forEach((pid, i) => {
      const sp = spots[i] || { x: 25, y: H / 2 };
      const x = dir === 1 ? sp.x : W - sp.x, y = dir === 1 ? sp.y : H - sp.y;
      const d = el('g', { class: 'p2d-dot', style: `transform: translate(${x}px, ${y}px)` }, g);
      const gk = slots[i] && slots[i].code === 'GK';
      el('circle', { r: 1.9, fill: gk ? '#f4c542' : t.color, stroke: '#fff', 'stroke-width': 0.35 }, d);
      dots[pid] = { g: d, x, y };
    });
    teams[side] = { g, dots, dir, color: t.color, players: t.players || {} };
  }
  const ballG = el('g', { class: 'p2d-ball', style: `transform: translate(${W / 2}px, ${H / 2}px)` }, svg);
  el('circle', { r: 1.05, fill: '#fff', stroke: '#111', 'stroke-width': 0.25 }, ballG);
  const bubble = el('g', { class: 'p2d-bubble', opacity: 0 }, svg);

  let shiftNow = { home: 0, away: 0 };
  const shiftTeams = (home, away) => {
    shiftNow = { home, away };
    teams.home.g.style.transform = `translate(${home}px, 0px)`;
    teams.away.g.style.transform = `translate(${away}px, 0px)`;
  };
  const moveBall = (x, y, ms = 700) => { ballG.style.transitionDuration = `${ms}ms`; ballG.style.transform = `translate(${x}px, ${y}px)`; };
  const laneY = (side, zone) => {
    const base = { L: H * 0.22, C: H * 0.5, R: H * 0.78 }[zone] ?? H / 2;
    return side === 'home' ? base : H - base; // left side of a team attacking right is the top
  };
  const showBubble = (side, pid) => {
    while (bubble.firstChild) bubble.removeChild(bubble.firstChild);
    const t = teams[side];
    const dot = t.dots[pid];
    const p = t.players[pid];
    if (!dot || !p) return;
    const x = Math.max(8, Math.min(W - 8, dot.x + shiftNow[side])), y = Math.max(9, dot.y - 7);
    const clipId = `p2dc${Math.random().toString(36).slice(2, 7)}`;
    const cp = el('clipPath', { id: clipId }, bubble);
    el('circle', { cx: x, cy: y, r: 5 }, cp);
    el('circle', { cx: x, cy: y, r: 5.6, fill: t.color, stroke: '#fff', 'stroke-width': 0.5 }, bubble);
    const url = photoUrl(p);
    if (url) el('image', { href: url, x: x - 5, y: y - 5, width: 10, height: 10, 'clip-path': `url(#${clipId})`, preserveAspectRatio: 'xMidYMin slice' }, bubble);
    else { const tx = el('text', { x, y: y + 1.6, 'text-anchor': 'middle', 'font-size': 4, 'font-weight': 800, fill: '#fff' }, bubble); tx.textContent = initials(p.name); }
    const nm = el('text', { x, y: y + 9.5, 'text-anchor': 'middle', 'font-size': 2.8, 'font-weight': 800, fill: '#fff', stroke: 'rgba(0,0,0,.6)', 'stroke-width': 0.5, 'paint-order': 'stroke' }, bubble);
    nm.textContent = p.name.split(' ').slice(-1)[0];
    for (const tt of Object.values(teams)) for (const d of Object.values(tt.dots)) d.g.classList.remove('hot');
    dot.g.classList.add('hot');
    bubble.setAttribute('opacity', 1);
  };
  const hideBubble = () => { bubble.setAttribute('opacity', 0); for (const tt of Object.values(teams)) for (const d of Object.values(tt.dots)) d.g.classList.remove('hot'); };

  let busyUntil = 0;
  return {
    el: svg,
    // regular play: the side on the ball pushes up a little (possession 0..100 for home)
    idle(poss = 50, minute = 0) {
      if (Date.now() < busyUntil) return;
      const p = (poss - 50) / 50;
      shiftTeams(p * 7, p * 7);
      const wob = Math.sin(minute * 1.7) * 9, wob2 = Math.cos(minute * 1.3) * 12;
      moveBall(W / 2 + p * 16 + wob, H / 2 + wob2, 1400);
      hideBubble();
    },
    // dangerous attack (the shot is coming)
    danger(ev) {
      const side = ev.side === 'away' ? 'away' : 'home';
      const dir = teams[side].dir;
      busyUntil = Date.now() + 2600;
      shiftTeams(dir === 1 ? 15 : 8, dir === 1 ? 8 : -15);
      const x = side === 'home' ? (ev.chance === 'long' || ev.chance === 'freekick' ? 74 : 84) : (ev.chance === 'long' || ev.chance === 'freekick' ? 26 : 16);
      let y = laneY(side, ev.zone || 'C');
      if (ev.penalty || ev.setPiece === 'penalty') y = H / 2;
      if (ev.chance === 'corner') { moveBall(side === 'home' ? W - 0.5 : 0.5, ev.zone === 'R' ? (side === 'home' ? H - 0.5 : 0.5) : (side === 'home' ? 0.5 : H - 0.5), 600); setTimeout(() => moveBall(x, H / 2, 500), 650); }
      else moveBall(side === 'home' ? (ev.penalty ? 89 : x) : (ev.penalty ? 11 : x), y, 800);
      showBubble(side, ev.playerId);
    },
    // the result of the shot
    outcome(ev) {
      const side = ev.side === 'away' ? 'away' : 'home';
      const gx = side === 'home' ? W + 1.2 : -1.2;
      busyUntil = Date.now() + 2200;
      if (ev.type === 'goal') {
        moveBall(gx, H / 2 + (Math.random() - 0.5) * 5, 350);
        const net = nets[side === 'home' ? 'right' : 'left'];
        net.classList.remove('ripple'); void net.getBBox(); net.classList.add('ripple');
        flash.classList.remove('on'); void flash.getBBox(); flash.classList.add('on');
      } else if (ev.type === 'save') moveBall(side === 'home' ? W - 4.5 : 4.5, H / 2 + (Math.random() - 0.5) * 6, 350);
      else moveBall(side === 'home' ? W + 2 : -2, H / 2 + (Math.random() < 0.5 ? -7 : 7), 400);
      setTimeout(hideBubble, 1800);
    },
  };
}
