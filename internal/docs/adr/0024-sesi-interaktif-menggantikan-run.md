# ADR-0024 — Sesi Claude Code interaktif menggantikan run

**Status:** accepted · **Date:** 2026-07-10 · **Spec:** SPEC-162

**Supersedes:** ADR-0005, ADR-0010, ADR-0012, ADR-0017, ADR-0022
**Melemahkan:** ADR-0008
**Bersandar pada:** ADR-0002, ADR-0015, ADR-0016

## Context

Sebuah backlog item dikerjakan lewat `Run`: baris Postgres, job BullMQ, dan `runOne` yang
men-spawn `claude -p --input-format stream-json` di sebuah worktree. Fase menjadi giliran —
runner mengirim satu prompt per fase dan menunggu tepat satu pesan `result`.

Seluruh mesin di sekitarnya ada untuk melayani proses tak berpenunggu itu: antrean durabel
(ADR-0005) supaya job selamat dari restart, `pendingAsk` + status `awaiting` (ADR-0022)
supaya agen bisa bertanya tanpa ada manusia di depan layar, `--resume` + `donePhases`
(ADR-0017) supaya run yang terputus melanjutkan dirinya, estimasi biaya (ADR-0012) supaya
run yang berjalan sendiri bisa diawasi.

Sementara itu jalur interaktif sudah berjalan penuh: `services/pty.ts` menjalankan `claude`
di dalam tmux (ADR-0016), satu sesi per backlog item (ADR-0015), dan layar Terminal sudah
memakainya. Ada dua cara mengerjakan hal yang sama.

## Decision

Pekerjaan dikerjakan Claude Code **interaktif** di dalam tmux. Satu sesi per backlog item,
di worktree-nya sendiri. Tak ada eksekusi headless, tak ada antrean, tak ada state run di
database.

Menekan Start pada sebuah backlog item membuat worktree `--detach` dari `branchFrom`, lalu
`tmux new-session` menjalankan `claude '<prompt>'` dengan prompt awal yang memuat objective
dan pipeline fase-nya. Sesi itu idempoten: menekan Start lagi menyambung ke `claude` yang
sudah jalan, bukan melahirkan yang kedua di atas worktree yang sama (ADR-0015).

**Fase tetap ada, tapi penggeraknya berpindah.** Di sebuah PTY tak ada batas giliran yang
terbaca mesin — yang mengalir cuma byte layar. Server karena itu tidak menyimpulkan "fase
selesai" dari gambar terminal, dan tidak pernah mengetik ke dalam pane. Agen yang melapor:
tiap kali sebuah fase ditutup, ia meng-append satu baris ke `$HANOMAN_PHASE_FILE`.

```
Brainstorm done
Objective done
Spec skipped
Plan skipped
Execute done
```

Append-only, bukan tulis-timpa: keadaan penuh selalu ada di berkasnya, jadi tak ada transisi
yang bisa terlewat saat server sedang tidak menonton. Dibaca dengan `split("\n")`, bukan
JSON — baris yang tak dikenali diabaikan, dan tak ada berkas cacat yang bisa menyandera
tampilan fase. Berkasnya hidup di `<repoDir>/.worktrees/.phases/<sessionId>`, **di luar**
worktree, sehingga `git add -A` milik agen tak mungkin men-stage-nya. Ini menghapus kelas bug
yang dulu memaksa `rmSync(DECISION_FILE)` dan `rmSync(ASK_FILE)` tanpa syarat sebelum commit.

Fase aktif **diturunkan, tidak disimpan**: fase pertama di `PIPELINES[flow]` yang belum
tercatat. Poll 500ms yang sudah berjalan di `pty.ts` untuk mendeteksi pane mati sekalian
membaca berkas itu dan menyiarkan frame `{ t: "phase", phases }` — hanya saat isinya berubah.
Tak ada kanal kedua, tak ada watcher baru, tak ada Redis.

Fase Execute di prompt menyuruh agen commit dan push sendiri ke `hanoman/<sessionId>`, memakai
kredensial git yang sudah ada di mesin. `DELETE /terminal/sessions/:id` membaca berkas fase
sekali terakhir — memajukan `Spec.stage` ke keadaan finalnya — lalu membunuh sesi dan membuang
worktree-nya.

## Consequences

- **Tak ada lagi yang berjalan tanpa penunggu.** Cron, webhook GitHub, dan commit status
  hilang bersama trigger. Setiap pekerjaan dimulai seorang manusia yang menekan Start.
- **Tak ada riwayat run.** Setelah sesi di-kill, yang tersisa adalah commit di `branchTo` —
  dan itu memang catatan yang sebenarnya. Migration `drop_run_trigger_github` membuang 5 baris
  `Run` yang ada, semuanya `done`.
- **Redis dan proses worker hilang seluruhnya.** Boot hanoman = satu proses API. `bullmq`,
  `ioredis`, `cron-parser`, `octokit`, dan `@octokit/auth-app` dicabut; layanan `redis` hilang
  dari `docker-compose.yml`.
- **`Spec.stage` hanya bergerak sejauh agen jujur melaporkannya.** Sebelumnya stage terikat
  fase yang benar-benar dijalankan runner (ADR-0008); sekarang terikat baris yang ditulis agen.
  Ini pelemahan yang disadari dan diterima — harganya dibayar untuk menghilangkan seluruh mesin
  orkestrasi. Agen yang lupa menulis berkas fase meninggalkan strip fase diam; terminalnya
  sendiri yang jadi kebenaran, dan ia selalu terlihat.
- **Kolom "Failed" di board backlog hilang.** Sebuah sesi tak punya status terminal yang
  terbaca dari luar. Yang gagal terlihat di terminalnya, bukan di sebuah pill status.
- Guardrail deny perintah berbahaya (`runner/src/safety.ts` + `cli hook pretooluse`) **tetap**
  dan terpasang di setiap sesi lewat `--settings`. Di bawah `--dangerously-skip-permissions`
  ia satu-satunya gerbang yang tersisa (ADR-0010 tetap berlaku untuk bagian ini).
