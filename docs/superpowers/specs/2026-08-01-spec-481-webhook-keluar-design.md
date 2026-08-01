# SPEC-481 — Webhook keluar untuk setiap perubahan, lengkap dengan dokumentasi in-app

**Tanggal:** 2026-08-01 · **Sumber:** brief · **Prioritas:** sedang · **ADR baru:** 0099

## Objective

hanoman mengirim webhook HTTP POST ke endpoint yang didaftarkan pengguna setiap kali terjadi
perubahan. Halaman Settings menyediakan pengelolaan endpoint (tambah/ubah/hapus URL, pilih jenis
peristiwa, aktif/nonaktif, secret penandatanganan, tombol Test, riwayat pengiriman berisi status,
kode HTTP, dan pesan galat). Payload berbentuk **amplop seragam ber-versi**: id peristiwa, jenis,
waktu, proyek, aktor, dan objek yang berubah beserta nilai **sebelum/sesudah**. Pengiriman gagal
diulang dengan backoff; endpoint yang terus gagal dinonaktifkan otomatis dengan notifikasi. Ada
**halaman dokumentasi di dalam aplikasi** — daftar jenis peristiwa + kapan terpicu, contoh payload
per jenis yang bisa disalin, cara memverifikasi tanda tangan berikut potongan kode, aturan retry &
pengiriman ganda, dan panduan membuat penerima pertama — ditautkan langsung dari Settings webhook.

## Masalah

Sistem lain tak punya cara mengetahui apa yang terjadi di hanoman selain memanggil `/api` berkala.
Akibatnya integrasi keluar (Telegram, Slack, CI, dashboard internal) harus dibangun **di dalam**
hanoman sendiri alih-alih berlangganan peristiwa. Bukti bentuknya sudah ada di repo: gateway
Telegram (ADR-0096) adalah satu subsistem penuh yang lahir karena tak ada kanal peristiwa keluar.

## Dua putusan yang mengunci bentuk kerja

### 1. Sumber peristiwa = **tap di layer Prisma**, bukan emit di call site

hanoman sudah **tiga kali** kena kelas bug "satu definisi, N call site" — SPEC-431 (`baseSha IS
NULL` disalin dua pemakai), SPEC-448 (`rootBypassEnv` hidup hanya di `pty.ts`), SPEC-475
(`recordHeadSha` punya satu penulis padahal `stage=done` dipersist tiga jalur). SPEC-475 mencatat
bahwa yang paling licin adalah divergensi pada **efek samping**, karena efek samping tak punya tipe
yang memaksanya konsisten. "Pancarkan peristiwa" adalah efek samping murni.

Maka pengambilannya dipasang di **satu** tempat yang tak bisa dilewati: sebuah Prisma client
extension (`$extends({ query: { $allModels: … } })`) di `server/src/db.ts` yang membungkus
`create`/`update`/`upsert`/`delete`/`updateMany`/`deleteMany` untuk model yang **dienumerasi
katalog**. Nol perubahan di call site; penulis baru mana pun otomatis terliput. `before`/`after`
didapat gratis.

**Digerbangi flag in-memory.** Saat tak ada endpoint aktif (default), tap langsung `return
query(args)` — biayanya satu pembacaan boolean, nol query tambahan. Flag di-refresh saat mutasi
endpoint dan saat boot (cermin cache `registerCustomAgentSource`, ADR-0094).

**Empat konsekuensi yang diterima sadar & wajib didokumentasikan:**

1. **Cascade delete tingkat-DB tak terlihat.** `onDelete: Cascade` dieksekusi SQLite, bukan Prisma —
   menghapus `Project` memancarkan `project.deleted` saja, bukan `spec.deleted` untuk tiap anaknya.
   Amplop `project.deleted` karena itu menyebut jumlah anak yang ikut terhapus di `data.cascade`.
