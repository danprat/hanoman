# SPEC-492 — Setelan runtime, model, dan effort khusus sesi operator Telegram

**Tanggal:** 2026-08-02 · **Sumber:** brief · **Prioritas:** sedang
**Status:** design disetujui (percabangan sumber nilai diputuskan operator, lihat §2)

## 1. Objective

Operator Telegram bisa dijalankan dengan runtime, model, dan effort sendiri, terpisah dari default
global sesi kerja — **dan bisa diubah dari dalam chat Telegram, termasuk saat sesi operator sedang
hidup**.

Beban kerjanya memang beda jauh: sesi kerja menulis kode, operator Telegram sebagian besar membaca
API lalu merangkum. Terukur pada chat 2026-08-01: giliran `/start` **95 detik** dan `/help` **14
detik** pada effort `xhigh`, sementara ongkos kirim ke Telegram sendiri **0,4 detik**. Menurunkan
effort untuk kanal ini adalah tuas latensi paling langsung yang hari ini tidak tersedia.

## 2. Temuan yang mengubah bentuk kerja: nilai sesi operator DIBEKUKAN, bukan diwarisi

Brief mengasumsikan `productionFactory()` menyerahkan `defaults: sessionAgentDefaults` yang dibaca
setiap sesi lahir. **Tidak.** `TelegramSessionCoordinator.dispatch()` memanggil `deps.defaults()`
**hanya saat baris `TelegramChat` belum ada**:

```ts
let context = await this.deps.store.chatContext(input.chatId);
if (!context) {
  const defaults = await this.deps.defaults();     // ← satu-satunya pembaca
  await this.deps.store.ensureChat({ …, agent, model, effort });
  …
}
…
this.deps.port.createSession(projectId, cwd, {
  agent: context.agent, model: context.model, effort: context.effort,   // ← dari baris DB
});
```

`store.ensureChat` ber-`update: { userId }` saja, dan **tak ada satu pun penulis lain** untuk ketiga
kolom itu: `patchChat` menerima `sessionId`/`activeProjectId`/`activeSessionId`/`personalityAgentId`/
`summary`, dan `PATCH /api/telegram/chats/:chatId/context` (`zContextPatch`) menerima empat field yang
sama. `TelegramChat.agent/model/effort` karena itu adalah **snapshot default global saat chat pertama
kali menyapa**, permanen.

Bukti dari instalasi hidup (`~/.hanoman/hanoman.db`):

```
$ sqlite3 ~/.hanoman/hanoman.db "select count(*) from TelegramChat"
1
$ … "select chatId,agent,model,effort from TelegramChat"
6438606671|claude|claude-opus-5|xhigh
```

