// Landing: create a room, join with code + password, recover a seat.
import { h, toast, openSheet, closeSheet } from '../dom.js';
import { SQUAD_SIZES, DEFAULT_SQUAD, MAX_MANAGERS } from '../../core/positions.js';
import { requestNotifications, unlockAudio } from '../notify.js';
import { LEG_OPTIONS, LEG_LABEL, DEFAULT_LEGS } from '../../core/schedule.js';
import { DATA_META } from '../../../data/players.js';

export function renderLanding(ctx) {
  const { app } = ctx;
  const ui = app.ui.landing || (app.ui.landing = { tab: app.params.code ? 'join' : 'join', code: app.params.code || '', password: '', name: '', team: '', roomName: 'Arkadaş Ligi', squadSize: DEFAULT_SQUAD, pickSeconds: 0, legs: DEFAULT_LEGS });
  if (app.params.code && !ui.code) ui.code = app.params.code;
  const field = (label, key, attrs = {}) => h('label', { class: 'field' }, h('span', null, label),
    h('input', { class: 'input', value: ui[key], 'data-k': `landing-${key}`, oninput: (e) => { ui[key] = e.target.value; }, ...attrs }));
  const demo = app.mode === 'demo';

  const join = h('div', { class: 'card' },
    h('h2', null, 'Odaya katıl'),
    field('Oda kodu', 'code', { placeholder: 'ÖRN. K7M2QX', autocapitalize: 'characters', maxlength: 6, style: { textTransform: 'uppercase', letterSpacing: '.15em' } }),
    field('Oda şifresi', 'password', { type: 'password', autocomplete: 'off' }),
    field('Adın', 'name', { maxlength: 24, placeholder: 'Kaan' }),
    field('Takım adın', 'team', { maxlength: 28, placeholder: 'Kaan United' }),
    h('button', { class: 'btn block primary', onclick: () => ctx.run(async () => {
      unlockAudio();
      const { code } = await app.api.joinRoom({ code: ui.code, password: ui.password, name: ui.name.trim(), team: ui.team.trim() });
      requestNotifications();
      ctx.enterRoom(code);
    }) }, 'Katıl'),
    h('button', { class: 'btn block ghost mt', onclick: () => openRecover(ctx, ui) }, 'Telefon değiştirdim / koltuğumu geri al'));

  const create = h('div', { class: 'card' },
    h('h2', null, 'Oda kur (admin)'),
    field('Lig / oda adı', 'roomName', { maxlength: 40 }),
    field('Oda şifresi (arkadaşlarına vereceksin)', 'password', { type: 'text', autocomplete: 'off', placeholder: 'en az 4 karakter' }),
    field('Adın', 'name', { maxlength: 24 }),
    field('Takım adın', 'team', { maxlength: 28 }),
    h('div', { class: 'grid2' },
      h('label', { class: 'field' }, h('span', null, 'Kadro büyüklüğü'),
        h('select', { class: 'input', onchange: (e) => { ui.squadSize = Number(e.target.value); } }, SQUAD_SIZES.map((n) => h('option', { value: n, selected: ui.squadSize === n }, `${n} oyuncu`)))),
      h('label', { class: 'field' }, h('span', null, 'Seçim süresi'),
        h('select', { class: 'input', onchange: (e) => { ui.pickSeconds = Number(e.target.value); } },
          [[0, 'Süresiz'], [30, '30 saniye'], [60, '1 dakika'], [120, '2 dakika'], [300, '5 dakika'], [900, '15 dakika'], [3600, '1 saat']].map(([v, l]) => h('option', { value: v, selected: ui.pickSeconds === v }, l))))),
    h('label', { class: 'field' }, h('span', null, 'Lig formatı (her takım diğerleriyle kaç maç yapsın?)'),
      h('select', { class: 'input', onchange: (e) => { ui.legs = Number(e.target.value); } }, LEG_OPTIONS.map((n) => h('option', { value: n, selected: (ui.legs || DEFAULT_LEGS) === n }, LEG_LABEL[n])))),
    h('p', { class: 'mini' }, `2–${MAX_MANAGERS} menajer katılabilir. Draft sırası kura ile belirlenir ve yılan usulü döner; çift sayılı kadroda herkesin seçim numaraları toplamı eşittir.`),
    h('button', { class: 'btn block primary', onclick: () => ctx.run(async () => {
      unlockAudio();
      const { code, adminCode } = await app.api.createRoom({ roomName: ui.roomName, password: ui.password, name: ui.name.trim(), team: ui.team.trim(), squadSize: ui.squadSize, pickSeconds: ui.pickSeconds, legs: ui.legs || DEFAULT_LEGS });
      try { localStorage.setItem(`daOnline.adminCode.${code}`, adminCode); } catch { /* ignore */ }
      requestNotifications();
      ctx.enterRoom(code);
      showAdminCode(code, adminCode);
    }) }, 'Odayı kur'));

  if (ui.claimCode) {
    // wait for the admin to approve the seat claim
    const timer = setInterval(async () => {
      const seat = await app.db.get(`rooms/${ui.claimCode}/uids/${app.uid}`).catch(() => null);
      if (seat) { const c = ui.claimCode; ui.claimCode = null; ctx.enterRoom(c); }
    }, 4000);
    app.cleanup = () => clearInterval(timer);
  }
  return h('div', null,
    ui.claimCode ? h('div', { class: 'banner turn' }, `${ui.claimCode} odası için koltuk talebin gönderildi. Admin onayı bekleniyor…`) : null,
    h('div', { class: 'hero' },
      h('img', { class: 'logo', src: 'icon.svg', alt: '' }),
      h('h1', null, 'Draft Arena Online'),
      h('p', null, 'Arkadaşlarınla oda kur, herkes kendi telefonundan draft yapsın, lig oynansın.')),
    demo ? h('div', { class: 'banner warn' }, h('b', null, 'Demo modu. '), 'Firebase henüz ayarlanmadı; odalar sadece bu tarayıcıda çalışır. Denemek için aynı bağlantıyı yeni sekmelerde açıp farklı oyuncu olarak katılabilirsin.',
      h('div', { class: 'mt' }, h('button', { class: 'btn sm', onclick: () => { app.db.resetDemo(); try { localStorage.removeItem('daOnline.room'); } catch { /* ignore */ } toast('Demo verisi silindi.', 'ok'); } }, 'Demo verisini sıfırla'))) : null,
    app.params.notMember ? h('div', { class: 'banner warn' }, `${app.params.code} odasında kayıtlı değilsin. Şifreyle katıl veya koltuğunu geri iste.`) : null,
    h('div', { class: 'chips mb' },
      h('button', { class: `chip ${ui.tab === 'join' ? 'on' : ''}`, onclick: () => { ui.tab = 'join'; ctx.render(); } }, 'Katıl'),
      h('button', { class: `chip ${ui.tab === 'create' ? 'on' : ''}`, onclick: () => { ui.tab = 'create'; ctx.render(); } }, 'Oda kur')),
    ui.tab === 'create' ? create : join,
    h('p', { class: 'mini center' }, `Oyuncu verisi: ${DATA_META ? DATA_META.ea : ''}`));
}

