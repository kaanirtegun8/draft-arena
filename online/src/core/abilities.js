// Player "current level" and derived football abilities.
// Current level blends EA FC rating, real-life form and market value.
// Missing form / market value is neutral: that part falls back to the EA rating.
import { isGK, roleOf } from './positions.js';

export const LEVEL_WEIGHTS = { ea: 0.40, form: 0.35, mv: 0.25 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const WR = { H: 1, M: 0.66, L: 0.36 };

// ---------- market value model: OVR ~ b0 + b1*log10(value) + b2*age + b3*age^2, fit on the pool
export function buildMarketModel(pool) {
  const rows = pool.filter((p) => p.mv && p.mv > 0 && p.age);
  if (rows.length < 30) return null;
  // least squares with 4 features via normal equations
  const X = rows.map((p) => [1, Math.log10(p.mv), p.age, p.age * p.age]);
  const y = rows.map((p) => p.ovr);
  const n = 4;
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let r = 0; r < n; r++) {
      b[r] += X[i][r] * y[i];
      for (let c = 0; c < n; c++) A[r][c] += X[i][r] * X[i][c];
    }
  }
  const coef = solve(A, b);
  if (!coef || coef.some((v) => !Number.isFinite(v))) return null;
  return { coef, n: rows.length };
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export function mvLevel(p, model) {
  if (!model || !p.mv || p.mv <= 0 || !p.age) return null;
  const [b0, b1, b2, b3] = model.coef;
  return clamp(b0 + b1 * Math.log10(p.mv) + b2 * p.age + b3 * p.age * p.age, 45, 99);
}

// ---------- real-life form (average match rating, e.g. FotMob)
export const FORM_BASELINE = { GK: 6.85, DEF: 6.85, MID: 6.95, ATT: 6.95 };
const LINE = { GK: 'GK', CB: 'DEF', RB: 'DEF', LB: 'DEF', CDM: 'MID', CM: 'MID', CAM: 'MID', LW: 'ATT', RW: 'ATT', ST: 'ATT' };

export function formRating(p, override) {
  const f = override || p.form;
  if (!f || typeof f.rating !== 'number' || !f.apps) return null;
  const last = Array.isArray(f.last) && f.last.length ? f.last.reduce((a, b) => a + b, 0) / f.last.length : f.rating;
  const r = 0.6 * f.rating + 0.4 * last;
  const w = f.apps / (f.apps + 3); // small samples count less
  return { r, w };
}

export function formLevel(p, override) {
  const fr = formRating(p, override);
  if (!fr) return null;
  const base = FORM_BASELINE[LINE[roleOf(p)]] || 6.9;
  return clamp(p.ovr + fr.w * (fr.r - base) * 8, p.ovr - 10, p.ovr + 10);
}

// Breakdown used by the engine and shown in the UI.
export function currentLevel(p, model, formOverride) {
  const fl = formLevel(p, formOverride);
  const ml = mvLevel(p, model);
  const parts = {
    ea: p.ovr,
    form: fl == null ? p.ovr : fl,
    mv: ml == null ? p.ovr : ml,
  };
  const level = LEVEL_WEIGHTS.ea * parts.ea + LEVEL_WEIGHTS.form * parts.form + LEVEL_WEIGHTS.mv * parts.mv;
  return { level: Math.round(level * 10) / 10, parts, hasForm: fl != null, hasMv: ml != null };
}

