// Player roles per position (like "false nine", "target man", "anchor man").
// Each role changes how the player's abilities feed the team units, which
// chance types the team creates, who shoots, stamina use, fouls and the
// exposure to counter-attacks. Role fit (0..1) comes from the player's attributes:
// a good fit amplifies the upside, a poor fit weakens it.
const c = (v) => Math.max(0, Math.min(1, v));
const n = (x, lo = 55, hi = 90) => c((x - lo) / (hi - lo));

// mods: multipliers on this player's contributions (attSide, attC, defSide, defC, control, press)
// add: additive team effects (central, anchors, exposure), mix: chance-type weights, shoot/assist: multipliers
export const ROLES = {
  // goalkeepers
  gk: { label: 'Klasik kaleci', desc: 'Kalesinde kalır, risk almaz.', fit: (a) => n(a.keeping) },
  sweeper: { label: 'Libero kaleci', desc: 'Savunmanın arkasını süpürür, oyuna katılır. Yüksek savunma hattıyla uyumlu; hatası pahalıya patlayabilir.', mods: { control: 1.6 }, add: { exposure: -0.12 }, fit: (a) => n(a.sweeping, 50, 85) },
  // centre-backs
  cb: { label: 'Klasik stoper', desc: 'Pozisyonunu korur, hava toplarında güçlü.', fit: (a) => n((a.defending + a.aerialDef) / 2) },
  bpd: { label: 'Oyun kurucu stoper', desc: 'Topu geriden çıkarır, uzun paslarla oyunu kurar.', mods: { control: 2.0, defC: 0.96 }, mix: { through: 0.05, long: 0.03 }, assist: 1.3, fit: (a) => n(a.passing, 55, 85) },
  stopper: { label: 'Sert stoper (öne çıkar)', desc: 'Forvete önde basar, top kapar ama faul ve arkada boşluk riski var.', mods: { defC: 1.06, press: 1.5 }, add: { exposure: 0.05 }, foul: 1.35, fit: (a) => n((a.defending + a.aggression + a.strength) / 3) },
  cover: { label: 'Süpürücü stoper', desc: 'Partnerinin arkasını kollar; hızlı forvetlere karşı etkili.', mods: { defC: 1.02 }, add: { exposure: -0.1 }, fit: (a) => n(a.pace, 55, 85) },
  // full-backs
  fb: { label: 'Dengeli bek', desc: 'Hem hücuma çıkar hem geri döner.', fit: (a) => n((a.defending + a.pace + a.crossing) / 3) },
  dfb: { label: 'Savunmacı bek', desc: 'Geride kalır, kanadı kapatır; hücuma katkısı az.', mods: { defSide: 1.15, attSide: 0.35 }, add: { exposure: -0.04 }, fit: (a) => n(a.defending) },
  wbk: { label: 'Bindiren bek', desc: 'Sürekli kanattan bindirir, orta açar; arkası boşalır.', mods: { attSide: 1.7, defSide: 0.82 }, add: { exposure: 0.07 }, mix: { cross: 0.12 }, assist: 1.4, drain: 1.12, fit: (a) => n((a.pace + a.crossing + a.stamina) / 3) },
  ifb: { label: 'İçe kat eden bek', desc: 'Topla içeri girip orta sahaya katılır; merkez kalabalıklaşır, kanat hücumu azalır.', mods: { attSide: 0.5, defC: 1.06, defSide: 0.9, control: 2.2 }, add: { central: 0.6 }, fit: (a) => n((a.passing + a.defending) / 2) },
  wbd: { label: 'Savunmacı kanat bek', desc: 'Beşli savunmada geri çekilir.', mods: { defSide: 1.15, attSide: 0.75 }, fit: (a) => n((a.defending + a.stamina) / 2) },
  wba: { label: 'Hücumcu kanat bek', desc: 'Kanadın tamamını tek başına kullanır.', mods: { attSide: 1.25, defSide: 0.85 }, add: { exposure: 0.05 }, mix: { cross: 0.1 }, assist: 1.3, drain: 1.12, fit: (a) => n((a.pace + a.crossing + a.stamina) / 3) },
  // defensive midfield
  anchor: { label: 'Ön libero (çapa)', desc: 'Stoperlerin önünde sabit durur, boşlukları kapatır. Hücuma neredeyse çıkmaz.', mods: { defC: 1.18, control: 0.9, attC: 0.4 }, add: { anchors: 0.6, exposure: -0.06 }, fit: (a) => n((a.defending * 2 + a.aerialDef) / 3) },
  dlp: { label: 'Derin oyun kurucu (regista)', desc: 'Oyunu geriden yönlendirir, ara ve uzun paslarla hücum başlatır.', mods: { control: 1.3, defC: 0.88, attC: 1.4 }, mix: { through: 0.08, long: 0.04 }, assist: 1.4, fit: (a) => n((a.passing * 2 + a.creation) / 3) },
  bwm: { label: 'Top kapıcı', desc: 'Agresif basar, top kapar; faul ve sarı kart riski yüksek.', mods: { press: 1.6, defC: 1.06, control: 0.92 }, foul: 1.35, drain: 1.1, fit: (a) => n((a.defending + a.aggression + a.stamina) / 3) },
  halfback: { label: 'Stoperler arasına inen pivot', desc: 'Topla oyunda stoperlerin arasına iner; bekler daha rahat hücuma çıkar.', mods: { defC: 1.12, defSide: 1.05, control: 1.05, attC: 0.4 }, add: { anchors: 0.5, exposure: -0.08 }, fit: (a) => n((a.defending + a.passing) / 2) },
  // central midfield
  b2b: { label: 'Box-to-box', desc: 'Her iki ceza sahasında da var; çok koşar.', mods: { attC: 1.3, defC: 1.12 }, mix: { long: 0.05 }, shoot: 1.25, drain: 1.08, fit: (a) => n((a.stamina + a.defending + a.finishing) / 3) },
  cmp: { label: 'Oyun kurucu', desc: 'Pas trafiğini yönetir, kilit pasları atar.', mods: { control: 1.25, attC: 1.15, defC: 0.88 }, mix: { through: 0.07 }, assist: 1.4, fit: (a) => n((a.passing + a.creation) / 2) },
  mezzala: { label: 'Mezzala (yarım alana kayan)', desc: 'Kanat ile merkez arasındaki boşluğa koşar, ceza sahasına girer.', mods: { attC: 1.2, defC: 0.82, attSide: 1 }, sideAtt: 0.35, mix: { cutback: 0.06 }, shoot: 1.3, fit: (a) => n((a.dribbling + a.creation + a.finishing) / 3) },
  cmd: { label: 'Savunmacı orta saha', desc: 'Geride kalır, ön liberoya yardım eder.', mods: { defC: 1.18, attC: 0.6 }, add: { anchors: 0.5 }, fit: (a) => n(a.defending) },
  // attacking midfield
  am: { label: 'On numara', desc: 'Forvetin arkasında oyunu kurar, son pası atar.', mods: { attC: 1.1, control: 1.1, defC: 0.7 }, mix: { through: 0.06 }, assist: 1.3, fit: (a) => n((a.creation + a.passing) / 2) },
  shadow: { label: 'Gölge forvet', desc: 'Forvetin arkasından ceza sahasına koşar, gol arar.', mods: { attC: 1.2, control: 0.85, defC: 0.5 }, teamDef: 0.98, mix: { combo: 0.06 }, shoot: 1.5, fit: (a) => n((a.finishing + a.pace) / 2) },
  treq: { label: 'Serbest oyuncu (trequartista)', desc: 'Savunma yapmaz, istediği yerde top ister. Yaratıcı ama takıma yük.', mods: { attC: 1.28, control: 1.05, defC: 0, defSide: 0, press: 0.35 }, teamDef: 0.95, add: { exposure: 0.08 }, mix: { through: 0.06 }, shoot: 1.15, assist: 1.3, fit: (a) => n((a.creation + a.dribbling + a.composure) / 3) },
  // wide midfield / wingers
  wm: { label: 'Kanat orta saha', desc: 'Kanadı hem hücumda hem savunmada kullanır.', fit: (a) => n((a.crossing + a.stamina + a.defending) / 3) },
  dwm: { label: 'Savunmacı kanat', desc: 'Beki korur, kanadı kapatır.', mods: { defSide: 1.5, attSide: 0.82 }, add: { exposure: -0.05 }, work: 0.9, fit: (a) => n((a.defending + a.stamina) / 2) },
  wp: { label: 'Kanat oyun kurucu', desc: 'Kanattan içeri girip oyunu kurar.', mods: { control: 1.8, attSide: 0.9 }, sideAtt: -0.0, centralAtt: 0.25, mix: { through: 0.05, cutback: 0.04 }, assist: 1.3, fit: (a) => n((a.passing + a.creation) / 2) },
  winger: { label: 'Klasik kanat (çizgiye iner, orta açar)', desc: 'Çizgiye kadar gidip ortalar; hedef forvetle iyi çalışır.', mods: { attSide: 1.15, defSide: 0.9 }, mix: { cross: 0.15 }, shoot: 0.8, assist: 1.4, fit: (a) => n((a.pace + a.crossing + a.dribbling) / 3) },
  inside: { label: 'İçe kat eden forvet', desc: 'Ters ayağına kat edip şut çeker; gol yükü taşır.', mods: { attSide: 0.85, attC: 1.3, defSide: 0.88 }, mix: { wide: 0.12, cutback: 0.04 }, shoot: 1.45, fit: (a) => n((a.finishing + a.dribbling) / 2) },
  invw: { label: 'Ters kanat (içeri girip pas atar)', desc: 'İçeri kat edip oyun kurar, ara pası arar.', mods: { attSide: 0.9, attC: 1.15, control: 1.3, defSide: 0.92 }, mix: { cutback: 0.08, through: 0.05 }, assist: 1.3, fit: (a) => n((a.creation + a.dribbling) / 2) },
  trackback: { label: 'Savunmaya dönen kanat', desc: 'Topu kaybedince hemen geri döner, beki yalnız bırakmaz.', mods: { attSide: 0.88, defSide: 1.6 }, work: 0.95, drain: 1.08, fit: (a) => n((a.stamina + a.defending + a.pressing) / 3, 45, 85) },
  // strikers
  complete: { label: 'Komple forvet', desc: 'Her şeyi yapar: bağlantı, şut, kafa.', mods: { attC: 1.05, control: 1.2 }, shoot: 1.1, fit: (a) => n((a.finishing + a.passing + a.strength + a.dribbling) / 4) },
  poacher: { label: 'Golcü (ceza sahası forveti)', desc: 'Sadece ceza sahasında yaşar, gol atar; oyuna katkısı az.', mods: { attC: 1.15, control: 0.5, press: 0.6 }, teamDef: 0.98, mix: { cutback: 0.06, combo: 0.03 }, shoot: 1.3, fit: (a) => n((a.finishing * 2 + a.composure) / 3) },
  target: { label: 'Hedef forvet (pivot)', desc: 'Sırtı dönük top saklar, hava toplarını kazanır. Kanatlardan orta gelirse çok etkili.', mods: { attC: 1.05, control: 1.15 }, mix: { cross: 0.25, through: -0.08 }, shootCross: 1.7, fit: (a) => n((a.aerialAtt * 2 + a.strength) / 3, 55, 88) },
  f9: { label: 'Sahte 9', desc: 'Orta sahaya geriler, stoperleri yerinden oynatır, kanatlar ve orta sahacılar boşluğa koşar.', mods: { attC: 1.05, control: 1.9 }, add: { central: 0.8 }, mix: { through: 0.15, combo: 0.08, cross: -0.15 }, shoot: 0.6, assist: 1.7, fit: (a) => n((a.passing + a.creation + a.dribbling) / 3) },
  pressf: { label: 'Pres forvet', desc: 'Önde durmadan basar, rakibin oyun kurmasını bozar; çok yorulur.', mods: { press: 1.8, attC: 0.97 }, add: { oppControl: -0.05 }, drain: 1.12, fit: (a) => n((a.pressing + a.stamina) / 2, 45, 85) },
  advanced: { label: 'Arkaya koşan forvet', desc: 'Savunmanın arkasına sürekli koşu yapar; yüksek hatla oynayan rakiplere karşı öldürücü.', mods: { attC: 1.1, control: 0.75 }, mix: { through: 0.2 }, shootThrough: 1.4, counter: 1.25, fit: (a) => n(a.pace, 60, 92) },
};

