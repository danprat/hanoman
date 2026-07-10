# SPEC-165 — VPS: bootstrap key lewat password, dan edit registrasi

**Tanggal:** 2026-07-10 · **Status:** disetujui, belum diimplementasi
**Membangun di atas:** SPEC-164 (modul VPS), ADR-0025

## Konteks

Modul VPS (SPEC-164) hanya bisa menyentuh mesin yang koneksi SSH-nya sudah key-based:
`sshExec` memakai `BatchMode=yes`, yang justru melarang prompt password. Padahal VPS
baru dari provider hampir selalu datang dengan **password** dan belum punya
`authorized_keys`. Mesin seperti itu tak bisa didaftarkan sama sekali hari ini.

Selain itu registrasi VPS tak bisa diubah dari UI. Endpoint `PATCH /vps/:id` sudah ada
dan tervalidasi sejak SPEC-164; yang belum ada hanya afordansinya di layar.

## Masalah yang menentukan desain

`harden.sh` menulis `PasswordAuthentication no`. Bila hanoman sendiri login memakai
password, tombol Harden akan **mengunci hanoman keluar dari VPS itu, permanen**. Karena
itu password tidak boleh menjadi kredensial tetap. Menyimpan password di Postgres juga
bertentangan dengan prinsip SPEC-164: private key tak pernah masuk DB — password
plaintext jauh lebih buruk.

## Keputusan

Password adalah **input transien untuk bootstrap sekali pakai**: dipakai untuk memasang
public key milik hanoman ke `authorized_keys` VPS, diverifikasi, lalu dibuang. Tidak
pernah disimpan di database, log, atau response. Setelah bootstrap, seluruh jalur
(healthcheck, audit, harden, sesi Claude) memakai key seperti biasa — dan Harden aman
mematikan password auth.

Ini juga alur hardening yang benar: VPS baru datang dengan password, dinaikkan ke key.

### 1. Data model

**Tak ada kolom baru.** `password` hanya field di DTO create/patch, tak pernah
dipersistensi. Yang persisten tetap `Vps.keyPath` (sudah ada) — diisi oleh bootstrap.

### 2. Keypair milik hanoman

Service baru `server/src/services/vps-key.ts`:

```ts
ensureHanomanKey(): { privPath: string; pubPath: string; pub: string }
```

Bila `~/.hanoman/id_ed25519` belum ada, dibuat sekali:
`ssh-keygen -t ed25519 -N "" -C hanoman -f <privPath>`; direktori 700, kunci privat 600.
Direktori dapat di-override lewat `HANOMAN_SSH_KEY_DIR` (dipakai test).

Identitas tersendiri, bukan `~/.ssh/id_ed25519` milik pengguna: akses hanoman bisa
dicabut per-mesin (hapus satu baris di `authorized_keys`) tanpa menyentuh key pribadi.

### 3. Transport password — tanpa dependensi baru

`sshExec(target, cmd, opts)` menerima `opts.password?: string`. Bila ada, argumen dan
env berubah:

```
-o PreferredAuthentications=password,keyboard-interactive
-o PubkeyAuthentication=no
-o NumberOfPasswordPrompts=1
-o StrictHostKeyChecking=accept-new    (tak berubah)
env: SSH_ASKPASS=<script sementara>, SSH_ASKPASS_REQUIRE=force
```

`BatchMode=yes` **tidak** dipasang di mode ini — ia melarang segala prompt, termasuk
askpass. Script askpass sementara (mode 0700, di `os.tmpdir()`) hanya berisi:

```sh
#!/bin/sh
printf '%s' "$HANOMAN_SSH_PASSWORD"
```

dan dihapus di `finally` begitu proses ssh selesai. `SSH_ASKPASS_REQUIRE=force` ada sejak
OpenSSH 8.4 (mesin ini 10.2) — tak perlu `sshpass`, dan password tak pernah masuk argv.

**Keterbatasan yang diterima secara sadar:** selama beberapa detik itu, password berada di
environment proses anak, terlihat oleh `ps e` **milik user yang sama** di mesin server.
hanoman bind `127.0.0.1` dan berjalan sebagai satu pengguna, jadi ini sebanding;
alternatif `sshpass` menaruh password di argv, yang terlihat oleh semua pengguna.