2. **`$executeRaw` / `$queryRaw` lolos.** Tak ada penulis mentah untuk model terlacak hari ini;
   sebuah test menjaga itu tetap benar (grep-test atas `server/src`).
3. **`createMany` tak mengembalikan baris** di SQLite → tak memancarkan apa-apa. Tak dipakai untuk
   model terlacak hari ini; dijaga test yang sama.
4. **Tulisan yang tak mengubah apa pun tak melahirkan peristiwa.** Diff dihitung atas **allowlist
   field** (di luar `version`/`updatedAt`); diff kosong → diam. Ini yang membuat overlay stage-live
   (`liveSpecs`, menulis tiap `GET /specs`) dan bump `version` mesin sync tidak jadi banjir.

### 2. Katalog peristiwa mencakup **semua entitas yang punya baris DB**

Karena katalog yang menyetir tap **dan** halaman dokumentasi, memperluasnya adalah satu baris.
Batasan brief ("dokumentasi tidak boleh basi saat peristiwa baru ditambahkan") dipenuhi secara
struktural: tak ada jalan menambah peristiwa tanpa menambah entri katalog.

## Arsitektur

```
   tulisan Prisma apa pun
            │
            ▼
  services/webhooks/tap.ts ── gate: ada endpoint aktif? ──no──▶ passthrough
            │ yes
            ▼
  proyeksi allowlist (before/after) → diff
            │ diff kosong → diam
            ▼
  services/webhooks/emit.ts  ── amplop v1 + actor (AsyncLocalStorage) + clamp ukuran
            │
            ▼   fan-out ke endpoint yang cocok (jenis × project)
  WebhookDelivery (SQLite)  ◀── antrean DAN riwayat: satu tabel
            │
            ▼   setInterval in-process (server.ts), cap in-flight + rate limit
  services/webhooks/sender.ts ── SSRF check → HMAC → fetch(10 dtk) → status
            │
            ├── 2xx  → sent,  failureStreak = 0
            └── gagal → backoff (tabel), attempt++ ; habis → failed, failureStreak++
                                    │
                                    └── streak ≥ 5 → endpoint dinonaktifkan + Notification
```

Tidak ada message queue, Redis, atau worker terpisah — ADR-0024 tetap utuh. Antreannya tabel SQLite
durable + timer in-process, persis pola `SchedulerQueueItem` (ADR-0072) dan `TelegramOutbox`
(ADR-0096).

## Data model — dua model baru, LOCAL-only

Keduanya **tidak disync** (cermin `AgentToken`/`RuntimeConfig`): barisnya memegang secret dan
menunjuk pengiriman dari mesin ini. Wajib ikut `PG_ORDER` (`cli/src/commands/migrate-pg.ts`) —
test DMMF merah bila lupa. Migration ditulis tangan + `migrate deploy` (bukan `migrate dev`).

```prisma
model WebhookEndpoint {
  id             String    @id @default(cuid())
  name           String
  url            String
  secret         String              // ciphertext `enc:v1:` (services/secret-box.ts)
  events         Json                // string[]; ["*"] = semua. Wildcard "spec.*" didukung
  projectIds     Json?               // string[] | null = semua project
  enabled        Boolean   @default(true)
  allowPrivate   Boolean   @default(false)  // izin EKSPLISIT alamat internal/loopback
  apiVersion     Int       @default(1)      // versi amplop yang diminta penerima
  disabledAt     DateTime?
  disabledReason String?
  lastSuccessAt  DateTime?
  lastFailureAt  DateTime?
  failureStreak  Int       @default(0)
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
  deliveries     WebhookDelivery[]
}

model WebhookDelivery {
  id            String    @id @default(cuid())
  endpointId    String
  eventId       String              // SAMA untuk semua endpoint dari satu peristiwa
  eventType     String
  projectId     String?
  payload       Json                // amplop persis yang dikirim → retry = byte identik
  status        String    @default("pending")  // pending|sending|sent|failed|dropped
  attempt       Int       @default(0)
  maxAttempts   Int       @default(6)
  nextAttemptAt DateTime?
  httpStatus    Int?
  durationMs    Int?
  error         String?
  createdAt     DateTime  @default(now())
  sentAt        DateTime?
  endpoint      WebhookEndpoint @relation(fields: [endpointId], references: [id], onDelete: Cascade)

  @@index([status, nextAttemptAt])
  @@index([endpointId, createdAt])
}
```

