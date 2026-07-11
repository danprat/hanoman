# ADR-0025 — Modul VPS: tabel sendiri, script deterministik, tanpa queue

**Status:** diterima · 2026-07-10 · SPEC-164

## Konteks

hanoman perlu meng-audit, memantau, dan men-harden VPS milik pemilik workspace.
VPS bukan Project (Project berporos repoDir/worktree/git), dan pasca SPEC-162
tidak ada lagi queue/Redis untuk pekerjaan terjadwal.

## Keputusan

1. **Tabel `Vps` sendiri** (bukan Project kind baru) — migration `add_vps`.
2. **Audit, healthcheck, dan hardening adalah script bash deterministik** yang
   dikirim via `ssh … 'sudo -n bash -s' < script`. LLM tidak berada di jalur
   standar; sesi Claude interaktif hanya escape-hatch untuk kasus lanjutan.
3. **Penjadwalan via `setInterval` di proses server** (healthcheck 5 menit,
   audit 24 jam) — konsisten dengan arah SPEC-162, tanpa menghidupkan kembali
   queue. Loop hidup di `server.ts`, bukan `buildApp()`, sehingga test bebas timer.
4. **Kredensial:** key/agent milik mesin server; DB hanya menyimpan `keyPath`.
   `BatchMode=yes` menjamin tak pernah ada prompt password.
5. **Harden tidak pernah terjadwal** dan anti-lockout: allow port SSH sebelum
   enable firewall, `sshd -t` sebelum reload, verifikasi koneksi baru pasca-apply,
   `PermitRootLogin prohibit-password` bila user terkonfigurasi = root.

## Konsekuensi

- Status `hardened` = derivasi audit terakhir (semua check kritis pass) — bisa
  basi maksimal satu hari, atau segar setelah tombol Audit/Harden.
- Distro didukung: debian/ubuntu, keluarga RHEL, dan OpenCloudOS (dideteksi via
  `ID=opencloudos` eksplisit karena `ID_LIKE`-nya self-referential; diperlakukan
  sebagai RHEL, fail2ban dari repo EPOL — SPEC-183). Distro lain ditolak eksplisit
  (`os_supported` fail).
- Endpoint vps mewarisi postur tanpa-auth + bind 127.0.0.1 (lihat ADR-0016 /
  komentar `routes/terminal.ts`).
