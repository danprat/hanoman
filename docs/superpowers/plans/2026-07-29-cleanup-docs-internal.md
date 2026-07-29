# Cleanup docs internal SoT — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `internal/docs/**` berhenti jadi arsip — pintu masuknya (index) ringan lagi, artefak diagnosis yang sudah selesai tugasnya dihapus dengan aturan retensi yang tertulis, dan tak ada lagi doc kerangka kosong.

**Architecture:** Empat gerakan terpisah yang masing-masing bisa di-review sendiri: (1) narasi 82 ADR pindah dari index utama ke sub-index `internal/docs/adr/README.md` — reachability tetap utuh karena coverage memakai BFS atas graf link, bukan daftar datar; (2) 27 dokumen audit yang spec-nya sudah tuntas dihapus; (3) aturan retensi dokumen audit ditulis sebagai ADR-0083 agar tak menumpuk lagi; (4) tujuh stub 3-baris diisi jadi doc nyata. Tak ada kode aplikasi yang berubah.

**Tech Stack:** Markdown · `shared/src/coverage.ts` (`linkedSetFrom`, BFS graf link, dep-free) · `cli` `hanoman docs index --check` (via `tsx`) · vitest.

## Global Constraints

- **ADR tak boleh dihapus atau dinomori ulang.** ADR-0021 + `internal/docs/README.md`: *"Nomor unik & imutable. ADR usang tidak dihapus — ditandai statusnya."*
- **Nomor ADR baru yang diklaim spec ini: `0083`.** Terverifikasi bebas lintas semua branch lokal+remote (tertinggi 0082) dan tak ada reservasi di worktree tetangga.
- **`entrypoints/**` tidak disentuh** — keputusan manusia, di luar scope.
- **`runner/src/reverse-standard.ts` tidak disentuh** — itu standar untuk project lain.
- **Tak ada perubahan skema, endpoint, migration, atau kode aplikasi.** Bila sebuah langkah terasa menuntutnya, berhenti dan tanyakan.
- **Docs yang tersentuh diperbarui + ter-link dalam commit yang sama** (konvensi SoT, ADR-0023).
- Perintah verifikasi dijalankan dari **root worktree** `/Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-386`.
- Selalu `env -u NODE_ENV -u DATABASE_URL` di depan perintah vitest — shell mesin ini menunjuk prod dan mencemari test.

## Baseline terukur (sebelum perubahan)

| | |
|---|---|
| korpus `internal/docs` | 140 berkas · 734 KB |
| `internal/docs/README.md` | 46 620 B — `## adr` 23 940 B · `## research` 20 196 B |
| link rusak | 1 |
| doc yatim | 0 |
| ADR reachable | 82/82 |

---

### Task 1: Harness verifikasi + perbaiki link rusak

**Files:**
- Create: `<scratchpad>/check-docs.ts` (berkas kerja, **tidak** di-commit)
- Modify: `internal/docs/architecture/stack.md` (baris yang menaut `adr/0072-…`)

**Interfaces:**
- Consumes: `linkedSetFrom(indexRel, docs, read)` dari `shared/src/coverage.ts` — BFS graf link, mengembalikan `Set<string>` doc yang reachable.
- Produces: perintah `node <scratchpad>/check-docs.ts` yang dipakai **setiap task berikutnya** sebagai gerbang; exit 0 = 0 link rusak + 0 doc yatim + semua ADR reachable.

- [ ] **Step 1: Tulis harness verifikasi**

Simpan sebagai `<scratchpad>/check-docs.ts` (ganti `<REPO>` dengan path absolut worktree):

```ts
// SPEC-386 · verifikasi integritas internal/docs — dep-free, tanpa boot DB/server.
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { linkedSetFrom } from "<REPO>/shared/src/coverage.ts";

const INDEX = "internal/docs/README.md";
const docs = execSync("git ls-files internal/docs").toString().trim().split("\n").filter(Boolean);

const broken: string[] = [];
for (const f of docs) {
  const md = readFileSync(f, "utf8");
  for (const m of md.matchAll(/\]\(([^)]+)\)/g)) {
    const t = m[1]!.trim().split(/\s+/)[0]!.split("#")[0]!;
    if (!t || /^(https?:|mailto:|#)/.test(t)) continue;
    const rel = new URL(t, "file:///" + f).pathname.slice(1);
    if (!existsSync(decodeURIComponent(rel))) broken.push(`${f} -> ${t}`);
  }
}

const read = (rel: string) => (existsSync(rel) ? readFileSync(rel, "utf8") : null);
const linked = linkedSetFrom(INDEX, docs, read);
const orphans = docs.filter((d) => d !== INDEX && !linked.has(d));

console.log(`korpus       : ${docs.length} berkas`);
console.log(`link rusak   : ${broken.length}`);
broken.forEach((b) => console.log(`  ✗ ${b}`));
console.log(`doc yatim    : ${orphans.length}`);
orphans.forEach((o) => console.log(`  ✗ ${o}`));
const adr = docs.filter((d) => /^internal\/docs\/adr\/\d{4}-/.test(d));
console.log(`ADR reachable: ${adr.filter((a) => linked.has(a)).length}/${adr.length}`);
process.exit(broken.length + orphans.length === 0 && adr.every((a) => linked.has(a)) ? 0 : 1);
```

