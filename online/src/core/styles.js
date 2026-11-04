// Game plan: play styles and plan instructions whose effect depends on the XI.
// Each style has a strength 0..1 computed from the players on the pitch (their
// effective abilities, so form, condition and position fit count) and, where it
// matters, from the opponent. A style the players suit gives a big lift; a style
// they do not suit makes the team worse than playing balanced.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const n = (x, lo, hi) => clamp((x - lo) / (hi - lo), 0, 1);
const WIDE = new Set(['LW', 'RW', 'LM', 'RM']);
const FBS = new Set(['LB', 'RB', 'LWB', 'RWB']);
const MIDS = new Set(['CDM', 'CM', 'CAM']);
const FWDS = new Set(['ST', 'CF']);
const avg = (a, fill) => (a.length ? a.reduce((x, v) => x + v, 0) / a.length : fill);
// mean of the best k values; missing players count as `fill` (a thin unit is weak)
function topAvg(vals, k, fill) {
  const v = vals.slice().sort((a, b) => b - a).slice(0, k);
  while (v.length < k) v.push(fill);
  return v.reduce((a, x) => a + x, 0) / k;
}
const roleCount = (men, keys) => men.filter((m) => keys.includes(m.role) && m.fit >= 0.45).length;
const last = (name) => String(name || '').split(' ').slice(-1)[0];
const bestBy = (men, f) => men.slice().sort((a, b) => f(b.e) - f(a.e))[0] || null;

export const STYLE_INFO = {
  balanced: { label: 'Dengeli', short: 'Dengeli', desc: 'Belirgin bir plan yok; ne artı ne eksi.' },
  possession: { label: 'Pas oyunu (topa sahip ol)', short: 'Pas oyunu', desc: 'Kısa paslarla topu tutar, sabırla açık arar. Orta sahan pasta, top saklamada ve soğukkanlılıkta iyiyse çok güçlü; değilse top kaybedip kontra yersin.' },
  wing: { label: 'Kanat oyunu', short: 'Kanat oyunu', desc: 'Ataklar kanatlardan gelir: kanatçılar çizgiye iner, bekler bindirir, ortalar ceza sahasına. Hızlı, dripling ve ortası iyi kanatlar + kafası iyi forvet ister.' },
  direct: { label: 'Uzun top / direkt', short: 'Uzun top', desc: 'Orta sahayı atlayıp forvetlere ve stoperlerin arkasına uzun top. Hızlı / güçlü forvetler ve uzun pası iyi oyuncular ister; rakip savunma hattı yüksekse daha da etkili.' },
  counter: { label: 'Kontra atak', short: 'Kontra', desc: 'Geride bekler, topu kazanınca hızla çıkar. Hızlı forvet ve kanatlar ister; hücumcu, önde oynayan rakiplere karşı öldürücü.' },
  gegenpress: { label: 'Gegenpress (önde top kazan)', short: 'Gegenpress', desc: 'Top kaybedilince hemen basıp rakip kalesine yakın top kazanır. Pres gücü ve dayanıklılığı yüksek oyuncular ister, çok yorar; geriden kötü oyun kuran rakiplere karşı çok etkili.' },
  lowblock: { label: 'Kompakt blok (otobüs)', short: 'Kompakt blok', desc: 'Kendi yarı sahasında dar ve derin savunur, boşluk vermez. Güçlü stoper ve bekler ister; çok az pozisyon verir ama az pozisyon üretir.' },
};
export const STYLE_KEYS = Object.keys(STYLE_INFO);

// How much each style needs the ball, base chance rate and counter-attacks (engine and bot)
export const STYLE = {
  possession: { possExp: 0.6, chance: 1.0, counter: 0.8 },
  balanced: { possExp: 0.4, chance: 1.0, counter: 1.0 },
  wing: { possExp: 0.4, chance: 1.0, counter: 0.95 },
  direct: { possExp: 0.12, chance: 0.97, counter: 1.15 },
  counter: { possExp: 0.05, chance: 0.86, counter: 1.9 },
  gegenpress: { possExp: 0.35, chance: 1.0, counter: 1.2 },
  lowblock: { possExp: 0.1, chance: 0.88, counter: 1.45 },
};

