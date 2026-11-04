// Tactical model: turns an XI + instructions into zone strengths
// (left / centre / right attack and defence, midfield control, pressing)
// and explains structural strengths & weaknesses in plain Turkish.
import { formationSlots, positionFit, roleOf, isGK } from './positions.js';
import { abilities } from './abilities.js';
import { ROLES, roleFit, scaledMod } from './roles.js';
import { applyPlan, STYLE_INFO, styleStrength } from './styles.js';

export const INSTRUCTIONS = {
  mentality: { label: 'Oyun anlayışı', options: { defensive: 'Savunmacı', balanced: 'Dengeli', attacking: 'Hücumcu' }, def: 'balanced' },
  press: { label: 'Pres', options: { low: 'Geride bekle', mid: 'Orta', high: 'Önde pres' }, def: 'mid' },
  line: { label: 'Savunma hattı', options: { low: 'Derin', mid: 'Orta', high: 'Yüksek' }, def: 'mid' },
  fullbacks: { label: 'Bekler', options: { stay: 'Geride kalsın', balanced: 'Dengeli', attack: 'Hücuma çıksın' }, def: 'balanced' },
  width: { label: 'Genişlik', options: { narrow: 'Dar', normal: 'Normal', wide: 'Geniş' }, def: 'normal' },
  style: { label: 'Oyun tarzı', options: Object.fromEntries(Object.entries(STYLE_INFO).map(([k, v]) => [k, v.label])), def: 'balanced' },
  focus: { label: 'Hücum yönü', options: { mixed: 'Karışık', left: 'Sol kanat ağırlıklı', centre: 'Merkez ağırlıklı', right: 'Sağ kanat ağırlıklı', weak: 'Rakibin zayıf kanadı' }, def: 'mixed' },
  tempo: { label: 'Tempo', options: { low: 'Yavaş (oyunu soğut)', normal: 'Normal', high: 'Yüksek (oyunu aç)' }, def: 'normal' },
  setPieces: { label: 'Duran toplar', options: { normal: 'Normal', focus: 'Duran top ağırlıklı' }, def: 'normal' },
  trap: { label: 'Ofsayt taktiği', options: { off: 'Yok', on: 'Var' }, def: 'off' },
  strikers: { label: 'Çift forvette', options: { both: 'İkisi de önde', oneDrops: 'Biri orta sahaya yardım etsin' }, def: 'both' },
};
// short help shown under each instruction in the tactics screen
export const INSTRUCTION_HELP = {
  focus: 'Seçtiğin bölgeye daha çok atak yaparsın (+%10), diğer bölgeler biraz zayıflar. Yıldız kanatçın varsa onun tarafını seç; rakibin zayıf kanadı otomatik bulunur.',
  tempo: 'Yüksek tempo: daha çok pozisyon, ama maç iki tarafa da açılır ve oyuncular daha çok yorulur. Yavaş tempo: öndeyken veya yorgunken maçı soğutur.',
  setPieces: 'Daha çok korner / frikik kazanırsın; kafası iyi uzun oyuncuların varsa gol olur, yoksa açık oyundan pozisyon kaybedersin.',
  trap: 'Savunma hattı birlikte öne çıkıp forveti ofsayta düşürür. Hızlı ve dikkatli savunmacılarla kontraları keser; yavaş savunmayla çok riskli.',
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
  const mult = (0.55 + 0.45 * fit) * (0.62 + 0.38 * clamp(cond, 0, 100) / 100) * day;
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
      const attW = (wb ? Math.max(0.95, fb.att) : fb.att) * (0.6 + 0.4 * e.workAtt);
      add('def', side, (e.defending * 0.8 + e.pace * 0.3 + e.aerialDef * 0.1) * defW);
      add('def', 'C', e.defending * 0.12 * defW);
      add('att', side, (e.crossing * 0.5 + e.pace * 0.3 + e.dribbling * 0.2) * attW);
      u.control += e.passing * 0.2;
      u.press += e.pressing * 0.25;
      u.fbAttack[side] = attW;
      if (wb) u.wideCover[side] = true;
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
    case 'CAM': {
      // a pair of 10s (4-2-2-2, 4-3-2-1, 3-4-2-1) sits in the half-spaces: less midfield, a bit of flank
      const half = side !== 'C';
      const v = e.creation * 0.6 + e.dribbling * 0.25 + e.finishing * 0.15;
      add('att', 'C', v * (half ? 0.9 : 1));
      if (half) add('att', side, v * 0.1);
      u.control += e.passing * (half ? 0.52 : 0.55);
      add('def', 'C', e.defending * 0.1 * e.workDef);
      u.press += e.pressing * 0.6;
      u.central += half ? 0.9 : 1; u.core += half ? 0.9 : 1;
      break;
    }
    case 'LM': case 'RM':
      add('att', side, (e.crossing * 0.35 + e.dribbling * 0.3 + e.pace * 0.25 + e.creation * 0.1) * 0.97);
      add('def', side, e.defending * 0.55 * e.workDef + e.pressing * 0.1);
      add('def', 'C', e.defending * 0.3 * e.workDef); // wide midfielders tuck in: two banks of four
      u.control += e.passing * 0.35;
      u.press += e.pressing * 0.6;
      u.central += 0.3; u.wideMids += 1;
      u.wideDefWork[side] = e.workDef;
      break;
    case 'LW': case 'RW': {
      const inverted = (slot.code === 'LW' && p0(e) === 'R') || (slot.code === 'RW' && p0(e) === 'L');
      add('att', side, e.dribbling * 0.35 + e.pace * 0.3 + e.crossing * 0.15 + e.finishing * 0.2);
      add('att', 'C', e.finishing * (inverted ? 0.3 : 0.18));
      add('def', side, e.defending * 0.35 * e.workDef);
      u.control += e.passing * 0.3;
      u.press += e.pressing * 1.0;
      u.wideDefWork[side] = e.workDef;
      break;
    }
    case 'ST': case 'CF': {
      const cf = slot.code === 'CF' || isDropper;
      add('att', 'C', e.finishing * 0.55 + e.pace * 0.15 + e.aerialAtt * 0.15 + e.dribbling * 0.15);
      if (side !== 'C') add('att', side, e.finishing * 0.12);
      u.control += e.passing * (cf ? 0.35 : 0.18);
      if (slot.code === 'CF') add('att', 'C', e.creation * 0.15);
      if (cf) { u.central += slot.code === 'CF' ? 0.7 : 0.5; add('def', 'C', e.defending * (slot.code === 'CF' ? 0.14 : 0.08)); }
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
  const parts = formationSlots('4-3-3').map((sl) => { const t = emptyUnits(); contribute(t, sl, e, defaultInstructions(), false); return t; });
  const u = combine(parts);
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
    central: 0, core: 0, anchors: 0, wideMids: 0, strikers: [], cbPace: [], cbAerial: [], fwdPace: [], fwdAerial: [],
    fbAttack: { L: 0, R: 0 }, wideDefWork: { L: null, R: null },
    mix: { cross: 0, cutback: 0, wide: 0, through: 0, combo: 0, long: 0 }, exposureAdd: 0, oppControl: 0, roles: [], shifts: [], wideCover: { L: false, R: false }, teamDef: 1,
  };
}

