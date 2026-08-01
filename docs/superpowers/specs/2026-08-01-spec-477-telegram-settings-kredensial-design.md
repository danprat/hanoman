# SPEC-477 — Setting integrasi Telegram Bot lewat halaman Settings (tanpa .env)

- Tanggal: 2026-08-01
- Sumber: brief · prioritas tinggi
- ADR baru: **0097** (mengamandemen [0096](../../../internal/docs/adr/0096-telegram-gateway-session-operator-persisten.md),
  memperluas [0049](../../../internal/docs/adr/0049-config-runtime-store-registry.md); ADR-0065 & ADR-0037 utuh)
- Migration Prisma: **tidak ada**

## Objective

Kredensial dan opsi Telegram bot dapat diisi, diubah, diuji, dan dihapus sepenuhnya dari halaman
Settings hanoman. Nilai tersimpan di database, dibaca runtime tanpa restart, dan `.env` tidak lagi
diperlukan. Halaman Settings menyediakan: input Bot Token (masked, hanya menampilkan sebagian setelah
tersimpan), input Chat ID / Channel ID target, toggle aktif/nonaktif notifikasi Telegram, tombol Test
Connection yang mengirim pesan percobaan dan menampilkan hasil sukses/galat, serta tombol hapus
kredensial.

## Keadaan sekarang (terukur, bukan ingatan)

SPEC-476 / ADR-0096 sudah membangun gateway Telegram lengkap. Yang belum ada adalah pintu
konfigurasinya:

| Fakta | Bukti |
| --- | --- |
| Kredensial **hanya** dari env | `services/telegram/bootstrap.ts:55-58` `configuredFrom(env)` membaca `HANOMAN_TELEGRAM_BOT_TOKEN` / `_ALLOWED_USER_IDS` / `_AGENT_TOKEN` |
| Dibaca **sekali saat boot** | `server.ts` memanggil `installTelegramGateway(app, {apiBase})` satu kali sesudah `listen`; tak ada jalur reload |
| UI mengakui env sebagai satu-satunya jalan | `SettingsScreen.tsx:569-576` — onboarding menyuruh operator mengisi `.env` lalu **restart service**, ditutup kalimat "Tidak ada input secret di layar ini" |
| Store config runtime **sudah ada** | ADR-0049 · `RuntimeConfig` + `CONFIG_REGISTRY`; resolver `effectiveStr()` = **DB → env → default**, `sourceOf()` mengembalikan `"db" \| "env" \| "default"` |
| Secret sudah tak pernah balik plaintext | `routes/config.ts` `view()` → `masked` + `hasValue`; `PUT` dengan value kosong = pertahankan nilai lama |
| Tapi nilainya **plaintext di DB** | `config.ts` `setConfig` → `prisma.runtimeConfig.upsert({ value })` apa adanya |
| Dan `PUT /config` **bisa dicapai agent token** | `agent-capabilities.ts:35` `if (top === "settings" \|\| top === "config") return rw("settings")` — sementara AgentToken gateway Telegram sendiri wajib punya `settings:write` (`bootstrap.ts:20`) |

Dua baris terakhir adalah yang bertabrakan langsung dengan batasan brief ("simpan terenkripsi",
"hanya untuk sesi cookie admin"). Sisanya justru sudah setengah jalan: **semantik "DB kosong → pakai
`.env` → tandai deprecated" persis `effectiveStr()` + `sourceOf()` yang sudah berjalan.**

## Keputusan

### 1. Kredensial Telegram menjadi entri `CONFIG_REGISTRY`, bukan store kedua

Grup registry baru `telegram`, empat entri:

| Key | `kind` | `category` | `apply` | Catatan |
| --- | --- | --- | --- | --- |
| `HANOMAN_TELEGRAM_BOT_TOKEN` | `secret` | `credential` | `live` | dimasked di semua respons |
| `HANOMAN_TELEGRAM_AGENT_TOKEN` | `secret` | `credential` | `live` | plaintext AgentToken (ADR-0096 §2) |
| `HANOMAN_TELEGRAM_ALLOWED_USER_IDS` | `string` | `credential` | `live` | bukan rahasia, tapi kontrol keamanan |
| `HANOMAN_TELEGRAM_TARGET_CHAT_ID` | `string` | `knob` | `live` | tujuan Test Connection & pesan tanpa konteks update |

