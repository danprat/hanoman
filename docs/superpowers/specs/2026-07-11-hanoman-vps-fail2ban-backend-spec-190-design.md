# SPEC-190 — VPS harden: fail2ban service tidak aktif (design)

**Tanggal:** 2026-07-11 · **Prioritas:** tinggi · **Sumber:** qa · **Memperluas:** SPEC-164 / SPEC-183 / ADR-0025

## Objective

Setelah tombol **Harden** dijalankan, service `fail2ban` benar-benar **aktif** —
bukan hanya terpasang. Bila fail2ban belum terpasang, harden memasangnya dulu;
bila terpasang tapi mati, harden menyalakannya. Audit berikutnya melaporkan
`fail2ban pass`.

## Konteks & akar masalah

`server/scripts/vps/harden.sh` §2 sudah **memasang** (`pkg fail2ban`) lalu
**mengaktifkan** (`systemctl enable --now fail2ban && systemctl restart fail2ban`)
service. Jadi jalur "install dulu + aktifkan" pada dasarnya sudah ada. Yang gagal
adalah **start-nya**, khusus di keluarga RHEL (termasuk OpenCloudOS).

Jail yang ditulis harden.sh:

```ini
# /etc/fail2ban/jail.d/hanoman.conf
[sshd]
enabled = true
maxretry = 3
bantime = 1h
findtime = 10m
```

Tidak ada baris `backend`. Default fail2ban `[DEFAULT] backend = auto` menurunkan
jail `sshd` ke **backend file** yang membaca `/var/log/secure`. Pada image RHEL /
OpenCloudOS minimal/fresh yang hanya memakai journald, berkas itu belum ada,
sehingga `fail2ban-server` **gagal mengonfigurasi jail sshd**:

```
Failed during configuration: Have not found any log file for sshd jail
```

→ `systemctl enable --now`/`restart fail2ban` mengembalikan non-zero → **service
tidak aktif** sesudah harden. Persis `actual` di SPEC-190.

Kenapa Debian/Ubuntu tidak kena: paket fail2ban Debian memasang
`/etc/fail2ban/jail.d/defaults-debian.conf` yang sudah mem-pin
`[sshd] backend = systemd`. Keluarga RHEL tidak punya default itu.

## Pilihan pendekatan

- **A — Pin `backend = systemd` di jail sshd hanoman (dipilih).** Satu baris di
  heredoc harden.sh. fail2ban membaca journald, tak perlu berkas log, start andal
  di semua distro yang didukung (semuanya systemd). Non-regresif di deb (sudah
  jadi default di sana; filter sshd RHEL/OpenCloudOS cocok karena unit-nya memang
  `sshd.service`). Root-cause, diff terkecil.
- **B — Buat `/var/log/secure` kosong sebelum start.** Ditolak: rapuh (rsyslog
  bisa menimpa/menghapus, tak menyelesaikan jail lain), dan melawan arah journald.
- **C — Deteksi start gagal lalu retry.** Ditolak: mengobati gejala, start akan
  gagal lagi dengan sebab yang sama.

## Perubahan

1. **`server/scripts/vps/harden.sh`** — tambah `backend = systemd` di blok
   `[sshd]` pada heredoc `hanoman.conf`. Tidak ada perubahan lain (install +
   `enable --now` + `restart` tetap; deteksi start-gagal → `step fail2ban fail`
   tetap jujur).
2. **`server/test/vps-os-family.test.ts`** — assert statis: harden.sh mem-pin
   `backend = systemd` untuk jail sshd (pola sama seperti assert `epol-release`
   yang sudah ada; harden.sh tak dijalankan penuh di CI karena butuh root +
   memutasi sistem — ceiling ini disengaja, SPEC-183).

## Testing / verifikasi

Tak ada VPS RHEL/OpenCloudOS untuk di-smoke; harden.sh butuh root + memutasi
sistem, jadi diverifikasi lewat assert statis (konsisten dengan SPEC-183).
Kontrak `STEP fail2ban ok|fail` tak berubah, sehingga `vps.route.test.ts`
(fake-ssh) tetap hijau. Boot server + curl endpoint vps memastikan lapisan TS tak
tersentuh regresi.

## Dampak dokumen (Source of Truth)

- `internal/docs/adr/0025-modul-vps-script-deterministik.md` — baris konsekuensi
  fail2ban diperjelas: jail sshd memakai `backend = systemd` agar start andal di
  RHEL/OpenCloudOS journald-only (SPEC-190).

## Non-goals

- Perubahan skema / API / frontend — tak ada; kontrak `CHECK`/`STEP` tak berubah.
- Jalur "fail2ban tak terpasang karena repo EPEL/EPOL gagal" — di luar scope
  `actual` (yang dilaporkan adalah service tidak aktif, bukan tak terpasang);
  tetap best-effort/non-fatal seperti SPEC-183.
