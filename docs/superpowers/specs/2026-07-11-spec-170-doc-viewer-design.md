# SPEC-170 — Design: lihat dokumen audit/spec/plan per backlog item

**Fase:** Spec · 2026-07-11
**Hulu:** [objective](../../../internal/docs/operations/spec-170-doc-viewer-objective.md) ·
brainstorm (disetujui inline)
**Status:** design — belum ada perubahan kode.

Objective mengunci *apa*. Dokumen ini mengunci *di baris mana*. Prinsip: nol dependency baru,
nol perubahan skema, reuse penuh primitif yang sudah ada.

## Konsep tunggal: "dokumen sebuah backlog item"

Semua `*.md` di repo/worktree yang namanya memuat segmen `spec-N` (boundary-safe:
`spec-17` bukan `spec-170`), dikelompokkan per **jenis**. Kaitan file→item sudah tersedia lewat
konvensi nama; tak ada kolom DB baru.

Sumber direktori dipilih **freshest-wins**, agar review bisa terjadi sebelum merge:

```
resolveDir(specId) =
  cwd sesi tmux HIDUP yang specId-nya cocok   (worktree run: dokumen in-progress)
  ELSE repoDir project si spec                (repo utama: dokumen ter-merge)
```

Preseden ada: `routes/specs.ts:23` sudah memanggil `sessionPhasesBySpec()` untuk menurunkan
stage live dari sesi hidup (SPEC-168). Kita pakai `listSessions()` (`pty.ts:96-97`) yang sudah
mengembalikan `{ specId, cwd, exited }` per pane.

## Server

### Service baru: `server/src/services/spec-docs.ts`

Reuse `listRepoDocs(dir)` (`scan.ts:16`, sudah menerima `dir` sembarang) dan regex boundary
spec-id yang sama dengan `stage-artifacts.ts:29`. Klasifikasi jenis **berbasis suffix + dir**,
karena "spec" hidup di dua tempat (`operations/*-spec.md` dan `superpowers/specs/*-design.md`):

```ts
import { prisma } from "../db";
import { listRepoDocs } from "./scan";
import { listSessions } from "./pty";

export type DocKind = "audit" | "spec" | "plan" | "objective" | "brainstorm" | "other";
export type SpecDoc = { kind: DocKind; path: string; name: string };

// Urutan tampil: pimpin dengan tiga yang disebut backlog item, lalu pendukung.
const ORDER: DocKind[] = ["audit", "spec", "plan", "objective", "brainstorm", "other"];

export function kindOf(path: string): DocKind {
  const p = path.toLowerCase();
  if (p.endsWith("-audit.md")) return "audit";
  if (p.endsWith("-objective.md")) return "objective";
  if (p.endsWith("-brainstorm.md")) return "brainstorm";
  if (p.endsWith("-design.md") || p.endsWith("-spec.md") || p.startsWith("docs/superpowers/specs/")) return "spec";
  if (p.startsWith("docs/superpowers/plans/") || p.endsWith("-plan.md")) return "plan";
  return "other";
}

// cwd sesi HIDUP untuk spec ini kalau ada; kalau tidak, repoDir project.
export async function resolveDir(specId: string): Promise<string | null> {
  const live = listSessions().find((s) => s.specId === specId && !s.exited && s.cwd);
  if (live) return live.cwd;
  const spec = await prisma.spec.findUnique({
    where: { id: specId }, select: { project: { select: { repoDir: true } } },
  });
  return spec?.project.repoDir ?? null;
}

export async function listSpecDocs(specId: string): Promise<SpecDoc[]> {
  const dir = await resolveDir(specId);
  if (!dir) return [];
  const id = specId.toLowerCase();
  const re = new RegExp(`(^|[^a-z0-9])${id}([^0-9]|$)`);
  const docs = (await listRepoDocs(dir))
    .filter((f) => re.test(f.toLowerCase()))
    .map((f) => ({ kind: kindOf(f), path: f, name: f.slice(f.lastIndexOf("/") + 1) }));
  return docs.sort((a, b) =>
    ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.path.localeCompare(b.path));
}
```

