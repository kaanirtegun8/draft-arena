// Tactical model: turns an XI + instructions into zone strengths
// (left / centre / right attack and defence, midfield control, pressing)
// and explains structural strengths & weaknesses in plain Turkish.
import { formationSlots, positionFit, roleOf, isGK } from './positions.js';
import { abilities } from './abilities.js';
import { ROLES, roleFit, scaledMod } from './roles.js';

export const INSTRUCTIONS = {
  mentality: { label: 'Oyun anlayışı', options: { defensive: 'Savunmacı', balanced: 'Dengeli', attacking: 'Hücumcu' }, def: 'balanced' },
  press: { label: 'Pres', options: { low: 'Geride bekle', mid: 'Orta', high: 'Önde pres' }, def: 'mid' },
  line: { label: 'Savunma hattı', options: { low: 'Derin', mid: 'Orta', high: 'Yüksek' }, def: 'mid' },
  fullbacks: { label: 'Bekler', options: { stay: 'Geride kalsın', balanced: 'Dengeli', attack: 'Hücuma çıksın' }, def: 'balanced' },
  width: { label: 'Genişlik', options: { narrow: 'Dar', normal: 'Normal', wide: 'Geniş' }, def: 'normal' },
  style: { label: 'Oyun tarzı', options: { possession: 'Pas oyunu (topa sahip ol)', balanced: 'Dengeli', direct: 'Direkt / uzun top', counter: 'Kontra atak' }, def: 'balanced' },
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
    case 'CAM':
      add('att', 'C', e.creation * 0.6 + e.dribbling * 0.25 + e.finishing * 0.15);
      u.control += e.passing * 0.55;
      add('def', 'C', e.defending * 0.1 * e.workDef);
      u.press += e.pressing * 0.6;
      u.central += 1; u.core += 1;
      break;
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
      if (cf) { u.central += 0.5; add('def', 'C', e.defending * 0.08); }
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
    mix: { cross: 0, cutback: 0, wide: 0, through: 0, combo: 0, long: 0 }, exposureAdd: 0, oppControl: 0, roles: [], wideCover: { L: false, R: false }, teamDef: 1,
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
  // a player who cannot play the role is a little worse at everything
  if (fit < 0.35) {
    for (const z of SIDES) { t.att[z] *= 0.95; t.def[z] *= 0.95; }
    t.control *= 0.95;
  }
  if (role.work && side !== 'C' && t.wideDefWork[side] != null) t.wideDefWork[side] = Math.max(t.wideDefWork[side], role.work);
  if (role.teamDef) t.teamDef *= role.teamDef;
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
  for (const k of ['strikers', 'cbPace', 'cbAerial', 'fwdPace', 'fwdAerial']) u[k].push(...t[k]);
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
  for (const o of onPitch) {
    const e = effective(o.player, o.slot.code, o);
    e._foot = o.player.foot;
    const role = o.slot.role && ROLES[o.slot.role] ? ROLES[o.slot.role] : null;
    const fit = role ? roleFit(o.slot.role, abilities(o.player)) : 0.6;
    if (role && role.work) e.workDef = Math.max(e.workDef, role.work);
    const t = emptyUnits();
    contribute(t, o.slot, e, ins, o.player.id === dropperId);
    if (role) applyRole(t, o.slot, role, fit, e);
    parts.push(t);
    if (role) roles.push({ key: o.slot.role, fit, code: o.slot.code, side: o.slot.side, name: o.player.name });
  }
  const combined = combine(parts);
  Object.assign(u, combined);
  u.roles = roles;
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
  // pressing forwards disturb the opponent's build-up
  control *= 1 + clamp(uB.oppControl, -0.12, 0);
  if (Math.abs(diff) >= 0.5) {
    control *= 1 + clamp(diff, -1.5, 1.5) * 0.04;
    add(diff > 0 ? 'good' : 'warn', diff > 0 ? `Orta sahada sayısal üstünlük (+${diff.toFixed(1)} oyuncu): topa daha çok sahip olunur.` : `Orta sahada sayıca geridesin (${diff.toFixed(1)}): rakip topu daha çok tutar.`);
  }
  // defensive anchor
  if (uA.anchors < 0.6) {
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
      def[z] *= 0.82;
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
  if (m === 'attacking') { for (const z of SIDES) { att[z] *= 1.08; def[z] *= 0.94; } }
  if (m === 'defensive') { for (const z of SIDES) { att[z] *= 0.9; def[z] *= 1.08; } }
  if (insA.width === 'wide') { att.L *= 1.08; att.R *= 1.08; att.C *= 0.96; }
  if (insA.width === 'narrow') { att.L *= 0.92; att.R *= 0.92; att.C *= 1.05; def.L *= 0.88; def.R *= 0.88; def.C *= 1.05; }
  if (insA.width === 'narrow' && insB.width === 'wide') add('warn', 'Dar oynuyorsun, rakip ise geniş: kanatlar boş kalıyor, ortalar ve kanat atakları tehlikeli.');
  // play style
  const style = insA.style || 'balanced';
  let directness = 1;
  if (style === 'possession') { control *= 1.08; mixAdd(uA, { combo: 0.08, through: 0.03, long: -0.06, cross: -0.05 }); }
  if (style === 'direct' || style === 'counter') {
    control *= style === 'direct' ? 0.88 : 0.85;
    // direct balls go over the midfield: forwards' pace and aerial power against the centre-backs decide
    const av = (a) => (a.length ? a.reduce((x, v) => x + v, 0) / a.length : 70);
    const edge = (av(uA.fwdPace) - av(uB.cbPace) - 15) + (av(uA.fwdAerial) - av(uB.cbAerial));
    directness = clamp(1 + edge / 120, 0.85, 1.2);
    mixAdd(uA, style === 'direct' ? { long: 0.08, through: 0.12, cross: 0.08, combo: -0.12, cutback: -0.05 } : { through: 0.15, combo: -0.08 });
    if (style === 'counter') { for (const z of SIDES) def[z] *= 1.05; }
    add(directness >= 1.05 ? 'good' : directness <= 0.95 ? 'warn' : 'info', style === 'direct'
      ? `Direkt oyun: orta sahayı atlayıp uzun toplarla forvetlere oynuyorsun. Forvetlerin hız/hava gücü rakip stoperlere göre ${directness >= 1.05 ? 'üstün, bu plan işe yarar' : directness <= 0.95 ? 'zayıf, uzun toplar boşa gidebilir' : 'dengede'}.`
      : `Kontra atak: geride bekleyip top kazanınca hızlı çıkıyorsun. ${directness >= 1.05 ? 'Hızlı forvetlerin bunu çok etkili kılar.' : directness <= 0.95 ? 'Forvetlerin yeterince hızlı değil, kontralar sönük kalabilir.' : ''}`);
  }
  if ((insB.style === 'direct' || insB.style === 'counter') && diff > 0.5) add('info', 'Rakip direkt / kontra oynuyor: orta sahadaki sayısal üstünlüğünün etkisi azalır, topa sahip olsan da arkana atılan toplara dikkat.');
  if (insA.press === 'high') control *= 1.06;
  if (insA.line === 'high') control *= 1.02;
  if (insA.line === 'low') control *= 0.97;

  // counter-attack exposure: opponent forward pace vs our centre-back pace, line height, full-backs
  const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 70);
  const paceGap = avg(uB.fwdPace) - avg(uA.cbPace);
  const lineF = { low: 0.75, mid: 1.0, high: 1.35 }[insA.line] || 1;
  const fbF = 1 + 0.25 * (uA.fbAttack.L + uA.fbAttack.R) / 2;
  // a ~15 point gap between forwards and centre-backs is normal in football
  const counterExposure = clamp((1 + (paceGap - 15) / 25) * lineF * fbF * (m === 'attacking' ? 1.1 : m === 'defensive' ? 0.85 : 1) + uA.exposureAdd + (insA.press === 'high' ? 0.1 : 0), 0.4, 2.4);
  if (paceGap > 18 && insA.line === 'high') add('warn', 'Rakip forvetler stoperlerden çok hızlı ve savunma hattı yüksek: arkaya atılan toplar tehlikeli.');
  else if (paceGap > 25) add('warn', 'Stoperler rakip forvetlere göre yavaş: kontra ataklara dikkat.');
  // aerial
  const aerialGap = avg(uB.fwdAerial) - avg(uA.cbAerial);
  if (aerialGap > 10) add('warn', 'Rakip forvetler hava toplarında stoperlerden üstün: ortalar ve duran toplar tehlikeli.');

  roleNotes(uA, uB, insA, add);
  const mix = uA.mix;
  return { def, att, control, press: uA.press, keeping: uA.keeping, counterExposure, aerialGap, notes, mix, central: uA.central, directness };
}

