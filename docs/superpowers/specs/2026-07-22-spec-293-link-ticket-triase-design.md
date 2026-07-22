# SPEC-293 — Link ticket triase · Design

**Doc-of-record tambahan:** `internal/docs/research/audit-spec-293-link-ticket-triase.md`,
`internal/docs/adr/0071-link-ticket-triase-deeplink-sharetoken.md`.

## Ringkasan
Detail triase menampilkan tautan backlog sebagai badge statis `→ SPEC-ID` tanpa aksi & tanpa
status penyelesaian. Tambah: (A) deep-link buka/salin backlog, (B) badge status turunan backlog,
(C) link publik status tiket yang bisa dibagikan ke pelapor.

## Kontrak yang berubah

### Skema (migration additif)
```prisma
model Ticket {
  ...
  shareToken String? @unique // SPEC-293 · token opaque bagikan link status publik (hnm_shr_…)
}
```

### shared
- Modul baru `shared/src/ticket-status.ts`: `export function publicStatus(ticketStatus: string, specStage?: string | null): string`.
- `zTicketDetail` diperluas: `spec: zSpec.nullable()`, `publicStatusUrl: z.string()`.
- (opsional helper) `specDeepLink(id)` diletakkan inline di klien (butuh `window`), tak di shared.

### server
- `services/ticket.ts`: `createTicket` menaruh `shareToken` (generate opaque). `publicStatus`
  di-re-export dari shared (hapus definisi lokal). Helper `generateShareToken()`.
- `routes/tickets.ts` `GET /tickets/:id`: bila `shareToken` kosong → generate+persist (lazy,
  tanpa notifySynced). Response menambah `publicStatusUrl = ${base}/help/${projectId}/status/${shareToken}`.
- `routes/help.ts` `GET /help/:slug/tickets/:key`: lookup `accessKeyHash: hash(key)` OR
  `shareToken: key`, scoped `projectId === slug`.

### frontend
- `App.tsx`: mount effect parse `location.hash` `#spec=<id>` → `setSection("backlog")` +
  `setOpenSpecId(id)` + `history.replaceState` bersihkan hash. Prop `initialDetailId` diteruskan
  ke `BacklogScreen`.
- `BacklogScreen.tsx`: prop `initialDetailId?: string | null` → seed `detailId` sekali.
- `TriageScreen.tsx` (`TicketDetailView`): badge status turunan (`publicStatus(t.status, t.spec?.stage)`);
  saat `specId` → tombol **Buka backlog** (`window.open(specDeepLink(specId))`) + **Salin link**;
  selalu (tiket punya `publicStatusUrl`) → tombol **Buka status publik** + **Salin link publik**.
- `ErrorsScreen.tsx` (`GroupDetail`): paritas tombol **Buka backlog** + **Salin link** (tanpa
  badge status — error detail tak mengembalikan stage spec).

## Non-goals
- Router SPA umum (hanya hook `#spec=` sekali-mount).
- Badge status turunan di Errors (butuh stage spec di getError — di luar scope).
- Regenerasi/revoke `shareToken` (satu token per tiket, cukup).

## Verifikasi
Test shared (publicStatus), server (getTicket publicStatusUrl + shareToken lazy, help route
terima shareToken), frontend (tombol + badge triase, deep-link App). Boot + curl.
</content>