function applyRole(t, slot, role, fit, e) {
  const m = role.mods || {};
  const side = slot.side;
  for (const z of SIDES) {
    const isC = z === 'C';
    t.att[z] *= scaledMod(isC ? m.attC : m.attSide, fit);
    t.def[z] *= scaledMod(isC ? m.defC : m.defSide, fit);
  }
  t.control *= scaledMod(m.control, fit);
  t.press *= scaledMod(m.press, fit);
  if (role.sideAtt && side !== 'C') t.att[side] += e.creation * role.sideAtt * (0.4 + 0.8 * fit);
  if (role.centralAtt) t.att.C += e.creation * role.centralAtt * (0.4 + 0.8 * fit);
  const a = role.add || {};
  const s = 0.4 + 0.8 * fit;
  if (a.central) t.central += a.central;
  if (a.anchors) t.anchors += a.anchors * Math.min(1, s);
  if (a.exposure) t.exposureAdd += a.exposure < 0 ? a.exposure * Math.min(1, s) : a.exposure;
  if (a.oppControl) t.oppControl += a.oppControl * Math.min(1.2, s);
  for (const [k, v] of Object.entries(role.mix || {})) t.mix[k] += v > 0 ? v * Math.min(1.2, s) : v;
  // a player who cannot play the role is worse at everything; one made for it is a bit better
  if (fit < 0.35) {
    for (const z of SIDES) { t.att[z] *= 0.93; t.def[z] *= 0.93; }
    t.control *= 0.93;
  } else if (fit >= 0.75) {
    for (const z of SIDES) { t.att[z] *= 1.03; t.def[z] *= 1.03; }
    t.control *= 1.03;
  }
  if (role.work && side !== 'C' && t.wideDefWork[side] != null) t.wideDefWork[side] = Math.max(t.wideDefWork[side], role.work);
  if (role.teamDef) t.teamDef *= role.teamDef;
}

