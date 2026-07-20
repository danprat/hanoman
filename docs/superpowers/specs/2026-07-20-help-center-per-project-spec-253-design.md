# Help Center per Project — Design (SPEC-253)

> Sumber: `docs/prd/help-center-per-project.md` (PRD, ADR-0041) + brainstorm SPEC-253.
> Pola acuan: **error monitoring SPEC-249 / ADR-0060** (endpoint publik ber-scope-project sebagai
> pengecualian sah gate `/api`, plus jembatan sekali-tindak ke `Spec`). Menutup jalur **manusia →
> backlog** (SPEC-249 menutup **mesin → backlog**).

## Objective (MVP terkunci)

Satu operator (`nafanesia`) dapat **mengaktifkan link publik keluhan per project**; pengguna akhir
non-teknis melapor lewat form (kategori + judul + detail + email + **screenshot**) tanpa login; tiap
keluhan masuk sebagai **tiket** ke **antrean triase** di dashboard; operator **menerima → `Spec`
prefilled** (masuk alur backlog existing) atau **menolak → tutup**; pelapor mengecek **status publik
terpetakan otomatis** lewat link berkode. Jalur end-to-end tipis-tapi-utuh:
**aktifkan → lapor (+lampiran) → tiket → notifikasi → terima/tolak → cek status.**

## Keputusan menyimpang dari default (dikonfirmasi operator)

1. **Lampiran gambar MASUK v1** — kapabilitas penyimpanan berkas baru (local FS sisi-server,
   `HANOMAN_UPLOAD_DIR`, di luar `repoDir`, tak disync), multipart upload, penyajian **ber-auth** ke
   triase. (PRD Open Q1/Q2.)
2. **Halaman publik = routing di SPA React** — bukan HTML server-rendered. hanoman SPA selama ini tanpa
   routing URL; ini rute publik pertama. `PublicHelpApp` di-mount saat `location.pathname` diawali
   `/help/` — tanpa login, tanpa Shell. Fallback SPA `index.html` sudah ada (prod `setNotFoundHandler`;
   dev Vite historyApiFallback) → **nol perubahan server untuk menyajikan halaman**.
3. **Email transaksional DITUNDA** — link status **ditampilkan di layar** setelah kirim (best-effort,
   PRD tak menggerbangi alur). Tanpa infra SMTP. (PRD Open Q3.)

## Data model (migration + ADR-0061)

Dua model baru + satu kolom `Project`. Mengikuti konvensi: enum sebagai **String + zod** di
`@hanoman/shared`, **hand-written migration** + `migrate deploy` per DB (pola SPEC-249). Model
**server-local** (tanpa `version`/sync, seperti `ErrorGroup`/`Notification`) — volume rendah, satu
workspace; tautan ke `Spec` (yang tersync) tetap satu-arah soft-link.

### `Ticket`
```prisma
model Ticket {
  id            String   @id @default(cuid())
  projectId     String
  number        Int                       // nomor pendek human-readable per project (Tiket #<n>)
  category      String                    // bug | fitur | pertanyaan | lainnya  (zTicketCategory)
  title         String
  detail        String
  reporterEmail String
  status        String   @default("new")  // new | accepted | rejected  (zTicketStatus)
  accessKeyHash String   @unique          // sha256(opaque key) — kunci cek status. Plaintext sekali.
  specId        String?                   // soft-link Spec hasil promosi (cermin ErrorGroup.specId)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @default(now())
  project       Project           @relation(fields: [projectId], references: [id], onDelete: Cascade)
  attachments   TicketAttachment[]

  @@unique([projectId, number])
  @@index([projectId, createdAt])
}
```

### `TicketAttachment`
```prisma
model TicketAttachment {
  id         String   @id @default(cuid())
  ticketId   String
  projectId  String                       // denormal — isolasi & query murah (pola ErrorEvent.projectId)
  filename   String                       // nama asli tersanitasi (display saja)
  mimeType   String                       // image/png | image/jpeg | image/webp
  size       Int
  storageKey String                       // nama berkas opaque di HANOMAN_UPLOAD_DIR (cuid+ext)
  createdAt  DateTime @default(now())
  ticket     Ticket   @relation(fields: [ticketId], references: [id], onDelete: Cascade)

  @@index([ticketId])
}
```

