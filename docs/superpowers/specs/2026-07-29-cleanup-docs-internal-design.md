# SPEC-386 — Cleanup docs internal SoT

- Status: disetujui (2026-07-29)
- Sumber: brief · prioritas tinggi
- Objective: **docs internal SoT terjaga kebersihannya**

## Masalah

`internal/docs/**` sudah **terlalu penuh dan jenuh**. Terukur di worktree ini:

| Metrik | Nilai |
|---|---|
| Total | 140 berkas · 734 KB |
| Index `README.md` | **46,6 KB** |
| ↳ seksi `## adr` | 23,9 KB (**51%** index) — 82 entri berparagraf panjang |
| ↳ seksi `## research` | 20,2 KB (**43%** index) — 27 entri audit berparagraf panjang |
| ↳ 12 kategori doc produk/arsitektur sisanya | ±2,5 KB (**5%**) |
| Dokumen audit `research/audit-spec-*.md` | 27 berkas · 115 KB |
| Stub 3-baris sisa scaffold | 7 berkas |
| Link internal rusak | 1 |
| Doc yatim (tak reachable dari index) | 0 |

Dua gejala berbeda, dua penyebab berbeda:

1. **Pintu masuk terlalu berat.** `internal/docs/README.md` adalah doc pertama yang dibaca **setiap**
   sesi agen (`AGENTS.md` → `SKILL.md` → index). 94% isinya adalah changelog ADR + abstrak audit —
   bahan rujukan, bukan bahan orientasi. Biaya ini dibayar tiap sesi, oleh setiap agen.
2. **Artefak diagnosis tak pernah pensiun.** ADR-0057 menetapkan flow audit menghasilkan dokumen
   `internal/docs/research/audit-<spec-id>-<slug>.md` sebagai deliverable, tapi **tak pernah
   menetapkan kapan dokumen itu berhenti relevan**. Hasilnya 27 laporan bug yang seluruhnya sudah
   ditindaklanjuti — perbaikannya sudah landed, keputusannya sudah jadi ADR — masih menghuni SoT dan
   masih menyeret 20,2 KB abstrak di index.

Yang **bukan** masalah: isi doc arsitektur. Pemeriksaan `dailyBudget`, `phaseModels`, `DocFile`,
`Redis`/`BullMQ`, `webhook` menemukan semua penyebutannya benar — ditulis sebagai "sudah dicabut",
bukan klaim basi. Docs ini terpelihara; yang berlebih adalah volumenya.

## Batasan yang mengikat desain

- **ADR tak boleh dihapus.** `internal/docs/README.md` dan ADR-0021: *"Nomor unik & imutable. ADR
  usang tidak dihapus — ditandai statusnya."* 82 ADR (massa terbesar) karena itu di luar jangkauan
  penghapusan; yang boleh dipangkas adalah **jejaknya di index**, bukan berkasnya.
- **Dokumen audit dibaca runtime.** `services/spec-docs.ts` mengklasifikasi path ber-`/research/audit-`
  sebagai `kind: "audit"`; `services/audit-escalation.ts` membacanya untuk `GET /api/specs/:id/escalation`
  (ADR-0076). Keduanya **dinamis** — tak ada daftar berkas yang di-hardcode, jadi penghapusan tak
  memecahkan kode. Yang hilang hanyalah riwayat untuk spec bersangkutan (semuanya sudah tuntas).
- **Coverage bersifat per-kategori dan berbasis reachability.** `shared/src/coverage.ts`:
  `linkedSetFrom` melakukan **BFS atas graf link** mulai dari index, jadi doc yang reachable lewat
  **sub-index** tetap terhitung `linked` — sudah dijaga test (`cli/test/index-link.cmd.test.ts`
  "leaves docs already reachable through a sub-index alone", `server/test/scan.test.ts`).
- **`entrypoints/` tidak disentuh** (keputusan manusia): duplikasi `entrypoints/*` ↔ `business|requirements|product`
  memang ada, tapi di luar scope spec ini supaya diff tetap bisa di-review manusia.

## Keputusan

### 1. Index dipecah — narasi ADR pindah ke sub-index

`internal/docs/adr/README.md` (baru) menerima seksi `## adr` **verbatim**: 82 entri berikut paragraf
panjang, catatan supersede, dan sisipan "Diperluas SPEC-385". Seksi `## adr` di index utama menyusut
jadi satu baris per ADR: `- [NNNN — Judul](adr/NNNN-slug.md)` + penanda status untuk yang usang.

Alasan memindahkan alih-alih meringkas: narasinya **bernilai** — ia merekam relasi antar-ADR
(memperluas/mencabut/mengamandemen) yang tak ada di berkas ADR mana pun secara terkumpul. Yang salah
bukan isinya, melainkan letaknya di pintu masuk.

Hasil: index utama **46,6 KB → ±9 KB**.

### 2. 27 dokumen audit dihapus + aturan retensi (ADR-0083)

Hapus seluruh `internal/docs/research/audit-spec-*.md` (27 berkas · 115 KB) berikut 27 entri index.

