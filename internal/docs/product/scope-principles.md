# Scope principles

- **SoT konvensi.** `internal/docs/**` tetap Source of Truth secara konvensi — diperbarui dalam commit yang menyentuhnya. Guardrail mekanis dicabut (ADR-0023); coverage tetap dilaporkan, tak lagi memblokir.
- **Manusia terakhir yang memutuskan.** Otomasi penuh boleh, tapi selalu bisa diinterupsi.
  **Kecuali project yang meng-opt-in hanoman-lead** (SPEC-409 · [ADR-0091](../adr/0091-hanoman-lead-agen-pemimpin.md)):
  di sana prinsipnya menjadi **"manusia terakhir yang bisa membatalkan"** — lead memutuskan lalu
  melapor, dan pengamannya di belakang (jejak keputusan yang bisa ditelusuri, tombol ambil alih,
  batas kerusakan yang keras, notifikasi saat putusan berbobot). Ini **opt-in per project**,
  default mati; selama `Setting.lead.enabled` mati, prinsip lama berlaku di seluruh workspace.
- **Satu workspace dulu** (nafanesia.id). Multi-tenant adalah pasca-MVP.
- **Ragu? Dokumentasikan.** (Gunung Dronagiri.)
