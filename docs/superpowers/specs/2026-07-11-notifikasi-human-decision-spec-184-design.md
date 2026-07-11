# SPEC-184 — Notifikasi Human Decision · Design

**Status:** approved · **Sumber:** brief (prioritas tinggi) · **Tanggal:** 2026-07-11

## Objective

Menambahkan notifikasi ketika sebuah sesi Claude berhenti **menunggu keputusan
manusia** (human decision): sound (berbeda dari nada "selesai"), toast, dan entri di
daftar lonceng. Sediakan setting untuk nada suara decision-nya. Tambahkan aksi pada
item notifikasi: decision → redirect ke terminal yang butuh keputusan; success
(backlog selesai) → buka terminal bila sesinya masih hidup, kalau tidak buka backlog
item-nya.

**Konteks (dari brief):** "Saat ini belum ada notifikasi masuk ketika ada human
decision sehingga saya harus mengecek 1 per 1 jika ada human decision."

## Keadaan sekarang

- **Notifikasi (SPEC-180):** model `Notification { specId @unique, title, projectId,
  createdAt, readAt }` — satu baris per backlog, dibuat **hanya** saat stage masuk
  `done` (`recordCompletion`, idempoten via `specId @unique`). Dibuat reaktif di
  poll: `GET /specs` (write-through ~3s) dan `advanceStage` saat sesi ditutup.
- **Frontend:** `NotificationsProvider` poll `GET /notifications` tiap 10s; item baru →
  toast + `playNotifySound(notifySound)`. `NotificationBell` menampilkan daftar +
  badge unread. Setting: toggle `notifyDone` + satu picker `notifySound` (14 nada).
- **Sesi terminal** hidup di tmux (`server/src/services/pty.ts`); server hanya
  menurunkan status `running`/`idle`. Pill `awaiting` / "Menunggu keputusan" **sudah
  ada** di `src/src/ds/components/feedback.tsx` tapi belum terhubung ke deteksi apa pun.
- **Claude Code** punya hook `Notification` (`notification_type`: `permission_prompt`,
  idle, `agent_needs_input`, …). hanoman sudah meng-*inject* hook lewat `--settings`
  (`guardSettings`) yang **merge** dengan hook milik user (ADR-0010).
- **Navigasi terminal** hari ini hanya `setProjectFilter(project)` + `setSection(
  "terminal")` — belum ada "fokus ke sesi X".

## Arsitektur

### 1. Deteksi decision — hook Claude → marker file → scan server

Sinyal berasal dari Claude sendiri (bukan scraping TUI). Saat sesi punya `decisionFile`,
`guardSettings` menyuntik dua hook (merge dengan PreToolUse yang sudah ada):

- `Notification` →
  `grep -qE '(idle|permission_prompt|agent_needs_input)' && echo waiting >> <decisionFile> || true`
  Hanya tipe notifikasi yang berarti "menunggu manusia" yang ditandai. Filter memakai
  `grep` atas payload JSON di stdin — tanpa dependency, tanpa `jq`.
- `UserPromptSubmit` → `: > <decisionFile>` — manusia menjawab ⇒ marker dikosongkan
  (episode keputusan selesai). Diperlukan agar keputusan **kedua** di sesi yang sama
  bisa memicu notifikasi lagi.

`decisionFile = ${repoDir}/.worktrees/.decisions/${sessionId}` — mengikuti konvensi
`phaseFilePath` (di dalam `.worktrees` yang sudah `.gitignore`, tak pernah mendarat di
branch). Dipasang untuk sesi **run (spec)** dan **reverse** — sesi yang manusia tak
selalu tongkrongi. Terminal biasa (cwd = repoDir, non-flow) **tidak** dapat marker.

Path disimpan sebagai opsi tmux `@hanoman_decision_file` (persis pola
`@hanoman_phase_file`) dan dibaca `listPanes` ke field internal `Pane.decisionFile`
(tidak diekspos ke `SessionInfo`/DTO publik).

