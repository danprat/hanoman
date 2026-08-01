# Audit SPEC-491 — Telegram: pesan masuk tidak pernah tertangkap dan tidak ada balasan

**Sumber:** qa · **Prioritas:** tinggi · **Severity:** critical · **Tanggal:** 2026-08-01
**Metode:** `superpowers:systematic-debugging` — pembacaan state instalasi hidup
(`~/.hanoman/hanoman.db`) + repro terinstrumentasi atas jalur produksi sesungguhnya
(`installTelegramGateway` → `productionFactory` → `TelegramApiClient` → loop → coordinator),
hanya soket jaringan Telegram & tmux yang dipalsukan

## Keluhan

> "Tidak ada apa-apa: pertanyaan tidak pernah tertangkap dan tidak ada balasan sama sekali. Diam
> total, tanpa pesan error di chat. … Test Connection dari Settings perlu dicek terpisah karena ia
> TIDAK melewati jalur inbound sama sekali (bisa lulus meski inbound mati)."

## Ringkasan temuan

Kecurigaan pelapor benar, dan lebih tajam dari dugaannya: **jalur inbound tidak pernah dinyalakan.**
Bukan `parseTelegramUpdate` yang menolak, bukan rate limit, bukan dedup, bukan dispatch ke pane —
`getUpdates` **tidak pernah dipanggil satu kali pun**. Gateway berhenti di gerbang readiness
`installTelegramGateway` (`bootstrap.ts:138-154`) karena nilai `HANOMAN_TELEGRAM_AGENT_TOKEN` yang
tersimpan **tidak cocok dengan AgentToken mana pun**.

Mesin transportnya sendiri **sehat** — dibuktikan dengan menjalankan jalur produksi yang sama atas
token yang sah (§C).

Yang membuat kegagalan ini **diam** adalah tiga permukaan yang semuanya berkata "beres":

| # | Permukaan | Yang dilaporkannya | Yang sebenarnya |
|---|---|---|---|
| **1** | `PUT /telegram/settings` — simpan kredensial | "Kredensial Telegram disimpan" | nilai divalidasi hanya oleh pola `^\S{20,}$`; **tak pernah diadu ke tabel `AgentToken`** → kredensial yang tak mungkin lolos auth tersimpan sebagai sah |
| **2** | `POST /telegram/test` — Test Connection | hijau: "bot @x mengirim ke chat y" | hanya `getMe` + `sendMessage` dengan **bot token**; nol sentuhan ke gerbang inbound. Hijau sambil inbound mati adalah hasil yang **normal**, bukan anomali |
| **3** | chat Telegram | senyap | gateway **tak punya suara sendiri**: `progress` diteruskan ke `TelegramGateway` lalu **tak dibaca apa pun** (§D) |

## A · Bukti dari instalasi hidup (`~/.hanoman/hanoman.db`)

Semua baca-saja, atas DB produksi operator:

| Lapis | Yang diharapkan | Yang terukur | |
|---|---|---|---|
| `Setting.telegram` | gateway menyala | `{"enabled":true,"progress":true}` | ✅ |
| `Setting.agentAccessEnabled` | master switch menyala | `true` | ✅ |
| `RuntimeConfig` | 3 kunci wajib terisi | bot token, agent token, allowlist — semua ada → `configured: true` | ✅ |
| **`AgentToken` ← token tersimpan** | **cocok satu baris** | nilai terdekripsi = **64 karakter hex**, prefix `61783865…`, **tanpa awalan `hnm_agt_`**; `sha256` -nya **tidak cocok baris mana pun** | ❌ |
| `AgentToken` (satu-satunya baris) | 23 capability | `claude code` punya **20** — kurang `agents:read`, `telegram:read`, `telegram:write` | ❌ |
| `TelegramGatewayState` | ≥1 baris (offset) | **kosong** | ❌ |
| `TelegramUpdate` | ≥1 baris | **0** | ❌ |
| `TelegramAudit` | ≥1 baris | **0** | ❌ |
| `TelegramChat` / `TelegramOutbox` | binding + outbox | **kosong** | ❌ |

`TelegramUpdate` nol **beserta** `TelegramAudit` nol adalah tanda tangan yang membedakan: setiap
penolakan inbound (group, non-allowlist, rate limit, malformed) **tetap menulis satu baris
`TelegramUpdate` dan satu baris audit** (`gateway.ts:61-82`). Nol di keduanya berarti tak ada satu
byte pun yang pernah masuk — poller-nya memang tidak pernah hidup.

Dua kegagalan independen, keduanya cukup sendirian:

1. **Nilai yang tersimpan bukan AgentToken.** 64 hex tanpa prefix — bentuk sebuah **digest
   `sha256`**, bukan plaintext `hnm_agt_` + 48 hex yang diterbitkan `issueAgentToken`.
   `verifyAgentToken()` mencari `tokenHash: sha256(nilai)` → tak ketemu → `null`.