function showAdminCode(code, adminCode) {
  openSheet('Admin kurtarma kodu', h('div', null,
    h('p', null, 'Bu kodu bir yere not et. Telefonun değişirse veya tarayıcı verisi silinirse adminliği bu kodla geri alırsın.'),
    h('div', { class: 'code-big' }, adminCode),
    h('p', { class: 'mini center' }, `Oda: ${code}`),
    h('button', { class: 'btn block primary mt', onclick: () => closeSheet() }, 'Not ettim')));
}

function openRecover(ctx, ui) {
  const { app } = ctx;
  const note = h('input', { class: 'input', placeholder: 'Takım adın (admin tanısın diye)', value: ui.team });
  const adminCode = h('input', { class: 'input', placeholder: 'Admin kurtarma kodu', style: { textTransform: 'uppercase' } });
  openSheet('Koltuğunu geri al', h('div', null,
    h('p', { class: 'small muted' }, 'Draft başladıktan sonra yeni kişi katılamaz. Daha önce katıldıysan ve telefon/tarayıcı değiştiyse koltuk talebi gönder; admin onaylayınca takımın bu cihaza geçer.'),
    h('label', { class: 'field' }, h('span', null, 'Oda kodu'), h('input', { class: 'input', value: ui.code, oninput: (e) => { ui.code = e.target.value; } })),
    h('label', { class: 'field' }, h('span', null, 'Oda şifresi'), h('input', { class: 'input', type: 'password', value: ui.password, oninput: (e) => { ui.password = e.target.value; } })),
    h('label', { class: 'field' }, h('span', null, 'Not'), note),
    h('button', { class: 'btn block primary', onclick: () => ctx.run(async () => {
      await app.api.claimSeat(ui.code, ui.password, note.value);
      closeSheet();
      ui.claimCode = ui.code.trim().toUpperCase();
      toast('Talep gönderildi. Admin onaylayınca odaya otomatik girersin.', 'ok');
      ctx.render();
    }) }, 'Talep gönder'),
    h('div', { class: 'hr' }),
    h('p', { class: 'small muted' }, 'Admin misin? Kurtarma kodunla adminliği bu cihaza al:'),
    adminCode,
    h('button', { class: 'btn block mt', onclick: () => ctx.run(async () => {
      await app.api.reclaimAdmin(ui.code.trim().toUpperCase(), adminCode.value.trim().toUpperCase());
      closeSheet();
      ctx.enterRoom(ui.code.trim().toUpperCase());
    }, 'Adminlik bu cihaza geçti.') }, 'Adminliği geri al')));
}
