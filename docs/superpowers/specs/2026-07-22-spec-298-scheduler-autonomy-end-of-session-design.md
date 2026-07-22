# SPEC-298 — Autonomy sesi scheduler + penanganan akhir sesi

> Status: design (2026-07-22). Daun #5 (terakhir) dari breakdown PRD scheduler otonom, di atas fondasi SPEC-294/ADR-0072.
> Sumber: `docs/prd/scheduler-auto-start-backlog-batch-errors-and-pick-triase.md` §Autonomy + §Akhir sesi & review + User Story #4/#7.
> Menutup kontrak fondasi yang ditandai "dikonsumsi daun #5": `Setting.scheduler.autonomy` + `SchedulerQueueItem.note`.

## Objective

Sesi yang diluncurkan scheduler berjalan dengan **klausa autonomy sesuai toggle** `Setting.scheduler.autonomy`:

- **`full-control`** (mengaktifkan `autoDefault` yang selama ini dorman) — sesi memutuskan sendiri di semua
  percabangan, **tak berhenti** bertanya, dan menembus seluruh fase sampai stage `done`.
- **`butuh-keputusan`** — di titik keputusan manusia, sesi **berhenti** (menulis marker SPEC-184 lewat hook
  Notification), lalu **`Notification` tipe `decision`** diterbitkan; sesi yang menunggu **tetap memegang slot**
  (pane hidup → terhitung `liveCount` governor).

Pada **akhir sesi scheduler**, subsistem me-**rekonsiliasi** tiap item antrean `launched`:

- **`done`** → hasilkan **ringkasan/diff review otomatis** (`SessionResult` + diff diturunkan `baseSha..headSha`),
  terbitkan **`Notification` tipe `done`**, **biarkan branch/worktree** untuk merge manual (ADR-0031) — **tak pernah
  auto-merge**; tandai item antrean `done`.
- **gagal/limit** (pane mati sebelum `done`) → tandai item antrean `failed` (+ `note` alasan), terbitkan
  **`Notification` tipe `fail` (tipe baru)**, **tanpa retry** (PRD non-goal).

Dibuktikan **unit test** + **curl** di local.

## Konteks & batas (yang sudah ada — tak boleh diubah)

Fondasi (ADR-0072) + daun #1–#4 (SPEC-295/296/297) menerbitkan kontrak yang leaf ini gantung aditif di atasnya:

- **Prompt** (`runner/src/prompt.ts`): `startPrompt`/`continuePrompt` menyuntik satu `AUTONOMY_CLAUSE`
  konstan (SPEC-187/ADR-0035) — "tembus fase, berhenti hanya untuk keputusan manusia sejati, tanyakan di
  terminal". Itu **persis perilaku `butuh-keputusan`** (cocok sesi manual berpengawas). Belum ada varian per-mode.
- **Peluncuran** (`services/session-launch.ts` `startSpecSession`): jalur bersama manual + governor. Set `baseSha`,
  reset `headSha=null` saat lahir; spawn `createSession` dengan `decisionFile` (hook SPEC-184 menulis marker saat
  agen surface pertanyaan).
- **Governor/engine** (`scheduler/governor.ts` + `engine.ts`): `drain(cfg, deps)` meluncurkan `deps.launch(item)`
  di bawah cap; `prodDeps.launch` memanggil `startSpecSession(spec, { flow })`. `cfg` (termasuk `cfg.autonomy`)
  tersedia di `drain`. `tick(now, deps)` = jalankan checker due → (kecuali Pause) `drain`. Tick memoll
  `listSessions()` → **loop selalu-hidup** (server.ts, `.unref()`), satu-satunya loop andal untuk sesi tak-berpenonton.
- **Deteksi `done` + notif done existing** (`live-specs.ts` + `routes/terminal.ts advanceStage`): `liveSpecs()`
  menurunkan stage dari berkas fase → `recordCompletion` (`Notification done`, idempoten `key:done:<specId>`);
  `advanceStage` (hanya saat **ada klien WS ter-attach**) membuat `SessionResult`. **Gap**: sesi scheduler **tak
  berpenonton** → `liveSpecs` (butuh klien events) & `advanceStage` (butuh terminal attach) **tak jalan andal** →
  ringkasan tak dibuat & (bila dashboard tertutup) notif done telat. Kegagalan runtime sesi **tak terdeteksi** sama
  sekali (poll pty hanya jalan saat ada attachment).
- **Notif decision existing** (`notifications.ts scanDecisions`): rebuild per scan dari marker terisi →
  `Notification decision`. Dipanggil `notificationsFeed()` (events loop / `GET /notifications`) — butuh pembaca feed.
