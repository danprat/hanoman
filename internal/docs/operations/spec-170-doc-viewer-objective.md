# SPEC-170 — objective: lihat dokumen audit/spec/plan per backlog item

Fase **Objective** dari alur feature (brainstorm → objective → spec → plan → execute).
Dokumen ini mengunci *apa* dan *mengapa*. **Tidak ada perubahan kode di fase ini.**

- Sumber: backlog brief · prioritas tinggi
- Hilir: [spec/design](../../../docs/superpowers/specs/2026-07-11-spec-170-doc-viewer-design.md)
- Judul backlog: *Audit, Spec and Plan*

## Masalah

Agent (Claude Code headless per sesi) menulis empat jenis dokumen sepanjang alur:
audit (fase Audit alur QA), objective, spec/design, dan plan. Semuanya Markdown, tersebar
di `internal/docs/operations/spec-N-*.md`, `docs/superpowers/specs/…-spec-N-design.md`, dan
`docs/superpowers/plans/…-spec-N.md`.

Dashboard **belum punya cara membaca dokumen-dokumen itu per backlog item.** Yang ada hanya
`DocsWorkspace` — browser Source-of-Truth global yang tak terikat ke satu item, tak muncul di
Backlog maupun di Terminal. Untuk me-review hasil kerja agent (audit yang ia buat, spec yang ia
tulis, plan yang ia susun) manusia harus membuka file di editor, bukan di tempat ia bekerja:
kartu backlog dan sesi terminal.

Konsekuensi review yang paling penting terjadi **saat sesi masih hidup** — sebelum branch
`hanoman/spec-N` di-merge. Pada saat itu dokumen baru ada di **worktree sesi**
(`.worktrees/<id>`, gitignored), belum di repo utama. Endpoint docs yang ada hanya membaca repo
utama, jadi ia tak melihat pekerjaan in-progress sama sekali.

## Hasil yang diinginkan

Manusia bisa melihat isi audit, spec, dan plan yang dihasilkan agent, dengan:

1. **Tombol "lihat dokumen"** pada tiap backlog item (Backlog) dan tiap sel sesi (Terminal).
2. **Dialog preview** yang me-render Markdown agar mudah dibaca, mengelompokkan dokumen per
   jenis (audit, objective, spec, plan, brainstorm).
3. **Terlihat sejak sesi masih hidup**, tanpa menunggu merge: sumber dipilih *freshest-wins* —
   ada sesi hidup untuk item itu → baca worktree sesi; kalau tidak → repo utama.

Objective ini tidak menuntut penambahan skema, tabel, atau kolom apa pun. Dokumen adalah berkas
di disk; kaitannya ke backlog item sudah tersedia lewat konvensi nama `spec-N`.

## Batas (non-goals)

- **Bukan editor.** Preview read-only; pengeditan tetap urusan `DocsWorkspace`.
- **Bukan diff/preview perubahan kode.** SPEC-144 (run-changes-preview) sudah dicabut; ini
  hanya menampilkan berkas dokumen `.md`, bukan diff.
- **Tidak menambah metadata path di DB.** Penemuan berkas dilakukan runtime dari nama file.
- **Tidak menampilkan berkas non-`.md`.** Guard `docAbsPath` yang ada hanya mengizinkan `.md`;
  audit/spec/plan semuanya `.md`, jadi cukup.