Catatan: `git ls-files` hanya melihat berkas **ter-track**. Berkas baru (`adr/README.md`, `adr/0083-*.md`) harus di-`git add` dulu agar ikut terperiksa — itu disengaja, supaya yang diverifikasi adalah yang akan ter-commit.

- [ ] **Step 2: Jalankan — harus MERAH**

```bash
node <scratchpad>/check-docs.ts; echo "exit=$?"
```

Expected:
```
korpus       : 140 berkas
link rusak   : 1
  ✗ internal/docs/architecture/stack.md -> adr/0072-scheduler-fondasi-engine-antrean-durable-cap.md
doc yatim    : 0
ADR reachable: 82/82
exit=1
```

- [ ] **Step 3: Perbaiki linknya**

Di `internal/docs/architecture/stack.md`, link itu ditulis dari dalam `architecture/` sehingga `adr/…` resolve ke `internal/docs/architecture/adr/…`. Tambahkan `../`:

```
(adr/0072-scheduler-fondasi-engine-antrean-durable-cap.md)
```
menjadi
```
(../adr/0072-scheduler-fondasi-engine-antrean-durable-cap.md)
```

- [ ] **Step 4: Jalankan lagi — harus HIJAU**

```bash
node <scratchpad>/check-docs.ts; echo "exit=$?"
```

Expected: `link rusak   : 0`, `doc yatim    : 0`, `ADR reachable: 82/82`, `exit=0`.

- [ ] **Step 5: Commit**

```bash
git add internal/docs/architecture/stack.md
git commit -m "docs(spec-386): perbaiki link relatif stack.md ke ADR-0072"
```

---

### Task 2: Narasi ADR pindah ke sub-index `adr/README.md`

**Files:**
- Create: `internal/docs/adr/README.md`
- Modify: `internal/docs/README.md` (seksi `## adr`, saat ini baris 57–141)

**Interfaces:**
- Consumes: harness Task 1.
- Produces: `internal/docs/adr/README.md` sebagai **sub-index** — satu-satunya tempat narasi panjang ADR; index utama menautnya dan doc-doc ADR jadi reachable **lewat** berkas ini. Task 4 menambahkan entri ADR-0083 ke **dua** berkas ini.

**Kenapa ini aman:** `cli/src/docs-model.ts:16-18` sudah menyebut pola ini secara harfiah — *"README ikut korpus: `linkedSetFrom` hanya menelusuri link yang targetnya ada di korpus, jadi sub-index (`adr/README.md`) harus ada di sini agar bisa ditelusuri."* Dan `cli/test/index-link.cmd.test.ts` menjaga perilaku `--fix` untuk doc yang sudah reachable lewat sub-index.

- [ ] **Step 1: Buat `internal/docs/adr/README.md`**

Pindahkan **verbatim** seluruh isi seksi `## adr` dari `internal/docs/README.md` (blockquote pembuka + 82 entri + sisipan `> Diperluas SPEC-385`), dengan **dua penyesuaian path** karena berkas ini hidup di `internal/docs/adr/`:

- link `](adr/NNNN-slug.md)` → `](NNNN-slug.md)`
- link ke kategori lain, mis. `](frontend/frontend-implementation.md)` → `](../frontend/frontend-implementation.md)`

Header berkas:

```markdown
# ADR — index & riwayat keputusan

Sub-index dari [internal/docs/README.md](../README.md). Index utama menyimpan daftar satu-baris;
berkas ini menyimpan **narasi** tiap keputusan: apa yang diperluas, dicabut, atau diamandemen, dan
gotcha yang harus diingat. Nomor unik & imutable — ADR usang tidak dihapus, hanya ditandai statusnya
(ADR-0021).

> Nomor unik & imutable. ADR usang tidak dihapus — ditandai statusnya di bawah dan di header masing-masing.
```

