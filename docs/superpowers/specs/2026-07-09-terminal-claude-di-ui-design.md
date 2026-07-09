# Terminal Claude Code di UI hanoman

Tanggal: 2026-07-09
Status: disetujui, siap direncanakan

## Masalah

Untuk memakai Claude Code pada sebuah project, pengguna harus membuka terminal,
`cd` ke direktori project, lalu menjalankan `claude --dangerously-skip-permissions`.
Hanoman sudah tahu di mana setiap project berada (`Project.repoDir`), tapi tidak
menawarkan cara menjalankan sesi Claude Code interaktif dari dashboard.

## Outcome

Pengguna membuka sesi Claude Code dari UI hanoman — beberapa sesi sekaligus, tiap
sesi terikat pada satu project — dan berinteraksi dengan TUI Claude Code apa adanya,
tanpa membuka terminal.

## Bukan bagian dari ini

- **Tidak membangun UI chat sendiri.** Yang dirender adalah TUI Claude Code yang
  asli, byte demi byte. Tidak ada parsing pesan, tidak ada bubble chat.
- **Tidak menyentuh terminal palsu di `server/src/routes/runs.ts`.** Itu interpreter
  perintah (`status`, `plan`, `steer`, …) untuk run terjadwal, dan tetap seperti
  adanya. Fitur ini terpisah penuh.
- **Tidak mengubah `runner/`.** Runner menjalankan claude non-interaktif
  (`-p --output-format stream-json`) untuk run. Sesi terminal tidak lewat runner,
  tidak lewat queue, tidak lewat worker.
- Tidak ada persistensi sesi ke database, tidak ada replay lintas restart server.

## Keputusan yang sudah diambil

| Pertanyaan | Keputusan |
|---|---|
| Direktori kerja sesi | `Project.repoDir` — working tree utama project |
| Umur sesi | Selama proses server API hidup (in-memory). Restart server = sesi hilang. |
| Proses di dalam PTY | Langsung `claude --dangerously-skip-permissions`. Bukan shell. Keluar dari claude = sesi mati. |
| Tempat di UI | Screen "Terminal" baru, satu tab per sesi |

Catatan soal `repoDir`: `CLAUDE.md` melarang menjalankan **run** di working tree
utama. Larangan itu tentang run otomatis yang di-orchestrate hanoman. Sesi terminal
ini adalah pekerjaan manual yang dipicu manusia, setara dengan membuka terminal
sendiri — jadi `repoDir` memang yang diinginkan.

## Arsitektur

PTY hidup di proses **server API** (`server/src/server.ts`), bukan di worker.
Worker melayani run BullMQ; sesi terminal tidak punya hubungan dengan queue.

### Pendekatan

`node-pty` men-spawn `claude --dangerously-skip-permissions` di dalam TTY sungguhan.
Byte stdout diteruskan lewat WebSocket ke `xterm.js` di browser; keystroke berjalan
ke arah sebaliknya. Ini jalur yang dipakai VS Code untuk terminal terintegrasinya.

Dua alternatif ditolak:

- **`script -q /dev/null claude …`** untuk mengakali TTY tanpa native module. Flag
  `script` berbeda antara macOS dan Linux, dan tidak ada jalur SIGWINCH — resize
  window tidak sampai ke claude, sehingga TUI-nya rusak. Tidak layak.
- **Embed `ttyd` lewat iframe.** Nol kode server, tapi menambah binary eksternal dan
  port kedua, dan sesi menjadi tak terlihat oleh API hanoman (tidak bisa di-list atau
  di-kill). Menukar satu native module dengan satu daemon.

### Dependency baru

| Paket | Tempat | Versi | Alasan |
|---|---|---|---|
| `node-pty` | server | `^1.1.0` | spawn proses di TTY |
| `@fastify/websocket` | server | `^10` | v11 mensyaratkan Fastify 5; repo ini di Fastify 4 |
| `@xterm/xterm` | web | `^6` | render ANSI/TUI |
| `@xterm/addon-fit` | web | `^0.11` | ukur cols/rows dari ukuran container |

### Service: `server/src/services/pty.ts`

Memegang `Map<sessionId, Session>`:

```ts
type Session = {
  id: string;
  projectId: string;
  cwd: string;
  pty: IPty;
  scrollback: string;      // dipotong pada 256 KB terakhir
  exited: boolean;
  exitCode?: number;
  clients: Set<WebSocket>;
};
```

- **`create(projectId)`** — baca `Project.repoDir`; kalau kosong, gagal. Spawn:

  ```ts
  spawn(bin, ["--dangerously-skip-permissions"], {
    cwd: repoDir, name: "xterm-256color", cols: 80, rows: 24, env: process.env,
  })
  ```

  `bin` = `process.env.HANOMAN_CLAUDE_BIN ?? "claude"` — variabel yang sama yang
  sudah dipakai `runner/src/claude-cli.ts`. Test menukar binary lewat variabel ini,
  bukan lewat spawner yang disuntik.

- **`onData`** — append ke `scrollback` (potong dari depan bila > 256 KB), broadcast
  `{t:"data", d}` ke semua `clients`.

