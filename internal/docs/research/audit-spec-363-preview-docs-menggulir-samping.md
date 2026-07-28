# Audit SPEC-363 — pratinjau dokumen harus digulir (dan unduhannya ikut susah dibaca)

**Sumber:** qa · **Prioritas:** tinggi · **Severity:** major · **Tanggal:** 2026-07-28
**Status:** akar masalah ditemukan & terukur → perbaikan langsung (Spec & Plan `skipped`, ADR-0020/0040)
**Terkait:** [ADR-0078](../adr/0078-unduh-dokumen-md-pdf.md) (unduh `.md`/`.pdf`),
[ADR-0011](../adr/0011-docs-realtime-filesystem.md) (docs = filesystem nyata),
[frontend-implementation](../frontend/frontend-implementation.md) (renderer `.hn-md` bersama)

## Keluhan

> saat ini preview docs harus scrolling seharusnya tidak, akibatnya download .md dan .pdf jadi
> harus scrolling juga. dan pembacaan docs jadi susah — *diharapkan:* pada preview docs tidak
> perlu scrolling

"Tidak perlu scrolling" tak mungkin dipenuhi secara harfiah untuk dokumen panjang: gulir
**vertikal** adalah cara membaca dokumen. Yang bisa — dan seharusnya — nol adalah gulir
**horizontal**, plus jendela baca yang tidak lebih kecil dari ruang yang tersedia. Audit ini
mengukur ketiganya.

## Metode

Repro terukur, bukan inspeksi mata: Chrome headless (CDP, nol dependensi) memuat CSS asli
(`ds/tokens/*.css` + `app.css`) dan HTML dari `marked` dengan opsi **yang sama** dengan
`ds/markdown.tsx` (`gfm:true, breaks:false`), di dalam geometri yang **disalin verbatim** dari
`SpecDocsModal.tsx:53/59/93` + `kit.tsx:60-82` (pane 602×489 px) dan `DocsWorkspace.tsx:178/243`
(pane 898×620 px). Lalu `scrollWidth − clientWidth` diukur untuk **353 berkas `.md`** yang
benar-benar ada di repo (`git ls-files internal/docs docs`). PDF diverifikasi dengan merender
dokumen sungguhan lewat `renderDocPdf` lalu **dibaca halaman per halaman**.

## Temuan A — pane pratinjau menggulir ke samping (33 dari 353 dokumen)

Bukan tabel yang jadi tersangka utama, melainkan **rangkaian inline `code` tanpa spasi**.
Contoh terukur, `docs/superpowers/plans/2026-07-21-spec-257-ai-agent-capability.md:1189`:

```
**Type consistency:** `capabilityForRoute`/`checkAgentCapability`/`grantsCapability`/…/`req.agent`
```

Ketiga belas `<code>` itu jadi satu baris yang tak punya satu pun peluang putus, sehingga
mendorong container: `hOverflow = 1199 px` di pane modal (lebar isi 586 px) dan `925 px` di pane
Docs (838 px). Akibatnya **prosa** pun bergeser ke samping — jenis gulir yang paling
mengganggu, karena teks yang sedang dibaca ikut hilang ke kanan.

Tersangka kedua: **tabel GFM lebar**. `docs/superpowers/plans/2026-07-10-hanoman-hilangkan-guardrail-spec-160.md`
punya tabel ber-`min-content` **1122 px**; `.hn-md table { width: 100% }` tak bisa menyusut di
bawah min-content, jadi tabelnya mendorong pane (+536 px di modal, +284 px di Docs).

Akar: `.hn-md` (`src/src/app.css:14-62`) **tidak pernah menyetel `overflow-wrap`**, dan tabelnya
`table-layout: auto`. Dua-duanya membuat lebar minimum isi menang atas lebar container.

## Temuan B — blok kode menuntut gulir horizontal (187 dari 353 dokumen)

`.hn-md pre { overflow: auto }` (`app.css:41-44`) memindahkan gulir ke dalam kotak kode, jadi
container selamat — tapi **isinya tetap harus digulir menyamping untuk dibaca**. Skalanya bukan
marginal:

| Dokumen | Lebar isi `<pre>` | Lebar pane modal | Rasio |
|---|---|---|---|
| `internal/docs/architecture/api-contract.md` | 3089 px | 586 px | **5,3×** |
| `docs/superpowers/plans/2026-07-28-hapus-branch-tak-terpakai-spec-360.md` | 7480 px (pane Docs) | 838 px | **8,9×** |
| `docs/superpowers/plans/2026-07-27-codex-sebagai-session-spec-338.md` | 3506 px (pane Docs) | 838 px | **4,2×** |

187 dari 353 dokumen (53%) punya minimal satu blok kode seperti ini. Karena docs hanoman
memuat kontrak API dan potongan kode sebagai isi utamanya, inilah sumber "pembacaan docs jadi
susah" yang paling sering kena.

## Temuan C — jendela pratinjau lebih kecil dari ruang yang tersedia

