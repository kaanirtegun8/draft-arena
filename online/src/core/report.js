// Post-match and season analysis reports (plain Turkish), built from the stored
// match summaries: score, xG, possession, zone-by-zone chances, kick-off unit
// strengths, tactical notes, ratings and the teams' setups.
import { toArray } from './draft.js';
import { finishedMatches, standings } from './season.js';
import { ROLES } from './roles.js';

const ZONE_TR = { L: 'sol kanat', C: 'merkez', R: 'sağ kanat', counter: 'kontra atak', setpiece: 'duran top' };
const ZONE_LOC = { L: 'sol kanatta', C: 'merkezde', R: 'sağ kanatta', counter: 'kontra ataklarda', setpiece: 'duran toplarda' };
const ZONE_WAS = { L: 'sol kanattaydı', C: 'merkezdeydi', R: 'sağ kanattaydı' };
const ZONE_ABL = { L: 'sol kanattan', C: 'merkezden', R: 'sağ kanattan', counter: 'kontra ataklardan', setpiece: 'duran toplardan' };
const rankText = (n, noun) => (n === 1 ? `ligin en ${noun}` : `ligin ${n}. en ${noun}`);
const STYLE_TR = { possession: 'pas oyunu', balanced: 'dengeli oyun', direct: 'direkt / uzun top', counter: 'kontra atak' };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);

// the defender's flank that faces an attacking zone
const FACING = { L: 'R', R: 'L', C: 'C' };