**Scan server** (`scanDecisions()` di service notifications), dipanggil di awal
`GET /notifications` (poll 10s, global — bukan terfilter project):

```
awaiting: Set<sessionId>   // state modul, di-rebuild tiap scan
scanDecisions():
  live = sesi hidup yang punya decisionFile   // {id, specId, projectId, decisionFile}
  next = Set()
  untuk s di live:
    jika size(s.decisionFile) > 0:
      next.add(s.id)
      jika s.id belum di awaiting: catat s untuk dinotifikasi
  awaiting = next          // auto-prune sesi mati (tak muncul di `live`)
  untuk tiap s tercatat: buat notifikasi decision
```

Dedup = transisi **kosong→terisi** sekali per episode. Idle yang berulang (~tiap 60s)
menambah baris ke marker tapi `s.id` sudah di `awaiting` ⇒ tak dobel. Restart server:
paling banter satu notif ulang untuk keputusan yang masih terbuka (dapat diterima).

**Latensi:** notifikasi idle Claude muncul ~60s setelah Claude benar-benar bertanya —
trade-off yang diterima saat memilih pendekatan hook.

### 2. Data model (migration + ADR)

```prisma
model Notification {
  id        String    @id @default(cuid())
  type      String    @default("done")   // "done" | "decision"
  key       String?   @unique             // dedup selesai: "done:<specId>"; null untuk decision
  specId    String?                        // nullable: sesi reverse tak punya spec
  sessionId String?                        // target redirect ke terminal
  title     String
  projectId String?
  createdAt DateTime  @default(now())
  readAt    DateTime?
}
```

- `recordCompletion` tetap idempoten **persis** seperti sekarang — hanya key dedup
  pindah dari `specId @unique` ke `key @unique`: `create({ key: "done:"+specId, … })`
  + catch P2002. NULL berulang diizinkan Postgres pada kolom unique ⇒ banyak baris
  decision (key null) tak saling tabrakan. `recordCompletion` juga menyetel
  `sessionId` = id sesi turunan dari specId (`specId.toLowerCase().replace(/[^a-z0-9_-]/g,"_")`,
  sama dengan `idFor`) agar aksi "Buka" pada notif done bisa mengecek sesi masih hidup.
- Decision insert bebas (dedup di sisi scan via `Set`).
- **Migration hand-written** + `migrate deploy` per DB (`hanoman` & `hanoman_test`)
  dengan override env eksplisit (hindari `migrate dev` yang me-reset saat ada drift
  worktree tetangga). Kolom baru + backfill `key = 'done:'||specId` untuk baris lama +
  drop index unik lama `Notification_specId_key`.
- **ADR baru** mendokumentasikan perubahan skema (wajib per CLAUDE.md).

### 3. Sound + Settings

- `src/src/notifications/sound.ts`: fungsi sama, tak berubah bentuk. Nada decision
  **beda** dari selesai — default `alert` (vs `short`). Aset `.wav` sudah lengkap.
- `shared/src/entities.ts` `zSetting`: tambah `notifyDecision: boolean` (default true) +
  `notifyDecisionSound` (enum nada, default `alert`). `DEFAULT_SETTING` server ikut.
- `SettingsScreen` kartu "Sesi & notifikasi": +2 baris (toggle decision + picker nada +
  Preview), mirror baris `notifyDone`/`notifySound`.

### 4. Frontend — toast, ikon, aksi

- `NotificationsContext.tick`: item baru bercabang per `type`:
  - `decision` → `showToast("<spec/proj> · butuh keputusan", "warn", "git-merge")` +
    `playNotifySound(decisionSoundRef)`, dihormati toggle `notifyDecision`.
  - `done` → seperti sekarang (toast `ok` + `notifySound`, toggle `notifyDone`).
  - `soundRef`/`enabledRef` menjadi sepasang (done + decision).
