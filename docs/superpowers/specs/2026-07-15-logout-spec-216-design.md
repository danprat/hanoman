# SPEC-216 — Logout yang bisa ditemukan (discoverable logout)

**Tanggal:** 2026-07-15 · **Prioritas:** tinggi · **Sumber:** brief

## Objective
Pengguna dapat melakukan logout dari mana pun di aplikasi, lewat afordans yang
langsung terlihat di chrome utama — tanpa harus tahu bahwa tombolnya "tersembunyi"
di Settings → Akun.

## Konteks & temuan
Brief bilang "saat ini belum bisa logout". Setelah menelusuri kode, logout
sebenarnya **sudah berfungsi penuh** — yang hilang adalah **discoverability**:

- **Server** — `POST /auth/logout` sudah ada (`server/src/routes/auth.ts`): hapus
  baris sesi + clear cookie, balas 204. Sudah diuji (`server/test/auth-routes.test.ts`,
  `parity-endpoints.test.ts`). ADR-0028 mengatur sesi opaque revocable ini.
- **API client** — `api.logout()` sudah ada (`src/src/api/client.ts`).
- **Frontend** — tombol Logout **sudah ada, tapi terkubur** di `SettingsScreen`
  → tab **Akun** → header kartu (ghost button kecil). Untuk sampai ke sana pengguna
  harus: buka Settings di sidebar → klik tab "Akun" → temukan tombol ghost kecil.
- **Chrome utama** (`src/src/ds/shell.tsx`) — sidebar + topbar **tidak menampilkan
  identitas pengguna sama sekali** dan tidak punya afordans logout. Dari layar mana pun
  (Overview, Backlog, Terminal, …) tak ada jalan keluar yang terlihat.

Jadi ini bukan bug fungsional — ini gap UX. Perbaikannya: hadirkan identitas + logout
yang terlihat di chrome utama.

## Keputusan desain

**Tambah widget `AccountMenu` di topbar `Shell`**, bersebelahan dengan
`NotificationBell` / `LimitBadge` / `UpdateBadge`. Ia:

- Menampilkan tombol avatar (inisial huruf pertama email) yang selalu terlihat di
  topbar semua layar.
- Saat diklik, membuka popover kecil berisi **email pengguna** + tombol **"Keluar"**.
- "Keluar" memanggil `api.logout()` lalu mengembalikan state auth ke layar Login
  (via `onLoggedOut`). Bila panggilan jaringan gagal pun, state klien tetap dibersihkan
  (`finally`) — konsisten dengan perilaku `AccountPanel` yang ada.

### Kenapa topbar + context (bukan sidebar footer, bukan prop-threading)
Pola mapan di kode: widget topbar (`NotificationBell`, `LimitBadge`, `UpdateBadge`)
dirender langsung di `Shell` dan mengambil datanya lewat **context / self-fetch** —
**nol prop-threading** ke ~9 call-site `<Shell>` (lihat `frontend-implementation.md`).
`NotificationBell` khususnya mengonsumsi `NotificationsContext` yang punya **nilai
default aman** sehingga `<Shell>` yang dirender tanpa provider (mis. test) tak error.

`AccountMenu` mengikuti pola itu persis:

- **`AuthContext`** (`src/src/auth/AuthContext.tsx`) — menyediakan
  `{ user: UserView | null, logout: () => Promise<void> }`. Default aman:
  `{ user: null, logout: async () => {} }`. Bila `user` null, `AccountMenu`
  **tidak merender apa-apa** → 9 call-site `<Shell>` tak berubah, test lama tak
  terpengaruh.
- **`AuthProvider`** membungkus render aplikasi ter-autentikasi di `App.tsx`,
  menerima `user={me}` + `onLoggedOut`, dan menghitung `logout` satu tempat.
- **`Shell`** cukup menambah `<AccountMenu />` di topbar — tanpa prop baru.

Alternatif yang ditolak:
- *Sidebar footer* — perlu merestrukturisasi layout flex sidebar, dan bukan pola
  widget yang mapan; identitas+logout di topbar lebih konsisten.
- *Prop-threading `user`/`onLogout` ke 9 `<Shell>`* — berisik, dan justru pola yang
  sudah sengaja dihindari kode ini.

### Yang TIDAK dikerjakan (YAGNI)
- Tak ada perubahan server / skema / kontrak API — endpoint sudah ada & teruji.
- Tak ada dialog konfirmasi logout — aksinya murah & reversibel (tinggal login lagi).
- Tombol Logout di **Settings → Akun tetap ada** (sekunder, sudah teruji) — tidak
  dihapus, tidak juga di-refactor besar (menghindari churn/test breakage).
- Menu tak menambah item lain (Settings sudah di sidebar). Cukup identitas + Keluar.

## Komponen & data flow
```
App (auth.user = me)
 └─ AuthProvider user={me} onLoggedOut
     └─ (screen) Shell
                  └─ topbar: … NotificationBell · LimitBadge · AccountMenu
                                                              └─ useAuth() → { user, logout }
                                                                 klik "Keluar" → logout()
                                                                    └─ api.logout() → onLoggedOut() → AuthScreen
```

## Rencana test (TDD)
- **`AccountMenu`**: (a) tanpa provider / user null → tak merender tombol;
  (b) dengan user → tampil inisial; klik → popover menampilkan email; klik "Keluar" →
  `api.logout()` terpanggil lalu `logout` context (→ `onLoggedOut`) terpanggil.
- **`Shell`**: merender `<AccountMenu />` tanpa error saat tak ada `AuthProvider`
  (nilai default aman) — jaga 9 call-site tetap hijau.
- Server: tak ada perubahan; test auth existing tetap hijau.

## Docs yang tersentuh (update dalam commit yang sama)
- `internal/docs/frontend/frontend-implementation.md` — deskripsikan `AccountMenu`
  di topbar (identitas + logout) di samping NotificationBell/LimitBadge.
- `internal/docs/architecture/api-contract.md` — `POST /auth/logout` sudah
  terdokumentasi; tak berubah (catat saja bila perlu bahwa UI-nya kini di topbar).
- Index docs bila ada entri yang menuntun ke bagian frontend.
