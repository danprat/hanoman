# PRD (detail) — hanoman

Turunan terukur dari `entrypoints/prd.md`.

## 1. Overview
- Tampilkan KPI: sesi aktif, perlu perhatian, docs on-convention (rata-rata coverage), spec di backlog, indikator limit.
- Panel: perlu perhatian, sesi live (stage), docs coverage per project, ringkas backlog, aktivitas.
- Semua baris deep-link ke bagian terkait.

## 2. Projects
- Daftar (list) project: nama, kind (from-scratch/existing), sesi aktif + stage, coverage docs, backlog + top stage, aktivitas.
- Cari (filter), pagination, tambah project, buka SoT project.

## 3. PRD (SPEC-210 · ADR-0041)
- PM/PO menulis brief + brainstorm interaktif → dokumen PRD `docs/prd/<slug>.md` (bukan entitas DB).
- **Create**: "PRD baru" membuka sesi `flow:"prd"` (project-level, worktree isolasi); brainstorm satu
  pertanyaan per giliran, lalu tulis PRD terstruktur, push branch `prd/<slug>`, manusia merge.
- **Preview**: daftar PRD per project (freshest-wins: worktree sesi hidup > repoDir), render markdown untuk review.
- **Take ke backlog**: satu klik → `NewSpecModal` (brief) ter-prefill dari PRD; tautan PRD di teks Konteks.

## 4. Backlog
- Spec dari brief/QA, badge sumber & prioritas, stage bar lifecycle.
- Filter by project + tab sumber, pagination.
- Aksi per spec sesuai tahap: kunci objective → tulis spec → buat plan → execute → buka sesi; hapus.

## 5. Terminal (sesi interaktif)
- Grid multi-pane sesi `claude` di tmux; ambil backlog; reopen sesi `done` (lanjut fase Execute).
- **Git worktree**: tiap sesi di `.worktrees/<spec>` dari `branchFrom` (default `main`); integrasi (rebase/merge) ke target dipicu manual.
- **Kendali manusia**: steer & interupsi langsung di TTY; sesi hidup lintas restart API (tmux, ADR-0016).
- **Stage live**: diturunkan dari phase-file sesi (`$HANOMAN_PHASE_FILE`), bukan status run.

## 6. Docs · SoT
- Index kategori (tree) + coverage; preview markdown ter-render (bukan plain text); edit + simpan (persist).
- Render file non-markdown (JSON/TOML) sebagai blok kode. Sertakan agents/ (AGENTS.md, CLAUDE.md, README.md, .claude, .codex).

## 7. VPS
- Daftar VPS + audit/harden (script bash deterministik, `sudo -n bash -s` lewat ssh); `hardened` = semua check kritis pass.
- Buka sesi `claude` berkonteks VPS (cwd `$HOME`). Bootstrap key sekali pakai dari password (dibuang setelah dipasang).
- Test connection (`ssh true` key-only, transien) & Open Console (shell ssh mentah di tmux hanoman, ADR-0042) per VPS (SPEC-211).

## 8. Settings
- **Model & effort** satu per sesi, default opus · effort x-high; manusia bisa `/model` di terminal.
- auto-default; auto-scaffold doc index; notifikasi gagal & selesai (+ sound). Tanpa anggaran harian / konkuren maks (hilang bersama runner headless).