- **Ringkasan/diff = turunan** (ADR-0019/0030/0047): `SessionResult` (whitelist ketat) = ringkasan; **diff tak
  disimpan** — diturunkan `baseSha..headSha` via `spec-review.ts` saat reviewer membuka. `Spec.baseSha` di-set saat
  launch; `headSha` = HEAD worktree (`realGit.headSha`).
- **Skema**: `SchedulerQueueItem.status` = `queued|launched|done|failed`, `note?` ("alasan gagal — diisi daun #5").
  `Notification.type` = `String` + zod enum di `@hanoman/shared` (bukan enum Prisma). `Setting.scheduler.autonomy`
  (`full-control|butuh-keputusan`, default `butuh-keputusan`) **sudah ada** sejak fondasi SPEC-294.

**Tanpa perubahan skema, migration, atau ADR baru** — konsisten pola daun (SPEC-295/296/297): murni aditif pada
kontrak fondasi. `Notification.type "fail"` = nilai enum String baru (cermin SPEC-249 `+error`, SPEC-253 `+ticket`),
`SchedulerQueueItem.note`/`status` sudah ada, `autonomy` sudah ada.

## Arsitektur

### 1. Klausa autonomy per mode — `runner/src/prompt.ts`

Tambah **varian klausa `full-control`** di sisi konstanta, dan **selektor** di `startPrompt`/`continuePrompt`:

```
AUTONOMY_CLAUSE            (ada — perilaku "berhenti untuk keputusan manusia; tanyakan di terminal")
AUTONOMY_CLAUSE_FULL       (baru — "kamu berjalan TANPA pengawas. Putuskan sendiri di setiap percabangan
                            —termasuk data model, kontrak API, scope—JANGAN berhenti bertanya (tak ada yang
                            menjawab). Tembus seluruh fase sampai `done`, commit, push. Jangan menunggu review/
                            persetujuan; catat asumsi & keputusan di commit/PR untuk di-review pasca-fakta.")

autonomyClause(mode?: "full-control" | "butuh-keputusan"): string
  = mode === "full-control" ? AUTONOMY_CLAUSE_FULL : AUTONOMY_CLAUSE
```

`startPrompt(flow, spec, branchTo, autonomy?)` & `continuePrompt(flow, spec, branchTo, autonomy?)` menerima
param opsional; menyuntik `autonomyClause(autonomy)` menggantikan konstanta langsung. **Default (undefined =
peluncuran manual) → `AUTONOMY_CLAUSE`** (perilaku lama, tak berubah — sesi manual berpengawas tetap boleh
bertanya). Tipe `Autonomy` didefinisikan lokal di `runner` (union string), tanpa dep baru ke shared.

### 2. Threading mode ke sesi scheduler — `session-launch.ts` + `governor.ts` + `engine.ts`

- `startSpecSession(spec, { flow, model?, effort?, autonomy? })` — teruskan `autonomy` ke `startPrompt`/
  `continuePrompt`. Field opsional; pemanggil manual (`routes/terminal.ts`) tak mengisinya → klausa lama.
- `GovernorDeps.launch` diperluas jadi `(item, autonomy?) => Promise<string>`; `drain` memanggil
  `deps.launch(item, cfg.autonomy)`. Mock test lama (arity 0/1) tetap kompatibel (arg ekstra diabaikan).
- `prodDeps.launch = (item, autonomy) => startSpecSession(spec, { flow: flowForSource(spec.source), autonomy })`.

Hasil: sesi scheduler `full-control` dapat klausa penuh-otonom; `butuh-keputusan` dapat klausa berhenti-di-keputusan
(→ hook marker → notif decision → tahan slot). Sesi manual tak tersentuh.

### 3. Notif fail (tipe baru) — `shared/src/entities.ts` + `notifications.ts`

- `zNotification.type` enum `+ "fail"` (satu nilai). Tak ada migration (kolom `String`).
- `recordFailure(specId, title, projectId, reason)` di `notifications.ts` — `key:fail:<specId>` idempoten
  (insert kedua kena P2002, diabaikan), `type:"fail"`, `sessionId = idFor(specId)` (buka sesi mati untuk baca log),
  judul memuat alasan ringkas. Cermin `recordCompletion`.

### 4. Rekonsiliasi akhir sesi — `services/scheduler/reconcile.ts` (baru) + `engine.tick`

Satu unit fokus, deps di-inject (teruji tanpa tmux/git/fs nyata — pola `GovernorDeps`):

