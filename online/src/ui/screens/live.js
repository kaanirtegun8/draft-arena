// Live week centre: every match of the week plays at the same time, minute by minute.
// Right after the admin plays a week it is a synchronized broadcast: everybody sees the
// same minute and nobody can skip ahead. After the broadcast it becomes a replay.
import { avatar } from '../visual.js';
import { createPitch2D, awayKit, tickItems, planAhead, createDirector } from '../pitch2d.js';
import { h, clear, toast } from '../dom.js';
import { toArray } from '../../core/draft.js';
import { matchesOfWeek } from '../../core/season.js';
import { buildMoments } from '../../core/commentary.js';
import { topbar } from '../components.js';
import { chime, systemNotify } from '../notify.js';
import { markWeekSeen } from './league.js';
import { clockNow, broadcastEnd, broadcastPos, speedOf, LIVE_SPEEDS, SEC_PER_MIN, HT_MS, championAnnouncement } from '../livestate.js';

const REVEAL_MS = 1200;
const FEED_SHORT = 8;

// one feed row: tap a grouped line (several substitutions) to open it
export function feedRow(d, { cls = '', minute = '', dot = null, prefix = null, important = false } = {}) {
  const det = d.details && d.details.length ? h('div', { class: 'ev-det', style: { display: 'none' } }, d.details.map((t) => h('div', null, t))) : null;
  const row = h('div', { class: `ev ${cls} ${det ? 'expandable' : ''}`, 'data-imp': important ? '1' : '0', onclick: det ? () => { const open = det.style.display === 'none'; det.style.display = open ? 'block' : 'none'; row.classList.toggle('open', open); } : null },
    minute ? h('span', { class: 'm' }, minute) : null,
    h('span', { class: 'i' }, d.icon),
    h('span', { class: 'grow' }, prefix, dot, d.text, det ? h('span', { class: 'mini' }, ' ▸') : null, det));
  return row;
}

// show only the newest moments unless "all" is open; "important" hides the small stuff
export function applyFeedView(feed, ui, moreBtn) {
  let shown = 0, total = 0;
  for (const el of feed.children) {
    const imp = el.getAttribute('data-imp') === '1';
    const pass = ui.feedFilter !== 'imp' || imp || el.classList.contains('danger');
    if (pass) total += 1;
    const vis = pass && (ui.feedAll || shown < FEED_SHORT);
    el.style.display = vis ? '' : 'none';
    if (vis) shown += 1;
  }
  if (moreBtn) { moreBtn.style.display = total > FEED_SHORT ? '' : 'none'; moreBtn.textContent = ui.feedAll ? 'Daha az göster ▴' : `Tümünü göster (${total}) ▾`; }
}
export function feedControls(ui, feed, rerender) {
  const more = h('button', { class: 'btn sm block mt', onclick: () => { ui.feedAll = !ui.feedAll; rerender(); } });
  const seg = h('div', { class: 'seg' }, [['imp', 'Önemli'], ['all', 'Tümü']].map(([v, l]) => h('button', { class: (ui.feedFilter || 'all') === v ? 'on' : '', onclick: (e) => { ui.feedFilter = v; [...e.target.parentNode.children].forEach((b) => b.classList.remove('on')); e.target.classList.add('on'); rerender(); } }, l)));
  return { more, seg };
}

