// Season report for sharing: collects a season (current or archived) into plain
// rows, then turns them into a pdfmake document definition. No DOM here, so the
// tests can check the content; src/ui/pdf.js renders it in the browser.
import { toArray, squads } from './draft.js';
import { standings, seasonStats, weeksOf, finishedMatches, BONUS } from './season.js';
import { isGK } from './positions.js';

const fmtDate = (t) => {
  if (!t) return '';
  const d = new Date(Number(t));
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
};
const r2 = (v) => (Math.round(Number(v || 0) * 100) / 100).toFixed(2);
const signed = (v) => (v > 0 ? `+${v}` : String(v));

// names: optional { pid: { name, pos } } saved with an archive (in case the player pool changes later)
export function buildSeasonReport(room, byId, { seasonNo = 1, names = {}, generatedAt = Date.now() } = {}) {
  const season = room.season || {};
  const P = (pid) => byId[pid] || names[pid] || null;
  const nm = (pid) => (P(pid) ? P(pid).name : pid || '—');
  const pos = (pid) => (P(pid) ? P(pid).pos || '' : '');
  const member = (seat) => (room.members || {})[seat] || {};
  const team = (seat) => member(seat).team || member(seat).name || '—';
  const weeks = weeksOf(season);
  const played = finishedMatches(season);
  const stamps = Object.values(season.weeksPlayed || {}).map(Number).filter((x) => x > 1e11);
  const table = standings(room).map((r) => ({
    rank: r.rank, seat: r.seat, team: r.name, manager: member(r.seat).name || '', color: member(r.seat).color || '#888888',
    played: r.played, won: r.won, drawn: r.drawn, lost: r.lost, gf: r.gf, ga: r.ga, gd: r.gd, points: r.points, bonus: r.bonus, total: r.total,
  }));
  const stats = seasonStats(room);
  const rows = Object.entries(stats).map(([pid, s]) => ({ pid, ...s })).filter((r) => r.apps > 0);
  const line = (r, value) => ({ player: nm(r.pid), team: team(r.seat), apps: r.apps, value });
  const scorers = rows.filter((r) => r.goals).sort((a, b) => b.goals - a.goals || a.minutes - b.minutes).slice(0, 15).map((r) => line(r, r.goals));
  const assists = rows.filter((r) => r.assists).sort((a, b) => b.assists - a.assists || a.minutes - b.minutes).slice(0, 15).map((r) => line(r, r.assists));
  const minApps = Math.max(2, Math.floor(weeks.length / 4));
  const ratings = rows.filter((r) => r.apps >= minApps).sort((a, b) => b.avgRating - a.avgRating).slice(0, 15).map((r) => line(r, r2(r.avgRating)));
  const keepers = rows.filter((r) => P(r.pid) && isGK({ pos: pos(r.pid) })).sort((a, b) => b.cleanSheets - a.cleanSheets || b.saves - a.saves)
    .map((r) => ({ player: nm(r.pid), team: team(r.seat), apps: r.apps, cleanSheets: r.cleanSheets, saves: r.saves, conceded: r.conceded }));

  const aw = season.finished ? season.awards : null;
  const awards = [];
  if (aw) {
    const add = (title, a, detail) => { if (a) awards.push({ title, player: nm(a.pid), team: team(a.seat), detail }); };
    add('Gol kralı', aw.topScorer, aw.topScorer && `${aw.topScorer.goals} gol · takımına +${BONUS.topScorer} puan`);
    add('Asist kralı', aw.topAssist, aw.topAssist && `${aw.topAssist.assists} asist · takımına +${BONUS.topAssist} puan`);
    add('Sezonun oyuncusu', aw.playerOfSeason, aw.playerOfSeason && `ortalama puan ${r2(aw.playerOfSeason.avgRating)}`);
    add('En iyi kaleci', aw.bestKeeper, aw.bestKeeper && `ortalama ${r2(aw.bestKeeper.avgRating)} · ${aw.bestKeeper.cleanSheets} maç gol yemedi`);
    add('Draftın en iyi seçimi', aw.bestPick, aw.bestPick && `${aw.bestPick.pick}. sırada seçildi, performansta ${aw.bestPick.perfRank}. oldu`);
  }
  const karma = aw ? toArray(aw.karma).map((k) => ({ slot: k.slot, player: nm(k.pid), team: team(k.seat), rating: r2(k.avgRating) })) : [];

  const goalText = (g) => `${nm(g.playerId)} ${g.label}'${g.penalty ? ' (pen.)' : ''}${g.assistId ? ` [asist: ${nm(g.assistId)}]` : ''}`;
  const weekRows = weeks.map((w) => {
    const matches = toArray(w.matches).map((m) => {
      const r = season.matches && season.matches[m.id];
      if (!r) return { home: team(m.home), away: team(m.away), played: false };
      const goals = toArray(r.goals);
      const reds = toArray(r.cards).filter((c) => c.type === 'red');
      return {
        home: team(m.home), away: team(m.away), played: true, homeGoals: r.homeGoals, awayGoals: r.awayGoals,
        homeScorers: goals.filter((g) => g.side === 'home').map(goalText), awayScorers: goals.filter((g) => g.side === 'away').map(goalText),
        reds: reds.map((c) => `${nm(c.playerId)} ${c.label}'${c.second ? ' (2. sarı)' : ''}`),
        motm: r.motm ? nm(r.motm) : null,
        possession: r.teamStats && r.teamStats.home ? [Math.round(r.teamStats.home.possession || 50), Math.round((r.teamStats.away || {}).possession || 50)] : null,
        shots: r.teamStats && r.teamStats.home ? [r.teamStats.home.shots || 0, (r.teamStats.away || {}).shots || 0] : null,
      };
    });
    return { week: w.week, date: fmtDate(season.weeksPlayed && season.weeksPlayed[w.week]), bye: w.bye ? team(w.bye) : null, matches };
  });

  const sq = squads(room.draft);
  const pickNo = {};
  toArray(room.draft && room.draft.picks).forEach((p, i) => { if (p) pickNo[p.pid] = i + 1; });
  const teams = table.map((t) => ({
    team: t.team, manager: t.manager, color: t.color, rank: t.rank,
    players: (sq[t.seat] || []).map((pid) => {
      const s = stats[pid] || {};
      return { pick: pickNo[pid] || 0, player: nm(pid), pos: pos(pid), apps: s.apps || 0, goals: s.goals || 0, assists: s.assists || 0, rating: s.apps ? r2(s.avgRating) : '—' };
    }).sort((a, b) => a.pick - b.pick),
  }));

  const totalGoals = played.reduce((a, m) => a + (m.homeGoals || 0) + (m.awayGoals || 0), 0);
  const champ = season.finished && season.champion ? table.find((t) => t.seat === season.champion) : null;
  return {
    league: (room.public && room.public.name) || 'Draft Arena Ligi',
    seasonNo,
    generatedAt: fmtDate(generatedAt),
    finished: !!season.finished,
    weeksTotal: weeks.length,
    weeksPlayed: Math.min(weeks.length, Math.max(0, (season.currentWeek || 1) - 1)),
    dateFrom: stamps.length ? fmtDate(Math.min(...stamps)) : '',
    dateTo: stamps.length ? fmtDate(Math.max(...stamps)) : '',
    matchesPlayed: played.length,
    totalGoals,
    goalsPerMatch: played.length ? (totalGoals / played.length).toFixed(2) : '0',
    champion: champ ? { team: champ.team, manager: champ.manager, total: champ.total } : null,
    table, awards, karma, scorers, assists, ratings, keepers, weeks: weekRows, teams,
  };
}