Catatan: `listRepoDocs` sudah hanya mengembalikan `*.md`, sudah menghormati `.gitignore`
(skip `.worktrees`/`node_modules`/`dist`), dan mengembalikan berkas *tracked + untracked* —
jadi dokumen yang baru ditulis agent di worktree, belum di-commit, ikut terdaftar.

### Endpoint di `server/src/routes/specs.ts`

Isi berkas dibaca ulang lewat `resolveDir` yang sama, jadi konsisten dengan daftarnya, dan
`readDocFile` (`scan.ts:84`) meneruskan `docAbsPath` — guard `.md` + tak keluar dir sudah ada.

```ts
import { listSpecDocs, resolveDir } from "../services/spec-docs";
import { readDocFile } from "../services/scan";

app.get("/specs/:id/docs", async (req) =>
  ({ files: await listSpecDocs((req.params as { id: string }).id) }));

app.get("/specs/:id/docs/*", async (req, reply) => {
  const { id } = req.params as { id: string };
  const path = (req.params as Record<string, string>)["*"] ?? "";
  const dir = await resolveDir(id);
  const content = dir ? readDocFile(dir, path) : null;
  return content === null ? reply.code(404).send({ error: "not found" }) : { path, content };
});
```

Race jinak: sesi bisa mati antara daftar dan baca-isi → `resolveDir` jatuh ke repoDir; berkas
yang belum di-merge 404, klien menampilkan state error per-file. Tak perlu dijaga (ponytail).

## Shared

`shared/src/api.ts` — dua path + tipe:

```ts
specDocs: (id: string) => `${API}/specs/${id}/docs`,
specDocFile: (id: string, path: string) => `${API}/specs/${id}/docs/${path}`,
```

Tipe `SpecDoc`/`DocKind` boleh diekspor dari shared agar client & server sepakat, atau cukup
di client. Karena hanya client yang mengonsumsi bentuknya, tipe tinggal di client — server
mengembalikan objek biasa. (Reuse pola `TerminalSession` yang tipenya hidup di client.)

## Frontend

### Angkat `MarkdownView` jadi primitif bersama

`hnRender`/`hnLang`/`hnDocHtml`/`MarkdownView` (`DocsWorkspace.tsx:11-22,108-110`) dipindah ke
**`src/src/ds/markdown.tsx`**, diekspor lewat barrel `ds/index.ts`. `DocsWorkspace` meng-import
`MarkdownView` dari `../ds` (hapus definisi lokalnya). Kelas CSS `.hn-md` (`app.css:13`) tetap.
Satu berkas baru, duplikasi hilang, dua konsumen berbagi.

### Komponen baru: `src/src/screens/SpecDocsModal.tsx`

```tsx
export function SpecDocsModal({ specId, onClose }: { specId: string; onClose: () => void }) {
  // GET /specs/:id/docs → daftar; pilih pertama; GET /specs/:id/docs/* → isi (cache per path).
  // reuse <Modal> (ds/kit.tsx:42, width ~880), <MarkdownView>, <StateBlock> (loading/empty/error).
  // Kiri: daftar berkas dikelompokkan per kind (label: Audit/Spec/Plan/Objective/Brainstorm).
  // Kanan: MarkdownView isi berkas terpilih. maxHeight Modal (88vh) + body overflow sudah ada.
}
```

- Empty: tak ada berkas → `StateBlock` "Belum ada dokumen untuk item ini." (item belum pernah
  dijalankan, atau sesi belum menulis apa pun).
- Loading/error index & per-berkas dibedakan (pola `DocsWorkspace` cache `string | null`).

### Titik pasang tombol

- **Backlog:** `IconButton` `file-text` (title "Lihat dokumen") ditambah di **`SpecActions`**
  (`BacklogScreen.tsx:154-173`) — satu edit, muncul di `SpecCard`/`SpecRow`/`BoardCard`.
  Membuka `SpecDocsModal` dengan `spec.id`. Selalu tampil; modal menangani kasus kosong.