Satu-satunya chat yang ada **sudah punya barisnya**. Menukar `defaults: sessionAgentDefaults` →
`telegramAgentDefaults` (AC-3 apa adanya) karena itu akan menghasilkan setelan yang **nol efek** pada
satu-satunya chat yang ada — kelas bug yang sama dengan SPEC-487 ("`Setting.lead` tersimpan
membekukan default": `timeoutSec` 120 vs 600).

**Keputusan operator (2026-08-02):** resolver jadi otoritas di **tiap kelahiran sesi operator**, dan
setelannya **bisa diubah dari chat Telegram, juga di tengah sesi**.

## 3. Arsitektur

### 3.1 Skema — satu bentuk, bukan bentuk ketiga

`zTelegramSettings` mendapat sub-objek `engine` dengan bentuk `zLeadEngine` **persis** — bukan
salinan. Karena `entities.ts` sudah meng-`import` dari `./telegram` (baris 3), menaruh
`import { zLeadEngine } from "./entities"` di `telegram.ts` menciptakan **siklus modul yang meledak
saat boot**: `index.ts` mengevaluasi `./entities` lebih dulu → entities meng-import `./telegram` →
telegram mengevaluasi `TELEGRAM_DEFAULTS = zTelegramSettings.parse({})` di top level → `zLeadEngine`
(baris 237 entities) masih **TDZ** → `ReferenceError` sebelum satu route pun terdaftar.

Karena itu bentuknya **diekstrak ke modul daun**:

```
shared/src/agent-engine.ts   (BARU, hanya bergantung pada zod + ./enums)
  zAgentEngine = { enabled:false, agent:"claude", model:"claude-opus-5", effort:"xhigh" }

shared/src/entities.ts   zLeadEngine = zAgentEngine      (alias — semua import lama utuh)
shared/src/telegram.ts   engine: zAgentEngine.default({})
```

`TELEGRAM_DEFAULTS` tetap `zTelegramSettings.parse({})`, jadi `engine.enabled` **false** by default →
instalasi yang sudah jalan tak berubah perilakunya setelah upgrade. Kolom `Setting.data` bertipe
`Json` → **tanpa migration**, cermin `scheduler`/`goal`/`conflict`/`lead`.

Model & effort tetap `z.string()` longgar seperti di lead: katalog ditegakkan **permukaan operator**
(kartu Settings dan — baru — parser command Telegram), bukan server.

### 3.2 Resolver

`server/src/services/telegram/config.ts` (BARU, cermin `services/lead/config.ts`):

```ts
getTelegramEngine(): Promise<AgentEngine>
setTelegramEngine(patch): Promise<AgentEngine>      // read-modify-write SELURUH Setting
telegramAgentDefaults(): Promise<{agent, model, effort}>
```

`telegramAgentDefaults()` sejajar `leadAgentDefaults()`: `enabled:false` → `sessionAgentDefaults()`;
`enabled:true` → nilai `engine`, dengan `coerceCodexEffort()` saat `agent === "codex"` supaya blok ini
tak bisa menyimpan pasangan yang nanti ditolak codex saat sesi lahir (SPEC-339).

`setTelegramEngine` **wajib** read-modify-write dari `getSetting()` segar — bukan menimpa blok
`telegram` dari snapshot — karena blok itu punya penulis kedua (`PUT /settings` dari layar Settings).

### 3.3 Titik pemakaian — kelahiran sesi, bukan kelahiran chat

`dispatch()` memanggil `deps.defaults()` **setiap kali sesi operator baru dilahirkan**, bukan hanya
saat baris chat belum ada. Hasilnya dipakai untuk:

1. argv sesi (`agent`/`model`/`effort` ke `createSession`),
2. **`ensureCodexTrust`** — diturunkan dari agen HASIL resolver, bukan dari `context.agent`. Gotcha
   mengikat SPEC-377/ADR-0081: membacanya dari sumber yang salah membuat sesi codex mentok di layar
   trust tanpa manusia di pane,
3. **tulis balik** ke `TelegramChat` (`store.setChatEngine`) supaya
   `GET /api/telegram/chats/:chatId/context` — yang dibaca agen operator sendiri — melaporkan runtime
   yang benar-benar dipakai, bukan snapshot lama.

Steer ke pane yang **sudah hidup** tidak menyentuh resolver sama sekali: sesi adalah satu proses,
satu model seumur hidup (ADR-0061).

### 3.4 Permukaan operator di Telegram — command yang dicegat gateway

Hari ini **semua** command Telegram diteruskan mentah ke pane dan ditangani agen operator
(`COMMANDS` di `runner/src/telegram-operator.ts`). Empat command runtime **sengaja tidak** ikut jalur
itu, dan dicegat di `dispatch()` sebelum apa pun menyentuh pane:

| Command | Arti |
|---|---|
| `/engine` | Tampilkan sumber (override / default global), runtime · model · effort, dan keadaan sesi operator |
| `/engine off` | `enabled:false` → kembali mewarisi default global sesi kerja |
| `/engine restart` | Tutup sesi operator sekarang; pesan berikutnya lahir dengan setelan baru |
| `/runtime claude\|codex` | Tukar runtime — model & effort ikut pindah ke default agen itu |
| `/model <id>` | Tukar model (divalidasi katalog agen aktif; effort dikoersi bila codex) |
| `/effort <x>` | Tukar effort (divalidasi katalog model aktif) |

Empat alasan cegatannya duduk di server, bukan di agen operator:

1. **Ia soal transport, bukan soal isi hanoman.** Agen tak bisa mengubah model proses yang sedang
   menjalankan dirinya sendiri.
2. **Nol giliran agen.** Giliran `/help` terukur 14 detik; menukar effort tak boleh membayar itu.
3. **Bekerja saat agennya justru macet** — yaitu keadaan yang paling mungkin membuat orang ingin
   menurunkan effort.
4. Presedennya sudah ada: gateway sudah mencegat update `callback` konfirmasi sebelum `dispatch`.

`/runtime|/model|/effort` **menyalakan `enabled` secara implisit** — menyetel nilai lalu tak terjadi
apa-apa adalah jebakan yang sama dengan §2. `/engine off` satu-satunya jalan kembali mewarisi.

Setelan ini **global untuk semua chat**, bukan per-chat (constraint brief): command menulis
`Setting.telegram.engine`, blok yang sama persis dengan yang ditulis kartu Settings.

### 3.5 Yang TIDAK dilakukan: mengetik ke pane hidup

Model & effort claude/codex bisa diubah in-session dengan mengetik `/model`/`/effort` di TUI. Kita
**tidak** melakukannya. ADR-0061 sudah mencabut matrix per-fase persis karena mekanisme itu tak
andal, dan SPEC-487 mengukur kelasnya: mengetik ke pane yang sedang menjalankan giliran menghasilkan
**pesan liar** ke sesi yang sedang bekerja (6 dari 22 keputusan lead, 5 di antaranya benar-benar
mendarat di pane sibuk). Menukar setelan diam-diam menjadi "mungkin berlaku, mungkin jadi teks
sampah di tengah pekerjaan" bukan tawaran yang jujur.

Gantinya deterministik dan dinyatakan: setelan tersimpan, lalu `/engine restart` menutup sesi
operator. Konteks **tidak** hilang — ringkasan & curated memory memang hidup di DB dan disematkan ke
prompt sesi berikutnya (`buildTelegramOperatorPrompt`, bagian "Context tahan restart").

### 3.6 Kartu Settings

Kartu **"Agen operator Telegram"** bersebelahan dengan **"Agen hanoman-lead"** di tab *Model sesi* —
toggle "Pakai setelan sendiri" + tiga dropdown Runtime/Model/Effort yang muncul hanya saat toggle
hidup, persis pola kartu lead (termasuk `codexNote`, `codexOptions`, dan koersi effort saat model
codex ditukar). Saat toggle mati kartu **menampilkan nilai warisan**, supaya tak ada pertanyaan "lalu
operator Telegram pakai apa".

Deskripsi kartu menyatakan AC-6 secara eksplisit: berlaku untuk **sesi operator berikutnya**; sesi
yang sedang jalan tetap memakai setelan lamanya sampai ditutup (`/engine restart` dari chat).

Penulisnya **membaca ulang `GET /settings` segar** sebelum `PUT`, bukan mengirim snapshot yang dimuat
saat mount. Alasannya konkret: sejak §3.4 blok `telegram` punya penulis kedua dari luar browser
(command chat), dan mengirim snapshot akan mengembalikan `engine` ke nilai lama tanpa satu klik pun
yang mengatakannya — kelas bug SPEC-488 pada blok `lead`.

### 3.7 `PUT /settings` tak lagi me-reload gateway untuk perubahan `engine`

`routes/settings.ts` memanggil `reloadTelegramGateway()` bila blok `telegram` berubah. `engine`
dibaca **lazily** oleh `telegramAgentDefaults` di tiap kelahiran sesi, jadi reload tak diperlukan —
dan tak gratis: reload menghentikan long-poll lalu memanggil `getMe()`, sehingga kegagalan jaringan
sesaat akan menjatuhkan `readiness` ke `error` gara-gara seseorang menggeser satu dropdown.
Perbandingannya karena itu **mengecualikan `engine`**.

## 4. Aliran data

```
kartu Settings ──PUT /api/settings──┐
                                    ├──► Setting.telegram.engine (Json, tanpa migration)
/runtime|/model|/effort (chat) ─────┘              │
                                                   ▼
                                    telegramAgentDefaults()
                                      enabled? engine : sessionAgentDefaults()
                                                   │
                          ┌────────────────────────┴───────────────────┐
                          ▼                                            ▼
              createSession(agent,model,effort)              ensureCodexTrust(agen hasil)
                          │
                          └──► store.setChatEngine() ──► GET /telegram/chats/:id/context
```

## 5. Acceptance criteria

- **AC-1** `zTelegramSettings.engine` ada, berbentuk `zAgentEngine`, default
  `{enabled:false, agent:"claude", model:"claude-opus-5", effort:"xhigh"}`. `zSetting.parse({})` atas
  baris Setting lama tanpa blok itu tetap lulus dan menghasilkan `enabled:false`.
- **AC-2** `telegramAgentDefaults()` mengembalikan `sessionAgentDefaults()` persis saat
  `enabled:false`; saat `enabled:true` mengembalikan nilai `engine`, dengan effort dikoersi
  `coerceCodexEffort()` untuk codex.
- **AC-3** `productionFactory()` memakai `telegramAgentDefaults` di field `defaults`.
- **AC-4** Sesi operator **BARU** lahir dengan hasil resolver **segar**, meski baris `TelegramChat`
  sudah ada dengan nilai lain. `ensureCodexTrust` dipanggil untuk agen hasil resolver. Baris
  `TelegramChat` ikut diperbarui.
- **AC-5** Steer ke pane operator yang **masih hidup** tidak melahirkan sesi baru dan tidak mengubah
  runtime sesi itu.
- **AC-6** `/engine` melaporkan setelan aktif tanpa menyentuh pane; `/runtime`, `/model`, `/effort`
  menulis `Setting.telegram.engine` (menyalakan `enabled`) dan membalas apa yang berubah; `/engine off`
  mengembalikan pewarisan; `/engine restart` menutup sesi operator. Keenamnya **tak** meneruskan
  apa pun ke pane.
- **AC-7** `/model` & `/effort` menolak nilai di luar katalog agen aktif dengan balasan yang
  **menyebutkan daftar yang sah**; setelan tersimpan tak berubah saat ditolak.
- **AC-8** Kartu "Agen operator Telegram" ada di tab Model sesi: toggle + tiga dropdown yang muncul
  hanya saat toggle hidup, dan teks warisan saat mati. Tertulis lewat `GET`+`PUT /api/settings` yang
  sudah ada, membaca ulang nilai segar sebelum menulis.
- **AC-9** `PUT /settings` yang **hanya** mengubah `telegram.engine` tidak memicu
  `reloadTelegramGateway()`; perubahan `enabled`/`progress` tetap memicunya.

## 6. Batas (non-goal)

- **Per-chat.** Setelan ini global untuk semua chat. Kalau nanti perlu per-chat, itu spec terpisah.
- **Tanpa endpoint baru, tanpa timer/scheduler baru** (ADR-0024), **tanpa migration**.
- **Tanpa menyentuh jalur kredensial** (`TELEGRAM_CONFIG_KEYS` di `RuntimeConfig`) — ini murni
  setelan runtime agen.
- **Tanpa knob global baru di akar `zSetting`** — `engine` duduk di dalam `telegram`, sebidang dengan
  `enabled` dan `progress`.
- **Tanpa ADR baru.** ADR-0096 (Telegram = transport ke sesi operator), ADR-0061 (satu sesi satu
  model), ADR-0074, dan ADR-0081 semuanya **ditegakkan**, bukan diamandemen: yang ditambahkan adalah
  satu blok opt-in bercorak `zLeadEngine` plus permukaan operatornya.

## 7. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Siklus modul `entities ↔ telegram` meledak saat boot | Bentuk diekstrak ke modul daun `agent-engine.ts`; `zLeadEngine` jadi alias. Diuji lewat import `@hanoman/shared` yang membaca `TELEGRAM_DEFAULTS`. |
| Sesi codex mentok di layar trust | `ensureCodexTrust` diturunkan dari agen **hasil resolver** (gotcha SPEC-377/ADR-0081), diuji eksplisit. |
| Kartu Settings mengembalikan `engine` dari snapshot | Baca ulang `GET /settings` segar tepat sebelum `PUT` (kelas SPEC-488). |
| Command runtime tertelan agen operator | Dicegat di `dispatch()` **sebelum** `getSession`/`sendToPane`; diuji bahwa `port.sent` dan `port.born` tetap kosong. |
| Nilai di luar katalog membuat sesi lahir rusak | Parser command memvalidasi terhadap `MODELS`/`EFFORTS`/`CODEX_MODELS`/`codexEfforts()` — katalog yang sama dengan UI. Skema server tetap longgar. |
| Balasan gateway ganda ("Diterima. Diteruskan ke sesi operator." sesudah jawaban command) | `dispatch()` mengembalikan penanda `control`; gateway melewati progress generiknya dan mengaudit `outcome: "control"`. |

## 8. Rencana verifikasi

Scope: hanya berkas yang berubah (ADR-0080).

- `shared`: default schema + tidak ada regresi bentuk `zLeadEngine`.
- `server`: resolver (4 cabang), kelahiran sesi memakai nilai segar + `ensureCodexTrust`, parser
  command (sah/tolak/katalog codex), cegatan `dispatch`, gerbang reload `PUT /settings`.
- `web`: kartu Settings (toggle mati → teks warisan; hidup → tiga dropdown; tulis membaca segar).
- Smoke nyata sekali di akhir: boot server, `GET /api/settings` → cek `telegram.engine`,
  `PUT /api/settings` dengan engine berubah → cek persist + gateway tak reload.