export const ROLES_BY_SLOT = {
  GK: ['gk', 'sweeper'],
  CB: ['cb', 'bpd', 'stopper', 'cover'],
  LB: ['fb', 'dfb', 'wbk', 'ifb'], RB: ['fb', 'dfb', 'wbk', 'ifb'],
  LWB: ['wba', 'wbd'], RWB: ['wba', 'wbd'],
  CDM: ['anchor', 'dlp', 'bwm', 'halfback'],
  CM: ['b2b', 'cmp', 'bwm', 'mezzala', 'cmd'],
  CAM: ['am', 'shadow', 'treq'],
  LM: ['wm', 'dwm', 'wp', 'winger'], RM: ['wm', 'dwm', 'wp', 'winger'],
  LW: ['winger', 'inside', 'invw', 'trackback'], RW: ['winger', 'inside', 'invw', 'trackback'],
  ST: ['complete', 'poacher', 'target', 'f9', 'pressf', 'advanced'],
  CF: ['f9', 'complete', 'shadow', 'target'],
};

export function rolesFor(slotCode) { return ROLES_BY_SLOT[slotCode] || []; }
export function defaultRole(slotCode) { return (ROLES_BY_SLOT[slotCode] || [])[0] || null; }
export function validRole(slotCode, key) { return key && rolesFor(slotCode).includes(key) ? key : defaultRole(slotCode); }
export function roleDef(key) { return ROLES[key] || null; }

// 0..1 suitability of a player (abilities object) for a role
export function roleFit(key, ab) {
  const r = ROLES[key];
  if (!r || !r.fit) return 0.6;
  return Math.round(c(r.fit(ab)) * 100) / 100;
}

export function fitStars(fit) { return fit >= 0.8 ? 5 : fit >= 0.62 ? 4 : fit >= 0.45 ? 3 : fit >= 0.28 ? 2 : 1; }

// Scale a role multiplier by fit: upside depends on fit, downside is always paid.
export function scaledMod(m, fit) {
  if (m == null) return 1;
  if (m <= 1) return m;
  return 1 + (m - 1) * (0.3 + 0.7 * fit);
}
