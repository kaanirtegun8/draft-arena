# Draft Arena Online

Arkadaşlarla oynanan, herkesin kendi telefonundan girdiği draft + lig oyunu.

- **Oda sistemi:** Admin oda kurar, şifre belirler. 2–10 kişi kod + şifreyle katılır. Şifresiz kimse odaya giremez; bu kural sunucu tarafında (Firebase güvenlik kuralları) uygulanır.
- **Adil draft:** Sıra kurayla belirlenir, yılan usulü döner. Kadro çift sayıda (16/18/20) olduğu için herkesin seçim numaraları toplamı eşittir. Sadece sırası gelen seçebilir; aynı oyuncu iki kez alınamaz (sunucu kuralı). İsteğe bağlı seçim süresi var; süre dolarsa admin cihazı otomatik seçer.
- **Bildirim:** Sıra sana gelince ses çalar, Android'de telefon titrer, sekme başlığı yanıp söner. Bildirim izni verilmişse sistem bildirimi de gelir. Uygulama tamamen kapalıyken bildirim için isteğe bağlı Cloud Function var (aşağıya bak).
- **Detaylı mevkiler:** KL, STP, SĞB, SLB, DOS, MO, OOS, SLK, SĞK, FV filtreleri ve minimum kontenjanlar var: 2 KL, 3 STP, 1 SĞB, 1 SLB, 1 DOS, 2 MO, 1 SLK, 1 SĞK, 2 FV; kalanı serbest, en fazla 3 kaleci.
- **Lig:** Herkes kadrosunu kurup "hazırım" demeden lig başlamaz (sunucu da draft bitmeden sezon yazılmasına izin vermez). Lig çift devreli; tek sayıda takım varsa her hafta biri BAY geçer. Haftayı admin oynatır; herkes sonuçları, golleri, asistleri ve kartları görür.
- **Kart cezası:** 3 sarı = 1 maç, ikinci sarıdan kırmızı = 1 maç, direkt kırmızı = 2 maç. Cezalı ve sakat oyuncular oynayamaz; ilk 11'de kalırlarsa otomatik değiştirilir ve bunun notu düşülür.
- **Form grafiği:** Oyuncunun gerçek hayattaki son maç puanları ve ligdeki maç puanları grafikle gösterilir. Takımların puan grafiği de var.
- **Sezon sonu:** Gol kralının takımına +2, asist kralının takımına +1 puan eklenir. Ayrıca en iyi kaleci, sezonun oyuncusu, sezonun karması (4-3-3, gerçek mevkilerle), draftın en iyi seçimi ve şampiyonluk ekranı var.

## Botlar

Lobide admin **🤖 Bot ekle** ile odaya bot menajer ekler (tek başına da botlara karşı oynanabilir). Bot normal bir menajer gibi oda sınırına (10) sayılır; seviyesi lobide **Ayarla** ile değiştirilir veya bot odadan çıkarılır.

- **Zor (🧠, varsayılan):** Draftta en iyi adaylar için draftı ileriye doğru oynar (rakipler mantıklı bir menajer gibi seçer) ve sonraki iki sırasından sonra en güçlü kadroyu bırakan seçimi yapar; kıt mevkileri ve kelepirleri kaçırmaz. Kadroyu ilk 11 + her mevki için yedek + takım kimyası + kaptan etkisiyle değerlendirir (yaşlı oyuncuların daha çok dinlenmesi hesapta). Bütçeli modda kalan paranın neye yeteceğini hesaplar, kadroyu tamamlayacak parayı hep ayırır. Gizli seçimde rakiplerin büyük ihtimalle seçeceği oyunculardan, değmedikçe kaçınır; açık artırmada oyuncuya, aynı mevkideki en iyi alternatifin üzerinde değeri kadar teklif verir. Her hafta rakibin kadrosunu ve taktiğini okur; maç motorunun bir modeli üzerinde diziliş, mevki varyantı, rol ve talimatları arayıp beklenen puanı en yüksek kurguyu seçer, yorgun ve sakat oyuncuları dinlendirir. Rakip taktiğini değiştirirse bot da yeniden hesaplar (hafta oynatılmadan hemen önce de kontrol edilir).
- **Orta (😎):** Kadro ihtiyaçlarını, bütçeyi ve kimyayı hesaplar ama ileriye bakmaz; dizilişi rakibe göre seçer, talimatları varsayılan bırakır.
- **Kolay (🙂):** İyi oyuncuları tanır, plan yapmaz; artırmada liste fiyatını geçmez, taktiği basittir.