**`payload` disimpan per pengiriman** — bukan pemborosan: retry harus mengirim **byte yang sama**
supaya `id` peristiwa stabil dan idempotensi penerima berlaku, dan riwayat harus memperlihatkan apa
yang benar-benar dikirim, bukan hasil render ulang dari keadaan hari ini.

Satu tabel merangkap **antrean dan riwayat**. Retensi: simpan `WEBHOOK_HISTORY_KEEP = 200`
pengiriman terakhir per endpoint, dipangkas worker.

## Amplop v1

```json
{
  "specVersion": "hanoman.webhook/1",
  "id": "evt_9f2c…",
  "type": "spec.stage_changed",
  "createdAt": "2026-08-01T09:41:22.108Z",
  "project": { "id": "hanoman", "name": "hanoman" },
  "actor":   { "kind": "user", "id": "usr_…", "label": "dena@nafanesia.id" },
  "data": {
    "entity": "spec",
    "id": "SPEC-481",
    "action": "updated",
    "changed": ["stage"],
    "before": { "stage": "planned", "…": "…" },
    "after":  { "stage": "executing", "…": "…" }
  },
  "truncated": false,
  "truncatedFields": []
}
```

- `actor.kind` = `user` | `agent` | `lead` | `scheduler` | `system`.
- `project` = `null` untuk peristiwa tanpa project (mis. notifikasi global).
- **Nomor percobaan TIDAK ada di body** — ia header. Body yang berubah tiap percobaan akan mematahkan
  janji "retry mengirim byte yang sama".
- `apiVersion` disimpan per endpoint sejak awal; hari ini hanya `1`. Penerima lama tak patah saat
  versi 2 lahir.

### Aktor

`services/webhooks/actor.ts` memegang `AsyncLocalStorage<Actor>`; hook `onRequest` di `app.ts`
memanggil `enterWith()` **sesudah** auth diselesaikan sehingga `req.user`/`req.agent` sudah ada.
Penulis latar (timer scheduler, denyut lead, tap dari boot) jatuh ke `{ kind: "system" }`;
`services/lead/apply.ts` membungkus eksekusinya dengan `withActor({ kind: "lead" })` — satu call
site, dan satu-satunya yang perlu.

## Katalog peristiwa — satu sumber untuk tap DAN dokumentasi

`shared/src/webhook.ts`:

```ts
export interface WebhookEntityDef {
  entity: string;              // "spec"
  model: string;               // "Spec" — nama model Prisma yang di-tap
  label: string;               // "Backlog item"
  fields: string[];            // ALLOWLIST field yang boleh keluar
  projectIdField: string | null;
  events: { created?: string; updated?: string; deleted?: string };
  /** peristiwa turunan: MENGGANTIKAN `updated` saat predikatnya benar */
  derived?: { type: string; when: string; changed: string[] }[];
  sample: Record<string, unknown>;   // contoh `data.after` untuk halaman docs
}
```

Allowlist field adalah **pagar data sensitif sekaligus kontrak payload**: yang tak disebut tak
pernah keluar. Sebuah test DMMF menuntut setiap nama field benar-benar ada di model Prisma-nya
(cermin test `PG_ORDER`), sehingga rename kolom tak bisa diam-diam mengosongkan payload.

**Katalog awal** (16 jenis peristiwa):