`kind` menentukan **masking**; `category` menentukan **pagar tulis**. Allowlist bukan rahasia (tak
perlu dimasked) tapi ia memutuskan siapa yang boleh memerintah bot — jadi ia `credential` agar ikut
pagar cookie-only keputusan 3. Memisahkan dua sumbu ini disengaja: menaruh allowlist di `kind:
"secret"` hanya demi pagarnya akan membuat operator tak bisa membaca kembali daftar yang ia isi
sendiri.

Konsekuensi yang didapat **gratis**, tanpa satu baris kode fallback pun:

- `.env` lama tetap bekerja — `effectiveStr()` jatuh ke `process.env` saat DB kosong.
- Penanda deprecated — `sourceOf(key) === "env"` sudah membedakannya, dan `ConfigEntryView.source`
  sudah menyeberang ke klien.
- DB **menang** atas env begitu operator mengisi Settings.

**Tak ada** `Setting.telegram.botToken`: blok `Setting` adalah kolom `Json` yang dikembalikan utuh
oleh `GET /settings` (capability `settings:read`) — menaruh secret di sana berarti membocorkannya ke
setiap pembaca settings, termasuk agent token.

### 2. Enkripsi at-rest untuk **semua** entri `kind: "secret"`

`server/src/services/secret-box.ts` — AES-256-GCM, satu mekanisme, tanpa cabang khusus Telegram.

- **Kunci**: 32 byte acak di `<HANOMAN_HOME>/secret.key`, mode `0600`, dibuat otomatis saat pertama
  dibutuhkan. Override opsional `HANOMAN_SECRET_KEY` (hex/base64, 32 byte) untuk operator yang ingin
  memegang kuncinya di tempat lain. Default **tidak** menuntut env apa pun — itulah syarat
  "`.env` tidak lagi diperlukan".
- **Format**: `enc:v1:<b64(iv)>:<b64(tag)>:<b64(ciphertext)>`. Ber-versi supaya rotasi algoritma
  kelak tak menuntut membaca-tebak.
- **Batas**: `setConfig` mengenkripsi bila `configEntry(key)?.kind === "secret"`; `loadConfig`
  mendekripsi saat mengisi cache. **Cache memegang plaintext** → `effectiveStr`/`effectiveBool`/
  `rawDbValue` dan seluruh pemakainya tak berubah satu baris pun, dan hot-path tetap sinkron.
- **Baris plaintext lama terbaca apa adanya** (tanpa prefix `enc:v1:` → kembalikan mentah), naik
  kelas jadi ciphertext saat ditulis ulang. Karena kolomnya sama dan hanya encoding-nya berubah,
  **tak ada migration Prisma**.
- **Gagal dekripsi** (kunci hilang/berganti) → baris diperlakukan **absen**, bukan melempar: boot
  tak boleh mati karena satu secret tak terbaca. Alasannya dicatat `console.error` sekali per key.
- `category: "bootstrap"` (`DATABASE_URL`, `TEST_DATABASE_URL`) tak pernah masuk `RuntimeConfig`
  (route menolaknya read-only), jadi tak tersentuh.

Yang ikut terenkripsi sekaligus: `SYNC_DEVICE_TOKEN`, `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`,
`CLAUDE_CODE_OAUTH_TOKEN`.

### 3. Kategori `credential` tak bisa ditulis agent token

`PUT /config` dan `DELETE /config/:key` menolak **403** bila `req.agent` ada **dan**
`entry.category === "credential"`.

Ini menutup jalur nyata, bukan hipotetis: AgentToken gateway Telegram wajib memegang
`settings:write` (ADR-0096 §2 menuntut 23 capability), dan `capabilityForRoute` memetakan `/config`
ke `settings:write` — tanpa pagar ini sesi operator Telegram bisa menulis ulang bot token dan
AgentToken-nya sendiri lewat percakapan.

Pagar ini di **permukaan handler**, bukan capability baru: `capabilityForRoute` hanya melihat
method+path dan tak pernah melihat `body.key`, jadi ia struktural tak bisa membedakan
`PUT /config {key:"SYNC_TICK_MS"}` dari `PUT /config {key:"GITHUB_TOKEN"}`. ADR-0065 utuh.

### 4. Bootstrap membaca resolver, bukan `process.env`

`installTelegramGateway` menerima `read?: (key: string) => string | undefined`, default
`effectiveStr`. Empat pembacaan env di `bootstrap.ts` diganti `read(...)`.

