// Pre-match, live match playback, post-match report and replay.
// The match is simulated and finalised once when it starts; the live screen
// plays the stored event log back minute by minute. Replay re-runs the engine
// with the stored input + seed and checks it matches the stored result.
import { h, clear, toast, condBar } from '../dom.js';
import { getManager, prepareMatchInput, playMatch, replayMatch, weekOf } from '../../core/league.js';
import { resultFingerprint } from '../../core/engine.js';
import { TACTIC_STYLES, MAX_SUBS } from '../../core/config.js';
import { eaScore, shortName } from '../../core/players.js';
import { topbar, teamLabel, posBadge, ratingBadge, openPlayerSheet } from '../components.js';

// ---------- pre-match
export function renderPrematch(ctx) {
  const { app } = ctx;
  const st = app.league;
  const mt = st && st.matches[app.params.id];
  if (!mt) { setTimeout(() => ctx.go('hub')); return h('div'); }
  if (mt.status === 'finished') { setTimeout(() => ctx.go('match', { id: mt.id, mode: 'report' })); return h('div'); }
  const isCurrent = mt.week === st.currentWeek && st.phase === 'season';
  const { input, notes } = prepareMatchInput(st, mt.id, app.byId);
  const w = weekOf(st, mt.week);

  const teamCard = (side) => {
    const t = input[side];
    const m = getManager(st, t.id);
    const xi = t.lineup.map((l) => ({ ...l, p: t.players[l.playerId] }));
    const avgEa = xi.reduce((a, l) => a + eaScore(l.p, l.slot), 0) / 11;
    const avgCond = xi.reduce((a, l) => a + l.p.condition, 0) / 11;
    return h('div', { class: 'card' },
      h('div', { class: 'row between mb' }, h('b', null, teamLabel(st, t.id)), h('span', { class: 'tag' }, side === 'home' ? 'İç saha' : 'Deplasman')),
      h('div', { class: 'small muted mb' }, `${t.formation} · ${TACTIC_STYLES[t.style].label} · Güç ${avgEa.toFixed(1)} · Kondisyon ${Math.round(avgCond)}`),
      h('div', { class: 'list' }, xi.map((l) => h('button', { class: 'item', style: { minHeight: '44px' }, onclick: () => openPlayerSheet(ctx, l.playerId) },
        posBadge(l.p, l.slot), h('div', { class: 'grow ellipsis' }, l.p.name), condBar(l.p.condition, '54px'), h('span', { class: 'small muted', style: { width: '26px', textAlign: 'right' } }, Math.round(l.p.condition))))),
      h('div', { class: 'small muted mt' }, `Yedekler: ${t.bench.map((id) => shortName(t.players[id].name)).join(', ') || '—'}`),
      m.isHuman && isCurrent ? h('button', { class: 'btn sm block mt', onclick: () => ctx.go('team', { id: m.id, back: { view: 'prematch', params: { id: mt.id } } }) }, 'Taktiği / ilk 11\'i düzenle') : null,
      m.isHuman && t.subRules.length ? h('div', { class: 'small muted mt' }, `${t.subRules.length} otomatik değişiklik kuralı aktif.`) : null);
  };

  const start = (mode) => {
    const res = ctx.commit((s) => playMatch(s, mt.id, app.byId), { rerender: false });
    if (res) ctx.go('match', { id: mt.id, mode });
  };

  return h('div', null,
    topbar(ctx, `Hafta ${mt.week}`, `BAY: ${getManager(st, w.bye).name}`, { back: () => ctx.go('hub') }),
    notes.length ? h('div', { class: 'card small' }, notes.map((n) => h('div', null, '⚠️ ', n))) : null,
    teamCard('home'), teamCard('away'),
    h('div', { class: 'card small muted' }, `Maç başladığında sonuç kesinleşir ve bir daha değiştirilemez. İzlerken hızlandırabilir veya anında bitirebilirsin. Maçta en fazla ${MAX_SUBS} oyuncu değişikliği yapılır.`),
    isCurrent ? h('div', { class: 'stack' },
      h('button', { class: 'btn block primary', onclick: () => start('live') }, '▶︎ Maçı Başlat'),
      h('button', { class: 'btn block', onclick: () => start('report') }, 'Sonucu hemen göster')) : h('div', { class: 'card' }, 'Bu maç bu haftanın maçı değil.'));
}