// first-half numbers for the half-time card
export function halfStats(log) {
  const ev = toArray(log && log.events);
  const ht = ev.findIndex((e) => e.type === 'halftime');
  const first = ht >= 0 ? ev.slice(0, ht) : ev;
  const z = () => ({ goals: 0, shots: 0, sot: 0, xg: 0, corners: 0, yellow: 0, red: 0 });
  const o = { home: z(), away: z() };
  for (const e of first) {
    const t = o[e.side];
    if (!t) continue;
    if (['goal', 'save', 'miss'].includes(e.type)) { t.shots += 1; t.xg += e.xg || 0; if (e.type !== 'miss') t.sot += 1; if (e.type === 'goal') t.goals += 1; }
    if (e.type === 'corner') t.corners += 1;
    if (e.type === 'yellow') t.yellow += 1;
    if (e.type === 'red') t.red += 1;
  }
  const poss = toArray(log && log.possession).slice(0, 45);
  const ph = poss.length ? Math.round(poss.reduce((a, b) => a + b, 0) / poss.length) : 50;
  return { ...o, poss: [ph, 100 - ph] };
}
export function halfTimeOverlay(items, ms = 5000) {
  const old = document.querySelector('.ht-overlay');
  if (old) old.remove();
  const row = (label, a, b) => h('div', { class: 'ht-row' }, h('b', null, a), h('span', null, label), h('b', null, b));
  const el = h('div', { class: 'ht-overlay', onclick: () => el.remove() },
    h('div', { class: 'ht-inner' },
      h('div', { class: 'ht-title' }, '⏸️ DEVRE ARASI'),
      items.map(({ home, away, st }) => h('div', { class: 'ht-card' },
        h('div', { class: 'ht-score' }, h('span', null, home), h('b', null, `${st.home.goals} - ${st.away.goals}`), h('span', null, away)),
        row('Topa sahip olma', `%${st.poss[0]}`, `%${st.poss[1]}`),
        row('Şut', st.home.shots, st.away.shots),
        row('İsabetli şut', st.home.sot, st.away.sot),
        row('Gol beklentisi (xG)', st.home.xg.toFixed(2), st.away.xg.toFixed(2)),
        row('Korner', st.home.corners, st.away.corners),
        row('Kart', `${st.home.yellow}🟨${st.home.red ? ` ${st.home.red}🟥` : ''}`, `${st.away.yellow}🟨${st.away.red ? ` ${st.away.red}🟥` : ''}`))),
      h('div', { class: 'mini center mt' }, 'Kapatmak için dokun')));
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// Timeline shared by every match of the week (fixed length: same as the broadcast).
function buildTicks() {
  const ticks = [{ m: 0, x: 0, label: "0'" }];
  for (let k = 1; k <= 45; k++) ticks.push({ m: k, x: 0, label: `${k}'` });
  for (let k = 1; k <= 4; k++) ticks.push({ m: 45, x: k, label: `45+${k}'`, opt: 1 });
  ticks.push({ sp: 'ht', label: 'Devre arası' });
  for (let k = 46; k <= 90; k++) ticks.push({ m: k, x: 0, label: `${k}'` });
  for (let k = 1; k <= 6; k++) ticks.push({ m: 90, x: k, label: `90+${k}'`, opt: 2 });
  ticks.push({ sp: 'ft', label: 'Maçlar bitti' });
  return ticks;
}

// tick index of an event; second-half events are searched after the half-time tick
export function eventTicks(events, ticks) {
  const ht = ticks.findIndex((t) => t.sp === 'ht');
  const last = ticks.length - 1;
  let after = false;
  return events.map((e) => {
    if (e.type === 'kickoff') return 0;
    if (e.type === 'halftime') { after = true; return ht; }
    if (e.type === 'fulltime') return last;
    const k = ticks.findIndex((t, i) => !t.sp && t.m === e.minute && t.x === (e.extra || 0) && (after || e.minute > 45 ? i > ht : i < ht));
    return k < 0 ? last : k;
  });
}

// Goal overlay: big animated banner in the scoring team's colour. Does not stop the clock.
export function goalOverlay({ color, scorer, minute, assist, team, score, player = null }) {
  const old = document.querySelector('.goal-overlay');
  if (old) old.remove();
  const el = h('div', { class: 'goal-overlay', style: { background: color || '#22d3a6' }, onclick: () => el.remove() },
    h('div', { class: 'go-inner' },
      player ? h('div', { class: 'go-photo' }, avatar(player, { size: 112, ring: '#fff', lazy: false })) : null,
      h('div', { class: 'go-big' }, 'GOOOL!'),
      h('div', { class: 'go-scorer' }, `⚽ ${scorer}`, minute ? h('span', { class: 'go-min' }, ` ${minute}'`) : null),
      assist ? h('div', { class: 'go-assist' }, `Asist: ${assist}`) : null,
      h('div', { class: 'go-score' }, `${team ? team + ' · ' : ''}${score || ''}`)));
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

export function renderLive(ctx) {
  const { app } = ctx;
  const room = app.room;
  const api = app.api;
  const week = app.params.week;
  const ms = matchesOfWeek(room.season, week).map((m) => ({ fx: m, r: room.season.matches && room.season.matches[m.id] })).filter((x) => x.r);
  const back = () => ctx.go('room', {});
  const ui = app.ui.live && app.ui.live.week === week ? app.ui.live : (app.ui.live = { week, logs: null, loading: false, tick: null, playing: true, speed: 1, revealed: {} });
  const wrap = h('div');
  if (!ms.length) return h('div', null, topbar(`${week}. hafta`, 'Canlı', { back }), h('div', { class: 'card muted' }, 'Bu haftanın maçları henüz oynanmadı.'));
  if (!ui.logs && !ui.loading) {
    ui.loading = true;
    Promise.all(ms.map((x) => api.getLog(app.code, x.fx.id))).then((logs) => { ui.logs = logs; ui.loading = false; ctx.render(); })
      .catch(() => { ui.loading = false; ui.logs = ms.map(() => null); ctx.render(); });
  }
  if (!ui.logs) return h('div', null, topbar(`${week}. hafta`, 'Canlı yayın', { back }), h('div', { class: 'card muted center' }, 'Maçlar yükleniyor…'));

  const teamName = (seat) => (room.members[seat] || {}).team || '';
  const teamColor = (seat) => (room.members[seat] || {}).color || '#22d3a6';
  const nm = (pid) => (api.byId[pid] ? api.byId[pid].name : '?');
  const ticks = buildTicks();
  const last = ticks.length - 1;
  const htIdx = ticks.findIndex((t) => t.sp === 'ht');
  // half-time lasts two ticks of time
  // one match minute = 2 s at 1x; half-time is a real 5 s break at any speed
  const unitMs = SEC_PER_MIN * 1000;
  const curSpeed = () => (isLiveNow() ? speedOf(app.room, week) : ui.speed);
  const weight = (i) => (i === htIdx ? (HT_MS * curSpeed()) / unitMs : 1);
  // weight(i) = how long tick i stays on screen (half-time: the 5 s break)
  const tickAt = (ms0) => { let acc = 0; for (let i = 1; i <= last; i++) { acc += weight(i - 1) * unitMs; if (ms0 < acc) return i - 1; } return last; };

  const matches = ms.map((x, i) => {
    const events = toArray(ui.logs[i] && ui.logs[i].events);
    const evT = eventTicks(events, ticks);
    const tm = (s) => teamName(s === 'home' ? x.fx.home : x.fx.away);
    const moments = buildMoments(events, nm, tm).map((mo, k) => ({ ...mo, t: evT[mo.ei], id: `${i}:${k}` }));
    // old logs without events: fall back to the summary's goals
    if (!events.length) toArray(x.r.goals).forEach((g, k) => moments.push({ id: `${i}:g${k}`, kind: 'shot', side: g.side, t: Math.min(last - 1, g.minute > 45 ? htIdx + g.minute - 45 : g.minute), event: { ...g, type: 'goal' }, pre: { icon: '⚠️', text: `Tehlike! ${tm(g.side)} atakta…` }, post: { icon: '⚽', text: `GOOOL! ${nm(g.playerId)}!`, goal: true } }));
    return { ...x, tm, moments };
  });

  // live sync with the moment the admin played the week
  const isLiveNow = () => { const e = broadcastEnd(app.room, week); return !!e && clockNow(app) < e; };
  const end = broadcastEnd(room, week);
  const now0 = clockNow(app);
  const isLive = !!end && now0 < end;
  const liveSpeed = speedOf(room, week);
  const liveTick = () => tickAt(broadcastPos(room, week, clockNow(app)));
  if (isLive) ui.tick = Math.max(0, liveTick());
  else if (ui.tick == null) ui.tick = 0;

  const rows = matches.map((x) => {
    const score = h('div', { class: 'sc' }, '0 - 0');
    const last1 = h('div', { class: 'mini center', style: { minHeight: '14px' } }, '');
    const row = h('div', { class: 'card', style: { padding: '10px 12px' } },
      h('div', { class: 'fixture', style: { border: 0, padding: 0, minHeight: 0 } },
        h('div', { class: 'h ellipsis' }, teamName(x.fx.home)), score, h('div', { class: 'a ellipsis' }, teamName(x.fx.away))),
      last1);
    return { row, score, last1 };
  });
  // 2D view of one match (mine by default)
  if (ui.focus == null || ui.focus >= matches.length) { const k = matches.findIndex((x) => x.fx.home === ctx.seat || x.fx.away === ctx.seat); ui.focus = k >= 0 ? k : 0; }
  const fLog = ui.logs[ui.focus];
  const fm = matches[ui.focus];
  const pitch = fLog && fLog.input ? createPitch2D({
    home: { color: teamColor(fm.fx.home), slots: fLog.input.home.slots, lineup: fLog.input.home.lineup, players: fLog.input.home.players },
    away: { color: teamColor(fm.fx.away), slots: fLog.input.away.slots, lineup: fLog.input.away.lineup, players: fLog.input.away.players },
  }) : null;
  const possArr = toArray(fLog && fLog.possession);
  const fEvents = toArray(fLog && fLog.events);
  const fEvT = eventTicks(fEvents, ticks);
  const awayCol = awayKit(teamColor(fm.fx.home), teamColor(fm.fx.away));
  const possEl = h('div', { class: 'p2d-poss' }, h('i', { style: { background: teamColor(fm.fx.home), width: '50%' } }), h('i', { style: { background: awayCol, width: '50%' } }));
  const minuteOf = (tk) => { const t = ticks[tk]; return t && !t.sp ? Math.min(89, Math.max(0, (t.m || 1) - 1)) : null; };
  const idleAt = (tk) => {
    const m = minuteOf(tk);
    if (m == null || !pitch) return;
    const ph = possArr[m] ?? 50;
    pitch.idle(ph, m);
    possEl.children[0].style.width = `${ph}%`; possEl.children[1].style.width = `${100 - ph}%`;
  };
  const pitchCard = pitch ? h('div', { class: 'card', style: { padding: '8px 10px' } },
    matches.length > 1 ? h('div', { class: 'chips mb' }, matches.map((x, k) => h('button', { class: `chip ${k === ui.focus ? 'on' : ''}`, onclick: () => { ui.focus = k; ctx.render(); } }, `${teamName(x.fx.home)} – ${teamName(x.fx.away)}`))) : null,
    h('div', { class: 'p2d-head' }, h('span', null, h('i', { class: 'sw', style: { background: teamColor(fm.fx.home) } }), teamName(fm.fx.home)), h('span', null, teamName(fm.fx.away), h('i', { class: 'sw', style: { background: awayCol, marginLeft: '6px', marginRight: 0 } }))),
    h('div', { class: 'p2d-wrap' }, pitch.el),
    possEl, h('div', { class: 'mini center' }, 'Topa sahip olma')) : null;
  const minuteEl = h('div', { class: 'sb-minute', style: { fontSize: '22px' } }, "0'");
  const prog = h('i');
  const badge = h('span', { class: 'tag danger live-badge', style: { display: isLive ? 'inline-block' : 'none' } }, '● CANLI');
  const feed = h('div', { class: 'feed' });
  const fc = feedControls(ui, feed, () => applyFeedView(feed, ui, fc.more));
  const playBtn = h('button', { class: 'btn sm' });

  const revealed = ui.revealed || (ui.revealed = {});
  const pending = new Map();
  const feedItem = (x, mo, step) => {
    const d = mo.kind === 'line' ? mo.line : step === 'pre' ? mo.pre : mo.post;
    const ev = mo.event;
    const neutral = !!d.neutral;
    const cls = `${neutral ? 'neutral' : ''} ${step === 'pre' ? 'danger' : ''} ${d.goal ? 'goal' : ''} ${ev.type === 'red' ? 'red' : ''} ${ev.type === 'sub' ? 'sub' : ''}`;
    return feedRow(d, { cls, important: mo.important, minute: neutral ? '' : `${ev.label || ''}'`,
      prefix: neutral ? h('b', null, `${teamName(x.fx.home)} – ${teamName(x.fx.away)}: `) : null,
      dot: neutral ? null : h('span', { class: 'dot', style: { background: teamColor(ev.side === 'away' ? x.fx.away : x.fx.home), marginRight: '6px' } }) });
  };
  const scoreOf = (i) => {
    const goals = matches[i].moments.filter((mo) => mo.kind === 'shot' && mo.event.type === 'goal' && revealed[mo.id]);
    return [goals.filter((g) => g.side === 'home').length, goals.filter((g) => g.side === 'away').length];
  };
  const drawScores = () => rows.forEach((r, i) => {
    const s = scoreOf(i);
    r.score.textContent = `${s[0]} - ${s[1]}`;
    const goals = matches[i].moments.filter((mo) => mo.kind === 'shot' && mo.event.type === 'goal' && revealed[mo.id]);
    const lg = goals[goals.length - 1];
    r.last1.textContent = lg ? `⚽ ${nm(lg.event.playerId)} ${lg.event.label}'` : '';
  });
  // the result of a moment: the outcome line, the score and the goal overlay
  const showPost = (x, i, mo, pre, silent = false) => {
    revealed[mo.id] = true;
    const post = feedItem(x, mo, 'post');
    if (pre && pre.parentNode) pre.replaceWith(post); else feed.insertBefore(post, feed.firstChild);
    applyFeedView(feed, ui, fc.more);
    drawScores();
    if (mo.event.type !== 'goal' || silent) return;
    chime('goal');
    const r = rows[i];
    r.score.classList.remove('flash'); void r.score.offsetWidth; r.score.classList.add('flash');
    const s = scoreOf(i);
    const scorerSeat = mo.side === 'away' ? x.fx.away : x.fx.home;
    goalOverlay({ player: api.byId[mo.event.playerId], color: teamColor(scorerSeat), scorer: nm(mo.event.playerId), minute: mo.event.label, assist: mo.event.assistId ? nm(mo.event.assistId) : null, team: teamName(scorerSeat), score: `${teamName(x.fx.home)} ${s[0]} - ${s[1]} ${teamName(x.fx.away)}` });
  };
  // a moment: the danger line first (and the chance on the 2D view), the outcome a beat later
  const playMoment = (x, i, mo, opts, done) => {
    const pre = feedItem(x, mo, 'pre');
    feed.insertBefore(pre, feed.firstChild);
    applyFeedView(feed, ui, fc.more);
    const onPitch = !!(pitch && done);
    if (onPitch) pitch.danger(mo.event);
    const sp = curSpeed();
    let delay = sp <= 1 ? REVEAL_MS : Math.max(250, REVEAL_MS / sp);
    if (opts && opts.hurry) delay = Math.max(200, delay * 0.6);
    const tmr = setTimeout(() => {
      pending.delete(mo.id);
      if (!document.body.contains(wrap)) return;
      const busy = onPitch ? pitch.outcome(mo.event, (mo.post && mo.post.text) || '', opts || {}) : 0;
      showPost(x, i, mo, pre);
      if (done) done(busy);
    }, delay);
    pending.set(mo.id, tmr);
  };
  // the focused match is played one thing at a time, in log order (the 2D view follows it)
  const fx0 = matches[ui.focus];
  const momentByEi = new Map(fx0.moments.filter((mo) => mo.kind === 'shot' && mo.ei != null).map((mo) => [mo.ei, mo]));
  const director = createDirector({
    pitch, speed: () => curSpeed(),
    moment: (mo, opts, done) => playMoment(fx0, ui.focus, mo, opts, done),
    reveal: (mo) => { if (!revealed[mo.id]) showPost(fx0, ui.focus, mo, null, true); },
    tickNow: isLive ? () => ui.tick : null,
    maxWait: isLive ? 3.5 : 6,
    // the week replay waits for the animation; the live broadcast follows the shared clock
    onIdle: () => { if (!isLive && document.body.contains(wrap)) schedule(); },
  });
  // full redraw: everything up to the current tick is shown and revealed
  const drawFull = () => {
    director.flush();
    for (const t of pending.values()) clearTimeout(t);
    pending.clear();
    clear(feed);
    const all = [];
    matches.forEach((x, i) => x.moments.forEach((mo, k) => { if (mo.t <= ui.tick) { revealed[mo.id] = true; all.push({ x, mo, ord: mo.t * 1000 + k * 0.001 + i * 0.0001 }); } }));
    matches.forEach((x) => x.moments.forEach((mo) => { if (mo.t > ui.tick) delete revealed[mo.id]; }));
    all.sort((a, b) => b.ord - a.ord).forEach(({ x, mo }) => feed.appendChild(feedItem(x, mo, mo.kind === 'line' ? 'line' : 'post')));
    applyFeedView(feed, ui, fc.more);
    drawScores();
  };
  const drawClock = () => {
    minuteEl.textContent = ticks[ui.tick].label;
    prog.style.width = `${(ui.tick / last) * 100}%`;
    playBtn.textContent = ui.tick >= last ? '↺ Baştan' : ui.playing ? '❚❚ Duraklat' : '▶︎ Oynat';
  };
  // a new tick: lines appear, chances first show the danger line, then the result
  const enterTick = (tk, quiet) => {
    if (!quiet) idleAt(tk);
    if (pitch && !quiet) {
      pitch.setSpeed(curSpeed());
      if (tk === htIdx + 1) pitch.restart('away');
    }
    if (tk === htIdx && !quiet) halfTimeOverlay(matches.map((x, i) => ({ home: teamName(x.fx.home), away: teamName(x.fx.away), st: halfStats(ui.logs[i]) })));
    setTimeout(() => applyFeedView(feed, ui, fc.more), 0);
    if (quiet) director.flush();
    matches.forEach((x, i) => {
      const here = x.moments.filter((mo) => mo.t === tk);
      here.filter((mo) => mo.kind === 'line').forEach((mo) => feed.insertBefore(feedItem(x, mo, 'line'), feed.firstChild));
      const shots = here.filter((mo) => mo.kind !== 'line');
      if (quiet) { shots.forEach((mo) => { revealed[mo.id] = true; feed.insertBefore(feedItem(x, mo, 'post'), feed.firstChild); }); return; }
      if (i !== ui.focus) { shots.forEach((mo) => playMoment(x, i, mo, null, null)); return; }
      const items = tickItems(fEvents, fEvT, tk, (k) => momentByEi.get(k));
      const queued = new Set(items.filter((it) => it.mo).map((it) => it.mo));
      shots.filter((mo) => !queued.has(mo)).forEach((mo) => playMoment(x, i, mo, null, null));
      director.push(pitch ? items : items.filter((it) => it.mo));
    });
    if (quiet) drawScores();
    if (pitch && !quiet) planAhead(pitch, fEvents, fEvT, ticks, tk, SEC_PER_MIN, director.lag());
  };

  const finish = () => {
    ui.playing = false;
    markWeekSeen(app.code, week);
    if (isLive && room.public.status === 'finished' && !ui.endAnnounced) {
      ui.endAnnounced = true;
      setTimeout(() => {
        const champ = championAnnouncement(app, app.room);
        if (champ) { toast(`Sezon bitti! Şampiyon: ${champ} 🏆`, 'ok'); chime('info'); systemNotify('Draft Arena', `Sezon bitti! Şampiyon: ${champ}`, 'status'); }
      }, 1500);
    }
  };

  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    if (isLive) {
      // follow the shared clock; catch up silently if the screen was asleep
      timer = setTimeout(() => {
        if (!document.body.contains(wrap)) return;
        const target = liveTick();
        if (target > ui.tick) {
          const gap = target - ui.tick;
          while (ui.tick < target) { ui.tick++; enterTick(ui.tick, gap > 2 && ui.tick < target); }
          if (gap > 2 && pitch) { pitch.resync(); planAhead(pitch, fEvents, fEvT, ticks, ui.tick, SEC_PER_MIN, director.lag()); }
          drawClock();
        }
        if (clockNow(app) >= end) { ui.tick = last; drawFull(); drawClock(); finish(); ctx.render(); return; }
        schedule();
      }, 250);
      return;
    }
    if (!ui.playing || ui.tick >= last || director.busy()) return;
    timer = setTimeout(step, (weight(ui.tick) * unitMs) / ui.speed);
  };
  const step = () => {
    if (!document.body.contains(wrap) || ui.tick >= last) return;
    ui.tick++;
    enterTick(ui.tick, false);
    if (ui.tick >= last) finish();
    drawClock();
    schedule();
  };
  playBtn.onclick = () => {
    if (ui.tick >= last) { ui.tick = 0; ui.playing = true; ctx.render(); return; }
    ui.playing = !ui.playing;
    if (pitch) pitch.pause(!ui.playing);
    drawClock(); schedule();
  };
  const speedSeg = h('div', { class: 'seg' }, [[1, 'Canlı hız'], [3, '3x'], [8, '8x']].map(([v, l]) => h('button', { class: ui.speed === v ? 'on' : '', onclick: (e) => { ui.speed = v; [...e.target.parentNode.children].forEach((b) => b.classList.remove('on')); e.target.classList.add('on'); schedule(); } }, l)));
  app.cleanup = () => { clearTimeout(timer); director.stop(); for (const t of pending.values()) clearTimeout(t); };

  const controls = isLive
    ? h('div', { class: 'card small center live-note' },
      h('div', null, '🔴 Canlı yayın: herkes aynı dakikayı izliyor. Yayın bitene kadar sonuçlar gizli, ileri sarılamaz.'),
      ctx.admin
        ? h('div', { class: 'mt' }, h('div', { class: 'mini mb' }, 'Yayın hızı (herkeste değişir):'),
          h('div', { class: 'seg', style: { justifyContent: 'center' } }, LIVE_SPEEDS.map((v) => h('button', { class: liveSpeed === v ? 'on' : '', onclick: () => { if (v !== liveSpeed) ctx.run(() => api.setLiveSpeed(app.code, room, week, v), `Yayın ${v}x hıza alındı.`); } }, `${v}x`))))
        : h('div', { class: 'mini mt' }, `Yayın hızı: ${liveSpeed}x (admin belirler)`))
    : h('div', { class: 'row wrap mb', style: { gap: '8px' } }, playBtn, speedSeg,
      h('button', { class: 'btn sm primary', onclick: () => { clearTimeout(timer); director.flush(); ui.tick = last; ui.playing = false; finish(); drawFull(); drawClock(); if (pitch) pitch.finish(); } }, '⏭ Sona git'));
  wrap.append(...[
    topbar(`${week}. hafta`, isLive ? 'Canlı yayın — herkesle aynı dakikada' : 'Haftanın tekrarı', { back }),
    h('div', { class: 'card' }, h('div', { class: 'row between' }, minuteEl, badge), h('div', { class: 'sb-progress' }, prog)),
    controls,
    pitchCard,
    ...rows.map((r) => r.row),
    isLive ? null : h('div', { class: 'btns mb' }, matches.map((x) => h('button', { class: 'btn sm', onclick: () => { markWeekSeen(app.code, week); ctx.go('room', { sub: 'match', id: x.fx.id }); } }, `${teamName(x.fx.home)} – ${teamName(x.fx.away)} detayı`))),
    h('div', { class: 'row between mb' }, h('h3', { style: { margin: 0 } }, 'Maç akışı'), fc.seg),
    feed, fc.more].filter(Boolean));
  drawFull();
  drawClock();
  if (!isLive && ui.tick >= last) ui.playing = false;
  if (pitch) {
    if (ui.tick >= last) pitch.finish();
    else {
      pitch.setSpeed(curSpeed());
      idleAt(ui.tick);
      if (ui.tick === 0) pitch.restart('home');
      else if (ui.tick === htIdx) pitch.event({ type: 'halftime', side: 'home' });
      if (!isLive && !ui.playing) pitch.pause(true);
      planAhead(pitch, fEvents, fEvT, ticks, ui.tick, SEC_PER_MIN);
    }
  }
  schedule();
  return wrap;
}