**Pasangan wajib — reorder `server.ts`.** Hari ini `loadConfig()` + `applyConfigOnBoot()` berjalan di
`void (async () => …)` **paling akhir**, sesudah `installTelegramGateway`. Dibiarkan begitu, cache
config masih kosong saat gateway lahir → resolver selalu jatuh ke env dan **seluruh fitur ini mati
senyap** (tak ada error; gateway sekadar berperilaku persis seperti sebelum SPEC-477). Keduanya
dinaikkan dan di-`await` **sebelum** `installTelegramGateway`.

### 5. Berlaku langsung tanpa restart

`reloadTelegramGateway()` di `bootstrap.ts` = `stopTelegramRuntime()` → `installTelegramGateway(...)`
lagi dengan `apiBase` yang disimpan saat pemasangan pertama. Dipanggil dari:

- `applyConfigSideEffect(key)` untuk key grup `telegram` — jadi `PUT /config`, `DELETE /config/:key`,
  dan endpoint Telegram di bawah semuanya lewat satu titik.
- `PUT /settings` bila blok `telegram` berbeda dari yang tersimpan (toggle `enabled`/`progress`).

Tak ada cache modul-level untuk kredensial: setiap reload membaca ulang lewat `read()`, dan
`TelegramApiClient` dibuat baru dengan token baru. Yang tetap module-level hanyalah `TelegramStore`
(murni pembungkus `prisma`, tak memegang kredensial).

Toggle mati tetap **tidak** membunuh tmux atau menghapus memory (ADR-0096 konsekuensi 2).

### 6. Tiga endpoint baru, semuanya COOKIE_ONLY

```
GET    /api/telegram/settings      → view kredensial + toggle + status
PUT    /api/telegram/settings      → simpan sebagian/semua field + reload
POST   /api/telegram/test          → kirim pesan percobaan (timeout 10 dtk)
DELETE /api/telegram/credentials   → hapus keempat key + reload
```

`capabilityForRoute` mengembalikan `"COOKIE_ONLY"` untuk `telegram/settings`, `telegram/test`, dan
`telegram/credentials` **sebelum** `rw("telegram")`. Sub-path `/telegram/*` yang lama (`status`,
`chats/*`, `replies`, `audit`) tak berubah — itu memang permukaan kerja sesi operator.

**`GET`** mengembalikan per-field `{key, label, kind, source, hasValue, masked?, value?}`. Bot token
& AgentToken **tak pernah** balik utuh — `masked` memakai `maskSecret()` yang sudah ada (`••••` +
4 karakter terakhir).

**`PUT`** menerima subset field. Secret dengan string kosong = **pertahankan nilai lama** (cermin
`PUT /config`), sehingga form bisa dikirim ulang tanpa mengetik ulang token. Validasi lewat
`parseConfigValue` — satu jalur dengan `PUT /config`.

**`POST /telegram/test`**:
- Tujuan = `HANOMAN_TELEGRAM_TARGET_CHAT_ID`, atau bila kosong dan allowlist berisi **tepat satu**
  id, id itu. Selain itu → `400` dengan pesan yang menyuruh mengisi target chat id.
- `getMe()` lalu `sendMessage()` memakai **klien sekali pakai**, bukan klien gateway yang sedang
  long-poll — menguji koneksi tak boleh mengganggu `getUpdates` yang berjalan.
- **Timeout keras 10 detik** lewat `AbortSignal.timeout(10_000)` yang diteruskan ke `transport`;
  UI tak pernah menggantung.
- Respons `{ok: true, botUsername, chatId}` atau `{ok: false, error}`. `error` **selalu** lewat
  `sanitizeTelegramOutput(msg, [botToken])`; `TelegramApiClient.safe()` sudah membuang token dari
  pesan galat dan URL, ini lapis kedua.

**`DELETE /telegram/credentials`** menghapus keempat key lalu reload. Bila nilai `.env` lama masih
ada, resolver akan **memakainya kembali** — itu memang semantik ADR-0049, dan respons menyebutkannya
eksplisit (`{cleared: [...], envFallback: [...]}`) supaya tak jadi kejutan diam.

### 7. Validasi format sebelum simpan

`shared/src/telegram.ts` (murni, bertest):

- `TELEGRAM_BOT_TOKEN_PATTERN` = `^\d{5,}:[A-Za-z0-9_-]{30,}$` — bentuk `<bot_id>:<secret>` BotFather.
- `TELEGRAM_CHAT_ID_PATTERN` = `^-?\d+$` — channel & supergroup **negatif**; menuntut non-negatif
  akan menolak justru kasus "Channel ID" yang brief sebut.
