# SPEC-192 — Notifikasi sound tidak nyala

## Objective
Bunyi notifikasi untuk **selesai** (`done`) dan **butuh keputusan** (`decision`) benar-benar
terdengar saat episodenya terjadi. Sekarang toast + lonceng muncul, tapi tak ada suaranya.

Prioritas: tinggi. Sumber: qa. Severity: major.

## Konteks / akar masalah
`playNotifySound(kind)` (`src/src/notifications/sound.ts`) memutar bunyi dengan
`new Audio('/sounds/notify-<kind>.wav').play()`. Ia dipanggil dari `NotificationsProvider.tick`
(`.../NotificationsContext.tsx:56`) yang jalan di **poll `setInterval` tiap 10s** — bukan di
dalam handler gestur user.

Kebijakan autoplay browser memblokir `HTMLMediaElement.play()` yang berbunyi kecuali
dokumen/elemen sudah menerima aktivasi user. Elemen `Audio` yang **baru dibuat** di dalam
callback timer tak punya aktivasi itu — khususnya Safari, yang tak menganggap sticky-activation
dokumen cukup untuk elemen media segar. `play()` ditolak, dan penolakannya sengaja di-`catch`
(`sound.ts:9`). Karena itu:

- **Preview** di Settings **berbunyi** — ia dipanggil dari `onClick` (ada gestur langsung).
- **Notifikasi asli** (done/decision) dari poll **senyap** — tak ada gestur di call-stack.

Ini persis batasan yang sudah ditandai ADR-0033 (baris 53–54): "Autoplay sound bisa diblokir
browser sebelum interaksi user; penolakan di-`catch`". Yang belum ada: mekanisme **unlock**.

Bukti: 13 aset WAV valid & terjangkau (`/sounds/notify-*.wav`, PCM 16-bit 22050 Hz mono),
`toastFor`/`tick` benar & bertes — toast tetap muncul, jadi jalur notifikasi jalan; yang hilang
hanya audionya.

## Keputusan
Unlock **satu** elemen `Audio` yang dipakai ulang, pada **gestur user pertama**. Pola unlock
audio klasik (dipakai luas untuk iOS/Safari): saat gestur pertama, putar elemen bersama dalam
keadaan `muted` lalu `pause` — itu memberi elemen tersebut aktivasi user permanen. Setelah itu
`play()` dari timer diizinkan meski tanpa gestur baru, di semua browser.

Perubahan hanya di sisi klien, nol server/skema/tipe:

1. **`sound.ts`** — elemen `Audio` singleton modul + fungsi baru `unlockNotifySound()`.
   `playNotifySound` memakai elemen yang sama (set `src` + `play`), bukan `new Audio()` per panggil.
2. **`NotificationsContext.tsx`** — di `useEffect` yang sudah ada, pasang listener sekali
   (`pointerdown`/`keydown`, `once`) yang memanggil `unlockNotifySound()` lalu lepas listener.

### Detail
- `unlockNotifySound()` idempoten (guard `unlocked`); prime `muted` supaya klik pertama user
  tak berbunyi kaget, lalu `pause`+unmute setelah `play()` resolve.
- Elemen dibuat malas via helper yang `try/catch` `new Audio()` → `null` di lingkungan tanpa
  `Audio` (test node), sehingga `playNotifySound`/`unlock` no-op dengan aman.
- Preview di Settings tetap lewat `playNotifySound` yang kini juga memakai elemen bersama —
  konsisten, dan gestur klik Preview sekaligus meng-unlock.

## Yang TIDAK berubah
- Server, route, skema Prisma, tipe. Nol.
- `toastFor`/`newSince`/`maxAt`, jalur poll, gating setting (`notifyDone`/`notifyDecision`).
- Set aset WAV & generatornya.

## Di luar scope (YAGNI)
- **Web Audio API / AudioContext.** Elemen `Audio` yang di-unlock sudah cukup cross-browser;
  tak perlu decode buffer. Naikkan bila kelak butuh mixing/latency ketat.
- **Bunyi tanpa gestur sama sekali.** Kalau user belum pernah berinteraksi dengan halaman,
  browser tetap melarang audio — batasan platform, bukan bug. Satu klik meng-unlock permanen.
- **Web Push saat tab tertutup.** Tetap di luar scope (ADR-0033).

## Konsekuensi
- Notifikasi done & decision berbunyi setelah user berinteraksi minimal sekali dengan app.
- Tak ada ADR baru: bukan perubahan skema maupun konvensi; ADR-0033 diberi catatan follow-up
  (unlock) di commit yang sama.