lalu 82 entri, urut turun 0082 → 0001, apa adanya.

- [ ] **Step 2: Ringkas seksi `## adr` di index utama**

Ganti seluruh seksi `## adr` di `internal/docs/README.md` dengan:

```markdown
## adr
> Nomor unik & imutable. ADR usang tidak dihapus — ditandai statusnya.
> **Narasi lengkap tiap keputusan (apa yang diperluas/dicabut/diamandemen + gotcha-nya) ada di
> [adr/README.md](adr/README.md).** Daftar di bawah sengaja satu baris per ADR: index ini dibaca
> setiap sesi agen, sub-index hanya saat butuh riwayat.
- [0083 — …](adr/0083-….md)   ← ditambahkan di Task 4
- [0082 — Kontrak apply changefeed: record tertunda, kursor tak melompat, tarik ulang penuh](adr/0082-kontrak-apply-changefeed-record-tertunda.md)
…
- [0001 — Docs sebagai Source of Truth](adr/0001-docs-as-source-of-truth.md) — *superseded by 0023*
```

Aturan menulis tiap baris: `- [NNNN — <judul ADR apa adanya>](adr/<slug>.md)` + **hanya** penanda status untuk ADR usang (`— *superseded by NNNN*`, `— *de-facto obsolete (NNNN)*`, `— *historis per NNNN*`, `— *mekanisme superseded by NNNN*`). Semua prosa lain dibuang dari sini — ia sudah pindah ke sub-index.

- [ ] **Step 3: Verifikasi reachability lewat sub-index**

```bash
git add internal/docs/adr/README.md internal/docs/README.md
node <scratchpad>/check-docs.ts; echo "exit=$?"
```

Expected: `korpus : 141 berkas`, `link rusak : 0`, `doc yatim : 0`, `ADR reachable: 82/82`, `exit=0`.

Ini bukti yang penting: 82 ADR tetap reachable **padahal index utama tak lagi memuat narasinya** — berarti BFS memang menembus sub-index.

- [ ] **Step 4: Verifikasi dengan CLI resmi**

```bash
pnpm --filter ./cli exec tsx src/hanoman.ts docs index --check
```

Expected: `index ok`

- [ ] **Step 5: Ukur hasilnya**

```bash
wc -c internal/docs/README.md internal/docs/adr/README.md
```

Expected: `README.md` turun dari 46 620 B ke kisaran **25–28 KB** (seksi `research` masih utuh di tahap ini), `adr/README.md` di kisaran **24 KB**.

- [ ] **Step 6: Commit**

```bash
git add internal/docs/README.md internal/docs/adr/README.md
git commit -m "docs(spec-386): narasi 82 ADR pindah ke sub-index adr/README.md"
```

---

### Task 3: Hapus 27 dokumen audit yang sudah tuntas

**Files:**
- Delete: `internal/docs/research/audit-spec-{217,223,227,229,230,242,244,245,255,258,262,265,267,271,275,286,289,291,293,330,341,351,352,363,377,382,383}-*.md`
- Modify: `internal/docs/README.md` (seksi `## research`, saat ini baris 19–47)

**Interfaces:**
- Consumes: harness Task 1.
- Produces: seksi `## research` yang hanya memuat 3 doc riset + satu baris kebijakan yang menunjuk ADR-0083 (ditulis di Task 4).

**Kenapa penghapusan tak memecahkan apa pun:** `services/spec-docs.ts:19` mengklasifikasi audit lewat **pola path** (`p.includes("/research/audit-")`), dan `services/audit-escalation.ts` mencari dokumennya lewat `listSpecDocs` saat request — tak ada daftar berkas ter-hardcode di kode maupun test. Yang berubah: `GET /api/specs/:id/escalation` membalas `null` dan preview "doc audit" kosong untuk 27 spec lama; semuanya sudah closed.

- [ ] **Step 1: Catat ledger sebelum menghapus**

Untuk tiap dari 27 dokumen, catat **jejak permanennya** (ADR yang lahir darinya, atau doc SoT/kode yang memuat perbaikannya) dari entri index yang ada sekarang. Ledger ini masuk ke ADR-0083 di Task 4 — itulah yang membuat penghapusan bisa diaudit belakangan. Salin dulu ke berkas kerja:

```bash
sed -n '/^## research/,/^## architecture/p' internal/docs/README.md > <scratchpad>/research-section.md
wc -l <scratchpad>/research-section.md
```

- [ ] **Step 2: Hapus berkasnya**

```bash
git rm internal/docs/research/audit-spec-*.md
git status --porcelain | grep -c '^D ' # Expected: 27
```

- [ ] **Step 3: Rapikan seksi `## research` di index**

Ganti seluruh seksi dengan:

```markdown
## research
- [market-sizing](research/market-sizing.md) · [competitor-analysis](research/competitor-analysis.md) · [moat](research/moat.md)

> **Dokumen audit tidak diarsipkan di sini.** Laporan `research/audit-<spec>-<slug>.md` yang ditulis flow
> audit (ADR-0057) berumur: ia hidup sampai eskalasinya diputuskan dan spec turunannya tuntas, lalu
> dihapus — lihat [ADR-0083](adr/0083-retensi-dokumen-audit.md). Yang permanen adalah ADR yang lahir
> darinya. 27 laporan dari SPEC-217…383 dihapus di SPEC-386; ledger jejaknya ada di ADR-0083.
```

(Link ke `adr/0083-…` sengaja ditulis sekarang; ia akan **rusak sampai Task 4 membuat berkasnya** — itu wajar dan akan tertangkap harness. Bila kamu memilih menjalankan harness di akhir Step 4 saja, catat alasannya.)

- [ ] **Step 4: Verifikasi — link ke ADR-0083 masih MERAH, sisanya bersih**

```bash
git add -A internal/docs
node <scratchpad>/check-docs.ts; echo "exit=$?"
```

Expected: `korpus : 114 berkas`, `link rusak : 1` (hanya `README.md -> adr/0083-retensi-dokumen-audit.md`), `doc yatim : 0`, `ADR reachable: 82/82`, `exit=1`.

Ini MERAH yang disengaja — ia jadi test yang menuntun Task 4.

- [ ] **Step 5: Commit**

```bash
git add -A internal/docs
git commit -m "docs(spec-386): hapus 27 dokumen audit yang spec-nya sudah tuntas"
```

---

### Task 4: ADR-0083 — retensi dokumen audit

**Files:**
- Create: `internal/docs/adr/0083-retensi-dokumen-audit.md`
- Modify: `internal/docs/adr/README.md` (tambah entri narasi 0083 di puncak daftar)
- Modify: `internal/docs/README.md` (tambah baris `- [0083 — …]` di puncak seksi `## adr`)
- Modify: `internal/docs/adr/0057-audit-only-source-flow.md` (catatan amandemen)
- Modify: `internal/docs/operations/agent-documentation-workflow.md` (aturan retensi)
- Modify: `internal/skills/hanoman/SKILL.md` (bagian "Aturan Dokumentasi & Alur")

**Interfaces:**
- Consumes: seksi `## research` Task 3 yang sudah menaut `adr/0083-retensi-dokumen-audit.md` — nama berkas ini **wajib persis** itu.
- Produces: aturan retensi yang dirujuk index, ADR-0057, workflow doc, dan skill project.

- [ ] **Step 1: Tulis ADR-0083**

`internal/docs/adr/0083-retensi-dokumen-audit.md`, mengikuti format ADR repo ini (lihat ADR-0082 sebagai contoh bentuk):

```markdown
# ADR-0083 — Retensi dokumen audit: artefak diagnosis berumur, bukan SoT abadi

- Status: Diterima (SPEC-386, 2026-07-29)
- Membatasi: ADR-0057 (audit-only sebagai source & flow)
- Terkait: ADR-0011/0018 (nilai turunan), ADR-0021 (nomor imutable), ADR-0023 (SoT konvensi), ADR-0076 (eskalasi audit)

## Konteks
[ukuran nyata: 27 laporan · 115 KB berkas · 20 196 B abstrak di index = 43% index;
ADR-0057 menetapkan dokumen audit sebagai deliverable tapi tak pernah menetapkan akhir hidupnya;
index dibaca setiap sesi agen]

## Keputusan
1. Dokumen audit `internal/docs/research/audit-<spec>-<slug>.md` adalah **artefak diagnosis berumur**.
2. Ia hidup sejak fase Laporan menulisnya sampai **eskalasinya diputuskan** (ADR-0076) **dan** spec
   turunannya tuntas. Sesudah itu boleh dihapus dalam commit cleanup, berikut entri indexnya.
3. **Syarat sebelum menghapus:** temuannya sudah meninggalkan jejak permanen — sebuah ADR, atau baris
   di doc SoT yang relevan, atau perbaikan kode yang ter-commit. Audit yang belum meninggalkan jejak
   apa pun **tidak boleh dihapus**; tulis jejaknya dulu.
4. Yang **tidak** berumur dan tetap dilarang dihapus: ADR (ADR-0021).
5. Seksi `## research` di index tidak lagi memuat abstrak audit — hanya doc riset + rujukan ke ADR ini.

