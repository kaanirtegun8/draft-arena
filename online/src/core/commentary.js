// Match commentary: turns engine events into short Turkish lines.
// Pure functions; phrase variety is picked by a hash of the event, so every phone
// shows exactly the same text for the same match.

function hash(str) {
  let x = 2166136261;
  for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); }
  return x >>> 0;
}
const pick = (arr, e, salt = '') => arr[hash(`${e.minute}|${e.extra || 0}|${e.playerId || ''}|${e.type}|${salt}`) % arr.length];

const ZONE_FROM = { L: 'sol kanattan', C: 'merkezden', R: 'sağ kanattan' };
const ZONE_FLANK = { L: 'sol kanatta', C: 'ceza sahası önünde', R: 'sağ kanatta' };

export function isShot(e) { return e && (e.type === 'goal' || e.type === 'save' || e.type === 'miss'); }

// Shots worth showing as a two-step "danger -> outcome" moment.
export function shotShown(e) {
  if (!isShot(e)) return false;
  if (e.type === 'goal' || e.penalty || e.setPiece === 'penalty' || e.chance === 'freekick') return true;
  return (e.xg || 0) >= 0.12;
}

const isPen = (e) => !!(e.penalty || e.setPiece === 'penalty');

// First line of a moment: the build-up, before the result is known.
export function dangerLine(e, name, team, ctx = {}) {
  const sh = name(e.playerId);
  const cr = e.creatorId ? name(e.creatorId) : null;
  const tm = team(e.side);
  const z = ZONE_FROM[e.zone] || '';
  if (isPen(e)) {
    const fouler = ctx.foulerId ? name(ctx.foulerId) : null;
    return { icon: '⚠️', text: fouler ? `PENALTI! ${fouler} ceza sahasında rakibini düşürdü. Topun başında ${sh}…` : pick([`PENALTI ${tm} için! Topun başında ${sh}…`, `Hakem penaltı noktasını gösterdi! ${sh} topu yerleştiriyor…`], e) };
  }
  if (e.chance === 'freekick') {
    return { icon: '🎯', text: pick([`Frikik! ${sh} topun başında, ceza sahası yayına yakın bir mesafe…`, `Tehlikeli bölgede frikik ${tm} lehine. ${sh} topu yerleştirdi, baraj kuruluyor…`, `Frikik! ${sh} kaleye bakıyor, direkt vuracak gibi…`], e) };
  }
  if (e.setPiece === 'freekick' && cr) {
    return { icon: '⚠️', text: pick([`Frikik! ${cr} ceza sahasına ortaladı, ${sh} yükseliyor…`, `${cr} frikikten içeri gönderdi, ceza sahasında karambol…`], e) };
  }
  switch (e.chance) {
    case 'corner':
      return { icon: '⚠️', text: cr ? pick([`Korner! ${cr} ortaladı, ${sh} yükseliyor…`, `${cr} kornerden içeri kıvırdı, ceza sahası karışık…`, `Korner ${tm} için. ${cr} kullanıyor… ${sh} kafayı vurabilir!`], e) : `Korner ${tm} için. Ceza sahasında karambol…` };
    case 'cross':
      return { icon: '⚠️', text: cr ? pick([`Tehlike! ${cr} ${z} ortaladı…`, `${cr} ${z} içeri çevirdi, ${sh} topa doğru koşuyor…`, `Tehlike! ${cr} çizgiye kadar indi ve ortaladı…`], e) : `Tehlike! ${tm} ${z} ortaladı…` };
    case 'cutback':
      return { icon: '⚠️', text: cr ? pick([`${cr} çizgiye indi, geri çevirdi… ${sh} bomboş!`, `Tehlike! ${cr} son çizgiden geriye çıkardı…`], e) : `Tehlike! Son çizgiden geri çevrilen top ${sh} önünde…` };
    case 'through':
      return { icon: '⚠️', text: cr ? pick([`${cr} müthiş bir ara pas attı! ${sh} kaleciyle karşı karşıya…`, `Tehlike! ${cr} savunmanın arkasına attı, ${sh} kaçtı…`, `${cr}'den derin pas… ${sh} tek başına kaleye gidiyor!`], e) : `Tehlike! ${sh} savunmanın arkasına sarktı, kaleciyle karşı karşıya…` };
    case 'counter':
      return { icon: '⚡', text: pick([`Kontra atak! ${tm} hızlı çıkıyor… ${cr ? `${cr} ileri taşıdı, ` : ''}${sh} ceza sahasında!`, `Hızlı hücum ${tm}! Savunma dengesiz yakalandı, top ${sh}'de…`, `Kontra! ${sh} boş alanda koşuyor…`], e) };
    case 'long':
      return { icon: '⚠️', text: pick([`${sh} ceza sahası dışından şutunu çekiyor…`, `Uzaktan deneme! ${sh} gelişine vurdu…`, `${sh} biraz ilerledi ve sert vurdu…`], e) };
    case 'wide':
      return { icon: '⚠️', text: pick([`${sh} ${ZONE_FLANK[e.zone] || 'kanatta'} içeri kat ediyor…`, `Tehlike! ${sh} adamını geçti, ceza sahasına girdi…`], e) };
    default:
      return { icon: '⚠️', text: cr ? pick([`Tehlike! ${cr} ile ${sh} ceza sahası önünde paslaştı…`, `${tm} ceza sahasına yerleşti, ${cr} pası verdi, ${sh} pozisyonda…`, `Tehlike! ${sh} ${cr}'nin pasıyla şut pozisyonunda…`], e) : pick([`Tehlike! ${tm} ceza sahasına yerleşti, ${sh} pozisyonda…`, `${sh} çalımı attı, vuruş pozisyonunda…`], e) };
  }
}

