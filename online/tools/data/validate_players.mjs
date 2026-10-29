// Sanity checks for online/data/players.js.  Run: node online/tools/data/validate_players.mjs
import { PLAYERS, DATA_META } from '../../data/players.js';

const CODES = new Set(['GK', 'CB', 'RB', 'LB', 'RWB', 'LWB', 'CDM', 'CM', 'CAM', 'RM', 'LM', 'RW', 'LW', 'ST', 'CF']);
const GROUP = { GK: 'GK', CB: 'CB', RB: 'RB', RWB: 'RB', LB: 'LB', LWB: 'LB', CDM: 'CDM', CM: 'CM', CAM: 'CAM', LM: 'LW', LW: 'LW', RM: 'RW', RW: 'RW', ST: 'ST', CF: 'ST' };
const MIN = { GK: 24, CB: 45, RB: 22, LB: 22, CDM: 22, CM: 32, CAM: 18, LW: 22, RW: 22, ST: 24 };
const ATTRS = ['acc', 'spr', 'pos', 'fin', 'spw', 'lsh', 'vol', 'pen', 'vis', 'cro', 'fk', 'spa', 'lpa', 'cur', 'agi', 'bal', 'rea', 'bco', 'dri', 'com', 'int', 'hea', 'daw', 'stt', 'slt', 'jmp', 'sta', 'str', 'agg', 'gkdiv', 'gkhan', 'gkkic', 'gkpos', 'gkref'];
const errs = [];
const err = (p, m) => errs.push(`${p?.id ?? '?'} ${p?.name ?? ''}: ${m}`);
const isStat = (v) => Number.isInteger(v) && v >= 1 && v <= 99;

const ids = new Set(), names = new Set(), counts = {};
for (const p of PLAYERS) {
  if (ids.has(p.id)) err(p, 'duplicate id'); ids.add(p.id);
  if (names.has(p.name)) err(p, 'duplicate name'); names.add(p.name);
  if (!/^[A-Z]{3}$/.test(p.nat ?? '')) err(p, `bad nat ${p.nat}`);
  if (!p.club || !p.league) err(p, 'missing club/league');
  if (!Number.isInteger(p.age) || p.age < 15 || p.age > 45) err(p, `bad age ${p.age}`);
  if (p.height !== null && !(Number.isInteger(p.height) && p.height > 150 && p.height < 215)) err(p, `bad height ${p.height}`);
  if (!['R', 'L'].includes(p.foot)) err(p, `bad foot ${p.foot}`);
  for (const k of ['weakFoot', 'skillMoves']) if (!(Number.isInteger(p[k]) && p[k] >= 1 && p[k] <= 5)) err(p, `bad ${k}`);
  for (const k of ['workAtt', 'workDef']) if (!(p[k] === null || ['H', 'M', 'L'].includes(p[k]))) err(p, `bad ${k}`);
  if (!CODES.has(p.pos)) err(p, `bad pos ${p.pos}`);
  if (!Array.isArray(p.alt) || p.alt.some((c) => !CODES.has(c) || c === p.pos)) err(p, `bad alt ${p.alt}`);
  counts[GROUP[p.pos]] = (counts[GROUP[p.pos]] ?? 0) + 1;
  const face = p.pos === 'GK' ? ['div', 'han', 'kic', 'ref', 'spd', 'gkp'] : ['pac', 'sho', 'pas', 'dri', 'def', 'phy'];
  for (const k of ['ovr', ...face]) if (!isStat(p[k])) err(p, `bad ${k}=${p[k]}`);
  if (p.a) for (const k of ATTRS) if (!(p.a[k] === null || isStat(p.a[k]))) err(p, `bad a.${k}=${p.a[k]}`);
  if (p.a && Object.keys(p.a).some((k) => !ATTRS.includes(k))) err(p, 'unknown attr key');
  if (!(p.mv === null || (Number.isInteger(p.mv) && p.mv > 0))) err(p, `bad mv ${p.mv}`);
  if (p.mv !== null && (p.mvSource !== 'transfermarkt' || !/^\d{4}-\d{2}-\d{2}$/.test(p.mvDate))) err(p, 'bad mvSource/mvDate');
  if (p.mv === null && (p.mvSource !== null || p.mvDate !== null)) err(p, 'mvSource/mvDate without mv');
  const f = p.form;
  if (f !== null) {
    if (!(f.rating === null || (typeof f.rating === 'number' && f.rating >= 1 && f.rating <= 10))) err(p, `bad form.rating ${f.rating}`);
    if (!(Number.isInteger(f.apps) && f.apps >= 1)) err(p, 'bad form.apps');
    if (!Array.isArray(f.last) || f.last.length > 5 || f.last.some((r) => typeof r !== 'number' || r < 1 || r > 10)) err(p, 'bad form.last');
    for (const k of ['minutes', 'goals', 'assists']) if (!(Number.isInteger(f[k]) && f[k] >= 0)) err(p, `bad form.${k}`);
    if (f.source !== 'fotmob' || f.season !== '2026/27' || !/^\d{4}-\d{2}-\d{2}$/.test(f.date)) err(p, 'bad form meta');
  }
}
for (const [g, m] of Object.entries(MIN)) if ((counts[g] ?? 0) < m) errs.push(`group ${g}: ${counts[g] ?? 0} < ${m}`);
for (const g of Object.keys(MIN)) if (DATA_META.counts?.[g] !== counts[g]) errs.push(`DATA_META.counts.${g} mismatch`);

const n = PLAYERS.length, pct = (k) => `${((100 * k) / n).toFixed(1)}%`;
const tr = PLAYERS.filter((p) => p.nat === 'TUR' || p.league === 'Trendyol Süper Lig').length;
const ovr = PLAYERS.map((p) => p.ovr);
console.log(`players: ${n}`, counts);
console.log(`OVR range ${Math.min(...ovr)}-${Math.max(...ovr)}; Süper Lig or Turkish: ${tr}`);
console.log(`coverage: detailed attrs ${pct(PLAYERS.filter((p) => p.a && ATTRS.every((k) => p.a[k] != null)).length)}, height ${pct(PLAYERS.filter((p) => p.height != null).length)}, mv ${pct(PLAYERS.filter((p) => p.mv != null).length)}, form ${pct(PLAYERS.filter((p) => p.form).length)} (form with >=3 apps ${pct(PLAYERS.filter((p) => p.form?.apps >= 3).length)})`);
if (errs.length) { console.error(`${errs.length} problem(s):\n` + errs.slice(0, 50).join('\n')); process.exit(1); }
console.log('OK');
