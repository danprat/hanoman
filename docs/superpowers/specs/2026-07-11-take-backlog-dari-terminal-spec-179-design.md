# SPEC-179 — Take Backlog dari Terminal

## Objective
Memulai backlog item sekarang harus dari halaman **Backlog** (tombol Mulai/Lanjutkan),
lalu hanoman memindahkan ke halaman **Terminal**. Permintaan: bisa **memilih backlog dari
Terminal langsung** — tanpa pindah page — supaya item yang mau dikerjakan bisa langsung
diambil dan muncul di grid.

Prioritas: tinggi. Sumber: brief.

## Konteks
Alur start hari ini (`App.tsx:374 startSession`): halaman Backlog → tombol Mulai/Lanjutkan
→ `api.startSession({ spec, flow })` → `setSection("terminal")`. `flow` dipilih otomatis:
`spec.source === "qa" ? "qa" : "feature"`. Server (`POST /terminal/sessions`,
`server/src/routes/terminal.ts:41`) membangun worktree + sesi `claude` interaktif untuk
spec itu dan **idempoten**: bila sesi untuk spec itu masih hidup, ia mengembalikan id yang
sudah ada (`getSession(id)` → `reply.code(201).send({ id: live.id })`).

`TerminalScreen` (`src/src/screens/TerminalScreen.tsx`) memiliki state-nya sendiri:
- `sessions` (dari `api.listTerminals()`),
- `ws` workspace (grup + grid) yang di-persist di `localStorage`.

Ia sudah punya `openNew()` yang membuat sesi terminal biasa, menambahkannya ke `sessions`,
lalu `W.placeFirstEmptyInActive(w, id)` — menaruhnya di **sel kosong pertama grup aktif**.
Sesi ber-spec yang tak tertaruh jatuh ke **tray** ("Belum di grid").

**Akar kebutuhan:** afordansi start satu-satunya ada di halaman Backlog. Terminal tak punya
pintu masuk backlog sama sekali, padahal ia sudah punya semua yang dibutuhkan (start API
idempoten + helper penempatan grid).

## Keputusan
Tambahkan afordansi start ke dalam toolbar Terminal — **nol perubahan server**, reuse
`api.startSession` + `W.placeFirstEmptyInActive`.

1. **Tombol "Ambil backlog"** di toolbar `TerminalScreen`, di samping "Sesi baru"
   (ikon `inbox`). Membuka modal picker.

2. **`BacklogPicker` modal** (komponen kecil baru, di `TerminalScreen.tsx`). Props:
   `specs: Spec[]`, `onPick: (s: Spec) => void`, `onClose`. Isinya kotak cari (filter
   id/title/objective) + baris padat per spec: `SPEC-x · title · [priority] · project`.
   Empty state saat tak ada spec yang bisa diambil. Pakai `Modal`, `Input`, `Badge` dari
   `ds` — konsisten dengan modal lain.

3. **`pickBacklog(spec)`** di `TerminalScreen`:
   - `const { id } = await api.startSession({ spec: spec.id, flow: spec.source === "qa" ? "qa" : "feature" })`
     — cermin `App.startSession`.
   - tambahkan ke `sessions` (guard duplikat lewat `some`), dengan `specId`/`projectId`/`flow`.
   - `setWs((w) => W.placeFirstEmptyInActive(w, id))` → langsung masuk grid aktif.
   - tutup modal. Error (project tanpa repoDir → 400/422) → satu baris error inline di modal.

### Data
`TerminalScreen` menerima prop baru `backlog: Spec[]` dari `App.tsx` (App sudah memuatnya —
nol fetch tambahan). **Spec yang bisa diambil** = `stage !== "done"` **dan** belum punya
sesi hidup untuk spec itu di `sessions` Terminal (belum aktif) — cermin afordansi
Mulai/Lanjutkan di Backlog (`SpecActions`, `stage !== "done" && !running`).

### Penempatan
Sel kosong pertama grup aktif (`placeFirstEmptyInActive`). Grid penuh → sesi jatuh ke tray
(perilaku existing, sama seperti "Sesi baru").

## Yang TIDAK berubah / TIDAK dibuat
- **Nol perubahan server** — route `POST /terminal/sessions` `{spec, flow}` dipakai apa
  adanya (idempoten).
- Tak ada flow picker — flow otomatis qa/feature dari `spec.source`, sama seperti Backlog.
- Tak memfilter berdasarkan Select project di toolbar (itu untuk "Sesi baru"); ambil-backlog
  lintas project — tiap baris menampilkan project-nya.
- Tak menyembunyikan spec yang project-nya belum punya repoDir (kasus jarang — ditangani
  error inline).
- Spec `done` tidak ditawarkan (reopen adalah aksi layar detail yang lebih jarang, SPEC-172).

## Konsekuensi
- Satu backlog item bisa diambil dan langsung dikerjakan tanpa meninggalkan halaman Terminal.
- Karena start-nya idempoten dan filter membuang spec yang sudah aktif, tak ada risiko
  menggandakan sesi.
- Tombol Mulai/Lanjutkan di Backlog tetap ada — ini pintu masuk tambahan, bukan pengganti.
