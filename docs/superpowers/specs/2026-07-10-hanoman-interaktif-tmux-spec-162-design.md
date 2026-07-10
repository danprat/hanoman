# SPEC-162 — Backlog → sesi Claude Code interaktif; runs dihapus

**Tanggal:** 2026-07-10 · **Status:** disetujui, belum diimplementasi

## Konteks

Sebuah backlog item dikerjakan lewat `Run`: baris Postgres, job BullMQ, dan `runOne`
yang men-spawn `claude -p --input-format stream-json` di sebuah worktree. Fase menjadi
giliran; runner mengirim satu prompt per fase dan menunggu satu `result`.

Mode itu ditinggalkan. Pekerjaan dikerjakan di Claude Code **interaktif**, di dalam
tmux — jalur yang sudah berjalan penuh di `server/src/services/pty.ts` (ADR-0016) dan
sudah dipakai layar Terminal. Konsekuensinya seluruh mesin di sekitar `runOne` —
queue, worker, Redis, trigger, webhook GitHub, tabel `Run` — kehilangan alasan untuk
ada.

## Keputusan

Backlog item punya tepat satu sesi tmux berisi `claude` interaktif di worktree-nya
sendiri. Tak ada eksekusi headless, tak ada antrean, tak ada state run di database.

### Yang dihapus

**runner/src:** `run.ts` (`runOne`), `phases.ts`, `phase.ts`, `turns.ts`,
`steer-queue.ts`, `claude-cli.ts`. Bertahan: `safety.ts` (guardrail deny perintah
berbahaya), `git.ts` minus `commitAndPush` + `switchBase`, `guardSettings`, dan
`types.ts` yang menyusut ke `Flow` + `GitOps`. Baru: `prompt.ts` — `PIPELINES` dan
`startPrompt(flow, spec)`, satu-satunya sisa dari `phases.ts`.

**server/src:** `worker.ts`, `queue.ts`, `redis.ts`, `schedules.ts`,
`schedule-parse.ts`, `fire-trigger.ts`, `routes/runs.ts`, `routes/triggers.ts`,
`routes/webhooks.ts`, `github/**`, `runner/events-io.ts`, `runner/credentials.ts`,
`services/run-changes.ts`, `services/id.ts` (`nextRunId`; `nextSpecId` bertahan).

`services/stage-machine.ts` **tidak** dihapus — `project-view.ts` memakainya, dan
`Spec.stage` tetap cermin fase (ADR-0008).

**Skema:** `DROP TABLE "Run"`, `"Trigger"`, `"GithubInstallation"`; kolom
`Project.installationId` dan `Project.repoUrl`. `Setting.data.steps` (lima entri
model per fase) diganti satu `{ model, effort }`; `maxConcurrent` dan `askTimeoutMin`
dibuang.

**frontend:** `RunsScreen.tsx`, `TriggersScreen.tsx`, `lib/run-reduce.ts`.

**cli:** `commands/{qa,spec,plan,execute,scaffold,reverse}.ts`, `_run.ts`, `_deps.ts`.
Bertahan: `hook-pretooluse.ts` (ini `guardCommand` yang dipasang `pty.ts` — tanpanya
sesi di bawah `--dangerously-skip-permissions` tak punya gerbang sama sekali,
ADR-0010), `docs-*`, `repo.ts`, `config.ts`, `verify.ts`.

**dependensi:** `bullmq`, `ioredis`, `@octokit/*`; layanan `redis` di
`docker-compose.yml`.

### Memulai pekerjaan

```
POST /api/terminal/sessions { spec: "SPEC-162", flow: "feature" }
  1. spec  = prisma.spec.findUniqueOrThrow({ id })
  2. base  = spec.branchFrom ?? "main"
  3. realGit.addWorktree(repoDir, `${repoDir}/.worktrees/spec-162`, base)
  4. createSession(spec.projectId, worktree, { specId, flow, prompt })
       tmux new-session -d -s hanoman-spec-162 -c <worktree> \
         "HANOMAN_PHASE_FILE=<repoDir>/.worktrees/.phases/spec-162 \
          claude '<prompt>' --model <model> --effort <effort> \
                 --dangerously-skip-permissions --settings '<guardSettings>'"
  → 201 { id: "spec-162" }
```

`createSession` sudah idempoten: `getSession(id)` yang menemukan sesi hidup
mengembalikannya apa adanya. Menekan Start dua kali tidak melahirkan `claude` kedua di
atas worktree yang sama (ADR-0015). Worktree lahir `--detach` di commit `branchFrom`,
seperti sebelumnya (ADR-0002) — sesi tak pernah berjalan di working tree utama.

Model dan effort dibaca dari `Setting`, dipakai sebagai argv saat sesi lahir. Manusia
bebas mengetik `/model` di dalam terminal setelahnya; itu justru gunanya interaktif.

### Fase

Fase bertahan, tapi penggeraknya berpindah. Di PTY tak ada batas giliran yang terbaca
mesin, jadi server tak dapat — dan tidak akan — menyimpulkan "fase selesai" dari byte
layar, dan tak akan mengetik ke dalam pane. Agen yang melapor, server yang menonton.

Prompt awal memuat `PIPELINES[flow]` dan satu instruksi: setiap kali menutup sebuah
fase, **append** satu baris ke `$HANOMAN_PHASE_FILE`.

```
Brainstorm done
Objective done
Spec skipped
Plan skipped
Execute done
```

