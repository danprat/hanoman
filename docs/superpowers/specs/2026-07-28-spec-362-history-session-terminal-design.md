# SPEC-362 — History session terminal (+ paginasi)

**Tanggal:** 2026-07-28 · **Sumber:** brief · **Prioritas:** tinggi
**ADR:** 0077 (baru) · **Migration:** ya, aditif (`SessionHistory`)

## Objective

Terdapat history session di Terminal, dengan paginasi: operator bisa membuka kembali sesi yang
sudah berlalu dan memeriksa riwayatnya dengan mudah. Seluruh sesi tersimpan. Riwayat berada di
Terminal agar mudah diakses, **tanpa menghalangi UI terminal**.

## Konteks: kenapa ini bukan sekadar layar baru

`server/src/services/pty.ts` menyatakan tmux sebagai **satu-satunya sumber kebenaran** sesi
(ADR-0016): `listPanes()` membaca `tmux list-panes -a`, dan tak ada baris sesi di DB sama sekali.
Konsekuensinya hari ini:

- Sesi yang berakhir wajar tetap terlihat (`remain-on-exit on` → `exited: true`) **sampai** operator
  menekan `×`.
- `DELETE /terminal/sessions/:id` → `killSession()` + `realGit.removeWorktree()` → **tak ada jejak
  apa pun**: tak ada metadata, tak ada transkrip, tak ada cara membuka kembali.
- `SessionResult` (ADR-0047) **bukan** riwayat sesi. Ia lahir hanya saat transisi stage spec
  (`advanceStage` di `routes/terminal.ts:48`), jadi terminal biasa, shell, PRD, reverse, scaffold,
  breakdown, cross-audit, merge, dan konsol VPS tak pernah menghasilkan satu baris pun. Whitelist-nya
  juga **melarang transkrip PTY** ikut tersimpan.

