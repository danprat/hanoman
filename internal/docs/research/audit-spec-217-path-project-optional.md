# Audit SPEC-217 — Path project optional (per-client, editable, tak disync)

Status: audit · SPEC-217 · sumber qa · prioritas tinggi · 2026-07-15
Metode: `superpowers:systematic-debugging` (root cause dulu, baru fix).

## Keluhan (verbatim)
> path project menjadi optional, dan bisa di masing-masing client, dan server bisa set juga
> tanpa harus sync untuk path project karena bisa jadi berbeda-beda path nya. harus bisa di
> edit juga untuk path project nya

Diurai jadi tiga tuntutan:
1. **Optional** — project boleh tanpa path.
2. **Per-client + server boleh set, tanpa sync** — tiap mesin punya path sendiri (beda-beda).
3. **Editable** — path bisa diubah setelah dibuat.

## Temuan inti (root cause)
SPEC-213 (ADR-0043..0046) sudah membangun **mekanisme** yang persis dituju SPEC-217:
- `Project.repoDir` **nullable** dan **sengaja dikecualikan dari sync** (`sync.ts` whitelist tak
  memuat `repoDir`; komentar `local-binding.ts:3` "TAK PERNAH disync").
- Model **`LocalBinding`** (`projectId → repoDir`, per-device, **tak pernah disync**), editable
  lewat `setBinding` (upsert).
- `resolveRepoDir(projectId)` = **binding lokal menang**, fallback `Project.repoDir`, **null-safe**
  (tak melempar) — `server/src/services/local-binding.ts:20`.
- API sudah ada: `GET/PUT /projects/:id/binding`, `POST /projects/:id/clone` (`routes/bindings.ts`).

**Tetapi delivery-nya setengah jalan.** Akar masalah SPEC-217 bukan "belum ada mekanisme",
melainkan **mekanisme per-client itu hanya tersambung di dua tempat dan tak punya UI**:

### Gap 1 — `resolveRepoDir` hanya dipakai spawn & IDE
Komentar `local-binding.ts:19` mengklaim sumber efektif "untuk **spawn/scan/ide**", tapi kenyataannya
hanya `terminal.ts` (spawn) dan `ide.ts` yang memakai `resolveRepoDir`. Sisanya membaca
`Project.repoDir` **langsung**, jadi binding per-client **tak berpengaruh** di:

| Jalur | File:line | Akibat bila hanya ada binding (repoDir null) |
|---|---|---|
| Coverage/docStatus dashboard | `services/project-view.ts:33` | scan path null → coverage 0 → status "broken" |
| Dropdown branch backlog | `routes/projects.ts:76` | `[]` (kosong), padahal repo ada di path binding |
| Buat spec (validasi branch, id) | `routes/specs.ts:73,80` | validasi & `nextSpecId` pakai null |
| Review backlog | `routes/specs.ts:215,226` | **409 "project belum punya repoDir"** |
| Integrate (rebase/merge) | `routes/specs.ts:173` | **409 "project belum punya repoDir"** |
| List/baca dokumen | `services/docs.ts:4-7` | kosong / gagal tulis |
| List PRD | `services/project-prds.ts:29-31` | `[]` |
| Dokumen per-spec | `services/spec-docs.ts:31-34` | `null` |
| Stage artifacts | `services/stage-artifacts.ts:26-27` | `[]` |

Konsekuensi nyata: user bind project ke checkout lokal → **sesi bisa jalan** (terminal/IDE pakai
`resolveRepoDir`), tapi dashboard tetap "broken", review/integrate **409**, docs/PRD kosong. Path
per-client tidak benar-benar berfungsi end-to-end.

### Gap 2 — Tak ada UI binding sama sekali
`PUT /projects/:id/binding` & `POST /projects/:id/clone` **tak pernah dipanggil frontend**
(`src/src` nol referensi `binding`/`clone`). Path hanya bisa dimasukkan **sekali, saat create**
(`NewProjectModal`, `App.tsx:231`). `EditProjectModal` (`App.tsx:248`) hanya punya `name`/`desc`.
`ProjectDetailScreen.tsx:62` menampilkan path **read-only** (`—` bila kosong). Jadi "path per-client
yang bisa diedit" **tak punya pintu di UI**.

### Gap 3 — Path tak bisa diedit lewat API project
`zUpdateProject` (`shared/src/dto.ts:29`) **tak memuat `repoDir`** → `PATCH /projects/:id` tak
pernah bisa mengubah `Project.repoDir` (Zod membuangnya). Client type `updateProject` juga hanya
`{name?,desc?}` (`client.ts:60`). Jadi `Project.repoDir` **create-only**.

### Gap 4 — Create form memaksa path (tuntutan "optional" bocor di UI)
`App.tsx:195-197`: untuk `kind === "existing"`, `canSubmit = !!f.dir.trim()` → **create diblok** bila
path kosong. Schema server `repoDir: z.string().optional()` (optional), tapi form memaksa. Jadi
"optional" hanya benar di API, tidak di UI.

## Bukti tak-ada-yang-500
Semua jalur baca `repoDir` null-safe di level service (scan/branches/git-ide/… balik `[]`/`null`);
jalur yang menolak melempar **4xx bersih** (400 `needsBind`, 409 "belum punya repoDir", 400 di
`writeDoc`/`writeRepoFile`). Jadi ini **bukan crash**, melainkan **fitur setengah jadi**: binding
per-client ada tapi diabaikan mayoritas jalur, dan tak ada UI untuk mengeditnya.

## Keputusan pasca-audit
Temuan **berconfidence tinggi** tapi perbaikannya **luas** (≈8 file server dijadikan binding-aware,
+ editability API, + permukaan UI baru, + test tiap jalur). Karena luas & menyentuh perilaku
user-facing, jalankan **Spec → Plan → Execute penuh** (bukan fast-path). Tak ada perubahan skema
(schema sudah `nullable` + `LocalBinding` ada) → **tanpa migration/ADR baru**. Desain sudah
ditetapkan ADR-0043 (path = per-mesin, tak disync); tak ada percabangan data-model/kontrak yang
butuh keputusan manusia.

## Arah perbaikan (dirinci di Spec/Plan)
1. **Konsistensi:** semua jalur baca repoDir → `resolveRepoDir` (binding menang). Hormati binding
   di coverage, branches, specs (buat/review/integrate), docs, PRD, spec-docs, stage-artifacts.
2. **Editable:** wire `PUT /projects/:id/binding` ke UI (edit path per-client, tak disync);
   tambah `repoDir` ke `zUpdateProject` agar `Project.repoDir` (path default/server) juga editable.
3. **Optional di UI:** create form tak lagi memblok path kosong untuk `existing`.
4. **Surface path efektif:** `ProjectView` memuat path efektif (resolved) + affordance edit di detail.

## Referensi
- [ADR-0043 — Sync server↔client, peran ditentukan konfigurasi](../adr/0043-sync-arsitektur-hub-client-server-to-server.md)
- Plan SPEC-213 `docs/superpowers/plans/2026-07-14-server-client-sync-spec-213.md` (Task 2.1–2.3)
