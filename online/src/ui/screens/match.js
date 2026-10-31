// Match centre: summary (goals, assists, cards, stats, ratings, tactical notes)
// and a minute-by-minute replay of the stored event log.
import { h, clear, toast } from '../dom.js';
import { toArray } from '../../core/draft.js';
import { replayFromLog } from '../../core/season.js';
import { fingerprint, MAX_SUBS, ENGINE_VERSION } from '../../core/engine.js';
import { matchReport } from '../../core/report.js';
import { topbar, seatLabel, posBadge, ratingBadge, openPlayerSheet } from '../components.js';
import { chime } from '../notify.js';
import { buildMoments } from '../../core/commentary.js';
import { clockNow, isLiveMatch } from '../livestate.js';
import { eventTicks, goalOverlay } from './live.js';

const nm = (api, pid) => (api.byId[pid] ? api.byId[pid].name : '?');
const short = (api, pid) => { const n = nm(api, pid); const p = n.split(' '); return p.length > 1 ? `${p[0][0]}. ${p.slice(1).join(' ')}` : n; };

export function renderMatch(ctx) {
  const { app } = ctx;
  const room = app.room;
  const api = app.api;
  const m = room.season && room.season.matches && room.season.matches[app.params.id];
  if (!m) return h('div', null, topbar('Maç', '', { back: () => ctx.go('room', {}) }), h('div', { class: 'card muted' }, 'Maç bulunamadı veya henüz oynanmadı.'));
  const liveW = isLiveMatch(room, m.id, clockNow(app));
  if (liveW) {
    return h('div', null, topbar(`${liveW}. hafta`, 'Maç merkezi', { back: () => ctx.go('room', {}) }),
      h('div', { class: 'card center' }, h('h3', null, '🔴 Yayın sürüyor'), h('p', { class: 'small muted' }, 'Bu maç şu an canlı yayında. Sonuç ve istatistikler yayın bitince açılır.'),
        h('button', { class: 'btn primary block', onclick: () => ctx.go('room', { sub: 'live', week: liveW }) }, '▶︎ Canlı yayına git')));
  }
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

  const tabs = h('div', { class: 'chips mb' }, [['summary', 'Özet'], ['analysis', '🧠 Analiz'], ['ratings', 'Puanlar'], ['stats', 'İstatistik'], ['tactics', 'Taktik'], ['watch', '▶︎ Maçı izle']].map(([k, l]) =>
    h('button', { class: `chip ${ui.tab === k ? 'on' : ''}`, onclick: () => { ui.tab = k; if (k === 'watch') ui.ws = null; ctx.render(); } }, l)));

  let body;
  if (ui.tab === 'ratings') body = ratings(ctx, m, team);
  else if (ui.tab === 'stats') body = statsPanel(m, color);
  else if (ui.tab === 'tactics') body = tacticsPanel(m, team);
  else if (ui.tab === 'analysis') body = analysisPanel(ctx, m, team);
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

function analysisPanel(ctx, m, team) {
  const r = matchReport(m, { home: team('home'), away: team('away') }, ctx.app.api.byId);
  const su = m.setup;
  const STYLE = { possession: 'Pas oyunu', balanced: 'Dengeli', direct: 'Direkt', counter: 'Kontra' };
  return h('div', null,
    su ? h('div', { class: 'grid2 mb' }, ['home', 'away'].map((s) => h('div', { class: 'card small', style: { margin: 0 } },
      h('b', null, team(s)), h('div', null, su[s].formation, ' · ', STYLE[(su[s].instructions || {}).style] || 'Dengeli'),
      h('div', { class: 'mini' }, toArray(su[s].slots).filter((x) => x.role).length ? `${toArray(su[s].slots).filter((x) => x.role).length} oyuncuya özel rol` : 'Standart roller')))) : null,
    r.sections.map((sec) => h('div', { class: 'card' }, h('h3', null, sec.title), sec.items.map((it) => h('p', { class: 'small', style: { margin: '6px 0' } }, it)))));
}

function tacticsPanel(m, team) {
  const a = m.analysis || {};
  const list = (side) => h('div', { class: 'card' }, h('h3', null, team(side)), toArray(a[side]).length ? toArray(a[side]).map((n) => h('div', { class: 'note' }, h('span', { class: 'ni' }, n.kind === 'good' ? '✅' : n.kind === 'warn' ? '⚠️' : 'ℹ️'), h('span', null, n.text))) : h('div', { class: 'small muted' }, 'Belirgin yapısal zaaf yoktu.'));
  return h('div', null, h('p', { class: 'small muted' }, 'Maç başındaki taktik yapıya göre motorun tespit ettiği güçlü ve zayıf yönler:'), list('home'), list('away'));
}

// ---------- replay (same commentary as the live broadcast: danger first, then the result)
function watch(ctx, m, ui, color, team) {
  const { app } = ctx;
  const api = app.api;
  const wrap = h('div');
  if (!ui.log && !ui.loading) {
    ui.loading = true;
    api.getLog(app.code, m.id).then((log) => { ui.log = log; ui.loading = false; if (log && log.input && log.input.engine === ENGINE_VERSION) { ui.verified = fingerprint(replayFromLog(log)) === m.fp; } ctx.render(); })
      .catch((e) => { ui.loading = false; toast(e.message, 'err'); });
  }
  if (!ui.log) { wrap.appendChild(h('div', { class: 'card muted center' }, 'Maç kaydı yükleniyor…')); return wrap; }
  const events = toArray(ui.log.events);
  const ht = events.find((e) => e.type === 'halftime') || { extra: 0 }, ft = events.find((e) => e.type === 'fulltime') || { extra: 0 };
  const ticks = [{ m: 0, x: 0, label: "0'" }];
  for (let i = 1; i <= 45; i++) ticks.push({ m: i, x: 0, label: `${i}'` });
  for (let i = 1; i <= ht.extra; i++) ticks.push({ m: 45, x: i, label: `45+${i}'` });
  ticks.push({ sp: 'ht', label: 'Devre arası' });
  for (let i = 46; i <= 90; i++) ticks.push({ m: i, x: 0, label: `${i}'` });
  for (let i = 1; i <= ft.extra; i++) ticks.push({ m: 90, x: i, label: `90+${i}'` });
  ticks.push({ sp: 'ft', label: 'Maç sonu' });
  const last = ticks.length - 1;
  const evT = eventTicks(events, ticks);
  const nmf = (pid) => nm(api, pid);
  const moments = buildMoments(events, nmf, team).map((mo, k) => ({ ...mo, t: evT[mo.ei], id: k }));
  // playback state survives re-renders caused by other room updates
  const st = ui.ws || (ui.ws = { tick: 0, playing: true, speed: app.ui.speed || 2, revealed: {} });
  const score = h('div', { class: 'sb-score' }, '0 - 0');
  const minute = h('div', { class: 'sb-minute' }, "0'");
  const prog = h('i');
  const feed = h('div', { class: 'feed' });
  const play = h('button', { class: 'btn sm' });
  const speed = h('div', { class: 'seg' });
  const pending = new Map();
  const goalsShown = () => moments.filter((mo) => mo.kind === 'shot' && mo.event.type === 'goal' && st.revealed[mo.id]);
  const drawScore = () => { const g = goalsShown(); score.textContent = `${g.filter((x) => x.side === 'home').length} - ${g.filter((x) => x.side === 'away').length}`; };
  const item = (mo, step) => {
    const d = mo.kind === 'line' ? mo.line : step === 'pre' ? mo.pre : mo.post;
    const e = mo.event;
    const neutral = !!d.neutral;
    return h('div', { class: `ev ${e.type} ${neutral ? 'neutral' : ''} ${step === 'pre' ? 'danger' : ''} ${d.goal ? 'goal' : ''}` },
      neutral ? null : h('span', { class: 'm' }, `${e.label}'`), h('span', { class: 'i' }, d.icon),
      h('span', { class: 'grow' }, neutral ? null : h('span', { class: 'dot', style: { background: color(e.side), marginRight: '6px' } }), d.text));
  };
  const drawFull = () => {
    for (const t of pending.values()) clearTimeout(t);
    pending.clear();
    clear(feed);
    for (const mo of moments) { if (mo.t <= st.tick) st.revealed[mo.id] = true; else delete st.revealed[mo.id]; }
    moments.filter((mo) => mo.t <= st.tick).slice().reverse().forEach((mo) => feed.appendChild(item(mo, mo.kind === 'line' ? 'line' : 'post')));
    drawScore();
  };
  const drawClock = () => {
    minute.textContent = ticks[st.tick].label;
    prog.style.width = `${(st.tick / last) * 100}%`;
    play.textContent = st.tick >= last ? '↺ Baştan' : st.playing ? '❚❚ Duraklat' : '▶︎ Oynat';
  };
  const tickMs = (i) => (ticks[i] && ticks[i].sp === 'ht' ? 2100 : 700) / st.speed;
  let timer = null;
  const schedule = () => { clearTimeout(timer); if (st.playing && st.tick < last) timer = setTimeout(step, tickMs(st.tick + 1)); };
  const step = () => {
    if (!document.body.contains(wrap) || st.tick >= last) return;
    st.tick++;
    for (const mo of moments.filter((x) => x.t === st.tick)) {
      if (mo.kind === 'line') { feed.insertBefore(item(mo, 'line'), feed.firstChild); continue; }
      const pre = item(mo, 'pre');
      feed.insertBefore(pre, feed.firstChild);
      // hold the clock while the moment resolves, so the outcome is shown before time moves on
      const delay = Math.max(350, 1200 / Math.max(1, st.speed / 2));
      clearTimeout(timer);
      const tmr = setTimeout(() => {
        pending.delete(mo.id);
        if (!document.body.contains(wrap)) return;
        st.revealed[mo.id] = true;
        const post = item(mo, 'post');
        if (pre.parentNode) pre.replaceWith(post); else feed.insertBefore(post, feed.firstChild);
        if (mo.event.type === 'goal') {
          chime('goal'); drawScore();
          score.classList.remove('flash'); void score.offsetWidth; score.classList.add('flash');
          const g = goalsShown();
          goalOverlay({ color: color(mo.side), scorer: nm(api, mo.event.playerId), minute: mo.event.label, assist: mo.event.assistId ? nm(api, mo.event.assistId) : null, team: team(mo.side), score: `${team('home')} ${g.filter((x) => x.side === 'home').length} - ${g.filter((x) => x.side === 'away').length} ${team('away')}` });
        }
        if (!pending.size) schedule();
      }, delay);
      pending.set(mo.id, tmr);
    }
    if (st.tick >= last) st.playing = false;
    drawClock();
    if (!pending.size) schedule();
  };
  play.onclick = () => { if (st.tick >= last) { st.tick = 0; st.playing = true; drawFull(); } else st.playing = !st.playing; drawClock(); schedule(); };
  for (const [v, l] of [[1, '1x'], [2, '2x'], [4, '4x'], [10, '10x']]) speed.appendChild(h('button', { class: st.speed === v ? 'on' : '', onclick: (e) => { st.speed = v; app.ui.speed = v; [...speed.children].forEach((b) => b.classList.remove('on')); e.target.classList.add('on'); schedule(); } }, l));
  app.cleanup = () => { clearTimeout(timer); for (const t of pending.values()) clearTimeout(t); };
  wrap.append(...[
    h('div', { class: 'card' }, h('div', { class: 'row between' }, score, minute), h('div', { class: 'sb-progress' }, prog)),
    h('div', { class: 'row wrap mb', style: { gap: '8px' } }, play, speed, h('button', { class: 'btn sm primary', onclick: () => { clearTimeout(timer); st.tick = last; st.playing = false; drawFull(); drawClock(); } }, '⏭ Sona git')),
    ui.verified === false ? h('div', { class: 'banner warn' }, 'Uyarı: kayıt yeniden simüle edildiğinde farklı çıktı.') : ui.verified ? h('div', { class: 'mini mb' }, '✓ Aynı seed ile yeniden hesaplandı, sonuç birebir aynı.') : null,
    feed].filter(Boolean));
  drawFull();
  drawClock();
  schedule();
  return wrap;
}

export { posBadge, seatLabel };