Maka "history session semuanya tersimpan" mensyaratkan store persisten baru — dan karena itu
menyentuh skema, ia butuh migration + ADR (aturan `AGENTS.md` #4 / SKILL "Aturan Data & Skema").

## Keputusan desain

### 1. Model `SessionHistory` — LOCAL-only, append-on-birth

```prisma
model SessionHistory {
  id              String    @id            // uuid milik BARIS, bukan id sesi
  sessionId       String                   // id tmux (deterministik untuk sesi spec → berulang)
  projectId       String                   // tanpa FK: sesi VPS memakai "vps:<id>" (cermin SessionResult)
  specId          String?
  title           String?                  // snapshot judul spec saat sesi lahir
  kind            String                   // spec|reverse|prd|scaffold|breakdown|cross-audit|vps|shell|worktree|terminal
  flow            String?
  agent           String                   // claude|codex
  model           String?
  effort          String?
  branch          String?
  cwd             String
  startedAt       DateTime  @default(now())
  endedAt         DateTime?
  exitCode        Int?
  transcriptKey   String?                  // nama berkas di transcriptDir(); null = tak ada
  transcriptBytes Int?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([projectId, startedAt])
  @@index([specId])
  @@index([sessionId])
}
```

**PK bukan `sessionId`.** `sessionIdForSpec("SPEC-362")` selalu menghasilkan `spec-362`; satu backlog
yang dibuka-tutup lima kali menghasilkan lima baris riwayat dengan `sessionId` yang sama. Menjadikan
`sessionId` PK akan menimpa riwayat lama tiap reopen — persis kebalikan dari "semuanya tersimpan".

**Tanpa FK ke `Project`.** `routes/vps.ts:226/238` melahirkan sesi dengan `projectId` sintetis
(`vps:<id>`, `vps-console:<id>`). FK akan membuat sesi VPS gagal dicatat. `SessionResult` sudah
memakai konvensi yang sama (`projectId String` polos).

**LOCAL-only, tidak masuk record-sync.** Sesi hidup di tmux mesin ini dan transkripnya berkas di
disk mesin ini; menyiarkannya ke hub akan mengirim baris yang menunjuk berkas yang tak ada di sana.
Sejalan dengan `LocalBinding` (ADR-0043 dst.) dan `SchedulerQueueItem` (ADR-0072). Tak ada
`notifySynced()`.

**Baris lahir saat sesi lahir**, bukan saat ditutup — sehingga sesi yang sedang berjalan pun sudah
ada di riwayat (`endedAt: null`, badge "berjalan"). Kalau baris hanya lahir saat close, riwayat
berbohong selama sesi hidup, dan sesi yang hilang bersama tmux crash tak pernah tercatat.

### 2. Dua titik cekik di `pty.ts`, bukan 12 call site

`createSession()` dan `killSession()` adalah satu-satunya pintu lahir & mati sesi. Terverifikasi
seluruh pemanggil bermuara ke sana: `routes/terminal.ts` (8 cabang), `services/session-launch.ts:97`,
`routes/specs.ts:246`, `routes/ide.ts:293`, `routes/vps.ts:226/238`.

`pty.ts` **tetap nol dependensi DB**. Ia mengekspos:

```ts
export type SessionBirth = { id, projectId, specId?, flow?, kind, agent, model?, effort?, branch?, cwd };
export type SessionDeath = { sessionId: string; exitCode: number | null; transcript: string | null };
export function registerSessionHooks(h: { onBirth?, onDeath? }): void
```

`server.ts` mendaftarkan implementasi dari `services/session-history.ts` — pola
`registerSchedulerSource()` (SPEC-294). Pemanggilan hook **fire-and-forget + try/catch**: riwayat
tak boleh memblokir atau menggagalkan kelahiran/penutupan sesi.

Hook `onBirth` **tidak** dipanggil saat `createSession` mengembalikan `existing` (re-attach ADR-0015)
— re-attach bukan sesi baru.

`kind` diturunkan fungsi murni `sessionKind(opts, projectId, cwd)` di `pty.ts`, urutan:

1. `opts.specId` → `"spec"`
2. `opts.flow` → nilai flow (`reverse`/`prd`/`scaffold`/`breakdown`)
3. `id` diawali `xaudit-` → `"cross-audit"`
4. `projectId` diawali `vps` → `"vps"`
5. `opts.command` → `"shell"`
6. `cwd` mengandung `/.worktrees/` → `"worktree"` (sesi konflik merge/integrate)
7. selain itu → `"terminal"`

### 3. Transkrip: capture sebelum eksekusi, berkas di disk

`killSession()` menjalankan `capture-pane -p -J -S -50000` **sebelum** `tmux kill-session` — setelah
itu scrollback lenyap bersama pane.

- **Tanpa `-e`.** Warna dibuang. Yang disimpan teks polos: bisa dicari, aman dirender di `<pre>`,
  tak menyuntikkan ANSI ke DOM. (`attach()` untuk pane mati tetap memakai `-e` — itu replay live ke
  xterm, bukan arsip.)
- **`services/transcript-store.ts`**, cermin `services/uploads.ts`: `transcriptDir()` =
  `HANOMAN_TRANSCRIPT_DIR` ?? `<cwd>/data/transcripts`; `saveTranscript`, `readTranscript`,
  `deleteTranscript`. Nama berkas opaque (`<uuid>.log`), di-`basename` sebelum menyentuh disk.
- **Batas 1 MiB**, menyimpan **ekor**: yang paling berarti saat membaca ulang sesi adalah bagian
  akhir. Baris penanda `… <n> byte awal dipangkas …` disisipkan di atas bila terpangkas.
- Transkrip kosong / capture gagal → `transcriptKey: null`. Riwayat tetap tercatat.

### 4. API — paginasi di server, filter di DB

Semua di bawah prefix `/terminal` supaya **otomatis tergerbang** capability `sessions:read|write`
yang sudah ada (`services/agent-capabilities.ts:29`) — tak ada perubahan katalog capability.

| Endpoint | Keterangan |
|---|---|
| `GET /api/terminal/history?projectId=&specId=&kind=&q=&page=&limit=` | `Paginated<SessionHistoryView>`, urut `startedAt desc` |
| `GET /api/terminal/history/:id` | satu baris + `hasTranscript` |
| `GET /api/terminal/history/:id/transcript` | `{ text, bytes, truncated }`; 404 bila tak ada |
| `DELETE /api/terminal/history?projectId=&before=` | purge manual (butuh ≥1 parameter), ikut menghapus berkas transkrip |

`skip`/`take` di query DB **sah di sini**. Larangan ADR-0038 khusus `GET /specs`, yang memerlukan set
penuh untuk overlay stage live + write-through + notifikasi `done`. `GET /terminal/history` membaca
baris mati tanpa overlay apa pun, jadi memuat seluruh riwayat ke memori justru pemborosan.

Purge mencermin `DELETE /session-results` (ADR-0047): append-only, satu-satunya penghapusan adalah
purge manual ber-scope. Ini juga pagar pertumbuhan disk transkrip.

### 5. UI — modal di Terminal, tidak menghalangi

Tombol **"Riwayat"** (`leftIcon="history"`) di toolbar `TerminalScreen`, bersebelahan dengan "Ambil
backlog". Membuka `SessionHistoryModal` — pola yang sama persis dengan `BacklogPicker`
(`TerminalScreen.tsx:272`): overlay modal, grid terminal di belakangnya tak berubah ukuran, tak ada
panel permanen yang memakan lebar. Menutup modal mengembalikan layar apa adanya.

Isi modal:

- **Penyaring**: project, `kind`, pencarian (`q` → cocok ke `sessionId`/`specId`/`title`/`branch`).
- **Daftar**: waktu mulai (+durasi), project · `specId` · judul, badge `kind`, badge agen/model,
  status (`berjalan` / `selesai` / `exit <code>`), penanda 📄 bila punya transkrip.
- **Muat lebih**: `IntersectionObserver` auto-load + tombol manual sebagai fallback, baris penutup
  `N dari M riwayat` / `seluruh riwayat` — pola SPEC-351 (`GitGraph.tsx`) supaya daftar yang habis
  tak terbaca sebagai daftar yang terpotong.
- **Klik baris → detail**: metadata lengkap + transkrip read-only dalam `<pre>` bergulir, tombol
  **Salin** dan **Mulai lagi**.

**"Mulai lagi"** tidak pernah menghidupkan sesi lama — tmux sudah membunuhnya. Ia men-spawn sesi baru
dengan konteks yang sama, lewat endpoint yang sudah ada:

| kind | aksi | catatan |
|---|---|---|
| `spec` | `POST /terminal/sessions {spec, flow}` | idempoten by-id (ADR-0015) |
| `terminal` | `POST /terminal/sessions {project}` | agen di repoDir |
| `shell` | `POST /terminal/sessions {project, shell:true}` | |
| `reverse`, `scaffold`, `cross-audit` | `POST /terminal/sessions {project, flow}` | id deterministik |
| `prd`, `breakdown` | — | butuh `brief`/`prdPath` yang tak tersimpan di riwayat |
| `vps`, `worktree` | — | konsol VPS & worktree konflik tak punya arti "mulai lagi" |

`restartableKind(kind)` adalah fungsi murni di `@hanoman/shared`, dipakai UI untuk memutuskan tombol
muncul atau tidak — satu definisi, bukan dua daftar yang bisa hanyut.

### 6. Reconcile saat boot

tmux bisa mati di luar hanoman (`tmux kill-server`, reboot, `killAll()` di test). Baris dengan
`endedAt: null` yang `sessionId`-nya tak ada di `listSessions()` akan selamanya terbaca "berjalan".
`reconcileHistory()` dipanggil sekali saat boot server: baris `endedAt: null` yang tak punya pane
hidup → `endedAt = updatedAt` (waktu terbaik yang tersedia), `exitCode` tetap `null`. Cermin
`backfillFeed` saat hub boot (ADR-0067).

## Keamanan

- **Transkrip adalah data baru yang tersimpan di disk.** ADR-0047 dulu **sengaja** melarang transkrip
  masuk `SessionResult`; ADR-0079 membuka pengecualian **terbatas dan eksplisit**: hanya di store
  LOCAL-only, tak pernah masuk record-sync, tak pernah menyeberang ke hub.
- Endpoint tergerbang auth `/api` yang sudah ada (ADR-0028) dan capability `sessions` (ADR-0065).
- Transkrip bisa memuat isi kode, path, dan output perintah. Ia **tidak** memuat kredensial yang
  hanoman pegang (Keychain/`~/.claude/.credentials.json`/`Vps.keyPath` tak pernah dicetak ke pane),
  tapi transkrip tetap sekelas dengan isi repo — karena itu LOCAL-only + purge manual.
- Render `<pre>` teks polos (bukan `dangerouslySetInnerHTML`, bukan ANSI-ke-HTML).

## Testing

- **shared** (murni): `restartableKind`, katalog `SESSION_KINDS`.
- **pty**: `sessionKind()` murni untuk ketujuh cabang; hook `onBirth` tidak menembak saat re-attach.
- **transcript-store**: simpan/baca/hapus, pemangkasan >1 MiB menyimpan ekor + penanda, basename
  menahan traversal.
- **session-history service**: `beginSession` menulis baris; `finishSession` mengisi `endedAt`/
  `exitCode`/`transcriptKey`; `reconcileHistory` hanya menyentuh baris tanpa pane hidup.
- **route**: envelope paginasi (`page`/`limit`/`total`), filter `projectId`/`specId`/`kind`/`q`,
  transkrip 404 saat `transcriptKey` null, purge menolak tanpa parameter & menghapus berkas.
- **frontend**: modal merender baris; "Muat lebih" menambah (bukan mengganti); baris penutup berubah
  saat habis; "Mulai lagi" memanggil endpoint yang benar per `kind`; tombol absen untuk kind tak
  restartable; membuka modal tak membongkar grid terminal.
- **Smoke nyata** (wajib per CLAUDE.md): boot server + curl seluruh endpoint baru, termasuk sesi
  shell sungguhan yang dilahirkan lalu ditutup untuk membuktikan transkrip tertangkap.

## Non-goals

- Menghidupkan ulang proses sesi lama (mustahil — tmux sudah membunuhnya).
- Merekam transkrip **live** streaming ke disk selama sesi berjalan (snapshot saat tutup sudah cukup;
  streaming berarti menulis terus-menerus untuk sesi berhari-hari).
- Menyinkronkan riwayat/transkrip ke hub.
- Menghapus atau mengubah `SessionResult` — ia tetap activity log stage, dimensi yang berbeda.
- Retensi otomatis berbasis waktu (purge manual dulu; otomatis butuh knob & ADR sendiri).

## Docs yang tersentuh (commit yang sama)

`internal/docs/adr/0077-*.md` (baru) · `architecture/data-model.md` · `architecture/api-contract.md` ·
`frontend/frontend-implementation.md` · `security/security-standard.md` · `internal/docs/README.md`
(index) · `internal/skills/hanoman/SKILL.md`.
