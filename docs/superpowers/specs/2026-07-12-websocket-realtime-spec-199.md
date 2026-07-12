# SPEC-199 — Ganti sistem polling ke WebSocket

**Status:** design · prioritas tinggi · ADR-0038

## Masalah

Dashboard memantau data real-time lewat **5 poll `setInterval`** buatan tangan di klien —
tiap tab browser × tiap poll = beban berulang ke server. Yang paling sering: board 3 detik
(`App.tsx:323`, `GET /specs` + `GET /terminal/sessions`). Tak ada Redis/BullMQ/SSE/react-query
di repo; satu-satunya WebSocket yang ada dipakai **hanya** untuk PTY terminal per-sesi
(`@fastify/websocket`, `terminal.ts:168`).

Poll saat ini:

| # | Lokasi | Interval | Data |
|---|--------|----------|------|
| 1 | `App.tsx:323` | 3 s | board: `GET /specs` + `GET /terminal/sessions` (hanya saat ada sesi hidup) |
| 2 | `TerminalScreen.tsx:40` | 8 s | daftar sesi (`exited`/`decision`) |
| 3 | `NotificationsContext.tsx:83` | 10 s | notifikasi + unread |
| 4 | `api/limits.ts:42` | 60 s | usage limit langganan Claude |
| 5 | `VpsScreen.tsx:100` | 30 s | daftar/status VPS |

## Outcome

Pindahkan **kelima** poll ke satu WebSocket. Klien berhenti men-poll; server **mendorong**
perubahan. Satu loop server menggantikan N-klien × poll.

## Kenapa "relay poll" dan bukan event-driven murni

Sumber data real-time (pane tmux, berkas fase, marker keputusan) adalah **state eksternal
tanpa hook in-process** — tak ada yang bisa "di-subscribe". Server sudah men-*poll* mereka
hari ini (loop 500 ms di `pty.ts` yang men-`broadcast` frame terminal). Jadi langkah jujur
& paling ringkas: **pindahkan poll dari klien ke server, lalu fan-out lewat satu WebSocket** —
generalisasi pola `pty.ts` yang sudah terbukti, bukan bus event baru yang tetap harus polling.

## Arsitektur

### Server — `server/src/services/events.ts` (hub siar) + route `GET /api/events/ws`

- **Satu `Set<Client>`** (reuse tipe `Client` transport-agnostic dari `pty.ts`) berisi semua
  WebSocket dashboard yang tersambung. Route baru `GET /api/events/ws` mem-`attach`/`detach`.
- **Satu loop interval bersama**, ref-counted: hidup hanya selama `clients.size > 0`, berhenti
  saat klien terakhir putus (persis `startPoll` di `pty.ts`). Base tick **1 s**.
- **Cadence per-grup** (tick counter, bukan 5 timer) + **dedup signature** per grup
  (`JSON.stringify` lalu banding — pola yang sudah dipakai `App.tsx:327`). Frame lahir **hanya
  saat isinya berubah**:
  | grup | recompute tiap | sumber |
  |------|----------------|--------|
  | `specs` + `sessions` | 1 s | satu `listPanes()` dipakai berdua |
  | `notifications` | 3 s | `scanDecisions()` (idempoten) + query notif |
  | `limits` | 30 s | `getLimits()` (service sudah cache 30 s) |
  | `vps` | 15 s | daftar VPS dari DB |
- **On connect**: kirim snapshot penuh semua grup ke klien itu segera (tak perlu HTTP awal
  untuk data real-time; late subscriber langsung tersinkron).
- **Broadcast tahan-klien-mati**: `send` dibungkus try/catch; klien yang gagal di-drop, tak
  memblok yang lain.
- Grup dihitung dengan **fungsi service yang sama** yang dipakai route HTTP (`GET /specs`,
  `listSessions`, query notif, `getLimits`, daftar vps) — HTTP GET dan push WS tak boleh drift.
  Bila route saat ini meng-inline logika, ekstrak builder bersama.

### Kontrak pesan (server → klien)