Append-only, bukan tulis-timpa: keadaan penuh selalu ada di berkasnya, jadi tak ada
transisi yang bisa terlewat dan server tak perlu watcher yang sempurna. Dibaca dengan
`split("\n")`, bukan JSON — tak ada yang bisa gagal parse. Baris yang tak dikenal
diabaikan.

Berkasnya hidup di `<repoDir>/.worktrees/.phases/<sessionId>`, **di luar** worktree,
sehingga `git add -A` milik agen tak mungkin men-stage-nya. Ini menghapus kelas bug
yang dulu memaksa `rmSync(DECISION_FILE)` dan `rmSync(ASK_FILE)` tanpa syarat sebelum
commit. Path masuk sebagai env di depan perintah tmux, bukan lewat flag `-e`, supaya
tidak bergantung pada versi tmux.

Fase aktif **diturunkan, tidak disimpan**: fase pertama di `PIPELINES[flow]` yang belum
tercatat `done` maupun `skipped`. `Spec.stage` tetap cermin fase dan hanya maju
(ADR-0008), ditulis saat server membaca berkas itu.

Yang ikut mati bersama orkestrasi fase: `steer` (manusia mengetik langsung),
`.hanoman-ask.json` + status `awaiting` (agen bertanya di terminal, manusia menjawab di
sana — SPEC-157, ADR-0022 tak berlaku lagi), dan `.hanoman-decision.json` (jalur cepat
qa jadi keputusan agen yang dilaporkan sebagai `Spec skipped` / `Plan skipped`,
SPEC-145).

### Menutup pekerjaan

Fase Execute di prompt menyuruh agen commit dan push sendiri
(`git push origin HEAD:refs/heads/<branchTo>`) memakai kredensial git yang sudah ada di
mesin. Tak ada lagi `remoteUrl` bertoken yang disuntik server — `GithubInstallation`
dan `installationToken` sudah hilang, dan sesi interaktif memang berjalan sebagai
pengguna.

```
DELETE /api/terminal/sessions/spec-162
  1. baca berkas fase sekali terakhir → majukan Spec.stage ke keadaan finalnya
  2. tmux kill-session
  3. git worktree remove --force
```

### Kontrak API

| Endpoint | Perubahan |
|---|---|
| `POST /api/terminal/sessions` | terima `{ spec, flow }`; bentuk `{ run }` hilang, `{ project }` bertahan |
| `GET /api/terminal/sessions/:id/phases` | **baru** → `{ flow, phases: [{ name, state }] }` |
| `DELETE /api/terminal/sessions/:id` | ikut membuang worktree |
| `/api/runs/**`, `/api/triggers/**`, `/api/webhooks/**` | dihapus |

Realtime menumpang WebSocket terminal yang sudah ada. Poll 500ms di `pty.ts` — yang
sudah berjalan untuk mendeteksi pane mati — sekalian membaca berkas fase dan menyiarkan
frame baru `{ t: "phase", phases }` **hanya saat isinya berubah**. Tak ada kanal kedua,
tak ada watcher baru, tak ada Redis.

## Konsekuensi

- Tak ada lagi yang berjalan tanpa penunggu. Cron, webhook GitHub, dan commit status
  hilang bersama trigger; setiap pekerjaan dimulai seorang manusia yang menekan Start.
- Tak ada riwayat run. Setelah sesi di-kill, yang tersisa adalah commit di
  `branchTo` — dan itu memang catatan yang sebenarnya.
- Redis dan proses worker hilang seluruhnya. Boot hanoman = satu proses API.
- `Spec.stage` bergerak hanya sejauh agen jujur melaporkannya. Sebelumnya stage terikat
  fase yang benar-benar dijalankan runner; sekarang terikat baris yang ditulis agen.
  Ini pelemahan ADR-0008 yang disadari dan diterima: harganya dibayar untuk
  menghilangkan seluruh mesin orkestrasi.
- Agen bisa lupa menulis berkas fase. UI menampilkan fase apa adanya; fase yang tak
  pernah dilaporkan tampak `pending` selamanya. Terminalnya sendiri yang jadi kebenaran,
  dan ia selalu terlihat.

## ADR yang tersentuh

Ditulis saat implementasi: satu ADR baru yang men-supersede **ADR-0005** (queue durabel),
**ADR-0010** (runner men-spawn claude CLI), **ADR-0017** (run terputus melanjutkan
sesinya), **ADR-0022** (pertanyaan agen berstatus `awaiting`), dan **ADR-0012** (biaya
sebagai estimasi), serta melemahkan **ADR-0008**. **ADR-0002** (isolasi worktree),
**ADR-0015** (satu sesi per backlog), **ADR-0016** (sesi hidup di tmux) tetap berlaku
dan justru menjadi dasar desain ini.

## Test

Hapus: test runner (`run`, `phases`, `turns`, `steer-queue`), `worker`, `queue`,
`queue-durability`, route `runs`, `triggers`, `webhooks`, `fire-trigger`, `events-io`.

Tambah:

- `startPrompt(flow, spec)` — murni; memuat objective, pipeline flow-nya, dan instruksi
  berkas fase.
- `readPhases(file, flow)` — murni; menurunkan fase aktif dari baris `done`/`skipped`,
  mengabaikan baris sampah, dan tidak pernah melempar saat berkasnya belum ada.
- `POST /terminal/sessions { spec }` — membuat worktree + sesi; pemanggilan kedua
  mengembalikan sesi yang sama.
- `DELETE /terminal/sessions/:id` — worktree-nya benar-benar hilang.