// ---------- pdfmake document
const C = { ink: '#14213d', muted: '#5c6b80', line: '#d5dbe3', zebra: '#f3f6fa', head: '#14213d', gold: '#b7791f' };
const zebra = {
  hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length ? 0.8 : 0.4),
  vLineWidth: () => 0,
  hLineColor: (i) => (i === 1 ? C.ink : C.line),
  fillColor: (i) => (i === 0 ? C.head : i % 2 === 0 ? C.zebra : null),
  paddingTop: () => 3, paddingBottom: () => 3, paddingLeft: () => 4, paddingRight: () => 4,
};
const th = (t, alignment = 'center') => ({ text: t, style: 'th', alignment });
const td = (t, extra = {}) => ({ text: t == null ? '' : String(t), alignment: 'center', ...extra });

function leaderTable(title, rows, valueLabel) {
  if (!rows.length) return [];
  return [
    { text: title, style: 'h3' },
    {
      table: { headerRows: 1, widths: [16, '*', '*', 28, 34], body: [
        [th('#'), th('Oyuncu', 'left'), th('Takım', 'left'), th('Maç'), th(valueLabel)],
        ...rows.map((r, i) => [td(i + 1), td(r.player, { alignment: 'left' }), td(r.team, { alignment: 'left', color: C.muted }), td(r.apps), td(r.value, { bold: true })]),
      ] },
      layout: zebra, fontSize: 8.5, margin: [0, 0, 0, 10],
    },
  ];
}

