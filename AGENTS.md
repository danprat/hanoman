# AGENTS.md

Kontrak untuk **setiap agent** (Claude Code, Codex) yang bekerja di repo hanoman. Dibaca otomatis sebelum mengeksekusi apa pun. hanoman adalah **orchestrator + dashboard** workflow docs-driven untuk nafanesia.id: menyuruh Claude Code membangun project terhadap docs sebagai kebenaran, lalu memantau semua sesi dalam satu dashboard.

## Baca Dulu

Sebelum kerja produk, arsitektur, sesi, atau implementasi, baca skill project:

- `internal/skills/hanoman/SKILL.md`

Saat task cocok, pakai juga sub-skill yang lebih sempit:

- `internal/skills/hanoman-devops/SKILL.md` — deploy & operasi hanoman di server (VPS, systemd, TLS, update, sync).

Lalu baca hanya doc yang relevan dengan task dari index Source of Truth:

- `internal/docs/README.md`

Jangan mulai implementasi dari ingatan atau konteks chat saja kalau doc/skill project sudah ada.

## Aturan

1. **Docs adalah Source of Truth — secara konvensi** (ADR-0023). `internal/docs/**` menang atas ingatan/asumsi. Ragu → baca doc. Coverage tetap dilaporkan (`hanoman docs scan`), tapi **tak ada lagi gate/Stop hook yang memblokir** (guardrail SoT dicabut, SPEC-160).
2. **Perbarui docs yang tersentuh dalam commit yang sama** & tautkan di index (`internal/docs/README.md`). Bila doc acuan usang, perbarui dulu.
3. **Alur fitur:** spec → plan → execute. **Alur QA:** audit → keputusan → (spec → plan)? → execute — temuan kecil langsung execute, Spec & Plan ditandai `skipped` (ADR-0020/0040).
4. **Setiap sesi terisolasi di git worktree sendiri** (`.worktrees/<id>`, ADR-0002). Pull dari branch mana pun; integrasi (rebase/merge) ke target dipicu manual dari dashboard (ADR-0031). Jangan menyentuh worktree sesi lain; jangan pernah jalankan sesi di working tree utama.
5. **Guardrail perintah berbahaya dicabut** (SPEC-197, ADR-0037): sesi jalan `--dangerously-skip-permissions`, agen dipercaya penuh; isolasi worktree adalah satu-satunya batas keamanan. Jangan hidupkan kembali tanpa ADR baru.

## Eksekusi & Perintah

Pekerjaan dimulai dari **dashboard** sebagai **sesi `claude` interaktif** di tmux (`server/src/services/pty.ts`), bukan CLI headless — flow CLI lama (`spec/plan/execute/scaffold/reverse`) dan Agent SDK sudah dicabut (SPEC-162/ADR-0010/ADR-0024). Satu backlog = satu sesi (ADR-0015); fase = giliran dalam sesi (`echo "<Fase> done" >> $HANOMAN_PHASE_FILE`).

CLI `hanoman` adalah **biner produk** (paket npm global, SPEC-398/ADR-0087) — bukan lagi hanya operasi
docs. Ia tidak menjalankan flow agen apa pun:

```bash
hanoman [start]                         # jalankan hanoman: migrate deploy → server + dashboard
                                        #   --port <n> --host <h> --db <file> --no-migrate
hanoman doctor                          # prasyarat non-npm: node/git/tmux/CLI agen/izin tulis/aset web
hanoman update [--check]                # banding versi vs registry npm; `npm i -g hanoman@latest`
hanoman migrate-from-postgres --from <url> [--to <file>] [--dry-run] [--force]
hanoman docs scan [--json]              # laporan coverage + per-kategori (read-only)
hanoman docs index --check | --fix      # integritas index
hanoman docs link <path> [--category c] # tambahkan doc ke index
hanoman --version | --help
```

## Definition of done

- **Test yang tersentuh** hijau — `pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism`
  (atau sebut path test-nya langsung) dan typecheck paket yang tersentuh (`pnpm --filter ./server typecheck`).
  **`--no-file-parallelism` wajib** bila set-nya menyentuh test server: run tingkat-root tak
  menghormati `fileParallelism: false` milik project server dan test server berbagi **satu berkas DB**
  (`<db>.test.db` per checkout sejak SPEC-398/ADR-0086 — berkasnya tak lagi bisa di-*truncate* worktree
  tetangga dan dimigrasi otomatis `server/test/global-setup.ts`, tapi berkas test dalam paket yang sama
  masih men-seed ulang DB yang sama) — terukur di SPEC-397, set yang sama memberi **181 gagal palsu**
  paralel vs **736 lulus** serial. Sesi
  hanoman default `verifyScope=changed` (SPEC-376, ADR-0080): jangan menjalankan suite penuh,
  `pnpm -r typecheck`, atau build penuh sebagai rutinitas — mesin ini menjalankan beberapa sesi
  sekaligus. Perluas scope hanya bila perubahannya memang berdampak luas, dan katakan alasannya.
  Jebakan: `--changed` menyalakan `passWithNoTests`, jadi nol test **terlihat hijau**.
- Suite penuh (`vitest run --no-file-parallelism`) dijalankan **manusia** sebelum merge, bukan sesi.
- Docs yang tersentuh diperbarui + ter-link di `internal/docs/README.md`.
- Endpoint yang tersentuh diuji nyata di local (boot server + curl) **bila task menyentuh endpoint** —
  sekali di akhir, bukan tiap task.
- Diff bersih di worktree; siap push ke target branch.
