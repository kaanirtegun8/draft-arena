// Home, new league setup, save slots, how-to-play.
import { h, openSheet, closeSheet, toast, confirmSheet, downloadText } from '../dom.js';
import { createLeague } from '../../core/league.js';
import { SLOTS, slotInfo, saveToSlot, loadFromSlot, deleteSlot, serialize, deserialize } from '../../core/save.js';
import { newSeed } from '../../core/rng.js';
import { PLAYER_DATA_META } from '../../data/players.js';
import { POSITION_QUOTAS, MAX_SUBS } from '../../core/config.js';
import { topbar } from '../components.js';

const PHASE_TR = { draft: 'Draft', season: 'Sezon', finished: 'Sezon bitti' };

export function renderHome(ctx) {
  const { app } = ctx;
  const l = app.league;
  return h('div', null,
    h('div', { class: 'hero' },
      h('img', { class: 'logo', src: 'icon.svg', alt: '' }),
      h('h1', null, 'Draft Arena'),
      h('p', null, '5 menajer · 90 futbolcu · 20 maçlık çift devreli lig')),
    l ? h('div', { class: 'card' },
      h('h3', null, 'Devam eden lig'),
      h('div', { class: 'row between' },
        h('div', null, h('div', { class: 'name' }, l.name),
          h('div', { class: 'muted small' }, `${PHASE_TR[l.phase]} · ${l.phase === 'draft' ? `Seçim ${l.draft.picks.length}/90` : l.phase === 'season' ? `Hafta ${l.currentWeek}/10` : 'Tamamlandı'}`)),
        h('button', { class: 'btn primary', onclick: () => ctx.go(ctx.homeView()) }, 'Devam Et'))) : null,
    h('div', { class: 'stack' },
      h('button', { class: 'btn block primary', onclick: async () => {
        if (l && l.phase !== 'finished' && !(await confirmSheet('Yeni lig', 'Devam eden lig otomatik kayıttan silinecek. Saklamak istiyorsan önce bir kayıt yuvasına kaydet.', 'Yeni lig kur', true))) return;
        ctx.go('setup');
      } }, '＋ Yeni Lig Kur'),
      h('a', { class: 'btn block', href: 'online/', style: { textDecoration: 'none', color: 'inherit' } }, '🌐 Online oyna (arkadaşlarla, herkes kendi telefonundan)'),
      h('button', { class: 'btn block', onclick: () => openSaves(ctx) }, '💾 Kayıtlar / İçe-Dışa Aktar'),
      h('button', { class: 'btn block', onclick: () => openHowTo() }, '❓ Nasıl Oynanır'),
      h('button', { class: 'btn block ghost', onclick: () => ctx.go('data', { from: 'home' }) }, '📊 Oyuncu Verisi ve Form')),
    h('p', { class: 'muted small center mt' }, `Veri: ${PLAYER_DATA_META.version}`));
}