// Manual nudge: a player moved one notch left or right takes part of his attacking
// and defensive work into the neighbouring zone. Overloading the zone where the
// opponent is weak pays off; the zone he leaves gets thinner.
export const SHIFT_SHARE = 0.6;
export const SHIFT_COST = { gap: 0.93, control: 0.975 };
export function shiftTarget(slot, shift) {
  if (!shift || slot.code === 'GK') return null;
  if (slot.side === 'C') return { from: 'C', to: shift < 0 ? 'L' : 'R' };
  if ((slot.side === 'L' && shift > 0) || (slot.side === 'R' && shift < 0)) return { from: slot.side, to: 'C' };
  return { from: 'C', to: slot.side, wider: true };
}
function applyShift(t, slot, shift, name) {
  const tg = shiftTarget(slot, shift);
  if (!tg) return;
  for (const k of ['att', 'def']) {
    const share = tg.wider ? 0.7 : SHIFT_SHARE;
    const mv = t[k][tg.from] * share;
    t[k][tg.from] -= mv;
    t[k][tg.to] += mv;
  }
  if (tg.wider) t.mix.cross += 0.03;
  if (tg.to === 'C' && slot.side !== 'C') t.mix.cutback += 0.03;
  t.shifts.push({ name, code: slot.code, from: tg.from, to: tg.to });
}

// Diminishing returns: the best contributor in a zone counts fully, each extra
// player a bit less (space gets crowded and the opponent packs that zone too).
const DIM_ATT = [1, 0.58, 0.32, 0.17, 0.09, 0.05, 0.03, 0.02, 0.02, 0.02, 0.02];
const DIM_ZONE = [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.52, 0.45, 0.4, 0.35, 0.3];
const DIM_CONTROL = [1, 0.93, 0.86, 0.8, 0.74, 0.68, 0.62, 0.57, 0.52, 0.48, 0.45];
function dimSum(values, w) {
  return values.slice().sort((a, b) => b - a).reduce((acc, v, i) => acc + v * (w[i] ?? w[w.length - 1]), 0);
}
function combine(parts) {
  const u = emptyUnits();
  for (const t of parts) mergeUnits(u, t);
  for (const z of SIDES) {
    u.att[z] = dimSum(parts.map((t) => t.att[z]), DIM_ATT);
    u.def[z] = dimSum(parts.map((t) => t.def[z]), DIM_ZONE);
  }
  u.control = dimSum(parts.map((t) => t.control), DIM_CONTROL);
  return u;
}

