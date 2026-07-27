# ADR-0075 — Audit lintas project: relasi `ProjectLink` + flow `cross-audit` + kunci log ber-scope sesi

**Status:** accepted · **Tanggal:** 2026-07-27 · **Spec:** SPEC-337
**Terkait:** [ADR-0057](0057-audit-only-source-flow.md) (audit-only sebagai source + flow),
[ADR-0002](0002-git-worktree-isolation.md) (isolasi worktree),
[ADR-0016](0016-sesi-terminal-hidup-di-tmux.md) (tmux = sumber kebenaran sesi),
[ADR-0060](0060-error-monitoring-ingest-ber-dsn.md) (ingest ber-DSN sebagai pengecualian auth),
[ADR-0028](0028-auth-sesi-opaque-di-db.md) (gate `/api`),
[ADR-0065](0065-ai-agent-capability-agent-token.md) (agent token — sengaja **tidak** dipakai di sini),
[ADR-0064](0064-project-id-renameable.md) (rename slug + cascade)

## Konteks

Setiap sesi `claude` hanoman lahir di **satu** worktree milik **satu** project (ADR-0002/0015).
Issue yang hidup **di antara** dua project — kontrak API yang bergeser antara pemanggil dan
penyedia, SDK tertinggal versi, error di service B yang muncul sebagai kegagalan di project A —
karena itu tak pernah punya satu pengamat. Kutipan brief SPEC-337: *"ketika ada 2 project atau
lebih yang mau di audit atau cek log issue antar integrasi nya harus di masing-masing ai agent
dan itu menyulitkan."*

Tiga kekurangan konkret:

1. hanoman **tak menyimpan relasi** antar `Project` sama sekali — tak ada yang tahu bahwa A memakai B.
2. Sesi **tak bisa membaca** kode/docs project lain.
3. Log error **ter-scope per project** (`GET /errors?project=…`). Tak ada timeline gabungan, padahal
   justru urutan-waktu lintas project itulah bukti sebuah issue integrasi.

"AI agent" yang diminta brief adalah **hanoman sendiri yang membuka sesi `claude`** — bukan agen
eksternal yang menembak `/api` (ADR-0065). Jalur agent token karena itu bukan jawabannya: ia
menuntut master switch dinyalakan + token dibuat manual, dan lingkupnya global, bukan seumur sesi.

## Keputusan

### 1. Relasi antar project menjadi data: model `ProjectLink`

Berarah (`fromProjectId` **bergantung pada** `toProjectId`), `kind` (`api|sdk|data|event|lainnya`,
`String` + zod seperti enum lain), `note` bebas yang menerangkan bentuk integrasinya, `@@unique`
pada pasangan, FK `onDelete: Cascade` **dan** `onUpdate: Cascade` (rename ADR-0064 merambat gratis —
tak ada referensi longgar baru).

**Tetangga** sebuah project = union kedua arah (yang ia pakai + yang memakainya), **satu hop**.
Itulah "grup" yang diaudit; closure transitif sengaja tidak dibuat — batasnya harus bisa diterangkan
dalam satu kalimat kepada agen maupun manusia.

`ProjectLink` **LOCAL-only** (tak masuk `SYNCED`): id `cuid` + `@@unique(pasangan)` berarti dua
device yang mendeklarasikan edge yang sama akan bertabrakan unique constraint saat `applyPush`
meng-upsert **by id**. Mensyncnya menuntut id deterministik (`<from>__<to>`) yang lalu basi saat
project di-rename — kerja yang tak sebanding untuk spec ini. Jalan keluarnya dicatat, tidak diambil.

### 2. Flow `cross-audit` — dua pintu, satu prompt

Enum melebar **tanpa migration** (presedens ADR-0057): `zFlow` += `cross-audit`,
`zSpecSource` += `cross-audit`, `flowForSource("cross-audit") = "cross-audit"`,
`PIPELINES["cross-audit"] = ["Audit", "Laporan"]` — nama fase dipakai ulang dari audit-only,
jadi `REACHED.Laporan = "done"` dan gerbang plan (ADR-0029) tetap tak berlaku (tak ada Plan/Execute).

- **Pintu backlog** — `Spec` bersource `cross-audit` di project utama. Warisan penuh audit-only:
  worktree isolasi, review diff, dokumen `internal/docs/research/audit-<spec-id>-<slug>.md`,
  merge, promosi jadi Finding QA.
