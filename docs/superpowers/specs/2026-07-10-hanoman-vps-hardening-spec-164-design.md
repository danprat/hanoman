# SPEC-164 — Modul VPS: audit, healthcheck, hardening

**Tanggal:** 2026-07-10 · **Status:** disetujui, belum diimplementasi

## Konteks

hanoman mengelola pekerjaan berbasis repo (project → backlog → sesi Claude di tmux).
Pemiliknya juga mengelola beberapa VPS yang perlu di-hardening: audit dulu, lihat
kesehatannya, tahu mana yang sudah/belum di-hardening, dan bisa mengeksekusi
hardening — semuanya dari hanoman.

VPS bukan Project: Project berporos pada `repoDir`, worktree, dan scan docs. Memaksa
VPS ke tabel Project berarti meng-`if`-kan seluruh layar dan service yang berasumsi
git. Modul terpisah lebih murah daripada utang semantik itu.

Keputusan eksekusi (dari brainstorm): **semua jalur standar memakai script bash
deterministik via SSH** — audit, healthcheck, dan hardening. Sesi Claude Code
interaktif disediakan hanya sebagai jalur lanjutan untuk kondisi yang script tidak
tangani. OS yang didukung: **Ubuntu/Debian (apt/ufw) dan RHEL-family
(dnf/firewalld)**; distro lain ditolak dengan check `os_supported` FAIL.

## Keputusan

Modul VPS terpisah penuh: tabel `Vps` di Postgres (migration + **ADR-0025**), route
`/vps`, service SSH berbasis `spawn("ssh")` (nol dependensi baru), dua script bash
(`audit.sh`, `harden.sh`) dengan deteksi distro, screen VPS di frontend, healthcheck
berkala via `setInterval` di proses server.

### 1. Data model

```prisma
model Vps {
  id          String    @id @default(cuid())
  name        String
  host        String
  port        Int       @default(22)
  user        String
  keyPath     String?   // path key privat di mesin server; TIDAK PERNAH isi key di DB
  createdAt   DateTime  @default(now())
  lastSeenAt  DateTime? // healthcheck terakhir yang sukses
  health      Json?     // { uptime, disk, mem, load } dari healthcheck terakhir
  lastAuditAt DateTime?
  audit       Json?     // [{ check, status: "pass"|"fail"|"warn", detail }]
  hardened    Boolean   @default(false) // derived dari audit terakhir, disimpan agar list murah
}
```

`hardened` dihitung ulang setiap audit selesai: `true` bila semua check **kritis**
pass. Kredensial SSH memakai key/agent milik mesin yang menjalankan server hanoman;
`keyPath` opsional per-VPS (diteruskan sebagai `-i`).

### 2. Transport SSH

Satu helper di `server/src/services/vps-ssh.ts`:

```
ssh -p <port> -o BatchMode=yes -o ConnectTimeout=10 [-i keyPath] \
    <user>@<host> 'sudo -n bash -s' < <script>
```

- `BatchMode=yes` — tak pernah minta password; koneksi hanoman selalu key-based.
- Script dikirim lewat stdin (`bash -s`) — tanpa scp, tanpa berkas tersisa di VPS.
- Audit & harden butuh root: user yang dikonfigurasi harus root atau punya
  **passwordless sudo**. Check pertama audit (`sudo_ok`) memverifikasi ini; bila
  gagal, check lain yang butuh root dilaporkan `fail` dengan detail "butuh sudo".
- Timeout proses ssh: 60 detik audit/healthcheck, 300 detik harden.
- Dieksekusi lewat injeksi deps (pola `runner/deps.ts`) agar route bisa dites dengan
  ssh palsu.

### 3. Audit — `server/scripts/vps/audit.sh`

Terjadwal harian + tombol manual. Deteksi distro dari `/etc/os-release` (`ID_LIKE`
debian → apt/ufw; rhel/fedora → dnf/firewalld). Output baris terstruktur, satu check
per baris, diparsing server:

```
CHECK sudo_ok pass
CHECK os_supported pass ubuntu 24.04
CHECK ssh_root_login fail PermitRootLogin yes
CHECK firewall pass ufw active
...
```

| Check | Kritis | Isi |
|---|---|---|
| `sudo_ok` | ya | `sudo -n true` berhasil |
| `os_supported` | ya | distro deb/rhel dikenali |
| `ssh_root_login` | ya | `sshd -T`: `permitrootlogin no` |
| `ssh_password_auth` | ya | `sshd -T`: `passwordauthentication no` |
| `firewall` | ya | ufw `Status: active` / firewalld `running` |
| `fail2ban` | ya | service fail2ban aktif |
| `auto_updates` | ya | unattended-upgrades / dnf-automatic.timer aktif |
| `ntp` | warn | `timedatectl`: NTP aktif |
| `open_ports` | warn | listener `0.0.0.0`/`::` di luar {port SSH, 80, 443} → daftar di detail |
| `pending_updates` | warn | jumlah security update tertunda |

Parser di `server/src/services/vps-audit.ts`: baris `CHECK <nama> <status> <detail…>`
→ array JSON; baris tak dikenal diabaikan. `hardened` = semua check kritis `pass`.

### 4. Healthcheck — ringan, tiap 5 menit

