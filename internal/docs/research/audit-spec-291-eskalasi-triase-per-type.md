# Audit SPEC-291 — Miss eskalasi triase → backlog: semua type jadi "feature"

Status: fixed (doc-of-record perbaikan; Spec & Plan skipped, jalur cepat qa — akar jelas, diff kecil, tanpa perubahan skema/kontrak).

## Keluhan

Saat menerima tiket dari triase Help Center ke backlog, **semua kategori** mendarat sebagai
backlog **feature** (feature brief), tak peduli tipe keluhannya. Harapan pelapor:

- **fitur** → **feature brief** (source `brief`, flow `feature`)
- **bug** → **finding QA** (source `qa`, flow `qa` — audit→perbaikan)
- **pertanyaan** → **audit** (source `audit`, flow `audit` — dokumen saja)

## Investigasi (systematic-debugging)

### Data flow eskalasi

Dua jembatan triase→backlog:

1. **Errors** (`server/src/routes/errors.ts` `POST /errors/:id/escalate`) — grup error **selal** bug,
   sudah benar: `source: "qa"` + payload qa-shaped. **Tidak terdampak.**
2. **Tiket Help Center** (`server/src/routes/tickets.ts` `POST /tickets/:id/accept`) — **akar bug.**

### Akar masalah (tickets.ts)

`accept` membuat Spec dengan `source` **hardcode**:

```ts
source: "help", ...
```

tanpa pernah melihat `t.category` (`bug` | `fitur` | `pertanyaan` | `lainnya`, lihat
`shared/src/enums.ts` `zTicketCategory`). Akibatnya di dua lapis hilir:

- `shared/src/dto.ts` `flowForSource("help")` → `"feature"` (hanya `qa`/`audit` yang bercabang;
  sisanya jatuh ke `feature`). Jadi sesi selalu jalan pipeline **feature**.
- `src/src/screens/BacklogScreen.tsx` `SOURCE_META` tak punya entri `help` → fallback ke
  `brief` = label **"feature brief"**.

Dua-duanya menuju "feature brief" untuk **setiap** kategori. Itu persis keluhannya.

### Kenapa `help` ada

`source: "help"` ditambah SPEC-253 (ADR-0062) sebagai penanda provenance "dari Help Center".
Tapi provenance sudah dibawa terpisah lewat backlink di `objective`/payload
(`Dari tiket Help Center #N`), dan `help` tak punya tampilan tersendiri (mengekor `brief`).
Jadi `help` bisa dipensiunkan untuk tiket baru tanpa kehilangan informasi — enum tetap
menyimpannya demi Spec lama.

## Perbaikan

`tickets.ts` `accept`: petakan `category → source` lalu bangun payload sesuai bentuk source
(qa-shaped untuk bug, brief-shaped selebihnya). Konten keluhan + backlink + direktif lampiran
(SPEC-286) tetap utuh — untuk source `qa` masuk ke field `actual`, untuk `brief`/`audit` ke
`context`.

| Kategori tiket | source Spec | flow (`flowForSource`) | Backlog UI (`SOURCE_META`) |
| --- | --- | --- | --- |
| `bug` | `qa` | `qa` (audit→fix) | QA finding |
| `fitur` | `brief` | `feature` | feature brief |
| `pertanyaan` | `audit` | `audit` (dokumen) | Audit |
| `lainnya` | `brief` | `feature` | feature brief (default) |

Tanpa migration (enum `zSpecSource` sudah memuat `brief`/`qa`/`audit`), tanpa perubahan
kontrak API (endpoint & response sama; hanya nilai `source`/bentuk `payload` yang mengikuti
kategori). Direktif lampiran SPEC-286 diselamatkan lewat helper `detailText` shape-agnostik
di test.

## Verifikasi

- Unit: `server/test/tickets.test.ts` — bug→qa, fitur→brief, pertanyaan→audit, lainnya→brief;
  SPEC-286 attachment directive shape-agnostik.
- Live smoke: boot server, `POST /api/tickets/:id/accept` per kategori, cek `spec.source`.
