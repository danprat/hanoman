# ADR-0081 — Default sesi penyelesai konflik: blok `Setting.conflict` opt-in yang mewarisi saat mati

**Status:** accepted · **Tanggal:** 2026-07-29 · **SPEC:** SPEC-383
**Memperluas:** [0061](0061-model-effort-per-sesi-picker-start.md) (properti sesi dipilih saat lahir),
[0074](0074-codex-sebagai-mesin-sesi.md) (agen per sesi) · **Terkait:**
[0031](0031-rebase-merge-backlog.md), [0053](0053-git-graph-merge-worktree-isolasi-sesi-claude.md),
[0054](0054-review-integrate-ber-skop-sesi-untuk-prd.md), [0073](0073-mode-goal-stop-hook-per-sesi.md),
[0080](0080-scope-verifikasi-per-sesi.md) (pola knob `Setting` ber-`.default()`, tanpa migration)
**Tidak membalik:** [0037](0037-cabut-guardrail-safety.md) — ini pilihan konfigurasi, bukan gerbang.

## Konteks

Rebase & merge dijalankan deterministik di worktree isolasi (ADR-0031/0053). Yang **konflik**
menyerahkan worktree itu ke satu sesi agen. Ada tiga pintu yang melahirkan sesi tersebut:

- `POST /specs/:id/integrate` — backlog
- `finishGraphOp` di `routes/ide.ts` — git graph (merge · rebase · pull · drop)
- `POST /terminal/sessions/:id/integrate` — PRD

Sejak SPEC-377 ketiganya seragam memanggil `sessionAgentDefaults()`, yaitu **default global yang
sama persis** dengan sesi kerja (backlog/PRD/reverse/scaffold/breakdown). Itu memperbaiki bug
"selalu claude", tapi menyisakan satu keterbatasan: tidak ada tempat mana pun untuk menyatakan
"selesaikan konflik dengan model X" tanpa ikut memindahkan model semua sesi kerja. Sesi konflik
juga tak punya picker Start — ADR-0074/SPEC-377 sengaja tak memberi override per-request, karena
konflik lahir dari aksi yang bukan "mulai sesi".

Pekerjaan menyelesaikan konflik berbeda bentuknya dari mengeksekusi backlog: skopnya sempit
(berkas bertanda), tak berfase, tak punya plan, dan sering beruntun. Memaksanya memakai model &
effort sesi Execute berarti membayar effort tertinggi untuk pekerjaan yang sebagian besar mekanis.

Ironisnya dialog Rebase/Merge sudah menjanjikan hal ini secara harfiah — *"memakai agen, model &
effort dari Settings"* — sementara Settings tak punya barisnya. Detail temuannya dulu hidup di dokumen
audit SPEC-383; dokumen itu dipensiunkan di SPEC-386 ([ADR-0083](0083-retensi-dokumen-audit.md)) —
ringkasannya ada di ledger ADR itu, naskah penuhnya di riwayat git.

## Keputusan

Tambahkan blok **`Setting.conflict`** — satu triple `{ enabled, agent, model, effort }` — sebagai
default **khusus sesi penyelesai konflik**, dikonsumsi lewat satu helper
`conflictSessionDefaults()` di `services/settings.ts`.

1. **Opt-in, mewarisi saat mati.** `enabled: false` (default) berarti helper **mendelegasikan penuh**
   ke `sessionAgentDefaults()` — perilaku pra-SPEC-383 tanpa selisih satu argv pun. Instalasi yang
   ada tak berubah sampai operator menyalakannya. Konsisten dengan konvensi repo: `scheduler`,
   `goal`, dan `agentAccessEnabled` semuanya default mati.
2. **Satu triple, bukan blok per-agen.** Berbeda dari `Setting` akar (blok claude di akar + blok
   `codex` terpisah), blok konflik menyimpan satu agen beserta model & effort-nya. Menukar agen di
   UI menukar model/effort sekalian ke default agen itu — cermin `pickAgent` di `StartSessionModal`.
   Alasannya: blok ini adalah **pilihan tunggal**, bukan katalog yang menunggu giliran; dua blok
   bercabang hanya menambah keadaan yang tak pernah terbaca.
3. **Tanpa migration.** `Setting.data` bertipe `Json`; `zConflict` dipasang ke `zSetting` lewat
   `.default(CONFLICT_DEFAULTS)`, jadi baris `Setting` lama tetap parse (pola ADR-0073/0074/0080).
4. **Tanpa endpoint baru.** Knob hidup di `GET/PUT /settings` yang sudah ada. Tetap **tak ada
   override per-request** — SPEC-377 sudah memutuskan itu dan keputusan ini tak mengubahnya.
5. **Effort codex dikoersi di helper** (`coerceCodexEffort`), cermin `normalizeCodex` untuk blok
   codex global — blok konflik tak boleh menyimpan pasangan model+effort yang ditolak codex (ADR-0074/SPEC-339).
6. **`ensureCodexTrust` diturunkan dari agen HASIL helper**, bukan dari `Setting.agent`. Ini yang
   membedakannya dari bug SPEC-377: dengan blok konflik, agen sesi konflik bisa berbeda dari agen
   global, jadi membaca `Setting.agent` untuk memutuskan trust akan mengulang kegagalan yang sama
   dalam bentuk baru (sesi codex mentok di layar trust tanpa manusia di pane).

Sekalian, tab **Model sesi** di Settings ditata ulang bersumbu agen: blok claude dan codex berdiri
sejajar, masing-masing berjudul nama agennya dan **bertanda** mana yang benar-benar dipakai sesi
baru. Sebelumnya blok claude hanya berbunyi "Model"/"Effort" (nama agennya cuma ada di `aria-label`)
sementara judul kartunya, "default global", tetap terpampang meski agen aktifnya codex — klaim yang
salah, karena `sessionAgentDefaults()` hanya membaca blok milik `Setting.agent`.

## Konsekuensi

- Operator bisa menjalankan sesi kerja Opus/xhigh sambil membereskan konflik dengan Haiku/low (atau
  sebaliknya), tanpa bolak-balik mengubah default global.
- Ada **dua** sumber default kelahiran sesi. Aturannya tegas: `sessionAgentDefaults()` untuk sesi
  kerja, `conflictSessionDefaults()` untuk **ketiga** pintu konflik — dan yang kedua adalah
  pembungkus yang mendelegasikan ke yang pertama saat mati, jadi divergensinya tak bisa senyap.
- `sessionModel()` (khusus claude) tetap tersisa hanya untuk `POST /vps/:id/session`, masih
  menunggu dipensiunkan (dicatat di audit SPEC-377 dan SPEC-383).
- Blok tersimpan tetap ada saat `enabled` dimatikan lagi — mematikan override tidak menghapus
  tuning-nya. Nilai yang tak terpakai itu tak pernah dibaca helper.

## Alternatif yang ditolak

- **Picker per operasi integrasi** (modal Rebase/Merge memilih agen/model). Menambah kontrak API
  (body `POST …/integrate`) dan memaksa keputusan di momen yang salah — operator sedang memikirkan
  branch, bukan model. Ekspektasi yang ditulis pelapor adalah "defaultnya di setting".
- **Mengganti makna `sessionAgentDefaults()`** agar sadar-konteks (`kind: "work" | "conflict"`).
  Membuat setiap call site harus tahu jenis sesinya; helper terpisah lebih sulit dipakai salah.
- **Blok konflik tanpa `enabled`** (selalu aktif, prefill = default global). Menghapus jaminan
  "tak ada yang berubah sampai disentuh", dan membuat nilai basi ikut berlaku diam-diam saat
  operator kelak memindahkan agen global.
