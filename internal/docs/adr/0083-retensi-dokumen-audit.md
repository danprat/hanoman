# ADR-0083 — Retensi dokumen audit: artefak diagnosis berumur, bukan SoT abadi

**Status:** accepted · **Tanggal:** 2026-07-29 · **Spec:** SPEC-386
**Membatasi:** [ADR-0057](0057-audit-only-source-flow.md) (audit-only sebagai source & flow) — flow,
pipeline, dan deliverable-nya tak berubah; yang ditambahkan adalah **akhir hidup** dokumennya.
**Terkait:** [ADR-0021](0021-nomor-spec-diklaim-docs-bukan-hanya-database.md) (nomor ADR imutable — tak
ikut berumur) · [ADR-0023](0023-guardrail-sot-dicabut.md) (SoT sebagai konvensi) ·
[ADR-0076](0076-eskalasi-audit-dinamis-manifest-rekomendasi.md) (eskalasi audit — penanda "sudah
diputuskan") · [ADR-0011](0011-docs-realtime-filesystem.md)/[0018](0018-coverage-nilai-turunan.md)
(docs live dari filesystem, jadi penghapusan langsung terpantul di coverage tanpa migrasi data)

## Konteks

[ADR-0057](0057-audit-only-source-flow.md) menetapkan flow audit menghasilkan satu dokumen
`internal/docs/research/audit-<spec-id>-<slug>.md` sebagai deliverable — dan berhenti di situ. Ia tak
pernah menetapkan kapan dokumen itu berhenti relevan. Karena flow audit terus dipakai (dua pintu sejak
**ADR-0075** (dicabut, [ADR-0092](0092-cabut-error-monitoring-sdk-cross-audit.md)), tiga tindak lanjut sejak ADR-0076),
dokumennya menumpuk tanpa batas.

Terukur saat SPEC-386 dikerjakan:

| | |
|---|---|
| dokumen audit di `research/` | **27 berkas · 115 KB** |
| abstraknya di `internal/docs/README.md` | **20 196 B = 43% index** |
| seluruh index | 46 620 B |
| kategori doc produk/arsitektur di index | ±2 500 B (**5%**) |

Angka terakhir itu masalahnya. `internal/docs/README.md` adalah doc pertama yang dibaca **setiap**
sesi agen (`AGENTS.md` → `internal/skills/hanoman/SKILL.md` → index). Ia seharusnya alat orientasi;
94% isinya justru bahan rujukan — changelog ADR ditambah abstrak laporan bug yang perbaikannya sudah
landed berbulan-bulan lalu. Biaya itu dibayar berulang, tiap sesi, oleh tiap agen.

Ke-27 dokumen itu juga sudah selesai tugasnya menurut ukurannya sendiri: eskalasinya sudah diputuskan
dan spec turunannya sudah tuntas. Yang tersisa dari tiap audit yang benar-benar mengubah sistem sudah
punya rumah permanen — sebuah ADR, sebaris di doc SoT, atau perbaikan kode yang ter-commit.

## Keputusan

1. **Dokumen audit adalah artefak diagnosis berumur**, bukan Source of Truth abadi.
2. Ia hidup sejak fase Laporan menulisnya sampai **eskalasinya diputuskan** (ADR-0076) **dan** spec
   turunannya tuntas. Sesudah itu ia boleh dihapus dalam commit cleanup, **berikut entri indexnya**.
3. **Syarat sebelum menghapus — jejak permanen.** Temuannya harus sudah tercatat di salah satu dari:
   sebuah ADR, sebaris/paragraf di doc SoT yang relevan, atau perbaikan kode yang ter-commit. Audit
   yang belum meninggalkan jejak apa pun **tidak boleh dihapus** — tulis jejaknya dulu.
4. **Rujukan masuk ikut dibereskan.** Doc permanen kerap menaut dokumen auditnya
   (`Rincian & bukti: [audit SPEC-nnn](…)`). Setiap tautan semacam itu harus dialihkan atau
   dilepas dalam commit yang sama — kalau tidak, penghapusan meninggalkan link mati di doc yang justru
   dimaksudkan permanen. Di SPEC-386 ada **empat**: ADR-0062, ADR-0064, ADR-0081, dan
   `frontend/frontend-implementation.md`.
5. **Index tidak menyimpan abstrak audit.** Seksi `## research` memuat doc riset + rujukan ke ADR ini,
   titik.
6. **ADR tidak berumur.** ADR-0021 tetap berlaku sepenuhnya: nomor unik & imutable, ADR usang ditandai
   statusnya, tak pernah dihapus. Yang dipangkas dari index hanyalah **narasinya** — ia pindah ke
   sub-index [`adr/README.md`](README.md), bukan hilang.
7. **Tak ada otomasi.** Penghapusan adalah tindakan manusia atau sesi cleanup yang sadar konteks.
   Tidak ada job, cron, atau hook yang menghapus dokumen audit — konsisten dengan
   [ADR-0024](0024-sesi-interaktif-menggantikan-run.md).

## Rasional

*Chiranjivi* — "docs bertahan lebih lama dari satu commit atau sesi" — menjanjikan keabadian bagi
**keputusan**, bukan bagi setiap catatan kerja yang mengantar ke keputusan itu. ADR adalah bentuk
keputusan; laporan audit adalah catatan kerja. Menyamakan keduanya membuat SoT jadi arsip, dan arsip
yang menghalangi orientasi justru merusak tujuan SoT.

Alternatif yang ditolak:

- **Arsipkan ke subfolder** (`research/audit-arsip/`) — berkasnya tetap menumpuk dan
  `services/spec-docs.ts` mengklasifikasi audit lewat pola path `/research/audit-`, jadi subfolder
  malah mengubah perilaku klasifikasi. Tak menyelesaikan apa pun, menambah satu aturan path.
- **Ringkas abstraknya di index, simpan berkasnya** — memindahkan gejala. Seksi tetap tumbuh linier
  terhadap jumlah audit, dan berkas 115 KB tetap di korpus.
- **Biarkan** — biaya orientasi tiap sesi terus naik, dan flow audit menjamin ia tak akan berhenti naik.

## Konsekuensi

- `GET /api/specs/:id/escalation` membalas `null` dan preview "doc audit" di detail spec kosong untuk
  spec yang dokumennya sudah dihapus. **Tak ada kode atau test yang perlu diubah**:
  `services/spec-docs.ts` mengklasifikasi lewat pola path dan `services/audit-escalation.ts` mencari
  dokumennya per-request lewat `listSpecDocs` — tak ada daftar berkas ter-hardcode di mana pun.
- Naskah penuh tiap audit tetap ada di **riwayat git**; yang hilang hanya kehadirannya di working tree.
- Coverage tak terganggu: kategori `research` tetap hidup (tiga doc riset) dan tetap `linked`.
- Menghidupkan kembali "audit doc abadi" butuh ADR baru.

## Ledger — 27 dokumen yang dihapus di SPEC-386

Semua sudah diverifikasi memenuhi syarat #3 sebelum dihapus. "Jejak permanen" adalah tempat temuannya
hidup sekarang.

| Audit | Temuan | Jejak permanen |
|---|---|---|
| SPEC-217 | path project optional — binding per-client SPEC-213 hanya setengah tersambung | model `LocalBinding` + `resolveRepoDir` (data-model.md, SKILL.md) |
| SPEC-223 | scaffold project baru gagal: `spawnSync git ENOENT` + `tmux … command too long` | `initRepo` idempoten + prompt lewat berkas ([ADR-0016](0016-sesi-terminal-hidup-di-tmux.md)) |
| SPEC-227 | review diff 500 `Not a valid object name main` — fallback branch hardcode | basis diff dari `spec.baseSha` ([ADR-0030](0030-spec-menyimpan-base-head-sha.md)) |
| SPEC-229 | merge via git graph selalu gagal — jalur `runGitOp` tak mewarisi isolasi | [ADR-0053](0053-git-graph-merge-worktree-isolasi-sesi-claude.md) (deterministik dulu, konflik → sesi agen) |
| SPEC-230 | sesi PRD tanpa `specId` → review+integrate terkopel `Spec` | [ADR-0054](0054-review-integrate-ber-skop-sesi-untuk-prd.md) |
| SPEC-242 | `FLOW_PHASES` di UI tak ikut menambah flow `audit` | baris `audit` di `SettingsScreen.tsx` ([ADR-0057](0057-audit-only-source-flow.md)) |
| SPEC-244 | take/promote tak set `branchFrom`; `resolveCommit` tak fallback `origin/` | [ADR-0059](0059-kontinuitas-branch-take-to-backlog-dan-skip-audit.md) |
| SPEC-245 | git graph tak realtime — hanya `load()` saat mount | silent poll 4 dtk di `GitGraph.tsx` (`if (!document.hidden) load(true)`) |
| SPEC-255 | rename slug project menyentuh DSN/Help/sync | [ADR-0064](0064-project-id-renameable.md) |
| SPEC-258 | DSN "hilang" setelah refresh — state `projects` App hanya dimuat saat login | `onProjectChanged` di `App.tsx` (frontend-implementation.md) |
| SPEC-262 | grid capability merender slug domain tanpa label | `CAPABILITY_DOMAINS` di `shared/src/agent.ts` (resolved SPEC-264) |
| SPEC-265 | tak ada panduan integrasi AI agent & tak ditaut dari UI | `docs/agent-integration.md` + link di Settings ([ADR-0065](0065-ai-agent-capability-agent-token.md)) |
| SPEC-267 | advance stage write-through tak pernah `enqueueOutbox` | `notifySynced("spec", …)` di `services/live-specs.ts:40` |
| SPEC-271 | tautan backlog↔triase satu-kali-jalan, tak bisa dilepas | `POST /errors\|tickets/:id/unlink` (`routes/errors.ts`, `routes/tickets.ts`) |
| SPEC-275 | stack trace tak cerminkan source code (parity source-map) | **ADR-0070** (dicabut, [ADR-0092](0092-cabut-error-monitoring-sdk-cross-audit.md)) |
| SPEC-286 | eskalasi triase tak memeriksa lampiran | direktif `PERIKSA` di `payload.context` (SKILL.md, `routes/tickets.ts`) |
| SPEC-289 | teks terminal tak bisa di-copy — xterm merender seleksinya sendiri | `screens/terminal-clipboard.ts` (`clipboardIntent`) |
| SPEC-291 | accept tiket hardcode `source:"help"` → semua jadi feature brief | peta `category→source` di `routes/tickets.ts` (SKILL.md) |
| SPEC-293 | detail triase tanpa aksi/status link | [ADR-0071](0071-link-ticket-triase-deeplink-sharetoken.md) |
| SPEC-330 | write asal-hub menumpuk di `SyncOutbox` yatim, tak masuk feed | `notifySynced()` sadar-peran ([ADR-0066](0066-errors-tickets-masuk-record-sync-plus-pemicu-manual.md)/[0067](0067-sync-lww-reconciliation-manual.md)) |
| SPEC-341 | Start backlog selalu me-redirect ke Terminal | side effect navigasi dihapus (frontend-implementation.md) |
| SPEC-351 | git graph terpotong — `limit` hardcode 200 tanpa paginasi | jendela berhalaman `PAGE`/`hasMore` di `GitGraph.tsx` |
| SPEC-352 | help desk: honeypot `hp` diisi autofill pelapor sungguhan | `hc_trap` + validasi bentuk respons ([ADR-0062](0062-help-center-tiket-publik-triase.md)) |
| SPEC-363 | pratinjau dokumen menggulir menyamping + PDF berhalaman kosong | `.hn-md` `overflow-wrap:anywhere` + renderer PDF (frontend-implementation.md, [ADR-0078](0078-unduh-dokumen-md-pdf.md)) |
| SPEC-377 | sesi penyelesai konflik memakai agen default, bukan setelan | `sessionAgentDefaults()` di 3 pintu konflik (SKILL.md, [ADR-0074](0074-codex-sebagai-mesin-sesi.md)) |
| SPEC-382 | feed memancarkan anak sebelum induk → FK ditolak, baris hilang | [ADR-0082](0082-kontrak-apply-changefeed-record-tertunda.md) |
| SPEC-383 | blok claude/codex tak terbedakan; konflik tak punya default | [ADR-0081](0081-default-sesi-konflik-opt-in.md) |
