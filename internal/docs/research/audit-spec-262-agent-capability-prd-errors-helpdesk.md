# Audit SPEC-262 — AI agent capability: apakah sudah termasuk PRD, Errors, Help Desk?

**Sumber:** audit · **Prioritas:** tinggi · **Severity:** minor (UX/discoverability, bukan fungsi hilang)
**Audit-only** (ADR-0057): investigasi + dokumen, **tanpa perbaikan kode**. Rekomendasi ada di bawah.

## Keluhan / pertanyaan (laporan user)

> apakah ai agent capabiliy sudah termasuk **prd, errors dan help desk**? saat ini saya tidak
> menemukannnya di capability setting.

Ekspektasi implisit: di panel **Settings → Akses AI Agent → Capability** (SPEC-257/ADR-0065)
seharusnya ada entri yang mengizinkan agent mengakses PRD, monitoring Error, dan Help Desk (tiket).

## Investigasi (systematic-debugging — Phase 1 Root Cause)

### Jawaban singkat: ketiganya SUDAH tercakup — hanya namanya tak muncul di grid

Katalog capability (`shared/src/agent.ts:5`, `CAPABILITY_IDS`) memakai **9 domain × read/write**.
PRD/Errors/Help Desk tidak jadi domain tersendiri; mereka dilipat ke domain yang sudah ada:

| Fitur yang dicari user | Domain capability | Bukti route→cap (`server/src/services/agent-capabilities.ts`) |
|---|---|---|
| **PRD** | `docs` | `capabilityForRoute`: `top === "prds" → docs`; `projects/:id` sub `prds` → `docs` (baris 27, 34) |
| **Errors** (monitoring) | `support` | `top === "errors" → support` (baris 25) |
| **Help Desk** (triase tiket) | `support` | `top === "tickets" → support` (baris 25) |

Rute server yang bersangkutan memang ada dan terdaftar (`server/src/app.ts`):

- **PRD** — `server/src/routes/docs.ts`: `GET /prds`, `GET /projects/:id/prds`, `GET /projects/:id/prds/*`.
- **Errors** — `server/src/routes/errors.ts` (SPEC-249): `GET /errors`, `GET /errors/:id`,
  `POST /errors/:id/escalate`, `PATCH /errors/:id`.
- **Help Desk triase** — `server/src/routes/tickets.ts` (SPEC-253): `GET /tickets`,
  `POST /tickets/:id/accept`, `POST /tickets/:id/reject`.

Metadata katalog **memang** menyebut ketiganya secara eksplisit di `label`/`desc`
(`shared/src/agent.ts:26`):

- `docs:read` → *"Baca dokumen SoT project & **PRD**."*
- `support:read` → label **"Errors & Tiket — baca"**, desc *"Lihat error monitoring & tiket Help Center."*
- `support:write` → *"Eskalasi error, ubah status, terima/tolak tiket."*

### AKAR MASALAH: grid UI hanya menampilkan slug domain mentah, bukan label/desc

Panel capability di `src/src/screens/SettingsScreen.tsx:415-425` membangun baris grid dari
**slug domain** saja:

```tsx
const domains = Array.from(new Set(caps.map((c) => c.domain)));   // baris 369
// ...
{domains.map((d) => (
  <div>{d}{w?.risk ? " ⚠" : ""}</div>   // baris 420 — cuma slug: "docs", "support", ...
  // checkbox baca / tulis
))}
```

Jadi yang tampil ke user hanyalah baris polos: `projects, backlog, sessions, docs, ide, vps,
settings, support, notifications`. Field `label` dan `desc` (yang menyebut "PRD", "Errors & Tiket",
"Help Center") **tidak pernah dirender** — tak ada teks, tak ada tooltip. User yang mencari kata
"prd / errors / help desk" secara harfiah tak menemukannya, padahal capability-nya ada di balik
slug `docs` dan `support`.

**Kesimpulan:** ini **bukan** capability yang hilang, melainkan **gap discoverability/labeling di UI**.
Fungsi sudah lengkap dan tergerbang benar; hanya penamaan di grid yang menyembunyikannya.

### Catatan tambahan (bukan bug)

- **Help Center publik** (`server/src/routes/help.ts`, `/api/help/*`) sengaja **melewati gate**
  agent sepenuhnya (`server/src/app.ts:91` — `if (path.startsWith("/api/help")) return;`). Sisi ini
  customer-facing (submit tiket via kunci opaque), jadi memang **tak butuh** capability agent. Yang
  relevan untuk agent internal adalah sisi **triase** (`/api/tickets`) → sudah di `support`. Konsisten.

## Apakah issue terdefinisi baik?

**Ya.** Keluhan spesifik ("tak menemukan PRD/Errors/Help Desk di capability setting"), dapat
direproduksi (buka Settings → Akses AI Agent, grid hanya slug domain), akar masalah tunggal dan
jelas (`SettingsScreen.tsx:420` render slug, bukan `label`/`desc`), diff potensial kecil & terisolasi
di frontend. Tidak ada perubahan data model / kontrak API / scope yang dibutuhkan.

## Rekomendasi

**Perlu dinaikkan jadi Finding QA — perbaikan UX kecil (bukan sekadar jawaban).**

Pertanyaan "apakah sudah termasuk" bisa dijawab: **sudah** — PRD di `docs`, Errors & Help Desk (triase
tiket) di `support`. Tetapi keluhan intinya adalah *"tidak menemukannya"*, dan itu memang gap nyata:
metadata `label`/`desc` yang sudah ada di katalog tidak dipakai grid. Perbaikan berbiaya rendah dan
langsung menutup keluhan:

1. **Render label per baris** (mis. tampilkan `docs → "Docs & PRD"`, `support → "Errors & Tiket
   (Help Desk)"`) alih-alih slug mentah; sumbernya sudah tersedia di `CapabilityInfo.label/desc`.
2. **Tooltip/subteks** dari `desc` pada tiap baris agar cakupan tiap domain terbaca ("Baca dokumen
   SoT project & PRD", "Lihat error monitoring & tiket Help Center").
3. Opsional: badge risiko (`risk`) sudah ada indikator `⚠`; bisa disandingkan dengan `desc` untuk
   konteks.

Karena murni presentasi frontend (memakai metadata yang sudah ada), tak perlu ADR/migration baru.

## Berkas relevan (bukti)

- `shared/src/agent.ts:5,26` — `CAPABILITY_IDS` (9 domain) + `CAPABILITIES` metadata (label/desc menyebut PRD/Errors/Help Center).
- `server/src/services/agent-capabilities.ts:25,27,34` — peta route→cap: `errors`/`tickets`→`support`, `prds`→`docs`.
- `server/src/routes/{docs,errors,tickets,help}.ts` — rute PRD/Errors/Tiket/Help Center.
- `server/src/app.ts:91,117,132-134` — registrasi rute + bypass gate untuk `/api/help` publik.
- `src/src/screens/SettingsScreen.tsx:369,415-425` — grid capability yang hanya merender slug domain (**akar keluhan**).
