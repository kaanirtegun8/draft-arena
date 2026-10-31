// Live week centre: every match of the week plays at the same time, minute by minute.
// Right after the admin plays a week it is a synchronized broadcast: everybody sees the
// same minute and nobody can skip ahead. After the broadcast it becomes a replay.
import { h, clear, toast } from '../dom.js';
import { toArray } from '../../core/draft.js';
import { matchesOfWeek } from '../../core/season.js';
import { buildMoments } from '../../core/commentary.js';
import { topbar } from '../components.js';
import { chime, systemNotify } from '../notify.js';
import { markWeekSeen } from './league.js';
import { clockNow, broadcastEnd, BROADCAST_MS, BROADCAST_TICKS } from '../livestate.js';

const REVEAL_MS = 1200;

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
export function goalOverlay({ color, scorer, minute, assist, team, score }) {
  const old = document.querySelector('.goal-overlay');
  if (old) old.remove();
  const el = h('div', { class: 'goal-overlay', style: { background: color || '#22d3a6' }, onclick: () => el.remove() },
    h('div', { class: 'go-inner' },
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
  const weight = (i) => (i === htIdx ? 2 : 1);
  const totalUnits = ticks.reduce((a, _, i) => a + (i ? weight(i) : 0), 0);
  const unitMs = BROADCAST_MS / Math.max(totalUnits, BROADCAST_TICKS - 1);
  const tickAt = (ms0) => { let acc = 0; for (let i = 1; i <= last; i++) { acc += weight(i) * unitMs; if (ms0 < acc) return i - 1; } return last; };

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
  const end = broadcastEnd(room, week);
  const now0 = clockNow(app);
  const isLive = !!end && now0 < end;
  const liveTick = () => tickAt(clockNow(app) - (end - BROADCAST_MS));
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
  const minuteEl = h('div', { class: 'sb-minute', style: { fontSize: '22px' } }, "0'");
  const prog = h('i');
  const badge = h('span', { class: 'tag danger live-badge', style: { display: isLive ? 'inline-block' : 'none' } }, '● CANLI');
  const feed = h('div', { class: 'feed' });
  const playBtn = h('button', { class: 'btn sm' });

  const revealed = ui.revealed || (ui.revealed = {});
  const pending = new Map();
  const feedItem = (x, mo, step) => {
    const d = mo.kind === 'line' ? mo.line : step === 'pre' ? mo.pre : mo.post;
    const ev = mo.event;
    const neutral = !!d.neutral;
    const cls = `ev ${neutral ? 'neutral' : ''} ${step === 'pre' ? 'danger' : ''} ${d.goal ? 'goal' : ''} ${ev.type === 'red' ? 'red' : ''} ${ev.type === 'sub' ? 'sub' : ''}`;
    return h('div', { class: cls, 'data-id': `${mo.id}:${step}` },
      neutral ? null : h('span', { class: 'm' }, `${ev.label || ''}'`),
      h('span', { class: 'i' }, d.icon),
      h('span', { class: 'grow' },
        neutral ? h('b', null, `${teamName(x.fx.home)} – ${teamName(x.fx.away)}: `) : h('span', { class: 'dot', style: { background: teamColor(ev.side === 'away' ? x.fx.away : x.fx.home), marginRight: '6px' } }),
        d.text));
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
  // full redraw: everything up to the current tick is shown and revealed
  const drawFull = () => {
    for (const t of pending.values()) clearTimeout(t);
    pending.clear();
    clear(feed);
    const all = [];
    matches.forEach((x, i) => x.moments.forEach((mo, k) => { if (mo.t <= ui.tick) { revealed[mo.id] = true; all.push({ x, mo, ord: mo.t * 1000 + k * 0.001 + i * 0.0001 }); } }));
    matches.forEach((x) => x.moments.forEach((mo) => { if (mo.t > ui.tick) delete revealed[mo.id]; }));
    all.sort((a, b) => b.ord - a.ord).forEach(({ x, mo }) => feed.appendChild(feedItem(x, mo, mo.kind === 'line' ? 'line' : 'post')));
    drawScores();
  };
  const drawClock = () => {
    minuteEl.textContent = ticks[ui.tick].label;
    prog.style.width = `${(ui.tick / last) * 100}%`;
    playBtn.textContent = ui.tick >= last ? '↺ Baştan' : ui.playing ? '❚❚ Duraklat' : '▶︎ Oynat';
  };
  // a new tick: lines appear, shots first show the danger line, then the result
  const enterTick = (tk, quiet) => {
    matches.forEach((x, i) => x.moments.forEach((mo) => {
      if (mo.t !== tk) return;
      if (mo.kind === 'line') { feed.insertBefore(feedItem(x, mo, 'line'), feed.firstChild); return; }
      if (quiet) { revealed[mo.id] = true; feed.insertBefore(feedItem(x, mo, 'post'), feed.firstChild); return; }
      const pre = feedItem(x, mo, 'pre');
      feed.insertBefore(pre, feed.firstChild);
      const delay = isLive || ui.speed <= 1 ? REVEAL_MS : Math.max(250, REVEAL_MS / ui.speed);
      const tmr = setTimeout(() => {
        pending.delete(mo.id);
        if (!document.body.contains(wrap)) return;
        revealed[mo.id] = true;
        const post = feedItem(x, mo, 'post');
        if (pre.parentNode) pre.replaceWith(post); else feed.insertBefore(post, feed.firstChild);
        if (mo.event.type === 'goal') {
          chime('goal');
          const r = rows[i];
          drawScores();
          r.score.classList.remove('flash'); void r.score.offsetWidth; r.score.classList.add('flash');
          const s = scoreOf(i);
          const scorerSeat = mo.side === 'away' ? x.fx.away : x.fx.home;
          goalOverlay({ color: teamColor(scorerSeat), scorer: nm(mo.event.playerId), minute: mo.event.label, assist: mo.event.assistId ? nm(mo.event.assistId) : null, team: teamName(scorerSeat), score: `${teamName(x.fx.home)} ${s[0]} - ${s[1]} ${teamName(x.fx.away)}` });
        }
      }, delay);
      pending.set(mo.id, tmr);
    }));
  };

  const finish = () => {
    ui.playing = false;
    markWeekSeen(app.code, week);
    if (isLive && room.public.status === 'finished' && !ui.endAnnounced) {
      ui.endAnnounced = true;
      const champ = room.season.champion && room.members[room.season.champion];
      toast(`Sezon bitti! Şampiyon: ${champ ? champ.team : '—'} 🏆`, 'ok');
      chime('info');
      systemNotify('Draft Arena', 'Sezon bitti! Şampiyon belli oldu.', 'status');
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
          drawClock();
        }
        if (clockNow(app) >= end) { ui.tick = last; drawFull(); drawClock(); finish(); ctx.render(); return; }
        schedule();
      }, 250);
      return;
    }
    if (!ui.playing || ui.tick >= last) return;
    timer = setTimeout(step, (weight(ui.tick + 1) * unitMs) / ui.speed);
  };
  const step = () => {
    if (!document.body.contains(wrap) || ui.tick >= last) return;
    ui.tick++;
    enterTick(ui.tick, false);
    if (ui.tick >= last) finish();
    drawClock();
    schedule();
  };
  playBtn.onclick = () => { if (ui.tick >= last) { ui.tick = 0; ui.playing = true; drawFull(); } else ui.playing = !ui.playing; drawClock(); schedule(); };
  const speedSeg = h('div', { class: 'seg' }, [[1, 'Canlı hız'], [3, '3x'], [8, '8x']].map(([v, l]) => h('button', { class: ui.speed === v ? 'on' : '', onclick: (e) => { ui.speed = v; [...e.target.parentNode.children].forEach((b) => b.classList.remove('on')); e.target.classList.add('on'); schedule(); } }, l)));
  app.cleanup = () => { clearTimeout(timer); for (const t of pending.values()) clearTimeout(t); };

  const controls = isLive
    ? h('div', { class: 'card small center live-note' }, '🔴 Canlı yayın: herkes aynı dakikayı izliyor. Yayın bitene kadar sonuçlar gizli, ileri sarılamaz.')
    : h('div', { class: 'row wrap mb', style: { gap: '8px' } }, playBtn, speedSeg,
      h('button', { class: 'btn sm primary', onclick: () => { clearTimeout(timer); ui.tick = last; ui.playing = false; finish(); drawFull(); drawClock(); } }, '⏭ Sona git'));
  wrap.append(...[
    topbar(`${week}. hafta`, isLive ? 'Canlı yayın — herkesle aynı dakikada' : 'Haftanın tekrarı', { back }),
    h('div', { class: 'card' }, h('div', { class: 'row between' }, minuteEl, badge), h('div', { class: 'sb-progress' }, prog)),
    controls,
    ...rows.map((r) => r.row),
    isLive ? null : h('div', { class: 'btns mb' }, matches.map((x) => h('button', { class: 'btn sm', onclick: () => { markWeekSeen(app.code, week); ctx.go('room', { sub: 'match', id: x.fx.id }); } }, `${teamName(x.fx.home)} – ${teamName(x.fx.away)} detayı`))),
    h('h3', null, 'Önemli anlar'),
    feed].filter(Boolean));
  drawFull();
  drawClock();
  if (!isLive && ui.tick >= last) ui.playing = false;
  schedule();
  return wrap;
}
