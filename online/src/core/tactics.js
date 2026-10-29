// Tactical model: turns an XI + instructions into zone strengths
// (left / centre / right attack and defence, midfield control, pressing)
// and explains structural strengths & weaknesses in plain Turkish.
import { formationSlots, positionFit, roleOf, isGK } from './positions.js';
import { abilities } from './abilities.js';

export const INSTRUCTIONS = {
  mentality: { label: 'Oyun anlayışı', options: { defensive: 'Savunmacı', balanced: 'Dengeli', attacking: 'Hücumcu' }, def: 'balanced' },
  press: { label: 'Pres', options: { low: 'Geride bekle', mid: 'Orta', high: 'Önde pres' }, def: 'mid' },
  line: { label: 'Savunma hattı', options: { low: 'Derin', mid: 'Orta', high: 'Yüksek' }, def: 'mid' },
  fullbacks: { label: 'Bekler', options: { stay: 'Geride kalsın', balanced: 'Dengeli', attack: 'Hücuma çıksın' }, def: 'balanced' },
  width: { label: 'Genişlik', options: { narrow: 'Dar', normal: 'Normal', wide: 'Geniş' }, def: 'normal' },
  strikers: { label: 'Çift forvette', options: { both: 'İkisi de önde', oneDrops: 'Biri orta sahaya yardım etsin' }, def: 'both' },
};

