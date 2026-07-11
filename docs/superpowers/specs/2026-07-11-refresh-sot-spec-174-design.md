# SPEC-174 — Perbaharui Source of Truth

**Status:** design · 2026-07-11 · prioritas tinggi · sumber brief

## Masalah (akar)

Arsitektur hanoman sudah **pivot**: dari model *queue/worker + runner spawn `claude` headless per-run + GitHub webhook + scheduler + trigger + dailyBudget* menjadi **sesi `claude` interaktif di tmux, satu per backlog** (ADR-0024/0015/0016/0023). Tapi Source of Truth di `internal/docs/**` masih menggambarkan **dunia lama sebagai kondisi sekarang**, menyebar di banyak dokumen.

Fakta kode hari ini (terverifikasi):
- Server **Fastify**; realtime = **WebSocket khusus terminal** + **HTTP polling** untuk sisanya. **Bukan SSE.**
- Route terdaftar: `health, auth, projects, specs, docs, terminal, vps, fs, settings, notifications, limits`. **Tidak ada** `/runs`, `/triggers`, `/webhooks`.
- **Tidak ada** BullMQ/Redis/queue/worker. Latar belakang hanya dua `setInterval` (VPS health 5 mnt, audit 24 jam).
- `runner/src/*` adalah **library** (git worktree, prompt, safety), bukan proses. Eksekusi nyata = `server/src/services/pty.ts` men-spawn `claude` interaktif di tmux (socket `-L hanoman`).
- **7 model Prisma**: Project, Spec, Setting, Notification, User, Session, Vps. **Tidak ada** `Run` maupun `Trigger` (migrasi drop `Run`/`DocFile`/`ProjectCoverage`).
- Fase = **giliran dalam satu sesi**; agen `echo "<Fase> done" >> $HANOMAN_PHASE_FILE`, server menurunkan stage dari file itu. Stage forward-only kecuali revert human eksplisit.
- Biaya = estimasi, tidak menggerakkan apa pun; tidak ada `dailyBudget` aktif (ADR-0012/0024). Limit dibaca langsung dari OAuth usage API (ADR-0024).

Tidak ada kode yang **membaca** dokumen SoT (coverage hanya mengecek reachability dari index) — jadi rewrite/prune aman terhadap runtime.

## Tujuan (objective)

`internal/docs/**` kembali menjadi SoT yang **akurat, rapi, dan up-to-date** terhadap codebase: buang artefak yang tak relevan, perbaiki setiap klaim usang, dan sinkronkan index. Setelah selesai: tak ada dokumen yang menyebut `Run`/`Trigger`/BullMQ/Redis/webhook/scheduler/dailyBudget sebagai mekanisme aktif; tak ada tautan index yang putus; tak ada nomor ADR bertabrakan; coverage SoT tetap hijau.

## Keputusan scope (disetujui)

1. **operations/spec-\*** (25 artefak per-backlog: `*-objective/-audit/-spec.md`) → **DIHAPUS**. Keputusannya sudah hidup di ADR + kode; bukan SoT hidup. Hanya 4 dokumen ops hidup yang tinggal: `roadmap`, `gtm`, `production`, `agent-documentation-workflow`.
2. **Stub tipis** (`research/*`, `business/*`, dll) → **DIPERTAHANKAN**, hanya perbaiki klaim usang (mis. `pricing-rationale` "anggaran harian"). Menjaga jejak "kenapa".

## Rencana perubahan

### A. Rewrite dokumen arsitektur (inti tugas) — akurat ke kode
- `architecture/stack.md` — tabel stack + diagram sistem + bagian eksekusi. Buang Queue/BullMQ/Redis/Scheduler/Webhook/headless. Gambarkan: Fastify, PTY/tmux, node-pty, ws (terminal) + HTTP polling, Prisma/Postgres, `runner` sebagai library, eksekusi = sesi interaktif, fase = giliran.
- `architecture/data-model.md` — 7 model nyata. Hapus seksi `Run` & `Trigger`. Sesuaikan Project (repoDir/stack/kind, tak ada repoUrl/docStatus-as-col), Settings (tanpa dailyBudget aktif).
- `architecture/api-contract.md` — route nyata saja. Hapus `## Runs`, `## Triggers`, `## Webhook`. Tambah `/limits`, `/fs/browse`, `/specs/:id/docs`, `/terminal/sessions/:id/phases`. Ganti "REST + SSE" → REST + WS(terminal) + polling.
- `architecture/nfr.md` — buang cutoff `dailyBudget` & "kelebihan → queued"; ganti dengan realitas (isolasi worktree, interupsi via tmux, durabilitas Postgres).