2. **Andai token yang benar dipasang pun, ia tetap ditolak.** Satu-satunya AgentToken di instalasi
   itu kekurangan 3 dari 23 capability yang dituntut `TELEGRAM_REQUIRED_CAPABILITIES`.

## B · Mengapa itu berarti diam total

`bootstrap.ts:138-154`:

```ts
const agent = setting.agentAccessEnabled ? await verify(read("HANOMAN_TELEGRAM_AGENT_TOKEN")!) : null;
const missing = agent ? TELEGRAM_REQUIRED_CAPABILITIES.filter((c) => !agent.capabilities.includes(c)) : [...ALL];
if (!agent || missing.length) { setTelegramRuntime({ … readiness: "misconfigured" … }); return; }
```

`return` di sini terjadi **sebelum** `productionFactory` — jadi tak ada `TelegramApiClient`, tak ada
`getMe`, tak ada `gateway.start()`, tak ada loop. Gerbangnya benar; yang tak ada adalah jalan bagi
operator untuk mengetahui ia sedang berdiri di depannya.

## C · Repro terinstrumentasi (jalur produksi, dua kondisi)

Menjalankan `installTelegramGateway` sungguhan (resolver config → `productionFactory` →
`TelegramApiClient` → `TelegramGateway.loop` → `TelegramSessionCoordinator` → `TelegramStore`),
dengan **hanya** `fetch` ke `api.telegram.org` dan `services/pty` yang dipalsukan:

| Kondisi | `readiness` | panggilan Telegram API | `TelegramUpdate` | pane lahir |
|---|---|---|---|---|
| token 64-hex seperti produksi | `misconfigured`, `running:false`, `lastError:"AgentToken Telegram tidak valid atau akses agent mati"` | **`[]` — nol, bahkan `getMe` tak pernah** | **0** | tidak |
| AgentToken sah + 23 capability | `running` | `["getMe","getUpdates","getUpdates","getUpdates"]` | **1**, `state:"dispatched"` | ya, `telegram-73475cb40a568e8d`, env lengkap |

Kolom kiri **identik** dengan yang terbaca di DB produksi (§A). Kolom kanan membuktikan
`parseTelegramUpdate` → `recordUpdate` → `claimUpdate` → `dispatch` → `createSession` bekerja apa
adanya: audit menutup dengan `dispatch/session-created`, dan pane menerima
`HANOMAN_API_BASE` + `HANOMAN_TELEGRAM_AGENT_TOKEN` + `HANOMAN_TELEGRAM_CHAT_ID`.

**Kesimpulan:** tak ada cacat di mesin inbound. Cacatnya di **permukaan konfigurasi** yang
mengizinkan mesin itu tak pernah dinyalakan sambil melaporkan sebaliknya.

## D · Mengapa "tanpa pesan error di chat" tetap benar bahkan sesudah token dibetulkan

`TelegramGateway` **tidak pernah mengirim pesan yang ia karang sendiri**. Satu-satunya jalan sebuah
byte sampai ke chat adalah `TelegramOutbox`, dan satu-satunya pengisi outbox adalah
`POST /api/telegram/replies` — yaitu **session operator**. Konsekuensinya:

- `deps.progress` dirakit dari `Setting.telegram.progress` (`bootstrap.ts:97,162`), masuk ke
  `GatewayDeps` (`gateway.ts:25`), lalu **tak dibaca sama sekali**. Toggle "Kirim progress ringkas"
  di Settings tidak terhubung ke apa pun.
- `TelegramChat.lastProgressKey` ada di skema (`schema.prisma:486`) dan **nol pemakaian** di seluruh
  kode — sisa rancangan yang tak pernah mendarat.
- Saat `dispatch` gagal, `processUpdate` menulis `state="uncertain"` + audit lalu **melempar**
  (`gateway.ts:110-117`). Loop menangkapnya, menaikkan `readiness:"error"`, tidur 1 detik, lanjut.
  Update itu **tidak pernah dikirim ulang** (kebijakan at-most-once, ADR-0096 §4 — benar) dan
  operator **tidak pernah diberi tahu** (bukan bagian kebijakan mana pun — ini lubang).

ADR-0096 §5 sudah memutuskan bentuk yang benar: *"Progress yang dibuat gateway hanya fakta server:
received/dispatched, session lahir/pulih, fase, decision, finish, atau exit failure."* Keputusannya
ada; implementasinya tidak.

Akibat praktisnya: pesan pertama melahirkan proses `claude` baru di cwd kosong — puluhan detik
sebelum kalimat pertama muncul. Selama itu, dan selamanya bila sesi itu gagal membalas, chat
**diam** persis seperti keluhan.

## E · Cacat kecil yang ikut terlihat

