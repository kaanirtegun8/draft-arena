# Draft Arena

5 menajerin 90 gerçek futbolcuyu draft ettiği, ardından 20 maçlık çift devreli ligde dakika dakika simüle edilen maçlarla yarıştığı tarayıcı oyunu. Derleme adımı yok; saf HTML/CSS/JS (ES modülleri). Mobil Safari öncelikli tasarlandı.

## Oynamak

- **Yerelde:** `npm run serve` → <http://localhost:8080> (herhangi bir statik sunucu olur; `file://` ile ES modülleri çalışmaz).
- **GitHub Pages:** aşağıdaki "Yayınlama" bölümüne bak.

## Oyun akışı

1. **Kurulum** – lig adı, isteğe bağlı seed, 5 menajer (her biri insan veya CPU). Birden fazla insan aynı cihazda sırayla oynar.
2. **Draft** – yılan (snake) usulü, 18 tur × 5 = 90 seçim. Kadro kontenjanı: 2 KL, 6 DEF, 6 OS, 4 FV. CPU menajerler ihtiyaca göre seçer; insanlar için "Öneri" ve "Otomatik seç" var.
3. **Lig** – 10 hafta, her hafta 2 maç ve 1 takım BAY. Her takım 8 maç oynar (4 iç saha, 4 deplasman) ve 2 kez BAY geçer.
4. **Taktik** – 6 diziliş, 5 oyun stili, saha üzerinde ilk 11 düzenleme, kondisyona göre otomatik rotasyon, maç öncesi otomatik oyuncu değişikliği kuralları.
5. **Maç** – canlı skor tabelası, dakika ilerlemesi, gol/asist bildirimi, değişiklikler, istatistikler, maçın oyuncusu, oyuncu puanları, 1x/2x/4x/10x hız, anında bitirme ve tekrar izleme.
6. **Sezon sonu** – gol kralı (+2 puan), asist kralı (+1 puan), en iyi kaleci, sezonun oyuncusu, sezonun 11'i, en iyi draft seçimi ve şampiyonluk ekranı.

Kayıt: her işlemden sonra otomatik kayıt, ayrıca 3 kayıt yuvası ve JSON dışa/içe aktarma.

## Maç motoru (`src/core/engine.js`)

Skor önceden belirlenmez. Her dakika sahadaki oyunculardan takım hücum/orta saha/savunma/kaleci güçleri hesaplanır. Bu güçlerden topla oynama, pozisyon, şut, isabet, kurtarış, gol, asist, faul, kart ve sakatlık olayları üretilir. Skor bu olayların toplamıdır. Uzatma dakikaları da oynanır.

Oyuncu performans puanı (`src/core/config.js` → `PERFORMANCE_WEIGHTS`):

| Bileşen | Ağırlık | Nasıl hesaplanır |
|---|---|---|
| EA FC özellikleri | %30 | Genel güç ve pozisyona özel kart özellikleri |
| Gerçek hayat formu | %30 | 0–100 form endeksi (50 = normal). **Veri yoksa nötr:** oyuncu kendi EA seviyesinde değerlendirilir |
| Taktik / diziliş uyumu | %15 | Pozisyon uyumu ve oyun stili uyumu |
| Rakibin güçlü/zayıf yönleri | %10 | Örneğin forvetin hızı ile rakip savunmanın hızı karşılaştırılır |
| Kondisyon / yorgunluk | %10 | Maç içinde canlı düşen kondisyon |
| Kontrollü rastgelelik | %5 | Seed'li, oyuncu başına günlük sapma |

Kalibrasyon (`npm run calibrate`, testlerde de kontrol ediliyor), 40 sezonluk ortalama: maç başına ~2,8 gol, takım başına ~11,7 şut ve ~4,4 isabetli şut, ~%40 iç saha galibiyeti, ~%26 beraberlik, maç başına ~3,4 sarı ve ~0,15 kırmızı kart. Ağırlıklar başlangıç değerinde bırakıldı; kalibrasyon motor sabitleriyle (`ENGINE_TUNING`) yapıldı.

