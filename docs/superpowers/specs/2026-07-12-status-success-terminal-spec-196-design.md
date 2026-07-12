# Status Success Terminal (SPEC-196) — Design

**Sumber:** qa · **Prioritas:** tinggi · **Severity:** major

## Masalah (dari audit)

Dua defect nyata & independen, keduanya menyangkut dua state akhir: **success** dan **human decision**.

**A. Pembeda terminal tak lengkap.**
Sesi `exited` (success) sudah punya pembeda sejak SPEC-188: `StatusPill "Selesai"` + badan
meredup `opacity 0.6`. Tapi sesi yang **berhenti menunggu keputusan manusia** tidak `exited`
(proses `claude` masih hidup), sehingga `Cell` merendernya identik dengan sesi yang sedang
bekerja — inilah yang terlihat "plain". Pill `awaiting` ("Menunggu keputusan", amber, berdenyut)
**sudah ada** di design-system (`ds/components/feedback.tsx:89`) tapi **tak pernah tersambung**
ke terminal (dicatat ADR-0036). Akar: state decision terdeteksi server-side (`liveDecisions()` +
marker `.worktrees/.decisions/<id>`), tetapi tak pernah dikirim ke client — `listSessions()`
membuang `decisionFile`, dan tipe `TerminalSession` tak punya field decision.

**B. Notifikasi mati saat pindah tab.**
Notifikasi hanya in-app `showToast` + `playNotifySound` (`NotificationsContext.tsx`). Toast
cuma tampak saat tab hanoman fokus; pindah tab/window = tak ada apa-apa. Akar: tak pernah
memakai **Web Notifications API** (`Notification`) yang muncul di level OS lepas dari tab mana
yang fokus. Server sudah membuat notif `done` **dan** `decision` dan poll sudah menariknya —
yang kurang hanya kanal OS-level.

## Hasil yang diharapkan (acceptance)

1. Terminal sesi **success** (`exited`) punya pembeda kontras (tetap: pill "Selesai" + redup + tint).
2. Terminal sesi **human decision** (menunggu keputusan) punya pembeda: pill amber berdenyut
   "Menunggu keputusan" + tint header — tidak lagi identik dengan sesi yang sedang bekerja.
3. Notifikasi (`done` **dan** `decision`) tetap muncul saat user pindah tab browser, lewat
   notifikasi OS, bukan hanya toast in-app.

## Arsitektur & keputusan

Reuse semua yang sudah ada; nol dependency baru; nol migrasi (state decision & skema Notification
sudah ada). Perubahan API bersifat **additif** (field baru pada respons list), bukan breaking.

### Part A — surface `decision` ke client + render pembeda

**Server (`server/src/services/pty.ts`):**
- `SessionInfo` menambah `decision: boolean`.
- Helper cek marker dipusatkan di `pty.ts` sebagai `markerFilled(f)` (`statSync(f).size > 0`,
  gagal→false) dan di-export; `notifications.ts` mengimpornya menggantikan `nonEmpty` privatnya
  (arah dependency tetap notifications→pty, tanpa siklus).
- `listSessions()` menghitung `decision: !exited && !!decisionFile && markerFilled(decisionFile)`.
  `listPanes()` sudah membaca `@hanoman_decision_file` dari tmux — nol sumber data baru.

**Client (`src/src/api/client.ts`):** `TerminalSession` menambah `decision?: boolean`.

**Client (`src/src/screens/TerminalScreen.tsx`):**
- Poll ringan `listTerminals()` di interval (`~8s`) untuk menyegarkan `exited` + `decision` live —
  saat ini list hanya di-fetch sekali di mount. Poll di-**guard perubahan**: hitung signature
  `id|exited|decision` terurut; hanya `setSessions` bila berubah, agar efek rekonsiliasi/simpan
  tak thrash tiap tick. tmux adalah source of truth, jadi respons list menggantikan state (sesi
  optimistik dari `openNew`/`pickBacklog` sudah ada di tmux saat POST resolve).
- `Cell`: urutan state — `exited` → `StatusPill status="done" "Selesai"` + badan `opacity 0.6`
  (tetap); else `decision` → `StatusPill status="awaiting"` (label default "Menunggu keputusan").
  Header cell diberi `background` tint sesuai state (`--status-ok-tint` utk done, `--status-warn-tint`
  utk decision, `--bone-200` selain itu) agar pembeda terbaca sekilas — bukan hanya pill kecil.

### Part B — notifikasi OS lintas tab (`src/src/notifications/NotificationsContext.tsx`)

- Pada gestur user pertama (reuse handler `unlock` yang sudah ada untuk audio), minta izin:
  `if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission()`.
- Di `tick`, saat `latest` fresh & `t.enabled`: selain `showToast` + `playNotifySound`, panggil
  `notifyOS(t, latest)`.
- `notifyOS`: hanya menembak bila `"Notification" in window && Notification.permission === "granted"
  && document.hidden` (tab tak terlihat → toast in-app takkan terlihat; hindari double-signal saat
  tab fokus). `new Notification(t.msg, { tag: latest.id })`; `onclick` → `window.focus()` lalu
  `onOpen?.(latest)` (redirect ke sesi yang sama). Guard `"Notification" in window` menjaga
  lingkungan test/node tak error.

## Testing

- **Server:** `markerFilled` (pure fs) — kosong/absent → false, non-kosong → true (temp file).
  Derivasi `decision` di `listSessions` diverifikasi lewat route test terminal.
- **Client — Cell:** `decision:true, exited:false` → "Menunggu keputusan"; `exited:true` →
  "Selesai" (bukan "Menunggu keputusan"); keduanya false → tak ada pill. Poll: `listTerminals`
  yang mengembalikan `decision:true` di tick berikut memunculkan pill (fake timers).
- **Client — Provider:** render `NotificationsProvider` dgn `api` & global `Notification` di-mock,
  `document.hidden=true`, fake timers → `new Notification` terpanggil saat notif fresh datang;
  saat `document.hidden=false` → tidak.

## Alternatif yang ditolak

- **Push decision via WebSocket (fs.watch per sesi):** real-time tapi butuh infra watcher baru;
  latensi decision by-design sudah ~60s (ADR-0036), poll ~8s jauh lebih ketat & tanpa infra baru.
- **Selalu tembak notifikasi OS (tak peduli fokus):** memicu double-signal (toast + OS) saat user
  sudah menatap tab; `document.hidden` memisahkan keduanya dengan bersih.
- **Service Worker + Push:** untuk notifikasi saat tab tertutup total; di luar scope ("pindah tab",
  bukan "tutup tab") dan berat. Web Notifications API cukup selama tab masih terbuka di background.

## Docs tersentuh (Source of Truth, commit yang sama)

- `internal/docs/frontend/frontend-implementation.md` — §Terminal (pembeda decision) & §Notifikasi (OS).
- ADR baru bila perlu menandai penambahan field `decision` pada respons list & kanal notifikasi OS —
  additif, kemungkinan cukup catatan di ADR-0036/0033; diputuskan di plan.
