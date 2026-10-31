// Lobby: room code + invite, members (online status), admin settings, start draft.
import { h, toast, confirmSheet, openSheet, closeSheet } from '../dom.js';
import { SQUAD_SIZES, MIN_MANAGERS, MAX_MANAGERS, ROLE_MIN, ROLES, ROLE_SHORT } from '../../core/positions.js';
import { poolCheck } from '../../backend/api.js';
import { topbar } from '../components.js';
import { LEG_OPTIONS, LEG_LABEL, legsOf, weeksFor } from '../../core/schedule.js';
import { requestNotifications, notificationState, unlockAudio, chime, swRegistration } from '../notify.js';

export function inviteLink(code) {
  const u = new URL(location.href);
  u.search = `?oda=${code}`;
  u.hash = '';
  return u.toString();
}

export function notifyCard(ctx) {
  const state = notificationState();
  return h('div', { class: 'card' },
    h('h3', null, 'Bildirim ve ses'),
    h('p', { class: 'small muted' }, 'Seçim sırası sana gelince telefon çalar ve titrer (Android). Uygulama arka plandayken bildirim için izin ver. iPhone\'da arka plan bildirimi için Safari\'de Paylaş → "Ana Ekrana Ekle" ile uygulamayı ana ekrana ekle (iOS 16.4+).'),
    h('div', { class: 'btns' },
      h('button', { class: 'btn sm', onclick: () => { unlockAudio(); chime('turn'); } }, '🔔 Sesi dene'),
      state === 'granted' ? h('span', { class: 'tag ok' }, 'Bildirim izni var')
        : state === 'unsupported' ? h('span', { class: 'tag warn' }, 'Bu tarayıcı bildirim desteklemiyor')
          : h('button', { class: 'btn sm primary', onclick: async () => { const r = await requestNotifications(); toast(r === 'granted' ? 'Bildirimler açık.' : 'İzin verilmedi.', r === 'granted' ? 'ok' : 'err'); if (r === 'granted') enablePush(ctx); ctx.render(); } }, 'Bildirimlere izin ver')));
}

export function enablePush(ctx) {
  const db = ctx.app.db;
  if (db && db.enablePush) db.enablePush(`pushTokens/${ctx.app.uid}`, swRegistration()).catch(() => {});
}

export function claimsCard(ctx) {
  const { app } = ctx;
  const room = app.room;
  const claims = room.claims ? Object.values(room.claims) : [];
  if (!ctx.admin || !claims.length) return null;
  return h('div', { class: 'card', style: { borderColor: 'var(--warn)' } },
    h('h3', null, 'Koltuk talepleri'),
    claims.map((c) => h('div', { class: 'row mb' },
      h('div', { class: 'grow small' }, h('b', null, c.note || 'Talep'), h('div', { class: 'mini' }, c.uid)),
      h('button', { class: 'btn sm primary', onclick: () => {
        openSheet('Hangi takıma bağlansın?', h('div', { class: 'list' }, Object.entries(room.members).map(([seat, m]) => h('button', { class: 'item', onclick: () => ctx.run(async () => { await app.api.approveClaim(app.code, room, seat, c.uid); closeSheet(); }, `${m.team} yeni cihaza bağlandı.`) },
          h('span', { class: 'dot', style: { background: m.color } }), h('div', { class: 'grow' }, m.team, h('div', { class: 'mini' }, m.name))))));
      } }, 'Onayla'),
      h('button', { class: 'btn sm danger', onclick: () => ctx.run(() => app.api.rejectClaim(app.code, c.uid)) }, 'Reddet'))));
}

