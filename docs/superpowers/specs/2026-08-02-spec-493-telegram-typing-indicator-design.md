# SPEC-493 — Ganti pesan progress gateway Telegram dengan indikator typing

**Tanggal:** 2026-08-02 · **Sumber:** brief · **Prioritas:** tinggi
**ADR:** **0104 (baru)** — mengamandemen [ADR-0096](../../../internal/docs/adr/0096-telegram-gateway-session-operator-persisten.md) §5, **menegakkan** [ADR-0024](../../../internal/docs/adr/0024-sesi-interaktif-menggantikan-run.md)
**Tanpa** migration · **tanpa** endpoint baru · **tanpa** field setting baru

## 1. Objective

User melihat indikator "typing…" selama hanoman memproses pesannya, dan **tidak ada lagi pesan teks
progress** di chat.

Hari ini tiap update dibalas satu pesan robot sebelum jawaban aslinya keluar
(`server/src/services/telegram/gateway.ts:121-128`, kind `gateway-progress`):

> "Diterima. Diteruskan ke sesi operator."
> "Diterima. Sesi operator Hanoman untuk chat ini sedang dijalankan — jawabannya menyusul."

Pada sesi 2026-08-01, **7 update → 7 pesan progress terpisah**. Satu-satunya kendali adalah flag
`telegram.progress` yang semua-atau-tidak-sama-sekali: matikan, dan user tak punya tanda apa pun
bahwa pesannya sedang diproses — padahal satu giliran bisa makan **95 detik** (terukur SPEC-492).

## 2. Hambatan arsitektur yang harus diselesaikan spec ini

Gateway hanoman adalah **satu loop sekuensial** (`gateway.ts:200-223`):

```
while (!aborted) {
  updates = await getUpdates({ offset, limit: 100, timeout: pollTimeout ?? 25 })   // ← memblokir 25 dtk
  try { await processUpdates(updates) } finally { await flushOutbox() }
}
```

Selama long-poll memblokir, **tak ada yang bisa mengirim `sendChatAction` tiap ~4 detik** — dan umur
timer typing Telegram hanya ~5 detik. Loop yang sama sudah terbukti membuat balasan telat: terukur
**10,8 dtk · 11,3 dtk · 11,9 dtk** antara balasan siap dan mulai dikirim, padahal `sendMessage`
sendiri cuma **0,4 detik**. `pollTimeout` di-hardcode `?? 25` tanpa jalur config apa pun
(`gateway.ts:204`, satu-satunya kemunculan).

**ADR-0024 melarang timer/scheduler baru**, jadi "pasang `setInterval` typing" bukan pilihan.

### Keputusan: long-poll adaptif menjadikan loop yang sudah ada sebagai denyut

Saat ada update `dispatched` yang belum dijawab, timeout `getUpdates` turun ke **4 detik**; saat idle
kembali ke **25 detik**. Tiap iterasi loop lalu menjadi tick alami untuk **refresh typing sekaligus
`flushOutbox()`**. Nol timer baru, nol task baru — hanya satu argumen yang sudah dikirim tiap
iterasi. Efek sampingnya: jeda pengiriman balasan 10–12 detik itu ikut hilang, karena `flushOutbox()`
kini dijangkau tiap ≤4 detik selama ada pekerjaan, bukan tiap ≤25 detik.

**Bukan** `timeout: 0` — itu berubah jadi busy-poll ke API Telegram dan gampang kena 429.

## 3. Temuan yang mengubah bentuk implementasi

### 3.1 `retry_after` hari ini HILANG SECARA STRUKTURAL sebelum sempat dibaca

AC-5 menuntut "hormati `retry_after`". Tapi di `client.ts:72`:

```ts
if (!response.ok) throw new TelegramApiError(method, response.status, `HTTP ${response.status}`);
```