- **`onExit`** — set `exited` dan `exitCode`, kirim `{t:"exit", code}`, tutup semua
  socket. Sesi **tetap ada** di Map sampai di-DELETE, supaya output terakhirnya masih
  bisa dibaca.

- **`kill(id)`** — SIGKILL PTY, hapus dari Map.

- Pada `app.onClose` — kill semua PTY yang masih hidup.

### Route: `server/src/routes/terminal.ts`

Di-register di `buildApp()` seperti route lain. `buildApp()` juga meregistrasi
plugin `@fastify/websocket` satu kali.

```
GET    /api/terminal/sessions              → 200 [{ id, projectId, cwd, exited }]
POST   /api/terminal/sessions {project}    → 201 { id }
                                             404 project tidak ada
                                             400 project tanpa repoDir
DELETE /api/terminal/sessions/:id          → 204
                                             404 sesi tidak ada
GET    /api/terminal/sessions/:id/ws       → WebSocket
                                             404 sesi tidak ada
```

Body `POST` divalidasi dengan skema zod baru di `shared/`, sejalan dengan `zStartRun`.

### Protokol WebSocket

Frame JSON dua arah.

Server → klien:
- `{ t: "data", d: string }` — byte dari PTY
- `{ t: "exit", code: number }` — proses berakhir

Klien → server:
- `{ t: "in", d: string }` — stdin mentah, termasuk Ctrl-C dan escape sequence
- `{ t: "resize", cols: number, rows: number }` — diteruskan ke `pty.resize()`

Saat sebuah klien terhubung, server mengirim `scrollback` sebagai satu frame `data`
lebih dulu, baru kemudian meneruskan output live.

### Keamanan

Endpoint ini adalah remote code execution *by design* — sama persis dengan membuka
terminal di mesin itu. Hanoman hari ini tidak punya autentikasi sama sekali, jadi
selama server bind ke localhost, endpoint ini tidak menurunkan postur keamanan
apa pun. Fakta ini ditulis sebagai komentar di `terminal.ts`, tidak dibiarkan
implisit. Bila kelak hanoman mendengarkan di `0.0.0.0`, endpoint inilah yang
pertama harus digembok.

## UI

`src/src/screens/TerminalScreen.tsx`, ditambah satu nav item di `App.tsx`.

Layout: strip tab di atas (satu tab per sesi: nama project + id pendek + tombol `×`),
tombol `+` yang membuka pemilih project, sisanya adalah viewport `xterm`.

Hanya tab aktif yang memegang WebSocket. Berpindah tab berarti: `term.dispose()`,
buat `Terminal` baru, buka WS baru, dan server me-replay scrollback. Karena PTY-nya
hidup di server, tidak ada yang hilang, dan frontend tidak perlu menyimpan instance
terminal tersembunyi. Sesi yang tidak aktif tetap berjalan; outputnya muncul saat
tab-nya dibuka kembali.

`ResizeObserver` pada container memanggil `fit()`, lalu mengirim `{t:"resize"}`.

Tema `xterm` mengambil warna dari `src/src/tokens/colors.css` agar tetap konsisten
dengan design system (bone paper, brass accent), bukan hitam bawaan.

## Testing

`server/test/terminal.test.ts`. Karena WebSocket tidak bisa diuji lewat
`app.inject()`, test memakai `app.listen({ port: 0 })` dan klien `ws`.

1. **Siklus hidup** — `HANOMAN_CLAUDE_BIN=/bin/echo`: POST sesi → connect WS →
   terima frame `data` → terima `{t:"exit",code:0}`. Menguji jalur PTY yang asli.
2. **Reconnect me-replay scrollback** — `HANOMAN_CLAUDE_BIN=/bin/cat`: kirim
   `{t:"in"}`, terima echo-nya, putuskan WS, connect lagi, frame pertama berisi
   teks tadi.
3. **Resize** — kirim `{t:"resize",cols:100,rows:30}` ke sesi hidup; tidak melempar,
   sesi tetap hidup. Memverifikasi `cols` benar-benar sampai ke proses anak butuh
   `stty` di dalam PTY — biayanya tidak sepadan.
4. **DELETE** — mematikan proses dan menghapus sesi dari `GET /sessions`.

## Risiko

1. **`node-pty` dikompilasi saat `pnpm install`** dan memerlukan Xcode Command Line
   Tools di darwin. Bila gagal, ganti dengan `@homebridge/node-pty-prebuilt-multiarch`
   yang API-nya identik.
2. **Bundling.** Script `build` di `server/package.json` memakai esbuild dengan daftar
   `--external` eksplisit. Tambahkan `--external:node-pty --external:@fastify/websocket`,
   kalau tidak build produksi akan gagal.
3. **Dua sesi pada `repoDir` yang sama** bisa saling menimpa perubahan file. Itu
   memang sifat membuka dua terminal di folder yang sama; tidak dicegah.

## Dokumentasi yang tersentuh

- ADR baru: keputusan menaruh PTY di proses API dan mengekspos WebSocket tak
  terautentikasi di localhost.
- `internal/docs/architecture/` — tambahkan sesi terminal sebagai jalur kedua menuju
  binary claude, di samping runner.
