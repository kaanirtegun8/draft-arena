// Live week centre: every match of the week plays at the same time, minute by minute.
// If you open it right after the admin played the week you join "live" at the same
// minute as everyone else; later it starts from kick-off as a replay.
import { h, clear } from '../dom.js';
import { toArray } from '../../core/draft.js';
import { matchesOfWeek } from '../../core/season.js';
import { topbar } from '../components.js';
import { chime } from '../notify.js';
import { markWeekSeen } from './league.js';

const SEC_PER_MIN = 2; // live broadcast speed: 90 minutes ≈ 3.5 minutes

export function renderLive(ctx) {
  const { app } = ctx;
  const room = app.room;
  const api = app.api;
  const week = app.params.week;
  const ms = matchesOfWeek(room.season, week).map((m) => room.season.matches && room.season.matches[m.id]).filter(Boolean);
  const back = () => ctx.go('room', {});
  const ui = app.ui.live && app.ui.live.week === week ? app.ui.live : (app.ui.live = { week, logs: null, loading: false, tick: null, playing: true, speed: 1 });
  const wrap = h('div');
  if (!ms.length) return h('div', null, topbar(`${week}. hafta`, 'Canlı', { back }), h('div', { class: 'card muted' }, 'Bu haftanın maçları henüz oynanmadı.'));
  if (!ui.logs && !ui.loading) {
    ui.loading = true;
    Promise.all(ms.map((m) => api.getLog(app.code, m.id))).then((logs) => { ui.logs = logs; ui.loading = false; ctx.render(); })
      .catch(() => { ui.loading = false; ui.logs = ms.map(() => null); ctx.render(); });
  }
  if (!ui.logs) return h('div', null, topbar(`${week}. hafta`, 'Canlı yayın', { back }), h('div', { class: 'card muted center' }, 'Maçlar yükleniyor…'));

  // common timeline: 0..45+e1, HT, 46..90+e2, FT (longest stoppage of the week)
  const evsOf = (i) => toArray(ui.logs[i] && ui.logs[i].events);
  const extra = (type) => Math.max(...ms.map((m, i) => { const e = evsOf(i).find((x) => x.type === type); return e ? e.extra : 0; }));
  const e1 = extra('halftime'), e2 = extra('fulltime');
  const ticks = [{ m: 0, x: 0, label: "0'" }];
  for (let k = 1; k <= 45; k++) ticks.push({ m: k, x: 0, label: `${k}'` });
  for (let k = 1; k <= e1; k++) ticks.push({ m: 45, x: k, label: `45+${k}'` });
  ticks.push({ sp: 'ht', label: 'Devre arası' });
  for (let k = 46; k <= 90; k++) ticks.push({ m: k, x: 0, label: `${k}'` });
  for (let k = 1; k <= e2; k++) ticks.push({ m: 90, x: k, label: `90+${k}'` });
  ticks.push({ sp: 'ft', label: 'Maçlar bitti' });
  const last = ticks.length - 1;
  const tickOf = (e) => {
    if (e.type === 'kickoff') return 0;
    if (e.type === 'halftime') return ticks.findIndex((t) => t.sp === 'ht');
    if (e.type === 'fulltime') return last;
    const half2 = e.minute > 45 || (e.minute === 45 && false);
    const k = ticks.findIndex((t, i) => !t.sp && t.m === e.minute && t.x === (e.extra || 0) && (half2 ? i > ticks.findIndex((q) => q.sp === 'ht') : true));
    return k < 0 ? last : k;
  };
  const evTicks = ms.map((m, i) => evsOf(i).map((e) => ({ e, t: tickOf(e) })));

  // live sync with the moment the admin played the week
  const playedAt = room.season.weeksPlayed && room.season.weeksPlayed[week];
  const elapsedTicks = playedAt ? Math.floor((Date.now() - playedAt) / 1000 / SEC_PER_MIN) : Infinity;
  const isLive = elapsedTicks < last;
  if (ui.tick == null) ui.tick = isLive ? Math.max(0, elapsedTicks) : 0;

  const rows = ms.map((m) => {
    const score = h('div', { class: 'sc' }, '0 - 0');
    const last1 = h('div', { class: 'mini center', style: { minHeight: '14px' } }, '');
    const row = h('div', { class: 'card', style: { padding: '10px 12px' } },
      h('div', { class: 'fixture', style: { border: 0, padding: 0, minHeight: 0 } },
        h('div', { class: 'h ellipsis' }, (room.members[m.home] || {}).team || ''), score, h('div', { class: 'a ellipsis' }, (room.members[m.away] || {}).team || '')),
      last1);
    return { m, row, score, last1 };
  });
  const minuteEl = h('div', { class: 'sb-minute', style: { fontSize: '22px' } }, "0'");
  const prog = h('i');
  const badge = h('span', { class: 'tag danger', style: { display: isLive ? 'inline-block' : 'none' } }, '● CANLI');
  const feed = h('div', { class: 'feed' });
  const playBtn = h('button', { class: 'btn sm' });
  const nm = (pid) => (api.byId[pid] ? api.byId[pid].name : '?');
  const describe = (e, mi) => {
    const tm = (s) => (room.members[s === 'home' ? ms[mi].home : ms[mi].away] || {}).team || '';
    if (e.type === 'goal') return `⚽ ${e.label}' GOL! ${nm(e.playerId)}${e.penalty ? ' (pen)' : ''}${e.assistId ? ` · asist ${nm(e.assistId)}` : ''} — ${tm(e.side)} (${e.score[0]}-${e.score[1]})`;
    if (e.type === 'red') return `🟥 ${e.label}' ${nm(e.playerId)} kırmızı kart (${tm(e.side)})`;
    if (e.type === 'injury') return `🚑 ${e.label}' ${nm(e.playerId)} sakatlandı (${tm(e.side)})`;
    if (e.type === 'save' && (e.xg >= 0.3 || e.penalty)) return `🧤 ${e.label}' ${e.keeperId ? nm(e.keeperId) : 'Kaleci'} müthiş kurtardı (${nm(e.playerId)})`;
    if (e.type === 'miss' && (e.xg >= 0.35 || e.penalty)) return `💨 ${e.label}' ${nm(e.playerId)} büyük fırsatı kaçırdı`;
    return null;
  };
  const draw = (full) => {
    minuteEl.textContent = ticks[ui.tick].label;
    prog.style.width = `${(ui.tick / last) * 100}%`;
    rows.forEach((r, i) => {
      const goals = evTicks[i].filter((x) => x.t <= ui.tick && x.e.type === 'goal');
      r.score.textContent = `${goals.filter((x) => x.e.side === 'home').length} - ${goals.filter((x) => x.e.side === 'away').length}`;
      const lastGoal = goals[goals.length - 1];
      r.last1.textContent = lastGoal ? `⚽ ${nm(lastGoal.e.playerId)} ${lastGoal.e.label}'` : '';
    });
    if (full) {
      clear(feed);
      const all = [];
      evTicks.forEach((list, i) => list.forEach((x) => { if (x.t <= ui.tick) { const d = describe(x.e, i); if (d) all.push({ t: x.t, d }); } }));
      all.sort((a, b) => b.t - a.t).forEach((x) => feed.appendChild(h('div', { class: 'ev' }, x.d)));
    }
    playBtn.textContent = ui.tick >= last ? '↺ Baştan' : ui.playing ? '❚❚ Duraklat' : '▶︎ Oynat';
  };
  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    if (!ui.playing || ui.tick >= last) return;
    const base = (SEC_PER_MIN * 1000) / ui.speed;
    timer = setTimeout(step, ticks[ui.tick].sp === 'ht' ? base * 2 : base);
  };
  const step = () => {
    if (!document.body.contains(wrap) || ui.tick >= last) return;
    ui.tick++;
    let goal = false;
    evTicks.forEach((list, i) => list.forEach((x) => {
      if (x.t !== ui.tick) return;
      const d = describe(x.e, i);
      if (d) feed.insertBefore(h('div', { class: `ev ${x.e.type === 'goal' ? 'goal' : ''}` }, d), feed.firstChild);
      if (x.e.type === 'goal') { goal = true; rows[i].score.classList.remove('flash'); void rows[i].score.offsetWidth; rows[i].score.classList.add('flash'); }
    }));
    if (goal) chime('goal');
    if (ui.tick >= last) { ui.playing = false; markWeekSeen(app.code, week); }
    draw(false);
    schedule();
  };
  playBtn.onclick = () => { if (ui.tick >= last) { ui.tick = 0; ui.playing = true; draw(true); } else ui.playing = !ui.playing; draw(false); schedule(); };
  const speedSeg = h('div', { class: 'seg' }, [[1, 'Canlı hız'], [3, '3x'], [8, '8x']].map(([v, l]) => h('button', { class: ui.speed === v ? 'on' : '', onclick: (e) => { ui.speed = v; [...e.target.parentNode.children].forEach((b) => b.classList.remove('on')); e.target.classList.add('on'); schedule(); } }, l)));
  app.cleanup = () => clearTimeout(timer);
  wrap.append(
    topbar(`${week}. hafta`, isLive ? 'Canlı yayın — herkesle aynı dakikada' : 'Haftanın tekrarı', { back }),
    h('div', { class: 'card' }, h('div', { class: 'row between' }, minuteEl, badge), h('div', { class: 'sb-progress' }, prog)),
    h('div', { class: 'row wrap mb', style: { gap: '8px' } }, playBtn, speedSeg,
      h('button', { class: 'btn sm primary', onclick: () => { clearTimeout(timer); ui.tick = last; ui.playing = false; markWeekSeen(app.code, week); draw(true); } }, '⏭ Sona git')),
    ...rows.map((r) => r.row),
    h('div', { class: 'btns mb' }, ms.map((m) => h('button', { class: 'btn sm', onclick: () => { markWeekSeen(app.code, week); ctx.go('room', { sub: 'match', id: m.id }); } }, `${(room.members[m.home] || {}).team || ''} – ${(room.members[m.away] || {}).team || ''} detayı`))),
    h('h3', null, 'Önemli anlar'),
    feed);
  draw(true);
  schedule();
  return wrap;
}