Botların telefonu yok: hamlelerini **adminin cihazı** yapar (kısa bir "düşünme" beklemesiyle), bu yüzden draft ve lig boyunca adminin uygulaması açık olmalı. Bot hamleleri de aynı API'den ve sunucu kurallarından geçer; botlar yeni kural gerektirmez. Botlar transfer yapmaz ve onlara teklif gönderilemez.

Ölçüm (`node tools/bots.mjs <classic|budget|auction> <lig sayısı>`; her ligde bir zor, bir orta, bir kolay bot ve otomatik seçim + otomatik kadro kullanan bir "insan"): zor bot klasik draftta 12 ligin 8'ini, bütçeli draftta 12'nin 8'ini, açık artırmada 10'un 8'ini kazandı; sıralama her modda zor > orta > kolay ≈ otomatik insan. Aynı kadroyla, insan benzeri taktiklere karşı botun haftalık taktiği maç başına ortalama ~0,9 puan fazla getiriyor.

## Taktik ekranı

- **Mevki değiştirme:** Sahada bir oyuncuya dokun → **Mevki** sekmesi. Dizilişin izin verdiği varyantları seçebilirsin: MO ↔ DOS ↔ OOS, bek ↔ kanat bek, kanat orta saha ↔ kanat, santrfor ↔ düşen forvet.
- **Oyuncu rolü** (aynı yerde **Rol / görev** sekmesi), mevkiye göre:
  - **Kaleci:** libero kaleci
  - **Stoper:** oyun kurucu stoper, sert stoper, süpürücü
  - **Bek:** savunmacı bek, bindiren bek, içe kat eden bek
  - **Ön libero:** çapa, derin oyun kurucu (regista), top kapıcı, stoperler arasına inen pivot
  - **Orta saha:** box-to-box, oyun kurucu, mezzala
  - **On numara:** gölge forvet, serbest oyuncu
  - **Kanat:** klasik kanat, içe kat eden forvet, ters kanat, savunmaya dönen kanat
  - **Forvet:** golcü, hedef forvet, sahte 9, pres forvet, arkaya koşan forvet

  Her rolün yanında oyuncunun uygunluk yıldızı var. Rolüne biçilmiş kaftan oyuncu (uygunluk ≥ %75) her işte %3 daha iyi oynar; rolüne uymayan oyuncu (< %35) %7 daha kötü oynar ve rolün avantajı azalır, bedeli (ör. savunma yapmamak) yine ödenir.
- **Rol uyumu (rollerin birbirini tamamlaması), motorda gerçek etkisi var:**
  - Hedef forvet + en az iki ortacı (klasik kanat, bindiren bek, kanat orta saha): kanat hücumu +%4, orta pozisyonları +%8. Ortacı yoksa hedef forvet boşa gider.
  - Sahte 9 + boşluğa koşan oyuncu (içe kat eden forvet, gölge forvet, mezzala, box-to-box, arkaya koşan forvet): merkez hücumu +%7. Koşucu yoksa −%10.
  - İçe kat eden kanat + arkasından bindiren bek (aynı kanat): o kanat +%8; bindiren yoksa genişlik kalmaz (−%5).
  - Klasik kanat + içe kat eden bek: dengeli kanat. Klasik kanat + bindiren bek: hücum kalabalık ama top kaybında kanat boş.
  - Oyun kurucu / regista + top kapıcı / çapa: top hakimiyeti +%4. İki oyun kurucu ve top kapan yok: merkez savunması −%7.
  - Golcü forvet + ona pas atacak yaratıcı oyuncu: ceza sahası pozisyonları +%8; yaratıcı yoksa −%5.
  - Hedef forvet + golcü / arkaya koşan forvet ikilisi: merkez hücumu +%6. Arkaya koşan forvet + uzun pasçı (oyun kurucu stoper, regista): ara pas pozisyonları +%12.
  - İki bindiren bek + stoperler arasına inen pivot / çapa: arka kapalı. Çapa yoksa kontraya çok açık.
  - Serbest oyuncu (trequartista) + iki çalışkan oyuncu: serbest oyuncu rahat oynar; yoksa merkez açık.
  - Sert stoper + süpürücü stoper: merkez savunması +%4. İki sert stoper: arkayı kollayan yok.
  - Pres forvet + önde pres / gegenpress, libero kaleci + yüksek hat, box-to-box + arkasında sabit duran oyuncu da birbirini güçlendirir.