## Rasional
[Chiranjivi menjanjikan keputusan yang abadi, bukan setiap catatan kerja yang mengantar ke sana;
tanpa aturan ini seksi research tumbuh selamanya karena flow audit terus memproduksinya]

## Konsekuensi
- `GET /api/specs/:id/escalation` membalas `null` dan preview "doc audit" kosong untuk spec yang
  dokumennya sudah dihapus — dinamis, tak ada kode/test yang perlu diubah.
- Riwayat penuh tetap ada di git.
- Cleanup adalah langkah **manusia/sesi cleanup**, bukan otomasi: tak ada job penghapus.

## Ledger — 27 dokumen yang dihapus di SPEC-386
| Audit | Temuan (ringkas) | Jejak permanen |
|---|---|---|
| SPEC-217 | … | … |
[27 baris, diisi dari <scratchpad>/research-section.md]
```

Bagian dalam `[…]` adalah instruksi isi, bukan teks literal — tulis prosanya.

- [ ] **Step 2: Tautkan di kedua index**

Di `internal/docs/README.md`, baris pertama daftar seksi `## adr`:
```markdown
- [0083 — Retensi dokumen audit: artefak diagnosis berumur, bukan SoT abadi](adr/0083-retensi-dokumen-audit.md)
```

Di `internal/docs/adr/README.md`, entri narasi di puncak daftar (paragraf gaya sama dengan entri 0082/0081), menaut `(0083-retensi-dokumen-audit.md)`.

- [ ] **Step 3: Catatan amandemen di ADR-0057**

Tambahkan di bawah baris Status `internal/docs/adr/0057-audit-only-source-flow.md`:
```markdown
> **Dibatasi [ADR-0083](0083-retensi-dokumen-audit.md)** (SPEC-386): dokumen audit yang dihasilkan flow
> ini **berumur** — ia boleh dihapus setelah eskalasinya diputuskan dan spec turunannya tuntas, asalkan
> temuannya sudah meninggalkan jejak permanen. Flow, pipeline, dan deliverable-nya tak berubah.
```

- [ ] **Step 4: Aturan retensi di workflow doc**

Di `internal/docs/operations/agent-documentation-workflow.md`, pada butir **Audit-only**, tambahkan kalimat penutup yang menyebut ADR-0083 + syarat jejak permanen + kewajiban ikut menghapus entri index.

- [ ] **Step 5: Aturan retensi di skill project**

Di `internal/skills/hanoman/SKILL.md`, bagian **Aturan Dokumentasi & Alur**, tambahkan butir baru sesudah butir "Nomor SPEC & ADR unik & imutable":

```markdown
- **Dokumen audit berumur, ADR tidak** (SPEC-386/ADR-0083): laporan
  `internal/docs/research/audit-<spec>-<slug>.md` hidup sampai eskalasinya diputuskan (ADR-0076) dan
  spec turunannya tuntas, lalu **dihapus berikut entri indexnya** — syaratnya temuannya sudah
  meninggalkan jejak permanen (ADR, baris di doc SoT, atau perbaikan kode ter-commit). Index
  `internal/docs/README.md` **tidak** menyimpan abstrak audit. Narasi 82 ADR hidup di sub-index
  `internal/docs/adr/README.md`; index utama hanya satu baris per ADR — ia dibaca setiap sesi.
```

- [ ] **Step 6: Verifikasi — harus HIJAU lagi**

```bash
git add -A internal/docs internal/skills
node <scratchpad>/check-docs.ts; echo "exit=$?"
pnpm --filter ./cli exec tsx src/hanoman.ts docs index --check
```

Expected: `korpus : 115 berkas`, `link rusak : 0`, `doc yatim : 0`, `ADR reachable: 83/83`, `exit=0`, lalu `index ok`.

- [ ] **Step 7: Commit**

```bash
git add -A internal/docs internal/skills
git commit -m "docs(spec-386): ADR-0083 retensi dokumen audit + amandemen ADR-0057 & workflow"
```

---