export function renderLobby(ctx) {
  const { app } = ctx;
  const room = app.room;
  const pub = room.public;
  const seat = ctx.seat;
  const admin = ctx.admin;
  const members = Object.entries(room.members || {}).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
  const presence = room.presence || {};
  const me = room.members[seat];
  const n = members.length;
  const problems = poolCheck(app.api.pool, Math.max(n, 2), pub.squadSize);
  const link = inviteLink(app.code);
  const adminCode = (() => { try { return localStorage.getItem(`daOnline.adminCode.${app.code}`); } catch { return null; } })();

  return h('div', null,
    topbar(pub.name, 'Lobi · oyuncular bekleniyor', { right: h('button', { class: 'iconbtn', 'aria-label': 'Çık', onclick: async () => { if (await confirmSheet('Odadan çık', 'Bu cihazda odadan çıkış yapılır (takımın silinmez). Tekrar girmek için kodu ve şifreyi kullanırsın.', 'Çık')) ctx.leaveRoom(); } }, '⎋') }),
    app.mode === 'demo' ? h('div', { class: 'banner warn' }, 'Demo modu: diğer oyuncuları denemek için bu sayfayı yeni sekmelerde aç.') : null,
    h('div', { class: 'card center' },
      h('div', { class: 'mini' }, 'ODA KODU'),
      h('div', { class: 'code-big' }, app.code),
      h('p', { class: 'small muted' }, 'Arkadaşların kodu ve şifreyi girerek katılır.'),
      h('div', { class: 'btns' },
        h('button', { class: 'btn sm', onclick: async () => {
          const text = `Draft Arena odama katıl! Kod: ${app.code}\n${link}`;
          if (navigator.share) { try { await navigator.share({ title: 'Draft Arena', text, url: link }); return; } catch { /* cancelled */ } }
          try { await navigator.clipboard.writeText(text); toast('Davet kopyalandı.', 'ok'); } catch { toast(link); }
        } }, '📨 Davet et'),
        h('button', { class: 'btn sm', onclick: async () => { try { await navigator.clipboard.writeText(app.code); toast('Kod kopyalandı.', 'ok'); } catch { toast(app.code); } } }, 'Kodu kopyala'))),
    claimsCard(ctx),
    h('div', { class: 'card' },
      h('h3', null, `Menajerler (${n}/${MAX_MANAGERS})`),
      h('div', { class: 'list' }, members.map(([s, m]) => h('div', { class: 'item' },
        h('span', { class: `online-dot ${presence[m.uid] ? 'on' : ''}`, title: presence[m.uid] ? 'çevrimiçi' : 'çevrimdışı' }),
        h('span', { class: 'dot', style: { background: m.color } }),
        h('div', { class: 'grow' }, h('div', { class: 'name ellipsis' }, m.team, s === seat ? ' (sen)' : ''), h('div', { class: 'meta' }, m.name, s === pub.adminSeat ? ' · 👑 admin' : '')),
        admin && s !== seat ? h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmSheet('Çıkar', `${m.team} odadan çıkarılsın mı?`, 'Çıkar', true)) ctx.run(() => app.api.kick(app.code, room, s)); } }, 'Çıkar') : null))),
      me ? h('button', { class: 'btn sm mt', onclick: () => editProfile(ctx, seat, me) }, 'Adımı / takım adımı değiştir') : null),
    notifyCard(ctx),
    h('div', { class: 'card' },
      h('h3', null, 'Kurallar'),
      h('div', { class: 'small' },
        h('div', null, `Kadro: ${pub.squadSize} oyuncu. En az: ${ROLES.filter((r) => ROLE_MIN[r]).map((r) => `${ROLE_MIN[r]} ${ROLE_SHORT[r]}`).join(', ')} (en fazla 3 kaleci). Kalanlar serbest.`),
        h('div', null, `Seçim süresi: ${pub.pickSeconds ? `${pub.pickSeconds < 60 ? `${pub.pickSeconds} saniye` : `${Math.round(pub.pickSeconds / 60)} dakika`} (süre dolarsa admin cihazı en iyi uygun oyuncuyu otomatik seçer)` : 'süresiz'}`),
        h('div', null, 'Draft sırası kurayla belirlenir, her tur tersine döner (yılan draft).'),
        h('div', null, `Lig: ${LEG_LABEL[legsOf(pub.legs)].toLowerCase()}${n >= 2 ? `, ${n} takımla ${weeksFor(n, pub.legs)} hafta` : ''}; tek sayıda takım varsa her hafta bir takım BAY geçer. Lig, herkes kadrosunu tamamlayıp "hazırım" deyince başlar.`),
        h('div', null, 'Sezon sonu: gol kralının takımına +2, asist kralının takımına +1 puan.'))),
    admin ? h('div', { class: 'card' },
      h('h3', null, 'Admin ayarları'),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', null, 'Kadro büyüklüğü'),
          h('select', { class: 'input', onchange: (e) => ctx.run(() => app.api.updateSettings(app.code, { squadSize: Number(e.target.value) })) }, SQUAD_SIZES.map((v) => h('option', { value: v, selected: pub.squadSize === v }, `${v} oyuncu`)))),
        h('label', { class: 'field' }, h('span', null, 'Seçim süresi'),
          h('select', { class: 'input', onchange: (e) => ctx.run(() => app.api.updateSettings(app.code, { pickSeconds: Number(e.target.value) })) },
            [[0, 'Süresiz'], [30, '30 sn'], [60, '1 dk'], [120, '2 dk'], [300, '5 dk'], [900, '15 dk'], [3600, '1 saat']].map(([v, l]) => h('option', { value: v, selected: (pub.pickSeconds || 0) === v }, l))))),
      legsField(ctx, n),
      adminCode ? h('p', { class: 'mini' }, 'Admin kurtarma kodun: ', h('b', null, adminCode)) : null,
      problems.length && n >= MIN_MANAGERS ? h('div', { class: 'banner warn' }, problems.join(' · ')) : null,
      h('button', { class: 'btn block primary', disabled: n < MIN_MANAGERS || n > MAX_MANAGERS, onclick: async () => {
        if (!(await confirmSheet('Draftı başlat', `${n} menajerle draft başlasın mı? Başladıktan sonra yeni kişi katılamaz. Sıra kurayla belirlenecek.`, 'Başlat'))) return;
        ctx.run(() => app.api.startDraft(app.code, room));
      } }, n < MIN_MANAGERS ? `En az ${MIN_MANAGERS} menajer gerekli` : `Draftı başlat (${n} menajer)`)) : h('div', { class: 'card small muted center' }, 'Admin draftı başlatınca ekran otomatik değişecek.'));
}