- **Oyun tarzı** (taktik ekranında her tarzın kadrona ve haftanın rakibine göre uyum yıldızı ve nedeni yazar; tarzın etkisi uyuma bağlıdır: uyum yüksekse takım belirgin güçlenir, düşükse dengeli oynamaktan kötü olur):
  - **Pas oyunu:** orta sahanın pası, top saklaması, soğukkanlılığı; stoperlerin ve kalecinin oyun kurması; rakip orta sahanın presi. Topa sahip olma −%10 … +%20. Zayıf pasçılar baskı altında top kaybedip kontra yer.
  - **Kanat oyunu:** kanatçıların hızı, dripling ve ortası, beklerin bindirmesi, forvetin kafası; rakip beklere karşı ikili mücadele. Kanat hücumu −%11 … +%21, ataklar kanatlara kayar, daha çok orta ve korner.
  - **Uzun top / direkt:** forvetlerin hızı ve hava gücü rakip stoperlere karşı, geride uzun pası iyi oyuncu; rakibin savunma hattı yüksekse daha etkili. Pozisyon üretimi −%16 … +%26.
  - **Kontra atak:** hücum hattının hızı, top kazanınca ilk pası atacak orta saha; rakip ne kadar önde ve hücumcu oynuyorsa o kadar etkili.
  - **Gegenpress:** önde basan ve çok koşan oyuncular; rakip geriden kötü oyun kuruyorsa çok etkili. Rakibin oyun kurması bozulur, önde top kazanılır; ama oyuncular %12 daha çok yorulur, arkada boşluk kalır. Derin savunma hattıyla çelişir.
  - **Kompakt blok (otobüs):** stoper, bek ve ön liberonun savunma gücü; rakibin dripling ve bitiricilik kalitesi. Savunma +%3 … +%27, hücum −%10, rakibin ara pas ve ceza sahası pozisyonları azalır.
  - **Dengeli:** plan yok, ne artı ne eksi.
- **Diğer plan talimatları:**
  - **Hücum yönü:** karışık, sol / merkez / sağ ağırlıklı, rakibin zayıf kanadı. Seçilen bölge +%10 (merkez +%5) ve atakların çoğu oradan gelir, diğer bölgeler biraz zayıflar. Analiz, seçtiğin bölgenin rakibe karşı en iyi mi en kötü mü olduğunu söyler.
  - **Tempo:** yavaş / normal / yüksek. Yüksek tempo daha çok pozisyon üretir ama maçı iki tarafa da açar ve yorar; yavaş tempo maçı soğutur.
  - **Duran toplar:** normal / duran top ağırlıklı. Daha çok korner ve frikik; kafası iyi uzun oyuncular ve iyi ortacı varsa gol getirir, yoksa boşa gider.
  - **Ofsayt taktiği:** hızlı ve dikkatli savunmacılarla kontraları ve ara pasları keser; yavaş savunmayla risklidir. Derin hatla neredeyse etkisizdir.
  - **Önde pres** de artık oyuncuların pres gücüne bağlı.
- **Değişiklik planı:** "Kondisyon X'in altına düşünce Y. dakikadan sonra çıkar" + en fazla 3 oyuncuya özel istisna. Yedeklerden o mevkiye en uygun oyuncu otomatik girer.

## Maç sonu ve sezon analizi

