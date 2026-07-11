# SPEC-186 · Edit Backlog — Design

**Sumber:** brief · prioritas tinggi
**Objective:** Backlog bisa di-edit jika masih dalam state backlog dan belum dimulai.

## Masalah

Setelah sebuah brief / QA finding difilekan, konten yang ditulis manusia — judul,
prioritas, dan detail brief/QA (payload) — menjadi immutable di UI. `SpecDetail`
(modal di `BacklogScreen.tsx`) menampilkan semuanya read-only kecuali `branchFrom`.
Typo atau objective yang perlu diperjelas tak bisa diperbaiki tanpa menghapus &
membuat ulang item (kehilangan ID). Kita ingin bisa meng-edit selama item masih di
backlog dan belum pernah dijalankan.

## Predikat "boleh di-edit"

Sebuah item boleh di-edit **iff** masih di state backlog awal **dan** belum ada sesi
yang pernah berjalan untuknya:

```
editable = spec.stage === "brainstorming" && spec.baseSha === null
```

- `baseSha` di-set **sinkron** saat worktree sesi pertama kali dibuat
  (`terminal.ts` — `addWorktree` → `prisma.spec.update({ baseSha })`) dan tak pernah
  dikosongkan. Jadi `baseSha === null` = penanda durable **"belum dimulai"**.
- `stage === "brainstorming"` = bagian **"state backlog"**. Secara praktik keduanya
  ekuivalen (tanpa sesi, stage tak pernah maju — hanya `advanceStage` yang majukan,
  dan itu butuh sesi yang men-set baseSha), tapi keduanya dicek eksplisit agar cocok
  dengan bunyi brief dan tahan terhadap revert stage (SPEC-167) yang bisa
  mengembalikan stage ke `brainstorming` **sesudah** sebuah sesi berjalan — di situ
  `baseSha` sudah non-null, jadi item itu tetap terkunci.

Sesudah dimulai, konten dibekukan: `objective`/`payload` sudah diumpankan ke prompt
agen (`terminal.ts` `startPrompt`) dan mungkin sudah masuk docs; meng-edit-nya
sesudah itu akan men-desync item dari kerja yang sudah jalan.

## Yang bisa di-edit

`title`, `priority`, dan `payload` sesuai `source`:

- **brief:** `context`, `outcome`, `constraints`, `priority`
- **qa:** `severity`, `steps`, `expected`, `actual`, `env`

`objective` **dihitung ulang** dari payload saat simpan — cermin persis derivasi di
`POST /specs` (brief: `outcome || context || fallback`; qa: `actual || steps ||
fallback`). Ia field turunan, bukan di-edit langsung. `priority` untuk qa juga
diturunkan dari `severity` seperti di POST.

**Tidak** bisa di-edit: `source`, `project`, `id`, `author` (identitas/provenans).
`branchFrom` dan `stage` mempertahankan jalur edit terpisah yang sudah ada
(branchFrom: SPEC-143; revert stage backward-only: SPEC-167) — tak disentuh.

## Perubahan

### Shared (`shared/src/dto.ts`, `entities.ts`)
- `zPatchSpec` += `title` (min 1, optional), `priority` (optional),
  `payload` (union brief|qa, optional).
- `zSpec` += `baseSha: z.string().nullable()` supaya klien bisa menghitung predikat
  editable. (Sudah ada di wire — Prisma mengembalikannya; ini hanya menge-type-kannya.)

### Server (`server/src/routes/specs.ts` — `PATCH /specs/:id`)
- Bila ada field konten (`title`/`priority`/`payload`): IF
  `spec.stage !== "brainstorming" || spec.baseSha !== null` → **409**
  `{ error: "backlog item sudah dimulai — tak bisa diedit" }`.
- Terapkan `title`/`priority`/`payload`; hitung ulang `objective` dari payload baru
  memakai helper yang sama dengan POST (di-extract agar tak ada dua salinan derivasi).
- Handling `branchFrom`/`stage` tak berubah (boleh berbagi PATCH yang sama, tapi UI
  mengirimnya terpisah).

### Frontend (`BacklogScreen.tsx`, `App.tsx`, `api/client.ts`)
- `SpecDetail`: bila `editable`, tampilkan tombol **"Edit"**. Masuk mode edit menukar
  DetailRow read-only (objective + field payload) jadi input yang bisa di-edit,
  me-reuse primitif `Field`/`Input`/`HnTextarea`/`Select`; tombol **Simpan**
  memanggil `onEditSpec(spec, patch)`. Item non-editable tetap read-only (tak berubah).
- `App.tsx`: `editSpec(spec, patch)` → `api.patchSpec(...)` → update state backlog +
  toast. 409 → toast warn (jika item keburu dimulai oleh sesi lain).
- `api.patchSpec` type += field konten.

## Test
- **Server** (`specs.route.test.ts`): PATCH edit title/priority/payload pada spec
  `brainstorming` + `baseSha=null` → 200, field ter-update, objective dihitung ulang.
  PATCH konten pada spec yang sudah dimulai (`baseSha` di-set atau stage maju) → 409.
  Test branchFrom/stage lama tetap hijau.
- **Frontend** (`backlog-board.test.tsx`): form edit muncul hanya saat belum dimulai;
  hilang begitu dimulai.

## Docs (Source of Truth) — commit yang sama
- `internal/docs/entrypoints/frd.md` (bagian Backlog): tambah klausa EARS "WHILE item
  masih di backlog & belum dimulai, THE SYSTEM SHALL mengizinkan edit judul/prioritas/
  detail; ELSE menolaknya".

## Non-goals
- Tak mengubah skema DB (`baseSha` sudah ada) → tak perlu migration/ADR.
- Tak meng-edit `source`/`project`/`id`, tak meng-edit item yang sudah dimulai.