- **Pintu lepas** — `POST /terminal/sessions {project, flow:"cross-audit"}` dari kartu Integrasi:
  sesi tanya-jawab di worktree `xaudit-<projectId>`, **tanpa** `Spec`, tanpa fase, tak menggerakkan
  stage apa pun. Untuk pertanyaan yang tak layak jadi dokumen.

Satu builder prompt melayani keduanya (`startCrossAuditPrompt(ctx, mode)`); mode `backlog`
menambahkan instruksi fase, klausa autonomy, skill `systematic-debugging`, dan commit+push.

### 3. Hanya project utama yang punya worktree; tetangga dibaca read-only

Worktree tetap satu (project utama) — di situlah dokumen audit ditulis dan di-commit. Checkout
tetangga masuk prompt sebagai **path read-only** dengan larangan menulis yang eksplisit. Aturan
tulis di prompt menunjuk **path worktree sesi**, bukan `repoDir`: **semua** checkout (termasuk milik
project utama) read-only, sehingga ADR-0002 tak melemah di kalimat prompt mana pun. Ini aman
justru karena flow-nya audit-only: ADR-0057 sudah melarang menulis kode sama sekali. Membuat
worktree di tiap repo tetangga ditolak: ia menuntut pencatatan + pembersihan N worktree saat sesi
ditutup, dan **menyembunyikan** perubahan lokal yang belum di-commit — padahal itu justru sering
menjadi penjelasan sebuah issue integrasi.

### 4. Kunci audit hidup di tmux, bukan di database

Sesi cross-audit lahir membawa kunci acak `hnm_xa_<32 hex>` yang disimpan sebagai **tmux option**
pada sesinya (`@hanoman_audit_key`) bersama daftar project yang boleh dibaca
(`@hanoman_audit_projects`), lalu diteruskan ke proses sesi lewat env `HANOMAN_AUDIT_KEY` +
`HANOMAN_AUDIT_URL`.

Karena **tmux adalah satu-satunya sumber kebenaran pekerjaan berjalan** (ADR-0016), dua sifat
didapat gratis: kunci selamat dari restart API, dan ia **mati bersama pane-nya** — tak ada tabel
kredensial baru, tak ada revoke yang bisa terlupa. Kunci **tak pernah keluar lewat API**:
`SessionInfo`/`GET /terminal/sessions` tak memuatnya; ia hidup hanya di tipe `Pane` internal.

### 5. `GET /api/audit/logs` — pengecualian gate yang sempit

Prefix `/api/audit/` di-bypass gate cookie **hanya bila** header `X-Hanoman-Audit-Key` cocok dengan
sebuah pane hidup; selain itu request jatuh ke jalur auth normal (cookie / agent token) → 401.
Pola dan pembenarannya sama persis dengan `/api/ingest` (ADR-0060) dan `/api/help` (ADR-0062):
pemanggil sah yang tak punya cookie, diotorisasi oleh rahasia yang dipegang route itu sendiri.

Kewenangannya **read-only dan ber-scope**: hanya `ErrorGroup`/`ErrorEvent` milik project di
`@hanoman_audit_projects`. Meminta project di luar scope → **403**; grup di luar scope → **404**
(keberadaannya pun tak perlu bocor). `timeline` mencampur event semua project ter-scope dan
mengurutkannya menurut waktu — itulah bukti korelasi yang hari ini dirakit manual.

## Konsekuensi

- **Migration aditif** (`ProjectLink`), tanpa perubahan pada model mana pun yang sudah ada.
- Permukaan auth bertambah **satu** pengecualian prefix, read-only, mati bersama sesinya. Kunci
  terlihat oleh siapa pun yang bisa menjalankan `tmux -L hanoman` sebagai user itu — tingkat
  kepercayaan yang **sama** dengan bisa menjalankan `claude` di mesin itu (ADR-0037), jadi tak ada
  batas baru yang ditembus.
- Sesi cross-audit membaca checkout project lain. Batas tulis tetap worktree (ADR-0002); batas baca
  memang melebar, sadar, dan hanya untuk flow yang dilarang menulis kode.