// Stamina use and fouls from the plan alone (known before the match)
export function insDrain(ins = {}) {
  return (ins.style === 'gegenpress' ? 1.12 : ins.style === 'lowblock' ? 0.95 : 1) * (ins.tempo === 'high' ? 1.06 : ins.tempo === 'low' ? 0.94 : 1);
}
export function insFouls(ins = {}) { return ins.style === 'gegenpress' ? 1.2 : ins.style === 'lowblock' ? 1.08 : 1; }

// how open the opponent plays (counters and long balls find space)
function openness(insB = {}) {
  let o = 0;
  o += insB.mentality === 'attacking' ? 5 : insB.mentality === 'defensive' ? -5 : 0;
  o += insB.line === 'high' ? 5 : insB.line === 'low' ? -5 : 0;
  o += { possession: 4, gegenpress: 4, wing: 2, lowblock: -7, counter: -4, direct: 0 }[insB.style] || 0;
  o += insB.fullbacks === 'attack' ? 3 : 0;
  return o;
}

/**
 * Strength (0..1) of a style for a team. men: [{ code, side, role, fit, e, name }]
 * (e = effective abilities), opp = the opponent's men (may be empty), ins / insB instructions.
 * Returns { s, why } where why is a short Turkish explanation.
 */
// raw score -> strength 0..1 (calibrated on drafted squads: ~p10 → 0.15, ~p90 → 0.85)
export const STRENGTH_RANGE = {
  possession: [69, 87.5], wing: [70.5, 88], direct: [-8, 23], counter: [-4, 15], gegenpress: [1.5, 20.5], lowblock: [75.5, 84], setpiece: [84.5, 92], trap: [79.5, 85.5],
};
const scale = (key, raw) => n(raw, STRENGTH_RANGE[key][0], STRENGTH_RANGE[key][1]);

export function styleStrength(key, men, opp = [], ins = {}, insB = {}) {
  const r = styleRaw(key, men, opp, ins, insB);
  return { s: r.raw == null ? 0.5 : scale(key, r.raw), raw: r.raw, why: r.why ? r.why(r.raw == null ? 0.5 : scale(key, r.raw)) : '' };
}