function editProfile(ctx, seat, me) {
  const name = h('input', { class: 'input', value: me.name, maxlength: 24 });
  const team = h('input', { class: 'input', value: me.team, maxlength: 28 });
  openSheet('Profil', h('div', null,
    h('label', { class: 'field' }, h('span', null, 'Adın'), name),
    h('label', { class: 'field' }, h('span', null, 'Takım adın'), team),
    h('button', { class: 'btn block primary', onclick: () => ctx.run(async () => { await ctx.app.api.updateProfile(ctx.app.code, seat, { name: name.value.trim(), team: team.value.trim() }); closeSheet(); }, 'Kaydedildi.') }, 'Kaydet')));
}

// League format picker (how many times every pair meets). Used in the lobby and before a new season.
export function legsField(ctx, n) {
  const { app } = ctx;
  const pub = app.room.public;
  return h('label', { class: 'field' }, h('span', null, 'Lig formatı (her takım diğerleriyle kaç maç yapsın?)'),
    h('select', { class: 'input', onchange: (e) => ctx.run(() => app.api.updateSettings(app.code, { legs: Number(e.target.value) })) },
      LEG_OPTIONS.map((v) => h('option', { value: v, selected: legsOf(pub.legs) === v }, `${LEG_LABEL[v]}${n >= 2 ? ` · ${weeksFor(n, v)} hafta` : ''}`))));
}