Tanpa `password`, `sshExec` berperilaku persis seperti sekarang (`BatchMode=yes`).

### 4. Alur bootstrap

`bootstrapKey(target, password): Promise<{ ok: true; keyPath } | { ok: false; out }>`

1. `ensureHanomanKey()`.
2. Login **dengan password**; public key dikirim lewat **stdin**, tak pernah dirangkai ke
   string perintah. Perintah remote idempotent, tanpa sudo:
   ```sh
   mkdir -p ~/.ssh && chmod 700 ~/.ssh
   touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
   k=$(cat); grep -qxF "$k" ~/.ssh/authorized_keys || printf '%s\n' "$k" >> ~/.ssh/authorized_keys
   ```
3. **Verifikasi lewat koneksi baru** yang hanya boleh memakai key: `BatchMode=yes`,
   `PasswordAuthentication=no`, jalankan `true`.
4. Hanya bila langkah 3 lolos, `keyPath` dikembalikan untuk disimpan.

Gagal di langkah mana pun → tak ada yang tersimpan; pemanggil membalas 502 dengan
outputnya. Tidak ada VPS setengah jadi.

Bootstrap **tidak menyentuh sudo**. Bila user bukan root dan sudo-nya minta password,
`sudo_ok` tetap fail pada audit — itu harus terlihat, bukan ditambal diam-diam.

### 5. API

| Route | Perubahan |
|---|---|
| `POST /vps` | body menerima `password?`. Bila ada: bootstrap dijalankan **sebelum** baris dibuat; sukses → baris lahir dengan `keyPath` terisi; gagal → 502, tak ada baris. |
| `PATCH /vps/:id` | body menerima `password?` = "bootstrap ulang" memakai host/user/port hasil merge patch. Sukses → `keyPath` diperbarui. Tanpa `password`, perilaku lama (patch parsial biasa). |

`password` tak pernah muncul di response, log, atau pesan error. Zod: `z.string().min(1)`,
opsional; bila `password` diberikan, `keyPath` di body diabaikan (bootstrap yang menentukan).

### 6. UI

- **Modal daftar** dapat field `Password SSH` (`type="password"`, hint: "opsional —
  dipakai sekali untuk memasang key hanoman, tidak disimpan"). Field `Key path` tetap ada
  untuk VPS yang sudah punya key.
- **Modal edit** baru, dibuka ikon pensil per baris: nama, host, user, port, keyPath, plus
  `Password SSH` opsional untuk bootstrap ulang. Kosong = jangan sentuh.
- Toast sukses bootstrap menyebut eksplisit: `key hanoman terpasang · password dibuang`.
- `api.updateVps(id, body)` ditambahkan ke client (endpoint-nya sudah ada).

### 7. Yang tidak berubah

`audit.sh`, `harden.sh`, monitor berkala, endpoint audit/harden/session, dan skema
Prisma — tak satu pun disentuh. Justru bootstrap yang membuat Harden aman dijalankan pada
VPS yang tadinya password-only.

### 8. Testing

- `ensureHanomanKey`: direktori sementara lewat `HANOMAN_SSH_KEY_DIR`; dipanggil dua kali
  tak membuat ulang key; mode berkas 600.
- `sshExec` mode password: fixture `fake-ssh.sh` merekam argv+env ke berkas, test
  memastikan `BatchMode=yes` **tidak** ada, `SSH_ASKPASS_REQUIRE=force` ada, dan script
  askpass terhapus sesudahnya.
- `bootstrapKey`: sukses; gagal login password; login sukses tapi verifikasi key gagal
  (→ `keyPath` tak tersimpan).
- Route: `POST /vps` dengan password (201, `keyPath` terisi, response tak memuat password);
  bootstrap gagal → 502 dan `prisma.vps.count()` tetap 0; `PATCH` dengan password.
- UI: modal edit membuka nilai yang ada; submit memanggil `api.updateVps`.
- Sesuai kebiasaan repo: setelah tiap task, boot server dan curl endpoint nyata. Bootstrap
  diverifikasi nyata terhadap container `sshd` ber-password — bukan hanya fixture.

### 9. Di luar cakupan

Passphrase pada key hanoman, rotasi key, mencabut key dari VPS lewat UI, sudo berpassword,
menyimpan kredensial apa pun di DB, dan bootstrap massal beberapa VPS sekaligus.
