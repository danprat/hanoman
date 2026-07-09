# ADR-0018 — Coverage diturunkan saat dibaca, bukan disimpan

**Status:** accepted · **Date:** 2026-07-09 · **Spec:** SPEC-141

## Context
[ADR-0011](0011-docs-realtime-filesystem.md) memindahkan docs ke filesystem — "docs adalah
filesystem nyata, bukan salinan DB" — tetapi menyisakan `Project.coverage` dan
`Project.docStatus` sebagai kolom Postgres. Itu **disengaja**: design SPEC-011 memilih agar
`POST /scan` menyegarkan angka cache yang dibaca daftar project "without re-walking".

Harganya sebuah angka yang bohong di layar utama. Audit [SPEC-141](../operations/spec-141-overview-coverage-realtime-objective.md)
mengukurnya pada disk yang sama, detik yang sama: project yang baru ditambahkan tampil
`0% / broken` padahal nyatanya `100%`; setelah satu doc tak ter-link ditambahkan, Overview
tetap memamerkan `100% / ok` padahal nyatanya `92%`. Basi dua arah, dan setiap run hanoman —
yang memang menulis docs — membuatnya basi lagi.

## Decision
Buang kolom `Project.coverage` + `Project.docStatus`. `toProjectView()` menurunkan keduanya
dari `scanRepoDocs(repoDir)` setiap kali dibaca — fungsi yang sama yang sudah dipakai
`GET /projects/:id/docs`. `POST /projects/:id/scan` dihapus bersama tombol "Scan semua".
Agar N project tidak memblokir event loop, `git ls-files` pindah dari `spawnSync` ke
`execFile` async (terukur 96% dari biaya blocking).

## Consequences
- Satu sumber kebenaran: Overview dan Docs workspace tidak bisa lagi berselisih.
- `GET /projects` membayar satu scan per project (~19 ms, konkuren, non-blocking). Tanpa cache —
  memasang cache berarti memasang kembali salinan-yang-bisa-basi yang jadi sebab bug ini.
- `POST /projects/:id/scan` hilang dari kontrak API; web adalah satu-satunya kliennya.
- Membalik keputusan cache design SPEC-011 secara sadar; ADR-0011 kini berlaku utuh.
- Project tanpa `repoDir` tetap `0% / broken` — sama dengan nilai yang di-hardcode create hari ini.
- Metrik tak bergeser: `coverageOf` / `docStatusFor` / `linkedSetFrom` dipakai ulang tanpa diubah.