- Project tanpa `ProjectLink` tetap bisa dijadikan backlog `cross-audit` (scope = dirinya sendiri),
  tapi prompt menyatakan itu terang-terangan; tombol sesi lepas dimatikan di UI.
- `ProjectLink` tidak menyeberang antar device sampai ada spec lanjutan yang mengambil id
  deterministik + penanganan rename.

## Alternatif yang ditolak

- **Agent token eksternal (ADR-0065) sebagai jalur log.** Operator menegaskan agennya adalah
  hanoman sendiri. Token global + master switch + pembuatan manual adalah friksi tanpa imbalan,
  dan kewenangannya jauh lebih luas daripada yang dibutuhkan satu sesi audit. Ditolak.
- **Snapshot log disematkan di prompt saat sesi lahir.** Nol permukaan API baru, tapi datanya beku:
  error yang muncul di tengah sesi tak terlihat dan agen tak bisa memfilter ulang — mematikan
  justru bagian "bisa ditanya-tanya" dari brief. Ditolak.
- **Pilih project ad-hoc tiap kali Start (tanpa model).** Lebih cepat sampai, tapi relasi tak pernah
  menjadi pengetahuan hanoman dan harus dipilih ulang selamanya. Ditolak oleh operator.
- **Worktree read-only per project tetangga.** Lebih murni terhadap ADR-0002, tapi menuntut
  pencatatan + pembersihan N worktree dan menyembunyikan perubahan yang belum di-commit. Ditolak.
- **Log runtime VPS (journald/systemd) ikut ditarik.** Belum ada pemetaan project → VPS/unit;
  scope membengkak jauh melewati brief. Dinyatakan non-goal.
- **Closure dependency transitif + graf visual.** YAGNI untuk objective MVP; satu hop sudah menjawab
  "issue antar integrasi". Ditolak.

## Acceptance (EARS)

- **AC-1** — WHEN operator menambah relasi lewat `POST /projects/:id/links { to, kind, note? }`,
  THE server SHALL menyimpan satu `ProjectLink` berarah; self-link → **400**, project target tak ada
  → **404**, pasangan yang sudah ada → **409**.
- **AC-2** — THE `GET /projects/:id/links` SHALL mengembalikan relasi **kedua arah** milik project
  itu, masing-masing bertanda `direction` (`keluar` | `masuk`).
- **AC-3** — WHEN sebuah project dihapus atau di-rename, THE relasi yang menyentuhnya SHALL ikut
  terhapus / ikut berpindah otomatis lewat cascade FK, tanpa langkah manual.
- **AC-4** — WHEN sesi `cross-audit` lahir (backlog maupun lepas), THE server SHALL memasang kunci
  audit + daftar project ter-scope pada sesi tmux-nya dan meneruskannya ke sesi lewat env
  `HANOMAN_AUDIT_KEY`/`HANOMAN_AUDIT_URL`.
- **AC-5** — THE `GET /terminal/sessions` SHALL **tidak pernah** memuat kunci audit.
- **AC-6** — WHEN request ke `/api/audit/*` membawa `X-Hanoman-Audit-Key` milik sesi hidup, THE gate
  `/api` SHALL meloloskannya tanpa cookie; kunci tak dikenal / sesi sudah mati → **401**.
- **AC-7** — THE `GET /api/audit/logs` SHALL mengembalikan `timeline` berisi `ErrorEvent` **semua**
  project ter-scope, tercampur dan terurut menurut waktu, plus agregat `groups`; filter `since`,
  `environment`, `q`, `projects`, `limit` berlaku; `since` tak terparse → **400**.
- **AC-8** — WHEN query menyebut project di luar scope sesi, THE server SHALL menjawab **403**; dan
  WHEN `GET /api/audit/logs/:groupId` menunjuk grup di luar scope, THE server SHALL menjawab **404**.
- **AC-9** — THE prompt sesi cross-audit SHALL memuat peta project (id, path checkout, arah + kind +
  note relasi), larangan menulis di luar worktree sendiri, dan contoh perintah menarik log; mode
  `backlog` SHALL menambahkan instruksi fase `Audit → Laporan` + dokumen audit SoT + push, mode
  `live` SHALL tidak memuat keduanya.
- **AC-10** — WHEN sesi `cross-audit` backlog menulis `Laporan done`, THE stage backlog SHALL menjadi
  `done` (cermin ADR-0057, tak tertahan di `executing`).