Perintah singkat via helper yang sama (tanpa sudo): uptime, disk root, memori, load.
Sukses → update `lastSeenAt` + `health`. Gagal connect → biarkan `lastSeenAt` basi;
UI menampilkan `unreachable` bila `lastSeenAt` lebih tua dari 2× interval.

Loop: `setInterval` di boot server (`app.ts`), interval 5 menit, plus audit otomatis
sekali sehari (setInterval 24 jam, jalan pertama saat boot bila `lastAuditAt` > 24
jam). Tanpa queue, tanpa Redis — konsisten dengan arah SPEC-162. Loop dimatikan di
`NODE_ENV=test`.

### 5. Harden — `server/scripts/vps/harden.sh`, manual saja

Hanya berjalan lewat klik tombol per-VPS; **tidak pernah terjadwal**. Idempotent —
aman dijalankan ulang. Urutan di dalam script:

1. Deteksi distro (sama dengan audit).
2. Pasang & aktifkan firewall — **allow port SSH aktif dulu** (port dikirim server
   sebagai env `SSH_PORT`), baru `ufw enable` / `firewalld` + allow 80/443.
3. Pasang & aktifkan fail2ban (jail sshd: maxretry 3, bantime 1h).
4. Aktifkan auto security update (unattended-upgrades / dnf-automatic.timer).
5. Set `PermitRootLogin no` + `PasswordAuthentication no` di drop-in
   `/etc/ssh/sshd_config.d/99-hanoman.conf`; **`sshd -t` wajib pass sebelum reload**
   — bila gagal, drop-in dihapus dan step dilaporkan fail.
6. Aktifkan NTP (`timedatectl set-ntp true`).

Perlindungan lockout: koneksi hanoman sendiri sudah key-based (BatchMode), sehingga
mematikan password auth tak bisa mengunci hanoman; setelah script selesai server
langsung membuka **koneksi SSH baru** untuk memverifikasi akses masih hidup, lalu
menjalankan audit ulang untuk memperbarui status. Respons endpoint memuat transcript
harden + hasil audit baru.

Yang **tidak** dilakukan script (jalur sesi Claude): membuat user, distribusi key,
mengganti port SSH, menyentuh service custom, menata ulang rule firewall yang sudah
ada.

### 6. Sesi Claude untuk kasus lanjutan

Tombol per-VPS membuat sesi tmux lewat service pty yang ada, cwd = home server,
dengan prompt awal berisi: nama/host/port/user VPS, perintah SSH siap pakai, dan
hasil audit terakhir. Sesi muncul di screen Terminal seperti sesi lain — pemilik bisa
memantau dan mengambil alih. Service pty saat ini mengikat sesi ke `projectId`;
dilonggarkan menjadi label pemilik generik (`vps:<id>` atau `projectId`) tanpa
mengubah perilaku sesi project.

### 7. API

| Route | Isi |
|---|---|
| `GET /vps` | daftar + status (health, hardened, lastSeenAt, lastAuditAt) |
| `POST /vps` | daftar VPS baru — zod: name, host, user, port?, keyPath? |
| `PATCH /vps/:id` · `DELETE /vps/:id` | ubah / hapus registrasi |
| `POST /vps/:id/audit` | jalankan audit sekarang, balas hasil parse |
| `POST /vps/:id/harden` | jalankan harden → verifikasi koneksi → audit ulang; balas transcript + audit |
| `POST /vps/:id/session` | buka sesi Claude tmux berkonteks VPS, balas `{ id }` |

DTO zod di `shared/src/dto.ts` (`zCreateVps`, `zVpsView`).

### 8. UI

Screen "VPS" baru di navigasi utama: tabel `nama · host · badge reachable · badge
hardened/belum/unknown (belum pernah diaudit) · umur audit terakhir`, tombol per
baris Audit / Harden / Sesi Claude. Klik baris → panel detail: hasil audit per check
(pass/fail/warn + detail), health terakhir, transcript harden terakhir bila ada.
Harden meminta konfirmasi (dialog) yang menyebut perubahan yang akan diterapkan.
Ikuti design system editorial/bone-paper/brass di `internal/docs/design-system/**`.

### 9. Keamanan hanoman

Endpoint harden & session = eksekusi remote. Mewarisi postur yang ada: server bind
`127.0.0.1`, tanpa auth (komentar sejenis `terminal.ts:13` dipasang di route vps).
Private key tak pernah masuk DB/log; transcript harden disimpan hanya di respons dan
`audit`/`health` JSON tak memuat rahasia.

### 10. Testing

- Unit: parser audit (`CHECK` → JSON, derivasi `hardened`, baris rusak), zod DTO.
- Route: `vps.route.test.ts` dengan ssh palsu via injeksi deps — daftar/audit/harden
  (termasuk harden yang gagal verifikasi koneksi ulang).
- Script: `bash -n` + shellcheck bila tersedia; smoke manual `audit.sh` terhadap
  localhost didokumentasikan di plan.
- Sesuai kebiasaan repo: setelah tiap task, boot server dan curl endpoint nyata.

### 11. Di luar cakupan

Provisioning VPS, manajemen banyak key/secrets vault, user management di VPS, ganti
port SSH, distro non-deb/rhel, auth untuk hanoman sendiri, notifikasi (mis. VPS
unreachable → alert) — bisa menyusul sebagai SPEC terpisah.
