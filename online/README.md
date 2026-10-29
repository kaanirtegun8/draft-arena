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

  Her rolün yanında oyuncunun uygunluk yıldızı var. Uygun oyuncu rolün avantajını tam alır; uygun olmayanda avantaj azalır ama bedel (ör. savunma yapmamak) yine ödenir.
- **Oyun tarzı:** pas oyunu, dengeli, direkt/uzun top, kontra. Direkt ve kontra oynayan takım orta sahayı atlar; rakibin orta saha üstünlüğü ona daha az zarar verir. Bu tarzlarda forvetlerin hızı ve hava gücü belirleyici olur.
- **Değişiklik planı:** "Kondisyon X'in altına düşünce Y. dakikadan sonra çıkar" + en fazla 3 oyuncuya özel istisna. Yedeklerden o mevkiye en uygun oyuncu otomatik girer.

## Maç sonu ve sezon analizi

- **Maç merkezi → 🧠 Analiz:** galibiyet hak edilmiş mi (xG), topa sahip olma neden öyleydi, pozisyonlar hangi bölgeden geldi (sol, merkez, sağ, kontra, duran top), en büyük bölge üstünlüğü, maç öncesi taktik uyarılarından hangisi gerçekleşti, öne çıkan oyuncular ve bir sonraki maç için öneri.
- **Lig → 🧠 Analiz:** her takımın dizilişi, oyun tarzı, topa sahip olma, xG/xG yenen, attığı ve yediği gollerin bölgeleri, sık kullandığı roller. Ayrıca lider takımın neden önde olduğunun açıklaması ve geçmiş sezonlar.
- **Canlı hafta:** Admin haftayı oynatınca sonuçlar gizli gelir. "▶︎ Canlı izle" ile haftanın bütün maçları aynı anda dakika dakika akar. İlk ~3,5 dakikada giren herkes aynı dakikayı izler ("CANLI"); sonra girenler baştan izler.
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
- **Kondisyon:** Haftalar arasında oynayan +6, oynamayan +16, BAY haftasında herkes +24 toparlanır. Maç içinde yorgunluk ve pres kondisyonu düşürür.
- **Rastgelelik:** Oyuncunun günü ±%5 civarında değişir.

**3) Taktik yapı (bölge modeli):** Saha sol kanat / merkez / sağ kanat olarak ayrılır. Her bölgede hücum gücün rakibin o bölgedeki savunmasıyla karşılaştırılır; takımlar rakibin zayıf olduğu bölgeden daha çok atak yapar. Motorun ve taktik ekranının tespit ettiği durumlar:
- **Ön libero yok** (iki ofansif MO) → merkez savunmanın önü açık kalır, daha çok gol yenir.
- **Merkezde sadece iki orta saha** ve biri gerçek ön libero değil → orta saha kolay aşılır.
- **Orta sahada sayıca geride kalmak** (ör. düz 4-4-2'ye karşı 4-3-3) → topa daha az sahip olunur.
- **Savunmaya yardım etmeyen kanat + hücuma çıkan bek** → o kanattan çok atak yenir.
- **Çift forvet:** İkisi de savunmaya katılmıyorsa orta saha zayıflar. "Biri orta sahaya yardım etsin" talimatı bunu azaltır, hücumu biraz düşürür.
- **Yavaş stoperler + yüksek savunma hattı** → kontra ve arkaya atılan toplar tehlikeli olur.
- **Hava toplarında zayıf stoperler** → ortalar ve kornerler tehlikeli olur.
- **Talimatlar:** oyun anlayışı, pres, savunma hattı, bekler ve genişlik.

**4) Olay bazlı simülasyon:** 90 dakika + uzatmalar dakika dakika oynanır. Topa sahip olma, orta, ara pas, geri pas, uzaktan şut, kontra atak, korner, penaltı, kurtarış, faul, kart, sakatlık ve en fazla 5 oyuncu değişikliği (devre arası hariç 3 duraklama) olay olarak üretilir. Skor bu olaylardan doğar; önceden belirlenmez. Aynı seed ile tekrar oynatıldığında maç birebir aynı çıkar.

Kalibrasyon (gerçek veriyle, 8 takımlı 12 sezon, `npm run calibrate`): maç başına ~2,7 gol, takım başına ~13 şut ve ~4,6 isabetli şut, ~%41 iç saha galibiyeti, ~%25 beraberlik.

**Denge testi** (`node tools/stress.mjs 1500 4`): 4 takımlı ligler; her takıma rastgele kadro, diziliş, talimat, mevki varyantı, rol ve değişiklik planı verilir.
- Kadro gücü hesaptan çıkarıldığında hiçbir diziliş, rol veya talimat 18.000 maçta beklenenden ±4 puandan fazla sapmıyor.
- En avantajlı kurgu elmas 4-4-2 (+3,8), en dezavantajlı düz 4-4-2 (−2,5).
- Rastgele (çoğu uç) taktiklerle maç başına ~3,2 gol çıkıyor ve maçların ~%1'inde 9+ gol oluyor.

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
6. *(web.app adresi için)* **Proje ayarları → Hizmet hesapları → Yeni özel anahtar oluştur.** İnen JSON'un tamamını GitHub'da **Settings → Secrets and variables → Actions → New repository secret** olarak `FIREBASE_SERVICE_ACCOUNT` adıyla ekle. Aynı sayfanın **Variables** sekmesine proje kimliğini `FIREBASE_PROJECT_ID` olarak ekle. Bundan sonra `main`'e her gönderimde site `https://<proje>.web.app` adresine ve kurallar veritabanına otomatik yüklenir.

Firebase yapılandırılınca site GitHub Pages'te de çalışır: `https://kaanirtegun8.github.io/draft-arena/online/`.

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

## Sınırlar

- Haftaları admin cihazı simüle eder (sunucu fonksiyonu gerekmesin diye). Sonuç deterministiktir ve maç kaydından herkes doğrulayabilir.
- Seçim süresi dolunca otomatik seçimi admin cihazı yapar; admin çevrimdışıysa süre dolsa da seçim bekler.
- Pozisyon kontenjanı istemcide kontrol edilir; sıra, şifre, tekrar seçim ve yetki ise sunucuda.
- iOS Safari, ana ekrana eklenmemiş sitelerin verisini 7 gün kullanılmazsa silebilir. Bu durumda "koltuğumu geri al" (admin onayı) veya admin kurtarma kodu kullanılır.
