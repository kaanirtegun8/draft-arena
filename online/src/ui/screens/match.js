// Match centre: summary (goals, assists, cards, stats, ratings, tactical notes)
// and a minute-by-minute replay of the stored event log.
import { h, clear, toast } from '../dom.js';
import { toArray } from '../../core/draft.js';
import { replayFromLog } from '../../core/season.js';
import { fingerprint, MAX_SUBS } from '../../core/engine.js';
import { topbar, seatLabel, posBadge, ratingBadge, openPlayerSheet } from '../components.js';
import { chime } from '../notify.js';

const nm = (api, pid) => (api.byId[pid] ? api.byId[pid].name : '?');
const short = (api, pid) => { const n = nm(api, pid); const p = n.split(' '); return p.length > 1 ? `${p[0][0]}. ${p.slice(1).join(' ')}` : n; };

export function renderMatch(ctx) {
  const { app } = ctx;
  const room = app.room;
  const api = app.api;
  const m = room.season && room.season.matches && room.season.matches[app.params.id];
  if (!m) return h('div', null, topbar('Maç', '', { back: () => ctx.go('room', {}) }), h('div', { class: 'card muted' }, 'Maç bulunamadı veya henüz oynanmadı.'));
  const ui = app.ui.match && app.ui.match.id === m.id ? app.ui.match : (app.ui.match = { id: m.id, tab: 'summary', log: null, loading: false });
  const color = (s) => (room.members[s === 'home' ? m.home : m.away] || {}).color || '#888';
  const team = (s) => (room.members[s === 'home' ? m.home : m.away] || {}).team || '';

  const board = h('div', { class: 'scoreboard' },
    h('div', { class: 'sb-teams' },
      h('div', { class: 'sb-team' }, h('span', { class: 'dot', style: { background: color('home') } }), h('span', { class: 'ellipsis' }, team('home'))),
      h('div', { class: 'sb-score' }, `${m.homeGoals} - ${m.awayGoals}`),
      h('div', { class: 'sb-team away' }, h('span', { class: 'ellipsis' }, team('away')), h('span', { class: 'dot', style: { background: color('away') } }))),
    h('div', { class: 'sb-scorers' },
      h('div', null, toArray(m.goals).filter((g) => g.side === 'home').map((g) => `${short(api, g.playerId)} ${g.label}'`).join(', ')),
      h('div', { class: 'away' }, toArray(m.goals).filter((g) => g.side === 'away').map((g) => `${short(api, g.playerId)} ${g.label}'`).join(', '))));

  const tabs = h('div', { class: 'chips mb' }, [['summary', 'Özet'], ['ratings', 'Puanlar'], ['stats', 'İstatistik'], ['tactics', 'Taktik'], ['watch', '▶︎ Maçı izle']].map(([k, l]) =>
    h('button', { class: `chip ${ui.tab === k ? 'on' : ''}`, onclick: () => { ui.tab = k; if (k === 'watch') ui.ws = null; ctx.render(); } }, l)));

  let body;
  if (ui.tab === 'ratings') body = ratings(ctx, m, team);
  else if (ui.tab === 'stats') body = statsPanel(m, color);
  else if (ui.tab === 'tactics') body = tacticsPanel(m, team);
  else if (ui.tab === 'watch') body = watch(ctx, m, ui, color, team);
  else body = summary(ctx, m, team);
  return h('div', null, topbar(`${m.week}. hafta`, 'Maç merkezi', { back: () => ctx.go('room', {}) }), board, tabs, body);
}