function mergeUnits(u, t) {
  for (const z of SIDES) { u.att[z] += t.att[z]; u.def[z] += t.def[z]; }
  for (const k of ['control', 'press', 'central', 'core', 'anchors', 'wideMids', 'exposureAdd', 'oppControl']) u[k] += t[k];
  for (const k of Object.keys(u.mix)) u.mix[k] += t.mix[k];
  for (const k of ['strikers', 'cbPace', 'cbAerial', 'fwdPace', 'fwdAerial', 'shifts']) u[k].push(...t[k]);
  u.teamDef *= t.teamDef;
  for (const z of ['L', 'R']) {
    if (t.wideCover[z]) u.wideCover[z] = true;
    if (t.fbAttack[z]) u.fbAttack[z] = Math.max(u.fbAttack[z], t.fbAttack[z]);
    if (t.wideDefWork[z] != null) u.wideDefWork[z] = u.wideDefWork[z] == null ? t.wideDefWork[z] : Math.min(u.wideDefWork[z], t.wideDefWork[z]);
  }
  if (t.keeping !== 30 || t.sweeping !== 30) { u.keeping = t.keeping; u.sweeping = t.sweeping; }
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
  const parts = [];
  const roles = [];
  const men = [];
  for (const o of onPitch) {
    const e = effective(o.player, o.slot.code, o);
    e._foot = o.player.foot;
    const role = o.slot.role && ROLES[o.slot.role] ? ROLES[o.slot.role] : null;
    const fit = role ? roleFit(o.slot.role, abilities(o.player)) : 0.6;
    men.push({ code: o.slot.code, side: o.slot.side, role: role ? o.slot.role : null, fit, e, name: o.player.name });
    if (role && role.work) e.workDef = Math.max(e.workDef, role.work);
    const t = emptyUnits();
    contribute(t, o.slot, e, ins, o.player.id === dropperId);
    if (role) applyRole(t, o.slot, role, fit, e);
    if (o.slot.shift) applyShift(t, o.slot, o.slot.shift, o.player.name);
    parts.push(t);
    if (role) roles.push({ key: o.slot.role, fit, code: o.slot.code, side: o.slot.side, name: o.player.name });
  }
  const combined = combine(parts);
  Object.assign(u, combined);
  u.roles = roles;
  u.men = men;
  // every nudge costs some shape: the zone left behind opens up, the team is less compact
  for (const sh of u.shifts) {
    u.def[sh.from] *= SHIFT_COST.gap;
    u.att[sh.from] *= SHIFT_COST.gap;
    u.control *= SHIFT_COST.control;
  }
  const n = norms();
  for (const z of SIDES) { u.def[z] /= n.def[z]; u.att[z] /= n.att[z]; }
  u.control /= n.control; u.press = (u.press / n.press) * (PRESS[ins.press] || 1);
  // fewer than 11 players: everything suffers a bit more than linearly
  const count = onPitch.length;
  if (count < 11) {
    // a man down: everybody covers more ground, the spaces open up
    const f = Math.pow(count / 11, 1.0);
    for (const z of SIDES) { u.def[z] *= f; u.att[z] *= f; }
    u.control *= Math.pow(count / 11, 1.2);
    u.press *= f;
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
  // pressing forwards disturb the opponent's build-up
  control *= 1 + clamp(uB.oppControl, -0.12, 0);
  if (Math.abs(diff) >= 0.5) {
    control *= 1 + clamp(diff, -1.5, 1.5) * 0.04;
    add(diff > 0 ? 'good' : 'warn', diff > 0 ? `Orta sahada sayısal üstünlük (+${diff.toFixed(1)} oyuncu): topa daha çok sahip olunur.` : `Orta sahada sayıca geridesin (${diff.toFixed(1)}): rakip topu daha çok tutar.`);
  }
  // defensive anchor
  // a flat midfield four with both wide players tucking in protects the centre-backs too
  const anchorsEff = uA.anchors + (uA.wideMids >= 2 ? 0.3 : 0);
  if (anchorsEff < 0.6) {
    def.C *= 0.9;
    add('warn', 'Ön libero / savunmacı orta saha yok: stoperlerin önü açık, merkezden çok pozisyon verilir.');
  } else if (uA.core <= 2 && uA.anchors < 1 && uA.wideMids < 2) {
    def.C *= 0.95; control *= 0.97;
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
  // nobody wide on a flank (diamond, narrow systems): the opponent's full-back overlaps freely
  for (const z of ['L', 'R']) {
    if (uA.wideDefWork[z] == null && !uA.wideCover[z]) {
      def[z] *= 0.8;
      add('warn', `${z === 'L' ? 'Sol' : 'Sağ'} kanatta kanat oyuncusu yok: rakip bek rahatça bindirir, o kanattan çok orta gelir.`);
    }
  }
  // players who do not defend at all leave the team a man short without the ball
  if (uA.teamDef < 1) { for (const zz of SIDES) def[zz] *= uA.teamDef; }
  // a real strike partnership: two strikers up front bother the centre-backs more
  if (uA.strikers.length >= 2) att.C *= 1.07;
  // two strikers who do not track back
  const st = uA.strikers;
  if (st.length >= 2 && !st.some((s) => s.dropper)) {
    const lazy = st.filter((s) => s.workDef < 0.5).length;
    if (lazy >= 2) { control *= 0.97; add('warn', 'İki forvet de savunmaya katılmıyor: orta saha sayıca zayıf kalır, rakip rahat oyun kurar.'); }
    else add('info', 'Çift forvet: ceza sahasında daha çok oyuncu ama orta saha bir kişi eksik.');
  }
  if (st.some((s) => s.dropper)) add('good', 'Forvetlerden biri orta sahaya geliyor: merkez daha kalabalık, hücum biraz azalır.');
  // mentality / width
  const m = insA.mentality;
  if (m === 'attacking') { for (const z of SIDES) { att[z] *= 1.12; def[z] *= 0.91; } }
  if (m === 'defensive') { for (const z of SIDES) { att[z] *= 0.86; def[z] *= 1.12; } }
  if (insA.width === 'wide') { att.L *= 1.12; att.R *= 1.12; att.C *= 0.94; def.C *= 0.97; }
  if (insA.width === 'narrow') { att.L *= 0.88; att.R *= 0.88; att.C *= 1.08; def.L *= 0.85; def.R *= 0.85; def.C *= 1.08; }
  if (insA.width === 'narrow' && insB.width === 'wide') add('warn', 'Dar oynuyorsun, rakip ise geniş: kanatlar boş kalıyor, ortalar ve kanat atakları tehlikeli.');
  if (['direct', 'counter', 'lowblock'].includes(insB.style) && diff > 0.5) add('info', 'Rakip topu sana bırakıp geride bekliyor: orta sahadaki sayısal üstünlüğünün etkisi azalır, topa sahip olsan da arkana atılan toplara dikkat.');
  // pressing high works when the players can press (stamina, work rate, aggression)
  if (insA.press === 'high') { const sp = styleStrength('gegenpress', uA.men || [], uB.men || [], insA, insB).s; control *= 1.02 + 0.1 * sp; att.C *= 1 + 0.06 * sp; }
  if (insA.press === 'low') { control *= 0.94; def.C *= 1.02; }
  if (insA.line === 'high') { control *= 1.04; att.C *= 1.03; }
  if (insA.line === 'low') { control *= 0.95; def.C *= 1.04; }

  // counter-attack exposure: opponent forward pace vs our centre-back pace, line height, full-backs
  const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 70);
  const paceGap = avg(uB.fwdPace) - avg(uA.cbPace);
  const lineF = { low: 0.75, mid: 1.0, high: 1.35 }[insA.line] || 1;
  const fbF = 1 + 0.25 * (uA.fbAttack.L + uA.fbAttack.R) / 2;
  // a ~15 point gap between forwards and centre-backs is normal in football
  const counterExposure0 = clamp((1 + (paceGap - 15) / 25) * lineF * fbF * (m === 'attacking' ? 1.1 : m === 'defensive' ? 0.85 : 1) + uA.exposureAdd + (insA.press === 'high' ? 0.1 : 0), 0.4, 2.4);
  if (paceGap > 18 && insA.line === 'high') add('warn', 'Rakip forvetler stoperlerden çok hızlı ve savunma hattı yüksek: arkaya atılan toplar tehlikeli.');
  else if (paceGap > 25) add('warn', 'Stoperler rakip forvetlere göre yavaş: kontra ataklara dikkat.');
  // aerial
  const aerialGap = avg(uB.fwdAerial) - avg(uA.cbAerial);
  if (aerialGap > 10) add('warn', 'Rakip forvetler hava toplarında stoperlerden üstün: ortalar ve duran toplar tehlikeli.');

  // manual nudges: did we overload the opponent's weakest zone?
  if (uA.shifts && uA.shifts.length) {
    const ZN = { L: 'sol kanat', C: 'merkez', R: 'sağ kanat' };
    const oppDef = { L: uB.def.R, C: uB.def.C, R: uB.def.L }; // my left attack meets their right defence
    const weakest = ['L', 'C', 'R'].sort((a, b) => oppDef[a] / Math.max(1, uB.def.C) - oppDef[b] / Math.max(1, uB.def.C))[0];
    const toCount = {};
    for (const sh of uA.shifts) toCount[sh.to] = (toCount[sh.to] || 0) + 1;
    for (const [z, n] of Object.entries(toCount)) {
      const who = uA.shifts.filter((x) => x.to === z).map((x) => x.name.split(' ').slice(-1)[0]).join(', ');
      if (z === weakest && z !== 'C') add('good', `${who} ${ZN[z]} tarafına kaydırıldı: rakibin en zayıf bölgesine yüklendin, orada sayısal üstünlük var.`);
      else add('info', `${who} ${ZN[z]} tarafına kaydırıldı (${n} oyuncu): ${ZN[z]} güçlendi, boşalttığı bölge biraz zayıfladı.`);
    }
  }
  // game plan (play style, attack focus, tempo, set pieces, offside trap) and role combinations
  const o = {
    def, att, control, press: uA.press, mix: { ...uA.mix }, counterExposure: counterExposure0,
    chanceMult: 1, oppChanceMult: 1, counterMult: 1, cornerMult: 1, setPieceMult: 1, fkWon: 1,
    zoneBias: { L: 1, C: 1, R: 1 }, xgMult: xgMap(), xgAgainst: xgMap(),
  };
  applyPlan(o, uA, uB, insA, insB, add);
  roleSynergies(o, uA, insA, add);
  o.counterExposure = clamp(o.counterExposure, 0.3, 2.6);
  return {
    def: o.def, att: o.att, control: o.control, press: o.press, keeping: uA.keeping, counterExposure: o.counterExposure, aerialGap, notes, mix: o.mix, central: uA.central,
    chanceMult: o.chanceMult, oppChanceMult: o.oppChanceMult, counterMult: o.counterMult, cornerMult: o.cornerMult, setPieceMult: o.setPieceMult, fkWon: o.fkWon,
    zoneBias: o.zoneBias, xgMult: o.xgMult, xgAgainst: o.xgAgainst, styleStrength: o.styleStrength ?? null, spStrength: o.styleStrengthSP ?? null, trapStrength: o.styleStrengthTrap ?? null,
  };
}
const XG_TYPES = ['cross', 'cutback', 'wide', 'through', 'combo', 'long', 'counter', 'corner'];
function xgMap() { const m = {}; for (const k of XG_TYPES) m[k] = 1; return m; }



// How the chosen player roles work together. These are real effects in the match
// engine (not only notes): well-matched roles lift the team, clashing roles hurt it.
function roleSynergies(o, uA, insA, add) {
  const R = uA.roles || [];
  const ok = (r, minFit) => r.fit >= minFit;
  const has = (k, minFit = 0.4) => R.filter((r) => r.key === k && ok(r, minFit));
  const any = (keys, minFit = 0.4) => R.filter((r) => keys.includes(r.key) && ok(r, minFit));
  const nm = (r) => String(r.name || '').split(' ').slice(-1)[0];
  const list = (rs) => rs.slice(0, 3).map(nm).join(', ');
  const SIDE = { L: 'Sol', R: 'Sağ' };

  // individual fit
  for (const r of R.filter((x) => x.fit < 0.35).slice(0, 3)) add('warn', `${r.name} "${ROLES[r.key].label}" rolüne uygun değil: o oyuncu her işte biraz daha kötü oynar, rolün faydası azalır.`);
  for (const r of R.filter((x) => x.fit >= 0.8).slice(0, 2)) add('good', `${r.name} "${ROLES[r.key].label}" rolüne biçilmiş kaftan: o oyuncu daha iyi oynar.`);

  // target man + crossers
  const targets = has('target');
  const crossers = any(['winger', 'wbk', 'wba', 'wm']);
  if (has('target', 0).length) {
    if (targets.length && crossers.length >= 2) {
      o.att.L *= 1.04; o.att.R *= 1.04; o.xgMult.cross *= 1.08;
      add('good', `Hedef forvet ${nm(targets[0])} + ortacılar (${list(crossers)}): kanatlardan gelen ortalar çok tehlikeli (kanat hücumu +%4, orta pozisyonları +%8).`);
    } else if (!crossers.length) {
      o.att.C *= 0.96; o.xgMult.cross *= 0.92;
      add('warn', 'Hedef forvet var ama ortacı (klasik kanat / bindiren bek / kanat orta saha) yok: hava gücü boşa gidiyor.');
    }
  }
  // false nine + runners
  if (has('f9', 0).length) {
    const runners = any(['inside', 'shadow', 'mezzala', 'advanced', 'b2b']);
    if (runners.length) { o.att.C *= 1.07; o.mix.through += 0.05; add('good', `Sahte 9 geriye gelip stoperleri çekiyor, ${list(runners)} boşluğa koşuyor (merkez hücumu +%7).`); }
    else { o.att.C *= 0.9; add('warn', 'Sahte 9 var ama boşluğa koşacak oyuncu (içe kat eden forvet, gölge forvet, mezzala, box-to-box, arkaya koşan forvet) yok: ceza sahası boş kalır (merkez hücumu −%10).'); }
  }
  // flank partnerships
  for (const z of ['L', 'R']) {
    const inv = R.filter((r) => r.side === z && ['inside', 'invw'].includes(r.key) && ok(r, 0.4));
    const overl = R.filter((r) => r.side === z && ['wbk', 'wba'].includes(r.key));
    const wing = R.filter((r) => r.side === z && r.key === 'winger' && ok(r, 0.4));
    const ifb = R.filter((r) => r.side === z && r.key === 'ifb');
    if (inv.length) {
      if (overl.length || uA.fbAttack[z] >= 0.7) { o.att[z] *= 1.08; add('good', `${SIDE[z]} kanatta ${nm(inv[0])} içeri kat ediyor, arkasından bek bindirip genişliği veriyor: o kanat çok verimli (+%8).`); }
      else { o.att[z] *= 0.95; add('info', `${nm(inv[0])} içeri kat ediyor ama arkasından bindiren bek yok: ${SIDE[z].toLowerCase()} kanatta genişlik kalmıyor (−%5).`); }
    }
    if (wing.length && ifb.length) { o.def[z] *= 1.03; o.control *= 1.02; add('good', `${SIDE[z]} kanatta ${nm(wing[0])} çizgide kalıyor, ${nm(ifb[0])} içeri girip orta sahaya katılıyor: dengeli kanat.`); }
    if (wing.length && overl.length) { o.att[z] *= 1.03; o.def[z] *= 0.94; add('warn', `${SIDE[z]} kanatta ${nm(wing[0])} ve ${nm(overl[0])} ikisi de çizgiye gidiyor: hücum kalabalık ama top kaybında kanat boş (savunma −%6).`); }
  }
  // midfield balance: a creator needs a destroyer next to him
  const creators = R.filter((r) => ['dlp', 'cmp'].includes(r.key) && ok(r, 0.4));
  const destroyers = R.filter((r) => ['anchor', 'bwm', 'cmd', 'halfback'].includes(r.key) && ok(r, 0.35));
  if (creators.length && destroyers.length) { o.control *= 1.04; o.def.C *= 1.03; add('good', `${nm(creators[0])} oyunu kuruyor, ${nm(destroyers[0])} arkasını topluyor: dengeli orta saha (top hakimiyeti +%4).`); }
  else if (creators.length >= 2 && !destroyers.length && uA.anchors < 1) { o.def.C *= 0.93; add('warn', `Orta sahada iki oyun kurucu (${list(creators)}) var ama top kapan yok: merkez savunması −%7.`); }
  // poacher needs service
  if (has('poacher', 0).length) {
    const service = any(['am', 'cmp', 'dlp', 'f9', 'invw', 'wp', 'treq', 'winger']);
    if (service.length) { for (const k of ['combo', 'through', 'cutback']) o.xgMult[k] *= 1.08; add('good', `Golcü forvete ${list(service)} pas atıyor: ceza sahasındaki pozisyonlar daha net (+%8).`); }
    else { o.att.C *= 0.95; add('warn', 'Golcü var ama ona pas atacak yaratıcı oyuncu (on numara, oyun kurucu, regista, klasik kanat) yok (merkez hücumu −%5).'); }
  }
  // big man / little man up front
  const sts = R.filter((r) => r.code === 'ST');
  if (sts.length >= 2 && sts.some((r) => r.key === 'target' && ok(r, 0.4)) && sts.some((r) => ['poacher', 'advanced', 'pressf'].includes(r.key) && ok(r, 0.4))) {
    o.att.C *= 1.06; add('good', 'Forvet ikilisi birbirini tamamlıyor: biri hava toplarını indiriyor, diğeri ikinci topları ve arkayı kolluyor (merkez hücumu +%6).');
  }
  // runner in behind + long passer
  const adv = has('advanced');
  if (adv.length) {
    const lp = any(['bpd', 'dlp']).length || (uA.men || []).some((m) => ['CB', 'CDM', 'GK'].includes(m.code) && m.e.longPass >= 80);
    if (lp) { o.xgMult.through *= 1.12; o.xgMult.counter *= 1.06; add('good', `${nm(adv[0])} savunmanın arkasına koşuyor, geride onu uzun pasla bulacak oyuncu var (ara pas pozisyonları +%12).`); }
  }
  // two overlapping full-backs need cover
  const overlappers = R.filter((r) => ['wbk', 'wba'].includes(r.key));
  if (overlappers.length >= 2) {
    const cover = R.filter((r) => ['halfback', 'anchor'].includes(r.key) && ok(r, 0.35));
    if (cover.length || uA.anchors >= 1.2) { o.counterExposure -= 0.06; add('good', `İki bek de bindiriyor ama ${cover.length ? nm(cover[0]) : 'ön libero'} arkayı kapatıyor.`); }
    else { o.counterExposure += 0.15; o.def.L *= 0.95; o.def.R *= 0.95; add('warn', 'İki bek de sürekli bindiriyor ve arkada çapa yok: kontra ataklara çok açıksın.'); }
  }
  // the free role needs workers around him
  if (has('treq', 0).length) {
    const workers = any(['b2b', 'bwm', 'trackback', 'dwm', 'pressf', 'cmd', 'anchor', 'halfback'], 0.35);
    if (workers.length >= 2) { o.def.C *= 1.02; o.att.C *= 1.03; add('good', `Serbest oyuncunun savunma yükünü ${list(workers)} taşıyor: o rahatça oynar.`); }
    else if (uA.anchors < 1) { o.def.C *= 0.94; add('warn', 'Serbest oyuncu savunma yapmıyor ve arkasında güçlü bir ön libero yok: merkez açık (merkez savunması −%6).'); }
  }
  // too many players who do not defend
  const free = R.filter((r) => ['treq', 'shadow', 'poacher', 'inside', 'mezzala'].includes(r.key));
  if (free.length >= 3 && !R.some((r) => ['bwm', 'anchor', 'cmd', 'halfback', 'b2b', 'trackback', 'dwm'].includes(r.key))) {
    for (const z of ['L', 'C', 'R']) o.def[z] *= 0.94;
    add('warn', `Savunma yapmayan rol çok (${list(free)}) ve hiç çalışkan oyuncu yok: top kaybında takım ikiye bölünür (savunma −%6).`);
  }
  // pressing roles with a pressing plan
  if (has('pressf').length && (insA.press === 'high' || insA.style === 'gegenpress')) { o.press *= 1.08; o.control *= 1.02; add('good', 'Pres forvet + önde pres: rakip geriden oyun kurmakta zorlanır (ama oyuncular çabuk yorulur).'); }
  if (has('pressf', 0).length && insA.press === 'low' && insA.style !== 'gegenpress') add('info', 'Pres forvet var ama takım geride bekliyor: presin etkisi az.');
  // sweeper keeper and the line
  if (has('sweeper').length && insA.line === 'high') { o.counterExposure -= 0.08; add('good', 'Libero kaleci yüksek savunma hattının arkasını kolluyor.'); }
  if (has('sweeper', 0).length && insA.line === 'low') add('info', 'Libero kaleci derin savunmayla pek uyumlu değil.');
  // two mezzalas and nobody holding
  if (has('mezzala', 0).length >= 2 && uA.anchors < 1) { o.def.C *= 0.94; o.def.L *= 0.97; o.def.R *= 0.97; add('warn', 'İki mezzala da öne koşuyor ve arkada ön libero yok: orta saha boş kalır.'); }
  // box-to-box with a holder behind
  const b2b = has('b2b');
  if (b2b.length && any(['anchor', 'halfback', 'cmd'], 0.35).length) { o.att.C *= 1.03; o.control *= 1.01; add('good', `${nm(b2b[0])} arkasında sabit duran biri olduğu için rahatça iki ceza sahası arasında koşuyor.`); }
  // centre-back pair
  if (has('stopper').length && has('cover').length) { o.def.C *= 1.04; add('good', `Stoper ikilisi tamamlıyor: ${nm(has('stopper')[0])} öne çıkıyor, ${nm(has('cover')[0])} arkasını kolluyor (merkez savunması +%4).`); }
  if (has('stopper', 0).length >= 2) { o.counterExposure += 0.1; o.def.C *= 0.97; add('warn', 'İki stoper de öne çıkıp basıyor: arkayı kollayan yok.'); }
  if (has('bpd', 0).length >= 2 && !has('cover', 0).length && !has('cb', 0).length) { o.def.C *= 0.97; add('info', 'İki stoper de oyun kurucu: top çıkarma iyi ama hava toplarında ve ikili mücadelede biraz zayıf.'); }
}