export function renderSetup(ctx) {
  const ui = ctx.app.ui.setup || (ctx.app.ui.setup = {
    name: 'Draft Arena Ligi', seed: '',
    managers: [
      { name: 'Sen', isHuman: true }, { name: 'Aslan FC', isHuman: false }, { name: 'Kartal SK', isHuman: false },
      { name: 'Kanarya United', isHuman: false }, { name: 'Fırtına Spor', isHuman: false },
    ],
  });
  const rows = ui.managers.map((m, i) => h('div', { class: 'row mb' },
    h('span', { class: 'muted', style: { width: '18px' } }, i + 1),
    h('input', { class: 'input grow', value: m.name, maxlength: 24, oninput: (e) => { m.name = e.target.value; } }),
    h('div', { class: 'seg' },
      h('button', { class: m.isHuman ? 'on' : '', onclick: () => { m.isHuman = true; ctx.render(); } }, '👤 İnsan'),
      h('button', { class: !m.isHuman ? 'on' : '', onclick: () => { m.isHuman = false; ctx.render(); } }, '🤖 CPU'))));
  return h('div', null,
    topbar(ctx, 'Yeni Lig', 'Menajerleri ayarla', { back: () => ctx.go('home') }),
    h('div', { class: 'card' },
      h('label', { class: 'field' }, h('span', null, 'Lig adı'), h('input', { class: 'input', value: ui.name, maxlength: 40, oninput: (e) => { ui.name = e.target.value; } })),
      h('label', { class: 'field' }, h('span', null, 'Seed (boş bırakılırsa rastgele) — aynı seed aynı draft sırasını ve maçları üretir'),
        h('div', { class: 'row' },
          h('input', { class: 'input grow', value: ui.seed, placeholder: 'örn. derbi2026', oninput: (e) => { ui.seed = e.target.value; } }),
          h('button', { class: 'btn sm', onclick: () => { ui.seed = newSeed(); ctx.render(); } }, '🎲')))),
    h('div', { class: 'card' },
      h('h3', null, '5 Menajer'),
      rows,
      h('div', { class: 'chips mt' },
        h('button', { class: 'chip', onclick: () => { ui.managers.forEach((m, i) => { m.isHuman = i === 0; }); ctx.render(); } }, '1 insan + 4 CPU'),
        h('button', { class: 'chip', onclick: () => { ui.managers.forEach((m, i) => { m.isHuman = i < 2; }); ctx.render(); } }, '2 insan'),
        h('button', { class: 'chip', onclick: () => { ui.managers.forEach((m) => { m.isHuman = true; }); ctx.render(); } }, '5 insan (aynı cihaz)'),
        h('button', { class: 'chip', onclick: () => { ui.managers.forEach((m) => { m.isHuman = false; }); ctx.render(); } }, 'Hepsi CPU (izle)'))),
    h('div', { class: 'card small muted' },
      h('div', null, `Kadro: 18 oyuncu (${POSITION_QUOTAS.GK} KL, ${POSITION_QUOTAS.DEF} DEF, ${POSITION_QUOTAS.MID} OS, ${POSITION_QUOTAS.FWD} FV). Yılan (snake) draft: her tur sıra tersine döner.`),
      h('div', null, 'Lig: 10 hafta, her hafta 2 maç ve 1 takım BAY. Her takım 8 maç (4 iç saha, 4 deplasman) oynar.')),
    h('button', { class: 'btn block primary', onclick: () => {
      try {
        const league = createLeague({ name: ui.name, seed: ui.seed, managers: ui.managers });
        ctx.setLeague(league);
        ctx.go('draft');
      } catch (e) { toast(e.message, 'err'); }
    } }, 'Draft\'a Başla →'));
}