- **Maç merkezi → 🧠 Analiz:** galibiyet hak edilmiş mi (xG), topa sahip olma neden öyleydi, pozisyonlar hangi bölgeden geldi (sol, merkez, sağ, kontra, duran top), en büyük bölge üstünlüğü, maç öncesi taktik uyarılarından hangisi gerçekleşti, öne çıkan oyuncular ve bir sonraki maç için öneri.
- **Lig → 🧠 Analiz:** her takımın dizilişi, oyun tarzı, topa sahip olma, xG/xG yenen, attığı ve yediği gollerin bölgeleri, sık kullandığı roller. Ayrıca lider takımın neden önde olduğunun açıklaması ve geçmiş sezonlar.
- **Canlı hafta:** Admin haftayı oynatınca sonuçlar gizli gelir. "▶︎ Canlı izle" ile haftanın bütün maçları aynı anda dakika dakika akar. İlk ~3,5 dakikada giren herkes aynı dakikayı izler ("CANLI"); sonra girenler baştan izler.
  - Varsayılan olarak sadece izlediğin maçın (kendi maçının) olayları, gol ekranı ve sesi gelir; diğer maçlardan sadece skor görünür. "Diğer maçların bildirimlerini de göster" kutusu bunu açar (telefonda hatırlanır).
  - Admin "⏹ Maçları bitir" ile yayını herkes için hemen bitirir; sonuçlar, puan durumu ve istatistikler açılır. Maçlar sonra tekrar izlenebilir.
- **Yeni sezon:** Sezon bitince admin "aynı kadrolarla yeni sezon" ya da "yeniden draft" başlatabilir. Biten sezon geçmişe kaydedilir.

## Maç sonucunu ne belirliyor?

**1) Oyuncunun güncel seviyesi:** %40 EA FC 27 puanı, %35 gerçek form, %25 piyasa değeri.
- Form puanı **lig gücüne göre** ayarlanır: Süper Lig'deki 7.7 ortalama, Premier Lig'dekinden daha az sayılır.
- Piyasa değeri sıralamaya göre seviyeye çevrilir: havuzun en değerlisi en yüksek seviyeye, en ucuzu en düşüğe denk gelir; yaşlı oyunculara küçük bir düzeltme yapılır. Örnek: Doué (PSG, €120M) 88, Salah (Trabzonspor, €17M, 34 yaş) 87,4.
- Birden fazla mevki oynayabilen oyuncular draftta "Çok yönlü" etiketiyle gösterilir ve öneride hafif avantaj alır.
- **Gerçek form:** FotMob'dan bu sezonki maç puanı ortalaması ve son 5 maç; az maçı olan oyuncunun formu daha az sayılır.
- **Piyasa değeri:** Transfermarkt. Değer, havuz üzerinde değer + yaş → güç regresyonuyla seviyeye çevrilir.
- Verisi olmayan oyuncu nötr kabul edilir (EA puanı kullanılır). Hiçbir istatistik uydurulmaz.

**2) Maç günü:** mevki uyumu, kondisyon ve küçük bir kontrollü rastgelelik.
- **Mevki uyumu:** Stoper forvette çok kötü oynar. Sağ ayaklı oyuncu sol bekte (doğal mevkisi değilse) biraz düşer.
- **Kondisyon:** Maç içinde yorgunluk, pres, tempo ve gegenpress kondisyonu düşürür. Yaşlı oyuncular biraz daha çabuk yorulur ve daha yavaş toparlanır: 90 dakika oynayan 34 yaşındaki oyuncu ~80 ile bitirir, sonraki maça ~90 ile başlar; üst üste iki-üç maçtan sonra dinlenmesi gerekir. 24 yaş ve altı her hafta dinç. Haftalık toparlanma (oynadı / yedekte / BAY): 24 yaş altı +16 / +18 / +24, 34 yaş +9 / +14 / +20.
- **Rastgelelik:** Oyuncunun günü ±%5 civarında değişir.