### B. De-stale dokumen pendukung (edit bedah)
- `frontend/frontend-implementation.md` (280L) — buang kolom "Failed", retry re-enqueue, SSE `GET /runs/:id/log`, state run `queued|running|paused`. Ganti ke: screen nyata, WebSocket terminal (xterm), polling, stage bar dari phase file.
- `operations/production.md` — buang stack Redis/worker/RUN_ID_FLOOR; gambarkan prod nyata (Postgres, tmux, bind 127.0.0.1 + reverse proxy TLS, dua interval VPS).
- `operations/roadmap.md` — buang "v1.0 = runner headless, webhook, scheduler" (arah yang dibuang).
- `operations/agent-documentation-workflow.md` — buang seksi "GitHub App + webhooks", "Worker credentials", ".worktrees/<run-id>", "commit + push ke branchTo" headless; selaraskan ke sesi interaktif.
- Buang bahasa **"SoT ditegakkan/suci"** (kontradiksi ADR-0023) di: `product/blueprint.md`, `product/scope-principles.md`, `entrypoints/brd.md`, `operations/gtm.md`.
- Buang **dailyBudget** sebagai kontrol aktif di: `requirements/prd.md` §7, `business/pricing-rationale.md`, `business/brd.md`, `security/security-standard.md`.
- Selaraskan istilah **"Run"/"Trigger"** → sesi/terminal di: `entrypoints/{prd,frd,blueprint,rd}.md`, `requirements/prd.md`, `product/blueprint.md`.

### C. ADR = sejarah imutable, rapikan
- **Resolusi tabrakan nomor** (renumber file ber-SPEC lebih besar tiap pasangan ke nomor bebas berikut; nomor bebas: 0032, 0033):
  - `0018-branch-adalah-properti-backlog-item` (SPEC-143) → **0032**. `0018-coverage-nilai-turunan` (SPEC-141) tetap 0018.
  - `0030-notifikasi-backlog-selesai` (SPEC-180) → **0033**. `0030-spec-menyimpan-base-head-sha` (SPEC-176) tetap 0030.
  - Perbarui **semua** referensi inbound (grep `ADR-0018`/`ADR-0030`, judul di file, link di index, komentar `schema.prisma`, data-model, api-contract).
- **Anotasi status superseded** di header ADR & index untuk: 0001 (→0023), 0005/0010(sebagian)/0012/0017/0022 (→0024), 0009 (historis per 0023), 0006/0007 (de-facto usang karena 0024). Format satu baris: `**Status:** superseded by ADR-XXXX`.
- **Link ADR-0025** (VPS) yang orphan ke index.

### D. Fix link inbound ke artefak yang dihapus
- ADR `0018/0032-branch` & `0018-coverage` menautkan ke `operations/spec-143`/`spec-141`. Ganti tautan itu jadi teks polos (nama SPEC saja), karena target dihapus.

### E. Rebuild `README.md` (index)
- Sinkronkan 1:1 ke disk: hapus 25 baris `spec-*`, urutkan ADR menurun rapi, tandai yang superseded, sertakan 0025 & nomor 0032/0033, perbaiki tabel entrypoints (buang seksi "run/trigger" bila ada). Tak ada tautan putus, tak ada nomor ganda.

## Verifikasi (Execute)
Bukan TDD kode — verifikasi nyata:
1. **Link integrity**: tiap tautan relatif di semua `.md` `internal/docs/**` resolve ke file yang ada; tak ada nomor ADR ganda di disk & index.
2. **Coverage tetap hijau**: boot server terhadap DB throwaway (migrated), daftarkan project menunjuk repo ini, `GET /api/projects/:id/docs` → coverage tidak turun (semua kategori tetap reachable dari index).
3. **Grep sanity**: `grep -rE 'BullMQ|Redis|/runs|/triggers|/webhooks|dailyBudget|SSE' internal/docs` hanya menyisakan penyebutan historis (di ADR/roadmap "later"), bukan klaim mekanisme aktif.

## Non-goals
- Tak mengubah kode/aplikasi (murni docs). Tak menambah dokumen baru selain artefak plan/spec superpowers ini. Tak menyentuh `AGENTS.md`/`CLAUDE.md` root (di luar `internal/docs`, meski keduanya juga menyebut queue — catat sebagai follow-up, bukan scope SPEC-174).