const HOW = {
  cross: ['kafayla ağlara gönderdi', 'harika bir kafa vuruşuyla filelere yolladı', 'yükseldi ve kafayı vurdu'],
  corner: ['kafayla ağlara gönderdi', 'kornerden gelen topu kafayla tamamladı', 'en yüksek sıçrayan oydu, top ağlarda'],
  cutback: ['bomboş vurdu, gol', 'gelişine vurdu, top ağlarda', 'plaseyle köşeye bıraktı'],
  through: ['kaleciyi de geçip topu ağlara yolladı', 'kaleciyle karşı karşıya affetmedi', 'soğukkanlı bir vuruşla köşeye yerleştirdi'],
  combo: ['şık bir vuruşla köşeye bıraktı', 'sert vurdu, top ağlarda', 'plaseyle golü buldu'],
  long: ['uzaktan füze! Top doksana gitti', 'ceza sahası dışından muhteşem bir gol', 'uzaktan vurdu, kaleci çaresiz'],
  counter: ['kontrayı golle bitirdi', 'hızlı hücumu ağlarla buluşturdu', 'kaleciyi avlayıp topu ağlara yolladı'],
  wide: ['içeri kat edip uzak köşeye yolladı', 'dar açıdan ağları buldu', 'kat etti ve vurdu: gol'],
  freekick: ['frikikten muhteşem bir gol attı! Top barajın üstünden ağlara', 'frikiği doksana astı', 'frikikte kaleciyi avladı'],
};

// Second line of a moment: the result.
export function outcomeLine(e, name, team) {
  const sh = name(e.playerId);
  const score = e.score ? ` (${e.score[0]}-${e.score[1]})` : '';
  if (e.type === 'goal') {
    const how = isPen(e) ? pick(['penaltıyı gole çevirdi', 'penaltıda kaleciyi ters köşeye yatırdı', 'penaltıyı soğukkanlılıkla attı'], e, 'g') : pick(HOW[e.chance] || HOW.combo, e, 'g');
    const asst = e.assistId ? ` Asist: ${name(e.assistId)}.` : '';
    return { icon: '⚽', text: `GOOOL! ${sh} ${how}!${asst} ${team(e.side)}${score}`, goal: true };
  }
  if (e.type === 'save') {
    const gk = e.keeperId ? name(e.keeperId) : 'Kaleci';
    if (isPen(e)) return { icon: '🧤', text: pick([`${gk} penaltıyı kurtardı! Doğru köşeye uçtu!`, `KURTARDI! ${gk} ${sh}'nin penaltısını çıkardı!`], e, 's') };
    return { icon: '🧤', text: pick([`${gk} uçtu, kurtardı!`, `${gk} son anda müdahale etti, top kornere!`, `Müthiş kurtarış! ${gk} gole izin vermedi.`, `${gk} yerinde, topu kontrol etti.`], e, 's') };
  }
  if (isPen(e)) return { icon: '💨', text: pick([`Penaltı kaçtı! ${sh} topu auta gönderdi!`, `İnanılmaz! ${sh} penaltıda direği dövdü!`], e, 'm') };
  return { icon: '💨', text: pick(['Az farkla dışarı!', 'Top direğin yanından auta gitti.', `${sh} çok iyi vurdu ama top üstten auta.`, 'Direkten döndü!', 'Savunma son anda araya girdi, tehlike geçti.'], e, 'm') };
}