```
type ReconcileDeps = {
  pane: (sessionId) => { exited: boolean; flow?: Flow; phaseFile?: string; cwd: string } | undefined
  deriveStage: (phaseFile, flow, cwd, specId) => Stage | null   // prod: stageForRun(readPhases(...),cwd,specId)
  headSha: (worktree) => string | null                          // prod: realGit.headSha (best-effort)
}

reconcile(deps): Promise<void>
  untuk tiap item antrean status "launched":
    spec = prisma.spec.findUnique(item.specId);  if !spec → skip
    p = deps.pane(item.sessionId)
    // stage LIVE diturunkan langsung dari berkas fase (independen pengawas) — bukan andalkan spec.stage
    let stage = spec.stage
    if p?.flow && p.phaseFile:
       d = deps.deriveStage(p.phaseFile, p.flow, p.cwd, item.specId)
       if d && STAGES.indexOf(d) > STAGES.indexOf(spec.stage):
          CAS spec.stage from→d (updateMany where stage=from) ; if count>0 → notifySynced("spec", id)
          stage = d
    if stage === "done":
       recordCompletion(specId, spec.title, projectId)                       // notif done (idempoten)
       if tak ada SessionResult(specId, newStage="done"):                    // dedup vs advanceStage
          recordSessionResult({ projectId, specId, newStage:"done", commitSha: headSha(p.cwd),
                                branch:`hanoman/${sessionId}`, status:"done" })   // ringkasan; diff turunan
       markDone(item.id)                                                      // TAK auto-merge
    else if !p || p.exited:                                                   // pane mati sebelum done = gagal/limit
       recordFailure(specId, spec.title, projectId, "sesi berakhir sebelum mencapai done (gagal/limit)")
       markFailed(item.id, reason)                                           // TAK retry
    else:  /* masih jalan / menunggu keputusan → biarkan launched (slot tertahan) */
```

`engine.tick` memanggil `reconcile(reconcileProdDeps)` **+ `scanDecisions()`** tepat sebelum `drain` (setelah
checker). Urutan: rekonsil menandai done/failed (slot mati sudah lepas dari `liveCount` tmux) lalu drain mengisi
slot kosong dalam ≤1 tick (ADR-0072). `scanDecisions()` di tick menerbitkan notif decision untuk sesi
scheduler **tanpa perlu dashboard terbuka** (loop selalu-hidup) — idempoten (dedup per-sesi), efek samping ke sesi
manual tak berbahaya. `reconcile` di-inject `noReconcile`/stub di test engine (default deps = prod).

## Invarian & idempotensi

| Kondisi | Perilaku |
|---|---|
| Sesi `full-control` capai `done` (pane idle/mati) | done sekali: notif done (`key`) + 1 `SessionResult` (dedup `newStage=done`) + markDone; item keluar dari himpunan `launched` → tick berikut skip. |
| Sesi `butuh-keputusan` menunggu keputusan (pane hidup, stage<done) | `reconcile` biarkan `launched`; `scanDecisions` terbitkan notif decision (dedup per-sesi); pane hidup → **tahan slot**. |
| Sesi mati sebelum `done` (crash/limit/kill) | failed sekali: notif fail (`key:fail:<specId>`) + markFailed(note); tick berikut skip. Tanpa retry. |
| `advanceStage` sudah buat `SessionResult` (operator sempat attach) | `reconcile` skip pembuatan (findFirst `newStage=done`) → tak dobel ringkasan. |
| Notif done sudah dibuat `liveSpecs` (dashboard terbuka) | `recordCompletion` idempoten `key:done:<specId>` → tak dobel. |
| Pane "gone" (di-kill / tmux hilang) + stage bukan done | cabang `!p` → failed. Bila `spec.stage` terlanjur `done` (di-persist sebelumnya) → done (ringkasan best-effort, commitSha bisa null). |

## Data flow

```
scheduler launch (governor.drain)
  └─ deps.launch(item, cfg.autonomy) → startSpecSession(spec,{flow,autonomy})
       → startPrompt(...,autonomy) : full-control → klausa penuh-otonom | butuh-keputusan → klausa berhenti-keputusan

engine.tick (selalu-hidup, .unref)
  ├─ checker due (backlog/errors/triase)              ← daun #1–#3
  ├─ reconcile(prodDeps)  per item "launched":
  │     done  → recordCompletion + SessionResult(ringkasan) + markDone     (diff turunan baseSha..headSha; NO merge)
  │     mati<done → recordFailure(Notification fail) + markFailed(note)     (NO retry)
  │     hidup<done → biarkan (tahan slot)
  ├─ scanDecisions()  → Notification decision utk sesi menunggu keputusan  (butuh-keputusan)
  └─ (kecuali Pause) drain → isi slot kosong ≤1 tick                        ← SPEC-294

review manual: GET /api/specs/:id/review (diff baseSha..headSha) · GET /api/session-results · merge via git graph (ADR-0031)
```