**`readiness` tak pernah pulih dari `error`.** `loop()` menulis `readiness:"error"` pada kegagalan
poll (`gateway.ts:180`), lalu — bila `getUpdates` berikutnya berhasil — **tak ada** yang
mengembalikannya ke `"running"`. Hanya `processUpdate` yang sukses membersihkan `lastError`
(`gateway.ts:109`), dan itu tidak terjadi pada poll kosong. Satu kedip jaringan karena itu membuat
kartu Settings memperlihatkan `error` selamanya walau gateway sudah normal — pembacaan status yang
salah ke arah sebaliknya.

## Keputusan pasca-audit — Spec & Plan **skipped**

Akar masalahnya tunggal dan terbukti (§A/§B/§C), perbaikannya kecil, seluruhnya di dalam
`server/src/services/telegram/**` + satu route, **tanpa** perubahan skema, tanpa endpoint baru,
tanpa ADR baru. ADR-0096 dan ADR-0097 **ditegakkan**, tidak diamandemen: yang dikerjakan adalah
memasang apa yang keduanya sudah putuskan. Dokumen ini menjadi doc-of-record perbaikannya.

### Perbaikan

1. **Verifikasi AgentToken saat disimpan** (akar §A/§B). `PUT /telegram/settings` mengadu plaintext
   yang dikirim ke `verifyAgentToken()` + `TELEGRAM_REQUIRED_CAPABILITIES` dan menolak dengan pesan
   yang bisa ditindaklanjuti — token tak dikenal/dicabut, atau daftar capability yang kurang.
   Kredensial yang tak mungkin mengaktifkan gateway tidak boleh lagi tersimpan diam-diam.
2. **Test Connection ikut menguji gerbang inbound** (§ permukaan 2). Hasilnya membawa readiness
   inbound (token sah? capability lengkap? gateway polling?) sehingga hijau-nya tak bisa lagi
   berdampingan dengan inbound mati — persis yang diminta pelapor.
3. **Gateway bersuara sendiri** (§D). Saat sebuah update benar-benar tertangkap, chat selalu
   mendapat sesuatu: satu baris fakta server saat dispatch berhasil (digerbangi
   `Setting.telegram.progress`), dan satu baris `failure` saat dispatch gagal — **tak digerbangi**,
   karena kegagalan bukan "progress". `kind`-nya sengaja di luar `TELEGRAM_REPLY_KINDS`
   (`gateway-progress`/`gateway-failure`): `dedupeKey` outbox adalah `chat:update:kind`, jadi
   memakai `"progress"` akan membuat baris gateway **menelan** reply progress milik session
   operator untuk update yang sama. `TelegramChat.lastProgressKey` **tetap tak dipakai** —
   idempotensi sudah dijamin `dedupeKey`, dan memberi kolom mati pekerjaan yang mubazir hanya
   menambah jalan untuk salah.
4. **`readiness` pulih** (§E) begitu satu siklus poll berhasil.

### Yang **tidak** dikerjakan

- Tidak menyentuh kebijakan at-most-once (ADR-0096 §4): update `uncertain` tetap **tidak** dikirim
  ulang. Yang ditambahkan hanya pemberitahuannya.
- Tidak mengendurkan `TELEGRAM_REQUIRED_CAPABILITIES`. 23 capability itu memang cakupan kerja
  session operator; yang salah adalah operator tak pernah diberi tahu mana yang kurang **saat ia
  masih bisa memperbaikinya**. Gerbang baru sengaja memakai `includes` biasa — **persis** seperti
  `bootstrap.ts:140`, yang berarti `sessions:write` tidak menggantikan `sessions:read` meski
  `grantsCapability` mengizinkannya di gate route. Membuat gerbang simpan lebih longgar daripada
  gerbang bootstrap akan melahirkan ulang kelas bug yang sama: token yang lolos disimpan lalu
  tetap ditolak saat gateway lahir, diam-diam.

## Pembuktian akhir di server hidup (DB & `HANOMAN_HOME` khusus, port 8931)

Tangga readiness maju satu anak tangga tiap kali penghalangnya dibereskan — informasi yang selama
ini tak pernah sampai ke operator:

| Langkah | Hasil |
|---|---|
| simpan token 64-hex **persis nilai produksi** | **400** · "AgentToken tidak dikenal atau sudah dicabut — salin plaintext `hnm_agt_…` …" |
| simpan token sah, capability kurang | **400** · "AgentToken kurang 21 capability. Kurang: projects:read, … telegram:read." |
| simpan token sah + 23 capability | **200** |
| Test Connection, master switch mati | `inbound.reason` = "Akses agent mati — nyalakan master switch di Akses AI Agent." |
| Test Connection, master switch hidup | `inbound.reason` = "Kredensial sudah sah tapi gateway belum polling — nyalakan “Gateway aktif”." |
- Tidak membentuk reply dari `capturePane()` (ADR-0096 §5 tetap utuh).