const SUB_REASON = (r) => {
  if (!r) return '';
  if (r === 'injury') return 'sakatlık';
  if (r.includes('fatigue')) return 'yorgunluk';
  if (r === 'auto:chase') return 'taktik: hücum hamlesi';
  if (r === 'rule:yellow') return 'kart riski';
  if (r === 'gk-red') return 'kırmızı kart sonrası kaleci girdi';
  return 'taktik';
};

// Single-line events (not shots). Returns null for events not worth showing.
export function eventLine(e, name, team, ctx = {}) {
  switch (e.type) {
    case 'kickoff': {
      const caps = e.captains ? ['home', 'away'].filter((s) => e.captains[s]).map((s) => `${team(s)} kaptanı ${name(e.captains[s])}`).join(', ') : '';
      return { icon: '⏱️', text: `Maç başladı!${caps ? ` ${caps}.` : ''}`, neutral: true };
    }
    case 'halftime': return { icon: '⏸️', text: `İlk yarı sona erdi: ${score(e, team)}`, neutral: true };
    case 'fulltime': return { icon: '🏁', text: `Maç bitti: ${score(e, team)}`, neutral: true };
    case 'sub': {
      const why = SUB_REASON(e.reason);
      return { icon: '🔁', text: `${team(e.side)} değişiklik — ⬆️ ${name(e.in)} girdi, ⬇️ ${name(e.out)} çıktı${why ? ` (${why})` : ''}.` };
    }
    case 'yellow': return { icon: '🟨', text: e.second ? `${name(e.playerId)} ikinci sarı kartı gördü!` : pick([`${name(e.playerId)} sarı kart gördü.`, `Sert müdahale: ${name(e.playerId)} sarı kartla cezalandırıldı.`], e) };
    case 'red': return { icon: '🟥', text: e.kind === 'second' ? `${name(e.playerId)} ikinci sarıdan oyun dışı! ${team(e.side)} 10 kişi.` : `DİREKT KIRMIZI! ${name(e.playerId)} oyundan atıldı! ${team(e.side)} eksik kaldı.` };
    case 'injury': return { icon: '🚑', text: `${name(e.playerId)} sakatlandı${e.weeks ? ` (${e.weeks} hafta yok)` : ''}.` };
    case 'down': return { icon: '⚠️', text: `${name(e.playerId)} devam edemiyor; ${team(e.side)} değişiklik hakkı kalmadığı için eksik.` };
    default: return null;
  }
  function score(ev, tm) { return ev.score ? `${tm('home')} ${ev.score[0]} - ${ev.score[1]} ${tm('away')}` : ''; }
}

// Builds the ordered list of moments for one match.
// Each moment: { ei (event index, for timing), side, kind: 'shot'|'line', pre, post, line, event }
export function buildMoments(events, name, team) {
  const out = [];
  let pen = null;
  events.forEach((e, ei) => {
    if (!e) return;
    if (e.type === 'penalty') { pen = e; return; }
    if (['freekick', 'corner', 'foul', 'counter', 'miss', 'save', 'goal'].includes(e.type) && !isShot(e)) return;
    if (isShot(e)) {
      const ctx = isPen(e) && pen ? { foulerId: pen.foulerId } : {};
      if (isPen(e)) pen = null;
      if (!shotShown(e)) return;
      out.push({ ei, side: e.side, kind: 'shot', pre: dangerLine(e, name, team, ctx), post: outcomeLine(e, name, team), event: e });
      return;
    }
    const line = eventLine(e, name, team);
    if (line) out.push({ ei, side: e.side, kind: 'line', line, event: e });
  });
  return out;
}