| entitas (model) | peristiwa | kapan terpicu |
| --- | --- | --- |
| `spec` (`Spec`) | `spec.created` · `spec.updated` · `spec.stage_changed` · `spec.deleted` | backlog difilekan, diubah, stage berpindah, dihapus |
| `project` (`Project`) | `project.created` · `project.updated` · `project.deleted` | project ditambah/diubah/dihapus |
| `session` (`SessionHistory`) | `session.started` · `session.ended` | sesi lahir (ADR-0079 `onBirth`); `endedAt` terisi (`exitCode ≠ 0` = gagal) |
| `ticket` (`Ticket`) | `ticket.created` · `ticket.updated` | tiket Help Center masuk / status triase berubah |
| `lead_decision` (`LeadDecision`) | `lead.decision` | satu baris jejak putusan hanoman-lead terbit |
| `notification` (`Notification`) | `notification.created` | notifikasi baru (done/fail/decision/lead/ticket/drift/webhook) |
| `github_issue` (`GithubIssue`) | `github_issue.pulled` · `github_issue.updated` | issue ditarik dari GitHub / status triase berubah |
| — | `webhook.ping` | operator menekan tombol **Test** |

**Aturan "satu perubahan = satu peristiwa".** Peristiwa turunan **menggantikan**, tidak menambah:
`spec.stage_changed` dikirim **alih-alih** `spec.updated` saat `changed` memuat `stage`. Entitas
`session` sengaja **tak punya** peristiwa `updated` sama sekali — hanya `created → session.started`
dan `endedAt` null→terisi `→ session.ended`; pembaruan `SessionHistory` lain (rekonsiliasi
transkrip) tak memancarkan apa pun. Berlangganan `spec.*` tetap menerima keduanya.

**Notifikasi bertipe `webhook` tak difan-out.** Nonaktif otomatis melahirkan `Notification`, dan
notifikasi itu sendiri adalah peristiwa `notification.created` — meneruskannya berarti kegagalan
satu endpoint mengirim lalu lintas ke endpoint lain, yang bila ikut gagal melahirkan notifikasi
lagi. Rantainya memang berhenti sendiri (endpoint yang sudah nonaktif dilewati), tapi kebisingannya
tak berguna. Aturannya satu baris di katalog: `notification` dengan `type === "webhook"` diabaikan.

## Pengiriman

**Header:**

```
Content-Type: application/json
User-Agent: hanoman-webhooks/1
X-Hanoman-Event: spec.stage_changed
X-Hanoman-Event-Id: evt_9f2c…
X-Hanoman-Delivery: dlv_71a…
X-Hanoman-Attempt: 1
X-Hanoman-Timestamp: 1785318082          (unix detik)
X-Hanoman-Signature: v1=<hex hmac-sha256>
```

**Tanda tangan:** `HMAC-SHA256(secret, "<timestamp>.<raw body>")`, hex. Penerima wajib membandingkan
dengan `timingSafeEqual` dan **menolak** timestamp yang selisihnya > 5 menit (anti-replay). Secret
per-endpoint, 32 byte acak, ditampilkan **sekali** saat dibuat/dirotasi (pola AgentToken), disimpan
terenkripsi `enc:v1:` lewat `services/secret-box.ts` (ADR-0097), **tak pernah** dikembalikan `GET`
(hanya `secretHint` = 4 karakter terakhir) dan **tak pernah** masuk log.

**Sukses** = HTTP 2xx. **`410 Gone` menonaktifkan endpoint seketika** (penerima menyatakan dirinya
mati; mengulanginya cuma membakar kuota).

**Backoff** — tabel eksplisit, bukan rumus, supaya bisa didokumentasikan apa adanya:

| percobaan | 1 | 2 | 3 | 4 | 5 | 6 |
| --- | --- | --- | --- | --- | --- | --- |
| jeda sebelumnya | 0 | 30 dtk | 2 mnt | 10 mnt | 30 mnt | 2 jam |