### `Project`
```prisma
helpEnabled Boolean @default(false)   // SPEC-253 · opt-in Help Center; additive. Diekspos di ProjectView.
tickets     Ticket[]                  // back-relation
```

- `number`: dihitung `max(number)+1` per project dgn **retry loop pada P2002** (cermin `nextSpecId`).
- `accessKeyHash`: kunci opaque `hnm_tkt_<48 hex>`; disimpan **hash-at-rest** (sha256), lookup status by
  hash, plaintext hanya di respons submit (sekali). (PRD Open Q4: nomor human-readable + kunci opaque
  terpisah.) Kunci **tak** kedaluwarsa/rotate di v1.

## Kapabilitas baru: penyimpanan berkas

- `HANOMAN_UPLOAD_DIR` (config, default `<server>/data/uploads` — server-local, **di luar `repoDir`**,
  **tak disync**; sejalan `Vps.keyPath` yang hidup sebagai berkas di server). Dibuat idempoten saat boot
  / saat write pertama.
- Berkas disimpan dgn nama opaque `storageKey = <cuid>.<ext>`; nama asli hanya metadata display.
- **Multipart** via `@fastify/multipart` (dependensi baru — pertama di repo). Batas: **≤3 berkas**,
  **≤5MB/berkas**, mime ∈ `image/png|jpeg|webp`. Berkas tak valid **di-skip** (submit sisanya tetap
  jadi), sesuai AC PRD. Batas via opsi multipart + validasi per-part.
- Penyajian **hanya ber-auth**: `GET /api/tickets/:id/attachments/:attId` (gate cookie). Halaman status
  publik **tidak** menampilkan lampiran balik (lebih aman & tipis).

## API

### Publik — pengecualian sah gate `/api` (bypass cookie, otorisasi non-cookie)
Bypass di `app.ts` `onRequest`: `if (path.startsWith("/api/help")) return;` (cermin `/api/ingest`).
Same-origin (hanoman menyajikan SPA + API) → **tanpa CORS/OPTIONS** (beda dari ingest lintas-situs).

```
GET  /api/help/:slug
#   Info halaman publik: { projectName, categories }. Otorisasi = helpEnabled.
#   404 generik bila project tak ada ATAU helpEnabled=false (tak membocorkan project).

POST /api/help/:slug/tickets            # multipart/form-data
#   Field: category, title, detail, email, hp (honeypot, hidden) + files[] (≤3 gambar).
#   Otorisasi = helpEnabled. Rate-limit per IP & per project (429). Honeypot terisi → 200 "sukses"
#   palsu tanpa membuat tiket. Field wajib kosong/kategori invalid → 400 (tak buat tiket).
#   201 { number, key, statusPath }  (key + link ditampilkan SEKALI di layar).
#   Berkas invalid di-skip; submit valid lainnya tetap jadi.

GET  /api/help/:slug/tickets/:key
#   Cek status publik by kunci opaque. Scoped ke slug (isolasi).
#   200 { number, category, title, status: <label publik>, createdAt }.
#   404 bila kunci tak dikenal / bukan milik slug (tanpa membocorkan keberadaan tiket/project lain).
```

### Triase (di belakang gate cookie)
```
GET  /projects/:id/help-center          # { enabled, publicUrl }  · 404 project
POST /projects/:id/help-center          # 200 { enabled:true, publicUrl }  aktifkan · 404
DELETE /projects/:id/help-center        # 204 nonaktifkan (tak hapus tiket) · 404

GET  /tickets?project=&status=&q=&page=&limit=
#   -> { items: TicketView[], total, page, pageSize }. Urut createdAt desc. Lintas & per project.
#   q atas title+reporterEmail. Paginasi response-layer (ADR-0038). Isolasi query ber-projectId.
GET  /tickets/:id       -> TicketDetail { ...ticket, detail, attachments:[{id,filename,mimeType,size}], spec? } · 404
GET  /tickets/:id/attachments/:attId    # stream berkas gambar (Content-Type mimeType) · 404 (att bukan milik tiket)
POST /tickets/:id/accept  { priority? } # 201 { spec } — promosi ke Spec. Idempoten: sudah promoted → 200 { alreadyPromoted:true, spec }. 404.
POST /tickets/:id/reject                # 200 { id, status:"rejected" } — tutup tanpa Spec · 404
```