export function defaultInstructions() {
  const o = {};
  for (const [k, v] of Object.entries(INSTRUCTIONS)) o[k] = v.def;
  return o;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const FB = { stay: { def: 1.0, att: 0.15 }, balanced: { def: 0.92, att: 0.45 }, attack: { def: 0.8, att: 0.8 } };
const PRESS = { low: 0.75, mid: 1.0, high: 1.3 };
const SIDES = ['L', 'C', 'R'];

// Effective abilities for one player in one slot.
// level: current level (EA+form+value); cond: 0-100; day: per-match randomness (~±5%)
export function effective(p, slotCode, { level, cond = 100, day = 1 }) {
  const ab = abilities(p);
  const delta = (level ?? p.ovr) - p.ovr;
  const fit = positionFit(slotCode, p);
  const mult = (0.55 + 0.45 * fit) * (0.8 + 0.2 * clamp(cond, 0, 100) / 100) * day;
  const out = {};
  for (const [k, v] of Object.entries(ab)) {
    if (k === 'workDef' || k === 'workAtt') out[k] = v;
    else out[k] = clamp((v + delta) * mult, 1, 110);
  }
  out.fit = fit;
  return out;
}

// Contribution of one player to the team units.
function contribute(u, slot, e, ins, isDropper) {
  const side = slot.side;
  const fb = FB[ins.fullbacks] || FB.balanced;
  const add = (k, z, v) => { u[k][z] += v; };
  switch (slot.code) {
    case 'GK':
      u.keeping = e.keeping; u.sweeping = e.sweeping;
      add('def', 'C', e.sweeping * 0.15);
      u.control += e.passing * 0.08;
      break;
    case 'CB': {
      const v = e.defending * 1.0 + e.aerialDef * 0.3 + e.pace * 0.2;
      add('def', 'C', v * (side === 'C' ? 1.0 : 0.8));
      if (side !== 'C') add('def', side, v * 0.25);
      u.control += e.passing * 0.12;
      u.cbPace.push(e.pace); u.cbAerial.push(e.aerialDef);
      break;
    }
    case 'RB': case 'LB': case 'RWB': case 'LWB': {
      const wb = slot.code.endsWith('WB');
      const defW = (wb ? 0.85 : 1.0) * fb.def;
      const attW = (wb ? Math.max(0.6, fb.att) : fb.att) * (0.6 + 0.4 * e.workAtt);
      add('def', side, (e.defending * 0.8 + e.pace * 0.3 + e.aerialDef * 0.1) * defW);
      add('def', 'C', e.defending * 0.12 * defW);
      add('att', side, (e.crossing * 0.5 + e.pace * 0.3 + e.dribbling * 0.2) * attW);
      u.control += e.passing * 0.2;
      u.press += e.pressing * 0.25;
      u.fbAttack[side] = attW;
      break;
    }
    case 'CDM':
      add('def', 'C', (e.defending * 0.6 + e.aerialDef * 0.15 + e.pressing * 0.25) * 0.95);
      if (side !== 'C') add('def', side, e.defending * 0.2);
      u.control += e.passing * 0.75 + e.defending * 0.2;
      add('att', 'C', e.creation * 0.15);
      u.press += e.pressing * 0.3;
      u.central += 1; u.core += 1; u.anchors += e.defending >= 68 ? 1 : 0.5;
      break;
    case 'CM':
      u.control += e.passing * 0.65 + e.creation * 0.2 + e.pressing * 0.15;
      add('def', 'C', e.defending * 0.45 * (0.5 + 0.5 * e.workDef));
      add('def', side === 'C' ? 'C' : side, e.defending * 0.2 * e.workDef);
      add('att', 'C', (e.creation * 0.5 + e.finishing * 0.2 + e.longShot * 0.3) * 0.45 * (0.5 + 0.5 * e.workAtt));
      u.press += e.pressing * 0.6;
      u.central += 1; u.core += 1;
      if (e.defending >= 72 && e.workDef >= 0.66) u.anchors += 0.6;
      break;
    case 'CAM':
      add('att', 'C', e.creation * 0.6 + e.dribbling * 0.25 + e.finishing * 0.15);
      u.control += e.passing * 0.55;
      add('def', 'C', e.defending * 0.1 * e.workDef);
      u.press += e.pressing * 0.6;
      u.central += 1; u.core += 1;
      break;
    case 'LM': case 'RM':
      add('att', side, (e.crossing * 0.35 + e.dribbling * 0.3 + e.pace * 0.25 + e.creation * 0.1) * 0.85);
      add('def', side, e.defending * 0.55 * e.workDef + e.pressing * 0.1);
      u.control += e.passing * 0.35;
      u.press += e.pressing * 0.6;
      u.central += 0.3;
      u.wideDefWork[side] = e.workDef;
      break;
    case 'LW': case 'RW': {
      const inverted = (slot.code === 'LW' && p0(e) === 'R') || (slot.code === 'RW' && p0(e) === 'L');
      add('att', side, e.dribbling * 0.35 + e.pace * 0.3 + e.crossing * 0.15 + e.finishing * 0.2);
      add('att', 'C', e.finishing * (inverted ? 0.3 : 0.18));
      add('def', side, e.defending * 0.35 * e.workDef);
      u.control += e.passing * 0.2;
      u.press += e.pressing * 1.0;
      u.wideDefWork[side] = e.workDef;
      break;
    }
    case 'ST': case 'CF': {
      const cf = slot.code === 'CF' || isDropper;
      add('att', 'C', e.finishing * 0.55 + e.pace * 0.15 + e.aerialAtt * 0.15 + e.dribbling * 0.15);
      if (side !== 'C') add('att', side, e.finishing * 0.12);
      u.control += e.passing * (cf ? 0.45 : 0.12);
      if (cf) { u.central += 0.6; add('def', 'C', e.defending * 0.08); }
      u.press += e.pressing * 1.0;
      u.strikers.push({ workDef: e.workDef, dropper: !!isDropper });
      u.fwdPace.push(e.pace); u.fwdAerial.push(e.aerialAtt);
      break;
    }
    default:
      u.control += e.passing * 0.3;
  }
}
function p0(e) { return e._foot; }

// Reference normalisers: a balanced 4-3-3 of 75-rated players gives ~75 everywhere.
let NORM = null;
function norms() {
  if (NORM) return NORM;
  const fake = (code) => ({ code, side: 'C' });
  const e = { pace: 75, finishing: 75, longShot: 75, aerialAtt: 75, aerialDef: 75, creation: 75, crossing: 75, dribbling: 75, passing: 75, defending: 75, pressing: 75, stamina: 75, strength: 75, aggression: 75, composure: 75, workDef: 0.66, workAtt: 0.66, keeping: 75, sweeping: 75, _foot: 'R' };
  const u = emptyUnits();
  for (const s of formationSlots('4-3-3')) contribute(u, s, e, defaultInstructions(), false);
  NORM = {
    def: { L: u.def.L / 75, C: u.def.C / 75, R: u.def.R / 75 },
    att: { L: u.att.L / 75, C: u.att.C / 75, R: u.att.R / 75 },
    control: u.control / 75, press: u.press / 75,
  };
  void fake;
  return NORM;
}

function emptyUnits() {
  return {
    def: { L: 0, C: 0, R: 0 }, att: { L: 0, C: 0, R: 0 }, control: 0, press: 0, keeping: 30, sweeping: 30,
    central: 0, core: 0, anchors: 0, strikers: [], cbPace: [], cbAerial: [], fwdPace: [], fwdAerial: [],
    fbAttack: { L: 0, R: 0 }, wideDefWork: { L: null, R: null },
  };
}

/**
 * Compute raw (pre-matchup) unit strengths for a team.
 * onPitch: [{ slot:{code,side}, player, level, cond, day }]
 */
export function teamUnits(onPitch, ins) {
  const u = emptyUnits();
  const sts = onPitch.filter((o) => o.slot.code === 'ST');
  let dropperId = null;
  if (ins.strikers === 'oneDrops' && sts.length >= 2) {
    const best = sts.slice().sort((a, b) => abilities(b.player).passing - abilities(a.player).passing)[0];
    dropperId = best.player.id;
  }
  for (const o of onPitch) {
    const e = effective(o.player, o.slot.code, o);
    e._foot = o.player.foot;
    contribute(u, o.slot, e, ins, o.player.id === dropperId);
  }
  const n = norms();
  for (const z of SIDES) { u.def[z] /= n.def[z]; u.att[z] /= n.att[z]; }
  u.control /= n.control; u.press = (u.press / n.press) * (PRESS[ins.press] || 1);
  // fewer than 11 players: everything suffers a bit more than linearly
  const men = onPitch.length;
  if (men < 11) {
    const f = Math.pow(men / 11, 0.6);
    for (const z of SIDES) { u.def[z] *= f; u.att[z] *= f; }
    u.control *= f;
  }
  return u;
}

// Structural analysis between two teams. Returns modified units and readable notes.
export function analyse(uA, uB, insA, insB) {
  const notes = [];
  const def = { ...uA.def }, att = { ...uA.att };
  let control = uA.control;
  const add = (kind, text) => notes.push({ kind, text });

  // midfield numbers
  const diff = uA.central - uB.central;
  if (Math.abs(diff) >= 0.5) {
    control *= 1 + clamp(diff, -2, 2) * 0.05;
    add(diff > 0 ? 'good' : 'warn', diff > 0 ? `Orta sahada sayısal üstünlük (+${diff.toFixed(1)} oyuncu): topa daha çok sahip olunur.` : `Orta sahada sayıca geridesin (${diff.toFixed(1)}): rakip topu daha çok tutar.`);
  }
  // defensive anchor
  if (uA.anchors < 0.6) {
    def.C *= 0.86;
    add('warn', 'Ön libero / savunmacı orta saha yok: stoperlerin önü açık, merkezden çok pozisyon verilir.');
  } else if (uA.core <= 2 && uA.anchors < 1) {
    def.C *= 0.93; control *= 0.96;
    add('warn', 'Merkezde sadece iki orta saha var ve biri gerçek ön libero değil: orta saha kolay aşılır.');
  } else if (uA.anchors >= 1.5) {
    def.C *= 1.04;
    add('good', 'Merkez savunmanın önü iyi korunuyor (güçlü ön libero / çift pivot).');
  }
  // flanks: wingers' defensive work + attacking full-backs
  for (const z of ['L', 'R']) {
    const side = z === 'L' ? 'Sol' : 'Sağ';
    const w = uA.wideDefWork[z];
    if (w != null && w < 0.5) {
      def[z] *= 0.88;
      add('warn', `${side} kanat oyuncusu savunmaya yardım etmiyor: ${side.toLowerCase()} kanattan çok atak yenebilir.`);
      if (uA.fbAttack[z] >= 0.7) { def[z] *= 0.92; add('warn', `${side} bek de hücuma çıkıyor: o kanat kontra ataklarda tamamen boş kalabilir.`); }
    }
    if (w == null && uA.fbAttack[z] < 0.3 && att[z] < 45) {
      add('warn', `${side} kanatta hücum genişliği yok: oyun merkeze sıkışır.`);
    }
  }
  // two strikers who do not track back
  const st = uA.strikers;
  if (st.length >= 2 && !st.some((s) => s.dropper)) {
    const lazy = st.filter((s) => s.workDef < 0.5).length;
    if (lazy >= 2) { control *= 0.94; add('warn', 'İki forvet de savunmaya katılmıyor: orta saha sayıca zayıf kalır, rakip rahat oyun kurar.'); }
    else add('info', 'Çift forvet: ceza sahasında daha çok oyuncu ama orta saha bir kişi eksik.');
  }
  if (st.some((s) => s.dropper)) add('good', 'Forvetlerden biri orta sahaya geliyor: merkez daha kalabalık, hücum biraz azalır.');
  // mentality / width
  const m = insA.mentality;
  if (m === 'attacking') { for (const z of SIDES) { att[z] *= 1.08; def[z] *= 0.94; } }
  if (m === 'defensive') { for (const z of SIDES) { att[z] *= 0.9; def[z] *= 1.08; } }
  if (insA.width === 'wide') { att.L *= 1.06; att.R *= 1.06; att.C *= 0.96; }
  if (insA.width === 'narrow') { att.L *= 0.94; att.R *= 0.94; att.C *= 1.05; def.L *= 0.95; def.R *= 0.95; def.C *= 1.04; }
  if (insA.press === 'high') control *= 1.04;
  if (insA.line === 'high') control *= 1.02;
  if (insA.line === 'low') control *= 0.97;

  // counter-attack exposure: opponent forward pace vs our centre-back pace, line height, full-backs
  const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 70);
  const paceGap = avg(uB.fwdPace) - avg(uA.cbPace);
  const lineF = { low: 0.75, mid: 1.0, high: 1.35 }[insA.line] || 1;
  const fbF = 1 + 0.25 * (uA.fbAttack.L + uA.fbAttack.R) / 2;
  // a ~15 point gap between forwards and centre-backs is normal in football
  const counterExposure = clamp((1 + (paceGap - 15) / 25) * lineF * fbF * (m === 'attacking' ? 1.1 : m === 'defensive' ? 0.85 : 1), 0.4, 2.2);
  if (paceGap > 18 && insA.line === 'high') add('warn', 'Rakip forvetler stoperlerden çok hızlı ve savunma hattı yüksek: arkaya atılan toplar tehlikeli.');
  else if (paceGap > 25) add('warn', 'Stoperler rakip forvetlere göre yavaş: kontra ataklara dikkat.');
  // aerial
  const aerialGap = avg(uB.fwdAerial) - avg(uA.cbAerial);
  if (aerialGap > 10) add('warn', 'Rakip forvetler hava toplarında stoperlerden üstün: ortalar ve duran toplar tehlikeli.');

  return { def, att, control, press: uA.press, keeping: uA.keeping, counterExposure, aerialGap, notes };
}