// ---------- commentary
function name(input, pid) {
  const p = input.home.players[pid] || input.away.players[pid];
  return p ? p.name : '?';
}
function sideOf(input, pid) { return input.home.players[pid] ? 'home' : 'away'; }

function describe(ev, input, teamName) {
  const n = (pid) => name(input, pid);
  switch (ev.type) {
    case 'kickoff': return ['⏱️', 'Maç başladı!'];
    case 'halftime': return ['⏸️', `İlk yarı sona erdi: ${ev.score[0]} - ${ev.score[1]}`];
    case 'fulltime': return ['🏁', `Maç sona erdi: ${ev.score[0]} - ${ev.score[1]}`];
    case 'goal': return ['⚽', `GOL! ${n(ev.playerId)}${ev.penalty ? ' (penaltı)' : ''}${ev.assistId ? ` · Asist: ${n(ev.assistId)}` : ''} — ${teamName(ev.side)} (${ev.score[0]}-${ev.score[1]})`];
    case 'save': return ['🧤', `${ev.penalty ? 'Penaltıyı kurtardı! ' : ''}${ev.keeperId ? n(ev.keeperId) : 'Kaleci'} ${n(ev.playerId)}'in şutunu çıkardı.`];
    case 'miss': return ['💨', `${ev.penalty ? 'Penaltı kaçtı! ' : 'Büyük fırsat! '}${n(ev.playerId)} şutunu çerçeveye gönderemedi.`];
    case 'yellow': return ['🟨', `${n(ev.playerId)} sarı kart gördü${ev.second ? ' (ikinci sarı)' : ''}.`];
    case 'red': return ['🟥', `${n(ev.playerId)} ${ev.kind === 'second' ? 'ikinci sarıdan ' : 'direkt '}kırmızı kartla oyun dışı!`];
    case 'injury': return ['🚑', `${n(ev.playerId)} sakatlandı (${ev.weeks} hafta).`];
    case 'down': return ['⚠️', `${n(ev.playerId)} devam edemiyor, değişiklik hakkı yok: takım eksik kaldı.`];
    case 'sub': {
      const why = { injury: 'sakatlık', 'rule:fatigue': 'kural: kondisyon', 'rule:minute': 'kural: dakika', 'rule:losing': 'kural: geride', 'rule:winning': 'kural: önde', 'rule:drawing': 'kural: beraberlik', 'rule:yellow': 'kural: sarı kart', 'auto:fatigue': 'yorgunluk', 'auto:chase': 'skor arayışı', 'gk-red': 'kaleci kırmızı' }[ev.reason] || '';
      return ['🔁', `${n(ev.in)} oyuna girdi, ${n(ev.out)} çıktı${why ? ` (${why})` : ''}.`];
    }
    default: return null;
  }
}

function visible(ev) {
  if (ev.type === 'foul') return false;
  if (ev.type === 'save') return ev.xg >= 0.12 || ev.penalty;
  if (ev.type === 'miss') return ev.xg >= 0.25 || ev.penalty;
  return true;
}

// Build the playback timeline: one tick per played minute (incl. stoppage time).
function buildTicks(result) {
  const ht = result.events.find((e) => e.type === 'halftime');
  const ft = result.events.find((e) => e.type === 'fulltime');
  const ticks = [{ minute: 0, extra: 0, label: "0'", special: 'kickoff' }];
  for (let m = 1; m <= 45; m++) ticks.push({ minute: m, extra: 0, label: `${m}'` });
  for (let e = 1; e <= ht.extra; e++) ticks.push({ minute: 45, extra: e, label: `45+${e}'` });
  ticks.push({ special: 'halftime', label: 'İY' });
  for (let m = 46; m <= 90; m++) ticks.push({ minute: m, extra: 0, label: `${m}'` });
  for (let e = 1; e <= ft.extra; e++) ticks.push({ minute: 90, extra: e, label: `90+${e}'` });
  ticks.push({ special: 'fulltime', label: 'MS' });
  // assign events to ticks (events are stored in chronological order)
  let ti = 0;
  const evTick = [];
  for (const ev of result.events) {
    if (ev.type === 'kickoff') { evTick.push(0); continue; }
    if (ev.type === 'halftime') { ti = ticks.findIndex((t) => t.special === 'halftime'); evTick.push(ti); continue; }
    if (ev.type === 'fulltime') { evTick.push(ticks.length - 1); continue; }
    let k = ticks.findIndex((t, i) => i >= ti && !t.special && t.minute === ev.minute && t.extra === (ev.extra || 0));
    if (k < 0) k = ti;
    ti = k;
    evTick.push(k);
  }
  return { ticks, evTick };
}