- `NotificationBell`: ikon per tipe (decision = amber `git-merge`/`git-pull-request`,
  done = hijau `check-circle-2`) + tombol aksi per item:
  - **decision** → "Buka terminal": `onOpenNotification(n)` ⇒ App pindah ke Terminal,
    set project filter ke `n.projectId`, dan fokus `n.sessionId` ke grid aktif.
  - **done** → "Buka": jika `n.sessionId` masih ada di `listTerminals()` (sesi hidup) ⇒
    buka terminal + fokus; kalau tidak ⇒ buka Backlog (set project filter ke project spec).
- **Plumbing navigasi:** `App` memberi callback `onOpenNotification(n)` ke
  `NotificationsProvider`/`NotificationBell`, plus state `focusSession` yang diteruskan
  ke `TerminalScreen`. Efek `focusSession` di `TerminalScreen` menempatkan sesi ke grup
  aktif (`W.placeFirstEmptyInActive`).

## Data flow

```
Claude (sesi run/reverse) berhenti menunggu manusia
  └─ hook Notification → echo waiting >> .worktrees/.decisions/<id>
Server GET /notifications (poll 10s)
  └─ scanDecisions(): marker kosong→terisi & belum dinotif → INSERT Notification(type=decision, sessionId, specId?)
Frontend NotificationsProvider (poll 10s)
  └─ item decision baru → toast(warn) + sound(alert) → badge lonceng
User klik "Buka terminal" pada item
  └─ App: setSection(terminal) + setProjectFilter + focusSession=<sessionId>
Manusia menjawab di terminal
  └─ hook UserPromptSubmit → : > marker  (episode selesai; keputusan berikut bisa notif lagi)
```

## Error handling & edge cases

- Marker dir belum ada → `mkdirSync(recursive)` saat `createSession` (seperti phaseFile).
- Hook grep tak match → `|| true`, exit 0, tak memblok sesi.
- Sesi mati saat masih "awaiting" → hilang dari `live`, otomatis ter-prune dari `Set`.
- `done` action ke sesi yang sudah exited → fallback ke Backlog item.
- Baris Setting lama tanpa field baru → `.parse` mengisi default (pola SPEC-162).
- `recordCompletion` balapan (poll vs advanceStage) → catch P2002 pada `key` unik.

## Testing (TDD)

**Server:**
- `scanDecisions`: kosong→terisi = tepat satu notif; clear lalu terisi lagi = notif
  kedua; sesi mati ter-prune dari `Set`; sesi tanpa decisionFile diabaikan.
- `recordCompletion` idempoten via `key` (dua panggilan = satu baris).
- `guardSettings(cmd, decisionFile)` menyuntik hook `Notification` + `UserPromptSubmit`
  yang menunjuk `decisionFile`; tanpa `decisionFile` = hanya PreToolUse (tak berubah).
- Rute `GET /notifications` mengembalikan `type`/`sessionId`.

**Frontend:**
- `NotificationsContext`: item `decision` → toast `warn` + sound decision; `done` →
  perilaku lama; toggle masing-masing dihormati.
- `NotificationBell`: render ikon + tombol per tipe; decision → onOpen dgn sessionId;
  done sesi-hidup → terminal, done sesi-mati → backlog.
- `SettingsScreen`: baris decision (toggle + picker + preview) tersimpan.

## Yang di-skip (YAGNI)

- Deteksi untuk terminal biasa (non-flow, cwd = repoDir) — manusia sudah menongkronginya.
- Filter `notification_type` lebih halus dari grep substring.
- Menyimpan pesan/pertanyaan Claude di notifikasi — cukup tunjuk "butuh keputusan".

## Docs tersentuh (SoT)

- **Create:** ADR baru (perubahan skema Notification + hook decision). Link di
  `internal/docs/adr/README.md` (index) dalam commit yang sama.
- Design doc ini di `docs/superpowers/specs/`.