`TicketView` = `{ id, projectId, number, category, title, reporterEmail, status, specId, attachmentCount, createdAt }`.
Badge "belum ditinjau" = jumlah `status==="new"` (dihitung klien dari items ATAU field `unreviewed`
pada envelope — pilih field envelope agar akurat lintas paginasi).

## Jembatan tiket → `Spec` (source baru `help`)

- **`zSpecSource` += `"help"`** (String+zod di `shared/src/enums.ts`; **bukan** enum Prisma → **tanpa
  migration**, cermin penambahan `audit` SPEC-237). `flowForSource("help") = "feature"` (pipeline penuh
  Brainstorm→Objective→Spec→Plan→Execute). Payload **brief-shaped** (`zBriefPayload`:
  context/outcome/constraints) — `POST /specs` superRefine memetakan `help` ke bentuk brief (seperti
  `brief`/`audit`).
- **Accept** (cermin `escalate` errors):
  - Guard: `ticket.specId` sudah ada → `200 { alreadyPromoted:true, spec }`.
  - `nextSpecId(repoDir)` + retry P2002 (TOCTOU).
  - Buat `Spec`: `source:"help"`, `stage:"brainstorming"`, `priority: body.priority ?? "sedang"`
    (operator memilih saat triase — PRD: prioritas keputusan tim), `author:"Help · <operatorEmail>"`,
    `title: ticket.title`, `objective`: ringkas kategori+judul+backlink,
    `payload = { context: <detail + "Kategori: X" + "Pelapor: email" + "Lampiran: n berkas (lihat tiket)" + backlink>, outcome:"", constraints:"" }`.
    `backlink = "Dari tiket Help Center #<number> (projek <slug>)"`.
  - Update tiket: `status:"accepted"`, `specId`. `enqueueOutbox("spec", spec.id)`.
  - Lampiran **tak** disalin ke Spec (biner) — developer melihatnya di tiket lewat backlink + triase.
- **Reject**: `status:"rejected"`, tanpa Spec, tanpa sentuh backlog.

## Status publik (diturunkan, tak disimpan ganda)

Fungsi murni `publicStatus(ticket, spec?)` (selaras ADR-0018/0019):
| keadaan | label publik |
|---|---|
| `status==="new"` | **Sedang ditinjau** |
| `status==="rejected"` | **Ditutup** |
| `status==="accepted"` + Spec `stage ∈ {brainstorming,objective,spec-ready,planned}` | **Diterima** |
| `status==="accepted"` + Spec `stage==="executing"` | **Sedang dikerjakan** |
| `status==="accepted"` + Spec `stage==="done"` | **Selesai** |

Tanpa istilah/stage internal, tanpa data project/backlog lain. Spec.stage dibaca dari DB (write-through
saat sesi tutup — cukup untuk v1; overlay live `GET /specs` tak dipakai di jalur publik).

## Notifikasi (reuse model `Notification`)

- Tiket **baru** → `Notification { type:"ticket", key:"ticket:<ticketId>", projectId, title:'Keluhan
  baru di "<projectName>": <category>: <title>' }`. `type` String longgar → **tanpa migration**; dedup
  `key` unik; tersiar lewat grup `notifications` WS existing (ADR-0039). **Setiap** tiket baru
  memberi notif (beda dari error yang hanya grup produksi baru) — volume manusiawi, dijaga rate-limit.
- Klien: `NotificationBell` + `toastFor` cabang `type==="ticket"` (icon `inbox`/`life-buoy`, label
  "keluhan baru", aksi "Lihat triase", target `{section:"triage", projectFilter}`).

## Ketahanan (tanpa infra baru)

- **Rate-limit** token-bucket **in-memory** (cermin `error-ingest.ts`): **per IP** (default 5/min,
  `HANOMAN_HELP_RATE_PER_MIN_IP`) **dan per project** (default 20/min, `HANOMAN_HELP_RATE_PER_MIN_PROJECT`)
  → 429. Single-process, patuh "tanpa queue/Redis".
