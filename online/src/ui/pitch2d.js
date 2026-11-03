// 2D match view (v3), in the spirit of the Football Manager / PES 2D match engines.
//
// Every player is a small photo with his own top speed (pace) and inertia. Each team keeps
// a shape that moves with the ball: in possession it pushes up and stretches the pitch,
// out of possession it gets compact, presses the ball and holds a line (offside).
// The real match events come from the engine and are known a few seconds in advance,
// so every chance is played out as a real attack that leads to the actual creator and
// the actual scorer: the ball is won, passed forward, carried down the wing, crossed,
// headed in. Corners come from a deflection, free kicks and penalties from a foul by the
// actual fouler, misses end in goal kicks, saves in the keeper's hands, goals in a
// celebration and a kick-off. In between the ball circulates with passes, dribbles,
// interceptions, throw-ins and clearances, with a possession share that follows the
// match statistics. The ball never jumps: it is always passed, kicked or carried.
// The animation is cosmetic and local to each phone; results come from the engine.
import { photoUrl, initials } from './visual.js';
import { shotShown, isShot } from '../core/commentary.js';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}, parent = null) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};
const W = 100, H = 64, R = 2.3;
// ball speeds in pitch units (about a metre) per second of animation
const PASS = 32, LOB = 25, SHOT = 58;
const DEPTH = { GK: 4, CB: 15, LB: 18, RB: 18, LWB: 25, RWB: 25, CDM: 27, CM: 33, LM: 35, RM: 35, CAM: 39, LW: 42, RW: 42, CF: 41, ST: 45 };
const SIDE = { L: 0, C: 1, R: 2 };
const LINE = { GK: 'GK', CB: 'DEF', LB: 'DEF', RB: 'DEF', LWB: 'DEF', RWB: 'DEF', CDM: 'MID', CM: 'MID', LM: 'MID', RM: 'MID', CAM: 'MID', LW: 'ATT', RW: 'ATT', CF: 'ATT', ST: 'ATT' };
const WIDE = new Set(['LB', 'RB', 'LWB', 'RWB', 'LM', 'RM', 'LW', 'RW']);
// who goes up for a corner or a free kick into the box (lower first)
const BOX_PRIO = { CB: 0, ST: 0, CF: 0, CAM: 1, CM: 1, LW: 1, RW: 1, CDM: 2, LM: 2, RM: 2, LB: 3, RB: 3, LWB: 3, RWB: 3 };
const arr = (v) => (!v ? [] : Array.isArray(v) ? v : Object.keys(v).sort((a, b) => a - b).map((k) => v[k]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const surname = (p) => (p && p.name ? p.name.split(' ').slice(-1)[0] : '');
const hyp = Math.hypot;

// ---------- feeding the view (shared by the live broadcast and the replay)
export const PITCH_RAW = new Set(['corner', 'freekick', 'penalty', 'foul', 'yellow', 'red', 'injury', 'counter', 'sub', 'halftime', 'fulltime']);
const PLANNABLE = new Set(['goal', 'save', 'miss', 'corner', 'freekick', 'penalty', 'counter']);
const STATEFUL = new Set(['red', 'sub', 'halftime', 'fulltime']);
const evKey = (e) => `${e.type}|${e.minute}|${e.extra || 0}|${e.side}|${e.playerId || ''}`;
// the next thing that happens on the pitch is a corner for this side
const cornerNext = (next, side) => {
  const n = (next || []).find((x) => x.mo || x.minor || (x.raw && !['yellow', 'red', 'injury', 'sub'].includes(x.raw.type)));
  return !!(n && n.raw && n.raw.type === 'corner' && n.raw.side === side);
};
const shotNext = (next, side) => (next || []).some((x) => (x.mo || x.minor) && (x.mo ? x.mo.event : x.minor).side === side);

// The events of one tick in log order: raw events, shots that are not narrated (minor)
// and narrated shots (their feed moment drives danger -> outcome). A card for the foul
// behind a free kick is shown while the free kick is being set up.
export function tickItems(events, evT, tk, momentOf) {
  const out = [];
  events.forEach((e, k) => {
    if (!e || evT[k] !== tk) return;
    if (PITCH_RAW.has(e.type)) out.push({ raw: e, tick: tk });
    else if (isShot(e)) { const mo = momentOf(k); out.push(mo ? { mo, tick: tk } : { minor: e, tick: tk }); }
  });
  const keyed = out.map((x, i) => ({ x, k: i }));
  for (const o of keyed) {
    const r = o.x.raw;
    if (!r || (r.type !== 'yellow' && r.type !== 'red')) continue;
    const j = out.findIndex((y, n) => n > o.k && y.raw && (y.raw.type === 'freekick' || y.raw.type === 'penalty') && y.raw.side !== r.side && (!y.raw.foulerId || y.raw.foulerId === r.playerId));
    if (j > 0) o.k = j + 0.5;
  }
  return keyed.sort((a, b) => a.k - b.k).map((o) => o.x);
}

// The chances of the next ticks are announced to the view, so it can build them up
// (never across the half-time break).
export function planAhead(pitch, events, evT, ticks, tk, secPerTick, lead = 0, horizon = 3) {
  if (!pitch || !ticks[tk] || ticks[tk].sp) return;
  for (let t = tk + 1; t <= tk + horizon && t < ticks.length; t++) {
    if (ticks[t].sp) break;
    const group = events.filter((e, k) => e && evT[k] === t && PLANNABLE.has(e.type));
    if (group.length) pitch.plan(group, (t - tk) * secPerTick + lead, t);
  }
}

// One thing at a time for the match on the 2D view, in log order: what came before a
// chance, the chance (danger, then the outcome after a beat), then what followed it
// (a corner after a save). It can fall a little behind the clock during a long sequence
// and catches up in the quiet minutes; far behind, it just shows the results.
export function createDirector({ pitch, speed, moment, reveal = null, tickNow = null, onIdle = null, maxWait = 4 }) {
  const queue = [];
  let timer = null, busy = false, alive = true, until = 0;
  const spd = () => Math.max(0.1, speed() || 1);
  const wait = (sec, fn) => {
    busy = true;
    const ms = (Math.max(0, sec) * 1000) / spd();
    until = Date.now() + ms;
    timer = setTimeout(() => { timer = null; until = 0; if (alive) fn(); }, ms);
  };
  const step = () => {
    if (!alive) return;
    if (!queue.length) { busy = false; if (onIdle) onIdle(); return; }
    busy = true;
    const it0 = queue[0];
    const lag0 = tickNow ? tickNow() - it0.tick : 0;
    // a chance whose build-up is still on its way: give it a moment
    if (lag0 < 4 && pitch && !it0.gated) {
      const ev = it0.mo ? it0.mo.event : it0.minor || it0.raw;
      const r = ev ? pitch.readyIn(ev, queue.slice(1).filter((x) => x.tick === it0.tick), it0.tick) : 0;
      const capS = lag0 >= 3 ? 0.6 : lag0 >= 2 ? Math.min(maxWait, 1.5) : maxWait;
      it0.waited = it0.waited || 0;
      if (r > 0.05 && it0.waited < capS) { const w = Math.min(r, 0.3); it0.waited += w; wait(w, step); return; }
      it0.gated = true;
    }
    const it = queue.shift();
    const lag = tickNow ? tickNow() - it.tick : 0;
    const next = queue.filter((x) => x.tick === it.tick);
    if (lag >= 4) {
      if (it.mo && reveal) reveal(it.mo);
      if (pitch) { const ev = it.mo ? it.mo.event : it.minor || it.raw; if (ev) pitch.skip(ev); }
      if (it.raw && pitch && STATEFUL.has(it.raw.type)) pitch.event(it.raw, { next, fast: true });
      step();
      return;
    }
    const cap = (w) => (lag >= 2 ? Math.min(w, 0.4) : w);
    busy = true;
    if (it.mo) { moment(it.mo, { next, hurry: lag >= 2 }, (w) => { if (alive) wait(cap(w || 0), step); }); return; }
    const w = pitch ? (it.minor ? pitch.minorShot(it.minor, { next }) : pitch.event(it.raw, { next })) || 0 : 0;
    if (w > 0.05) wait(cap(w), step); else step();
  };
  return {
    push(items) { if (!items || !items.length) return; queue.push(...items); if (!busy) step(); },
    busy: () => busy,
    // roughly how many seconds of animation the view is behind the clock
    lag() { const cur = until ? Math.max(0, (until - Date.now()) / 1000) * spd() : 0; return cur + queue.reduce((a, x) => a + (x.mo ? 2 : x.minor ? 1.2 : 0.4), 0); },
    flush() { const left = queue.splice(0); clearTimeout(timer); timer = null; busy = false; until = 0; if (reveal) left.forEach((x) => x.mo && reveal(x.mo)); },
    stop() { alive = false; clearTimeout(timer); queue.length = 0; },
  };
}

// formation spots in "attack coordinates": u = 0 own goal .. 100 opponent goal, v = 0 left .. 64 right
function formationSpots(slots) {
  const rows = {};
  slots.forEach((s, i) => { const d = DEPTH[s.code] ?? 30; (rows[d] = rows[d] || []).push({ ...s, i }); });
  const pos = [];
  for (const [d, items] of Object.entries(rows)) {
    items.sort((a, b) => SIDE[a.side] - SIDE[b.side] || a.i - b.i);
    items.forEach((it, k) => {
      let v = ((k + 1) / (items.length + 1)) * H;
      if (items.length === 1 && it.side !== 'C') v = it.side === 'L' ? H * 0.16 : H * 0.84;
      if (items.length === 2 && items[0].side === 'L' && items[1].side === 'R' && /^(L|R)/.test(items[0].code)) v = k === 0 ? H * 0.14 : H * 0.86;
      pos[it.i] = { u: Number(d), v };
    });
  }
  return pos;
}

// two kits must be told apart: if the colours are close the away side changes kit
function rgb(hex) { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return [128, 128, 128]; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function dist(a, b) { const x = rgb(a), y = rgb(b); return hyp(x[0] - y[0], x[1] - y[1], x[2] - y[2]); }
export function awayKit(homeColor, awayColor) {
  if (dist(homeColor, awayColor) > 140) return awayColor;
  return ['#f5f5f5', '#2f80ed', '#111827', '#f4c542', '#22d3a6'].sort((a, b) => dist(homeColor, b) - dist(homeColor, a))[0];
}
function paceOf(p) {
  const a = (p && p.a) || {};
  if (typeof a.spr === 'number') return a.spr * 0.6 + (typeof a.acc === 'number' ? a.acc : a.spr) * 0.4;
  return p && typeof p.pac === 'number' ? p.pac : 70;
}
const topSpeed = (code, p) => (code === 'GK' ? 11 : 11 + (paceOf(p) - 50) * 0.17);

export function createPitch2D({ home, away: away0, trace = null }) {
  const away = { ...away0, color: awayKit(home.color, away0.color) };
  const uid = Math.random().toString(36).slice(2, 8);
  const wrap = document.createElement('div');
  wrap.className = 'p2d-inner';
  const svg = svgEl('svg', { viewBox: `-3 -3 ${W + 6} ${H + 6}`, class: 'p2d', preserveAspectRatio: 'xMidYMid meet' });
  wrap.appendChild(svg);
  const banner = document.createElement('div'); banner.className = 'p2d-banner'; wrap.appendChild(banner);
  const cap = document.createElement('div'); cap.className = 'p2d-cap'; wrap.appendChild(cap);

  // ---------- pitch
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
  const refG = svgEl('g', { class: 'p2d-ref' }, svg);
  svgEl('circle', { r: 1.4, fill: '#111', stroke: '#f4c542', 'stroke-width': 0.4 }, refG);
  const ballShadow = svgEl('ellipse', { rx: 0.9, ry: 0.45, fill: 'rgba(0,0,0,.35)' }, svg);
  const ballEl = svgEl('circle', { r: 0.95, fill: '#fff', stroke: '#111', 'stroke-width': 0.25 }, svg);
  const nameTag = svgEl('text', { 'text-anchor': 'middle', 'font-size': 2.3, 'font-weight': 800, fill: '#fff', stroke: 'rgba(0,0,0,.65)', 'stroke-width': 0.45, 'paint-order': 'stroke', class: 'p2d-name' }, svg);

  // ---------- coordinates: X/Y on screen, U/V in the attack direction of a side
  const X = (side, u) => (side === 'home' ? u : W - u);
  const Y = (side, v) => (side === 'home' ? v : H - v);
  const U = (side, x) => (side === 'home' ? x : W - x);
  const V = (side, y) => (side === 'home' ? y : H - y);
  const other = (s) => (s === 'home' ? 'away' : 'home');

  // ---------- players
  const players = [];
  const byPid = {};
  const teams = {};
  const addPlayer = (side, t, pid, spot, code) => {
    const p = t.players[pid] || { id: pid, name: '' };
    const g = svgEl('g', { class: 'p2d-pl' }, layer);
    const gk = code === 'GK';
    const ring = svgEl('circle', { r: R, fill: gk ? '#f4c542' : t.color, stroke: gk ? '#f4c542' : t.color, 'stroke-width': 0.7 }, g);
    const url = photoUrl(p);
    let img = null, ini = null;
    if (url) img = svgEl('image', { href: url, x: -(R - 0.35), y: -(R - 0.35), width: (R - 0.35) * 2, height: (R - 0.35) * 2, 'clip-path': `url(#c${uid})`, preserveAspectRatio: 'xMidYMin slice' }, g);
    else { ini = svgEl('text', { y: 0.9, 'text-anchor': 'middle', 'font-size': 2.2, 'font-weight': 800, fill: '#fff' }, g); ini.textContent = initials(p.name); }
    svgEl('circle', { r: R, fill: 'none', stroke: 'rgba(255,255,255,.9)', 'stroke-width': 0.25 }, g);
    const x = X(side, spot.u), y = Y(side, spot.v);
    const pl = {
      pid, p, side, code, line: LINE[code] || 'MID', u0: spot.u, v0: spot.v,
      x, y, vx: 0, vy: 0, tx: x, ty: y, lock: 0, sprint: 0, down: 0, alive: true, g, img, ini, ring,
      top: topSpeed(code, p), acc: 4.2 + (paceOf(p) - 50) * 0.04,
      f1: rnd(0.25, 0.55), f2: rnd(0.2, 0.45), ph1: rnd(0, 6.3), ph2: rnd(0, 6.3),
    };
    players.push(pl); byPid[pid] = pl;
  };
  for (const [side, t] of [['home', home], ['away', away]]) {
    const slots = arr(t.slots);
    const spots = formationSpots(slots);
    teams[side] = { color: t.color, players: t.players || {} };
    arr(t.lineup).forEach((pid, i) => { if (pid) addPlayer(side, t, pid, spots[i] || { u: 25, v: H / 2 }, slots[i] ? slots[i].code : 'CM'); });
  }
  const teamOf = (side) => players.filter((p) => p.side === side && p.alive);
  const outfield = (side) => teamOf(side).filter((p) => p.code !== 'GK');
  const keeper = (side) => teamOf(side).find((p) => p.code === 'GK') || outfield(side)[0];
  const live = (p) => (p && p.alive ? p : null);
  const ref = { x: W / 2 - 8, y: H / 2 + 8, vx: 0, vy: 0, fx: 0, fy: 0, until: 0 };

  // ---------- state
  const B = { x: W / 2, y: H / 2, z: 0, holder: null, flight: null };
  const S = {
    t: 0, last: 0, speed: 1, phase: 'play', phaseAt: 0, poss: 'home', possPct: 50, share: 0.5,
    nextDecision: 0, script: [], plans: [], plan: null, highlight: null, stopAt: 0,
    drive: null, attackSide: null, readyAt: 0, setpiece: null, setTaker: null, kickTaker: null, scene: 0,
    keep: [], pending: null,
  };
  B.holder = outfield('home').find((p) => p.line === 'MID') || outfield('home')[0] || null;

  // ---------- banners and captions
  let capTimer = null, banTimer = null;
  const caption = (text) => {
    if (!text) return;
    cap.textContent = text; cap.classList.add('on');
    clearTimeout(capTimer); capTimer = setTimeout(() => cap.classList.remove('on'), 2600 / Math.max(1, S.speed * 0.6));
  };
  const show = (text, kind = 'danger', ms = 1500) => {
    banner.className = `p2d-banner ${kind}`;
    banner.textContent = text;
    void banner.offsetWidth; banner.classList.add('on');
    clearTimeout(banTimer); banTimer = setTimeout(() => banner.classList.remove('on'), ms / Math.max(1, S.speed * 0.5));
  };

  // ---------- timing (simulation time)
  const at = (time, fn) => { S.script.push({ at: time, fn }); };
  const after = (sec, fn) => at(S.t + sec, fn);
  // steps that must happen whatever comes next (a substitution, a sending-off)
  const keep = (sec, fn) => { S.keep.push({ at: S.t + sec, fn }); };
  // a set piece whose setup was still on its way: done now, before the chance is played
  const runPending = () => { const f = S.pending; S.pending = null; if (f) f.fn(); };
  const setPending = (kind, side, fn) => { const o = { kind, side, fn: () => { if (S.pending === o) S.pending = null; fn(); } }; S.pending = o; return o.fn; };
  // a new scene: whatever was still scheduled belongs to the old one; a ball in the air
  // (not a shot) just lands with whoever is there
  const newScene = () => {
    S.script = []; S.scene += 1;
    if (B.flight && !B.flight.shot) B.flight.onArrive = () => land();
  };
  const setPhase = (ph) => { S.phase = ph; S.phaseAt = S.t; };
  // test hook: key moments go into the trace
  const mark = (m, data = {}) => { if (trace) trace.push({ t: S.t, m, ...data }); };
  const runTo = (pl, x, y, sec = 1.2, sprint = false) => {
    if (!pl) return;
    pl.tx = clamp(x, -1, W + 1); pl.ty = clamp(y, -1, H + 1); pl.lock = S.t + sec;
    if (sprint) pl.sprint = S.t + sec;
  };
  const runToUV = (pl, u, v, sec, sprint) => pl && runTo(pl, X(pl.side, clamp(u, 1, 99)), Y(pl.side, clamp(v, 1.5, H - 1.5)), sec, sprint);
  const nearest = (side, x, y, exclude = null, withGK = false) => {
    let best = null, bd = 1e9;
    for (const p of teamOf(side)) { if (p === exclude || (!withGK && p.code === 'GK') || p.down > S.t) continue; const d = hyp(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }
    return best;
  };
  const oppNear = (p) => teamOf(other(p.side)).reduce((a, o) => Math.min(a, hyp(o.x - p.x, o.y - p.y)), 99);
  // the deepest defender of the other team, in my attack coordinates
  const offsideLine = (side) => {
    let m = 50;
    for (const o of outfield(other(side))) m = Math.max(m, U(side, o.x));
    return Math.min(m, 94);
  };

  // ---------- ball
  const kick = (tx, ty, { lob = false, power = 1, speed = 0, shot = false, onArrive = null } = {}) => {
    const d = hyp(tx - B.x, ty - B.y);
    const v = speed || (lob ? LOB : PASS) * power;
    B.flight = { fx: B.x, fy: B.y, tx, ty, t0: S.t, dur: clamp(d / v, 0.14, 2), lob, shot, h: lob ? Math.min(6, 1 + d * 0.11) : 0, onArrive };
    B.holder = null;
  };
  const receive = (pl) => {
    if (!live(pl)) return;
    if (trace && hyp(pl.x - B.x, pl.y - B.y) > 5) mark('farrcv', { d: +hyp(pl.x - B.x, pl.y - B.y).toFixed(1), ph: S.phase });
    B.holder = pl; S.poss = pl.side; B.flight = null;
    S.nextDecision = S.t + rnd(0.35, 0.8);
  };
  const loose = () => { B.holder = null; B.flight = null; };
  // where the ball comes down: whoever is there gets it (a duel if both are)
  const land = (favour = null) => {
    const a = nearest('home', B.x, B.y, null, true), b = nearest('away', B.x, B.y, null, true);
    const da = a ? hyp(a.x - B.x, a.y - B.y) : 99, db = b ? hyp(b.x - B.x, b.y - B.y) : 99;
    let w = null;
    if (da < 3.5 && db < 3.5) w = Math.random() < (favour === 'home' ? 0.6 : favour === 'away' ? 0.4 : da < db ? 0.6 : 0.4) ? a : b;
    else if (da < 3.5) w = a;
    else if (db < 3.5) w = b;
    if (w) receive(w); else loose();
    return w;
  };
  // pass to a team-mate, aimed where he will be when the ball gets there
  const passTo = (pl, { lob = false, power = 1, sure = false, then = null } = {}) => {
    if (!live(pl)) return;
    const sp = (lob ? LOB : PASS) * power;
    let tx = pl.x, ty = pl.y;
    for (let k = 0; k < 2; k++) {
      const tf = clamp(hyp(tx - B.x, ty - B.y) / sp, 0.14, 2);
      const toT = hyp(pl.tx - pl.x, pl.ty - pl.y), v = hyp(pl.vx, pl.vy);
      if (v < 0.5 || toT / Math.max(v, 1) <= tf) { tx = pl.tx; ty = pl.ty; } else { tx = pl.x + pl.vx * tf; ty = pl.y + pl.vy * tf; }
    }
    kick(clamp(tx, 1, W - 1), clamp(ty, 1, H - 1), { lob, power, onArrive: () => {
      if (hyp(pl.x - B.x, pl.y - B.y) < (sure ? 6.5 : 4.5)) { receive(pl); if (then) then(); } else land(pl.side);
    } });
  };
  // the ball goes to a set-piece spot: played there, never teleported
  const placeBall = (x, y) => {
    loose();
    if (hyp(B.x - x, B.y - y) < 2) { B.x = x; B.y = y; B.z = 0; return 0; }
    kick(x, y, { lob: true, speed: 30, onArrive: () => { loose(); B.x = x; B.y = y; } });
    return B.flight.dur;
  };
  // pl wins the ball: he closes down whoever has it (or goes to a loose ball) and takes it
  const steal = (pl, then = null, tries = 0) => {
    if (!live(pl)) { if (then) then(); return; }
    if (B.holder === pl || (B.holder && B.holder.side === pl.side)) { if (then) then(); return; }
    if (B.flight) { if (tries < 25) after(0.1, () => steal(pl, then, tries + 1)); return; }
    const victim = B.holder;
    runTo(pl, B.x, B.y, 0.35, true);
    if (victim) { victim.tx = victim.x; victim.ty = victim.y; victim.lock = S.t + 0.3; }
    const d = hyp(pl.x - B.x, pl.y - B.y);
    if (d < 2.4) {
      receive(pl);
      if (victim) { victim.lock = S.t + 0.5; caption(`${surname(pl.p)} topu kaptı`); }
      if (then) then();
      return;
    }
    if (tries >= 12) {
      // too far to get there: the pass under pressure goes astray, straight to him
      kick(pl.x, pl.y, { power: 0.9, onArrive: () => { if (hyp(pl.x - B.x, pl.y - B.y) < 4.5) { receive(pl); if (victim) caption(`${surname(pl.p)} araya girdi`); if (then) then(); } else land(pl.side); } });
      return;
    }
    after(0.1, () => steal(pl, then, tries + 1));
  };
  // pl goes to a loose ball and takes it
  const collect = (pl, then, tries = 0) => {
    if (!live(pl)) return;
    if (B.holder === pl) { then(); return; }
    if (B.holder || tries > 18) return;
    if (!B.flight) {
      runTo(pl, B.x, B.y, 0.4, true);
      if (hyp(pl.x - B.x, pl.y - B.y) < 1.9) { receive(pl); then(); return; }
    }
    after(0.1, () => collect(pl, then, tries + 1));
  };
  // the ball goes to pl from whoever of his team has it (waits for a ball in the air)
  const relay = (pl, opts = {}, tries = 0) => {
    if (!live(pl) || B.holder === pl) return;
    if (B.holder && B.holder.side === pl.side) { passTo(pl, { lob: hyp(B.holder.x - pl.x, B.holder.y - pl.y) > 30, sure: true, ...opts }); return; }
    if (tries < 10) after(0.15, () => relay(pl, opts, tries + 1));
  };

  // ---------- restarts
  const throwIn = (side, x, y) => {
    setPhase('restart'); loose();
    B.x = clamp(x, 2, W - 2); B.y = y < H / 2 ? 0.3 : H - 0.3; B.z = 0;
    const thrower = nearest(side, B.x, B.y);
    caption('Taç atışı');
    if (thrower) runTo(thrower, B.x, B.y < H / 2 ? 0.6 : H - 0.6, 2, true);
    const go = (tries = 0) => {
      if (thrower && tries < 20 && hyp(thrower.x - B.x, thrower.y - B.y) > 2.5) { runTo(thrower, B.x, B.y < H / 2 ? 0.6 : H - 0.6, 0.5, true); after(0.15, () => go(tries + 1)); return; }
      setPhase('play');
      const mates = outfield(side).filter((m) => m !== thrower).sort((a, b) => hyp(a.x - B.x, a.y - B.y) - hyp(b.x - B.x, b.y - B.y));
      if (mates[0]) passTo(mates[0], { lob: true, power: 0.8 }); else if (thrower) collect(thrower, () => {});
    };
    after(0.9, () => go());
  };
  const goalKick = (side) => {
    setPhase('restart');
    const gk = keeper(side);
    const sx = X(side, 5.5), sy = H / 2 + rnd(-6, 6);
    placeBall(sx, sy);
    if (gk) runTo(gk, sx - (side === 'home' ? 1 : -1), sy, 2, true);
    caption('Kale vuruşu');
    after(2, () => {
      setPhase('play');
      const defs = outfield(side).filter((p) => p.line === 'DEF');
      if (defs.length && Math.random() < 0.4) { passTo(pick(defs)); return; }
      const fw = outfield(side).filter((p) => p.line !== 'DEF');
      const to = fw.length ? pick(fw) : null;
      if (to) longBall(to, side); else if (gk) receive(gk);
    });
  };
  const kickOff = (side) => {
    setPhase('kickoff'); S.highlight = null; S.attackSide = null; S.drive = null; S.setpiece = null;
    const taker = outfield(side).filter((p) => p.line === 'ATT')[0] || outfield(side)[0];
    const back = outfield(side).filter((p) => p.line === 'MID' && p !== taker)[0] || outfield(side).find((p) => p !== taker);
    S.kickTaker = taker;
    for (const p of players) { p.lock = 0; p.sprint = S.t + 3; }
    placeBall(W / 2, H / 2);
    const go = (tries = 0) => {
      if (taker && tries < 25 && (B.flight || hyp(taker.x - B.x, taker.y - B.y) > 2.2)) { after(0.15, () => go(tries + 1)); return; }
      S.kickTaker = null;
      setPhase('play');
      if (!taker) return;
      if (hyp(taker.x - B.x, taker.y - B.y) <= 2.2) receive(taker); else { collect(taker, () => {}); return; }
      S.nextDecision = S.t + 3;
      after(0.4, () => { if (B.holder === taker && back) passTo(back); });
    };
    after(1.8, () => go());
  };
  const freeKickRestart = (side, x, y, text) => {
    setPhase('restart');
    placeBall(clamp(x, 2, W - 2), clamp(y, 2, H - 2));
    const taker = nearest(side, x, y);
    if (taker) runTo(taker, x - (side === 'home' ? 1 : -1), y, 1.6, true);
    if (text) caption(text);
    const go = (tries = 0) => {
      if (taker && tries < 20 && (B.flight || hyp(taker.x - B.x, taker.y - B.y) > 2.5)) { if (!B.flight) runTo(taker, B.x - (side === 'home' ? 1 : -1), B.y, 0.5, true); after(0.15, () => go(tries + 1)); return; }
      setPhase('play');
      if (taker && hyp(taker.x - B.x, taker.y - B.y) <= 2.5) { receive(taker); S.nextDecision = S.t + 0.3; }
      else { const m = nearest(side, B.x, B.y); if (m) collect(m, () => { S.nextDecision = S.t + 0.3; }); }
    };
    after(0.8, () => go());
  };
  // a long ball: whoever is there when it comes down
  const longBall = (to, side) => {
    kick(to.x, to.y, { lob: true, power: 1.15, onArrive: () => { const w = land(side); if (w && w.side !== side) caption(`${surname(w.p)} hava topunu kazandı`); } });
  };
  // a cross into the box that the defence deals with (headed away or claimed)
  const crossCleared = (side, done = null) => {
    if (S.phase === 'celebrate' || S.phase === 'kickoff' || S.phase === 'break') return;
    const tx = X(side, rnd(86, 93)), ty = H / 2 + rnd(-7, 7);
    const d0 = nearest(other(side), tx, ty, null, true);
    if (d0) runTo(d0, tx, ty, 1, true);
    const tk = S.setTaker && S.phase === 'setpiece' ? S.setTaker : B.holder;
    if (tk) caption(`${surname(tk.p)} ortaladı…`);
    setPhase('play');
    kick(tx, ty, { lob: true, power: 1.05, onArrive: () => {
      const d = nearest(other(side), B.x, B.y, null, true);
      if (d && hyp(d.x - B.x, d.y - B.y) < 4.5) {
        if (d.code === 'GK' && Math.random() < 0.5) { receive(d); caption(`${surname(d.p)} topu kontrol etti`); setPhase('restart'); after(1.2, () => { setPhase('play'); S.nextDecision = S.t + 0.2; }); }
        else { caption(`${surname(d.p)} kafayla uzaklaştırdı`); kick(X(side, rnd(46, 62)), rnd(8, H - 8), { lob: true, onArrive: () => land() }); }
      } else land();
      if (done) done();
    } });
  };

  // ---------- open play: decisions of the player on the ball
  const laneOpen = (a, b) => {
    for (const o of teamOf(other(a.side))) {
      const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
      const t = clamp(((o.x - a.x) * dx + (o.y - a.y) * dy) / L2, 0, 1);
      if (hyp(a.x + dx * t - o.x, a.y + dy * t - o.y) < 2.2 && t > 0.15 && t < 0.92) return false;
    }
    return true;
  };
  const decide = (h) => {
    const side = h.side;
    const u = U(side, h.x), v = V(side, h.y);
    const press = oppNear(h);
    const drive = S.drive && S.drive.side === side && S.t < S.drive.until ? S.drive : null;
    // possession share: whoever has kept the ball more than the stats say loses it more easily
    const target = side === 'home' ? S.possPct / 100 : 1 - S.possPct / 100;
    const actual = side === 'home' ? S.share : 1 - S.share;
    const bias = drive ? -0.3 : clamp((actual - target) * 1.6, -0.15, 0.25);
    S.nextDecision = S.t + rnd(0.55, 1.1);

    // the chance is ready but its moment has not come yet: keep the ball around the box
    if (S.plan && S.plan.hold && !S.plan.final && S.plan.side === side) { holdBall(h); return; }
    // goalkeeper: short to a defender, sometimes long
    if (h.code === 'GK') {
      const defs = outfield(side).filter((p) => p.line === 'DEF');
      if (defs.length && Math.random() < 0.7) { passTo(pick(defs)); caption(`${surname(h.p)} oyunu geriden kuruyor`); return; }
      const f = outfield(side).filter((p) => p.line !== 'DEF');
      if (f.length) longBall(pick(f), side);
      return;
    }
    // under pressure deep in his own half: clear it
    if (!drive && u < 26 && press < 2.6 && Math.random() < 0.55) {
      const f = outfield(side).filter((p) => p.line === 'ATT');
      if (f.length) { caption(`${surname(h.p)} uzun vurdu`); longBall(pick(f), side); }
      return;
    }
    // in the final third without a planned chance the move dies: cleared cross, recycled, tackled
    if (!drive && u > 76) {
      const r = Math.random();
      if (r < 0.35 && (v < 15 || v > 49)) { crossCleared(side); return; }
      if (r < 0.65) { const back = outfield(side).filter((p) => U(side, p.x) < u - 8 && p !== h); if (back.length) { passTo(pick(back)); caption('Geri çevirdi, yeniden kuruyor'); return; } }
      const tk = nearest(other(side), h.x, h.y);
      if (tk) { S.nextDecision = S.t + 2.5; steal(tk); }
      return;
    }
    // carry it into space
    const ahead = teamOf(other(side)).reduce((a, o) => Math.min(a, hyp(o.x - X(side, u + 6), o.y - h.y)), 99);
    if (ahead > 6.5 && Math.random() < (drive ? 0.45 : 0.35)) {
      const ty = drive ? Y(side, v + (drive.v - v) * 0.5) : h.y + rnd(-4, 4);
      runTo(h, X(side, Math.min(u + rnd(7, 12), 80)), clamp(ty, 3, H - 3), 0.9, true);
      if (Math.random() < 0.3) caption(u > 58 ? `${surname(h.p)} rakip yarı sahada ilerliyor` : `${surname(h.p)} topu sürüyor`);
      return;
    }
    // pass: forward and open players preferred
    let best = null, bw = -1e9;
    const off = offsideLine(side);
    for (const m of teamOf(side)) {
      if (m === h || m.down > S.t) continue;
      const d = hyp(m.x - h.x, m.y - h.y);
      if (d < 4.5 || d > 46) continue;
      const du = U(side, m.x) - u;
      let w = du / (drive ? 8 : 12) + rnd(0, 1.1);
      if (m.code === 'GK') w -= u < 30 ? 1 : 4;
      w += laneOpen(h, m) ? 1.1 : -1.4;
      w += Math.min(1, oppNear(m) / 8);
      if (d > 32) w -= 0.5;
      if (drive) w -= Math.abs(V(side, m.y) - drive.v) / 20;
      if (w > bw) { bw = w; best = m; }
    }
    if (!best) return;
    const d = hyp(best.x - h.x, best.y - h.y);
    const open = laneOpen(h, best);
    const lob = d > 30 || !open;
    const pFail = clamp(0.05 + (open ? 0 : 0.22) + (press < 2.8 ? 0.08 : 0) + d / 260 + bias, drive ? 0 : 0.03, 0.55);
    if (Math.random() < pFail) {
      // the pass goes wrong: out for a throw-in or intercepted
      if (Math.random() < 0.18 && (best.y < 9 || best.y > H - 9)) {
        kick(clamp(best.x, 2, W - 2), best.y < H / 2 ? -1.5 : H + 1.5, { power: 1.1, onArrive: () => throwIn(other(side), B.x, B.y) });
        caption(`${surname(h.p)} topu taca kaçırdı`);
        return;
      }
      const t = rnd(0.45, 0.8);
      const ix = h.x + (best.x - h.x) * t, iy = h.y + (best.y - h.y) * t;
      const thief = nearest(other(side), ix, iy);
      if (thief && hyp(thief.x - ix, thief.y - iy) < 9) {
        runTo(thief, ix, iy, 0.8, true);
        kick(ix, iy, { power: 1.05, onArrive: () => { const w = land(other(side)); if (w && w.side !== side) caption(ix > 33 && ix < 67 ? `Orta saha mücadelesi… top ${surname(w.p)}'de` : `${surname(w.p)} araya girdi`); } });
        return;
      }
    }
    // offside: a forward beyond the last defender when the ball is played
    if (best.line === 'ATT' && U(side, best.x) > off + 1.2 && !drive && Math.random() < 0.6) {
      kick(best.x, best.y, { lob, onArrive: () => { show('OFSAYT', 'set', 1100); caption(`${surname(best.p)} ofsaytta`); freeKickRestart(other(side), B.x, B.y); } });
      return;
    }
    passTo(best, { lob });
    const du = U(side, best.x) - u;
    if (d > 30 && Math.abs(best.y - h.y) > 26) caption(`${surname(h.p)} oyunu öbür kanada çeviriyor`);
    else if (du > 22) caption(`${surname(h.p)} ileriye ${surname(best.p)}'i arıyor`);
    else if (du < -6 && Math.random() < 0.5) caption(`Geri pas, ${surname(best.p)} sakin oyun kuruyor`);
    else if (Math.random() < 0.3) caption(`${surname(h.p)} → ${surname(best.p)}`);
  };

  const holdBall = (h) => {
    const side = h.side;
    S.nextDecision = S.t + rnd(0.7, 1.2);
    const spec = S.plan && S.plan.spec;
    if (spec && U(side, h.x) < spec.c.u - 10) {
      // not there yet: forward to whoever is nearer the spot, or carry it
      const sx = X(side, spec.c.u), sy = Y(side, spec.c.v);
      const fw = outfield(side).filter((m) => m !== h && m.down <= S.t && hyp(m.x - sx, m.y - sy) < hyp(h.x - sx, h.y - sy) - 8 && hyp(m.x - h.x, m.y - h.y) < 34);
      const to = fw.sort((a, b) => hyp(a.x - sx, a.y - sy) - hyp(b.x - sx, b.y - sy))[0];
      if (to) { passTo(to, { sure: true, lob: hyp(to.x - h.x, to.y - h.y) > 28 }); return; }
      runToUV(h, Math.min(U(side, h.x) + 12, spec.c.u), V(side, h.y) + (spec.c.v - V(side, h.y)) * 0.4, 0.9, true);
      return;
    }
    const mates = outfield(side).filter((m) => m !== h && m.down <= S.t && U(side, m.x) > 52 && hyp(m.x - h.x, m.y - h.y) > 5 && hyp(m.x - h.x, m.y - h.y) < 24);
    const open = mates.filter((m) => laneOpen(h, m));
    const to = pick(open.length ? open : mates);
    if (to && Math.random() < 0.75) { passTo(to, { sure: true }); return; }
    const u = U(side, h.x), v = V(side, h.y);
    runToUV(h, clamp(u + rnd(-5, 3), 55, 86), clamp(v + rnd(-7, 7), 6, 58), 0.8, false);
  };

  // ---------- team shape: where everybody wants to be
  const updateTargets = () => {
    const t = S.t;
    const owner = B.holder ? B.holder.side : S.poss;
    const att = S.phase === 'attack' ? S.attackSide : null;
    const offs = { home: offsideLine('home'), away: offsideLine('away') };
    for (const p of players) {
      if (!p.alive || (p.lock && t < p.lock) || p === B.holder || p.down > t) continue;
      const bU = U(p.side, B.x), bV = V(p.side, B.y);
      const inPoss = owner === p.side;
      let u, v;
      if (p.code === 'GK') {
        const danger = bU < 28;
        u = danger ? 2.2 : 3.5 + Math.max(0, bU - 50) * 0.16;
        v = clamp(32 + (bV - 32) * (danger ? 0.33 : 0.18), 26, 38);
      } else if (S.phase === 'break' || S.phase === 'kickoff') {
        if (p === S.kickTaker) { u = 48.6; v = 32; } else { u = Math.min(44, p.u0); v = p.v0; }
      } else if (att) {
        if (p.side === att) { u = clamp(46 + (p.u0 - 4) * 1.12, 40, 90); v = 32 + (p.v0 - 32) * (p.line === 'ATT' ? 0.55 : 1.05); }
        else { u = clamp(5 + (p.u0 - 4) * 0.72, 5, 44); v = 32 + (p.v0 - 32) * 0.62 + (bV - 32) * 0.3; }
      } else if (inPoss) {
        const c = clamp(bU - 5, 24, 72);
        u = clamp(c + (p.u0 - 29) * 1.4, 8, 92);
        if (p.line === 'ATT') u = Math.min(u, offs[p.side] - 0.8); // stay onside
        v = WIDE.has(p.code) ? (p.v0 < 32 ? p.v0 + (5 - p.v0) * 0.55 : p.v0 + (59 - p.v0) * 0.55) : 32 + (p.v0 - 32) * 1.1 + (bV - 32) * 0.14;
      } else {
        const c = clamp(bU + 11, 16, 56);
        u = clamp(c + (p.u0 - 29) * 0.92, 5, 70);
        v = 32 + (p.v0 - 32) * 0.72 + (bV - 32) * 0.4;
      }
      if (p.code !== 'GK') { u += Math.sin(t * p.f1 + p.ph1) * 1.3; v += Math.cos(t * p.f2 + p.ph2) * 1.1; }
      // find space: a team-mate of the ball carrier moves away from his marker
      if (inPoss && p.code !== 'GK' && B.holder && !att) {
        let mk = null, md = 99;
        for (const o of teamOf(other(p.side))) { const d = hyp(o.x - p.x, o.y - p.y); if (d < md) { md = d; mk = o; } }
        if (mk && md < 3.2) v += (V(p.side, p.y) - V(p.side, mk.y) >= 0 ? 1 : -1) * 2.2;
      }
      p.tx = clamp(X(p.side, u), 1, W - 1); p.ty = clamp(Y(p.side, v), 1.5, H - 1.5);
    }
    // pressing: the nearest defender goes to the ball (keeps his distance in the box), the next one covers
    if ((S.phase === 'play' || S.phase === 'attack') && B.holder) {
      const h = B.holder;
      const pr = nearest(other(h.side), h.x, h.y);
      if (pr && !(pr.lock && t < pr.lock)) {
        const d = hyp(pr.x - h.x, pr.y - h.y);
        const gap = S.phase === 'attack' ? 2.8 : 1.6;
        pr.tx = h.x - (pr.side === 'home' ? gap : -gap); pr.ty = h.y;
        if (d < 16) pr.sprint = t + 0.25;
      }
      const pr2 = pr && nearest(other(h.side), h.x, h.y, pr);
      if (pr2 && !(pr2.lock && t < pr2.lock) && S.phase === 'play') { pr2.tx = (h.x + X(pr2.side, 6)) / 2; pr2.ty = (h.y + H / 2) / 2; }
    }
    // a ball in the air (long ball, cross) or loose: the closest of each team goes for it
    if (S.phase === 'play' || S.phase === 'attack') {
      let bx = null, by = null;
      if (B.flight && B.flight.dur > 0.45 && !B.flight.shot) { bx = B.flight.tx; by = B.flight.ty; }
      else if (!B.holder && !B.flight) { bx = B.x; by = B.y; }
      if (bx != null) for (const side of ['home', 'away']) { const c = nearest(side, bx, by); if (c && !(c.lock && t < c.lock)) { c.tx = bx; c.ty = by; c.sprint = t + 0.3; } }
    }
  };

  // ---------- planned chances (from the real events, known a few seconds ahead)
  const ZV = { L: 7, C: 32, R: 57 };
  const HV = { L: 22, C: 32, R: 42 };
  const specFor = (pl) => {
    const { side, kind, chance, zone } = pl;
    const s0 = byPid[pl.shooterId];
    const shooter = live(s0) && s0.side === side ? s0 : null;
    const c0 = byPid[pl.creatorId];
    const creator = live(c0) && c0.side === side && c0 !== shooter ? c0 : null;
    const wingV = zone === 'R' ? 57 : zone === 'L' ? 7 : (Math.random() < 0.5 ? 7 : 57);
    const wideMate = () => outfield(side).filter((p) => p !== shooter && WIDE.has(p.code)).sort((a, b) => Math.abs(V(side, a.y) - wingV) - Math.abs(V(side, b.y) - wingV))[0];
    const mid = () => pick(outfield(side).filter((p) => p !== shooter && p.line === 'MID')) || null;
    const att = () => outfield(side).filter((p) => p.line === 'ATT').sort((a, b) => U(side, b.x) - U(side, a.x))[0];
    let spec;
    if (kind === 'corner') spec = { fh: wideMate() || mid() || shooter, c: { u: 82, v: wingV }, s: null };
    else if (kind === 'freekick') spec = { fh: mid() || att() || shooter, c: { u: rnd(68, 76), v: rnd(18, 46) }, s: null };
    else if (kind === 'penalty') spec = { fh: att() || mid() || shooter, c: { u: 86, v: rnd(24, 40) }, s: null };
    else switch (chance) {
      case 'cross': spec = { fh: creator || wideMate(), c: { u: 82, v: wingV }, s: { u: 90, v: wingV < 32 ? 29 : 35 } }; break;
      case 'cutback': spec = { fh: creator || wideMate(), c: { u: 93, v: wingV < 32 ? 13 : 51 }, s: { u: 86, v: 32 } }; break;
      case 'through': case 'counter': spec = { fh: creator || mid(), c: { u: 63, v: HV[zone] || 32 }, s: { u: 88, v: 32 + ((HV[zone] || 32) - 32) * 0.5 } }; break;
      case 'combo': spec = { fh: creator || mid(), c: { u: 75, v: HV[zone] || 32 }, s: { u: 84, v: 32 } }; break;
      case 'wide': spec = { fh: shooter, c: { u: 80, v: wingV }, s: { u: 86, v: HV[zone] || 32 } }; break;
      case 'long': spec = { fh: shooter, c: { u: 70, v: rnd(25, 39) }, s: null }; break;
      default: spec = { fh: creator || shooter, c: { u: 76, v: HV[zone] || 32 }, s: { u: 85, v: 32 } };
    }
    if (!live(spec.fh)) spec.fh = shooter || mid() || outfield(side)[0];
    spec.shooter = shooter; spec.creator = creator;
    return spec;
  };
  // win the ball, then pass it forward through players near natural waypoints to the man
  // who creates the chance; he carries it to where the chance is made
  const buildUp = (pl, arriveBy) => {
    if (S.plan !== pl) return;
    const side = pl.side, spec = pl.spec, fh = spec.fh;
    if (!fh) return;
    const start = S.t + 0.4;
    const steps = Math.max(0, Math.min(3, Math.floor((arriveBy - start - 0.8) / 1.15)));
    const used = new Set([fh, spec.shooter, B.holder]);
    const u0 = U(side, B.x), v0 = V(side, B.y);
    let tt = start;
    for (let i = 1; i <= steps; i++) {
      const f = i / (steps + 1);
      const wu = u0 + (spec.c.u - 6 - u0) * f, wv = clamp(v0 + (spec.c.v - v0) * f + rnd(-6, 6), 5, 59);
      const wx = X(side, wu), wy = Y(side, wv);
      let m = null, md = 1e9;
      for (const q of outfield(side)) { if (used.has(q)) continue; const d = hyp(q.x - wx, q.y - wy) - (q.line === 'MID' ? 4 : 0); if (d < md) { md = d; m = q; } }
      if (!m) break;
      used.add(m);
      const mm = m;
      at(tt - 0.6, () => runToUV(mm, wu, wv, 1.3, true));
      at(tt, () => relay(mm));
      tt += 1.15;
    }
    if (B.holder !== fh) {
      at(Math.max(S.t, tt - 0.7), () => runToUV(fh, spec.c.u - 7, spec.c.v, 1.3, true));
      at(tt, () => relay(fh));
    }
    at(tt + 0.45, () => { if (B.holder === fh && S.plan === pl) runToUV(fh, spec.c.u, spec.c.v, Math.max(0.6, arriveBy - S.t + 0.3), true); });
  };
  const minBuild = (pl) => ({ corner: 4.2, freekick: 4, penalty: 4.1, counter: 3.6 }[pl.kind] || 3.4);
  const startPlan = (pl) => {
    // in open play whatever was scheduled is dropped; a restart in progress is let finish
    if (S.phase === 'play') newScene();
    S.plan = pl; pl.started = true;
    mark('plan', { kind: pl.kind, side: pl.side, lead: +(pl.T - S.t).toFixed(2), chance: pl.chance, ph: S.phase });
    if (pl.kind === 'counter') { startCounter(pl); return; }
    const side = pl.side, T = pl.T;
    const spec = specFor(pl);
    pl.spec = spec;
    S.drive = { side, v: spec.c.v, until: T + 1 };
    const lead = { corner: 1.9, freekick: 1.7, penalty: 1.8 }[pl.kind] || 0;
    const begin = (tries = 0) => {
      if (S.plan !== pl) return;
      if (S.phase !== 'play' && S.phase !== 'attack' && tries < 60) { after(0.15, () => begin(tries + 1)); return; }
      steal(nearest(side, B.x, B.y), () => buildUp(pl, T - lead - 0.25));
    };
    begin();
    if (pl.kind === 'corner') at(T - lead, () => cornerLead(pl));
    else if (pl.kind === 'freekick' || pl.kind === 'penalty') {
      // the man who commits the foul is tracking the ball carrier
      const f = live(byPid[pl.foulerId]);
      if (f && f.side !== side) at(T - lead - 1.4, () => { const v = B.holder && B.holder.side === side ? B.holder : spec.fh; if (v) runTo(f, v.x, v.y, 1.3, true); });
      at(T - lead, () => (pl.kind === 'freekick' ? fkLead(pl) : penLead(pl)));
    } else {
      at(T - 1.7, () => { if (S.plan === pl && S.phase === 'play') { setPhase('attack'); S.attackSide = side; } });
      if (spec.shooter && spec.shooter !== spec.fh && spec.s) at(T - 1.4, () => runToUV(spec.shooter, spec.s.u - 4, spec.s.v, 2.4, true));
      at(T + 0.3, () => { if (S.plan === pl && !pl.final) { pl.hold = true; S.nextDecision = S.t + 0.4; } });
    }
    at(T + 9, () => { if (S.plan === pl && !pl.final) giveUp(pl); });
  };
  // counter: the other side is attacking, loses the ball, a pass into space and a sprint
  const startCounter = (pl) => {
    const side = pl.side, T = pl.T, opp = other(side);
    const spec = specFor({ ...pl, chance: 'through' });
    pl.spec = spec;
    const begin = (tries = 0) => {
      if (S.plan !== pl) return;
      if (S.phase !== 'play' && S.phase !== 'attack' && tries < 60) { after(0.15, () => begin(tries + 1)); return; }
      if (!(B.holder && B.holder.side === opp)) steal(nearest(opp, B.x, B.y));
    };
    begin();
    S.drive = { side: opp, v: 32, until: T - 2.2 };
    at(T - 2.2, () => {
      if (S.plan !== pl || (S.phase !== 'play' && S.phase !== 'attack')) return;
      S.drive = null;
      const thief = nearest(side, B.x, B.y);
      steal(thief, () => {
        show('KONTRA ATAK!', 'danger', 1300);
        if (thief) caption(`${surname(thief.p)} topu kaptı, hızlı çıkıyor!`);
        const runner = spec.fh && spec.fh !== thief ? spec.fh : spec.shooter;
        if (runner && runner !== thief) { runToUV(runner, 66, spec.c.v, 2.2, true); after(0.35, () => relay(runner, { power: 1.3 })); }
        if (spec.shooter && spec.shooter !== runner) runToUV(spec.shooter, 80, 32 + rnd(-6, 6), 2.6, true);
        after(1.3, () => { if (B.holder && B.holder.side === side) runToUV(B.holder, 76, spec.c.v, 1, true); });
      });
    });
    at(T + 0.3, () => { if (S.plan === pl && !pl.final && pl.hasShot) { pl.hold = true; S.nextDecision = S.t + 0.4; } });
    at(T + 9, () => { if (S.plan === pl && !pl.final) giveUp(pl); });
    // nothing came of it: a defender gets back in time
    at(T + 0.9, () => {
      if (S.plan !== pl || pl.final || pl.hasShot) return;
      const h = B.holder;
      const tk = h && h.side === side ? nearest(opp, h.x, h.y) : null;
      endPlan(pl);
      if (tk) steal(tk, () => caption(`${surname(tk.p)} son anda araya girdi`));
    });
  };
  const endPlan = (pl) => {
    mark('end', { kind: pl && pl.kind });
    if (S.plan === pl) S.plan = null;
    S.drive = null; S.attackSide = null; S.highlight = null;
    if (S.phase === 'attack' || S.phase === 'setpiece') setPhase('play');
  };
  const giveUp = (pl) => { mark('giveup', { kind: pl.kind }); endPlan(pl); if (S.phase !== 'play' && S.phase !== 'celebrate' && S.phase !== 'kickoff' && S.phase !== 'break') setPhase('play'); };
  // a plan that was running for something later goes back in the queue
  const suspendPlan = () => {
    const q = S.plan;
    if (!q || q.final) return;
    mark('suspend', { kind: q.kind });
    S.plan = null; S.drive = null; S.attackSide = null;
    if (q.kind !== 'quick') { S.plans.push({ ...q, started: false, spec: null, hold: false }); S.plans.sort(byOrder); }
  };
  const planFor = (ev) => {
    const k = evKey(ev);
    if (S.plan && S.plan.keys && S.plan.keys.has(k)) return S.plan;
    const qi = S.plans.findIndex((q) => q.keys.has(k));
    if (qi >= 0) S.plans.splice(qi, 1); // it never got going: a quick version instead
    return null;
  };
  // the chance at hand: its plan, or a quick one
  const takeOver = (ev, side) => {
    let pl = planFor(ev);
    if (!pl) {
      suspendPlan();
      pl = { keys: new Set([evKey(ev)]), kind: 'quick', side, T: S.t, started: true };
      S.plan = pl;
      mark('quick', { type: ev.type, chance: ev.chance, minute: ev.minute });
    }
    return pl;
  };

  const byOrder = (a, b) => a.ord - b.ord || a.T - b.T;
  const addPlan = (run, T, ord) => {
    const keys = new Set(run.map(evKey));
    const key = [...keys].join(',');
    const queued = S.plans.find((q) => q.key === key);
    if (queued) { if (!queued.pinned) queued.T = T; return queued; }
    if (S.plan && S.plan.key === key) return S.plan;
    const first = run[0];
    const side = first.side === 'away' ? 'away' : 'home';
    const sh = run.find((e) => isShot(e));
    const counter = first.type === 'counter' || (isShot(first) && first.chance === 'counter');
    const kind = counter ? 'counter' : isShot(first) ? 'open' : first.type;
    const zone = sh && sh.zone && sh.zone !== 'C' ? sh.zone : kind === 'corner' ? pick(['L', 'R']) : (sh && sh.zone) || 'C';
    const pl = {
      key, keys, kind, side, T, chance: sh ? sh.chance : null, zone,
      shooterId: sh ? sh.playerId : null, creatorId: sh ? sh.creatorId : null,
      takerId: kind === 'open' || kind === 'counter' ? null : first.playerId, foulerId: first.foulerId || null,
      narrated: sh ? shotShown(sh) : false, hasShot: !!sh, ord,
    };
    S.plans.push(pl);
    S.plans.sort(byOrder);
    return pl;
  };

  // ---------- set pieces
  // the attack down the wing ends with a deflection behind: corner
  const cornerLead = (pl) => {
    if (S.plan !== pl) return;
    const side = pl.side, top = pl.spec.c.v < 32;
    const h = B.holder;
    const df = nearest(other(side), B.x, B.y);
    if (h && h.side === side) caption(`${surname(h.p)} ortalamak istedi…`);
    if (B.flight) return after(0.15, () => cornerLead(pl));
    loose();
    kick(X(side, 101), Y(side, top ? rnd(3, 13) : rnd(H - 13, H - 3)), { power: 1.25, onArrive: () => caption(df ? `${surname(df.p)} kornere çeldi` : 'Savunma kornere çeldi') });
    setPhase('restart');
    const go = setPending('corner', side, () => { cornerSetup(side, live(byPid[pl.takerId]), top, live(byPid[pl.shooterId])); S.setpiece = { kind: 'corner', side, at: S.t }; });
    after(0.6, () => { if (S.pending && S.pending.kind === 'corner') go(); });
  };
  const setTime = (pl, x, y) => (pl ? clamp(hyp(pl.x - x, pl.y - y) / 14 + 0.3, 1.1, 2.2) : 1.1);
  const cornerSetup = (side, taker0, top, avoid = null) => {
    setPhase('setpiece'); S.drive = null; S.attackSide = side;
    const fx = X(side, 99.3), fy = Y(side, top ? 0.5 : H - 0.5);
    const fly = placeBall(fx, fy);
    const taker = live(taker0) && taker0.side === side && taker0 !== avoid ? taker0 : outfield(side).filter((p) => p !== avoid && (p.line !== 'DEF' || WIDE.has(p.code))).sort((a, b) => hyp(a.x - fx, a.y - fy) - hyp(b.x - fx, b.y - fy))[0];
    S.setTaker = taker;
    if (taker) runTo(taker, X(side, 100.5), Y(side, top ? -0.5 : H + 0.5), 3.2, true);
    show('KORNER', 'set', 1100);
    // the big men go into the box, two wait on the edge, the rest stay back
    const mates = outfield(side).filter((p) => p !== taker).sort((a, b) => (BOX_PRIO[a.code] ?? 2) - (BOX_PRIO[b.code] ?? 2));
    mates.forEach((p, i) => {
      if (i < 5) runTo(p, X(side, rnd(87, 95)), rnd(H / 2 - 11, H / 2 + 11), 3.2, true);
      else if (i < 7) runTo(p, X(side, rnd(70, 76)), rnd(16, H - 16), 3.2, true);
      else runTo(p, X(side, rnd(52, 58)), rnd(12, H - 12), 3.2);
    });
    // the defence marks in the box, one on the near post, a forward waits up front
    const dfs = outfield(other(side)).sort((a, b) => (a.line === 'ATT') - (b.line === 'ATT'));
    dfs.forEach((p, i) => {
      if (i === dfs.length - 1 && p.line === 'ATT') runTo(p, X(side, rnd(56, 62)), rnd(18, H - 18), 3.2);
      else if (i === 0) runTo(p, X(side, 99), H / 2 + (top ? -1 : 1) * 3.6 * (side === 'home' ? 1 : -1), 3.2, true);
      else runTo(p, X(side, rnd(88, 97)), rnd(H / 2 - 11, H / 2 + 11), 3.2, true);
    });
    const gk = keeper(other(side));
    if (gk) runTo(gk, X(side, 99.2), H / 2, 3.2);
    if (taker) caption(`${surname(taker.p)} kornerde`);
    S.readyAt = S.t + Math.max(fly + 0.4, setTime(taker, fx, fy));
  };
  // the foul: the fouler gets to the man on the ball and brings him down
  const foulScene = (fouler, victim, then, tries = 0) => {
    if (!live(fouler) || !live(victim)) { then(); return; }
    runTo(fouler, victim.x, victim.y, 0.4, true);
    if (hyp(fouler.x - victim.x, fouler.y - victim.y) < 2.8 || tries > 8) {
      victim.down = S.t + 1.3;
      if (B.holder === victim) loose();
      show('FAUL!', 'set', 900);
      caption(`${surname(fouler.p)} faul yaptı`);
      ref.fx = victim.x; ref.fy = victim.y; ref.until = S.t + 1.5;
      after(0.35, then);
      return;
    }
    after(0.1, () => foulScene(fouler, victim, then, tries + 1));
  };
  const fkLead = (pl) => {
    if (S.plan !== pl) return;
    const side = pl.side;
    const victim = (B.holder && B.holder.side === side && B.holder) || pl.spec.fh;
    const f0 = live(byPid[pl.foulerId]);
    const fouler = f0 && f0.side !== side ? f0 : victim ? nearest(other(side), victim.x, victim.y) : null;
    const go = setPending('freekick', side, () => { freekickSetup(side, victim, live(byPid[pl.takerId])); S.setpiece = { kind: 'freekick', side, at: S.t }; });
    foulScene(fouler, victim, () => { if (S.pending && S.pending.kind === 'freekick') go(); });
  };
  const freekickSetup = (side, victim, taker0, avoid = null) => {
    setPhase('setpiece'); S.drive = null; S.attackSide = side;
    const u = clamp(victim ? U(side, victim.x) : 72, 60, 82), v = clamp(victim ? V(side, victim.y) : 32, 7, 57);
    const fx = X(side, u), fy = Y(side, v);
    const fly = placeBall(fx, fy);
    const taker = live(taker0) && taker0.side === side && taker0 !== avoid ? taker0 : nearest(side, fx, fy, avoid);
    S.setTaker = taker;
    if (taker) runTo(taker, X(side, u - 2), fy, 3.2, true);
    show('FRİKİK', 'set', 1100);
    // the wall, between the ball and the goal
    const gx = X(side, 100), gy = H / 2;
    const dx = gx - fx, dy = gy - fy, dl = hyp(dx, dy) || 1;
    const n = u > 70 ? 4 : 3;
    const wall = outfield(other(side)).sort((a, b) => hyp(a.x - fx, a.y - fy) - hyp(b.x - fx, b.y - fy)).slice(0, n);
    wall.forEach((p, i) => runTo(p, fx + (dx / dl) * 9 + (-dy / dl) * (i - (n - 1) / 2) * 1.9, fy + (dy / dl) * 9 + (dx / dl) * (i - (n - 1) / 2) * 1.9, 3.2, true));
    const mates = outfield(side).filter((p) => p !== taker).sort((a, b) => (BOX_PRIO[a.code] ?? 2) - (BOX_PRIO[b.code] ?? 2));
    mates.forEach((p, i) => { if (i < 5) runTo(p, X(side, rnd(83, 92)), rnd(H / 2 - 13, H / 2 + 13), 3.2, true); else runTo(p, X(side, rnd(55, 66)), rnd(12, H - 12), 3.2); });
    for (const p of outfield(other(side))) if (!wall.includes(p)) runTo(p, X(side, rnd(86, 95)), rnd(H / 2 - 12, H / 2 + 12), 3.2, true);
    const gk = keeper(other(side));
    if (gk) runTo(gk, X(side, 99), H / 2 + (fy - H / 2) * 0.15, 3.2);
    if (taker) caption(`${surname(taker.p)} topun başında`);
    S.readyAt = S.t + Math.max(fly + 0.4, setTime(taker, fx, fy));
  };
  const penLead = (pl) => {
    if (S.plan !== pl) return;
    const side = pl.side;
    const victim = (B.holder && B.holder.side === side && B.holder) || pl.spec.fh;
    const f0 = live(byPid[pl.foulerId]);
    const fouler = f0 && f0.side !== side ? f0 : victim ? nearest(other(side), victim.x, victim.y, null, true) : null;
    const go = setPending('penalty', side, () => { penaltySetup(side, live(byPid[pl.takerId])); S.setpiece = { kind: 'penalty', side, at: S.t }; });
    foulScene(fouler, victim, () => { show('PENALTI!', 'pen', 1500); after(0.4, () => { if (S.pending && S.pending.kind === 'penalty') go(); }); });
  };
  const penaltySetup = (side, taker0) => {
    setPhase('setpiece'); S.drive = null; S.attackSide = side;
    const sx = X(side, 89), sy = H / 2;
    const fly = placeBall(sx, sy);
    const taker = live(taker0) && taker0.side === side ? taker0 : outfield(side).find((p) => p.line === 'ATT') || outfield(side)[0];
    S.setTaker = taker; S.highlight = taker;
    if (taker) runTo(taker, X(side, 86.3), sy, 3.4, true);
    for (const p of outfield('home').concat(outfield('away'))) if (p !== taker) runTo(p, X(side, rnd(70, 81)), rnd(13, H - 13), 3.4);
    const gk = keeper(other(side));
    if (gk) runTo(gk, X(side, 99.6), H / 2, 3.4, true);
    if (taker) caption(`${surname(taker.p)} topun başında`);
    S.readyAt = S.t + Math.max(fly + 0.4, setTime(taker, X(side, 86.3), sy));
  };

  // ---------- shots
  const goalX = (side) => (side === 'home' ? W + 1.3 : -1.3);
  // make sure the shooter has the ball (or it is at his feet) before he shoots
  const ensureBall = (shooter, side, then, tries = 0) => {
    if (!shooter) { then(); return; }
    if (B.flight && tries < 40) { after(0.1, () => ensureBall(shooter, side, then, tries + 1)); return; }
    const d = hyp(B.x - shooter.x, B.y - shooter.y);
    if (B.holder === shooter || d < 3.5 || tries >= 40) { then(); return; }
    if (tries % 8 === 0) {
      // the ball is played to him (by a team-mate, or it falls to him)
      if (B.holder && B.holder.side === side) passTo(shooter, { power: 1.4, sure: true, lob: d > 28 });
      else kick(shooter.x, shooter.y, { lob: d > 14, speed: d > 30 ? 42 : 34, onArrive: () => { if (hyp(shooter.x - B.x, shooter.y - B.y) < 4.5) receive(shooter); } });
    } else if (!B.holder || B.holder.side !== side) runTo(shooter, B.x, B.y, 0.3, true);
    after(0.1, () => ensureBall(shooter, side, then, tries + 1));
  };
  // a shot that has to come from a man deep in his half: he carries it forward first
  const advance = (shooter, side, then, tries = 0) => {
    if (!shooter || B.holder !== shooter || U(side, shooter.x) >= 66 || tries > 14) { then(); return; }
    runToUV(shooter, Math.min(U(side, shooter.x) + 14, 74), V(side, shooter.y) + (32 - V(side, shooter.y)) * 0.3, 0.5, true);
    after(0.1, () => advance(shooter, side, then, tries + 1));
  };
  const shoot = (ev, text, minor, ctx = {}) => {
    const side = ev.side === 'away' ? 'away' : 'home';
    const s0 = live(byPid[ev.playerId]);
    const shooter = s0 && s0.side === side ? s0 : (B.holder && B.holder.side === side ? B.holder : nearest(side, B.x, B.y));
    const pl = minor ? takeOver(ev, side) : (planFor(ev) || S.plan);
    runPending();
    newScene();
    if (pl) pl.final = true;
    if (shooter && !minor) S.highlight = shooter;
    const thenCorner = cornerNext(ctx.next, side);
    const wait = Math.max(0, S.readyAt - S.t);
    const runUp = !!(ev.penalty || ev.setPiece === 'penalty' || ev.chance === 'freekick');
    const go = () => ensureBall(shooter, side, () => {
      if (runUp && shooter) { runTo(shooter, B.x, B.y, 0.4, true); after(0.3, () => fire(ev, text, minor, side, shooter, pl, thenCorner)); }
      else if (minor) advance(shooter, side, () => fire(ev, text, minor, side, shooter, pl, thenCorner));
      else fire(ev, text, minor, side, shooter, pl, thenCorner);
    });
    if (wait > 0.05) after(Math.min(wait, 1.8), go); else go();
    const far = shooter && B.holder !== shooter ? hyp(B.x - shooter.x, B.y - shooter.y) : 0;
    const deep = minor && shooter ? Math.max(0, 66 - U(side, shooter.x)) / 12 : 0;
    const extra = Math.min(wait, 1.8) + (far > 3.5 ? 0.3 + far / 34 : 0) + Math.min(1.4, deep);
    if (ev.type === 'goal') return extra + 4.2;
    if (thenCorner) return extra + 1.2;
    if (ev.type === 'save') return extra + (minor ? 1.4 : 1.7);
    return extra + (/direk/i.test(text) ? 2.2 : 1.4);
  };
  const fire = (ev, text, minor, side, shooter, pl, thenCorner) => {
    mark('fire', { type: ev.type, minor, chance: ev.chance, minute: ev.minute, gap: shooter ? +hyp(B.x - shooter.x, B.y - shooter.y).toFixed(2) : -1, bu: +U(side, B.x).toFixed(1), plan: pl ? pl.kind : null, thenCorner });
    const gk = keeper(other(side));
    const post = /direk/i.test(text);
    const over = /üst/i.test(text);
    const pen = !!(ev.penalty || ev.setPiece === 'penalty');
    const direct = ev.chance === 'freekick';
    const done = () => { if (pl) endPlan(pl); };
    loose();
    if (!minor) show('ŞUUUT!', 'shot', 650);
    // out behind for a corner, off a defender or the keeper
    const behind = (y0, who) => {
      setPhase('restart');
      kick(X(side, 101.2), y0 < H / 2 ? rnd(12, 25) : rnd(39, 52), { power: 1.1 });
      caption(who ? `${surname(who.p)} kornere çeldi` : 'Kornere çıktı');
      done();
    };
    if (ev.type === 'goal') {
      const gy = H / 2 + rnd(-3.3, 3.3);
      if (gk) runTo(gk, X(other(side), 1.4), H / 2 + (gy - H / 2) * (pen ? -0.8 : 0.45), 0.9, true);
      kick(goalX(side), gy, { speed: direct ? SHOT * 0.75 : SHOT, lob: direct, shot: true, onArrive: () => {
        const net = nets[side === 'home' ? 'right' : 'left'];
        net.classList.remove('ripple'); void net.getBBox(); net.classList.add('ripple');
        flash.classList.remove('on'); void flash.getBBox(); flash.classList.add('on');
        show('GOOOL!', 'goal', 2600);
        caption(`⚽ ${surname(shooter && shooter.p)}!`);
        celebrate(side, shooter);
        done();
      } });
      return;
    }
    if (ev.type === 'save') {
      const sy = H / 2 + rnd(-3.4, 3.4);
      if (gk) runTo(gk, X(other(side), 1.8), sy, 0.7, true);
      kick(X(side, 98), sy, { speed: direct ? SHOT * 0.72 : SHOT * 0.9, lob: direct, shot: true, onArrive: () => {
        if (!minor) show('KURTARDI!', 'save', 1300);
        if (thenCorner) { behind(sy, gk); return; }
        if (gk) receive(gk);
        S.highlight = gk;
        setPhase('restart');
        after(1.4, () => { setPhase('play'); S.highlight = null; S.nextDecision = S.t + 0.2; });
        done();
      } });
      return;
    }
    if (post) {
      const py = H / 2 + (Math.random() < 0.5 ? -4 : 4);
      kick(goalX(side) - (side === 'home' ? 1.3 : -1.3), py, { speed: SHOT, shot: true, onArrive: () => {
        show('DİREKTEN DÖNDÜ!', 'post', 1500);
        if (thenCorner) { behind(py, null); return; }
        kick(X(side, rnd(85, 91)), H / 2 + rnd(-8, 8), { power: 1.1, onArrive: () => {
          show('KARAMBOL!', 'danger', 1000);
          setPhase('play');
          const c = nearest(other(side), B.x, B.y);
          if (c) collect(c, () => { caption(`${surname(c.p)} uzaklaştırdı`); kick(X(side, rnd(45, 60)), rnd(6, H - 6), { lob: true, onArrive: () => land() }); });
          done();
        } });
      } });
      return;
    }
    // blocked: a defender in the way
    if ((minor && !pen && !direct && Math.random() < 0.45) || (thenCorner && !over)) {
      const mx = (B.x + goalX(side)) / 2, my = (B.y + H / 2) / 2;
      const blk = nearest(other(side), mx, my);
      if (blk && hyp(blk.x - B.x, blk.y - B.y) < 22) {
        kick(blk.x, blk.y, { speed: SHOT * 0.8, shot: true, onArrive: () => {
          caption(`${surname(blk.p)} şutu blokladı`);
          if (thenCorner) { behind(B.y, blk); return; }
          setPhase('play');
          kick(B.x + rnd(-8, 8), clamp(B.y + rnd(-10, 10), 3, H - 3), { power: 0.6, onArrive: () => land() });
          done();
        } });
        return;
      }
    }
    // wide or over
    const wy = H / 2 + (Math.random() < 0.5 ? rnd(-12, -5.5) : rnd(5.5, 12));
    kick(goalX(side) + (side === 'home' ? 3 : -3), over ? H / 2 + rnd(-3, 3) : wy, { speed: SHOT * (direct ? 0.72 : 0.95), lob: over || direct, shot: true, onArrive: () => {
      if (!minor) show(over ? 'ÜSTTEN AUTA!' : pick(['DIŞARI!', 'AUT!', 'AZ FARKLA DIŞARI!']), 'miss', 1100);
      else caption(over ? 'Top üstten auta' : 'Top yandan auta');
      setPhase('restart');
      if (thenCorner) { caption('Savunmaya çarpıp kornere çıktı'); done(); return; }
      after(0.6, () => { goalKick(other(side)); done(); });
    } });
  };
  const celebrate = (side, scorer) => {
    setPhase('celebrate'); S.attackSide = null;
    const cx = side === 'home' ? W - 3 : 3, cy = scorer && scorer.y < H / 2 ? 3 : H - 3;
    if (scorer) runTo(scorer, cx, cy, 3.2, true);
    for (const p of outfield(side)) if (p !== scorer) runTo(p, cx - (side === 'home' ? 1 : -1) * rnd(3, 10), cy + (cy < H / 2 ? 1 : -1) * rnd(2, 9), 3.2, true);
    for (const p of outfield(other(side))) runTo(p, X(other(side), rnd(20, 42)), p.y, 3);
    after(3, () => kickOff(other(side)));
  };

  // ---------- render loop
  let raf = null;
  const frame = (ts) => {
    if (!svg.isConnected && S.last) { raf = null; return; }
    if (S.stopAt && S.t > S.stopAt) { raf = null; return; }
    const dt = S.paused ? 0 : Math.min(0.1, S.last ? (ts - S.last) / 1000 : 0.016) * S.speed;
    S.last = ts; S.t += dt;
    if (S.keep.length) { const due = S.keep.filter((x) => x.at <= S.t); if (due.length) { S.keep = S.keep.filter((x) => x.at > S.t); due.forEach((x) => x.fn()); } }
    // scripted steps of the current scene
    if (S.script.length) {
      const sc = S.scene;
      const due = S.script.filter((x) => x.at <= S.t);
      if (due.length) { S.script = S.script.filter((x) => x.at > S.t); for (const x of due) { if (S.scene !== sc) break; x.fn(); } }
    }
    // a restart or set piece that nobody finished goes back to open play
    if ((S.phase === 'setpiece' || S.phase === 'restart' || S.phase === 'attack') && S.t - S.phaseAt > 8 && !S.script.length) {
      if (S.plan && !S.plan.final) endPlan(S.plan);
      setPhase('play');
    }
    // the next planned chance starts when the field is ready
    if (S.plans.length) S.plans = S.plans.filter((q) => q.T > S.t - 40);
    if (!S.plan && S.plans.length && (S.phase === 'play' || S.phase === 'restart' || S.phase === 'kickoff')) {
      const nx = S.plans[0];
      if (nx && nx.T - S.t < 7.5) { S.plans.shift(); nx.T = Math.max(nx.T, S.t + minBuild(nx) + (S.phase === 'play' ? 0 : 1.6)); startPlan(nx); }
    }
    // possession share (rolling, ~60 s)
    const owner = B.holder ? B.holder.side : S.poss;
    S.share += ((owner === 'home' ? 1 : 0) - S.share) * Math.min(1, dt / 60);
    // decisions of the player on the ball (the build-up of a planned chance is scripted)
    const hb = B.holder;
    const holding = S.plan && S.plan.hold && !S.plan.final;
    const scripted = S.plan && S.plan.started && !S.plan.final && !S.plan.hold && hb && hb.side === S.plan.side;
    if ((S.phase === 'play' || (S.phase === 'attack' && holding)) && hb && S.t >= S.nextDecision && !scripted) decide(hb);
    // an attack waiting for its moment wins the ball back if it lost it
    if (holding && !B.flight && (!hb || hb.side !== S.plan.side) && S.t > (S.plan.recoverAt || 0) && (S.phase === 'play' || S.phase === 'attack')) { S.plan.recoverAt = S.t + 2.5; steal(nearest(S.plan.side, B.x, B.y)); }
    // a loose ball is picked up by whoever gets to it first
    if ((S.phase === 'play' || S.phase === 'attack') && !B.holder && !B.flight) {
      for (const side of ['home', 'away']) { const c = nearest(side, B.x, B.y, null, true); if (c && hyp(c.x - B.x, c.y - B.y) < 1.6) { receive(c); break; } }
    }
    updateTargets();
    // move players (steering with inertia, top speed from pace)
    for (const p of players) {
      if (!p.alive) continue;
      if (p.down > S.t) { p.vx *= 0.8; p.vy *= 0.8; continue; }
      const sprint = p.sprint > S.t;
      const max = p.top * (sprint ? 1 : 0.55);
      const dx = p.tx - p.x, dy = p.ty - p.y, d = hyp(dx, dy);
      const want = d < 0.05 ? 0 : Math.min(max, d * 2.8);
      const wx = d ? (dx / d) * want : 0, wy = d ? (dy / d) * want : 0;
      const k = Math.min(1, dt * p.acc);
      p.vx += (wx - p.vx) * k; p.vy += (wy - p.vy) * k;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (let i = 0; i < players.length; i++) for (let j = i + 1; j < players.length; j++) {
      const a = players[i], c = players[j];
      if (!a.alive || !c.alive) continue;
      const dx = c.x - a.x, dy = c.y - a.y, d = hyp(dx, dy);
      const min = a.side === c.side ? 4 : 3;
      if (d > 0.01 && d < min) { const push = (min - d) * 0.22; a.x -= (dx / d) * push; a.y -= (dy / d) * push; c.x += (dx / d) * push; c.y += (dy / d) * push; }
    }
    // ball: in the air, or at the feet of the man who has it (it follows him smoothly)
    if (B.flight) {
      const f = B.flight;
      const u = clamp((S.t - f.t0) / f.dur, 0, 1);
      const e = f.lob ? u : 1 - Math.pow(1 - u, 1.7);
      B.x = f.fx + (f.tx - f.fx) * e; B.y = f.fy + (f.ty - f.fy) * e;
      B.z = f.lob ? 4 * f.h * u * (1 - u) : 0;
      if (u >= 1) { B.flight = null; B.z = 0; if (f.onArrive) f.onArrive(); }
    } else if (B.holder) {
      const h = B.holder;
      const sp = hyp(h.vx, h.vy);
      const fx = sp > 0.8 ? h.vx / sp : (h.side === 'home' ? 1 : -1), fy = sp > 0.8 ? h.vy / sp : 0;
      const k = Math.min(1, dt * 14);
      B.x += (h.x + fx * 1.4 - B.x) * k; B.y += (h.y + fy * 1.4 + 0.3 - B.y) * k; B.z = 0;
    }
    // referee follows play from a distance (or goes to the incident)
    const focus = ref.until > S.t;
    const rtx = focus ? ref.fx + 3 : clamp(B.x - 7, 4, W - 4), rty = focus ? ref.fy + 3 : clamp(B.y + (B.y < H / 2 ? 9 : -9), 3, H - 3);
    ref.vx += ((rtx - ref.x) * 1.2 - ref.vx) * Math.min(1, dt * 2); ref.vy += ((rty - ref.y) * 1.2 - ref.vy) * Math.min(1, dt * 2);
    ref.x += ref.vx * dt; ref.y += ref.vy * dt;
    // draw
    for (const p of players) {
      if (!p.alive) continue;
      const sc = p === S.highlight ? 1.45 : p === B.holder ? 1.15 : 1;
      const rot = p.down > S.t ? ' rotate(80)' : '';
      p.g.setAttribute('transform', `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) scale(${sc})${rot}`);
    }
    refG.setAttribute('transform', `translate(${ref.x.toFixed(2)} ${ref.y.toFixed(2)})`);
    ballShadow.setAttribute('cx', B.x.toFixed(2)); ballShadow.setAttribute('cy', (B.y + 0.5).toFixed(2));
    ballEl.setAttribute('cx', B.x.toFixed(2)); ballEl.setAttribute('cy', (B.y - B.z).toFixed(2));
    ballEl.setAttribute('r', (0.95 + B.z * 0.08).toFixed(2));
    const tagged = S.highlight || B.holder;
    if (tagged && tagged.alive) { nameTag.textContent = surname(tagged.p); nameTag.setAttribute('x', tagged.x.toFixed(2)); nameTag.setAttribute('y', (tagged.y + (tagged === S.highlight ? 5.6 : 4.4)).toFixed(2)); }
    else nameTag.textContent = '';
    if (trace) trace.push({ t: S.t, x: B.x, y: B.y, z: B.z, h: B.holder ? B.holder.pid : null, f: !!B.flight, ph: S.phase, pl: S.plan ? S.plan.kind : null });
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  const dangerText = (ev, pen) => (pen ? 'PENALTI!' : ev.chance === 'freekick' ? 'FRİKİK!' : ev.chance === 'corner' ? 'KORNERDEN ORTA…' : ev.setPiece === 'freekick' ? 'FRİKİKTEN ORTA…' : ev.chance === 'counter' ? 'KONTRA ATAK!' : ev.chance === 'cross' ? 'KANATTAN ORTA…' : ev.chance === 'through' ? 'ARA PAS!' : ev.chance === 'long' ? 'UZAKTAN DENİYOR…' : ev.chance === 'cutback' ? 'ÇİZGİYE İNDİ, GERİ ÇEVİRDİ…' : ev.chance === 'wide' ? 'İÇE KAT EDİYOR…' : 'TEHLİKELİ ATAK!');
  const quietPhase = () => S.phase === 'break';

  // ---------- public API
  const api = {
    el: wrap,
    setSpeed(s) { S.speed = clamp(s || 1, 0.3, 30); },
    // a paused replay freezes the picture
    pause(on) { S.paused = !!on; },
    // possession share of the home side this minute (0..100)
    idle(poss = 50) { S.possPct = poss; },
    // the events of one coming tick, `secs` seconds of animation from now
    plan(cluster, secs, tick = 0) {
      const list = (Array.isArray(cluster) ? cluster : [cluster]).filter(Boolean);
      // one move per run of events of the same side (a home corner, then an away counter)
      const runs = [];
      for (const e of list) { const r = runs[runs.length - 1]; if (r && r[0].side === e.side) r.push(e); else runs.push([e]); }
      runs.forEach((run, i) => addPlan(run, S.t + Math.max(0.5, secs) + i * 3, tick * 10 + i));
    },
    // the chance itself: the final ball (the outcome follows a beat later)
    danger(ev) {
      const side = ev.side === 'away' ? 'away' : 'home';
      const s0 = live(byPid[ev.playerId]);
      const shooter = s0 && s0.side === side ? s0 : null;
      const c0 = live(byPid[ev.creatorId]);
      const creator = c0 && c0 !== shooter && c0.side === side ? c0 : null;
      const pen = !!(ev.penalty || ev.setPiece === 'penalty');
      const direct = ev.chance === 'freekick';
      const fromSpot = ev.chance === 'corner' || (ev.setPiece === 'freekick' && !direct);
      const pl = takeOver(ev, side);
      runPending();
      newScene();
      pl.final = true;
      S.highlight = shooter; S.drive = null;
      if (!pen && !direct && !fromSpot) { setPhase('attack'); S.attackSide = side; }
      show(dangerText(ev, pen), pen ? 'pen' : 'danger', 1300);
      if (pen || direct) {
        if (shooter) runTo(shooter, B.x - (side === 'home' ? 2.2 : -2.2), B.y + (direct ? 1.2 : 0), 0.7);
        return;
      }
      const spot = pl.spec && pl.spec.s ? pl.spec.s : { u: 89, v: 32 + rnd(-5, 5) };
      const finalBall = (tries = 0) => {
        if (!shooter) return;
        if (B.flight && tries < 12) { after(0.1, () => finalBall(tries + 1)); return; }
        const h = B.holder;
        const su = U(side, shooter.x), sv = V(side, shooter.y);
        if (h === shooter) {
          // he goes for goal himself
          runToUV(shooter, Math.max(su + 4, ev.chance === 'long' ? 70 : 85), ev.chance === 'wide' ? 32 + (sv - 32) * 0.5 : sv, 1.1, true);
          return;
        }
        if (ev.chance === 'cross' || fromSpot) {
          const sp2 = fromSpot ? { u: rnd(88, 93), v: 32 + rnd(-6, 6) } : spot;
          runToUV(shooter, sp2.u, sp2.v, 1.3, true);
          kick(X(side, sp2.u), Y(side, sp2.v), { lob: true, power: 1.1, onArrive: () => { if (hyp(shooter.x - B.x, shooter.y - B.y) < 5) receive(shooter); else land(side); } });
          const by = h || (fromSpot ? S.setTaker : null);
          caption(by ? `${surname(by.p)} ortaladı!` : 'Orta geliyor!');
          if (fromSpot) setPhase('attack');
        } else if (ev.chance === 'through' || ev.chance === 'counter') {
          const tu = Math.max(su + 6, 84), tv = 32 + (sv - 32) * 0.4;
          runToUV(shooter, tu + 1.5, tv, 1.5, true);
          kick(X(side, tu), Y(side, tv), { power: 1.15, onArrive: () => { if (hyp(shooter.x - B.x, shooter.y - B.y) < 5) receive(shooter); else land(side); } });
          caption(h ? `${surname(h.p)}'den ara pas!` : 'Ara pas!');
        } else if (ev.chance === 'cutback') {
          runToUV(shooter, 85, 32 + rnd(-3, 3), 1.2, true);
          after(0.3, () => relay(shooter, { power: 1.15 }));
          if (h) caption(`${surname(h.p)} geri çevirdi…`);
        } else {
          relay(shooter, { power: 1.2 });
          if (h) caption(`${surname(h.p)} pası verdi…`);
        }
      };
      if (fromSpot) { at(Math.max(S.t + 0.05, S.readyAt), () => finalBall()); return; }
      if (B.holder && B.holder.side === side) { finalBall(); return; }
      // not planned: win the ball and play it forward quickly
      if (shooter) runToUV(shooter, 82, 32 + (V(side, shooter.y) - 32) * 0.5, 1.5, true);
      steal(nearest(side, B.x, B.y), () => {
        if (creator && B.holder !== creator && B.holder !== shooter) passTo(creator, { power: 1.4, sure: true, then: () => finalBall() });
        else finalBall();
      });
    },
    // the result of the chance; returns the seconds before the next thing may happen
    outcome(ev, text = '', ctx = {}) { return shoot(ev, text, false, ctx); },
    // a small chance that is not narrated (long shot, blocked shot, a header over)
    minorShot(ev, ctx = {}) {
      if (S.phase === 'break' || S.phase === 'celebrate') return 0;
      return shoot(ev, '', true, ctx);
    },
    // everything else from the event log; returns the seconds the next thing should wait
    event(ev, ctx = {}) {
      const side = ev.side === 'away' ? 'away' : 'home';
      const pl = live(byPid[ev.playerId]);
      const next = ctx.next || [];
      // its moment has come: a plan that never got going is dropped
      if (PLANNABLE.has(ev.type)) { const k = evKey(ev); S.plans = S.plans.filter((q) => !q.keys.has(k)); }
      switch (ev.type) {
        case 'corner': {
          if (quietPhase() || ctx.fast) return 0;
          if (S.pending && S.pending.kind === 'corner' && S.pending.side === side) runPending();
          const sp = S.setpiece;
          if (sp && sp.kind === 'corner' && sp.side === side && !sp.used && S.t - sp.at < 6) {
            sp.used = true;
            const pln = S.plan;
            if (shotNext(next, side)) return 0.3;
            const d = Math.max(0.4, S.readyAt - S.t + 0.3);
            after(d, () => crossCleared(side, () => { if (pln) endPlan(pln); }));
            return d + 1.5;
          }
          { const own = planFor(ev); newScene(); if (own) endPlan(own); else suspendPlan(); }
          const tgtY = B.flight ? B.flight.ty : B.y;
          const top = V(side, tgtY) < H / 2;
          const nx = (next || []).find((x) => (x.mo || x.minor) && (x.mo ? x.mo.event : x.minor).side === side);
          const header = nx ? live(byPid[(nx.mo ? nx.mo.event : nx.minor).playerId]) : null;
          const go = setPending('corner', side, () => { cornerSetup(side, pl, top, header); S.setpiece = { kind: 'corner', side, at: S.t, used: true }; if (!shotNext(next, side)) after(S.readyAt - S.t + 0.3, () => crossCleared(side)); });
          const mine = S.pending;
          setPhase('restart');
          const start = (tries = 0) => {
            if (S.pending !== mine) return;
            if (B.flight && tries < 12) { after(0.1, () => start(tries + 1)); return; }
            if (U(side, B.x) > 62 && U(side, B.x) < 99 && B.y > 1 && B.y < H - 1) {
              // off a defender behind, then the corner
              const df = nearest(other(side), B.x, B.y);
              loose();
              kick(X(side, 101), Y(side, top ? rnd(3, 12) : rnd(H - 12, H - 3)), { power: 1.25 });
              caption(df ? `${surname(df.p)} kornere çeldi` : 'Savunma kornere çeldi');
              after(0.55, () => { if (S.pending === mine) go(); });
            } else go();
          };
          const flying = B.flight ? Math.max(0, B.flight.t0 + B.flight.dur - S.t) : 0;
          start();
          return flying + 0.55 + setTime(pl || S.setTaker, X(side, 99.3), Y(side, top ? 0.5 : H - 0.5)) + (shotNext(next, side) ? 0 : 2.2);
        }
        case 'freekick': {
          if (quietPhase() || ctx.fast) return 0;
          if (S.pending && S.pending.kind === 'freekick' && S.pending.side === side) runPending();
          const sp = S.setpiece;
          if (sp && sp.kind === 'freekick' && sp.side === side && !sp.used && S.t - sp.at < 6) {
            sp.used = true;
            const pln = S.plan;
            if (shotNext(next, side)) return 0.3;
            const d = Math.max(0.5, S.readyAt - S.t + 0.4);
            after(d, () => crossCleared(side, () => { if (pln) endPlan(pln); }));
            return d + 1.5;
          }
          { const own = planFor(ev); newScene(); if (own) endPlan(own); else suspendPlan(); }
          const f0 = live(byPid[ev.foulerId]);
          const ours = outfield(side).filter((p) => U(side, p.x) > 55);
          const victim = (B.holder && B.holder.side === side ? B.holder : null) || ours.sort((a, b) => hyp(a.x - B.x, a.y - B.y) - hyp(b.x - B.x, b.y - B.y))[0] || nearest(side, B.x, B.y);
          const fouler = f0 && f0.side !== side ? f0 : victim ? nearest(other(side), victim.x, victim.y) : null;
          setPhase('restart');
          const go = setPending('freekick', side, () => { freekickSetup(side, victim, pl); S.setpiece = { kind: 'freekick', side, at: S.t, used: true }; if (!shotNext(next, side)) after(S.readyAt - S.t + 0.4, () => crossCleared(side)); });
          const mine = S.pending;
          foulScene(fouler, victim, () => { if (S.pending === mine) go(); });
          return 2.1 + (shotNext(next, side) ? 0 : 2.3);
        }
        case 'penalty': {
          if (quietPhase() || ctx.fast) return 0;
          if (S.pending && S.pending.kind === 'penalty' && S.pending.side === side) runPending();
          const sp = S.setpiece;
          if (sp && sp.kind === 'penalty' && sp.side === side && !sp.used && S.t - sp.at < 6) { sp.used = true; return Math.max(0.3, S.readyAt - S.t); }
          { const own = planFor(ev); newScene(); if (own) endPlan(own); else suspendPlan(); }
          const f0 = live(byPid[ev.foulerId]);
          const victim = (B.holder && B.holder.side === side ? B.holder : null) || outfield(side).filter((p) => p.line === 'ATT').sort((a, b) => U(side, b.x) - U(side, a.x))[0] || nearest(side, B.x, B.y);
          const fouler = f0 && f0.side !== side ? f0 : victim ? nearest(other(side), victim.x, victim.y, null, true) : null;
          setPhase('restart');
          const go = setPending('penalty', side, () => { penaltySetup(side, pl); S.setpiece = { kind: 'penalty', side, at: S.t, used: true }; });
          const mine = S.pending;
          foulScene(fouler, victim, () => { show('PENALTI!', 'pen', 1500); after(0.4, () => { if (S.pending === mine) go(); }); });
          return 2.6;
        }
        case 'foul': {
          // the free kick or penalty that follows shows this foul
          if (next.some((n) => n.raw && (n.raw.type === 'freekick' || n.raw.type === 'penalty') && n.raw.side !== side)) return 0;
          if (ctx.fast || S.plan || S.phase !== 'play' || !pl) return 0;
          const victim = B.holder && B.holder.side !== side ? B.holder : nearest(other(side), pl.x, pl.y);
          if (!victim || hyp(victim.x - pl.x, victim.y - pl.y) > 16) return 0;
          newScene();
          setPhase('restart');
          foulScene(pl, victim, () => freeKickRestart(victim.side, victim.x, victim.y, `Faul: ${surname(pl.p)}`));
          return 1.5;
        }
        case 'yellow': case 'red': {
          if (pl) { ref.fx = pl.x; ref.fy = pl.y; ref.until = S.t + 1.6; }
          show(ev.type === 'yellow' ? `SARI KART · ${surname(pl && pl.p).toUpperCase()}` : `KIRMIZI KART! ${surname(pl && pl.p).toUpperCase()}`, ev.type, 1800);
          if (ev.type === 'red' && pl) {
            if (B.holder === pl) loose();
            const gone = () => { if (!pl.alive) return; pl.alive = false; if (B.holder === pl) loose(); pl.g.classList.add('gone'); setTimeout(() => pl.g.remove(), 900); };
            if (ctx.fast) gone();
            else { runTo(pl, pl.x, pl.y < H / 2 ? -2 : H + 2, 3); pl.lock = S.t + 9; keep(1.8, gone); }
          }
          return ctx.fast ? 0 : 0.8;
        }
        case 'injury':
          if (pl) { pl.down = S.t + 3; if (B.holder === pl) loose(); caption(`🚑 ${surname(pl.p)} yerde, sakatlandı`); }
          return 0.3;
        case 'counter': return 0; // played by the planned counter
        case 'sub': {
          const out = live(byPid[ev.out]);
          const inP = teams[side].players[ev.in];
          const outName = surname(out && out.p) || surname(teams[side].players[ev.out]);
          if (!ctx.fast) caption(`🔁 Değişiklik: ${surname(inP)} ⬆ · ${outName} ⬇`);
          if (out && inP) {
            const swap = () => {
              delete byPid[ev.out]; byPid[ev.in] = out; out.pid = ev.in; out.p = inP;
              out.top = topSpeed(out.code, inP);
              const url = photoUrl(inP);
              if (out.img && url) out.img.setAttribute('href', url); else if (out.ini) out.ini.textContent = initials(inP.name);
              out.g.classList.remove('subin'); void out.g.getBBox(); out.g.classList.add('subin');
              out.x = W / 2; out.y = 0; out.lock = 0;
            };
            if (B.holder === out) loose();
            if (ctx.fast) swap();
            else { runTo(out, W / 2, -1, 1.5); keep(1.3, swap); }
          }
          return 0.2;
        }
        case 'halftime': case 'fulltime': {
          newScene(); S.plans = []; S.plan = null; S.drive = null; S.setpiece = null; S.pending = null;
          setPhase('break'); S.highlight = null; S.attackSide = null;
          placeBall(W / 2, H / 2);
          show(ev.type === 'halftime' ? 'DEVRE ARASI' : 'MAÇ BİTTİ', 'set', 3000);
          if (ev.type === 'fulltime') S.stopAt = S.t + 3.5;
          return 0;
        }
        default: return 0;
      }
    },
    // kick-off (start of the match, second half)
    restart(side = 'away') { newScene(); S.plans = []; S.plan = null; S.pending = null; kickOff(side); },
    // the match is already over when the view opens: lineups in place, no movement
    finish() {
      newScene(); S.plans = []; S.plan = null; S.pending = null; setPhase('break'); S.highlight = null; loose();
      B.x = W / 2; B.y = H / 2; B.z = 0;
      for (const p of players) { const u = p.code === 'GK' ? 3.5 : Math.min(46, p.u0); p.x = p.tx = X(p.side, u); p.y = p.ty = Y(p.side, p.v0); p.vx = p.vy = 0; p.lock = 0; }
      S.stopAt = S.t + 0.05;
      banner.classList.remove('on'); cap.classList.remove('on');
    },
    // seconds until the build-up of this event's chance is ready (0: go ahead)
    readyIn(ev, next = [], tick = 0) {
      if (!ev || !PLANNABLE.has(ev.type)) return 0;
      const k = evKey(ev);
      const pl = S.plan && S.plan.keys && S.plan.keys.has(k) ? S.plan : null;
      if (pl) {
        if (pl.final) return 0;
        if (pl.kind === 'corner' || pl.kind === 'freekick' || pl.kind === 'penalty') {
          if (S.setpiece && S.setpiece.side === pl.side && S.t - S.setpiece.at < 8) return Math.max(0, S.readyAt - S.t - 0.4);
          return Math.max(0.2, pl.T - S.t);
        }
        // open play: the ball has to be with the attackers near where the chance is made
        if (B.flight) return 0.2;
        const h = B.holder;
        const need = pl.spec ? pl.spec.c.u - 10 : 58;
        if (h && h.side === pl.side && U(pl.side, h.x) >= need) return Math.max(0, pl.T - S.t - 0.2);
        return 0.3;
      }
      const q = S.plans.find((x) => x.keys.has(k));
      if (q) {
        if (S.phase === 'break') return 0;
        q.T = Math.max(q.T, S.t + minBuild(q)); q.pinned = true;
        return q.T - S.t;
      }
      // not announced (no time to see it coming): build it now if the game allows it
      const fromSet = !!(ev.setPiece || ev.penalty || ev.chance === 'corner' || ev.chance === 'freekick');
      const raw = !isShot(ev);
      if (fromSet || S.phase === 'setpiece' || S.phase === 'break' || (raw && S.phase === 'restart') || (S.plan && !S.plan.final)) return 0;
      const run = [ev];
      for (const x of next) { const e = x.mo ? x.mo.event : x.minor || x.raw; if (!e || !PLANNABLE.has(e.type)) continue; if (e.side !== ev.side) break; run.push(e); }
      const np = addPlan(run, S.t + minBuild({ kind: raw ? ev.type : ev.chance === 'counter' ? 'counter' : 'open' }), tick * 10 - 5);
      np.pinned = true;
      return np.T - S.t;
    },
    // after a silent catch-up: forget what was announced (the next ticks announce it again)
    resync() { S.plans = []; if (S.plan && !S.plan.final) endPlan(S.plan); },
    // the view is far behind: this event is not played, its plan is dropped
    skip(ev) {
      if (!ev || !ev.type) return;
      const k = evKey(ev);
      if (S.plan && S.plan.keys && S.plan.keys.has(k)) endPlan(S.plan);
      S.plans = S.plans.filter((q) => !q.keys.has(k));
    },
    // for tests: a snapshot of the state
    debug() { return { t: S.t, phase: S.phase, plan: S.plan && S.plan.kind, plans: S.plans.map((q) => [q.kind, +(q.T - S.t).toFixed(2)]), ball: { x: B.x, y: B.y, holder: B.holder && B.holder.pid, flight: !!B.flight } }; },
    destroy() { if (raf) cancelAnimationFrame(raf); raf = null; },
  };
  return api;
}