- Allowlist tetap `parseTelegramAllowedUserIds` yang sudah ada.

`ConfigEntry` mendapat dua field opsional `pattern?: string` + `patternError?: string`, ditegakkan
`parseConfigValue` untuk `kind` `string`/`secret`/`path`. Satu jalur validasi untuk `PUT /config`
maupun `PUT /telegram/settings`; nilai dari `.env` **tidak** divalidasi (ia sudah berjalan sebelum
spec ini — memvalidasinya berarti mematikan instance yang tadinya hidup).

### 8. UI — tab Telegram di Settings

Tiga kartu menggantikan onboarding "isi .env lalu restart":

1. **Kredensial** — empat field. Bot token & AgentToken `type="password"`, placeholder = nilai
   masked saat sudah ada, kosong = tak diubah. Tiap field punya badge sumber: `tersimpan`
   (`source==="db"`), `dari .env · deprecated` (`"env"`), `belum diisi` (`"default"`). Tombol
   **Simpan**.
2. **Uji & hapus** — tombol **Test Connection** (state `idle`/`mengirim…`/hasil sukses berisi
   `@username` + chat tujuan/hasil galat) dan tombol **Hapus kredensial** (konfirmasi dua langkah).
3. **Gateway & status** — toggle `enabled`/`progress` yang sudah ada + kartu readiness yang sudah
   ada, dengan teks "restart service" dicabut karena tak lagi benar.

## Arsitektur & batas modul

```
shared/src/telegram.ts            + pola validasi (murni)
shared/src/config-registry.ts     + 4 entri grup `telegram`, + pattern/patternError
shared/src/api.ts                 + paths & tipe view telegram settings
        │
server/src/services/secret-box.ts  ← BARU: encrypt/decrypt + kunci di HANOMAN_HOME (murni + I/O kunci)
server/src/config.ts               ← setConfig/loadConfig lewat secret-box; cache tetap plaintext
server/src/routes/config.ts        ← pagar `credential` vs req.agent
server/src/services/telegram/
        bootstrap.ts               ← read() resolver + reloadTelegramGateway()
        credentials.ts             ← BARU: view/simpan/hapus/uji (murni terhadap I/O lewat port)
server/src/routes/telegram.ts      ← 3 endpoint baru
server/src/services/agent-capabilities.ts ← COOKIE_ONLY untuk 3 sub-path
server/src/server.ts               ← loadConfig/applyConfigOnBoot SEBELUM installTelegramGateway
src/src/screens/SettingsScreen.tsx ← tab telegram: 3 kartu
```

`secret-box.ts` dan `credentials.ts` masing-masing punya satu tujuan dan bisa dites tanpa server:
yang pertama menerima kunci sebagai argumen (I/O kunci terisolasi di satu fungsi), yang kedua
menerima port `{read, write, clear, send}`.

## Error handling

| Keadaan | Perilaku |
| --- | --- |
| `secret.key` tak ada | dibuat otomatis, mode `0600` |
| `secret.key` tak bisa ditulis | `setConfig` untuk secret melempar → route balas `500` dengan pesan yang menyebut path, **tanpa** nilai |
| Dekripsi gagal | baris dianggap absen, `console.error` sekali, boot lanjut |
| Token format salah | `400` dari `parseConfigValue`, DB tak tersentuh |
| Test Connection: token salah | `{ok:false, error:"Telegram getMe gagal (401): …"}` — token sudah diredaksi klien |
| Test Connection: jaringan mati/lambat | dibatalkan pada 10 dtk, `{ok:false, error:"…timeout…"}` |
| Test Connection: chat tujuan kosong | `400` sebelum menyentuh jaringan |
| Reload gagal | status runtime `readiness:"error"` + `lastError`; kredensial tetap tersimpan |

## Testing

Test baru (semua di paket yang tersentuh, dijalankan `--changed` + `--no-file-parallelism`):

- `shared/src/telegram.test.ts` — pola bot token & chat id: terima format sah, tolak `abc`,
  tolak token tanpa `:`, **terima chat id negatif**.
- `server/test/config-registry.test.ts` (tambahan) — keempat entri Telegram ada; `parseConfigValue`
  menegakkan `pattern`; entri tanpa `pattern` tak berubah perilakunya.