**3) Taktik yapı (bölge modeli):** Saha sol kanat / merkez / sağ kanat olarak ayrılır. Her bölgede hücum gücün rakibin o bölgedeki savunmasıyla karşılaştırılır; takımlar rakibin zayıf olduğu bölgeden daha çok atak yapar. Motorun ve taktik ekranının tespit ettiği durumlar:
- **Ön libero yok** (iki ofansif MO) → merkez savunmanın önü açık kalır, daha çok gol yenir.
- **Merkezde sadece iki orta saha** ve biri gerçek ön libero değil → orta saha kolay aşılır.
- **Orta sahada sayıca geride kalmak** (ör. düz 4-4-2'ye karşı 4-3-3) → topa daha az sahip olunur.
- **Savunmaya yardım etmeyen kanat + hücuma çıkan bek** → o kanattan çok atak yenir.
- **Çift forvet:** İkisi de savunmaya katılmıyorsa orta saha zayıflar. "Biri orta sahaya yardım etsin" talimatı bunu azaltır, hücumu biraz düşürür.
- **Yavaş stoperler + yüksek savunma hattı** → kontra ve arkaya atılan toplar tehlikeli olur.
- **Hava toplarında zayıf stoperler** → ortalar ve kornerler tehlikeli olur.
- **Talimatlar:** oyun anlayışı, pres, savunma hattı, bekler, genişlik, oyun tarzı, hücum yönü, tempo, duran toplar ve ofsayt taktiği (bkz. Taktik ekranı).

**4) Olay bazlı simülasyon:** 90 dakika + uzatmalar dakika dakika oynanır. Topa sahip olma, orta, ara pas, geri pas, uzaktan şut, kontra atak, korner, penaltı, kurtarış, faul, kart, sakatlık ve en fazla 5 oyuncu değişikliği (devre arası hariç 3 duraklama) olay olarak üretilir. Skor bu olaylardan doğar; önceden belirlenmez. Aynı seed ile tekrar oynatıldığında maç birebir aynı çıkar.

Kalibrasyon (gerçek veriyle, 8 takımlı 20 sezon, `npm run calibrate`): maç başına ~2,7 gol, takım başına ~13 şut ve ~4,6 isabetli şut, ~%41 iç saha galibiyeti, ~%25 beraberlik, ~0,46 penaltı ve ~0,28 kırmızı kart. Penaltılar açık oyundan ve ceza sahası içindeki fauldan gelir; penaltıya sebep olan oyuncu bazen net gol fırsatını engellediği için direkt kırmızı görür.

**Denge testi** (`node tools/stress.mjs 300 4`): 4 takımlı ligler; her takıma rastgele kadro, diziliş, talimat, mevki varyantı, rol ve değişiklik planı verilir.
- Kadro gücü hesaptan çıkarıldığında hiçbir diziliş, rol veya talimat 3.600 maçta ortalamada beklenenden ±4,1 puandan fazla sapmıyor: tek başına her zaman kazandıran bir seçenek yok, fark kadroya uygun seçimden geliyor.
- Oyun tarzlarının etkisi uyuma bağlı (botun maç modeliyle, kadro başına): uyumu en düşük çeyrekte kanat oyunu maç başına −0,26 puan, en yüksek çeyrekte +0,22 puan; pas oyunu −0,06 … +0,11, uzun top −0,08 … +0,14, gegenpress −0,02 … +0,14, kompakt blok −0,05 … +0,09.
- Rastgele (çoğu uç) taktiklerle maç başına ~3,5 gol çıkıyor ve maçların ~%2'sinde 9+ gol oluyor.

## Veri

`data/players.js`: 320 oyuncu (30 KL, 55 STP, 25 SĞB, 25 SLB, 28 DOS, 40 MO, 25 OOS, 30 sol kanat, 30 sağ kanat, 32 FV). Süper Lig'den veya Türk 44 oyuncu var. Kaynaklar ve yöntem için `data/README.md` dosyasına bak.
- **EA SPORTS FC 27:** 34 detaylı özellik, ayak, zayıf ayak, yetenek.
- **Transfermarkt:** piyasa değeri (%100).
- **FotMob:** 2026/27 form (%98) ve boy.
- **Eksik:** EA çalışkanlık (work rate) değerlerini yayınlamıyor. Bu değerler dayanıklılık, agresiflik ve savunma özelliklerinden **tahmin ediliyor** ve oyunda "tahmini" diye gösteriliyor.

## Firebase kurulumu (gerçek odalar için, bir kerelik)

Firebase ayarlanmadan uygulama **demo modunda** çalışır: oda sadece o tarayıcıda olur; aynı bilgisayarda birden çok sekme farklı oyuncu gibi davranır.

