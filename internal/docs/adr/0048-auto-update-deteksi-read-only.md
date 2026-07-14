# ADR-0048 — Auto-update: deteksi versi read-only, tanpa self-mutation

- Status: Diterima (SPEC-214, 2026-07-14)

## Konteks
hanoman prod = satu proses `node server/dist/server.js` (foreground, tanpa supervisor). Update hari
ini manual: `git pull --ff-only && pnpm build && pnpm prod`. Tak ada field `version` — identitas
versi = git commit SHA. Brief SPEC-214: sediakan tombol update saat versi berubah.

## Keputusan
1. **Versi = git SHA.** `runningBuildSha` ditanam saat build ke `server/dist/build-info.json`
   (`scripts/stamp-build.mjs`); server membacanya runtime. Absen (dev) → fallback checkoutSha.
2. **Sinyal update = keduanya.** Badge muncul bila `runningBuildSha ≠ checkoutSha` (kode di disk
   lebih baru dari app yang jalan) ATAU origin di depan checkout (setelah `git fetch` ter-gate).
3. **Read-only.** Server HANYA mendeteksi (`GET /api/update` + grup WS siar `update`) dan menampilkan
   perintah untuk disalin operator. Server **tak pernah** menjalankan `git pull`, `pnpm build`, atau
   restart. Working tree bersama sesi Claude tak pernah tersentuh; build tak menimpa dist yang disajikan.
4. **`git fetch` (satu-satunya jaringan)** di-gate `HANOMAN_UPDATE_FETCH=1`, di-set hanya di
   `server.ts` (boot nyata); throttle 5 menit. Test tak pernah fetch.

## Konsekuensi
- Nol risiko self-mutation; langkah "manual run" tetap ada tapi tanpa mengingat perintah / cek versi.
- Menghidupkan self-pull/self-build/self-restart butuh **ADR baru** + supervisor (systemd/pm2/wrapper).
- Tak ada perubahan skema; tak menghidupkan queue/scheduler/webhook (ADR-0024).
