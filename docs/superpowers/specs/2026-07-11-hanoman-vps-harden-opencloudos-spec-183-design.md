# SPEC-183 — Support VPS Harden OpenCloudOS (design)

**Tanggal:** 2026-07-11 · **Prioritas:** tinggi · **Sumber:** brief · **Memperluas:** SPEC-164 / ADR-0025

## Objective

hanoman bisa meng-audit dan men-harden VPS ber-OS **OpenCloudOS**, selain
Ubuntu/Debian dan keluarga RHEL yang sudah didukung. Setelah perubahan ini,
tombol Audit/Harden pada VPS OpenCloudOS menjalankan langkah yang sama seperti
pada RHEL (firewalld, fail2ban, dnf-automatic, sshd drop-in, NTP) dan
`os_supported` melaporkan `pass`.

## Konteks & akar masalah

Deteksi OS ada **hanya** di dua script bash deterministik (`server/scripts/vps/harden.sh`,
`audit.sh`); lapisan TypeScript hanya mem-parsing baris `STEP`/`CHECK` dan tak
pernah menyentuh distro. Keduanya memetakan keluarga distro lewat:

```sh
case "${ID:-} ${ID_LIKE:-}" in
  *debian*|*ubuntu*) FAM=deb ;;
  *rhel*|*fedora*|*centos*|*rocky*|*alma*) FAM=rhel ;;
  *) tolak ;;
esac
```

OpenCloudOS (distro turunan RHEL besutan Tencent) melaporkan os-release:

```
ID="opencloudos"
ID_LIKE="opencloudos"          # ← menunjuk dirinya sendiri, bukan "rhel fedora"
VERSION_ID="9.2"
PLATFORM_ID="platform:oc9"
```

Karena `ID_LIKE` self-referential, string `"opencloudos opencloudos"` tak pernah
cocok pola RHEL — sehingga harden gagal di precheck (`distro … tidak didukung`)
dan audit memancarkan `os_supported fail`. Ini persis alasan skrip installer
lain (tailscale, zerotier) harus meng-hard-code `ID == opencloudos`.

Secara tooling OpenCloudOS **identik dengan keluarga RHEL**: `dnf`/`rpm`,
`firewalld`, `systemd`, `dnf-automatic`, `timedatectl`. Satu-satunya beda yang
relevan: paket `fail2ban` tidak ada di repo dasar dan **`epel-release` tak
tersedia** di OpenCloudOS — padanannya adalah repo **EPOL** (paket
`epol-release`, ada di build system OpenCloudOS).

## Pilihan pendekatan

- **A — Perlakukan sebagai RHEL, dengan pola `*opencloudos*` eksplisit (dipilih).**
  Tambah `*opencloudos*` ke cabang `FAM=rhel` di kedua script; untuk fail2ban,
  pasang `epol-release` (bukan `epel-release`) khusus OpenCloudOS. Diff terkecil,
  memakai ulang seluruh jalur RHEL, tahan terhadap `ID_LIKE` yang aneh.
- **B — Andalkan `ID_LIKE`.** Ditolak: `ID_LIKE=opencloudos`, tak akan pernah cocok.
- **C — Keluarga `FAM=oc` sendiri dengan cabang penuh.** Ditolak: over-engineering;
  semua langkah sama dengan RHEL kecuali satu nama paket repo. YAGNI.

## Perubahan

1. **`server/scripts/vps/harden.sh`**
   - Cabang deteksi: `*rhel*|*fedora*|*centos*|*rocky*|*alma*|*opencloudos*) FAM=rhel`.
   - fail2ban repo: untuk `FAM=rhel`, bila `ID=opencloudos` pasang `epol-release`,
     selain itu `epel-release` (keduanya best-effort/non-fatal seperti sekarang).
2. **`server/scripts/vps/audit.sh`**
   - Cabang deteksi yang sama ditambah `*opencloudos*`.
   - Pesan `os_supported fail` diperbarui: `… — hanya keluarga debian/rhel/opencloudos`.
3. **Testability knob** — di kedua script, `. /etc/os-release` menjadi
   `. "${HANOMAN_OS_RELEASE:-/etc/os-release}"`. Default identik; hanya memungkinkan
   test menyuntik os-release palsu tanpa VPS nyata. (Skrip dikirim via `bash -s`
   stdin, jadi tak bisa `source` file sibling — knob env ini caranya.)

## Testing / verifikasi

Tak ada VPS OpenCloudOS untuk di-smoke; verifikasi lewat knob `HANOMAN_OS_RELEASE`.
Test baru `server/test/vps-os-family.test.ts` menjalankan `audit.sh` sungguhan
(non-root) terhadap fixture os-release:

- **opencloudos** → `os_supported pass opencloudos 9.2` **dan** memakai cabang RHEL
  (detail `auto_updates` menyebut `dnf-automatic`, bukan `unattended-upgrades`).
- **ubuntu** (regresi) → `os_supported pass ubuntu …` dan cabang deb
  (`unattended-upgrades`).
- **arch** (tak didukung) → `os_supported fail` lalu berhenti.

`harden.sh` butuh root + memutasi sistem, jadi tak dijalankan penuh di CI; ia
memakai blok deteksi identik (di-cover perilakunya oleh test audit) dan test
juga meng-assert statis bahwa harden memuat token `opencloudos` + `epol-release`.
Ceiling ini disengaja.

## Dampak dokumen (Source of Truth)

- `internal/docs/adr/0025-modul-vps-script-deterministik.md` — baris konsekuensi
  "Distro di luar debian/rhel-family ditolak" diperbarui: OpenCloudOS kini
  didukung sebagai RHEL-family (deteksi `ID=opencloudos` eksplisit; fail2ban via EPOL).

## Non-goals

- Distro lain (SUSE, Arch, Alpine) — tetap ditolak eksplisit.
- Perubahan skema / API / frontend — tak ada; kontrak `CHECK`/`STEP` tak berubah.