export function matchReport(m, names, byId) {
  const sides = ['home', 'away'];
  const other = (s) => (s === 'home' ? 'away' : 'home');
  const name = (s) => names[s];
  const ts = m.teamStats || {};
  const rep = m.report || null;
  const g = { home: m.homeGoals, away: m.awayGoals };
  const xg = { home: ts.home ? ts.home.xg : 0, away: ts.away ? ts.away.xg : 0 };
  const sections = [];

  // 1) result vs performance
  const res = [];
  const winner = g.home > g.away ? 'home' : g.away > g.home ? 'away' : null;
  const xgW = xg.home - xg.away > 0.4 ? 'home' : xg.away - xg.home > 0.4 ? 'away' : null;
  if (winner) {
    res.push(`${name(winner)} ${Math.max(g.home, g.away)}-${Math.min(g.home, g.away)} kazandı. Gol beklentisi (xG) ${f2(xg[winner])} – ${f2(xg[other(winner)])}.`);
    if (xgW === winner) res.push('Pozisyon üstünlüğü de bu taraftaydı: galibiyet hak edilmiş.');
    else if (xgW === other(winner)) res.push(`Ama daha net pozisyonları ${name(other(winner))} buldu; bitiricilik ve kaleci farkı sonucu belirledi (şanslı galibiyet).`);
    else res.push('Pozisyon kalitesi dengedeydi; farkı bitiricilik yaptı.');
  } else {
    res.push(`Maç ${g.home}-${g.away} berabere bitti. xG ${f2(xg.home)} – ${f2(xg.away)}.`);
    if (xgW) res.push(`${name(xgW)} daha çok ve daha net pozisyon buldu ama kazanamadı.`);
  }
  sections.push({ title: 'Sonuç ve performans', items: res });

  // 2) possession & midfield, styles
  const ball = [];
  const possH = ts.home ? ts.home.possession : 50;
  const setup = m.setup || {};
  const styleOf = (s) => (setup[s] && setup[s].instructions && setup[s].instructions.style) || 'balanced';
  const ballSide = possH >= 50 ? 'home' : 'away';
  const possMax = Math.max(possH, 100 - possH);
  if (rep) {
    const cH = rep.home.units.central, cA = rep.away.units.central;
    ball.push(`${name(ballSide)} topa %${possMax} sahip oldu. Orta saha kontrol gücü ${f1(rep[ballSide].units.control)} – ${f1(rep[other(ballSide)].units.control)}, merkezdeki oyuncu sayısı ${f1(ballSide === 'home' ? cH : cA)} – ${f1(ballSide === 'home' ? cA : cH)}.`);
  } else ball.push(`${name(ballSide)} topa %${possMax} sahip oldu.`);
  for (const s of sides) {
    const st = styleOf(s);
    if (st !== 'balanced') ball.push(`${name(s)} ${STYLE_TR[st]} oynadı.`);
  }
  const lowSide = other(ballSide);
  if (possMax >= 58 && ['direct', 'counter'].includes(styleOf(lowSide))) {
    const shotsLow = ts[lowSide] ? ts[lowSide].shots : 0;
    ball.push(shotsLow >= (ts[ballSide] ? ts[ballSide].shots : 0) * 0.8
      ? `Topu bırakan ${name(lowSide)}, ${STYLE_TR[styleOf(lowSide)]} ile yine de ${shotsLow} şut buldu: orta sahadaki sayısal üstünlük maçı belirlemedi.`
      : `${name(lowSide)} topu bıraktı ama ${STYLE_TR[styleOf(lowSide)]} yeterince pozisyon üretmedi.`);
  }
  sections.push({ title: 'Topa sahip olma ve orta saha', items: ball });

  // 3) where the chances came from
  if (rep) {
    const items = [];
    for (const s of sides) {
      const z = rep[s].zones;
      const tot = Object.values(z).reduce((a, v) => a + v.shots, 0);
      if (!tot) { items.push(`${name(s)} hiç şut çekemedi.`); continue; }
      const parts = Object.entries(z).filter(([, v]) => v.shots).sort((a, b) => b[1].xg - a[1].xg)
        .map(([k, v]) => `${ZONE_TR[k]} ${v.shots} şut (${f2(v.xg)} xG${v.goals ? `, ${v.goals} gol` : ''})`);
      items.push(`${name(s)}: ${parts.join(', ')}.`);
      // biggest mismatch in its favour
      const u = rep[s].units, o = rep[other(s)].units;
      const gaps = ['L', 'C', 'R'].map((k) => ({ k, att: u.att[k], def: o.def[FACING[k]], r: u.att[k] / Math.max(1, o.def[FACING[k]]) })).sort((a, b) => b.r - a.r);
      const best = gaps[0];
      if (best.r >= 1.15) items.push(`  → En büyük üstünlüğü ${ZONE_WAS[best.k]}: hücum ${f1(best.att)} – rakip savunma ${f1(best.def)}.`);
      if (z.counter && z.counter.shots >= 3) items.push(`  → ${z.counter.shots} kontra atak pozisyonu: rakibin savunma arkası açık kaldı.`);
    }
    sections.push({ title: 'Pozisyonlar nereden geldi?', items });
  }

  // 4) tactical warnings that came true
  if (rep) {
    const items = [];
    for (const s of sides) {
      const opp = rep[other(s)].zones;
      const conceded = { L: opp.R.goals, R: opp.L.goals, C: opp.C.goals }; // my left flank faces their right attack
      const notes = toArray(m.analysis && m.analysis[s]);
      for (const n of notes.filter((x) => x.kind === 'warn')) {
        const t = n.text;
        if (/Sol kanat/i.test(t) && conceded.L) items.push(`${name(s)}: "${short(t)}" uyarısı gerçekleşti, sol kanattan ${conceded.L} gol yedi.`);
        else if (/Sağ kanat/i.test(t) && conceded.R) items.push(`${name(s)}: "${short(t)}" uyarısı gerçekleşti, sağ kanattan ${conceded.R} gol yedi.`);
        else if (/(ön libero|merkez|orta saha kolay)/i.test(t) && conceded.C >= 2) items.push(`${name(s)}: "${short(t)}" uyarısı gerçekleşti, merkezden ${conceded.C} gol yedi.`);
        else if (/(kontra|arkaya)/i.test(t) && opp.counter.goals) items.push(`${name(s)}: "${short(t)}" uyarısı gerçekleşti, kontra ataktan ${opp.counter.goals} gol yedi.`);
      }
      for (const n of notes.filter((x) => x.kind === 'good').slice(0, 2)) items.push(`${name(s)} artısı: ${n.text}`);
    }
    if (items.length) sections.push({ title: 'Taktik tespitler', items });
  }

  // 5) players
  const pl = Object.entries(m.players || {}).filter(([, x]) => x.played);
  if (pl.length) {
    const items = [];
    const nm = (pid) => (byId[pid] ? byId[pid].name : pid);
    if (m.motm && m.players[m.motm]) items.push(`Maçın oyuncusu: ${nm(m.motm)} (${m.players[m.motm].rating.toFixed(1)}).`);
    const scorers = toArray(m.goals).map((x) => `${nm(x.playerId)} ${x.label}'${x.penalty ? ' (penaltı)' : ''}${x.assistId ? ` (asist ${nm(x.assistId)})` : ''}`);
    if (scorers.length) items.push(`Goller: ${scorers.join(', ')}.`);
    const poor = pl.filter(([, x]) => x.rating < 6 && x.minutes >= 45).sort((a, b) => a[1].rating - b[1].rating).slice(0, 3);
    if (poor.length) items.push(`Kötü günündeydi: ${poor.map(([pid, x]) => `${nm(pid)} (${x.rating.toFixed(1)})`).join(', ')}.`);
    const keepers = pl.filter(([, x]) => x.saves >= 4);
    for (const [pid, x] of keepers) items.push(`${nm(pid)} ${x.saves} kurtarışla öne çıktı.`);
    const reds = pl.filter(([, x]) => x.red);
    for (const [pid] of reds) items.push(`${nm(pid)} kırmızı kart gördü: takımı eksik kaldı.`);
    const inj = pl.filter(([, x]) => x.injured);
    for (const [pid, x] of inj) items.push(`${nm(pid)} sakatlandı (${x.injuryWeeks} hafta).`);
    sections.push({ title: 'Oyuncular', items });
  }

  // 6) advice for next time
  if (rep) {
    const items = [];
    for (const s of sides) {
      const u = rep[s].units, o = rep[other(s)].units, z = rep[s].zones, oz = rep[other(s)].zones;
      const myPoss = s === 'home' ? possH : 100 - possH;
      const st = styleOf(s);
      const tips = [];
      if (myPoss <= 40 && !['direct', 'counter'].includes(st)) tips.push('orta sahada ezildin: üçlü orta saha, "biri orta sahaya gelsin" talimatı ya da direkt/kontra oyun tarzı dene');
      const flankConceded = { L: oz.R.goals + oz.R.xg, R: oz.L.goals + oz.L.xg };
      for (const k of ['L', 'R']) if (flankConceded[k] >= 1.5) tips.push(`${k === 'L' ? 'sol' : 'sağ'} kanadın çok zorlandı: o tarafa "savunmaya dönen kanat" veya "savunmacı bek" rolü ver`);
      if (oz.counter.shots >= 3) tips.push('kontralara açıktın: savunma hattını düşür veya bindiren bek sayısını azalt');
      if (z.C.shots >= 8 && z.C.xg / z.C.shots < 0.08 && o.def.C > u.att.C) tips.push('merkezde duvara çarptın: geniş oyna, klasik kanat + hedef forvet ile kanatları kullan');
      const totShots = Object.values(z).reduce((a, v) => a + v.shots, 0);
      if (totShots <= 6) tips.push('çok az pozisyon üretildi: hücum anlayışını artır veya yaratıcı rollere (oyun kurucu, on numara) yer ver');
      if (tips.length) items.push(`${name(s)}: ${tips.join('; ')}.`);
    }
    if (items.length) sections.push({ title: 'Bir sonraki maç için öneri', items });
  }
  return { sections };
}

