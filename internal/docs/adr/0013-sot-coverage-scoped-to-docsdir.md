# ADR-0013 — SoT coverage dihitung atas `docsDir`, dengan reachability transitif

**Status:** accepted · 2026-07-09 · menggantikan kalimat coverage di ADR-0001

## Konteks
SPEC-011 mengunci korpus docs sebagai setiap `**/*.md` di repo. `scanRepoDocs` lalu menghitung
coverage sebagai persentase **seluruh** direktori markdown yang ter-link dari index — sehingga
`docs/superpowers/plans`, `docs/superpowers/specs`, readme vendored, dan root `README.md`/`AGENTS.md`
ikut dituntut ter-index. Tak satu pun dari mereka Source of Truth. Repo ini terukur 75% padahal
`internal/docs/**` 100% bersih.

Terpisah dari itu, "linked" punya dua definisi: `cli/src/verify.ts` memakai `parseIndex` (hanya link
langsung dari index root), `server/src/services/scan.ts` memakai `linkedSetFrom` (BFS transitif).
Keduanya kebetulan sepakat hari ini. Begitu ada doc yang di-link lewat sub-index, dashboard hijau
sementara Stop hook memblokir.

## Keputusan
1. Denominator coverage = file di bawah `docsDir` (default `internal/docs`), dikurangi index root
   `docsDir/README.md`. Markdown lain tetap dibrowse dan diedit lewat dashboard, tapi ditandai
   `scored: false` dan tidak dinilai.
2. `linkedSetFrom` (transitif) menjadi satu-satunya penentu linked/unlinked, di server maupun CLI.
   `parseIndex` bertahan hanya untuk mendeteksi dangling link dan menulis `docs index --fix`.
3. `walkDocs` berhenti mengecualikan `README.md`, karena `linkedSetFrom` hanya menelusuri link yang
   targetnya ada di korpus — tanpa ini sub-index tak pernah tertelusuri.

## Konsekuensi
- (+) Coverage mengukur SoT, bukan setiap direktori markdown yang kebetulan ada di repo.
- (+) Dashboard dan Stop hook memakai satu fungsi, jadi angkanya tak bisa berbeda.
- (+) Sub-index sah: 12 ADR cukup dilistkan di `adr/README.md`, bukan di index root selamanya.
- (−) Guardrail melonggar. Sebelumnya tiap doc wajib di-link **langsung** dari index root.
- Tanpa perubahan skema, tanpa migration, tanpa dependency baru.