function styleRaw(key, men, opp, ins, insB) {
  const gk = men.find((m) => m.code === 'GK');
  const hasOpp = opp && opp.length >= 7;
  switch (key) {
    case 'possession': {
      const ms = (e) => 0.4 * e.passing + 0.25 * e.creation + 0.2 * e.composure + 0.15 * e.dribbling;
      const midMen = men.filter((m) => MIDS.has(m.code) || ['f9', 'ifb', 'wp', 'invw'].includes(m.role));
      const mid = topAvg(midMen.map((m) => ms(m.e)), 3, 58);
      const build = topAvg(men.filter((m) => m.code === 'CB').map((m) => m.e.passing), 2, 55) * 0.8 + (gk ? gk.e.passing : 45) * 0.2;
      const fb = topAvg(men.filter((m) => FBS.has(m.code)).map((m) => m.e.passing), 2, 60);
      const roles = Math.min(5, 1.3 * roleCount(men, ['cmp', 'dlp', 'bpd', 'ifb', 'f9', 'wp', 'halfback', 'am', 'invw', 'sweeper']));
      // against a midfield that presses and tackles well the ball is harder to keep
      const oppMid = hasOpp ? topAvg(opp.filter((m) => MIDS.has(m.code)).map((m) => 0.5 * m.e.defending + 0.5 * m.e.pressing), 3, 60) : 74;
      const raw = 0.6 * mid + 0.25 * build + 0.15 * fb + roles + 0.3 * (mid - oppMid - 8);
      const star = bestBy(midMen, ms);
      return { raw, why: (s) => s >= 0.6 ? `Orta saha pasta çok iyi${star ? ` (${last(star.name)})` : ''}: top sende kalır.` : s <= 0.3 ? 'Orta sahan pasta ve top saklamada zayıf: top kaybedip kontra yersin.' : 'Orta sahanın pas kalitesi orta seviyede.' };
    }
    case 'wing': {
      const fbAtt = { stay: 0.15, balanced: 0.45, attack: 0.8 }[ins.fullbacks] ?? 0.45;
      const ws = (e) => 0.3 * e.pace + 0.35 * e.dribbling + 0.35 * e.crossing;
      const flank = (z) => {
        const w = men.filter((m) => WIDE.has(m.code) && m.side === z).map((m) => ws(m.e));
        const f = men.filter((m) => FBS.has(m.code) && m.side === z).map((m) => (0.45 * m.e.crossing + 0.35 * m.e.pace + 0.2 * m.e.stamina) * (m.code.endsWith('WB') || ['wbk', 'wba'].includes(m.role) ? 1 : 0.75 + 0.3 * fbAtt));
        const fbest = f.length ? Math.max(...f) : 55;
        return w.length ? 0.75 * Math.max(...w) + 0.25 * fbest : f.length ? 0.92 * fbest : 45;
      };
      const L = flank('L'), R = flank('R');
      const box = topAvg(men.filter((m) => FWDS.has(m.code)).map((m) => 0.5 * m.e.aerialAtt + 0.5 * m.e.finishing), 1, 55);
      const roles = Math.min(5, 1.2 * roleCount(men, ['winger', 'wbk', 'wba', 'target', 'wm'])) - 0.6 * roleCount(men, ['inside', 'invw', 'wp']);
      // my flank attackers against their full-backs (my left meets their right)
      const oppFb = (z) => topAvg(opp.filter((m) => FBS.has(m.code) && m.side === z).map((m) => 0.5 * m.e.defending + 0.35 * m.e.pace + 0.15 * m.e.aerialDef), 1, 60);
      const duel = hasOpp ? ((L - oppFb('R')) + (R - oppFb('L'))) / 2 : 8;
      const raw = 0.42 * Math.max(L, R) + 0.38 * Math.min(L, R) + 0.2 * box + roles + 0.3 * (duel - 8);
      const wingers = men.filter((m) => WIDE.has(m.code)).sort((a, b) => ws(b.e) - ws(a.e)).slice(0, 2).map((m) => last(m.name));
      return { raw, why: (s) => s >= 0.6 ? `Kanatların (${wingers.join(', ') || 'bekler'}) hızlı ve iyi orta açıyor: kanat oyunu çok güçlü.` : s <= 0.3 ? 'Kanat oyuncuların hız / dripling / ortada zayıf: kanat oyunu verimsiz kalır.' : 'Kanatların fena değil ama fark yaratacak kadar değil.' };
    }
    case 'direct': {
      const runners = men.filter((m) => FWDS.has(m.code) || m.code === 'LW' || m.code === 'RW');
      const fwdPace = topAvg(runners.map((m) => m.e.pace), 2, 65);
      const fwdAir = topAvg(men.filter((m) => FWDS.has(m.code)).map((m) => m.e.aerialAtt), 1, 55);
      const oppCB = opp.filter((m) => m.code === 'CB');
      const cbPace = avg(oppCB.map((m) => m.e.pace), 72);
      const cbAir = avg(oppCB.map((m) => m.e.aerialDef), 74);
      const lp = topAvg(men.filter((m) => ['CB', 'CDM', 'CM', 'GK', 'LB', 'RB'].includes(m.code)).map((m) => m.e.longPass), 2, 65);
      let edge = (fwdPace - cbPace - 8) + 0.7 * (fwdAir - cbAir) + 0.5 * (lp - 76);
      if (insB.line === 'high') edge += 0.5 * Math.max(0, fwdPace - cbPace) + 3;
      if (insB.line === 'low') edge -= 6;
      edge += 2.5 * roleCount(men, ['target', 'advanced', 'bpd', 'dlp']);
      return { raw: edge, why: (s) => s >= 0.6 ? `Forvetlerin rakip stoperlerden hızlı / güçlü ve uzun pası atacak oyuncun var: uzun toplar iş yapar${insB.line === 'high' ? ' (rakip hattı yüksek, arkası boş)' : ''}.` : s <= 0.3 ? 'Forvetlerin rakip stoperlere göre yavaş veya hava toplarında zayıf: uzun toplar boşa gider.' : 'Uzun toplar ara sıra işe yarar; belirgin bir üstünlük yok.' };
    }
    case 'counter': {
      const run = topAvg(men.filter((m) => FWDS.has(m.code) || WIDE.has(m.code) || m.code === 'CAM').map((m) => 0.55 * m.e.pace + 0.25 * m.e.dribbling + 0.2 * m.e.finishing), 3, 62);
      const outlet = topAvg(men.filter((m) => MIDS.has(m.code)).map((m) => 0.6 * m.e.passing + 0.4 * m.e.creation), 1, 65);
      const runPace = topAvg(men.filter((m) => FWDS.has(m.code) || WIDE.has(m.code)).map((m) => m.e.pace), 2, 65);
      const oppPace = avg(opp.filter((m) => m.code === 'CB' || FBS.has(m.code)).map((m) => m.e.pace), 74);
      let edge = 0.7 * (run - 78) + 0.3 * (outlet - 78) + openness(insB) + 0.4 * (runPace - oppPace - 12);
      edge += 2.5 * roleCount(men, ['advanced', 'inside', 'poacher', 'anchor']);
      return { raw: edge, why: (s) => s >= 0.6 ? `Hücum hattın çok hızlı${openness(insB) > 0 ? ' ve rakip önde oynuyor' : ''}: kontralar öldürücü.` : s <= 0.3 ? `Hücumcuların yeterince hızlı değil${openness(insB) < 0 ? ' ve rakip geride kapanıyor' : ''}: kontralar sönük kalır.` : 'Kontralar zaman zaman tehlike yaratır.' };
    }
    case 'gegenpress': {
      const pr = topAvg(men.filter((m) => m.code !== 'GK' && m.code !== 'CB').map((m) => 0.6 * m.e.pressing + 0.25 * m.e.stamina + 0.15 * m.e.pace), 6, 60);
      const oppBuild = topAvg(opp.filter((m) => ['CB', 'CDM', 'GK'].includes(m.code)).map((m) => 0.6 * m.e.passing + 0.4 * m.e.composure), 4, 72);
      let edge = (pr - 72) + 0.8 * (75 - oppBuild);
      if (ins.line === 'low') edge -= 8;
      if (ins.line === 'high') edge += 3;
      edge += 2.2 * roleCount(men, ['pressf', 'bwm', 'b2b', 'trackback', 'stopper']);
      return { raw: edge, why: (s) => s >= 0.6 ? `Oyuncuların çok koşuyor ve basıyor${oppBuild < 73 ? ', rakip geriden oyun kurmakta zayıf' : ''}: önde çok top kazanırsın (ama çok yorulurlar).` : s <= 0.3 ? `Takımın bu yoğunlukta pres yapacak kadar dinamik değil${ins.line === 'low' ? ' ve savunma hattı derin' : ''}: pres kırılır, arkada boşluk kalır.` : 'Pres ara sıra top kazandırır; oyuncular çabuk yorulur.' };
    }
    case 'lowblock': {
      const d = topAvg(men.filter((m) => m.code === 'CB' || FBS.has(m.code)).map((m) => 0.6 * m.e.defending + 0.25 * m.e.aerialDef + 0.15 * m.e.pace), 4, 62);
      const screen = topAvg(men.filter((m) => MIDS.has(m.code)).map((m) => m.e.defending), 2, 55);
      const work = avg(men.filter((m) => WIDE.has(m.code) || m.code === 'CAM' || FWDS.has(m.code)).map((m) => m.e.workDef), 0.6);
      const roles = Math.min(2.5, 0.6 * roleCount(men, ['anchor', 'dfb', 'dwm', 'cover', 'cb', 'halfback', 'cmd', 'trackback', 'wbd']));
      // a deep block suffers most against great dribblers and finishers
      const oppAtt = hasOpp ? topAvg(opp.filter((m) => FWDS.has(m.code) || WIDE.has(m.code) || m.code === 'CAM').map((m) => 0.4 * m.e.dribbling + 0.35 * m.e.finishing + 0.25 * m.e.creation), 3, 70) : 80;
      const raw = 0.62 * d + 0.28 * screen + 10 * work + roles + 0.3 * (80 - oppAtt);
      return { raw, why: (s) => s >= 0.6 ? 'Savunma hattın ve orta sahanın önü çok sağlam: geride kapanınca gol vermezsin.' : s <= 0.3 ? 'Savunmacıların ve ön liberon geride bütün maç baskıya dayanacak kadar güçlü değil.' : 'Geride kapanınca idare edersin ama baskı uzun sürerse gol gelir.' };
    }
    default:
      return { raw: null, why: null };
  }
}