- **Honeypot** field `hp` (hidden, harus kosong) → terisi = bot → 200 "sukses" palsu, tak buat tiket.
- **Caps**: `title ≤ 200`, `detail ≤ 10_000`, `email ≤ 200`; multipart limits (≤3 berkas, ≤5MB, mime
  gambar). PII disimpan apa adanya (scrub pasca-MVP; form beri catatan singkat "jangan kirim data
  sensitif").
- **Retensi opportunistic-on-write** (cermin retensi error): saat submit, pangkas tiket
  `status==="rejected"` lebih tua dari retensi (default 90 hari, `HANOMAN_TICKET_RETENTION_DAYS`) +
  hapus berkas lampirannya dari disk. Tiket ber-`specId` **dikecualikan**. Tanpa scheduler global baru.

## Frontend

### Routing SPA (rute publik pertama)
- `src/src/main.tsx`: cek `location.pathname`. Diawali `/help/` → render `<PublicHelpApp/>` (tanpa
  `AuthProvider`/Shell/login). Selainnya → `<App/>` seperti biasa. Ringan, tanpa dep router (parse path
  manual — satu-dua rute).
- Rute publik:
  - `/help/:slug` → landing: nama project + **form keluhan** (Select kategori, judul, detail, email,
    input file ≤3 gambar + preview, field honeypot tersembunyi) + tombol/tautan **Cek status**.
    Submit (multipart) → tampilkan konfirmasi: **nomor tiket** + **link status berkode** (tombol Salin).
  - `/help/:slug/status/:key` → halaman status: label publik + nomor + kategori + judul + waktu.
  - Form "cek status" di landing menerima link/kode → redirect ke rute status.
- Layout publik minimal memakai token DS (bone paper, brass) — reuse primitives DS yang **tak** butuh
  context auth (`Card`, `Button`, `Select`, `StateBlock`, `MarkdownView` tak dipakai). Klien API publik
  `src/src/api/help.ts` (same-origin fetch, tanpa cookie khusus).

### Triase (section dashboard baru)
- Nav `HN_NAV` += `{ key:"triage", label:"Triase", icon:"inbox" }` (`ds/shell.tsx`); cabang
  `section==="triage"` di `App.tsx` (pola screen mandiri VPS/Errors).
- `screens/TriageScreen.tsx`: **self-fetch + silent poll 5s** (pola `ErrorsScreen`/`GitGraph`,
  `!document.hidden`). Master→detail: daftar tiket (Badge status + kategori, judul, email, waktu
  relatif, badge "belum ditinjau") + filter project/status/search. Detail: isi penuh + **lampiran**
  (thumbnail via `GET /tickets/:id/attachments/:attId`, ber-auth) + email + tombol **Terima**
  (memilih prioritas) & **Tolak** + tautan `→ SPEC-N` bila sudah promoted.
- **Terima** → `api.acceptTicket(id, priority)` → `onAccepted(spec)` → `setProjectFilter(spec.projectId)`
  + `setSection("backlog")` + toast. **Tolak** → `window.confirm` → `api.rejectTicket(id)`.

### Kartu Help Center di ProjectDetail
- `HelpCenterCard` (cermin `DsnCard`): toggle Aktifkan/Nonaktifkan; saat aktif tampil **link publik**
  (`<base>/help/<slug>`) + tombol **Salin**. `api.getHelpCenter/enableHelpCenter/disableHelpCenter`.

## Keamanan

- `/api/help/*` = pengecualian sah gate (bypass cookie), otorisasi **helpEnabled** (submit/info) +
  **kunci opaque** (status). Error generik 404 (tak enumerasi project/tiket).
- `accessKeyHash` hash-at-rest; plaintext sekali. Isolasi antar-project: query tiket/lampiran **selalu**
  ber-`projectId`; kunci status diverifikasi milik slug. `accessKeyHash` tak pernah ke client/log.
- Lampiran disajikan **hanya ber-auth**; nama berkas opaque di disk; path traversal dijaga (storageKey
  dari cuid, bukan input user). Upload dir di luar repoDir & tak disync.
- Honeypot + rate-limit + caps = proteksi minimal (v1). Tanpa CAPTCHA/verifikasi email (Non-goal).

## Docs SoT yang disentuh (commit yang sama)

- **BARU** `internal/docs/adr/0061-help-center-tiket-publik-triase.md` — model baru + kolom Project
  (migration); `/api/help/*` pengecualian gate (helpEnabled + kunci opaque); kapabilitas file storage
  (upload dir server-local + multipart + serving ber-auth); jembatan `Spec` source `help`; SPA routing
  publik; status publik derived; notifikasi/rate-limit/honeypot/retensi. Link di `README.md`.
- `architecture/data-model.md` — Ticket, TicketAttachment, Project.helpEnabled.
- `architecture/api-contract.md` — `/api/help/*`, `/tickets*`, `/projects/:id/help-center`, serving lampiran.
- `security/security-standard.md` — pengecualian Help Center + lampiran + rate-limit + honeypot.
- `frontend/frontend-implementation.md` — SPA routing publik + TriageScreen + HelpCenterCard + notif ticket.
- `README.md` index — link ADR-0061 (dan pastikan doc lain tetap ter-link).

## Strategi test (TDD)

- **shared/pure**: `zTicketCategory`/`zTicketStatus`, `publicStatus(ticket,spec)` (semua cabang),
  `zSpecSource` menerima `help` + `flowForSource("help")`, DTO ticket.
- **server**: submit (valid → tiket+number+key; wajib kosong → 400; honeypot → no-tiket; disabled → 404;
  rate-limit → 429; multipart file valid/invalid skip), status (valid/invalid/salah-slug), help-center
  enable/disable + publicUrl, accept (buat Spec source help + idempoten + tautan dua arah + priority),
  reject, list/detail/isolasi projectId, attachment serving ber-auth + 404 salah-tiket, notifikasi tiket
  baru (dedup key), retensi opportunistic (rejected lama dipangkas, ber-specId dikecualikan).
  DB test: `migrate deploy` sendiri (pola SPEC-249).
- **frontend**: routing `/help/*` → PublicHelpApp; TriageScreen master/detail + accept/reject; notif
  bell/toast cabang ticket; HelpCenterCard toggle+copy.
- **Live smoke**: boot server + curl jalur publik end-to-end (enable → submit multipart → status →
  triase list → accept → status "Diterima").

## Rencana PR (feed writing-plans)

1. **Skema & migration** — Ticket + TicketAttachment + Project.helpEnabled; hand-written migration;
   `zTicketCategory`/`zTicketStatus`/DTO; `zSpecSource += help` + `flowForSource`. Prisma generate.
2. **Kapabilitas file storage** — `services/uploads.ts` (upload dir, write/read/delete, sanitasi) +
   `@fastify/multipart` + config `HANOMAN_UPLOAD_DIR`.
3. **Endpoint publik** — `routes/help.ts` (`GET info`, `POST submit multipart`, `GET status`) +
   `services/ticket.ts` (create, number, key, publicStatus) + rate-limit/honeypot/caps + gate bypass.
4. **Manajemen Help Center** — `GET/POST/DELETE /projects/:id/help-center` + `helpEnabled` di ProjectView.
5. **Triase API** — `routes/tickets.ts` (list/detail/attachment-serve/accept/reject) + notifikasi tiket
   baru + retensi opportunistic.
6. **Frontend publik** — SPA routing + `PublicHelpApp` (form + konfirmasi + status) + `api/help.ts`.
7. **Frontend triase + kartu + notif** — TriageScreen + HelpCenterCard + NotificationBell/toast ticket
   + nav + App wiring + client methods.
8. **Docs SoT + ADR-0061** — semua doc di atas, ter-link di index (boleh menyebar di tiap PR yang
   menyentuh; PR terakhir memastikan lengkap).

## Out of scope / ditunda (Non-goals PRD)

Knowledge base/FAQ, live chat/dua-arah, akun pelanggan, SLA/eskalasi otomatis, CAPTCHA/verifikasi
email, dedup/merge otomatis, multi-workspace/RBAC, analitik lanjutan, **email transaksional**
(v1: link di layar), branding lanjutan, alasan penolakan ke pelapor, reopen tiket "Selesai" (selalu
tiket baru). Lampiran **tidak** ditampilkan balik ke pelapor (hanya ke triase).