- **Değişiklik:** maç başına en fazla 5 değişiklik, devre arası hariç 3 duraklama. Sakatlanan oyuncu her zaman değiştirilir; hak kalmadıysa takım eksik kalır.
- **Otomatik kurallar:** kondisyon eşiği, belirli dakika, gerideysek, öndeysek, berabereysek, sarı kartlıyı değiştir.
- **Determinizm:** aynı girdi ve seed her zaman aynı maçı üretir. Maç başlatıldığı anda sonuç kesinleşir ve bir daha oynatılamaz. Tekrar, kayıtlı girdi ile motoru yeniden çalıştırır ve sonucun aynı çıktığını doğrular.

## Kondisyon

- 0–100 arası bir değer. Maçta oynanan her dakika düşürür; dayanıklılık (FİZ) ve oyun stili hızını etkiler.
- Haftalık toparlanma: oynayanlar +6, oynamayanlar +16, BAY haftası tüm kadro +24.
- Düşük kondisyon performansı ve sakatlık riskini artırır, bu yüzden rotasyon gerekir. CPU takımlar otomatik rotasyon yapar.

## İstatistikler

Oyuncu başına: maç, ilk 11, dakika, gol, asist, şut, isabetli şut, sarı/kırmızı kart, ortalama puan ve maçın oyuncusu sayısı. Kaleciler için ayrıca kurtarış, yenilen gol ve gol yemeden tamamlanan maç tutulur. Bütün istatistikler kayıtlı maç olaylarından hesaplanır, bu yüzden maçlarla her zaman tutarlıdır.

## Veri

`src/data/players.js`: 128 oyunculuk havuz (14 KL, 42 DEF, 42 OS, 30 FV). Değerler 2026-10-28'de EA'nın resmi reyting sitesinden (ea.com) alınan **EA SPORTS FC 27** kart özellikleridir; sitede artık FC 26 verisi yok. Gerçek hayat form verisi **dahil değildir ve uydurulmaz**. Uygulamada oyuncu kartından veya *Oyuncu Verisi* ekranından JSON ile girilebilir (0–100 form ya da ortalama maç puanı).

## Testler

```
npm test
```

Kapsananlar: 5 menajerin 18'er farklı oyuncu seçmesi, draft sırası adaleti, pozisyon kontenjanları, 20 maç / 8 maç / 2 BAY / 4 iç saha + 4 deplasman, değişiklik sınırı, gol ve asist istatistiklerinin maçlarla tutarlılığı, bonus puanların sadece sezon sonunda ve doğru uygulanması, kaydetme/yükleme sonrası verilerin korunması. Ayrıca motor kalibrasyonu, determinizm, güç/kondisyon/form etkileri ve sonucun tek kez kesinleşmesi de test ediliyor.

## Yayınlama (GitHub Pages)

`.github/workflows/pages.yml` her push'ta testleri çalıştırır; `main` dalına gelen push'larda testler geçerse siteyi Pages'e yükler. Bir kereye mahsus yapılacak ayar:

1. GitHub'da repo → **Settings → Pages**.
2. **Build and deployment → Source: GitHub Actions** seç.
3. Kodu `main` dalına birleştir (ya da Actions sekmesinden iş akışını elle çalıştır).
4. Site şu adreste açılır: `https://kaanirtegun8.github.io/draft-arena/`

## Bilinen eksikler / sınırlar

- Gerçek hayat form verisi otomatik çekilmiyor (güvenilir ve ücretsiz canlı kaynak yok); elle veya JSON ile girilmesi gerekiyor. Girilmeyen oyuncular nötr kabul ediliyor.
- Maç sırasında elle oyuncu değişikliği yok: değişiklikler maç öncesi kurallarla ve otomatik menajerle yapılıyor.
- Çevrimiçi çok oyunculu mod yok. İnsan menajerler aynı cihazda sırayla oynuyor.
- Tek sezonluk lig: sezonlar arası devam, transfer veya yeniden draft yok.
- Mobil test Chromium üzerinde iPhone 13 emülasyonuyla yapıldı; gerçek bir iPhone'da Safari ile denenmedi.
- Oyuncu verisi sabit bir anlık görüntü (2026-10-28); EA'nın sezon içi güncellemeleri otomatik gelmiyor.