### Task 5: Isi lima stub kecil jadi doc sungguhan

**Files:**
- Modify: `internal/docs/research/market-sizing.md`
- Modify: `internal/docs/research/competitor-analysis.md`
- Modify: `internal/docs/research/moat.md`
- Modify: `internal/docs/business/pricing-rationale.md`
- Modify: `internal/docs/operations/gtm.md`

**Interfaces:**
- Consumes: tak ada.
- Produces: lima doc berisi angka yang bisa diverifikasi; tak ada berkas/kategori baru, jadi index tak berubah.

**Aturan isi:** setiap klaim angka harus punya sumber di repo ini. Angka yang sudah terverifikasi dan boleh dipakai:

| Fakta | Sumber |
|---|---|
| cap sesi konkuren default `maxConcurrent: 2` | `shared/src/entities.ts:165`, dijaga `shared/src/scheduler.test.ts` |
| suite penuh ≈ 258 berkas test, 6 proses `tsc`; `--changed` di modul inti terukur 217 berkas / 1589 test / 177 dtk | ADR-0080 |
| katalog claude: Opus 5, Sonnet 5, Haiku 4.5, Fable 5; effort xhigh/high/medium/low/max/ultracode | `shared/src/entities.ts:49-55` |
| katalog codex: `gpt-5.6-sol`/`-terra` (ultra…low), `gpt-5.6-luna` (tanpa ultra), `gpt-5.5` (xhigh…low); `minClient` 0.144.0 / 0.124.0 | `shared/src/entities.ts:80-88` |
| limit claude = panggilan API live, TTL cache 30 dtk | `server/src/services/limits.ts:12` |
| limit codex = snapshot rollout, `stale` setelah 12 jam, nol jaringan | `server/src/services/codex-limits.ts:27` |
| biaya = estimasi, tak ada `dailyBudget`/budget guardrail | ADR-0012 |
| `hanoman-sdk` publik di npm | ADR-0063 |
| versi = git SHA, update read-only tanpa self-mutation | ADR-0048 |
| deploy single-host di belakang reverse proxy TLS | `internal/docs/operations/deploy-vps.md` |

- [ ] **Step 1: `research/market-sizing.md`**

Ganti isinya. Judul tetap `# Market sizing`. Isi: sizing hanoman adalah **kapasitas satu mesin**, bukan ukuran pasar — targetnya berapa project aktif & backlog, berapa sesi agen konkuren yang muat (cap default 2, `SCHEDULER_DEFAULTS.maxConcurrent`), apa yang sebenarnya jadi batas (RAM/CPU saat beberapa sesi berbagi mesin — alasan `verifyScope=changed` ADR-0080 dengan angka suite penuhnya), dan batas mana yang belum diukur. Tutup dengan satu baris "yang belum divalidasi".

- [ ] **Step 2: `research/competitor-analysis.md`**

Ganti isinya. Pembanding nyata: (a) menjalankan `claude`/`codex` CLI manual per repo, (b) CI generik, (c) orkestrator agen lain. Untuk tiap pembanding tulis apa yang ia sudah berikan dan apa yang tidak. Celah yang hanoman isi: SoT sebagai konvensi yang terukur (coverage), isolasi worktree per backlog, sesi hidup lintas restart di tmux, satu panel lintas project, dan agnostik agen (claude ↔ codex, ADR-0074).

- [ ] **Step 3: `research/moat.md`**

Ganti isinya. Keunggulan bertahan = **kombinasinya**, bukan satu fitur: SoT + isolasi worktree + sesi persisten + sinkron hub↔client + error monitoring/Help Center yang menyuapi backlog. Sebutkan juga apa yang **bukan** moat (UI, wrapper CLI) supaya doc ini jujur.

- [ ] **Step 4: `business/pricing-rationale.md`**

Ganti isinya. Internal, tanpa harga jual. "Biaya" = token model dan bersifat **estimasi** (ADR-0012) — tak ada `dailyBudget`, tak ada gerbang anggaran. Kendali nyata yang tersedia: pilihan model & effort per sesi saat Start (katalog claude & codex dengan slug persis), default global di Settings, default terpisah untuk sesi konflik (ADR-0081), dan `verifyScope` (ADR-0080) yang memangkas token verifikasi. Pemantauan: dua indikator limit terpisah dengan kesegaran berbeda (claude live 30 dtk vs codex snapshot, `stale` >12 jam) — sengaja tak digabung.

- [ ] **Step 5: `operations/gtm.md`**

