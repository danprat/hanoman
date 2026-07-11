# Business requirements — hanoman

## Masalah bisnis
Tim kecil nafanesia.id membangun banyak project dengan Claude Code. Tanpa kontrol, agent membangun di atas asumsi yang salah, docs cepat usang, dan tidak ada satu tempat untuk memantau semua sesi.

## Peluang
Menegakkan **docs-driven** + memusatkan monitoring menaikkan kualitas output agent dan kecepatan tim tanpa menambah headcount.

## Sasaran
- Docs dijaga segar secara konvensi — diperbarui dalam commit yang menyentuhnya (guardrail mekanis dicabut, ADR-0023).
- Semua project terpantau dari satu dashboard.
- Waktu dari brief → spec siap-plan < 1 hari.

## Non-goals (MVP)
- Multi-tenant / penjualan eksternal.
- Marketplace agent pihak ketiga.