Telegram mengirim 429 sebagai **HTTP 429** dengan badan
`{"ok":false,"error_code":429,"description":"Too Many Requests: retry after 5","parameters":{"retry_after":5}}`.
Karena `response.ok` false, lemparan terjadi **sebelum** `response.json()` dipanggil — jadi
`parameters.retry_after` tak pernah ada satu pun pembacanya di seluruh basis kode. Menambahkan
cooldown tanpa memperbaiki ini menghasilkan cooldown yang **selamanya memakai nilai default**, dan
test-nya akan hijau karena tak ada yang mengadu ke nilai sungguhan.

**Fix:** `TelegramApiError` mendapat field `retryAfter?: number`, dan cabang `!response.ok` mencoba
membaca badan JSON (`.catch(() => null)` — badan non-JSON tetap sah) semata untuk memungutnya. **Teks
pesan galat tak berubah** (`HTTP <status>`), jadi tak satu pun assertion lama bergeser. Kedua titik
lempar (HTTP non-ok dan `envelope.ok === false`) meneruskan `retryAfter`.

### 3.2 `gateway-progress` tak punya pemakai lain

Enumerasi `server/src`+`server/test`+`shared/src`+`src`+`runner/src`+`cli/src`: kind
`gateway-progress` hanya muncul di `gateway.ts:15` (definisi) dan `:123` (satu-satunya pemakaian).
Menghapusnya tak menyentuh permukaan lain. Baris `TelegramOutbox` lama ber-kind itu (kalau ada di
instalasi hidup) tetap terkuras normal oleh `flushOutbox` — **tanpa migration**.

### 3.3 `TelegramChat.lastProgressKey` tetap tak disentuh

Kolom itu ada di skema dengan **nol pemakaian** (audit SPEC-491). Ia tak dibutuhkan di sini —
keaktifan typing diturunkan dari `TelegramUpdate.state` + `TelegramOutbox.kind`, bukan dari penanda
per-chat — dan menghapusnya butuh migration yang di luar scope.

## 4. Arsitektur

### 4.1 `client.ts` — `sendChatAction`

```ts
export type TelegramChatAction = "typing";

sendChatAction(chatId: string, action: TelegramChatAction = "typing"): Promise<boolean> {
  return this.call("sendChatAction", { chat_id: chatId, action });
}
```

Argumennya **posisional**, bukan objek seperti tetangganya, karena AC-2 menyebut bentuknya persis:
`sendChatAction(chatId, action)`. Nilai `action` sengaja union satu anggota: gateway hanoman tak
pernah mengunggah foto/dokumen, jadi `upload_photo` dst. hanya akan jadi permukaan mati.

`message_thread_id` (fallback hermes `adapter.py:7034-7044`) **tidak ada** di sini: gateway hanoman
hanya melayani **private chat** (`parseTelegramUpdate` menolak group/supergroup, ADR-0096), dan
private chat tak punya forum topic. Menambahkan fallback untuk parameter yang tak pernah dikirim
adalah kode mati.

### 4.2 `typing.ts` (BARU) — `TelegramTypingIndicator`

Satu kelas kecil, **nol dependensi DB**, satu-satunya pemilik state typing in-memory:

```ts
export const TYPING_REFRESH_MS      = 4_000;   // < 5 dtk umur timer Telegram
export const TYPING_MIN_INTERVAL_MS = 3_000;   // throttle refresh
export const TYPING_COOLDOWN_BASE_MS = 5_000;
export const TYPING_COOLDOWN_MIN_MS  = 1_000;  // pagar hermes: max(1s, min(delay, 300s))
export const TYPING_COOLDOWN_MAX_MS  = 300_000;

class TelegramTypingIndicator {
  constructor(deps: { client: TypingSender; enabled: boolean; now?: () => number })
  arm(chatId: string): Promise<void>                  // paksa — sesudah dispatch & sesudah tiap chunk
  refresh(chatIds: readonly string[]): Promise<void>  // ter-throttle — denyut loop
}
```

- **`enabled` = `Setting.telegram.progress`.** Mati → kedua method `return` seketika: **nol**
  panggilan `sendChatAction`. Itulah arti "mati = benar-benar senyap" (AC-6).
- **`arm()` memaksa**, tak melihat throttle: Telegram **menghapus** state typing begitu ada pesan
  masuk, jadi arm sesudah tiap chunk memang harus lolos (AC-4).