function summary(ctx, m, team) {
  const api = ctx.app.api;
  const ev = [
    ...toArray(m.goals).map((g) => ({ ...g, kind: 'goal' })),
    ...toArray(m.cards).map((c) => ({ ...c, kind: c.type })),
  ].sort((a, b) => parseFloat(a.label) - parseFloat(b.label));
  const motm = m.motm && m.players[m.motm];
  return h('div', null,
    motm ? h('div', { class: 'card award' }, h('div', { class: 'trophy' }, '⭐'), h('div', { class: 'grow' }, h('div', { class: 'small muted' }, 'Maçın oyuncusu'), h('div', { class: 'name' }, nm(api, m.motm)),
      h('div', { class: 'small muted' }, `${team(motm.side)} · ${motm.goals} gol · ${motm.assists} asist`)), ratingBadge(motm.rating)) : null,
    h('div', { class: 'feed' }, ev.length ? ev.map((e) => h('div', { class: `ev ${e.kind} ${e.side === 'away' ? 'away' : ''}` },
      h('span', { class: 'm' }, `${e.label}'`), h('span', { class: 'i' }, e.kind === 'goal' ? '⚽' : e.kind === 'red' ? '🟥' : '🟨'),
      h('span', { class: 'grow' }, e.kind === 'goal' ? h('span', null, h('b', null, nm(api, e.playerId)), e.penalty ? ' (penaltı)' : '', e.assistId ? ` · asist ${nm(api, e.assistId)}` : '') : h('span', null, nm(api, e.playerId), e.second ? ' (ikinci sarı)' : '')))) : h('div', { class: 'card muted small' }, 'Golsüz ve kartsız bir maç.')),
    toArray(m.notes).length ? h('div', { class: 'card small mt' }, toArray(m.notes).map((n) => h('div', null, 'ℹ️ ', n))) : null);
}

function ratings(ctx, m, team) {
  const api = ctx.app.api;
  const col = (side) => h('div', null, h('div', { class: 'small muted mb' }, team(side)), h('div', { class: 'list' },
    Object.entries(m.players || {}).filter(([, x]) => x.side === side && x.played).sort((a, b) => b[1].rating - a[1].rating).map(([pid, x]) =>
      h('button', { class: 'item', style: { minHeight: '44px' }, onclick: () => openPlayerSheet(ctx, pid) }, ratingBadge(x.rating),
        h('div', { class: 'grow' }, h('div', { class: 'small name ellipsis' }, short(api, pid), pid === m.motm ? ' ⭐' : ''),
          h('div', { class: 'meta' }, `${x.minutes}'${x.started ? '' : ' (yedek)'} ${x.goals ? `· ${x.goals}G ` : ''}${x.assists ? `· ${x.assists}A ` : ''}${x.saves ? `· ${x.saves} kurt. ` : ''}${x.yellow ? '🟨' : ''}${x.red ? '🟥' : ''}${x.injured ? '🚑' : ''}`))))));
  return h('div', { class: 'grid2' }, col('home'), col('away'));
}

function statsPanel(m, color) {
  const s = m.teamStats || {};
  const H = s.home || {}, A = s.away || {};
  const row = (label, a, b, f = (v) => v) => {
    const t = (a + b) || 1;
    return h('div', null, h('div', { class: 'statrow' }, h('span', { class: 'v' }, f(a)), h('span', { class: 'lbl' }, label), h('span', { class: 'v' }, f(b))),
      h('div', { class: 'splitbar' }, h('i', { style: { width: `${(a / t) * 100}%`, background: color('home') } }), h('i', { style: { width: `${(b / t) * 100}%`, background: color('away') } })));
  };
  return h('div', { class: 'card' },
    row('Topla oynama %', H.possession || 50, A.possession || 50), row('Şut', H.shots || 0, A.shots || 0), row('İsabetli şut', H.sot || 0, A.sot || 0),
    row('Gol beklentisi (xG)', H.xg || 0, A.xg || 0, (v) => Number(v).toFixed(2)), row('Korner', H.corners || 0, A.corners || 0), row('Kurtarış', H.saves || 0, A.saves || 0),
    row('Faul', H.fouls || 0, A.fouls || 0), row('Sarı kart', H.yellow || 0, A.yellow || 0), row('Kırmızı kart', H.red || 0, A.red || 0), row(`Değişiklik (maks ${MAX_SUBS})`, H.subs || 0, A.subs || 0));
}

function tacticsPanel(m, team) {
  const a = m.analysis || {};
  const list = (side) => h('div', { class: 'card' }, h('h3', null, team(side)), toArray(a[side]).length ? toArray(a[side]).map((n) => h('div', { class: 'note' }, h('span', { class: 'ni' }, n.kind === 'good' ? '✅' : n.kind === 'warn' ? '⚠️' : 'ℹ️'), h('span', null, n.text))) : h('div', { class: 'small muted' }, 'Belirgin yapısal zaaf yoktu.'));
  return h('div', null, h('p', { class: 'small muted' }, 'Maç başındaki taktik yapıya göre motorun tespit ettiği güçlü ve zayıf yönler:'), list('home'), list('away'));
}

