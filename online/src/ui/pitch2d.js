// 2D match view. Every player is a small photo that moves on his own: he keeps his
// zone, slides with the ball, presses, makes runs. The ball travels between players
// with passes, can be won back, and the real match events (attacks, corners, free
// kicks, shots, goals, cards, substitutions) take over the scene when they happen.
// Animation is cosmetic and local to each phone; the events come from the engine.
import { photoUrl, initials } from './visual.js';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}, parent = null) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};
const W = 100, H = 64, R = 2.4;
const DEPTH = { GK: 4, CB: 15, LB: 18, RB: 18, LWB: 25, RWB: 25, CDM: 27, CM: 33, LM: 35, RM: 35, CAM: 39, LW: 42, RW: 42, CF: 41, ST: 45 };
const SIDE = { L: 0, C: 1, R: 2 };
const LINE = { GK: 'GK', CB: 'DEF', LB: 'DEF', RB: 'DEF', LWB: 'DEF', RWB: 'DEF', CDM: 'MID', CM: 'MID', LM: 'MID', RM: 'MID', CAM: 'MID', LW: 'ATT', RW: 'ATT', CF: 'ATT', ST: 'ATT' };
const arr = (v) => (!v ? [] : Array.isArray(v) ? v : Object.keys(v).sort((a, b) => a - b).map((k) => v[k]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const surname = (p) => (p && p.name ? p.name.split(' ').slice(-1)[0] : '');

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

// two kits must be told apart: if the colours are close the away side changes kit
function rgb(hex) { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return [128, 128, 128]; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function dist(a, b) { const x = rgb(a), y = rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); }
export function awayKit(homeColor, awayColor) {
  if (dist(homeColor, awayColor) > 140) return awayColor;
  return ['#f5f5f5', '#2f80ed', '#111827', '#f4c542', '#22d3a6'].sort((a, b) => dist(homeColor, b) - dist(homeColor, a))[0];
}

export function createPitch2D({ home, away: away0 }) {
  const away = { ...away0, color: awayKit(home.color, away0.color) };
  const uid = Math.random().toString(36).slice(2, 8);
  const wrap = document.createElement('div');
  wrap.className = 'p2d-inner';
  const svg = svgEl('svg', { viewBox: `-3 -3 ${W + 6} ${H + 6}`, class: 'p2d', preserveAspectRatio: 'xMidYMid meet' });
  wrap.appendChild(svg);
  const banner = document.createElement('div'); banner.className = 'p2d-banner'; wrap.appendChild(banner);
  const cap = document.createElement('div'); cap.className = 'p2d-cap'; wrap.appendChild(cap);

  // ---------- pitch drawing
  const defs = svgEl('defs', {}, svg);
  const grad = svgEl('linearGradient', { id: `g${uid}`, x1: 0, x2: 1, y1: 0, y2: 0 }, defs);
  for (let i = 0; i <= 12; i++) svgEl('stop', { offset: `${(i / 12) * 100}%`, 'stop-color': i % 2 ? '#1b8150' : '#177a49' }, grad);
  const clip = svgEl('clipPath', { id: `c${uid}` }, defs);
  svgEl('circle', { r: R - 0.35 }, clip);
  svgEl('rect', { x: -3, y: -3, width: W + 6, height: H + 6, rx: 3, fill: '#11653a' }, svg);
  svgEl('rect', { x: 0, y: 0, width: W, height: H, fill: `url(#g${uid})` }, svg);
  const ln = { fill: 'none', stroke: 'rgba(255,255,255,.7)', 'stroke-width': 0.32 };
  svgEl('rect', { x: 0, y: 0, width: W, height: H, ...ln }, svg);
  svgEl('line', { x1: W / 2, y1: 0, x2: W / 2, y2: H, ...ln }, svg);
  svgEl('circle', { cx: W / 2, cy: H / 2, r: 8.5, ...ln }, svg);
  svgEl('circle', { cx: W / 2, cy: H / 2, r: 0.5, fill: 'rgba(255,255,255,.8)' }, svg);
  for (const x0 of [0, W]) {
    const s = x0 ? -1 : 1;
    svgEl('rect', { x: x0 ? W - 16 : 0, y: H / 2 - 20, width: 16, height: 40, ...ln }, svg);
    svgEl('rect', { x: x0 ? W - 5.5 : 0, y: H / 2 - 9, width: 5.5, height: 18, ...ln }, svg);
    svgEl('circle', { cx: x0 + s * 11, cy: H / 2, r: 0.45, fill: 'rgba(255,255,255,.8)' }, svg);
    svgEl('path', { d: `M ${x0 + s * 16} ${H / 2 - 7} A 8.5 8.5 0 0 ${x0 ? 0 : 1} ${x0 + s * 16} ${H / 2 + 7}`, ...ln }, svg);
    for (const y0 of [0, H]) svgEl('path', { d: `M ${x0} ${y0 ? H - 1.2 : 1.2} A 1.2 1.2 0 0 ${(x0 ? 1 : 0) ^ (y0 ? 1 : 0)} ${x0 + s * 1.2} ${y0}`, ...ln }, svg);
  }
  const nets = {};
  for (const [side, x0] of [['left', 0], ['right', W]]) {
    const gx = x0 ? W : -2.6;
    const g = svgEl('g', { class: 'p2d-net' }, svg);
    svgEl('rect', { x: gx, y: H / 2 - 4, width: 2.6, height: 8, fill: 'rgba(255,255,255,.12)', stroke: 'rgba(255,255,255,.95)', 'stroke-width': 0.4 }, g);
    for (let k = 1; k < 4; k++) svgEl('line', { x1: gx, x2: gx + 2.6, y1: H / 2 - 4 + k * 2, y2: H / 2 - 4 + k * 2, stroke: 'rgba(255,255,255,.35)', 'stroke-width': 0.15 }, g);
    nets[side] = g;
  }
  const flash = svgEl('rect', { x: 0, y: 0, width: W, height: H, fill: '#fff', opacity: 0, class: 'p2d-flash' }, svg);
  const layer = svgEl('g', {}, svg);
  const ballShadow = svgEl('ellipse', { rx: 0.9, ry: 0.45, fill: 'rgba(0,0,0,.35)' }, svg);
  const ballEl = svgEl('circle', { r: 0.95, fill: '#fff', stroke: '#111', 'stroke-width': 0.25 }, svg);
  const nameTag = svgEl('text', { 'text-anchor': 'middle', 'font-size': 2.3, 'font-weight': 800, fill: '#fff', stroke: 'rgba(0,0,0,.65)', 'stroke-width': 0.45, 'paint-order': 'stroke', class: 'p2d-name' }, svg);

  // ---------- players
  const players = [];
  const byPid = {};
  const teams = {};
  const makeDot = (side, t, pid, spot, code) => {
    const p = t.players[pid] || { id: pid, name: '' };
    const g = svgEl('g', { class: 'p2d-pl' }, layer);
    const gk = code === 'GK';
    svgEl('circle', { r: R, fill: gk ? '#f4c542' : t.color, stroke: gk ? '#f4c542' : t.color, 'stroke-width': 0.7 }, g);
    const url = photoUrl(p);
    let img = null, ini = null;
    if (url) img = svgEl('image', { href: url, x: -(R - 0.35), y: -(R - 0.35), width: (R - 0.35) * 2, height: (R - 0.35) * 2, 'clip-path': `url(#c${uid})`, preserveAspectRatio: 'xMidYMin slice' }, g);
    else { ini = svgEl('text', { y: 0.9, 'text-anchor': 'middle', 'font-size': 2.2, 'font-weight': 800, fill: '#fff' }, g); ini.textContent = initials(p.name); }
    svgEl('circle', { r: R, fill: 'none', stroke: 'rgba(255,255,255,.9)', 'stroke-width': 0.25 }, g);
    const dir = side === 'home' ? 1 : -1;
    const bx = dir === 1 ? spot.x : W - spot.x, by = dir === 1 ? spot.y : H - spot.y;
    const pl = { pid, p, side, dir, code, line: LINE[code] || 'MID', bx, by, x: bx, y: by, tx: bx, ty: by, g, img, ini, alive: true,
      f1: rnd(0.25, 0.6), f2: rnd(0.2, 0.5), ph1: rnd(0, 6.3), ph2: rnd(0, 6.3), amp: rnd(1.4, 2.8), spd: rnd(0.9, 1.15) };
    players.push(pl); byPid[pid] = pl;
    return pl;
  };
  for (const [side, t] of [['home', home], ['away', away]]) {
    const slots = arr(t.slots);
    const spots = formationSpots(slots);
    teams[side] = { color: t.color, players: t.players || {}, dir: side === 'home' ? 1 : -1 };
    arr(t.lineup).forEach((pid, i) => makeDot(side, t, pid, spots[i] || { x: 25, y: H / 2 }, slots[i] ? slots[i].code : 'CM'));
  }
  const teamOf = (side) => players.filter((p) => p.side === side && p.alive);
  const keeper = (side) => teamOf(side).find((p) => p.code === 'GK') || teamOf(side)[0];
  const other = (s) => (s === 'home' ? 'away' : 'home');

  // ---------- state
  const S = {
    poss: 'home', possPct: 50, carrier: null, mode: 'play', modeUntil: 0, attackSide: null, script: [],
    ball: { x: W / 2, y: H / 2, z: 0, fx: 0, fy: 0, tx: 0, ty: 0, t0: 0, dur: 0, flying: false, to: null, lob: false },
    nextAct: 0, speed: 1, t: 0, last: 0, passes: 0, highlight: null, drive: null, progAt: 0,
  };
  S.carrier = teamOf('home').find((p) => p.line === 'MID') || teamOf('home')[0];

  // ---------- captions and banners
  let capTimer = null, banTimer = null;
  const caption = (text) => {
    cap.textContent = text; cap.classList.add('on');
    clearTimeout(capTimer); capTimer = setTimeout(() => cap.classList.remove('on'), 2600 / Math.max(1, S.speed * 0.6));
  };
  const show = (text, kind = 'danger', ms = 1600) => {
    banner.className = `p2d-banner ${kind}`;
    banner.textContent = text;
    void banner.offsetWidth; banner.classList.add('on');
    clearTimeout(banTimer); banTimer = setTimeout(() => banner.classList.remove('on'), ms / Math.max(1, S.speed * 0.5));
  };

  // ---------- ball helpers
  const now = () => S.t;
  const kick = (tx, ty, { to = null, lob = false, power = 1 } = {}) => {
    const b = S.ball;
    const d = Math.hypot(tx - b.x, ty - b.y);
    b.fx = b.x; b.fy = b.y; b.tx = tx; b.ty = ty; b.t0 = now(); b.dur = clamp(d / (40 * power), 0.18, 1.3) * (lob ? 1.35 : 1);
    b.flying = true; b.to = to; b.lob = lob;
    S.carrier = null;
  };
  const passTo = (pl, opts = {}) => {
    const dir = pl.dir;
    kick(clamp(pl.x + dir * 1.2, 1, W - 1), pl.y, { ...opts, to: pl });
  };

  // attack coordinate: 0 = own goal line, 100 = the opponent's goal line
  const U = (side, x) => (side === 'home' ? x : W - x);
  const X = (side, u) => (side === 'home' ? u : W - u);

  // choose a team-mate for a pass: forward and open players, towards the drive zone if any
  const choosePass = (c) => {
    const mates = teamOf(c.side).filter((p) => p !== c);
    const cu = U(c.side, c.x);
    const drive = S.drive && S.drive.side === c.side ? S.drive : null;
    const stale = S.t - S.progAt > 4; // no progress for a while: look long
    let best = null, bw = -1e9;
    for (const m of mates) {
      const d = Math.hypot(m.x - c.x, m.y - c.y);
      if (d < 5 || d > (stale ? 60 : 40)) continue;
      const fwd = U(c.side, m.x) - cu;
      let w = fwd / (drive ? 9 : 14) + (m.code === 'GK' ? -3 : 0) + Math.random() * 1.6;
      if (fwd < -4) w -= 0.6; // backwards only if nothing else is on
      const opp = teamOf(other(c.side)).reduce((a, o) => Math.min(a, Math.hypot(o.x - m.x, o.y - m.y)), 99);
      w += Math.min(1, opp / 9) * 1.1;
      if (drive) w -= Math.abs(m.y - drive.y) / 22;
      if (w > bw) { bw = w; best = m; }
    }
    return best || pick(mates);
  };
  const nearest = (side, x, y, exclude = null) => {
    let best = null, bd = 1e9;
    for (const p of teamOf(side)) { if (p === exclude || p.code === 'GK') continue; const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }
    return best;
  };
  const switchPoss = (thief, text) => {
    passTo(thief);
    S.poss = thief.side; S.progAt = S.t;
    if (text) caption(text);
  };

  // ---------- open play decisions
  const act = () => {
    const c = S.carrier;
    if (!c) return;
    const cu = U(c.side, c.x);
    const drive = S.drive && S.drive.side === c.side && S.t < S.drive.until ? S.drive : null;
    const r = Math.random();
    // run with the ball into space
    const space = teamOf(other(c.side)).reduce((a, o) => Math.min(a, Math.hypot(o.x - (c.x + c.dir * 6), o.y - c.y)), 99);
    if ((space > 7 && r < 0.45 && cu < 82) || (drive && cu < 70 && r < 0.35)) {
      const ty = drive ? c.y + (drive.y - c.y) * 0.5 : c.y + rnd(-5, 5);
      c.tx = clamp(c.x + c.dir * rnd(7, 12), 2, W - 2); c.ty = clamp(ty, 3, H - 3); c.sprint = S.t + 0.8;
      if (Math.random() < 0.3) caption(cu > 60 ? `${surname(c.p)} ceza sahasına doğru sürüyor` : `${surname(c.p)} topu sürüyor`);
      S.nextAct = now() + rnd(0.8, 1.3);
      return;
    }
    const m = choosePass(c);
    if (!m) return;
    // turnover: the side with less of the ball loses it more often (never while driving to a known event)
    const share = c.side === 'home' ? S.possPct / 100 : 1 - S.possPct / 100;
    const opponentsDrive = S.drive && S.drive.side !== c.side && S.t < S.drive.until;
    const pLose = opponentsDrive ? 0.7 : drive ? 0 : clamp(0.16 * (1 - share) / 0.5, 0.05, 0.28);
    const fwd = U(c.side, m.x) - cu, wide = Math.abs(m.y - c.y);
    S.passes += 1;
    if (Math.random() < pLose) {
      const mx = (c.x + m.x) / 2, my = (c.y + m.y) / 2;
      const thief = nearest(other(c.side), mx, my);
      if (thief) {
        const midThird = mx > 33 && mx < 67;
        switchPoss(thief, midThird ? `Orta saha mücadelesi… top ${surname(thief.p)}'de` : `Araya girdi: ${surname(thief.p)}`);
        S.nextAct = now() + rnd(0.7, 1.2);
        return;
      }
    }
    passTo(m, { lob: wide > 28 || fwd > 28 });
    if (fwd > 3) S.progAt = S.t;
    if (fwd > 28) caption(`${surname(c.p)} uzun topla ${surname(m.p)}'i arıyor`);
    else if (wide > 28) caption(`${surname(c.p)} oyunu öbür kanada çeviriyor`);
    else if (fwd < -6 && Math.random() < 0.5) caption(`Geri pas, ${surname(m.p)} sakin oyun kuruyor`);
    else if (Math.random() < 0.35) caption(`${surname(c.p)} → ${surname(m.p)}`);
    const mu = U(m.side, m.x);
    if (mu > 70 && (m.y < 14 || m.y > H - 14) && Math.random() < 0.6) setTimeout(() => caption(`Kanattan geliyor… ${surname(m.p)}`), 400);
    else if (mu > 74 && Math.random() < 0.4) setTimeout(() => caption(`${surname(m.p)} ceza sahası önünde`), 400);
    S.nextAct = now() + rnd(0.7, 1.4);
  };

  // ---------- targets: each team is a block that moves with the ball
  const updateTargets = () => {
    const b = S.ball;
    const t = S.t;
    const att = S.mode === 'attack' ? S.attackSide : null;
    const owner = S.carrier ? S.carrier.side : S.poss;
    for (const p of players) {
      if (!p.alive) continue;
      if (p.lock && t < p.lock) continue; // scripted run
      const bu = U(p.side, b.x);
      const hasBall = owner === p.side;
      let u;
      if (p.code === 'GK') {
        const danger = bu < 30;
        u = danger ? 2.5 : 3.5 + Math.max(0, bu - 50) * 0.18;
        p.tx = X(p.side, u);
        p.ty = clamp(H / 2 + (b.y - H / 2) * (danger ? 0.35 : 0.2), H / 2 - 6, H / 2 + 6);
        continue;
      }
      if (S.mode === 'break' || S.mode === 'kickoff') {
        u = Math.min(46, p.bx === undefined ? 30 : U(p.side, p.bx));
      } else if (att) {
        // attack: the attacking side floods forward, the other side packs its box
        if (p.side === att) u = clamp(48 + (U(p.side, p.bx) - 4) * 1.15, 40, 90);
        else u = clamp(6 + (U(p.side, p.bx) - 4) * 0.75, 6, 44);
      } else if (hasBall) {
        // in possession: the block follows the ball forward and stretches the pitch
        const c = clamp(bu - 2, 30, 70);
        u = clamp(c + (U(p.side, p.bx) - 28) * 1.35, 12, 92);
      } else {
        // out of possession: compact, between the ball and the own goal
        const c = clamp(bu + 8, 22, 54);
        u = clamp(c + (U(p.side, p.bx) - 28) * 0.95, 6, 70);
      }
      const follow = { DEF: 0.22, MID: 0.34, ATT: 0.22 }[p.line] || 0.3;
      let ty = p.by + (b.y - p.by) * follow;
      // in possession the full-backs and wingers stretch the width
      if (hasBall && !att && (p.code === 'LB' || p.code === 'RB' || p.code === 'LWB' || p.code === 'RWB' || p.code === 'LW' || p.code === 'RW' || p.code === 'LM' || p.code === 'RM')) ty = p.by < H / 2 ? Math.min(ty, 6 + (p.by - 6) * 0.5) : Math.max(ty, H - 6 - (H - 6 - p.by) * 0.5);
      let tx = X(p.side, u);
      if (S.mode === 'kickoff' || S.mode === 'break') tx = p.side === 'home' ? Math.min(tx, W / 2 - 2) : Math.max(tx, W / 2 + 2);
      tx += Math.sin(t * p.f1 + p.ph1) * p.amp;
      ty += Math.cos(t * p.f2 + p.ph2) * p.amp * 0.8;
      p.tx = clamp(tx, 1.5, W - 1.5); p.ty = clamp(ty, 2, H - 2);
    }
    // the two closest defenders press, the carrier is driven by decisions
    if ((S.mode === 'play') && S.carrier) {
      const pr = nearest(other(S.carrier.side), b.x, b.y);
      if (pr && !(pr.lock && t < pr.lock)) { pr.tx = b.x - pr.dir * 2; pr.ty = b.y; pr.sprint = t + 0.3; }
      const pr2 = pr && nearest(other(S.carrier.side), b.x, b.y, pr);
      if (pr2 && !(pr2.lock && t < pr2.lock)) { pr2.tx = (b.x + X(pr2.side, 4)) / 2; pr2.ty = (b.y + H / 2) / 2; }
      const c = S.carrier;
      if (!(c.lock && t < c.lock) && !(c.sprint && t < c.sprint)) { c.tx = c.x + c.dir * 0.8; c.ty = c.y; }
    }
  };

  // a known event is coming for this side: win the ball and push towards that zone
  const prepare = (side, zone = 'C', kind = '') => {
    if (S.mode !== 'play') return;
    const y = { L: H * 0.15, C: H * 0.5, R: H * 0.85 }[zone] ?? H / 2;
    const yy = side === 'home' ? y : H - y;
    S.drive = { side, y: yy, kind, until: S.t + 6 };
    const owner = S.carrier ? S.carrier.side : S.poss;
    if (owner !== side) {
      const thief = nearest(side, S.ball.x, S.ball.y);
      if (thief) { switchPoss(thief, kind === 'counter' ? `Top kapıldı! ${surname(thief.p)} hızlı çıkıyor` : `Top ${surname(thief.p)}'de`); S.nextAct = S.t + 0.5; }
    }
  };

  // ---------- scripted sequences (events)
  const later = (sec, fn) => S.script.push({ at: S.t + sec, fn });
  const runTo = (pl, x, y, sec = 1.2, sprint = false) => { if (!pl) return; pl.tx = clamp(x, 1.5, W - 1.5); pl.ty = clamp(y, 2, H - 2); pl.lock = S.t + sec; if (sprint) pl.sprint = S.t + sec; };
  const place = (pl, x, y, sec = 3) => { if (!pl) return; runTo(pl, x, y, sec); pl.x = pl.tx; pl.y = pl.ty; }; // set pieces: players are already in position
  const laneY = (side, zone) => { const base = { L: H * 0.18, C: H * 0.5, R: H * 0.82 }[zone] ?? H / 2; return side === 'home' ? base : H - base; };
  const boxX = (side, depth = 10) => (side === 'home' ? W - depth : depth);

  const resetKickoff = (side) => {
    S.mode = 'kickoff'; S.carrier = null;
    const b = S.ball; b.x = W / 2; b.y = H / 2; b.flying = false; b.z = 0;
    for (const p of players) { p.lock = 0; }
    later(1.2, () => {
      const taker = teamOf(side).filter((p) => p.line === 'ATT')[0] || teamOf(side)[0];
      const back = teamOf(side).filter((p) => p.line === 'MID')[0] || taker;
      S.carrier = taker; taker.x = W / 2 - taker.dir * 1.5; taker.y = H / 2;
      S.poss = side; S.mode = 'play';
      passTo(back); S.nextAct = S.t + 1.2;
    });
  };

  const celebrate = (side, scorer) => {
    S.mode = 'celebrate';
    const cx = side === 'home' ? W - 3 : 3, cy = scorer && scorer.y < H / 2 ? 3 : H - 3;
    runTo(scorer, cx, cy, 3);
    for (const p of teamOf(side)) if (p !== scorer && p.code !== 'GK') runTo(p, cx - p.dir * rnd(3, 9), cy + (cy < H / 2 ? 1 : -1) * rnd(2, 8), 3);
    for (const p of teamOf(other(side))) if (p.code !== 'GK') runTo(p, p.dir === 1 ? rnd(25, 45) : rnd(55, 75), p.by, 3);
    later(3.2, () => resetKickoff(other(side)));
  };

  // ---------- render loop
  let raf = null;
  const frame = (ts) => {
    if (!svg.isConnected && S.last) { raf = null; return; }
    const dt = Math.min(0.05, S.last ? (ts - S.last) / 1000 : 0.016) * S.speed;
    S.last = ts; S.t += dt;
    // scripted steps
    if (S.script.length) { const due = S.script.filter((x) => x.at <= S.t); S.script = S.script.filter((x) => x.at > S.t); due.forEach((x) => x.fn()); }
    if (S.mode !== 'play' && S.modeUntil && S.t > S.modeUntil && S.mode !== 'celebrate' && S.mode !== 'kickoff' && S.mode !== 'break') { S.mode = 'play'; S.modeUntil = 0; }
    updateTargets();
    // move players
    for (const p of players) {
      if (!p.alive) continue;
      const sprinting = p.sprint && S.t < p.sprint;
      const k = Math.min(1, dt * (sprinting ? 7 : 2.6) * p.spd);
      const dx = (p.tx - p.x) * k, dy = (p.ty - p.y) * k;
      const maxStep = (sprinting ? 70 : 22) * dt * p.spd;
      const len = Math.hypot(dx, dy);
      const f = len > maxStep ? maxStep / len : 1;
      p.x += dx * f; p.y += dy * f;
    }
    // keep team-mates apart
    for (let i = 0; i < players.length; i++) for (let j = i + 1; j < players.length; j++) {
      const a = players[i], c = players[j];
      if (!a.alive || !c.alive) continue;
      const dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy);
      const min = a.side === c.side ? 4.4 : 3.2;
      if (d > 0.01 && d < min) { const push = (min - d) * 0.25; a.x -= (dx / d) * push; a.y -= (dy / d) * push; c.x += (dx / d) * push; c.y += (dy / d) * push; }
    }
    // ball
    const b = S.ball;
    if (b.flying) {
      const u = clamp((S.t - b.t0) / b.dur, 0, 1);
      const e = 1 - Math.pow(1 - u, 2);
      b.x = b.fx + (b.tx - b.fx) * e; b.y = b.fy + (b.ty - b.fy) * e;
      b.z = b.lob ? Math.sin(u * Math.PI) * 4 : 0;
      if (u >= 1) { b.flying = false; b.z = 0; if (b.to && b.to.alive) { S.carrier = b.to; S.poss = b.to.side; } b.to = null; }
    } else if (S.carrier) {
      const c = S.carrier;
      b.x = c.x + c.dir * 1.6 + Math.sin(S.t * 9) * 0.25; b.y = c.y + 0.4;
    }
    // decisions
    if (S.mode === 'play' && S.carrier && S.t >= S.nextAct) act();
    // draw
    for (const p of players) {
      if (!p.alive) continue;
      const sc = p === S.highlight ? 1.45 : p === S.carrier ? 1.15 : 1;
      p.g.setAttribute('transform', `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) scale(${sc})`);
    }
    ballShadow.setAttribute('cx', b.x.toFixed(2)); ballShadow.setAttribute('cy', (b.y + 0.5).toFixed(2));
    ballEl.setAttribute('cx', b.x.toFixed(2)); ballEl.setAttribute('cy', (b.y - b.z).toFixed(2));
    ballEl.setAttribute('r', (0.95 + b.z * 0.08).toFixed(2));
    const tagged = S.highlight || S.carrier;
    if (tagged) { nameTag.textContent = surname(tagged.p); nameTag.setAttribute('x', tagged.x.toFixed(2)); nameTag.setAttribute('y', (tagged.y + (tagged === S.highlight ? 5.6 : 4.4)).toFixed(2)); }
    else nameTag.textContent = '';
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  // ---------- public API (called by the live centre / replay)
  const api = {
    el: wrap,
    setSpeed(s) { S.speed = clamp(s || 1, 0.5, 6); },
    prepare,
    // a regular minute: possession share of the home side (0..100)
    idle(poss = 50) { S.possPct = poss; },
    // dangerous attack: the shot is coming
    danger(ev) {
      const side = ev.side === 'away' ? 'away' : 'home';
      const shooter = byPid[ev.playerId];
      const creator = ev.creatorId ? byPid[ev.creatorId] : null;
      S.mode = 'attack'; S.attackSide = side; S.poss = side; S.modeUntil = S.t + 3; S.script = []; S.drive = null;
      for (const p of players) if (p.code !== 'GK') p.sprint = S.t + 1.2;
      S.highlight = null;
      const pen = ev.penalty || ev.setPiece === 'penalty';
      const zoneY = laneY(side, ev.zone || 'C');
      const txt = pen ? 'PENALTI!' : ev.chance === 'freekick' ? 'FRİKİK!' : ev.chance === 'corner' ? 'KORNER' : ev.chance === 'counter' ? 'KONTRA ATAK!' : ev.chance === 'cross' ? 'KANATTAN ORTA…' : ev.chance === 'through' ? 'ARA PAS!' : ev.chance === 'long' ? 'UZAKTAN DENİYOR…' : ev.chance === 'cutback' ? 'ÇİZGİYE İNDİ…' : 'TEHLİKELİ ATAK!';
      show(txt, pen ? 'pen' : 'danger', 1500);
      if (pen) {
        S.mode = 'setpiece';
        for (const p of players) if (p.code !== 'GK') place(p, side === 'home' ? rnd(64, 72) : rnd(28, 36), rnd(10, H - 10), 3);
        place(shooter, boxX(side, 13.5), H / 2, 3);
        const b = S.ball; b.flying = false; b.x = boxX(side, 11); b.y = H / 2; S.carrier = null;
        S.highlight = shooter;
        return;
      }
      if (ev.chance === 'freekick') {
        S.mode = 'setpiece';
        const fx = side === 'home' ? rnd(72, 77) : rnd(23, 28), fy = rnd(H / 2 - 10, H / 2 + 10);
        const b = S.ball; b.flying = false; b.x = fx; b.y = fy; S.carrier = null;
        place(shooter, fx - (side === 'home' ? 2 : -2), fy, 3);
        // the wall
        teamOf(other(side)).filter((p) => p.line !== 'GK').slice(0, 4).forEach((p, i) => place(p, fx + (side === 'home' ? 9 : -9), fy - 4.5 + i * 3, 3));
        for (const p of teamOf(side)) if (p !== shooter && p.line !== 'GK') runTo(p, boxX(side, rnd(6, 16)), rnd(H / 2 - 13, H / 2 + 13), 3);
        S.highlight = shooter;
        return;
      }
      if (ev.chance === 'corner') {
        S.mode = 'setpiece';
        const cy = zoneY < H / 2 ? 0.8 : H - 0.8;
        const b = S.ball; b.flying = false; b.x = side === 'home' ? W - 0.8 : 0.8; b.y = cy; S.carrier = null;
        if (creator) place(creator, b.x - (side === 'home' ? 1 : -1), cy, 2.2);
        for (const p of teamOf(side)) if (p.line !== 'GK' && p !== creator) runTo(p, boxX(side, rnd(6, 15)), rnd(H / 2 - 12, H / 2 + 12), 2.5);
        for (const p of teamOf(other(side))) if (p.line !== 'GK') runTo(p, boxX(side, rnd(4, 12)), rnd(H / 2 - 11, H / 2 + 11), 2.5);
        runTo(shooter, boxX(side, 7), H / 2 + rnd(-4, 4), 2.6, true);
        later(0.9, () => { kick(boxX(side, 7), H / 2, { to: shooter, lob: true }); S.highlight = shooter; });
        return;
      }
      if (creator && creator !== shooter) {
        const cx = boxX(side, ev.chance === 'cross' || ev.chance === 'cutback' ? rnd(10, 18) : rnd(24, 30));
        const cy = ev.chance === 'cross' || ev.chance === 'cutback' ? (zoneY < H / 2 ? rnd(4, 9) : rnd(H - 9, H - 4)) : zoneY;
        runTo(creator, cx, cy, 2.4, true);
        passTo(creator);
        runTo(shooter, boxX(side, rnd(8, 12)), H / 2 + rnd(-6, 6), 2.6, true);
        later(0.85, () => {
          const lob = ev.chance === 'cross';
          kick(shooter.tx, shooter.ty, { to: shooter, lob, power: 1.2 });
          S.highlight = shooter;
          if (lob) caption(`${surname(creator.p)} ortaladı!`); else caption(`${surname(creator.p)} pası verdi…`);
        });
      } else if (shooter) {
        const sx = boxX(side, ev.chance === 'long' ? 28 : 14);
        runTo(shooter, sx, zoneY, 2.4, true);
        passTo(shooter);
        S.highlight = shooter;
        if (ev.chance === 'counter') caption(`${surname(shooter.p)} boş alanda koşuyor!`);
      }
    },
    // the result of the shot (text = the commentary line, used to spot the woodwork)
    outcome(ev, text = '') {
      const side = ev.side === 'away' ? 'away' : 'home';
      const shooter = byPid[ev.playerId];
      const gk = keeper(other(side));
      const goalX = side === 'home' ? W + 1.4 : -1.4;
      show('ŞUUUT!', 'shot', 700);
      if (shooter) { const b = S.ball; b.flying = false; S.carrier = null; b.x = shooter.x + shooter.dir * 1.4; b.y = shooter.y; }
      const post = /direk/i.test(text);
      later(0.35, () => {
        if (ev.type === 'goal') {
          kick(goalX, H / 2 + rnd(-3, 3), { power: 2.2 });
          later(0.3, () => {
            const net = nets[side === 'home' ? 'right' : 'left'];
            net.classList.remove('ripple'); void net.getBBox(); net.classList.add('ripple');
            flash.classList.remove('on'); void flash.getBBox(); flash.classList.add('on');
            show('GOOOL!', 'goal', 2600);
            caption(`⚽ ${surname(shooter && shooter.p)}!`);
            celebrate(side, shooter);
          });
        } else if (ev.type === 'save') {
          const sy = H / 2 + rnd(-3.5, 3.5);
          if (gk) runTo(gk, side === 'home' ? W - 2.5 : 2.5, sy, 1);
          kick(side === 'home' ? W - 3 : 3, sy, { to: gk, power: 2 });
          later(0.35, () => { show('KURTARDI!', 'save', 1300); S.highlight = gk; });
          later(1.6, () => { S.mode = 'play'; S.highlight = null; S.poss = other(side); caption(`Kaleci ${surname(gk && gk.p)} oyunu başlatıyor`); S.nextAct = S.t + 0.8; });
        } else if (post) {
          const py = H / 2 + (Math.random() < 0.5 ? -4 : 4);
          kick(side === 'home' ? W : 0, py, { power: 2.2 });
          later(0.3, () => {
            show('DİREKTEN DÖNDÜ!', 'post', 1500);
            kick(boxX(side, rnd(7, 11)), H / 2 + rnd(-6, 6), { power: 1.2 });
            later(0.55, () => {
              show('KARAMBOL!', 'danger', 1000);
              const clearer = nearest(other(side), S.ball.x, S.ball.y);
              if (clearer) { runTo(clearer, S.ball.x, S.ball.y, 0.5); later(0.45, () => { kick(W / 2 + rnd(-12, 12), rnd(8, H - 8), { lob: true }); caption(`${surname(clearer.p)} uzaklaştırdı`); }); }
              later(1.6, () => { S.mode = 'play'; S.highlight = null; const r = nearest(Math.random() < 0.5 ? side : other(side), S.ball.x, S.ball.y); if (r) { S.carrier = r; S.poss = r.side; } S.nextAct = S.t + 0.6; });
            });
          });
        } else {
          kick(goalX + (side === 'home' ? 3 : -3), H / 2 + (Math.random() < 0.5 ? rnd(-12, -6) : rnd(6, 12)), { power: 2.2 });
          later(0.35, () => show(pick(['DIŞARI!', 'AUT!', 'AZ FARKLA DIŞARI!']), 'miss', 1100));
          later(1.4, () => { const b = S.ball; b.flying = false; b.x = side === 'home' ? W - 6 : 6; b.y = H / 2; S.carrier = gk; S.poss = other(side); S.mode = 'play'; S.highlight = null; caption('Kale vuruşu'); S.nextAct = S.t + 0.9; });
        }
      });
    },
    // everything else from the event log
    event(ev) {
      const side = ev.side === 'away' ? 'away' : 'home';
      const pl = byPid[ev.playerId];
      switch (ev.type) {
        case 'corner': {
          if (S.mode === 'attack') break;
          const top = S.ball.y < H / 2;
          // the ball goes out off a defender first
          S.mode = 'setpiece'; S.modeUntil = S.t + 3.8; S.poss = side; S.drive = null;
          const fx = side === 'home' ? W - 0.8 : 0.8, fy = top ? 0.8 : H - 0.8;
          // the ball runs out over the goal line off a defender, then the corner is taken
          kick(side === 'home' ? W + 1 : -1, top ? rnd(3, 12) : rnd(H - 12, H - 3), { power: 1.4 });
          caption('Savunma son anda kornere çeldi');
          for (const p of teamOf(side)) if (p.line !== 'GK' && p !== pl) runTo(p, boxX(side, rnd(6, 15)), rnd(H / 2 - 12, H / 2 + 12), 3.2, true);
          for (const p of teamOf(other(side))) if (p.line !== 'GK') runTo(p, boxX(side, rnd(4, 12)), rnd(H / 2 - 11, H / 2 + 11), 3.2, true);
          later(0.6, () => {
            show('KORNER', 'set', 1100);
            const b = S.ball; b.flying = false; S.carrier = null; b.x = fx; b.y = fy;
            if (pl) { place(pl, fx - (side === 'home' ? 1 : -1), fy, 1.4); caption(`${surname(pl.p)} kornerde`); }
          });
          later(1.7, () => kick(boxX(side, rnd(6, 10)), H / 2 + rnd(-6, 6), { lob: true }));
          later(2.6, () => { const d = nearest(other(side), S.ball.x, S.ball.y); if (d) { caption(`${surname(d.p)} kafayla uzaklaştırdı`); kick(W / 2 + rnd(-10, 10), rnd(8, H - 8), { lob: true }); } });
          later(3.4, () => { const r = nearest(Math.random() < 0.55 ? other(side) : side, S.ball.x, S.ball.y); if (r) { S.carrier = r; S.poss = r.side; } S.mode = 'play'; S.nextAct = S.t + 0.6; });
          break;
        }
        case 'freekick': {
          if (S.mode === 'attack') break;
          show('FRİKİK', 'set', 1100);
          S.mode = 'setpiece'; S.modeUntil = S.t + 3; S.poss = side;
          const fx = side === 'home' ? rnd(66, 76) : rnd(24, 34), fy = rnd(10, H - 10);
          const b = S.ball; b.flying = false; S.carrier = null; b.x = fx; b.y = fy;
          if (pl) { place(pl, fx - (side === 'home' ? 2 : -2), fy, 2); caption(`${surname(pl.p)} topun başında`); }
          teamOf(other(side)).filter((p) => p.line !== 'GK').slice(0, 3).forEach((p, i) => place(p, fx + (side === 'home' ? 9 : -9), fy - 3 + i * 3, 2));
          if (!ev.direct) {
            for (const p of teamOf(side)) if (p !== pl && p.line !== 'GK') runTo(p, boxX(side, rnd(6, 14)), rnd(H / 2 - 12, H / 2 + 12), 2.4, true);
            later(1.3, () => { caption('Ceza sahasına gönderdi…'); kick(boxX(side, rnd(6, 10)), H / 2 + rnd(-6, 6), { lob: true }); });
            later(2.2, () => { const d = nearest(other(side), S.ball.x, S.ball.y); if (d) { caption(`${surname(d.p)} uzaklaştırdı`); kick(W / 2 + rnd(-12, 12), rnd(8, H - 8), { lob: true }); } });
            later(2.9, () => { S.mode = 'play'; const r = nearest(Math.random() < 0.5 ? side : other(side), S.ball.x, S.ball.y); if (r) { S.carrier = r; S.poss = r.side; } S.nextAct = S.t + 0.6; });
          }
          break;
        }
        case 'foul': caption(`Faul… ${surname(pl && pl.p)}`); break;
        case 'yellow': show(`SARI KART · ${surname(pl && pl.p).toUpperCase()}`, 'yellow', 1500); break;
        case 'red': show(`KIRMIZI KART! ${surname(pl && pl.p).toUpperCase()}`, 'red', 2000); if (pl) { pl.alive = false; pl.g.classList.add('gone'); setTimeout(() => pl.g.remove(), 900); if (S.carrier === pl) S.carrier = null; } break;
        case 'injury': caption(`🚑 ${surname(pl && pl.p)} sakatlandı`); break;
        case 'counter': if (S.mode === 'play') { S.poss = side; const c = nearest(side, S.ball.x, S.ball.y); if (c) { S.carrier = c; c.tx = c.x + c.dir * 12; caption('Hızlı çıkıyor… kontra!'); } } break;
        case 'sub': {
          const out = byPid[ev.out];
          const inP = teams[side].players[ev.in];
          const outName = surname(out && out.p) || surname(teams[side].players[ev.out]);
          if (out && inP) {
            delete byPid[ev.out]; byPid[ev.in] = out; out.pid = ev.in; out.p = inP;
            const url = photoUrl(inP);
            if (out.img && url) out.img.setAttribute('href', url);
            else if (out.ini) out.ini.textContent = initials(inP.name);
            out.g.classList.remove('subin'); void out.g.getBBox(); out.g.classList.add('subin');
          }
          caption(`🔁 Değişiklik: ${surname(inP)} ⬆ · ${outName} ⬇`);
          break;
        }
        case 'halftime': S.mode = 'break'; S.script = []; S.highlight = null; S.carrier = null; S.ball.flying = false; S.ball.x = W / 2; S.ball.y = H / 2; show('DEVRE ARASI', 'set', 3000); break;
        case 'fulltime': S.mode = 'break'; S.script = []; S.highlight = null; S.carrier = null; show('MAÇ BİTTİ', 'set', 3000); break;
        default: break;
      }
    },
    // second half kick-off (after half-time)
    restart(side = 'away') { S.script = []; resetKickoff(side); },
    destroy() { if (raf) cancelAnimationFrame(raf); raf = null; },
  };
  return api;
}