// Notes about how the chosen player roles fit together.
function mixAdd(u, m) { for (const [k, v] of Object.entries(m)) u.mix[k] = (u.mix[k] || 0) + v; }

function roleNotes(uA, uB, insA, add) {
  const has = (k) => uA.roles.filter((r) => r.key === k);
  const poor = uA.roles.filter((r) => r.fit < 0.35);
  for (const r of poor.slice(0, 3)) add('warn', `${r.name} "${ROLES[r.key].label}" rolüne uygun değil: rolün faydası azalır.`);
  const great = uA.roles.filter((r) => r.fit >= 0.8);
  for (const r of great.slice(0, 2)) add('good', `${r.name} "${ROLES[r.key].label}" rolüne biçilmiş kaftan.`);
  const crossers = has('winger').length + has('wbk').length + has('wba').length;
  if (has('target').length && crossers === 0) add('warn', 'Hedef forvet var ama ortacı (klasik kanat / bindiren bek) yok: hava gücü boşa gidiyor.');
  if (has('target').length && crossers >= 2) add('good', 'Hedef forvet + ortacılar: kanatlardan gelen toplar çok tehlikeli.');
  if (has('f9').length) {
    const runners = has('inside').length + has('shadow').length + has('mezzala').length + has('advanced').length + has('b2b').length;
    if (runners) add('good', 'Sahte 9 geriye gelip stoperleri çekiyor, arkadan koşan oyuncular boşluğu kullanıyor.');
    else add('warn', 'Sahte 9 var ama boşluğa koşacak oyuncu (içe kat eden kanat, gölge forvet, mezzala, box-to-box) yok: ceza sahası boş kalır.');
  }
  if (has('treq').length && uA.anchors < 1) add('warn', 'Serbest oyuncu savunma yapmıyor ve arkasında güçlü bir ön libero yok: merkez açık.');
  const overlapping = has('wbk').length + has('wba').length;
  if (overlapping >= 2 && uA.anchors < 1.2) add('warn', 'İki bek de sürekli bindiriyor ve arkada çapa yok: kontra ataklara çok açıksın.');
  if (has('pressf').length && insA.press === 'high') add('good', 'Pres forvet + önde pres: rakip geriden oyun kurmakta zorlanır (ama oyuncular çabuk yorulur).');
  if (has('sweeper').length && insA.line === 'high') add('good', 'Libero kaleci yüksek savunma hattının arkasını kolluyor.');
  if (has('sweeper').length && insA.line === 'low') add('info', 'Libero kaleci derin savunmayla pek uyumlu değil.');
}