// ---------- replay
function visible(e) {
  if (['foul', 'counter', 'corner'].includes(e.type)) return false;
  if (e.type === 'save') return e.xg >= 0.12 || e.penalty;
  if (e.type === 'miss') return e.xg >= 0.25 || e.penalty;
  return true;
}
function describe(api, e, team) {
  const n = (pid) => nm(api, pid);
  const ch = { cross: 'ortaya kafayı vurdu', corner: 'kornerde kafayı vurdu', cutback: 'geri pası vurdu', through: 'ara pasla kaleciyle karşı karşıya', combo: 'paslaşma sonrası vurdu', long: 'uzaktan denedi', counter: 'kontra atakta vurdu', wide: 'kanattan içeri kat edip vurdu' };
  switch (e.type) {
    case 'kickoff': return ['⏱️', 'Maç başladı!'];
    case 'halftime': return ['⏸️', `İlk yarı bitti: ${e.score[0]} - ${e.score[1]}`];
    case 'fulltime': return ['🏁', `Maç bitti: ${e.score[0]} - ${e.score[1]}`];
    case 'goal': return ['⚽', `GOL! ${n(e.playerId)} ${ch[e.chance] || ''}${e.penalty ? ' (penaltı)' : ''}${e.assistId ? ` · Asist: ${n(e.assistId)}` : ''} — ${team(e.side)} (${e.score[0]}-${e.score[1]})`];
    case 'save': return ['🧤', `${e.keeperId ? n(e.keeperId) : 'Kaleci'} kurtardı! ${n(e.playerId)} ${ch[e.chance] || 'vurdu'}.`];
    case 'miss': return ['💨', `${e.penalty ? 'Penaltı kaçtı! ' : 'Büyük fırsat! '}${n(e.playerId)} ${ch[e.chance] || 'vurdu'} ama auta gitti.`];
    case 'yellow': return ['🟨', `${n(e.playerId)} sarı kart${e.second ? ' (ikinci sarı)' : ''}.`];
    case 'red': return ['🟥', `${n(e.playerId)} ${e.kind === 'second' ? 'ikinci sarıdan' : 'direkt'} kırmızı kart gördü!`];
    case 'injury': return ['🚑', `${n(e.playerId)} sakatlandı (${e.weeks} hafta).`];
    case 'down': return ['⚠️', `${n(e.playerId)} devam edemiyor; değişiklik hakkı kalmadı.`];
    case 'sub': return ['🔁', `${n(e.in)} girdi, ${n(e.out)} çıktı.`];
    default: return null;
  }
}