Kedua pane memakai **tinggi tetap**: `height: "62vh"` (`SpecDocsModal.tsx:59`) dan
`maxHeight: 620` (`DocsWorkspace.tsx:243`, juga `IdeScreen.tsx:291`). Diukur di tiga tinggi layar:

| Tinggi layar | Modal: dipakai / tersedia | Docs: dipakai / tersedia |
|---|---|---|
| 813 px (laptop 13") | 435 / 529 — **buang 18%** | 620 / 563 — **kelebihan 57 px → dua scrollbar** |
| 950 px | 520 / 649 — buang 20% | 620 / 700 — buang 11% |
| 1329 px (monitor besar) | 755 / 983 — buang 23% | 620 / 1079 — **buang 43%** |

Dua konsekuensi berbeda dari satu akar yang sama (angka tetap, bukan tinggi turunan):
di layar laptop kotak 620 px **melebihi** ruang `<main>` sehingga halaman ikut menggulir —
inilah "dua scrollbar"; di monitor besar ia memakai **kurang dari separuh** tinggi yang ada,
sehingga dokumen yang sebenarnya muat harus digulir. Komentar di `kit.tsx:120-131` sudah
mencatat pelajaran ini untuk layar berdaftar (`maxHeight: calc(100vh - 340px)` dicabut karena
"tebakan itu salah di tiap layar") — pane pratinjau belum ikut pindah ke rantai flex.

## Temuan D — PDF unduhan berhalaman dua kali lebih banyak dari isinya

Dibantah lebih dulu: hipotesis "teks PDF meluber ke luar margin kanan" **salah**. Diukur
langsung ke pdfkit — kata 567,6 pt di lebar baris 463,3 pt dipecah jadi dua baris; rantai inline
`code` 607 pt di lebar 479,3 pt juga dipecah. pdfkit memang memecah kata yang terlalu panjang.

Yang benar-benar rusak jauh lebih besar, dan **satu akar** mengikat tiga gejalanya:

> `doc.text(str, x, y, { width })` menyalakan pembungkus baris pdfkit. Pembungkus itu memeriksa
> batas bawah halaman dan **memanggil `addPage()` sendiri** — bahkan dengan `lineBreak: false`.
> Renderer hanoman menaruh teks di koordinat **eksplisit** sambil membukukan `doc.y` sendiri,
> jadi pagination implisit pdfkit bertabrakan dengan pembukuan itu.

**D1 — setiap halaman melahirkan satu halaman kosong di belakangnya.** Nomor halaman footer
digambar `text(label, left, y, { width, align: "right", lineBreak: false })`. Di `y = height-42`
pembungkusnya langsung memindah halaman, lalu **mencetak nomornya di halaman kosong itu** —
jadi halaman 1 tak bernomor sama sekali (terlihat di PDF hasil render) dan jumlah halaman dua
kali lipat. Terukur: dokumen satu paragraf → **2 halaman**, `hal. 1/1`.

**D2 — penanda butir daftar memindah halaman lalu koordinatnya jadi basi.** `drawList` menggambar
bullet dengan `{ width: 24, lineBreak: false }`, lalu memasang ulang `doc.y = top`. Bila
pembungkus tadi sudah pindah halaman, `top` adalah koordinat halaman **lama** di halaman
**baru** → butir berikutnya pindah lagi. Hasilnya halaman berselang-seling yang isinya cuma
satu bullet + footer: **5 dari 12 halaman** di `docs/prd/hardening-vps-checklist.md`.

Ini rantai **dua mata**, dan matriks 2×2 (kembalikan `width` / buang guard halaman, empat
kombinasi) menunjukkan **memutus salah satu saja sudah cukup**: `width` adalah pemicunya,
`doc.y = top` adalah yang mengubahnya jadi kerusakan. Keduanya tetap diputus karena
masing-masing benar sendiri — penanda tak pernah perlu dibungkus, dan pindah halaman memang
harus terjadi sebelum `top` dikunci (tanpa guard itu, butir yang mulai tepat di bawah batas
menggambar penandanya di area footer, karena tak ada lagi yang memaksa pindah).

**D3 — panel blok kode digambar setinggi seluruh blok.** `drawCode` memakai satu `rect` setinggi
`h` dan satu tes "muat di sisa halaman?". Untuk blok yang lebih tinggi dari satu halaman penuh
tes itu **selalu** benar, jadi ia pindah halaman **lalu bloknya tetap tak muat**:
`api-contract.pdf` halaman 1 kosong ±40% setelah heading "Projects", halaman 3 kosong ±55%
setelah "Backlog / specs"; `plan-257.pdf` halaman 3 kosong ±35%. Dan karena `rect` tak peduli
batas halaman — terukur **2126,6 pt di halaman 841,89 pt** — latar krem beserta teksnya
**menabrak garis + teks footer**.

Jadi klausa "download .pdf jadi harus scrolling juga" memang ada isinya, dan sebabnya bukan
lebar melainkan **jumlah halaman**: separuh halaman PDF hanoman kosong.

`.md` yang diunduh adalah **berkas mentah dari disk** (ADR-0011/0078) — panjang barisnya milik
dokumen itu sendiri, bukan cacat hanoman. Tak ada yang perlu diperbaiki di sana; yang membuat
`.md` terasa sama susah adalah sumber yang sama dengan Temuan B, yaitu baris panjang di blok
kode, dan itu sifat sumbernya.

## Hipotesis perbaikan — sudah diuji ke 353 dokumen

CSS saja untuk A + B, diuji berdampingan (satu pane tanpa perbaikan, satu dengan) di harness
yang sama:

```css
.hn-md            { overflow-wrap: anywhere; }
.hn-md table      { table-layout: fixed; }
.hn-md th, td     { overflow-wrap: anywhere; }
.hn-md pre        { white-space: pre-wrap; overflow-wrap: anywhere; }
```

| Metrik | Sebelum | Sesudah |
|---|---|---|
| Dokumen yang membuat pane menggulir horizontal | **33** | **0** |
| Dokumen dengan `<pre>` menggulir horizontal | **187** | **0** |
| Total tinggi konten (353 dokumen) | 2.893.389 px | 3.256.476 px (**+12,5%**) |

Harganya 12,5% konten lebih tinggi — gulir vertikal ditukar dengan gulir horizontal. Itu
pertukaran yang diminta keluhannya. `overflow-wrap: anywhere` (bukan `break-word`) dipilih
sengaja: hanya `anywhere` yang mengecilkan **min-content**, dan min-content itulah yang membuat
tabel mendorong container. `table-layout: fixed` sekaligus menyelaraskan pratinjau dengan PDF,
yang memang sudah memakai lebar kolom rata (`drawTable`: `w = (right-left)/cols`) — memperkuat
ADR-0078 §3 "apa yang tercetak = apa yang tampil".

Untuk C: tinggi diturunkan dari viewport lewat rantai flex Shell, bukan angka tetap. Modal
butuh opsi `fillHeight` (opt-in, agar 20-an modal lain tak berubah tingginya).

**Jebakan `flex-basis` yang terukur:** pembungkus `<main>` memakai `min-height: 100%` (bukan
`height` — sengaja, SPEC-351, supaya layar yang isinya lebih tinggi tetap tumbuh). Karena itu
item ber-`flex: 1 1 auto` memakai tinggi **isi**-nya dan justru menumbuhkan halaman: diukur
pane jadi **6000 px** dan `<main>` ikut menggulir. Yang benar `flex: 1 1 0` — basis 0 membuat
tinggi container pasti lebih dulu, lalu item mengisi sisanya (pane 566 px, halaman tak
menggulir). Jadi `LIST_SCREEN_STYLE` **tidak** bisa dipakai apa adanya di sini.

Untuk D: hilangkan `width` dari setiap `text()` yang diberi posisi eksplisit (nomor halaman →
`x` dihitung sendiri dari `widthOfString`; penanda butir → `lineBreak: false` saja), pindah
halaman **sebelum** mengunci `top` di `drawList`, dan gambar blok kode **bersegmen** — satu
`rect` latar per halaman, hanya pindah halaman bila bloknya memang muat di halaman kosong.

## Hasil sesudah perbaikan (terukur ulang)

| Metrik | Sebelum | Sesudah |
|---|---|---|
| Dokumen yang membuat pane menggulir horizontal (353 doc) | 33 | **0** |
| Dokumen dengan `<pre>` menggulir horizontal (353 doc) | 187 | **0** |
| Ruang tinggi terbuang, modal (813/950/1329 px) | 18% / 20% / 23% | **0% / 0% / 0%** |
| Ruang tinggi terbuang, Docs · SoT | +57 px (dua scrollbar) / 11% / 43% | **0% / 0% / 0%** |
| `api-contract.md` → PDF | 42 halaman | **18 halaman** |
| `docs/prd/hardening-vps-checklist.md` → PDF | 12 halaman (5 kosong) | **7 halaman (0 kosong)** |
| plan SPEC-257 → PDF | 52 halaman | **25 halaman** |
| Panel kode melewati batas bawah halaman | ya (2126,6 pt) | **tidak** |

Diverifikasi nyata di local (server boot + `curl`) untuk **keempat** endpoint dokumen: header
`content-disposition`/`content-type` benar, `.md` byte-identik dengan berkas di disk, PDF tanpa
halaman kosong, dan tanpa query (atau `?download=zip`) respons JSON lama tetap utuh.

## Keputusan

Akar keempat temuan jelas, terukur, dan perbaikannya lokal (satu berkas CSS, satu primitif DS,
tiga komponen pratinjau, satu berkas renderer). Tak ada perubahan skema, endpoint, maupun
kontrak API — jadi tak ada ADR baru; ADR-0078 tetap berlaku apa adanya. **Spec & Plan
`skipped`**; dokumen ini menjadi doc-of-record perbaikannya (ADR-0020/0040).