Jendela total ± 2 jam 43 menit. `maxAttempts = 6` habis → `failed` + `failureStreak++`.

**Nonaktif otomatis:** `failureStreak ≥ WEBHOOK_FAIL_LIMIT (5)` → `enabled=false`, `disabledAt`,
`disabledReason`, plus satu `Notification` bertipe `webhook` (dedup `key`
`webhook-disabled:<endpointId>:<disabledAt>`). Satu kali sukses mengembalikan streak ke 0.

**Batas laju & ukuran:**
- `maxPerMinute` per endpoint (default 60), token bucket in-memory di worker.
- `WEBHOOK_QUEUE_CAP = 1000` pengiriman `pending` per endpoint; kelebihannya lahir sebagai baris
  `dropped` ber-`error` "antrean penuh" — **terlihat di riwayat**, bukan hilang diam-diam.
- `WEBHOOK_MAX_BYTES = 64 KiB`. Amplop yang lebih besar dipangkas bertahap: (1) tiap field string
  dipotong ke 2 000 karakter + `…`, (2) bila masih besar `data.before` dibuang seluruhnya. Keduanya
  menyalakan `truncated: true` dan mengisi `truncatedFields`. **Tak pernah** mengirim utuh.

**Cegah SSRF:** URL divalidasi saat disimpan (hanya `http`/`https`, tanpa `user:pass@`, hostname
wajib ada) **dan** alamatnya diperiksa **setiap percobaan kirim** (`dns.lookup(all)` → tolak
loopback/private/link-local/ULA/multicast/unspecified) kecuali `allowPrivate` dinyalakan operator.
Pemeriksaan per-percobaan mempersempit DNS rebinding tapi tidak menutupnya sepenuhnya — jujur
dicatat di halaman dokumentasi.

**Kebijakan crash** (sengaja **berlawanan** dengan `TelegramOutbox`, ADR-0096): baris `sending` yang
tertinggal setelah crash dikembalikan ke `pending` saat boot dan **diulang**. Telegram memilih
`uncertain` karena pesan ganda ke manusia itu buruk; webhook adalah kontrak **at-least-once** yang
amplopnya membawa `id` stabil dan yang dokumentasinya mewajibkan penerima idempoten.

## API — `routes/webhooks.ts`, COOKIE_ONLY

`capabilityForRoute`: `if (top === "webhooks") return "COOKIE_ONLY";` — pengelolaan webhook memegang
secret dan menentukan ke mana data workspace mengalir; tak ada agent token yang boleh menyentuhnya
(preseden `/telegram/{settings,test,credentials}`, ADR-0097).

| method | path | keterangan |
| --- | --- | --- |
| `GET` | `/api/webhooks` | daftar endpoint (secret ter-mask) |
| `POST` | `/api/webhooks` | buat; balasan memuat `secret` **sekali** |
| `PATCH` | `/api/webhooks/:id` | ubah; `rotateSecret: true` → secret baru sekali |
| `DELETE` | `/api/webhooks/:id` | hapus (deliveries ikut cascade) |
| `POST` | `/api/webhooks/:id/test` | ping **sinkron** (10 dtk) → `{ok, httpStatus, durationMs, error}`; tetap mencatat baris riwayat |
| `GET` | `/api/webhooks/:id/deliveries?limit=` | riwayat pengiriman |
| `POST` | `/api/webhooks/deliveries/:id/retry` | antre ulang satu pengiriman |