Ganti isinya. "Peluncuran" = adopsi internal nafanesia.id, dengan kriteria sukses terukur (semua project baru lewat hanoman; docs tersentuh diperbarui di commit yang sama; backlog bergerak lewat sesi, bukan manual). Tambahkan jalur distribusi yang memang sudah ada: repo publik/open-source, `hanoman-sdk` di npm (ADR-0063), dan panduan integrasi AI agent — plus batasnya (satu workspace dulu, multi-tenant pasca-MVP).

- [ ] **Step 6: Verifikasi**

```bash
node <scratchpad>/check-docs.ts; echo "exit=$?"
wc -l internal/docs/research/market-sizing.md internal/docs/research/competitor-analysis.md \
      internal/docs/research/moat.md internal/docs/business/pricing-rationale.md \
      internal/docs/operations/gtm.md
```

Expected: `exit=0`; tiap berkas **> 3 baris** (bukti stub-nya benar-benar terisi).

- [ ] **Step 7: Commit**

```bash
git add internal/docs/research internal/docs/business internal/docs/operations
git commit -m "docs(spec-386): isi lima stub scaffold jadi doc bersumber"
```

---

### Task 6: Isi `requirements/frd.md` dan `requirements/rd.md`

**Files:**
- Modify: `internal/docs/requirements/frd.md`
- Modify: `internal/docs/requirements/rd.md`

**Interfaces:**
- Consumes: format EARS dari `internal/docs/requirements/acceptance-criteria-ears-standard.md`.
- Produces: dua doc detail kanonik; `entrypoints/frd.md` & `entrypoints/rd.md` **tidak** diubah (di luar scope).

- [ ] **Step 1: Tulis `requirements/frd.md`**

Sekarang isinya 3 baris yang menunjuk balik ke entrypoint — terbalik dari standar repo ("docs detail adalah kanonik"). Tulis FRD per modul memakai pola EARS (`THE SYSTEM SHALL` · `WHEN … THE SYSTEM SHALL` · `WHILE … THE SYSTEM SHALL` · `WHERE … THE SYSTEM SHALL` · `IF … THEN THE SYSTEM SHALL`).

Modul yang wajib ada — turunkan dari layar nyata di `src/src/screens/`:
Overview · Projects · PRD · Backlog · Terminal · Review & Integrate · Docs SoT · IDE (Explorer & Git Graph) · Errors · Help Desk/Triase · Scheduler · VPS · Settings · Auth.

3–6 klausa EARS per modul, tiap klausa menyebut ADR/SPEC penopangnya. Contoh bentuk yang diharapkan:

