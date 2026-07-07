# PRD (detail) — hanoman

Turunan terukur dari `entrypoints/prd.md`.

## 1. Overview
- Tampilkan KPI: run aktif, perlu perhatian, docs on-convention (rata-rata coverage), spec di backlog, biaya runs.
- Panel: perlu perhatian, live runs (progress), docs coverage per project, ringkas backlog, triggers, aktivitas.
- Semua baris deep-link ke bagian terkait.

## 2. Projects
- Daftar (list) project: nama, kind (from-scratch/existing), status run + fase, coverage docs, backlog + top stage, triggers, aktivitas.
- Cari (filter), pagination, tambah project, buka SoT project.

## 3. Backlog
- Spec dari brief/QA, badge sumber & prioritas, stage bar lifecycle.
- Filter by project + tab sumber, pagination.
- Aksi per spec sesuai tahap: kunci objective → tulis spec → buat plan → execute → buka run; hapus.

## 4. Runs
- Daftar run + detail terfokus: pipeline fase, metrik (project/spec/trigger/durasi/token/biaya).
- **Git worktree**: pull dari branch mana pun → push ke branch mana pun (switchable).
- **Kendali manusia**: full-auto toggle, steer (sisip instruksi), interupsi/lanjut/hentikan; retry saat gagal.
- **Terminal interaktif**: perintah help/status/plan/files/steer/pause/resume/stop/docs/clear + histori.

## 5. Docs · SoT
- Index kategori (tree) + coverage; preview markdown ter-render (bukan plain text); edit + simpan (persist).
- Render file non-markdown (JSON/TOML) sebagai blok kode. Sertakan agents/ (AGENTS.md, CLAUDE.md, README.md, .claude, .codex).

## 6. Triggers
- Empat tipe: commit/schedule/manual/interval; target plan+execute / audit / scaffold docs. Toggle aktif; tambah.

## 7. Settings
- **Model per step** (brainstorm/spec/plan/execute/audit), default opus · effort x-high.
- Full-auto default; guardrail SoT (blok plan stale, wajib link, auto-scaffold); konkuren maks; anggaran harian; notifikasi gagal.