Per-grup, bukan snapshot monolitik — perubahan satu grup tak mengirim ulang yang lain, dan
memetakan bersih ke store klien yang memang terpisah:

```
{ t:"specs",         specs: SpecDTO[] }
{ t:"sessions",      sessions: SessionDTO[] }
{ t:"notifications", items: NotificationDTO[], unread: number }
{ t:"limits",        limits: LimitsDTO }
{ t:"vps",           vps: VpsDTO[] }
```

Read-only feed: **tak ada pesan klien → server** (inbound diabaikan).

### Klien — `src/src/api/events.ts` (singleton WS)

- **Satu koneksi** ke `/api/events/ws`, ref-counted (reuse pola singleton `api/limits.ts`
  yang sudah pakai `useSyncExternalStore`): subscriber pertama membuka, yang terakhir menutup.
- `subscribe(handler: (msg: EventMsg) => void): () => void`. Tiap consumer filter berdasarkan
  `msg.t`.
- **Auto-reconnect** backoff; **gated visibility tab** (tutup/pause saat `document.hidden`,
  sambung ulang saat terlihat — sama seperti guard poll lama). Saat reconnect, server mendorong
  snapshot penuh → state re-sync otomatis.
- Skema wss/ws & `location.host` mengikuti `TerminalPane.tsx:34`.

### Consumer di-rewire (hapus `setInterval`, pasang `subscribe`)

| File | Dulu | Sesudah |
|------|------|---------|
| `App.tsx` | poll 3 s | `subscribe` → `setBacklog`(specs) + `setSessions`(sessions) |
| `TerminalScreen.tsx` | poll 8 s | `subscribe` → `setSessions` |
| `NotificationsContext.tsx` | poll 10 s | `subscribe` → reducer notif yang sudah ada |
| `api/limits.ts` | poll 60 s | `subscribe` → store `useLimits` (API publik tak berubah) |
| `VpsScreen.tsx` | poll 30 s | `subscribe` → `setVps` |

- **HTTP GET tetap ada** (initial paint / fallback). Yang dihapus hanya `setInterval` klien.
  `App.tsx` `load()` awal tetap (ia juga muat `projects` yang bukan real-time).
- Proxy dev Vite sudah `ws: true` (`frontend-implementation.md:166`) — tak berubah.

## Auth

WS upgrade lewat gate `onRequest` di scope `/api` (browser kirim cookie `hn_session`
same-origin otomatis) → auth gratis, persis terminal WS. Klien tak tersambung mendapat 401
saat upgrade.

## Edge cases

- **Server restart**: klien reconnect + re-sync via snapshot.
- **Board dulu di-gate `anySessionActive`**; hub selalu tick 1 s selama ada klien. `tmux
  list-panes` kosong itu murah — board kini update saat sesi *mulai* tanpa perlu sesi sudah
  aktif. `// ponytail:` catat plafon (gate ke session-liveness bila beban jadi masalah).
- **`scanDecisions` menulis DB** → jalan di cadence 3 s (notifikasi), bukan 1 s.

## Testing

- **Server unit (vitest)**: hub `events.ts` — Client perekam menerima snapshot saat connect;
  menerima frame grup saat data berubah; **tak ada** frame saat tak berubah (dedup); loop
  berhenti saat `clients.size === 0`. Inject builder snapshot untuk determinisme (tanpa tmux).
- **Live smoke (wajib, CLAUDE.md)**: boot server ke DB throwaway ter-migrate; klien `ws` Node
  connect ke `/api/events/ws` dengan cookie sesi valid → terima snapshot; ubah data (mis. tulis
  notifikasi) → terima push `notifications`. **Tidak** spawn claude sungguhan.
- **Klien**: unit kecil dispatch pesan + reconnect pakai mock `WebSocket`.

## Non-goals

- Bukan bus event in-process / Redis pub-sub (YAGNI — sumber tetap poll-only).
- Tidak menghapus endpoint HTTP GET (dipakai initial load).
- Tidak menyentuh WebSocket PTY terminal (channel & tujuan berbeda).