- `server/test/secret-box.test.ts` — round-trip; ciphertext ≠ plaintext; ciphertext berubah tiap
  enkripsi (iv acak); tag rusak → gagal; nilai tanpa prefix `enc:v1:` dikembalikan apa adanya.
- `server/test/config-resolver.test.ts` (tambahan) — `setConfig("GITHUB_TOKEN", x)` menyimpan
  **ciphertext** di baris DB (dibaca lewat `prisma.runtimeConfig` langsung) sementara
  `effectiveStr` mengembalikan `x`; baris plaintext lama tetap terbaca lewat `loadConfig`.
- `server/test/config.route.test.ts` (tambahan) — agent token ber-`settings:write` mendapat `403`
  untuk `PUT`/`DELETE` key kategori `credential`, tapi tetap `200`/`204` untuk key `knob`; cookie
  admin lolos keduanya.
- `server/test/telegram-credentials.test.ts` — `GET` memasked bot token & tak pernah memuat
  plaintext-nya di seluruh body; `PUT` dengan secret kosong mempertahankan nilai lama; `PUT`
  format salah → `400`; `DELETE` mengosongkan & melaporkan `envFallback`.
- `server/test/telegram-test-connection.test.ts` — transport palsu: sukses → `{ok:true}`; `401` →
  `{ok:false}` **tanpa token di `error`**; transport yang tak pernah selesai → dibatalkan dan balas
  `ok:false` (menegakkan "tidak menggantung"); target kosong → `400` tanpa panggilan jaringan.
- `server/test/telegram-bootstrap-config.test.ts` — `read()` dari DB **menang** atas env; DB kosong
  → env dipakai (backward compatible); `reloadTelegramGateway` menghentikan gateway lama sebelum
  memulai yang baru.
- `server/test/agent-capabilities.test.ts` (tambahan) — `telegram/settings|test|credentials` =
  `COOKIE_ONLY`; `telegram/status|replies|audit` **tetap** `telegram:read|write`.
- `src/src/screens/SettingsScreen.test.tsx` (tambahan) — tab Telegram merender empat field, badge
  `dari .env · deprecated` saat `source==="env"`, dan tombol Test Connection menampilkan hasil.

## Yang **tidak** berubah

- ADR-0096 utuh: Telegram tetap transport; at-most-once; confirmation inline; reply eksplisit; bot
  token **tetap tak pernah masuk sesi** (gotcha 4 — sesi hanya menerima AgentToken, chat id, base URL).
- ADR-0065 utuh: pagar `credential` adalah kondisi tambahan di handler, bukan capability baru.
- ADR-0037 utuh.
- Tanpa migration Prisma, tanpa model baru, tanpa endpoint yang menghapus/mengganti yang lama.

## Gotcha yang wajib diingat

1. **`loadConfig()` wajib mendahului `installTelegramGateway`.** Urutan `server.ts` hari ini
   membuat gateway lahir dengan cache config kosong; kegagalannya **senyap dan tampak benar**
   (gateway jalan dari env seperti sebelumnya).
2. **Cache config memegang plaintext, DB memegang ciphertext.** Mengenkripsi di `effectiveStr`
   akan memaksa dekripsi di hot-path sinkron dan memutus setiap pemakai `rawDbValue`.
3. **Nilai tanpa prefix `enc:v1:` adalah plaintext lama, bukan data rusak.** Melemparkan error di
   sana akan mematikan setiap instance yang sudah punya `SYNC_DEVICE_TOKEN`/`GITHUB_TOKEN`.
4. **Chat id channel/supergroup negatif.** Pola `^\d+$` menolak persis kasus "Channel ID" yang
   diminta brief. Allowlist **user** id tetap non-negatif — dua pola berbeda, jangan disatukan.
5. **`capabilityForRoute` tak pernah melihat body.** Pagar kategori `credential` karena itu harus
   di handler `PUT /config`, bukan di peta route.
6. **Test Connection tak boleh memakai klien gateway.** Klien yang sedang `getUpdates` long-poll
   memegang `AbortController` loop-nya; menumpang di sana menukar "uji koneksi" dengan "putuskan
   polling".
7. **Nilai dari `.env` tak divalidasi pola.** Instance yang hidup hari ini dengan token berbentuk
   tak terduga harus tetap hidup; validasi adalah gerbang **tulis**, bukan gerbang baca.
8. **`DELETE` kredensial tidak selalu berarti gateway mati.** Bila `.env` lama masih terisi,
   resolver kembali memakainya — respons wajib menyebutkannya.
