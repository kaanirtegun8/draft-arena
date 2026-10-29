// Player "current level" and derived football abilities.
// Current level blends EA FC rating, real-life form and market value.
// Missing form / market value is neutral: that part falls back to the EA rating.
import { isGK, roleOf } from './positions.js';

export const LEVEL_WEIGHTS = { ea: 0.40, form: 0.35, mv: 0.25 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const WR = { H: 1, M: 0.66, L: 0.36 };

// ---------- market value model
// Market value is mapped to a level by rank: the pool's most valuable player maps
// to the pool's highest EA rating, the cheapest to the lowest (quantile matching).
// Older players lose value faster than quality, so they get a small capped bonus.
export function buildMarketModel(pool) {
  const vals = pool.filter((p) => p.mv && p.mv > 0).map((p) => Math.log10(p.mv)).sort((a, b) => a - b);
  const ovrs = pool.map((p) => p.ovr).sort((a, b) => a - b);
  if (vals.length < 30) return null;
  return { vals, ovrs, n: vals.length };
}

function quantile(sorted, q) {
  const i = q * (sorted.length - 1);
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export function mvLevel(p, model) {
  if (!model || !p.mv || p.mv <= 0) return null;
  const x = Math.log10(p.mv);
  const v = model.vals;
  let k = 0;
  while (k < v.length && v[k] < x) k++;
  // fractional rank (average position among equal values)
  let k2 = k;
  while (k2 < v.length && v[k2] === x) k2++;
  const q = clamp(((k + k2) / 2) / Math.max(1, v.length - 1), 0, 1);
  const ageAdj = p.age ? clamp((p.age - 29) * 0.4, 0, 2.5) : 0;
  return clamp(quantile(model.ovrs, q) + ageAdj, 45, 99);
}

// League strength: a 7.7 average in a weaker league is worth less than in the Premier League.
export const LEAGUE_COEF = {
  'Premier League': 1.0, LaLiga: 0.97, Bundesliga: 0.95, 'Serie A': 0.95, 'Ligue 1': 0.92,
  'Liga Portugal': 0.86, Eredivisie: 0.85, 'Belgian Pro League': 0.83, 'Trendyol Süper Lig': 0.82,
  'EFL Championship': 0.8, 'Liga Profesional (ARG)': 0.8, 'Super League Greece': 0.78, MLS: 0.76, 'Saudi Pro League': 0.75,
};
export function leagueCoef(p) { return LEAGUE_COEF[p.league] ?? 0.85; }

// ---------- real-life form (average match rating, e.g. FotMob)
export const FORM_BASELINE = { GK: 6.85, DEF: 6.85, MID: 6.95, ATT: 6.95 };
const LINE = { GK: 'GK', CB: 'DEF', RB: 'DEF', LB: 'DEF', CDM: 'MID', CM: 'MID', CAM: 'MID', LW: 'ATT', RW: 'ATT', ST: 'ATT' };

export function formRating(p, override) {
  const f = override || p.form;
  if (!f || typeof f.rating !== 'number' || !f.apps) return null;
  if (!Number.isFinite(f.rating)) return null;
  const last = Array.isArray(f.last) && f.last.length ? f.last.reduce((a, b) => a + b, 0) / f.last.length : f.rating;
  const r = 0.6 * f.rating + 0.4 * last;
  const w = f.apps / (f.apps + 3); // small samples count less
  return { r, w };
}

export function formLevel(p, override) {
  const fr = formRating(p, override);
  if (!fr) return null;
  const base = FORM_BASELINE[LINE[roleOf(p)]] || 6.9;
  const k = leagueCoef(p);
  const dev = (fr.r - base) * k - (1 - k) * 0.6; // weaker league: ratings count less and the bar is higher
  return clamp(p.ovr + fr.w * dev * 6.5, p.ovr - 8, p.ovr + 8);
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
  const wr = workRates(p);
  const wDef = wr.def;
  const wAtt = wr.att;
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

// Work rates. EA's ratings site does not publish them, so when they are missing
// they are estimated from stamina, aggression and defensive/attacking attributes.
export function workRates(p) {
  if (isGK(p)) return { def: 0.66, att: 0.36, estimated: !p.workDef };
  if (WR[p.workDef] != null && WR[p.workAtt] != null) return { def: WR[p.workDef], att: WR[p.workAtt], estimated: false };
  const a = p.a || {};
  const g = (k, fb) => (typeof a[k] === 'number' ? a[k] : fb);
  const defScore = 0.35 * g('sta', p.phy) + 0.25 * g('agg', p.phy) + 0.25 * g('int', p.def) + 0.15 * g('stt', p.def);
  const attScore = 0.4 * g('pos', p.sho) + 0.3 * g('sta', p.phy) + 0.3 * g('acc', p.pac);
  return {
    def: WR[p.workDef] ?? clamp((defScore - 40) / 40, 0.3, 1),
    att: WR[p.workAtt] ?? clamp((attScore - 40) / 40, 0.3, 1),
    estimated: true,
  };
}

export function workRateLabel(v) { return v >= 0.8 ? 'Yüksek' : v >= 0.5 ? 'Orta' : 'Düşük'; }

export function fmtValue(v) {
  if (!v) return '—';
  if (v >= 1e9) return `€${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `€${(v / 1e6).toFixed(v >= 1e8 ? 0 : 1)}M`;
  return `€${Math.round(v / 1e3)}K`;
}