- **Terminal:** `IconButton` `file-text` ditambah di header **`Cell`**
  (`TerminalScreen.tsx:288-300`), hanya bila `session.specId` ada. Membuka `SpecDocsModal`
  dengan `session.specId` — server otomatis membaca worktree sesi (freshest-wins).

### API client

`src/src/api/client.ts`:

```ts
getSpecDocs: (id: string) => j<{ files: SpecDoc[] }>(paths.specDocs(id)),
getSpecDocFile: (id: string, path: string) => j<{ path: string; content: string }>(paths.specDocFile(id, path)),
```

## Test

| Test | Berkas | Menangkap |
|---|---|---|
| `kindOf`: tiap suffix + dir → jenis benar | `server/test/spec-docs.test.ts` (baru) | klasifikasi |
| `listSpecDocs`: boundary `spec-16` tak menyerempet `spec-167`; hanya `.md`; urut per ORDER | `server/test/spec-docs.test.ts` | matching + urutan |
| `resolveDir`: sesi hidup → cwd; tak ada sesi → repoDir | `server/test/spec-docs.test.ts` | freshest-wins |
| `GET /specs/:id/docs` fixture repo → daftar; `/docs/*` → isi; path keluar → 404 | `server/test/specs.docs.test.ts` (baru) | endpoint + guard |

`listSessions` di-stub (pola test yang ada), fixture pakai temp dir bergaya `withWorktree`.

### Verifikasi nyata (wajib, CLAUDE.md)

Boot server, `curl GET /api/specs/SPEC-145/docs` — SPEC-145 punya `spec-145-*-audit`,
`-objective`, `docs/superpowers/specs/…-spec-145-*`, `docs/superpowers/plans/…-spec-145.md` di
repo — harus mengembalikan keempat jenis. Lalu `curl` satu `path`-nya → isi Markdown.
Smoke UI: buka Backlog & Terminal, klik tombol, cek dialog me-render Markdown.

## Docs (Source of Truth) yang tersentuh — commit yang sama

- `internal/docs/operations/spec-170-doc-viewer-objective.md` (objective) — sudah ditulis.
- `docs/superpowers/specs/2026-07-11-spec-170-doc-viewer-design.md` (dokumen ini).
- `docs/superpowers/plans/2026-07-11-spec-170-doc-viewer.md` (fase Plan).
- `internal/docs/frontend/frontend-implementation.md` — tambah `SpecDocsModal` + `ds/markdown`.
- `internal/docs/README.md` — link objective spec-170.
- **Tanpa ADR:** tak mengubah skema, tak ada keputusan arsitektur baru — viewer read-only di
  atas primitif yang ada. (CLAUDE.md: ADR hanya untuk perubahan skema.)

## Ringkasan permukaan

| Berkas | Perubahan |
|---|---|
| `server/src/services/spec-docs.ts` | **baru** — `kindOf`, `resolveDir`, `listSpecDocs` |
| `server/src/routes/specs.ts` | 2 endpoint: `GET /specs/:id/docs`, `GET /specs/:id/docs/*` |
| `shared/src/api.ts` | `paths.specDocs`, `paths.specDocFile` |
| `src/src/ds/markdown.tsx` | **baru** — `MarkdownView` diangkat dari DocsWorkspace |
| `src/src/ds/index.ts` | ekspor `MarkdownView` |
| `src/src/screens/DocsWorkspace.tsx` | import `MarkdownView` dari `../ds` (hapus lokal) |
| `src/src/screens/SpecDocsModal.tsx` | **baru** — dialog preview |
| `src/src/screens/BacklogScreen.tsx` | tombol di `SpecActions` |
| `src/src/screens/TerminalScreen.tsx` | tombol di header `Cell` |
| `src/src/api/client.ts` | `getSpecDocs`, `getSpecDocFile` |

Tiga berkas sumber baru (dua di antaranya viewer/renderer), sisanya sisipan kecil. Tanpa
migration, tanpa kolom, tanpa dependency runtime baru.
