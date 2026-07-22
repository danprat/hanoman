# Audit SPEC-293 — Link ticket triase (buka/copy link backlog + link publik status; status turunan backlog)

> Sumber: qa, prioritas tinggi, severity major.
> - **actual:** "belum ada button untuk buka link ticket triase"
> - **expected:** "button buka link ticket triase di tab baru + copy link, serta status telah
>   selesai dikerjakannya (otomatis dari status backlog yang di-linkkan)".
> Keputusan manusia (2026-07-22): mau **dua** link — (1) redirect ke backlog tertaut, dan
> (2) link publik status tiket untuk dibagikan ke pelapor.

## Root cause (Phase 1 — systematic-debugging)

Di detail triase (`src/src/screens/TriageScreen.tsx` `TicketDetailView`), begitu tiket
tereskalasi, satu-satunya jejak backlog adalah **Badge statis** `→ {t.specId}` (baris 150).
Tak ada aksi apa pun:

1. **Tak ada link ke backlog.** SPA hanoman **tak punya routing URL sama sekali** — `section`
   murni React state (`App.tsx:390`), tak ada parsing `location`/hash saat mount. Jadi tak ada
   URL yang bisa dibuka di tab baru / disalin untuk menuju satu backlog item.
2. **Tak ada status turunan backlog di dashboard.** Server SUDAH mengembalikan objek `spec`
   penuh (termasuk `spec.stage`) di `GET /api/tickets/:id` (`tickets.ts:66-71`), tetapi UI tak
   memakainya — tak ada indikator "sudah selesai / sedang dikerjakan". (Halaman **publik**
   pelapor `/help/:slug/status/:key` sudah menurunkannya lewat `publicStatus()` di
   `services/ticket.ts:18` — jadi logikanya ada, hanya tak dipermukaan di dashboard.)
3. **Link publik status tak bisa direkonstruksi dari dashboard.** Kunci akses tiket disimpan
   **hash-at-rest** (`Ticket.accessKeyHash`, plaintext hanya sekali saat submit, cermin DSN).
   Dashboard tak menyimpan plaintext apa pun → tak ada cara membangun URL
   `/help/:slug/status/<key>` untuk dibagikan ke pelapor.

Jadi bukan bug logika — **tiga fitur memang belum ada**. Nomor 3 butuh token yang bisa
dibagikan → perubahan skema (kolom `Ticket.shareToken`) → migration + ADR. Karena luas
(routing SPA baru + skema + endpoint publik), audit memilih **Spec → Plan → Execute penuh**,
bukan jalur cepat.

## Keputusan perbaikan

### A. Deep-link backlog (routing SPA berbasis hash — additive)
- Link kanonik ke satu backlog: `${origin}${pathname}#spec=<SPEC-ID>`.
- `App.tsx` saat mount: parse `location.hash`; bila `#spec=<id>` → `setSection("backlog")` +
  buka `SpecDetail` untuk id itu (lewat prop baru `initialDetailId` di `BacklogScreen`), lalu
  bersihkan hash. Buka-di-tab-baru = `window.open(url)` (mount segar membaca hash).
- Detail triase (dan Errors, paritas) menampilkan tombol **Buka backlog** (tab baru) +
  **Salin link** di samping badge `→ SPEC-ID`.

### B. Status turunan backlog di dashboard (TriageScreen)
- Ekstrak `publicStatus(ticketStatus, specStage)` ke `shared/src/ticket-status.ts` (satu
  sumber kebenaran; server `ticket.ts`/`help.ts` mengimpornya, klien juga).
- Detail triase menampilkan badge status turunan dari `t.status` + `t.spec?.stage`
  ("Selesai" saat stage `done`, "Sedang dikerjakan" saat `executing`, dst.).

### C. Link publik status tiket yang bisa dibagikan (skema + ADR-0071)
- Kolom baru **`Ticket.shareToken String? @unique`** (opaque `hnm_shr_…`), di-generate saat
  `createTicket` untuk tiket baru; tiket lama di-backfill lazily saat `GET /tickets/:id`
  (idempoten, tanpa `notifySynced` → tak menambah noise feed sync).
- `GET /api/tickets/:id` mengembalikan `publicStatusUrl` (absolut, `/help/<slug>/status/<shareToken>`).
- Route publik `GET /api/help/:slug/tickets/:key` mencocokkan `accessKeyHash: hash(key)`
  **ATAU** `shareToken: key` (kunci asli pelapor tetap jalan; token bagikan juga jalan).
  Halaman `StatusView` yang ada langsung memakainya tanpa perubahan.
- Detail triase menampilkan tombol **Buka status publik** (tab baru) + **Salin link publik**.

## Verifikasi
- Test server: `getTicket` mengembalikan `publicStatusUrl` + men-generate `shareToken` bila
  kosong; route publik menerima `shareToken` dan menolak token asing; `createTicket` menaruh
  `shareToken`.
- Test shared: `publicStatus` (pindah modul) — pemetaan stage → label.
- Test frontend: detail triase merender tombol backlog + publik + badge status turunan; deep-link
  App membuka backlog + detail dari `#spec=`.
- Boot server lokal + curl endpoint yang tersentuh.
</content>
</invoke>