// ---------- attributes (detailed when available, otherwise estimated from face stats)
function attrs(p) {
  const a = p.a || {};
  const g = (k, fb) => (typeof a[k] === 'number' ? a[k] : fb);
  if (isGK(p)) {
    return {
      gkdiv: g('gkdiv', p.div), gkhan: g('gkhan', p.han), gkkic: g('gkkic', p.kic), gkref: g('gkref', p.ref), gkpos: g('gkpos', p.gkp),
      acc: g('acc', p.spd || 50), spr: g('spr', p.spd || 50), spa: g('spa', 50), lpa: g('lpa', p.kic || 50), com: g('com', 60), rea: g('rea', p.ref || 60),
      sta: g('sta', 60), str: g('str', 70), hea: g('hea', 20), jmp: g('jmp', 70), daw: g('daw', 20), stt: g('stt', 15), int: g('int', 20), agg: g('agg', 35),
      fin: 15, pos: 15, vis: 45, cro: 15, dri: 15, bco: 30, agi: 50, bal: 50, spw: 40, lsh: 15, slt: 15,
    };
  }
  return {
    acc: g('acc', p.pac), spr: g('spr', p.pac), fin: g('fin', p.sho), pos: g('pos', p.sho), spw: g('spw', p.sho), lsh: g('lsh', p.sho - 4),
    vis: g('vis', p.pas), cro: g('cro', p.pas - 3), spa: g('spa', p.pas + 2), lpa: g('lpa', p.pas - 2),
    agi: g('agi', p.dri), bal: g('bal', p.dri - 3), rea: g('rea', Math.round((p.ovr + p.dri) / 2)), bco: g('bco', p.dri + 1), dri: g('dri', p.dri), com: g('com', p.ovr - 2),
    int: g('int', p.def), hea: g('hea', Math.round((p.def + p.phy) / 2)), daw: g('daw', p.def), stt: g('stt', p.def), slt: g('slt', p.def - 2),
    jmp: g('jmp', p.phy), sta: g('sta', p.phy), str: g('str', p.phy), agg: g('agg', Math.round((p.def + p.phy) / 2)),
    gkdiv: 10, gkhan: 10, gkkic: 10, gkref: 10, gkpos: 10,
  };
}

// Football abilities (0-100). These drive the zone model in the engine.
const AB_CACHE = new WeakMap();
export function abilities(p) {
  let c = AB_CACHE.get(p);
  if (!c) { c = computeAbilities(p); AB_CACHE.set(p, c); }
  return c;
}

function computeAbilities(p) {
  const t = attrs(p);
  const heightBonus = p.height ? clamp((p.height - 180) * 0.6, -8, 8) : 0;
  const wDef = WR[p.workDef] ?? 0.66;
  const wAtt = WR[p.workAtt] ?? 0.66;
  return {
    pace: 0.45 * t.acc + 0.55 * t.spr,
    finishing: 0.45 * t.fin + 0.15 * t.com + 0.15 * t.pos + 0.15 * t.spw + 0.1 * t.rea,
    longShot: 0.6 * t.lsh + 0.25 * t.spw + 0.15 * t.com,
    aerialAtt: clamp(0.5 * t.hea + 0.25 * t.jmp + 0.15 * t.str + 0.1 * t.pos + heightBonus, 1, 99),
    aerialDef: clamp(0.35 * t.hea + 0.25 * t.jmp + 0.25 * t.str + 0.15 * t.daw + heightBonus, 1, 99),
    creation: 0.35 * t.vis + 0.25 * t.spa + 0.15 * t.lpa + 0.1 * t.cro + 0.15 * t.bco,
    crossing: 0.6 * t.cro + 0.2 * (p.a && p.a.cur != null ? p.a.cur : t.cro) + 0.2 * t.vis,
    dribbling: 0.4 * t.dri + 0.2 * t.agi + 0.1 * t.bal + 0.2 * t.bco + 0.1 * t.acc,
    passing: 0.4 * t.spa + 0.2 * t.lpa + 0.2 * t.vis + 0.2 * t.com,
    defending: 0.35 * t.daw + 0.3 * t.stt + 0.2 * t.int + 0.15 * t.slt,
    pressing: 0.35 * t.sta + 0.2 * t.agg + 0.3 * (wDef * 100) + 0.15 * t.acc,
    stamina: t.sta,
    strength: t.str,
    aggression: t.agg,
    composure: t.com,
    workDef: wDef,
    workAtt: wAtt,
    keeping: isGK(p) ? 0.2 * t.gkdiv + 0.2 * t.gkhan + 0.2 * t.gkpos + 0.3 * t.gkref + 0.1 * t.gkkic : 20,
    sweeping: isGK(p) ? 0.5 * t.gkpos + 0.3 * t.acc + 0.2 * t.rea : 20,
  };
}

export function fmtValue(v) {
  if (!v) return '—';
  if (v >= 1e6) return `€${(v / 1e6).toFixed(v >= 1e8 ? 0 : 1)}M`;
  return `€${Math.round(v / 1e3)}K`;
}