```markdown
## Backlog
- WHEN operator menekan Start pada sebuah backlog item, THE SYSTEM SHALL membuka sesi agen di git
  worktree terisolasi `<repoDir>/.worktrees/<spec-id>` dan tetap berada di layar Backlog
  (ADR-0002/0015, SPEC-341).
- IF sesi untuk spec itu sudah hidup, THEN THE SYSTEM SHALL me-re-attach ke sesi yang ada, bukan
  men-spawn yang kedua (ADR-0015).
- WHILE plan `docs/superpowers/plans/**` masih memuat `- [ ]`, THE SYSTEM SHALL menahan stage di
  `executing` dan tidak memajukannya ke `done` (ADR-0029).
- THE SYSTEM SHALL memindahkan stage **mundur** hanya atas `PATCH /specs/:id { stage }` eksplisit
  dari manusia (ADR-0027).
```

Jangan mengarang perilaku. Bila sebuah klausa tak bisa kamu tunjuk sumbernya di kode/ADR, jangan tulis.

- [ ] **Step 2: Tulis `requirements/rd.md`**

Ganti isi. Judul tetap `# Requirements — rekap`? **Tidak** — berkas ini adalah *release doc* detail (padanan `entrypoints/rd.md`); beri judul `# Release doc (detail) — hanoman`. Isi:

- **Identitas versi** — tak ada field `version`; versi = git SHA, `runningBuildSha` ditanam saat build ke `server/dist/build-info.json` oleh `scripts/stamp-build.mjs` (ADR-0048).
- **Sinyal update** — badge muncul bila `runningBuildSha ≠ checkoutSha` ATAU origin di depan checkout; server **read-only**, tak pernah `git pull`/build/restart sendiri (ADR-0048).
- **Kanal** — `main` sebagai target integrasi; branch kerja `hanoman/spec-<n>` per backlog (ADR-0032), integrasi dipicu manual dari dashboard (ADR-0031).
- **Prosedur rilis** — urutan yang benar-benar dipakai: push → `git pull --ff-only` → `pnpm install` → `prisma migrate deploy` → `prisma generate` → `pnpm build` (verifikasi exit 0) → restart service. Rujuk `operations/deploy-vps.md` & `operations/production.md`.
- **Kriteria rilis** — test yang tersentuh hijau + suite penuh dijalankan manusia sebelum merge (ADR-0080), docs tersentuh terbarui & ter-link, migration additif untuk hub produksi.
- **Rollback** — checkout SHA sebelumnya + rebuild + restart; migration **additif** sehingga rollback kode tak menuntut rollback skema.

- [ ] **Step 3: Verifikasi**

```bash
node <scratchpad>/check-docs.ts; echo "exit=$?"
wc -l internal/docs/requirements/frd.md internal/docs/requirements/rd.md
```

Expected: `exit=0`; kedua berkas jauh di atas 3 baris.

- [ ] **Step 4: Commit**

```bash
git add internal/docs/requirements
git commit -m "docs(spec-386): isi requirements/frd.md & rd.md jadi doc detail kanonik"
```

---

### Task 7: Verifikasi akhir & laporan

**Files:**
- Modify: `internal/docs/README.md` (hanya bila verifikasi menemukan sesuatu)

**Interfaces:**
- Consumes: seluruh task sebelumnya.
- Produces: bukti tertulis bahwa cleanup tak merusak apa pun.

- [ ] **Step 1: Harness integritas**

```bash
node <scratchpad>/check-docs.ts; echo "exit=$?"
```
Expected: `link rusak : 0`, `doc yatim : 0`, `ADR reachable: 83/83`, `exit=0`.

- [ ] **Step 2: CLI resmi**

```bash
pnpm --filter ./cli exec tsx src/hanoman.ts docs index --check
```
Expected: `index ok`

- [ ] **Step 3: Test mesin index/coverage**

Perubahan spec ini bersandar pada perilaku sub-index milik modul-modul ini, jadi test-nya dijalankan meski kodenya tak berubah:

```bash
env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism \
  shared/test/coverage.test.ts cli/test/docs-model.test.ts \
  cli/test/index-link.cmd.test.ts server/test/scan.test.ts
```
Expected: seluruhnya PASS, dan **jumlah test > 0** — bila muncul "no test files", perbaiki path, jangan terima sebagai hijau.

- [ ] **Step 4: Scope test resmi sesi**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm vitest --run --changed "$HANOMAN_BASE_SHA"
```
Expected: **nol berkas test** — perubahan spec ini murni `.md`. Ini **bukan** bukti kehijauan (gotcha `passWithNoTests`, ADR-0080); catat apa adanya di laporan dan sandarkan bukti pada Step 1–3.

- [ ] **Step 5: Ukur hasil akhir**

```bash
echo "berkas: $(git ls-files internal/docs | wc -l)"
git ls-files internal/docs | xargs wc -c | tail -1
wc -c internal/docs/README.md internal/docs/adr/README.md
```
Expected: berkas 140 → **115**; `README.md` 46 620 B → **≤ 10 KB**.

- [ ] **Step 6: Centang seluruh checklist plan ini**

Semua `- [ ]` di berkas ini menjadi `- [x]`. hanoman menahan backlog di `executing` selama masih ada yang kosong (ADR-0029).

- [ ] **Step 7: Commit akhir & push**

```bash
git add -A
git commit -m "docs(spec-386): centang plan cleanup docs internal"
git push origin HEAD:refs/heads/hanoman/spec-386
```

---

## Self-review

- **Cakupan spec:** (1) index dipecah → Task 2; (2) 27 audit dihapus + retensi → Task 3 & 4; (3) 7 stub diisi → Task 5 (lima) & Task 6 (dua); (4) link rusak → Task 1; verifikasi → Task 7. Tak ada bagian spec tanpa task.
- **Placeholder:** blok `[…]` di Step 1 Task 4 adalah instruksi isi ADR yang eksplisit ditandai sebagai instruksi, bukan teks literal — bukan TBD.
- **Konsistensi nama:** nama berkas ADR baru ditulis identik di Task 3 Step 3, Task 4 Step 1/2/3, dan seksi research: `adr/0083-retensi-dokumen-audit.md`. Angka korpus berurutan konsisten: 140 → 141 (Task 2) → 114 (Task 3) → 115 (Task 4/7).