function watch(ctx, m, ui, color, team) {
  const { app } = ctx;
  const api = app.api;
  const wrap = h('div');
  if (!ui.log && !ui.loading) {
    ui.loading = true;
    api.getLog(app.code, m.id).then((log) => { ui.log = log; ui.loading = false; if (log) { ui.verified = fingerprint(replayFromLog(log)) === m.fp; } ctx.render(); })
      .catch((e) => { ui.loading = false; toast(e.message, 'err'); });
  }
  if (!ui.log) { wrap.appendChild(h('div', { class: 'card muted center' }, 'Maç kaydı yükleniyor…')); return wrap; }
  const events = toArray(ui.log.events);
  const ht = events.find((e) => e.type === 'halftime'), ft = events.find((e) => e.type === 'fulltime');
  const ticks = [{ m: 0, x: 0, label: "0'" }];
  for (let i = 1; i <= 45; i++) ticks.push({ m: i, x: 0, label: `${i}'` });
  for (let i = 1; i <= ht.extra; i++) ticks.push({ m: 45, x: i, label: `45+${i}'` });
  ticks.push({ sp: 'ht', label: 'Devre arası' });
  for (let i = 46; i <= 90; i++) ticks.push({ m: i, x: 0, label: `${i}'` });
  for (let i = 1; i <= ft.extra; i++) ticks.push({ m: 90, x: i, label: `90+${i}'` });
  ticks.push({ sp: 'ft', label: 'Maç sonu' });
  let ti = 0;
  const evTick = events.map((e) => {
    if (e.type === 'kickoff') return 0;
    if (e.type === 'halftime') { ti = ticks.findIndex((t) => t.sp === 'ht'); return ti; }
    if (e.type === 'fulltime') return ticks.length - 1;
    const k = ticks.findIndex((t, i) => i >= ti && !t.sp && t.m === e.minute && t.x === (e.extra || 0));
    if (k >= 0) ti = k;
    return ti;
  });
  const last = ticks.length - 1;
  // playback state survives re-renders caused by other room updates
  const st = ui.ws || (ui.ws = { tick: 0, playing: true, speed: app.ui.speed || 2 });
  const score = h('div', { class: 'sb-score' }, '0 - 0');
  const minute = h('div', { class: 'sb-minute' }, "0'");
  const prog = h('i');
  const feed = h('div', { class: 'feed' });
  const play = h('button', { class: 'btn sm' });
  const speed = h('div', { class: 'seg' });
  const draw = (full) => {
    const evs = events.filter((e, i) => evTick[i] <= st.tick);
    const g = evs.filter((e) => e.type === 'goal');
    score.textContent = `${g.filter((x) => x.side === 'home').length} - ${g.filter((x) => x.side === 'away').length}`;
    minute.textContent = ticks[st.tick].label;
    prog.style.width = `${(st.tick / last) * 100}%`;
    if (full) { clear(feed); evs.filter(visible).slice().reverse().forEach((e) => feed.appendChild(item(e))); }
    play.textContent = st.tick >= last ? '↺ Baştan' : st.playing ? '❚❚ Duraklat' : '▶︎ Oynat';
  };
  const item = (e) => {
    const d = describe(api, e, team);
    if (!d) return h('span');
    const neutral = ['kickoff', 'halftime', 'fulltime'].includes(e.type);
    return h('div', { class: `ev ${e.type} ${neutral ? 'neutral' : ''}` }, neutral ? null : h('span', { class: 'm' }, `${e.label}'`), h('span', { class: 'i' }, d[0]),
      h('span', { class: 'grow' }, neutral ? null : h('span', { class: 'dot', style: { background: color(e.side), marginRight: '6px' } }), d[1]));
  };
  let timer = null;
  const schedule = () => { clearTimeout(timer); if (st.playing && st.tick < last) timer = setTimeout(step, (ticks[st.tick].sp === 'ht' ? 2100 : 700) / st.speed); };
  const step = () => {
    if (!document.body.contains(wrap)) return;
    st.tick++;
    const fresh = events.filter((e, i) => evTick[i] === st.tick);
    for (const e of fresh.filter(visible)) feed.insertBefore(item(e), feed.firstChild);
    if (fresh.some((e) => e.type === 'goal')) { chime('goal'); score.classList.remove('flash'); void score.offsetWidth; score.classList.add('flash'); }
    if (st.tick >= last) st.playing = false;
    draw(false);
    schedule();
  };
  play.onclick = () => { if (st.tick >= last) { st.tick = 0; st.playing = true; draw(true); } else st.playing = !st.playing; draw(false); schedule(); };
  for (const [v, l] of [[1, '1x'], [2, '2x'], [4, '4x'], [10, '10x']]) speed.appendChild(h('button', { class: st.speed === v ? 'on' : '', onclick: (e) => { st.speed = v; app.ui.speed = v; [...speed.children].forEach((b) => b.classList.remove('on')); e.target.classList.add('on'); schedule(); } }, l));
  app.cleanup = () => clearTimeout(timer);
  wrap.append(
    h('div', { class: 'card' }, h('div', { class: 'row between' }, score, minute), h('div', { class: 'sb-progress' }, prog)),
    h('div', { class: 'row wrap mb', style: { gap: '8px' } }, play, speed, h('button', { class: 'btn sm primary', onclick: () => { st.tick = last; st.playing = false; draw(true); } }, '⏭ Sona git')),
    ui.verified === false ? h('div', { class: 'banner warn' }, 'Uyarı: kayıt yeniden simüle edildiğinde farklı çıktı.') : h('div', { class: 'mini mb' }, '✓ Aynı seed ile yeniden hesaplandı, sonuç birebir aynı.'),
    feed);
  draw(true);
  schedule();
  return wrap;
}

export { posBadge, seatLabel };