export function openSaves(ctx) {
  const { app } = ctx;
  const body = h('div', null);
  const refresh = () => {
    body.innerHTML = '';
    const list = h('div', { class: 'list mb' });
    for (const slot of SLOTS) {
      const info = slotInfo(app.storage, slot);
      list.appendChild(h('div', { class: 'item' },
        h('div', { class: 'grow' },
          h('div', { class: 'name' }, slot === 'auto' ? 'Otomatik kayıt' : `Yuva ${slot}`),
          h('div', { class: 'meta' }, info ? (info.broken ? 'Bozuk kayıt' : `${info.name} · ${PHASE_TR[info.phase] || info.phase} · ${info.phase === 'draft' ? `seçim ${info.picks}` : `hafta ${info.week}`} · ${new Date(info.savedAt).toLocaleString('tr-TR')}`) : 'Boş')),
        h('div', { class: 'btns' },
          slot !== 'auto' && app.league ? h('button', { class: 'btn sm', onclick: () => { saveToSlot(app.storage, slot, app.league); toast(`Yuva ${slot}'e kaydedildi.`, 'ok'); refresh(); } }, 'Kaydet') : null,
          info && !info.broken ? h('button', { class: 'btn sm primary', onclick: () => {
            try { const s = loadFromSlot(app.storage, slot); ctx.setLeague(s); toast('Kayıt yüklendi.', 'ok'); ctx.go(ctx.homeView()); } catch (e) { toast(e.message, 'err'); }
          } }, 'Yükle') : null,
          info && slot !== 'auto' ? h('button', { class: 'btn sm danger', onclick: () => { deleteSlot(app.storage, slot); refresh(); } }, 'Sil') : null)));
    }
    const fileInput = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' }, onchange: (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => importText(ctx, String(r.result));
      r.readAsText(f);
    } });
    const paste = h('textarea', { class: 'input', placeholder: 'Kayıt JSON metnini buraya yapıştır' });
    body.append(list,
      h('div', { class: 'card' },
        h('h3', null, 'Dışa / İçe Aktar'),
        h('div', { class: 'btns mb' },
          app.league ? h('button', { class: 'btn sm', onclick: () => downloadText(`draft-arena-${app.league.seed}.json`, serialize(app.league)) }, '⬇︎ Dosya indir') : null,
          app.league ? h('button', { class: 'btn sm', onclick: async () => {
            try { await navigator.clipboard.writeText(serialize(app.league)); toast('Kayıt panoya kopyalandı.', 'ok'); } catch { toast('Panoya kopyalanamadı; dosya indirmeyi kullan.', 'err'); }
          } }, '📋 Kopyala') : null,
          h('button', { class: 'btn sm', onclick: () => fileInput.click() }, '⬆︎ Dosyadan yükle')),
        fileInput, paste,
        h('button', { class: 'btn sm mt', onclick: () => importText(ctx, paste.value) }, 'Yapıştırılanı yükle')),
      app.storage.memoryOnly ? h('p', { class: 'tag warn' }, 'Tarayıcı depolaması kapalı; kayıtlar sayfa kapanınca kaybolur.') : null);
  };
  refresh();
  openSheet('Kayıtlar', body);
}

function importText(ctx, text) {
  try {
    const s = deserialize(text);
    ctx.setLeague(s);
    closeSheet();
    toast('Kayıt içe aktarıldı.', 'ok');
    ctx.go(ctx.homeView());
  } catch (e) { toast(e.message, 'err'); }
}

export function openHowTo() {
  openSheet('Nasıl Oynanır', h('div', { class: 'stack small' },
    h('p', null, h('b', null, '1. Draft: '), '5 menajer yılan usulü sırayla 18\'er futbolcu seçer. Pozisyon kontenjanları dolunca o pozisyondan seçim yapılamaz. CPU menajerler kendi seçer.'),
    h('p', null, h('b', null, '2. Taktik: '), 'Takımlar ekranından diziliş, oyun stili, ilk 11 ve otomatik oyuncu değişikliği kurallarını belirle. Kondisyonu düşük oyuncuları dinlendir.'),
    h('p', null, h('b', null, '3. Maç: '), `Maç 90 dakika boyunca dakika dakika simüle edilir. Skor önceden belirlenmez; pozisyonlar, şutlar ve kurtarışlardan oluşur. En fazla ${MAX_SUBS} değişiklik yapılır. Maç başladığında sonuç kesinleşir; izlerken hızlandırabilir veya anında bitirebilirsin.`),
    h('p', null, h('b', null, 'Performans: '), '%30 EA FC özellikleri, %30 gerçek hayat formu (veri yoksa nötr), %15 taktik/diziliş uyumu, %10 rakip güçlü/zayıf yönleri, %10 kondisyon, %5 kontrollü rastgelelik.'),
    h('p', null, h('b', null, 'Kondisyon: '), 'Oynanan dakikaya göre düşer. Oynamayan oyuncular daha çok dinlenir, BAY haftasında tüm takım toparlanır.'),
    h('p', null, h('b', null, 'Sezon sonu: '), 'Gol kralının takımı +2, asist kralının takımı +1 puan alır (sadece sezon tamamlanınca). Ödüller ve şampiyonluk ekranı açılır.')));
}