export function setPieceRaw(men) {
  const air = topAvg(men.map((m) => m.e.aerialAtt), 4, 55);
  const deliv = topAvg(men.map((m) => m.e.crossing), 1, 60);
  return 0.7 * air + 0.3 * deliv;
}
export function trapRaw(men) {
  return avg(men.filter((m) => m.code === 'CB' || FBS.has(m.code)).map((m) => 0.5 * m.e.defending + 0.25 * m.e.pace + 0.25 * m.e.composure), 65);
}
export function setPieceStrength(men) { return scale('setpiece', setPieceRaw(men)); }
export function trapStrength(men) { return scale('trap', trapRaw(men)); }

export function stars(s) { return s >= 0.75 ? 5 : s >= 0.55 ? 4 : s >= 0.38 ? 3 : s >= 0.2 ? 2 : 1; }

// Every style's strength for this XI against this opponent (for the tactics screen).
export function styleReport(uA, uB, insA, insB) {
  return STYLE_KEYS.filter((k) => k !== 'balanced').map((k) => {
    const r = styleStrength(k, uA.men || [], (uB && uB.men) || [], insA, insB || {});
    return { key: k, label: STYLE_INFO[k].short, s: Math.round(r.s * 100) / 100, stars: stars(r.s), why: r.why };
  }).sort((a, b) => b.s - a.s);
}