Tombol Test sengaja **sinkron**: ia aksi operator yang menunggu jawaban, bukan peristiwa produk.
Klien sekali pakai ber-`AbortSignal` — bukan menumpang klien worker (jebakan "uji koneksi jadi
putuskan polling", ADR-0097).

Perubahan konfigurasi **berlaku tanpa restart**: setiap mutasi endpoint memanggil
`refreshWebhookCache()` yang menyegarkan gate tap + daftar penerima.

## Frontend

**Tab Settings baru `Webhook`** (`S_SECTIONS`, ikon `webhook`), dua layar di dalamnya:

1. **`WebhooksPanel`** — daftar endpoint (nama, URL, pil status: `aktif` / `nonaktif` /
   `dinonaktifkan otomatis`, waktu sukses terakhir), form tambah/ubah (URL, pemilih jenis peristiwa
   dari katalog dengan opsi **Semua**, filter project, switch `allowPrivate`, switch aktif, rotasi
   secret), tombol **Test**, dan tabel **riwayat pengiriman** (waktu · jenis · status · kode HTTP ·
   percobaan · galat) dengan tombol antre-ulang. Tautan besar **"Dokumentasi webhook"** di kepala
   panel.
2. **`WebhookDocs`** — halaman dokumentasi in-app, dirender dari katalog yang sama:
   ikhtisar · daftar jenis peristiwa + kapan terpicu · anatomi amplop & versi · contoh payload per
   jenis (tombol salin) · verifikasi tanda tangan (Node.js & Python, siap tempel) · aturan retry,
   backoff, dan pengiriman ganda · batas laju/ukuran & pemangkasan · keamanan (SSRF, secret) ·
   panduan langkah demi langkah membuat penerima pertama.

Halaman docs **tak punya teks jenis-peristiwa yang ditulis tangan**: judul, penjelasan "kapan
terpicu", dan contoh payload semuanya dibaca dari `WEBHOOK_ENTITIES`/`WEBHOOK_EVENTS`.

## Testing

| berkas | menjaga |
| --- | --- |
| `shared/src/webhook.test.ts` | konsistensi katalog, `matchesEvent` (wildcard), `buildEnvelope`, `clampEnvelope` |
| `server/test/webhook-catalog-dmmf.test.ts` | tiap `fields`/`model` katalog ada di DMMF Prisma; tiap model terlacak ada di `PG_ORDER` |
| `server/test/webhook-tap.test.ts` | create/update/delete/updateMany memancarkan; diff kosong diam; allowlist memproyeksi; gate mati → nol query tambahan; tak ada `$executeRaw`/`createMany` atas model terlacak |
| `server/test/webhook-sign.test.ts` | vektor tanda tangan tetap (regresi format) |
| `server/test/webhook-ssrf.test.ts` | rentang alamat terblokir & `allowPrivate` |
| `server/test/webhook-queue.test.ts` | tabel backoff, `dropped` saat cap, nonaktif otomatis + notifikasi, retensi, reset `sending` saat boot |
| `server/test/webhook-routes.test.ts` | CRUD, secret tak pernah kembali, cookie-only, Test |
| `src/test/webhooks-panel.test.tsx` · `webhook-docs.test.tsx` | panel & halaman docs merender dari katalog |

## Docs SoT yang tersentuh (commit yang sama)

- `internal/docs/adr/0099-webhook-keluar-peristiwa.md` **(baru)**
- `internal/docs/README.md` — baris ADR-0099 + entri seksi integrasi
- `internal/docs/adr/README.md` — narasi ADR-0099
- `internal/docs/architecture/api-contract.md` — tujuh endpoint `/webhooks`
- `internal/docs/architecture/data-model.md` — dua model baru, LOCAL-only
- `internal/docs/security/security-standard.md` — HMAC, anti-replay, SSRF, secret at-rest
- `internal/skills/hanoman/SKILL.md` — butir arsitektur + gotcha tap

## Non-goal (sadar)

- **Webhook masuk** (menerima dari luar). Ini kanal satu arah.
- **Transformasi payload / template per endpoint.** Amplop seragam adalah intinya.
- **Sync antar-node untuk endpoint webhook.** LOCAL-only; tiap instance mendaftarkan sendiri.
- **Menghidupkan lagi message queue.** ADR-0024 tetap utuh.
- **UI pembuat filter berbasis ekspresi.** Filter hanya jenis × project.