// ---------- live / report / replay
export function renderMatch(ctx) {
  const { app } = ctx;
  const st = app.league;
  const mt = st && st.matches[app.params.id];
  if (!mt || mt.status !== 'finished') { setTimeout(() => ctx.go('hub')); return h('div'); }
  const mode = app.params.mode || 'report';
  let result = mt.result;
  let replayOk = true;
  if (mode === 'replay') {
    result = replayMatch(st, mt.id);
    replayOk = resultFingerprint(result) === resultFingerprint(mt.result);
  }
  const input = mt.input;
  const { ticks, evTick } = buildTicks(result);
  const lastTick = ticks.length - 1;
  const ui = { tick: mode === 'report' ? lastTick : 0, speed: app.ui.matchSpeed || 2, playing: mode !== 'report', tab: mode === 'report' ? 'ratings' : 'feed', shown: 0 };
  const teamName = (side) => getManager(st, input[side].id).name;
  const color = (side) => getManager(st, input[side].id).color;

  // --- static skeleton
  const scoreEl = h('div', { class: 'sb-score' }, '0 - 0');
  const minuteEl = h('div', { class: 'sb-minute' }, "0'");
  const progEl = h('i');
  const scorersHome = h('div'), scorersAway = h('div', { class: 'away' });
  const board = h('div', { class: 'scoreboard' },
    h('div', { class: 'sb-teams' },
      h('div', { class: 'sb-team' }, h('span', { class: 'dot', style: { background: color('home') } }), h('span', { class: 'ellipsis' }, teamName('home'))),
      h('div', null, scoreEl, minuteEl),
      h('div', { class: 'sb-team away' }, h('span', { class: 'ellipsis' }, teamName('away')), h('span', { class: 'dot', style: { background: color('away') } }))),
    h('div', { class: 'sb-progress' }, progEl),
    h('div', { class: 'sb-scorers' }, scorersHome, scorersAway));

  const playBtn = h('button', { class: 'btn sm' });
  const speedSeg = h('div', { class: 'seg' });
  const controls = h('div', { class: 'row wrap mb', style: { gap: '8px' } }, playBtn, speedSeg,
    h('button', { class: 'btn sm primary', onclick: () => { ui.tick = lastTick; ui.playing = false; ui.tab = 'ratings'; fullRefresh(); } }, '⏭ Bitir'));

  const tabsEl = h('div', { class: 'chips mb' });
  const panel = h('div');
  const feedEl = h('div', { class: 'feed' });

  const root = h('div', null,
    topbar(ctx, mode === 'replay' ? 'Maç Tekrarı' : `Hafta ${mt.week}`, mode === 'replay' ? (replayOk ? 'Aynı seed ile yeniden simüle edildi ✓' : 'UYARI: tekrar farklı çıktı') : 'Maç merkezi', { back: () => ctx.go('hub') }),
    board, controls, tabsEl, panel,
    h('div', { class: 'btns mt' },
      h('button', { class: 'btn', onclick: () => ctx.go('match', { id: mt.id, mode: 'replay' }) }, '🔁 Tekrarı izle'),
      h('button', { class: 'btn primary', onclick: () => ctx.go(st.phase === 'finished' && !app.ui.championSeen ? 'champion' : 'hub') }, 'Devam →')));

  // --- derived state up to the current tick
  const eventsUpTo = (tick) => result.events.filter((e, i) => evTick[i] <= tick);
  const minuteTicksPlayed = (tick) => ticks.slice(1, tick + 1).filter((t) => !t.special).length;

  const liveStats = (evs) => {
    const s = { home: { goals: 0, shots: 0, sot: 0, saves: 0, yellow: 0, red: 0, fouls: 0, subs: 0, xg: 0 }, away: { goals: 0, shots: 0, sot: 0, saves: 0, yellow: 0, red: 0, fouls: 0, subs: 0, xg: 0 } };
    for (const e of evs) {
      const x = s[e.side];
      if (!x) continue;
      if (e.type === 'goal') { x.goals++; x.shots++; x.sot++; x.xg += e.xg; }
      if (e.type === 'save') { x.shots++; x.sot++; x.xg += e.xg; s[e.side === 'home' ? 'away' : 'home'].saves++; }
      if (e.type === 'miss') { x.shots++; x.xg += e.xg; }
      if (e.type === 'yellow' && !e.second) x.yellow++;
      if (e.type === 'red') x.red++;
      if (e.type === 'foul') x.fouls++;
      if (e.type === 'sub') x.subs++;
    }
    return s;
  };

  const renderTabs = () => {
    clear(tabsEl);
    const tabs = [['feed', 'Olaylar'], ['stats', 'İstatistik'], ['lineups', 'Kadrolar']];
    if (ui.tick === lastTick) tabs.unshift(['ratings', 'Puanlar']);
    for (const [k, l] of tabs) tabsEl.appendChild(h('button', { class: `chip ${ui.tab === k ? 'on' : ''}`, onclick: () => { ui.tab = k; renderPanel(); renderTabs(); } }, l));
  };

  const renderControls = () => {
    const ended = ui.tick >= lastTick;
    playBtn.textContent = ended ? '↺ Baştan' : ui.playing ? '❚❚ Duraklat' : '▶︎ Oynat';
    playBtn.onclick = () => {
      if (ended) { ui.tick = 0; ui.playing = true; ui.tab = 'feed'; fullRefresh(); return; }
      ui.playing = !ui.playing; renderControls(); schedule();
    };
    clear(speedSeg);
    for (const [v, l] of [[1, '1x'], [2, '2x'], [4, '4x'], [10, '10x']]) {
      speedSeg.appendChild(h('button', { class: ui.speed === v ? 'on' : '', onclick: () => { ui.speed = v; app.ui.matchSpeed = v; renderControls(); schedule(); } }, l));
    }
  };

  const renderBoard = (evs, animateGoal) => {
    const s = liveStats(evs);
    const prev = scoreEl.textContent;
    scoreEl.textContent = `${s.home.goals} - ${s.away.goals}`;
    if (animateGoal && prev !== scoreEl.textContent) { scoreEl.classList.remove('flash'); void scoreEl.offsetWidth; scoreEl.classList.add('flash'); }
    const t = ticks[ui.tick];
    minuteEl.textContent = t.special === 'halftime' ? 'Devre arası' : t.special === 'fulltime' ? 'Maç sonu' : t.label;
    progEl.style.width = `${(ui.tick / lastTick) * 100}%`;
    const goals = evs.filter((e) => e.type === 'goal');
    const fmt = (side) => goals.filter((g) => g.side === side).map((g) => `${shortName(name(input, g.playerId))} ${g.label}'${g.penalty ? ' (p)' : ''}`).join(', ');
    scorersHome.textContent = fmt('home');
    scorersAway.textContent = fmt('away');
  };

  const feedItem = (ev) => {
    const d = describe(ev, input, teamName);
    if (!d) return null;
    const neutral = ['kickoff', 'halftime', 'fulltime'].includes(ev.type);
    return h('div', { class: `ev ${ev.type} ${neutral ? 'neutral' : ''}` },
      neutral ? null : h('span', { class: 'm' }, `${ev.label}'`),
      h('span', { class: 'i' }, d[0]),
      h('span', { class: 'grow' }, neutral ? null : h('span', { class: 'dot', style: { background: color(ev.side), marginRight: '6px' } }), d[1]));
  };

  const renderFeed = (evs) => {
    clear(feedEl);
    const items = evs.filter(visible).slice().reverse();
    for (const e of items) { const el = feedItem(e); if (el) feedEl.appendChild(el); }
    ui.shown = evs.length;
  };

  const statsPanel = (evs) => {
    const s = liveStats(evs);
    const played = minuteTicksPlayed(ui.tick);
    const poss = played ? Math.round(result.possession.slice(0, played).reduce((a, b) => a + b, 0) / played) : 50;
    const row = (label, a, b, fmt = (v) => v) => {
      const tot = (a + b) || 1;
      return h('div', null,
        h('div', { class: 'statrow' }, h('span', { class: 'v' }, fmt(a)), h('span', { class: 'lbl' }, label), h('span', { class: 'v' }, fmt(b))),
        h('div', { class: 'splitbar' }, h('i', { style: { width: `${(a / tot) * 100}%`, background: color('home') } }), h('i', { style: { width: `${(b / tot) * 100}%`, background: color('away') } })));
    };
    return h('div', { class: 'card' },
      row('Topla oynama %', poss, 100 - poss),
      row('Şut', s.home.shots, s.away.shots),
      row('İsabetli şut', s.home.sot, s.away.sot),
      row('Gol beklentisi (xG)', Math.round(s.home.xg * 100) / 100, Math.round(s.away.xg * 100) / 100, (v) => v.toFixed(2)),
      row('Kurtarış', s.home.saves, s.away.saves),
      row('Faul', s.home.fouls, s.away.fouls),
      row('Sarı kart', s.home.yellow, s.away.yellow),
      row('Kırmızı kart', s.home.red, s.away.red),
      row(`Değişiklik (maks ${MAX_SUBS})`, s.home.subs, s.away.subs));
  };

  const lineupsPanel = (evs) => {
    const subs = evs.filter((e) => e.type === 'sub');
    const reds = new Set(evs.filter((e) => e.type === 'red').map((e) => e.playerId));
    const goalsBy = {}, assistsBy = {}, yellows = new Set(evs.filter((e) => e.type === 'yellow').map((e) => e.playerId));
    for (const g of evs.filter((e) => e.type === 'goal')) { goalsBy[g.playerId] = (goalsBy[g.playerId] || 0) + 1; if (g.assistId) assistsBy[g.assistId] = (assistsBy[g.assistId] || 0) + 1; }
    const col = (side) => {
      const t = input[side];
      const rows = [];
      const icons = (pid) => [goalsBy[pid] ? '⚽'.repeat(goalsBy[pid]) : '', assistsBy[pid] ? '🅰️'.repeat(assistsBy[pid]) : '', yellows.has(pid) ? '🟨' : '', reds.has(pid) ? '🟥' : ''].join('');
      for (const l of t.lineup) {
        const out = subs.find((s) => s.out === l.playerId);
        rows.push(h('div', { class: 'item', style: { minHeight: '40px' } }, posBadge(t.players[l.playerId], l.slot),
          h('div', { class: 'grow ellipsis small' }, shortName(t.players[l.playerId].name), ' ', icons(l.playerId)), out ? h('span', { class: 'small', style: { color: 'var(--danger)' } }, `▼${out.label}'`) : null));
      }
      for (const s of subs.filter((x) => x.side === side)) {
        rows.push(h('div', { class: 'item', style: { minHeight: '40px' } }, posBadge(t.players[s.in], s.slot),
          h('div', { class: 'grow ellipsis small' }, shortName(t.players[s.in].name), ' ', icons(s.in)), h('span', { class: 'small', style: { color: 'var(--accent)' } }, `▲${s.label}'`)));
      }
      return h('div', null, h('div', { class: 'small muted mb' }, teamName(side)), h('div', { class: 'list' }, rows));
    };
    return h('div', { class: 'grid2' }, col('home'), col('away'));
  };

  const ratingsPanel = () => {
    const motm = result.motm;
    const mp = motm && (input.home.players[motm] || input.away.players[motm]);
    const list = (side) => Object.entries(result.playerStats).filter(([, x]) => x.side === side && x.played)
      .sort((a, b) => b[1].rating - a[1].rating)
      .map(([pid, x]) => h('button', { class: 'item', style: { minHeight: '44px' }, onclick: () => openPlayerSheet(ctx, pid) },
        ratingBadge(x.rating),
        h('div', { class: 'grow' }, h('div', { class: 'ellipsis small name' }, shortName(input[side].players[pid].name), pid === motm ? ' ⭐' : ''),
          h('div', { class: 'meta' }, `${x.minutes}' ${x.goals ? `· ${x.goals}G ` : ''}${x.assists ? `· ${x.assists}A ` : ''}${x.saves ? `· ${x.saves} kurt. ` : ''}${x.yellow ? '🟨' : ''}${x.red ? '🟥' : ''}${x.injured ? '🚑' : ''}`))));
    return h('div', null,
      mp ? h('div', { class: 'card award' }, h('div', { class: 'trophy' }, '⭐'),
        h('div', { class: 'grow' }, h('div', { class: 'small muted' }, 'Maçın oyuncusu'), h('div', { class: 'name' }, mp.name),
          h('div', { class: 'small muted' }, `${teamName(sideOf(input, motm))} · ${result.playerStats[motm].goals} gol · ${result.playerStats[motm].assists} asist`)),
        ratingBadge(result.playerStats[motm].rating)) : null,
      h('div', { class: 'grid2' },
        h('div', null, h('div', { class: 'small muted mb' }, teamName('home')), h('div', { class: 'list' }, list('home'))),
        h('div', null, h('div', { class: 'small muted mb' }, teamName('away')), h('div', { class: 'list' }, list('away')))));
  };

  const renderPanel = () => {
    clear(panel);
    const evs = eventsUpTo(ui.tick);
    if (ui.tab === 'stats') panel.appendChild(statsPanel(evs));
    else if (ui.tab === 'lineups') panel.appendChild(lineupsPanel(evs));
    else if (ui.tab === 'ratings' && ui.tick === lastTick) panel.appendChild(ratingsPanel());
    else { ui.tab = 'feed'; renderFeed(evs); panel.appendChild(feedEl); }
  };

  const fullRefresh = () => {
    const evs = eventsUpTo(ui.tick);
    renderBoard(evs, false);
    renderControls();
    renderTabs();
    renderPanel();
    schedule();
  };

  // --- playback loop
  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    if (!ui.playing || ui.tick >= lastTick) return;
    const t = ticks[ui.tick];
    const base = 700 / ui.speed;
    const delay = t.special === 'halftime' ? base * 3 : base;
    timer = setTimeout(step, delay);
  };
  const step = () => {
    if (!document.body.contains(root)) return;
    ui.tick += 1;
    const newEvs = result.events.filter((e, i) => evTick[i] === ui.tick);
    const evs = eventsUpTo(ui.tick);
    renderBoard(evs, true);
    for (const e of newEvs) {
      if (e.type === 'goal') goalPopup(e);
    }
    if (ui.tab === 'feed') {
      for (const e of newEvs.filter(visible)) { const el = feedItem(e); if (el) feedEl.insertBefore(el, feedEl.firstChild); }
    } else renderPanel();
    if (ui.tick >= lastTick) { ui.playing = false; ui.tab = 'ratings'; renderTabs(); renderPanel(); toast('Maç bitti.', 'ok'); }
    renderControls();
    schedule();
  };
  const goalPopup = (e) => {
    const el = h('div', { class: 'goal-pop' }, h('b', null, 'GOL!'), h('div', null, name(input, e.playerId), e.penalty ? ' (penaltı)' : ''),
      e.assistId ? h('div', { class: 'small' }, 'Asist: ', name(input, e.assistId)) : null, h('div', { class: 'small' }, `${teamName(e.side)} · ${e.score[0]}-${e.score[1]}`));
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2300);
  };

  app.cleanup = () => { clearTimeout(timer); timer = null; };
  setTimeout(fullRefresh, 0);
  if (mode === 'replay' && !replayOk) toast('Tekrar kaydedilen sonuçtan farklı çıktı!', 'err');
  return root;
}