/**
 * Apply the game plan to the analysed units of team A (mutates `o`).
 * o: { def, att, control, press, mix, counterExposure, chanceMult, oppChanceMult, counterMult, cornerMult,
 *      zoneBias, xgMult, xgAgainst, setPieceMult, fkWon }
 */
export function applyPlan(o, uA, uB, insA, insB, add) {
  const men = uA.men || [], opp = (uB && uB.men) || [];
  const SIDES = ['L', 'C', 'R'];
  const style = STYLE_INFO[insA.style] ? insA.style : 'balanced';
  const pctTxt = (m) => `${m >= 1 ? '+' : '−'}%${Math.abs(Math.round((m - 1) * 100))}`;
  if (style !== 'balanced') {
    const { s, why } = styleStrength(style, men, opp, insA, insB);
    o.styleStrength = s;
    const kind = s >= 0.55 ? 'good' : s <= 0.3 ? 'warn' : 'info';
    let eff = '';
    switch (style) {
      case 'possession': {
        const c = 1 + 0.3 * (s - 0.35);
        o.control *= c;
        const q = 1 + 0.12 * (s - 0.35);
        o.xgMult.combo *= q; o.xgMult.through *= q; o.xgMult.cutback *= q;
        mixAdd(o.mix, { combo: 0.08, through: 0.03, cutback: 0.02, long: -0.06, cross: -0.06 });
        // poor passers lose the ball in their own half, worse against a pressing side
        const pressing = insB.press === 'high' || insB.style === 'gegenpress' ? 1.5 : 1;
        o.counterExposure += 0.3 * (0.35 - s) * pressing;
        eff = `topa sahip olma gücü ${pctTxt(c)}`;
        break;
      }
      case 'wing': {
        const w = 1 + 0.32 * (s - 0.35);
        o.att.L *= w; o.att.R *= w; o.att.C *= 0.94;
        o.zoneBias.L *= 1.35; o.zoneBias.R *= 1.35; o.zoneBias.C *= 0.7;
        mixAdd(o.mix, { cross: 0.12, cutback: 0.05, wide: 0.03 });
        o.xgMult.cross *= 1 + 0.15 * (s - 0.35);
        o.cornerMult *= 1.2;
        o.def.L *= 0.97; o.def.R *= 0.97;
        eff = `kanat hücumu ${pctTxt(w)}`;
        break;
      }
      case 'direct': {
        const d = 0.84 + 0.42 * s;
        o.control *= 0.88;
        o.chanceMult *= d;
        o.xgMult.through *= 1 + 0.1 * (s - 0.4);
        mixAdd(o.mix, { long: 0.06, through: 0.12, cross: 0.08, combo: -0.12, cutback: -0.05 });
        o.counterExposure *= 0.95;
        eff = `pozisyon üretimi ${pctTxt(d)}`;
        break;
      }
      case 'counter': {
        const c = 0.3 + 1.0 * s;
        o.control *= 0.8;
        for (const z of SIDES) o.def[z] *= 1.05;
        o.counterMult *= c;
        mixAdd(o.mix, { through: 0.15, combo: -0.08 });
        o.counterExposure *= 0.85;
        eff = `kontra atak sayısı ${pctTxt(c)}`;
        break;
      }
      case 'gegenpress': {
        o.press *= 1 + 0.3 * (s - 0.2);
        o.control *= 1 + 0.08 * (s - 0.3);
        const c = 1 + 0.18 * (s - 0.35);
        o.chanceMult *= c;
        mixAdd(o.mix, { cutback: 0.06, through: 0.04, long: -0.04 });
        o.counterExposure += 0.22;
        eff = `önde top kazanma ile pozisyon ${pctTxt(c)}, rakibin oyun kurması ${pctTxt(gegenOnOpp(s))}`;
        break;
      }
      case 'lowblock': {
        const d = 1.03 + 0.24 * s;
        for (const z of SIDES) { o.def[z] *= d; o.att[z] *= 0.9; }
        o.control *= 0.88;
        o.counterExposure *= 0.6;
        o.xgAgainst.through *= 1 - 0.15 * s; o.xgAgainst.cutback *= 1 - 0.12 * s; o.xgAgainst.combo *= 1 - 0.1 * s;
        eff = `savunma ${pctTxt(d)}, hücum −%10`;
        break;
      }
      default: break;
    }
    add(kind, `${STYLE_INFO[style].short} (uyum ${'★'.repeat(stars(s))}${'☆'.repeat(5 - stars(s))}): ${why}${eff ? ` Etkisi: ${eff}.` : ''}`);
  }
  // the opponent's pressing game disturbs our build-up
  if (insB.style === 'gegenpress' && uB && uB.men) {
    const sB = styleStrength('gegenpress', uB.men, men, insB, insA).s;
    o.control *= gegenOnOpp(sB);
    if (sB >= 0.55) add('warn', 'Rakip gegenpress yapıyor ve bunu iyi yapacak oyuncuları var: geriden oyun kurmak zor, top kaybı riskli.');
  }

  // attack focus
  const focus = insA.focus || 'mixed';
  const ZN = { L: 'sol kanat', C: 'merkez', R: 'sağ kanat' };
  const facing = { L: 'R', C: 'C', R: 'L' };
  if (focus !== 'mixed' && uB) {
    let z = { left: 'L', centre: 'C', right: 'R' }[focus];
    // the centre already gets most attacks, so focusing there adds less
    let up = z === 'C' ? 1.05 : 1.1, bias = z === 'C' ? 1.25 : 1.6, rest = 0.95;
    if (focus === 'weak') {
      z = o.att.L / Math.max(1, uB.def.R) >= o.att.R / Math.max(1, uB.def.L) ? 'L' : 'R';
      up = 1.06; bias = 1.4; rest = 0.98;
    }
    for (const k of SIDES) { if (k === z) { o.att[k] *= up; o.zoneBias[k] *= bias; } else o.att[k] *= rest; }
    const ratio = (k) => o.att[k] / Math.max(1, uB.def[facing[k]]);
    const bestZ = SIDES.slice().sort((a, b) => ratio(b) - ratio(a))[0];
    const worstZ = SIDES.slice().sort((a, b) => ratio(a) - ratio(b))[0];
    const star = men.filter((m) => m.code !== 'GK' && (m.side === z || (z === 'C' && m.side === 'C' && !['CB', 'CDM'].includes(m.code)))).sort((a, b) => (b.e.dribbling + b.e.finishing + b.e.crossing) - (a.e.dribbling + a.e.finishing + a.e.crossing))[0];
    const who = star ? ` (${last(star.name)} üzerinden)` : '';
    if (z === bestZ) add('good', `Hücumlar ${ZN[z]} ağırlıklı${who}: burası rakibe en büyük üstünlüğün olduğu bölge.`);
    else if (z === worstZ) add('warn', `Hücumlar ${ZN[z]} ağırlıklı${who} ama rakip en güçlü burada: ${ZN[bestZ]} daha verimli olurdu.`);
    else add('info', `Hücumlar ${ZN[z]} ağırlıklı${who}.`);
  }

  // tempo
  if (insA.tempo === 'high') { o.chanceMult *= 1.07; o.oppChanceMult *= 1.04; o.control *= 0.98; o.counterExposure += 0.06; }
  if (insA.tempo === 'low') { o.chanceMult *= 0.93; o.oppChanceMult *= 0.95; o.control *= 1.02; o.counterExposure -= 0.06; }

  // set pieces
  if (insA.setPieces === 'focus') {
    const s = setPieceStrength(men);
    o.cornerMult *= 1.5; o.fkWon *= 1.3; o.setPieceMult *= 0.65 + 0.9 * s;
    o.control *= 0.98;
    o.styleStrengthSP = s;
    add(s >= 0.55 ? 'good' : s <= 0.3 ? 'warn' : 'info', s >= 0.55 ? 'Duran top ağırlıklı oyun: kafası iyi uzun oyuncuların var, kornerler ve frikikler çok tehlikeli.' : s <= 0.3 ? 'Duran top ağırlıklı oyun ama hava toplarında güçlü oyuncun az: kornerler boşa gider.' : 'Duran top ağırlıklı oyun: daha çok korner ve frikik kazanırsın.');
  }

  // offside trap: works with quick, smart defenders and a line that is not deep
  if (insA.trap === 'on') {
    const s = trapStrength(men);
    const k = insA.line === 'low' ? 0.3 : insA.line === 'high' ? 1.2 : 1;
    o.counterExposure *= 1 + (0.2 - 0.6 * s) * k;
    o.def.C *= 1 + (0.07 * s - 0.02) * k;
    o.xgAgainst.through *= 1 + (0.06 - 0.2 * s) * k;
    o.styleStrengthTrap = s;
    add(s >= 0.55 ? 'good' : s <= 0.3 ? 'warn' : 'info', s >= 0.55 ? 'Ofsayt taktiği: savunmacıların hızlı ve oyunu iyi okuyor, arkaya atılan toplar ofsayta düşer.' : s <= 0.3 ? 'Ofsayt taktiği riskli: savunmacılar yeterince hızlı ve dikkatli değil, hat kırılınca forvet kaleciyle karşı karşıya kalır.' : 'Ofsayt taktiği: ara sıra işe yarar, bazen arkaya sızılır.');
  }
  o.counterExposure = clamp(o.counterExposure, 0.3, 2.6);
}

// the opponent's control under a press of strength s (a weak press barely bothers them)
function gegenOnOpp(s) { return 1 - 0.14 * Math.max(0, s - 0.15); }

function mixAdd(mix, m) { for (const [k, v] of Object.entries(m)) mix[k] = (mix[k] || 0) + v; }