Penghapusan tanpa aturan hanya menunda masalah — seksi `research` akan penuh lagi dalam beberapa
puluh audit. Karena itu disertai **ADR-0083** yang menetapkan **retensi dokumen audit**:

> Dokumen audit adalah **artefak diagnosis berumur**, bukan Source of Truth abadi. Ia hidup sejak
> fase Laporan menulisnya sampai eskalasinya diputuskan (ADR-0076) **dan** spec turunannya tuntas.
> Sesudah itu ia boleh dihapus dalam commit cleanup. Yang abadi adalah **ADR** yang lahir darinya,
> perbaikan kodenya, dan riwayat git.

ADR ini **membatasi ADR-0057** (yang menetapkan dokumen audit sebagai deliverable tanpa menyebut
akhir hidupnya) dan menyentuh prinsip *Chiranjivi* secara sadar: yang dijanjikan abadi adalah
**keputusan**, bukan setiap catatan kerja yang mengantar ke keputusan itu.

Konsekuensi yang diterima: `GET /api/specs/:id/escalation` membalas `null` dan preview "doc audit" di
detail spec kosong untuk 27 spec lama — semuanya sudah closed, jadi tak ada konsumen hidup.

### 3. Tujuh stub diisi jadi doc sungguhan

Stub 3-baris melanggar standar yang hanoman sendiri terapkan ke project lain
(`runner/src/reverse-standard.ts`: *"Isi doc harus lengkap dan spesifik terhadap repo ini — bukan
kerangka, bukan lorem, bukan tebakan"*). Ketujuhnya **diisi**, bukan dihapus, supaya kategori
`business`/`requirements`/`research` tetap punya isi nyata:

| Doc | Isi yang ditulis |
|---|---|
| `research/market-sizing.md` | Sizing = **kapasitas**, bukan pasar: batas nyata mesin (cap sesi konkuren `SCHEDULER_DEFAULTS.maxConcurrent = 2`, satu suite penuh = 258 berkas test + 6 proses `tsc`, alasan `verifyScope=changed` ADR-0080), jumlah project & backlog yang ditargetkan |
| `research/competitor-analysis.md` | Pembanding nyata 2026: `claude`/`codex` CLI manual per repo, CI generik, dan orkestrator agen lain; celah yang hanoman isi |
| `research/moat.md` | Keunggulan bertahan: kombinasi SoT + isolasi worktree + sesi hidup di tmux + sinkron hub↔client |
| `business/pricing-rationale.md` | Biaya = token model, **estimasi** (ADR-0012): kendali lewat model & effort per sesi (katalog `MODELS`/`CODEX_MODELS`), dua sumber limit terpisah (claude live 30 dtk vs codex snapshot `stale` >12 jam), tanpa budget guardrail |
| `operations/gtm.md` | Adopsi internal + kriteria sukses terukur; repo publik/open-source sebagai jalur distribusi (`hanoman-sdk` di npm, ADR-0063) |
| `requirements/frd.md` | FRD detail EARS per modul: Overview, Projects, PRD, Backlog, Terminal, Docs, IDE, Errors, Help Desk/Triase, Scheduler, VPS, Settings |
| `requirements/rd.md` | Release doc detail: identitas versi = git SHA (ADR-0048), kanal, prosedur rilis/deploy, kriteria rilis |

### 4. Perbaikan integritas

`architecture/stack.md` menaut `adr/0072-…` dari dalam `architecture/` — kurang `../`. Diperbaiki.

## Verifikasi

Perubahan ini **murni `.md`** — tak ada berkas `.ts`/`.tsx` tersentuh, sehingga
`pnpm vitest --run --changed "$HANOMAN_BASE_SHA"` akan melaporkan **nol test dan tetap hijau**
(`passWithNoTests`, gotcha ADR-0080). Nol test **tidak diterima sebagai bukti**. Gantinya:

1. **Link checker** — setiap link relatif di seluruh `internal/docs/**` resolve ke berkas yang ada.
   Target: 0 rusak (dari 1).
2. **Reachability** — `linkedSetFrom` dari `shared/src/coverage.ts` dijalankan langsung (dep-free,
   tanpa boot DB/server) atas korpus `git ls-files internal/docs`. Target: 0 doc yatim, dan
   khususnya seluruh 82 ADR tetap reachable **lewat sub-index**.
3. **`hanoman docs index --check`** — exit 0.
4. **Test yang menjaga mesin index/coverage** dijalankan meski tak ada kodenya yang berubah, karena
   desain ini bersandar pada perilaku sub-index mereka: `shared/test/coverage.test.ts`,
   `cli/test/docs-model.test.ts`, `cli/test/index-link.cmd.test.ts`, `server/test/scan.test.ts`.

Tidak ada boot server + curl: tak ada endpoint yang tersentuh.

## Di luar scope

- Menghapus/menggabung ADR — dilarang konvensi (ADR-0021).
- Menyatukan `entrypoints/*` dengan `business|requirements|product` — keputusan manusia: ditunda.
- Mengubah `runner/src/reverse-standard.ts` — itu standar untuk project **lain**, bukan cermin wajib
  struktur hanoman.
- Perubahan skema, endpoint, atau migration — tak ada.