- **`refresh()` ter-throttle** `TYPING_MIN_INTERVAL_MS`: iterasi loop bisa berulang jauh lebih cepat
  dari 4 detik saat update datang beruntun (`getUpdates` kembali seketika), dan tanpa throttle
  denyutnya berubah jadi banjir.
- **Cooldown per chat.** Tiap kegagalan menaruh chat itu di `cooldownUntil`; selama itu `arm()` dan
  `refresh()` sama-sama melewatinya. Delay = `retry_after × 1000` bila ada, selain itu **backoff
  berlipat** dari 5 dtk (5 → 10 → 20 …). Keduanya dipagari `clamp(1 dtk, 300 dtk)` persis seperti
  hermes. Keberhasilan menghapus entri cooldown.
- **Tak pernah melempar.** Seluruh badan `arm`/`refresh` di dalam `try/catch`; kegagalan hanya
  menyetel cooldown. Ini pemenuhan langsung AC-5 ("jangan pernah biarkan kegagalan typing
  menggagalkan pengiriman balasan") **dan** constraint "kegagalan `sendChatAction` TIDAK BOLEH
  mengubah state update atau outbox" — kelas kegagalan itu tak punya jalur untuk kabur.
- Kegagalan **permanen** (403 bot diblokir, 400 chat not found) ikut jalur yang sama dan mengendap di
  cooldown 300 dtk. Tak ada klasifikasi transien-vs-permanen: typing bersifat kosmetik, dan
  membedakannya hanya menambah cabang yang tak mengubah keluaran apa pun.

### 4.3 `protocol.ts` — kosakata kind

```ts
export const TELEGRAM_GATEWAY_FAILURE_KIND = "gateway-failure";
/** Balasan yang MENGAKHIRI giliran: sesudahnya typing tak di-arm ulang (AC-4). */
export const TELEGRAM_FINAL_REPLY_KINDS: ReadonlySet<string> =
  new Set(["final", "decision", "failure", "confirmation", TELEGRAM_GATEWAY_FAILURE_KIND]);
```

Duduk di `protocol.ts` (modul daun kosakata wire) karena **dua** pemakainya — `gateway.ts` dan
`store.ts` — dan menaruhnya di `gateway.ts` akan membuat store meng-import gateway yang meng-import
store.

Definisi "final" = **semua kind kecuali `progress`**. `decision` dan `confirmation` ikut final karena
keduanya mengembalikan giliran ke manusia: indikator "hanoman sedang mengetik" saat yang ditunggu
justru jawaban user adalah kebohongan yang bikin user menunggu.

### 4.4 `store.ts` — `chatsAwaitingReply(since)`

```ts
async chatsAwaitingReply(since: Date): Promise<string[]>
```

Chat yang punya ≥1 `TelegramUpdate` ber-`state = "dispatched"`, `dispatchedAt >= since`, dan
**belum** punya baris `TelegramOutbox` ber-kind final untuk `updateId` itu. Dua kueri, difilter di
memori (`updateId` adalah PK global, jadi cukup dicocokkan sendirian):

```ts
const pending = await db.telegramUpdate.findMany({
  where: { state: "dispatched", chatId: { not: null }, dispatchedAt: { gte: since } },
  select: { updateId: true, chatId: true },
});
if (!pending.length) return [];
const answered = new Set((await db.telegramOutbox.findMany({
  where: { updateId: { in: pending.map((row) => row.updateId) }, kind: { in: [...TELEGRAM_FINAL_REPLY_KINDS] } },
  select: { updateId: true },
})).map((row) => row.updateId));
```

Dihitung pada saat **enqueue**, bukan **sent**: baris outbox lahir begitu sesi operator memanggil
`POST /telegram/replies`, dan jarak enqueue→kirim paling banyak satu iterasi loop. Menunggu `sent`
akan menahan typing melewati pesan finalnya sendiri.

**`since` adalah pagar keras.** `TYPING_MAX_WAIT_MS = 10 menit`: update yang sesi operatornya mati
akan mengendap `dispatched` **selamanya**, dan tanpa pagar ini gateway akan mengetik selamanya
sekaligus mengunci long-poll di 4 detik selamanya — 6× lipat trafik `getUpdates` untuk chat yang tak
akan pernah dijawab. Sepuluh menit = 6× giliran terlama yang pernah terukur (95 dtk).

### 4.5 `gateway.ts` — perubahan

**a. Blok `gateway-progress` DIHAPUS**, diganti satu baris:

```ts
await this.deps.store.markDispatched(input.updateId);
await this.deps.store.audit({ … });
await this.typing.arm(input.chatId);   // AC-3: nyala begitu dispatch selesai
```

`GATEWAY_PROGRESS_KIND` ikut hilang. `enqueueReply` gateway-failure di jalur `catch` **tidak
disentuh** (AC-7: kegagalan harus terbaca, bukan diwakili indikator yang hilang diam-diam).

**b. `flushOutbox()` me-arm ulang sesudah tiap chunk:**

```ts
for (let index = 0; index < chunks.length; index++) {
  const isLast = index === chunks.length - 1;
  …
  const message = await this.deps.client.sendMessage({ … });
  messageId = message.message_id;
  if (!(isLast && TELEGRAM_FINAL_REPLY_KINDS.has(row.kind))) await this.typing.arm(row.chatId);
}
```

Kondisinya membaca **dua** klausa AC-4 sekaligus: "di-arm ulang tepat setelah tiap chunk" (karena
pesan masuk menghapus state typing di sisi Telegram — jeda antar-chunk pada balasan panjang tetap
terlihat hidup) dan "tidak di-arm ulang setelah balasan final" (chunk terakhir dari kind final →
timernya dibiarkan habis sendiri; Telegram memang **tak punya API stop-typing**).

**c. Loop menjadi adaptif:**

```ts
private async loop(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    try {
      const waiting = await this.deps.store.chatsAwaitingReply(new Date(Date.now() - TYPING_MAX_WAIT_MS));
      await this.typing.refresh(waiting);
      const updates = await this.deps.client.getUpdates({
        offset: await this.deps.store.offset(), limit: 100,
        timeout: pollTimeoutFor(waiting.length, this.idlePollTimeout), signal,
      });
      …
    } catch { … }
  }
}
```

Urutannya mengikat: refresh **mendahului** `getUpdates` supaya indikator sudah menyala saat long-poll
mulai memblokir. Helper murni yang bisa dites tanpa loop:

```ts
export const pollTimeoutFor = (waiting: number, idle: number): number =>
  waiting > 0 ? Math.min(TYPING_ACTIVE_POLL_SEC, idle) : idle;   // TYPING_ACTIVE_POLL_SEC = 4
```

`Math.min` menjaga test yang menyuntik `pollTimeout` kecil tetap bermakna.

**Poll adaptif TETAP hidup saat `progress` mati.** `progress` menggerbangi **suara** gateway
(AC-6), sedangkan poll adaptif adalah soal **latensi pengiriman balasan** — kedua-duanya tak
berhubungan. Operator yang mematikan indikator tak sedang meminta balasannya telat 12 detik.
`chatsAwaitingReply` tetap dihitung (satu kueri ringan), `typing.refresh` yang menjadi no-op.

**d. Indikator disuntikkan lewat deps** (`typing?: TelegramTypingIndicator`), default dirakit dari
`deps.client` + `deps.progress`. `TelegramGatewayClient` (port) bertambah `sendChatAction` — fake
client di test karena itu ikut merekam panggilannya, jadi perilaku typing bisa diuji lewat port yang
sudah ada tanpa seam baru.

### 4.6 Yang TIDAK berubah

`bootstrap.ts` (port `TelegramApiClient` sudah memenuhi kontrak baru), `shared/src/telegram.ts`
(`zTelegramSettings` utuh — **tak ada field setting baru**), skema Prisma, seluruh route
`/api/telegram/*`, dan jalur at-most-once update/outbox.

## 5. Acceptance criteria

| # | Kriteria | Bukti |
| --- | --- | --- |
| AC-1 | Kedua varian teks `gateway-progress` hilang; kind itu tak dipakai untuk pesan teks | `telegram-gateway.test.ts`: dispatch sukses → **nol** baris `TelegramOutbox`; `telegram-e2e.test.ts`: `sent` hanya berisi teks sesi operator |
| AC-2 | `TelegramApiClient.sendChatAction(chatId, action)` ada | `telegram-client.test.ts`: body `{ chat_id, action: "typing" }` ke `/sendChatAction` |
| AC-3 | Typing nyala begitu update di-dispatch; di-refresh selama ada update `dispatched` tanpa balasan final; interval < 5 dtk | `telegram-gateway.test.ts` (arm sesudah dispatch) · `telegram-store.test.ts` (`chatsAwaitingReply`) · `pollTimeoutFor(1, 25) === 4` |
| AC-4 | Di-arm ulang sesudah tiap chunk; **tidak** sesudah balasan final | `telegram-gateway.test.ts`: kind `progress` → arm; chunk terakhir kind `final` → tidak |
| AC-5 | Cooldown per chat, `retry_after` dihormati, dipagari 1–300 dtk, tak pernah menggagalkan balasan | `telegram-typing.test.ts` (429 + `retry_after`, clamp, backoff) · `telegram-client.test.ts` (`retryAfter` terbaca dari badan 429) · `telegram-gateway.test.ts` (`sendChatAction` selalu melempar → balasan tetap `sent`, update tetap `dispatched`) |
| AC-6 | `telegram.progress` menggerbangi typing; mati = benar-benar senyap | `telegram-gateway.test.ts` dengan `progress: false` → nol `sendChatAction`, nol pesan teks |
| AC-7 | `gateway-failure` tetap pesan teks | test lama `telegram-gateway.test.ts` tetap hijau tanpa diubah |

## 6. Test yang tersentuh

| Berkas | Perubahan |
| --- | --- |
| `server/test/telegram-typing.test.ts` | **BARU** — throttle, cooldown, `retry_after`, clamp, backoff, tak pernah melempar, `enabled:false` |
| `server/test/telegram-client.test.ts` | `sendChatAction` + `retryAfter` dari badan 429 |
| `server/test/telegram-store.test.ts` | `chatsAwaitingReply`: `dispatched` tanpa balasan · dengan `progress` (masih menunggu) · dengan `final` (selesai) · di luar `since` |
| `server/test/telegram-gateway.test.ts` | fake client + `sendChatAction`; typing sesudah dispatch/chunk; `progress:false` senyap; kegagalan typing tak menular; `pollTimeoutFor` |
| `server/test/telegram-e2e.test.ts` | assertion `expect.stringMatching(/^Diterima\./)` dihapus dari daftar `sent` |

## 7. Docs yang tersentuh

- **`internal/docs/adr/0104-telegram-typing-indicator-long-poll-adaptif.md`** (BARU) + tautan di
  `internal/docs/README.md` **dan** `internal/docs/adr/README.md`.
- `internal/docs/architecture/api-contract.md` — paragraf outbox gateway: `gateway-progress` tak lagi
  mengantre teks.
- `internal/skills/hanoman/SKILL.md` — butir Telegram: indikator typing + long-poll adaptif.

## 8. Risiko & mitigasi

| Risiko | Mitigasi |
| --- | --- |
| Update macet `dispatched` → typing & poll 4 dtk selamanya | `TYPING_MAX_WAIT_MS` 10 menit di `chatsAwaitingReply` |
| Poll 4 dtk menaikkan trafik `getUpdates` | Hanya saat ada pekerjaan in-flight; idle tetap 25 dtk. Long-poll 4 dtk **bukan** busy-poll (`timeout: 0` ditolak eksplisit) |
| Indikator berkedip saat `processUpdates`/`flushOutbox` lama | `arm()` paksa di dua titik terpanas (sesudah dispatch, sesudah tiap chunk) menutup justru jeda terpanjangnya |
| Tabrakan dengan SPEC-492 (Telegram engine) | Spec ini tak menyentuh `shared/src/telegram.ts` maupun `session.ts`; irisannya hanya `store.ts` (satu method baru di akhir kelas) |