function short(t) { return t.length > 70 ? t.slice(0, 67) + '…' : t; }

// Season-level tactical report: why did the top team win?
export function seasonReport(room, byId) {
  const ms = finishedMatches(room.season);
  if (!ms.length) return null;
  const teams = {};
  const seatName = (s) => (room.members[s] || {}).team || s;
  for (const m of ms) {
    for (const side of ['home', 'away']) {
      const seat = side === 'home' ? m.home : m.away;
      const o = side === 'home' ? 'away' : 'home';
      const t = teams[seat] || (teams[seat] = { seat, n: 0, poss: 0, xg: 0, xga: 0, shots: 0, gf: 0, ga: 0, zones: { L: 0, C: 0, R: 0, counter: 0, setpiece: 0 }, concZones: { L: 0, C: 0, R: 0, counter: 0, setpiece: 0 }, formations: {}, styles: {}, roles: {} });
      t.n++;
      const ts = m.teamStats || {};
      t.poss += ts[side] ? ts[side].possession : 50;
      t.xg += ts[side] ? ts[side].xg : 0; t.xga += ts[o] ? ts[o].xg : 0;
      t.shots += ts[side] ? ts[side].shots : 0;
      t.gf += side === 'home' ? m.homeGoals : m.awayGoals; t.ga += side === 'home' ? m.awayGoals : m.homeGoals;
      if (m.report) {
        for (const [k, v] of Object.entries(m.report[side].zones)) t.zones[k] += v.goals;
        for (const [k, v] of Object.entries(m.report[o].zones)) t.concZones[k] += v.goals;
      }
      const su = m.setup && m.setup[side];
      if (su) {
        t.formations[su.formation] = (t.formations[su.formation] || 0) + 1;
        const st = (su.instructions && su.instructions.style) || 'balanced';
        t.styles[st] = (t.styles[st] || 0) + 1;
        for (const sl of toArray(su.slots)) if (sl.role) t.roles[sl.role] = (t.roles[sl.role] || 0) + 1;
      }
    }
  }
  const list = Object.values(teams).map((t) => ({
    ...t, name: seatName(t.seat), poss: t.poss / t.n, xgPer: t.xg / t.n, xgaPer: t.xga / t.n,
    formation: top(t.formations), style: top(t.styles), mainRoles: Object.entries(t.roles).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => ROLES[k] ? ROLES[k].label : k),
  }));
  const table = standings(room);
  const avg = (k) => list.reduce((a, t) => a + t[k], 0) / list.length;
  const lines = [];
  const leader = list.find((t) => t.seat === table[0].seat);
  if (leader) {
    const why = [];
    if (leader.poss > avg('poss') + 4) why.push(`${rankText(rankOf(list, leader, 'poss'), 'yüksek topa sahip olma oranı')} (%${Math.round(leader.poss)})`);
    if (leader.xgPer > avg('xgPer') + 0.2) why.push(`maç başına ${f2(leader.xgPer)} xG ile ${rankText(rankOf(list, leader, 'xgPer'), 'tehlikeli hücumu')}`);
    if (leader.xgaPer < avg('xgaPer') - 0.2) why.push(`maç başına sadece ${f2(leader.xgaPer)} xG verdi (${rankText(rankOf(list, leader, 'xgaPer', true), 'sağlam savunması')})`);
    if (leader.gf - leader.xg > 2) why.push(`beklenenden ${f1(leader.gf - leader.xg)} gol fazla attı (bitiricilik)`);
    const zTot = Object.values(leader.zones).reduce((a, b) => a + b, 0);
    const zTop = Object.entries(leader.zones).sort((a, b) => b[1] - a[1])[0];
    if (zTot && zTop[1] / zTot >= 0.45) why.push(`gollerinin yüzde ${pct(zTop[1], zTot)} kadarını ${ZONE_ABL[zTop[0]]} attı`);
    lines.push(`${leader.name} ${table[0].rank}. sırada: ${leader.formation || ''}${leader.style && leader.style !== 'balanced' ? `, ${STYLE_TR[leader.style]}` : ''}. ${why.length ? 'Öne çıkanlar: ' + why.join('; ') + '.' : 'Rakiplerinden belirgin bir istatistik farkı yok; sonuçlar dar farklarla geldi.'}`);
    const czTot = Object.values(leader.concZones).reduce((a, b) => a + b, 0);
    const czTop = Object.entries(leader.concZones).sort((a, b) => b[1] - a[1])[0];
    if (czTot >= 3 && czTop[1] / czTot >= 0.4) lines.push(`Zayıf noktası: yediği gollerin yüzde ${pct(czTop[1], czTot)} kadarı ${ZONE_ABL[czTop[0]]} geldi.`);
  }
  return { teams: list.sort((a, b) => table.findIndex((r) => r.seat === a.seat) - table.findIndex((r) => r.seat === b.seat)), lines };
}

function top(obj) { const e = Object.entries(obj).sort((a, b) => b[1] - a[1])[0]; return e ? e[0] : null; }
function rankOf(list, t, key, asc = false) { const s = list.slice().sort((a, b) => (asc ? a[key] - b[key] : b[key] - a[key])); return s.findIndex((x) => x.seat === t.seat) + 1; }