1. <https://console.firebase.google.com> → **Proje ekle** (Analytics gerekmez).
2. **Build → Authentication → Başlayın → Sign-in method → Anonymous → Etkinleştir.**
3. **Build → Realtime Database → Veritabanı oluştur** → konum *europe-west1* → kilitli modda başla.
4. **Realtime Database → Rules**: `online/database.rules.json` içeriğini yapıştır ve yayınla (6. adımı yaparsan bu adım otomatik olur).
5. **Proje ayarları → Genel → Uygulamalarınız → Web (</>)** → uygulama ekle. Çıkan `firebaseConfig` değerlerini `online/src/config.js` dosyasına yaz. Bu değerler gizli değildir; güvenliği kurallar sağlar.
6. *(web.app adresi için, tek sefer)* **Proje ayarları → Hizmet hesapları → Yeni özel anahtar oluştur.** İnen JSON'un tamamını GitHub'da **Settings → Secrets and variables → Actions → New repository secret** olarak `FIREBASE_SERVICE_ACCOUNT` adıyla ekle. Proje kimliği `online/.firebaserc` dosyasından okunur (`draft-arena-5045a`), ayrıca değişken gerekmez. Bundan sonra `main`'e her gönderimde site fotoğraflarla birlikte <https://draft-arena-5045a.web.app> adresine ve kurallar veritabanına otomatik yüklenir; iş akışı sonunda bir fotoğrafın açıldığını da kontrol eder. Secret yoksa iş akışı uyarı verip atlar. Elle yüklemek için: `cd online && npx firebase-tools deploy --only hosting,database`.

Site GitHub Pages'te de çalışır: `https://kaanirtegun8.github.io/draft-arena/online/`. Ama asıl adres web.app; iki adres tarayıcıda ayrı sayılır (oturum ve koltuk her adreste ayrı tutulur).

### Uygulama kapalıyken bildirim (isteğe bağlı)

Arka plan push bildirimi sunucu gerektirir:
1. Firebase **Blaze** (kullandıkça öde) planına geç; arkadaş grubu ölçeğinde ücretsiz kotada kalır.
2. **Proje ayarları → Cloud Messaging → Web Push sertifikaları**'ndan bir anahtar üret ve `VAPID_KEY` olarak `src/config.js` dosyasına yaz.
3. `functions/` klasörünü `firebase deploy --only functions` ile yükle.

iPhone'da push bildirimi için site **Ana Ekrana Ekle** ile uygulama gibi açılmalı (iOS 16.4+).

## Testler

```
cd online && npm test                      # oyun mantığı (draft, fikstür, motor, ceza, ödül, API akışı)
cd online/tests-rules && npm ci && npm test  # Firebase güvenlik kuralları (emülatör, Java gerekir)
```

- **Kural testleri** gerçek istemci kodunu farklı kullanıcılar olarak çalıştırır:
  - yanlış şifreyle katılamamak
  - sırası olmayanın seçememesi
  - aynı oyuncunun iki kez alınamaması
  - sezonun draft bitmeden yazılamaması
  - sonuçları sadece adminin yazması
  - koltuk ve admin kurtarma
- **Taktik testleri:**
  - ön libero eksikliği daha çok gol yedirir
  - savunmaya dönmeyen kanat + hücumcu bek, kanattan daha çok gol yedirir
  - elmas orta saha, düz 4-4-2'ye göre topa daha çok sahip olur
  - stoper forvette daha az gol atar
  - yorgun ve formsuz takımlar daha çok kaybeder
  - oyun tarzının gücü oyunculara bağlı (iyi kanatlarla kanat oyunu güçlü, zayıflarla değil; pasçı orta sahayla pas oyunu topu tutar)
  - sahte 9 boşluğa koşan oyuncularla güçlü, koşucusuz zayıf
  - 34 yaşındaki oyuncu üst üste iki maç oynayabilir; penaltı ve kırmızı kart sıklığı
  - admin canlı yayını herkes için bitirir; bilinmeyen taktik değerleri kaydedilmez

## Sınırlar

- Haftaları admin cihazı simüle eder (sunucu fonksiyonu gerekmesin diye). Sonuç deterministiktir ve maç kaydından herkes doğrulayabilir.
- Seçim süresi dolunca otomatik seçimi admin cihazı yapar; admin çevrimdışıysa süre dolsa da seçim bekler.
- Pozisyon kontenjanı istemcide kontrol edilir; sıra, şifre, tekrar seçim ve yetki ise sunucuda.
- iOS Safari, ana ekrana eklenmemiş sitelerin verisini 7 gün kullanılmazsa silebilir. Bu durumda "koltuğumu geri al" (admin onayı) veya admin kurtarma kodu kullanılır.
