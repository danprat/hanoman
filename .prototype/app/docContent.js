/* docContent.js — real markdown for loka-pos's internal/docs Source of
   Truth. Keyed "cat/file". Rendered (not shown as plain text) in the
   Docs workspace, and editable. loka-pos = POS ritel + inventori,
   TypeScript · SQLite. Voice: Indonesian narrative + English technical
   vocabulary, sentence-case serif headings when rendered. */
window.HN_DOCS = {
  // ---------------- entrypoints ----------------
  "entrypoints/blueprint.md": `# loka-pos — blueprint

> **Source of Truth.** Tidak ada plan yang boleh execute melewati doc yang stale. Perbarui index dulu, baru jalankan.

**loka-pos** adalah point-of-sale ritel + inventori untuk toko kelontong dan minimarket kecil di Indonesia. Satu terminal, satu laci kas, ribuan SKU — harus tetap jalan **saat internet mati**.

## Ringkasan satu paragraf
Kasir memindai barang, sistem menghitung total + pajak, mencetak struk, dan mencatat pergerakan stok — semuanya offline-first. Sinkronisasi ke cloud terjadi di latar belakang begitu koneksi kembali.

## Tujuan MVP
Warung dan minimarket bisa **berjualan tanpa gangguan** meski jaringan tidak stabil, dengan stok yang akurat di setiap akhir hari.

## Dokumen inti
| Doc | Isi |
|---|---|
| \`entrypoints/prd.md\` | Kebutuhan produk |
| \`architecture/data-model.md\` | Skema data & event stok |
| \`adr/0002-offline-sync.md\` | Keputusan sinkronisasi offline |

## Prinsip
1. **Offline adalah default**, online adalah bonus.
2. **Stok tidak boleh diam-diam salah** — setiap perubahan adalah event.
3. Kasir tidak perlu berpikir soal teknologi.
`,

  "entrypoints/brd.md": `# Business requirements — loka-pos

## Masalah bisnis
Toko ritel kecil kehilangan penjualan setiap kali koneksi putus, dan kehilangan uang karena stok tidak pernah cocok dengan catatan.

## Peluang
Ada ratusan ribu warung yang belum terlayani POS modern karena solusi yang ada menuntut internet stabil dan hardware mahal.

## Sasaran
- Turunkan transaksi gagal akibat jaringan **ke ~0**.
- Selisih stok bulanan **< 1%**.
- Waktu tutup kasir harian **< 5 menit**.

## Batasan
- Berjalan di tablet Android kelas menengah.
- Tanpa langganan hardware khusus.
`,

  "entrypoints/prd.md": `# Product requirements — loka-pos

## Persona
- **Kasir** — cepat, sering, tidak sabar dengan loading.
- **Pemilik** — ingin laporan penjualan & stok yang benar.

## Alur utama
1. Kasir memilih/scan produk.
2. Sistem menghitung subtotal, diskon, **pajak (PPN 11%)**.
3. Pembayaran (tunai / QRIS).
4. Struk tercetak, stok berkurang, event tercatat.

## Kebutuhan fungsional (ringkas)
- [x] Katalog produk + barcode
- [x] Keranjang & diskon per-item
- [x] Perhitungan pajak
- [x] Pencatatan stok berbasis event
- [ ] Sinkronisasi multi-terminal *(lihat SPEC-139)*

## Di luar scope MVP
- Loyalty / poin
- Multi-cabang terpusat
`,

  "entrypoints/frd.md": `# Functional requirements — loka-pos

Detail perilaku tiap fitur, ditulis dalam gaya **EARS** (lihat \`requirements/acceptance-criteria-ears-standard.md\`).

## Keranjang
- WHEN kasir menambahkan item, THE SYSTEM SHALL menghitung ulang total dalam < 100ms.
- WHILE mode offline, THE SYSTEM SHALL tetap menyelesaikan transaksi dan mengantre sync.

## Pembayaran
- WHEN pembayaran tunai melebihi total, THE SYSTEM SHALL menghitung kembalian.
- IF QRIS gagal, THEN THE SYSTEM SHALL menawarkan fallback tunai tanpa membatalkan keranjang.
`,

  "entrypoints/rd.md": `# Release doc — loka-pos

## Kanal rilis
- \`develop\` → build internal harian
- \`main\` → rilis toko (tagged)

## Versi aktif
- **v0.9.2** — prod, POS + inventori dasar.

## Menuju v1.0
- Sinkronisasi multi-terminal (SPEC-139)
- Laporan tutup kasir
`,

  // ---------------- product ----------------
  "product/blueprint.md": `# Product blueprint — loka-pos

Bentuk produk: **satu layar kasir yang tenang**. Semua fungsi lanjutan (stok, laporan) ada satu tap di belakangnya, tidak pernah menghalangi jalur jual.

## Pilar
1. **Kecepatan jual** — dari scan ke struk tanpa jeda.
2. **Kebenaran stok** — event, bukan angka yang di-set manual.
3. **Ketahanan** — offline-first, sync belakangan.
`,

  "product/scope-principles.md": `# Scope principles

Aturan memutuskan apa yang masuk MVP.

- **Jalur jual suci.** Apa pun yang memperlambat scan → bayar → struk ditolak dari MVP.
- **Offline dulu.** Fitur yang hanya jalan online ditunda.
- **Satu terminal dulu.** Multi-terminal adalah fitur v1, bukan MVP.
- **Ragu? Dokumentasikan.** (Gunung Dronagiri.)
`,

  "product/onboarding.md": `# Onboarding toko

Toko baru harus bisa jualan dalam **< 15 menit**.

1. Buat toko + PIN pemilik.
2. Impor katalog (CSV) atau tambah manual.
3. Set pajak & metode bayar.
4. Mulai transaksi.

Data awal disimpan lokal; sync ke cloud otomatis saat online.
`,

  // ---------------- business ----------------
  "business/brd.md": `# Business rationale

loka-pos menargetkan segmen yang **tidak terlayani**: warung & minimarket yang gagal pakai POS berbasis cloud karena jaringan.

## Model
- Freemium: satu terminal gratis.
- Berbayar: multi-terminal, laporan lanjutan, backup cloud.
`,

  "business/pricing-rationale.md": `# Pricing rationale

Harga harus **di bawah rasa sakit** kehilangan penjualan akibat downtime.

| Tier | Harga | Untuk |
|---|---|---|
| Warung | Gratis | 1 terminal |
| Toko | Rp99k/bln | multi-terminal + laporan |
| Jaringan | custom | multi-cabang |
`,

  // ---------------- requirements ----------------
  "requirements/prd.md": `# PRD (detail)

Turunan dari \`entrypoints/prd.md\`, dengan kriteria terukur per fitur. Lihat \`frd.md\` untuk perilaku dan \`acceptance-criteria-ears-standard.md\` untuk format.
`,

  "requirements/frd.md": `# FRD (detail)

Spesifikasi fungsional lengkap tiap modul: katalog, keranjang, pembayaran, stok, laporan. Setiap klausa memakai bentuk EARS dan tertaut ke test.
`,

  "requirements/rd.md": `# Requirements — rekap

Tautan silang antara kebutuhan bisnis (\`business/brd.md\`), produk (\`entrypoints/prd.md\`), dan arsitektur (\`architecture/*\`). Menjaga jejak dari "kenapa" ke "bagaimana".
`,

  "requirements/acceptance-criteria-ears-standard.md": `# Acceptance criteria — standar EARS

Semua kriteria ditulis dalam **EARS** (Easy Approach to Requirements Syntax).

## Pola
- **Ubiquitous** — THE SYSTEM SHALL ...
- **Event-driven** — WHEN <pemicu>, THE SYSTEM SHALL ...
- **State-driven** — WHILE <keadaan>, THE SYSTEM SHALL ...
- **Unwanted** — IF <kondisi>, THEN THE SYSTEM SHALL ...
- **Optional** — WHERE <fitur>, THE SYSTEM SHALL ...

## Contoh
> WHEN kasir menekan *Bayar* dalam mode offline, THE SYSTEM SHALL menyimpan transaksi lokal dan menandainya \`pending-sync\`.
`,

  // ---------------- research (unlinked) ----------------
  "research/market-sizing.md": `# Market sizing

> ⚠️ Kategori ini **belum ter-index** dari Source of Truth.

Estimasi kasar TAM/SAM/SOM untuk POS warung & minimarket di Indonesia. Perlu divalidasi dengan data lapangan sebelum di-link.
`,

  "research/competitor-analysis.md": `# Competitor analysis

Perbandingan solusi POS yang ada — kekuatan, celah offline, dan harga. **Draft, belum ter-link.**
`,

  "research/moat.md": `# Moat

Keunggulan bertahan loka-pos: **arsitektur offline-first** dan model event stok yang sulit ditiru tanpa menulis ulang. Draft.
`,

  // ---------------- architecture ----------------
  "architecture/stack.md": `# Tech stack

| Lapis | Pilihan | Alasan |
|---|---|---|
| Client | TypeScript + React | tim familiar, tooling matang |
| Local DB | **SQLite** | embedded, andal offline |
| Sync | log event → cloud | rekonsiliasi deterministik |
| Cloud | Postgres | agregasi lintas toko |

Semua state kasir hidup di SQLite lokal; cloud adalah cermin, bukan sumber.
`,

  "architecture/data-model.md": `# Data model

Model inti berputar pada **event stok yang immutable** — bukan kolom kuantitas yang di-overwrite.

## Entitas
- **Product** — \`id\`, \`sku\`, \`name\`, \`price\`, \`taxRate\`
- **StockEvent** — \`id\`, \`productId\`, \`delta\`, \`reason\`, \`ts\`, \`terminalId\`
- **Sale** — \`id\`, \`lines[]\`, \`total\`, \`paidWith\`, \`ts\`, \`syncState\`

## Kuantitas = agregat event
\`\`\`sql
SELECT product_id, SUM(delta) AS on_hand
FROM stock_event
GROUP BY product_id;
\`\`\`

## Kenapa event, bukan angka
Kuantitas yang di-set langsung **menyembunyikan penyebab** selisih. Event memberi jejak audit dan membuat sync lintas terminal bisa direkonsiliasi (lihat \`adr/0001-inventory-events.md\`).

> Kaitan ke QA: **SPEC-139** — dua terminal mengedit SKU sama secara offline saling menimpa. Model event adalah fondasi solusinya.
`,

  "architecture/api-contract.md": `# API contract

Endpoint sync (client → cloud). Semua idempotent by \`eventId\`.

## POST /sync/events
Kirim batch event lokal yang \`pending\`.
\`\`\`json
{ "terminalId": "t-01", "events": [ { "id": "e_123", "type": "stock", "delta": -1 } ] }
\`\`\`

## Respons
\`\`\`json
{ "accepted": ["e_123"], "conflicts": [] }
\`\`\`
`,

  "architecture/nfr.md": `# Non-functional requirements

- **Latency jual** — scan → total < 100ms.
- **Ketahanan** — 100% transaksi selesai saat offline.
- **Durabilitas** — 0 kehilangan event setelah sync sukses.
- **Perangkat** — tablet Android 4GB RAM.
`,

  // ---------------- adr ----------------
  "adr/0001-inventory-events.md": `# ADR 0001 — Inventori berbasis event

**Status:** accepted

## Konteks
Stok harus akurat, dapat diaudit, dan bisa direkonsiliasi lintas terminal offline.

## Keputusan
Simpan setiap perubahan stok sebagai **event immutable**; kuantitas dihitung sebagai \`SUM(delta)\`.

## Konsekuensi
- (+) Jejak audit penuh, rekonsiliasi deterministik.
- (−) Query kuantitas perlu agregasi / cache.
`,

  "adr/0002-offline-sync.md": `# ADR 0002 — Sinkronisasi offline

**Status:** accepted

## Konteks
Jaringan tidak dapat diandalkan; kasir tidak boleh menunggu server.

## Keputusan
**Offline-first.** Tulis ke SQLite lokal, antre event, sync di latar belakang saat online. Resolusi konflik: **last-write per event + append**, bukan overwrite baris.

## Konsekuensi
- (+) Nol downtime jual.
- (−) Butuh strategi konflik eksplisit (dikerjakan di SPEC-139).
`,

  // ---------------- operations ----------------
  "operations/roadmap.md": `# Roadmap

- **v0.9** — POS + inventori event (sekarang)
- **v1.0** — sinkronisasi multi-terminal, laporan tutup kasir
- **v1.1** — backup cloud, multi-cabang
`,

  "operations/gtm.md": `# Go-to-market

Kanal awal: komunitas warung & distributor lokal. Pesan inti: **"tetap jualan walau internet mati."**
`,

  "operations/agent-documentation-workflow.md": `# Agent documentation workflow

Kontrak untuk hanoman + Claude Code di repo ini.

- Docs di \`internal/docs/**\` adalah **Source of Truth**.
- Sebelum plan execute: **Update the index. Link every doc.**
- Setiap fitur: *spec → plan → execute*. Setiap QA: *audit → spec → plan → execute*.
- Stop hook **memblokir** plan jika doc acuannya stale.
`,

  // ---------------- security (unlinked) ----------------
  "security/security-standard.md": `# Security standard

> ⚠️ Belum ter-index dari Source of Truth.

- PIN pemilik untuk aksi sensitif (void, refund).
- Data lokal terenkripsi at-rest.
- Token sync berumur pendek, di-rotate.

Perlu ditinjau & di-link sebelum menyentuh alur pembayaran.
`,

  // ---------------- brand (unlinked) ----------------
  "brand/brand-strategy.md": `# Brand strategy

> ⚠️ Belum ter-index.

loka-pos = **andal, membumi, cepat**. Nada bicara lugas seperti pedagang, bukan startup.
`,

  "brand/color.md": `# Color

Draft palet — hangat, kontras tinggi untuk terbaca di bawah lampu toko. Belum ter-link.
`,

  "brand/pattern-system.md": `# Pattern system

Komponen UI kasir yang berulang: tombol besar, angka besar, target sentuh ≥ 44px. Draft.
`,

  // ---------------- frontend ----------------
  "frontend/frontend-implementation.md": `# Frontend implementation

- React + TypeScript, state kasir di store lokal yang disokong SQLite.
- Layar kasir dioptimalkan untuk sentuh: target ≥ 44px, angka besar.
- Semua aksi optimistik; sync di-handle di worker.
`,

  // ---------------- design-system ----------------
  "design-system/design-system.md": `# Design system (loka-pos)

Token & komponen kasir: tipografi besar, kontras tinggi, warna semantik untuk status sync (\`pending\` / \`synced\` / \`conflict\`).
`,

  "design-system/implementation-plan.md": `# Implementation plan

Urutan penerapan design system ke layar kasir, keranjang, dan laporan. Tertaut ke \`frontend/frontend-implementation.md\`.
`,

  // ---------------- agents & config (repo root) ----------------
  "agents/AGENTS.md": `# AGENTS.md

Kontrak untuk **setiap agent** (Claude Code, Codex, dll) yang bekerja di repo ini. Dibaca otomatis sebelum agent mengeksekusi apa pun.

## Aturan utama
1. **Docs adalah Source of Truth.** \`internal/docs/**\` menang atas ingatan atau asumsi. Ragu → baca doc, jangan menebak.
2. **Jangan execute melewati docs yang stale.** Kalau doc acuan usang, perbarui index dulu (Stop hook akan memblokir bila dilanggar).
3. **Alur fitur:** spec → plan → execute. **Alur QA:** audit → spec → plan → execute.
4. **Setiap perubahan menyentuh docs** yang relevan dan menautkannya di index.

## Perintah
\`\`\`bash
hanoman spec SPEC-xxx      # tulis spec dari brief/finding
hanoman plan SPEC-xxx      # rencanakan langkah
hanoman execute SPEC-xxx   # jalankan + test + update docs
\`\`\`

## Batas
- Jangan menyentuh alur pembayaran tanpa review manusia.
- Jangan menghapus event stok — hanya menambah (lihat \`architecture/adr/0001\`).
`,

  "agents/CLAUDE.md": `# CLAUDE.md

Instruksi khusus **Claude Code** untuk loka-pos. Melengkapi \`AGENTS.md\`.

## Konteks proyek
POS ritel + inventori, offline-first. TypeScript · SQLite di client, Postgres di cloud.

## Kebiasaan yang diharapkan
- Tulis test untuk setiap perubahan logika stok/pembayaran.
- Jaga jalur jual < 100ms — jangan tambah blocking I/O di path scan → struk.
- Update \`internal/docs\` yang tersentuh **dalam commit yang sama**.

## Jangan
- Jangan mengubah skema tanpa migration + ADR.
- Jangan commit langsung ke \`main\` — selalu lewat plan → execute.
`,

  "agents/README.md": `# loka-pos

POS ritel + inventori yang **tetap jualan saat internet mati**.

## Mulai
\`\`\`bash
pnpm install
pnpm dev
\`\`\`

## Struktur
- \`src/\` — aplikasi kasir (React + TypeScript)
- \`internal/docs/\` — **Source of Truth** (docs yang mengendalikan build)
- \`.claude/\`, \`.codex/\` — konfigurasi agent & hooks

## Dokumentasi
Semua keputusan hidup di \`internal/docs/\`. Baca \`internal/docs/README.md\` lebih dulu.
`,

  "agents/.claude/settings.json": `{
  "permissions": {
    "allow": ["Bash(pnpm *)", "Read", "Edit", "Write"],
    "deny": ["Bash(rm -rf *)", "Edit(src/payments/**)"]
  },
  "hooks": {
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "hanoman docs verify --block-if-stale" }
        ]
      }
    ]
  },
  "model": "claude-sonnet-4.5",
  "sourceOfTruth": "internal/docs"
}
`,

  "agents/.codex/config.toml": `# .codex/config.toml — konfigurasi Codex untuk loka-pos

model = "gpt-5-codex"
source_of_truth = "internal/docs"

[guardrails]
block_on_stale_docs = true
require_doc_links = true

[workflow]
feature = ["spec", "plan", "execute"]
qa = ["audit", "spec", "plan", "execute"]

[permissions]
deny = ["src/payments/**"]
`,
};