## Error handling

- `reconcile` per-item try/catch: satu spec gagal (worktree lenyap saat baca `headSha`) tak menghentikan sisanya;
  `headSha` best-effort → `commitSha` null (ringkasan tetap ada, diff jatuh ke `specCommitRange`).
- `recordFailure`/`recordCompletion`/`recordSessionResult` best-effort (`.catch`) — akhir-sesi tak pernah meng-crash tick.
- `reconcile` dibungkus di `engine.tick` (cermin `check()`), jadi exception tak menular ke `drain`.

## Testing

**Unit — `server/test/scheduler-reconcile.test.ts`** (pola `scheduler-governor.test.ts`, DB `hanoman298_test`, deps di-inject):
1. Item `launched` yang stage-nya `done` → `markDone` + `Notification done` + 1 `SessionResult(newStage=done, commitSha, branch)`; tick kedua tak dobel (SessionResult tetap 1, notif tetap 1).
2. Item `launched` pane `exited` & stage < `done` → `markFailed(note)` + `Notification fail`; tanpa `SessionResult`; tanpa retry (item tetap failed, tak di-relaunch).
3. Item `launched` pane hidup & stage < `done` → **tetap `launched`**, tanpa notif done/fail (menunggu keputusan/kerja).
4. Dedup ringkasan: sudah ada `SessionResult(newStage=done)` untuk spec → `reconcile` tak buat kedua.
5. Stage live > spec.stage tersimpan → CAS mem-persist `spec.stage=done` (independen pengawas) sebelum menilai done.
6. Pane "gone" (`pane→undefined`) & stage<done → failed.

**Unit — `runner/test/prompt-autonomy` (atau perluas test prompt)**:
7. `startPrompt(flow, spec, branch, "full-control")` memuat teks klausa penuh-otonom (mis. "TANPA pengawas"/"JANGAN berhenti"); **tak** memuat "tanyakan di terminal".
8. `startPrompt(...,"butuh-keputusan")` & `startPrompt(...)` (default) memuat klausa lama ("berhenti"/"tanyakan di terminal").

**Unit — `shared/src/*.test.ts` / `notifications`**:
9. `zNotification` menerima `type:"fail"`. `recordFailure` membuat 1 baris `type:"fail"` + idempoten `key:fail:<specId>` (panggilan kedua tak dobel).

**Unit — engine**: `tick` memanggil `reconcile` + `scanDecisions` (inject spy) sekali per tick sebelum drain; Pause tak menghentikan reconcile/scanDecisions (hanya drain). Master `enabled=false` → tick idle (tak reconcile).

**Regresi**: `session-launch.test.ts`, `scheduler-governor.test.ts`, `scheduler-engine.test.ts`, prompt existing → tetap hijau (param autonomy opsional; `launch` arity mundur-kompatibel).

**Curl smoke** (boot server ke DB throwaway ter-migrate, bukan `hanoman_test`):
- Seed: project opt-in + spec belum-mulai; enable scheduler `full-control` + backlog source (Pause untuk kontrol),
  atau simulasikan item `launched` + berkas fase `Execute done` + plan lengkap → boot-pass tick → `GET
  /api/scheduler/state` item `done`; `GET /api/notifications` memuat `type:"done"`; `GET /api/session-results`
  memuat baris `newStage:"done"`. Kasus fail: pane mati sebelum done → `GET /api/scheduler/state` item `failed` +
  `note`; `GET /api/notifications` memuat `type:"fail"`.

## Docs tersentuh (commit sama)

- `internal/docs/architecture/stack.md` — baris pipeline scheduler: tandai daun #5 (autonomy per-mode + rekonsiliasi
  akhir-sesi: done→ringkasan+notif done, gagal→notif fail, tanpa auto-merge/retry).
- `internal/docs/architecture/data-model.md` — §Setting `autonomy` kini dikonsumsi (klausa per-mode); §SchedulerQueueItem
  `note`/`status` diisi rekonsiliasi akhir-sesi; §Notification `type` `+ fail`.
- `internal/docs/architecture/api-contract.md` §Scheduler + §Notifikasi — catat `Notification type:"fail"`,
  rekonsiliasi akhir-sesi menerbitkan done/fail + `SessionResult`, tanpa auto-merge (merge manual ADR-0031).

Tak ada doc/ADR/migration baru → index `README.md` tak berubah (doc-doc di atas sudah ter-link).