export function reportDoc(data) {
  const title = `${data.league} · ${data.seasonNo}. sezon`;
  const status = data.finished ? 'Sezon tamamlandı' : `${data.weeksPlayed}/${data.weeksTotal} hafta oynandı`;
  const range = data.dateFrom ? (data.dateFrom === data.dateTo ? data.dateFrom : `${data.dateFrom} – ${data.dateTo}`) : '';
  const content = [];

  content.push(
    { text: 'DRAFT ARENA · SEZON RAPORU', style: 'kicker' },
    { text: title, style: 'title' },
    { text: [status, range ? ` · ${range}` : '', ` · ${data.matchesPlayed} maç · ${data.totalGoals} gol (maç başı ${data.goalsPerMatch})`].join(''), style: 'sub' },
  );
  if (data.champion) {
    content.push({
      table: { widths: ['*'], body: [[{ stack: [
        { text: 'ŞAMPİYON', fontSize: 8, bold: true, color: C.gold, characterSpacing: 1.5 },
        { text: data.champion.team, fontSize: 18, bold: true, color: C.ink, margin: [0, 2, 0, 0] },
        { text: `${data.champion.manager ? `${data.champion.manager} · ` : ''}${data.champion.total} puan`, color: C.muted },
      ], margin: [8, 6, 8, 6] }]] },
      layout: { hLineWidth: () => 1, vLineWidth: () => 1, hLineColor: () => C.gold, vLineColor: () => C.gold, fillColor: () => '#fff8e6' },
      margin: [0, 4, 0, 12],
    });
  }

  // standings
  const showBonus = data.finished;
  content.push({ text: 'Puan durumu', style: 'h2' });
  content.push({
    table: {
      headerRows: 1,
      widths: [14, 6, '*', 18, 18, 18, 18, 22, 22, 24, ...(showBonus ? [28] : []), 26],
      body: [
        [th('#'), th(''), th('Takım', 'left'), th('O'), th('G'), th('B'), th('M'), th('AG'), th('YG'), th('AV'), ...(showBonus ? [th('Bonus')] : []), th('P')],
        ...data.table.map((r) => [
          td(r.rank, { bold: true }), { text: '', fillColor: r.color },
          { stack: [{ text: r.team, bold: true }, r.manager ? { text: r.manager, fontSize: 7, color: C.muted } : ''] },
          td(r.played), td(r.won), td(r.drawn), td(r.lost), td(r.gf), td(r.ga), td(signed(r.gd)),
          ...(showBonus ? [td(r.bonus ? `+${r.bonus}` : '0', { color: C.gold })] : []), td(r.total, { bold: true }),
        ]),
      ],
    },
    layout: zebra, fontSize: 9, margin: [0, 0, 0, 4],
  });
  content.push({ text: showBonus ? `Bonus: gol kralının takımı +${BONUS.topScorer}, asist kralının takımı +${BONUS.topAssist} puan. Sıralama: puan, averaj, atılan gol, galibiyet.` : 'Gol ve asist kralı bonusları sezon sonunda eklenir.', style: 'note', margin: [0, 0, 0, 12] });

  // awards
  if (data.awards.length) {
    content.push({ text: 'Sezon ödülleri', style: 'h2' });
    content.push({
      table: { headerRows: 1, widths: [100, '*', '*', 150], body: [
        [th('Ödül', 'left'), th('Oyuncu', 'left'), th('Takım', 'left'), th('Detay', 'left')],
        ...data.awards.map((a) => [td(a.title, { alignment: 'left', bold: true }), td(a.player, { alignment: 'left' }), td(a.team, { alignment: 'left', color: C.muted }), td(a.detail, { alignment: 'left', fontSize: 8 })]),
      ] },
      layout: zebra, fontSize: 9, margin: [0, 0, 0, 12],
    });
  }
  if (data.karma.length) {
    content.push({ text: 'Sezonun karması (4-3-3)', style: 'h3' });
    content.push({
      table: { headerRows: 1, widths: [34, '*', '*', 40], body: [
        [th('Mevki'), th('Oyuncu', 'left'), th('Takım', 'left'), th('Ort.')],
        ...data.karma.map((k) => [td(k.slot, { bold: true }), td(k.player, { alignment: 'left' }), td(k.team, { alignment: 'left', color: C.muted }), td(k.rating)]),
      ] },
      layout: zebra, fontSize: 9, margin: [0, 0, 0, 12],
    });
  }

  // leaders (two columns)
  const left = [...leaderTable('Gol krallığı', data.scorers, 'Gol'), ...leaderTable('Ortalama puan', data.ratings, 'Puan')];
  const right = [...leaderTable('Asist krallığı', data.assists, 'Asist')];
  if (data.keepers.length) {
    right.push({ text: 'Kaleciler', style: 'h3' }, {
      table: { headerRows: 1, widths: ['*', 24, 30, 30, 30], body: [
        [th('Oyuncu', 'left'), th('Maç'), th('GYM'), th('Kurt.'), th('Yenen')],
        ...data.keepers.slice(0, 10).map((k) => [{ stack: [k.player, { text: k.team, fontSize: 7, color: C.muted }] }, td(k.apps), td(k.cleanSheets, { bold: true }), td(k.saves), td(k.conceded)]),
      ] },
      layout: zebra, fontSize: 8.5, margin: [0, 0, 0, 2],
    }, { text: 'GYM: gol yemeden tamamlanan maç · Kurt.: kurtarış', style: 'note', margin: [0, 0, 0, 10] });
  }
  if (left.length || right.length) {
    content.push({ text: 'İstatistikler', style: 'h2', pageBreak: 'before' });
    content.push({ columns: [{ width: '*', stack: left }, { width: '*', stack: right }], columnGap: 14 });
  }

  // every match
  content.push({ text: 'Tüm maçlar', style: 'h2', pageBreak: 'before' });
  for (const w of data.weeks) {
    const body = [];
    for (const m of w.matches) {
      body.push([
        td(m.home, { alignment: 'right', bold: true }),
        td(m.played ? `${m.homeGoals} - ${m.awayGoals}` : '–', { bold: true, fontSize: 11 }),
        td(m.away, { alignment: 'left', bold: true }),
      ]);
      if (m.played) {
        const extra = [];
        if (m.reds.length) extra.push(`Kırmızı kart: ${m.reds.join(', ')}`);
        const facts = [m.motm ? `Maçın oyuncusu: ${m.motm}` : '', m.possession ? `Top: %${m.possession[0]} - %${m.possession[1]}` : '', m.shots ? `Şut: ${m.shots[0]} - ${m.shots[1]}` : ''].filter(Boolean).join(' · ');
        body.push([
          { text: m.homeScorers.join('\n'), alignment: 'right', fontSize: 7.5, color: C.muted },
          { text: '' },
          { text: m.awayScorers.join('\n'), alignment: 'left', fontSize: 7.5, color: C.muted },
        ]);
        body.push([{ text: [facts, ...extra.map((x) => `\n${x}`)].join(''), colSpan: 3, alignment: 'center', fontSize: 7, color: C.muted, margin: [0, 0, 0, 3] }, {}, {}]);
      }
    }
    content.push({
      unbreakable: true,
      stack: [
        { text: [`${w.week}. hafta`, { text: [w.date ? `  ${w.date}` : '', w.bye ? `  ·  BAY: ${w.bye}` : ''].join(''), color: C.muted, bold: false, fontSize: 8 }], style: 'week' },
        body.length ? {
          table: { widths: ['*', 46, '*'], body },
          layout: { hLineWidth: (i, node) => (i > 0 && i < node.table.body.length && i % 3 === 0 ? 0.4 : 0), vLineWidth: () => 0, hLineColor: () => C.line, paddingTop: () => 1.5, paddingBottom: () => 1.5 },
          fontSize: 9,
        } : { text: 'Maç yok', style: 'note' },
      ],
      margin: [0, 0, 0, 8],
    });
  }

  // squads
  content.push({ text: 'Kadrolar ve oyuncu istatistikleri', style: 'h2', pageBreak: 'before' });
  content.push({ text: 'Oyuncular draft sırasına göre. Seç. = draftta kaçıncı seçim olduğu.', style: 'note', margin: [0, 0, 0, 6] });
  const squadTables = data.teams.map((t) => ({
    unbreakable: true,
    stack: [
      { columns: [{ width: 8, canvas: [{ type: 'rect', x: 0, y: 3, w: 6, h: 6, color: t.color }] }, { text: `${t.rank}. ${t.team}${t.manager ? `  ·  ${t.manager}` : ''}`, bold: true, fontSize: 10, color: C.ink }], margin: [0, 0, 0, 3] },
      { table: { headerRows: 1, widths: [22, '*', 28, 22, 18, 18, 28], body: [
        [th('Seç.'), th('Oyuncu', 'left'), th('Mevki'), th('Maç'), th('G'), th('A'), th('Ort.')],
        ...t.players.map((p) => [td(p.pick || '—'), td(p.player, { alignment: 'left' }), td(p.pos), td(p.apps), td(p.goals), td(p.assists), td(p.rating)]),
      ] }, layout: zebra, fontSize: 7.5 },
    ],
    margin: [0, 0, 0, 10],
  }));
  for (let i = 0; i < squadTables.length; i += 2) content.push({ columns: [squadTables[i], squadTables[i + 1] || { text: '' }], columnGap: 14 });

  return {
    pageSize: 'A4',
    pageMargins: [32, 36, 32, 40],
    info: { title, author: 'Draft Arena', subject: 'Sezon raporu' },
    defaultStyle: { font: 'Roboto', fontSize: 9, color: C.ink, lineHeight: 1.15 },
    styles: {
      kicker: { fontSize: 8, bold: true, color: C.muted, characterSpacing: 1.5 },
      title: { fontSize: 20, bold: true, margin: [0, 2, 0, 2] },
      sub: { fontSize: 9, color: C.muted, margin: [0, 0, 0, 10] },
      h2: { fontSize: 13, bold: true, margin: [0, 4, 0, 6] },
      h3: { fontSize: 10.5, bold: true, margin: [0, 2, 0, 4] },
      th: { bold: true, color: '#ffffff', fontSize: 8 },
      week: { fontSize: 10, bold: true, margin: [0, 0, 0, 2] },
      note: { fontSize: 7.5, color: C.muted, italics: true },
    },
    footer: (page, pages) => ({
      columns: [{ text: `${title} · ${data.generatedAt} tarihinde oluşturuldu`, alignment: 'left' }, { text: `${page} / ${pages}`, alignment: 'right' }],
      margin: [32, 12, 32, 0], fontSize: 7, color: C.muted,
    }),
    content,
  };
}


export function reportFileName(data) {
  const map = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', İ: 'i', Ö: 'o', Ş: 's', Ü: 'u' };
  const slug = String(data.league).replace(/[çğıöşüÇĞİÖŞÜ]/g, (c) => map[c]).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'draft-arena';
  return `${slug}-sezon-${data.seasonNo}.pdf`;
}
