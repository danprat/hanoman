# SPEC-141 — Overview coverage realtime (coverage jadi nilai turunan)

**Status:** approved (design)
**Date:** 2026-07-09
**Objective (dikunci):** [`internal/docs/operations/spec-141-overview-coverage-realtime-objective.md`]
**Replaces:** keputusan cache `Project.coverage` dari design SPEC-011 §3

## Objective

Overview menampilkan SoT coverage nyata dari disk, sama seperti Docs workspace, **tanpa
langkah Scan manual**. `coverage` dan `docStatus` berhenti menjadi state tersimpan dan kembali
menjadi nilai turunan yang dihitung dari `repoDir` saat dibaca.

## Why

`Project.coverage` + `Project.docStatus` adalah kolom Postgres yang menyimpan nilai yang
sepenuhnya diturunkan dari filesystem. Create menulisnya hardcoded `0 / "broken"` tanpa pernah
men-scan (`routes/projects.ts:27`); satu-satunya penyegar adalah `POST /projects/:id/scan`
(`:43`); pembacanya cuma satu, `toProjectView()` (`services/project-view.ts:17`), yang mensuplai
Overview dan daftar Projects. Sementara `GET /projects/:id/docs` menghitung angka yang sama
realtime lewat `scanRepoDocs()`. Satu angka, dua sumber kebenaran.

Audit SPEC-141 mengukurnya terhadap API live, disk yang sama, detik yang sama:

| langkah | Overview (`GET /projects`) | realtime (`GET /docs`) |
| --- | --- | --- |
| project baru | **0% · broken** | **100%** |
| + satu doc tak ter-link | **100% · ok** | **92%** |

Basinya dua arah. Ini **bukan** kelalaian: design SPEC-011 §3 secara sadar memilih agar
"`scan` only refreshes the cached `Project.coverage` number that the projects/overview lists read
without re-walking". Spec ini membalik keputusan itu, karena harganya ternyata sebuah angka yang
bohong di layar utama.

## Decisions (locked)

| Decision | Choice |
|----------|--------|
| `Project.coverage` / `Project.docStatus` | **Dibuang** — migration Prisma + [ADR-0018](../../../internal/docs/adr/0018-coverage-nilai-turunan.md) |
| Sumber angka | `scanRepoDocs(repoDir)` — fungsi yang sama yang sudah dipakai `GET /docs` |
| Titik turunan | `toProjectView()` — satu-satunya pembaca kolom hari ini |
| `POST /projects/:id/scan` | **Dihapus** — tak ada lagi yang bisa disegarkan; web satu-satunya klien |
| Tombol Scan | "Scan semua" (Overview + Projects) dihapus; "Scan" di Docs workspace jadi muat-ulang `GET /docs` biasa |
| Biaya event loop | `git ls-files` pindah ke `execFile` async — **96%** dari biaya blocking |
| Cache | **Tidak ada** — terukur ~19 ms/scan; ditambahkan hanya bila daftar melambat |
| Metrik coverage | Tak disentuh — `coverageOf`, `docStatusFor`, `linkedSetFrom` apa adanya |
| Nomor ADR | **0018** — dienumerasi di seluruh branch + 6 worktree; tertinggi `0017` |

## Architecture

### 1. Turunkan di `toProjectView`

```ts
// server/src/services/project-view.ts
const { coverage } = await scanRepoDocs(p.repoDir);   // p sudah di-fetch; tanpa query tambahan
return { ...,  coverage, docStatus: docStatusFor(coverage) };
```

`docStatusFor` pindah importnya ke sini; `routes/projects.ts` berhenti mengimpor `docIndex` dan
`docStatusFor`.

`repoDir` null / bukan git repo → `scanRepoDocs` mengembalikan `{ coverage: 0, tree: [] }` →
`docStatusFor(0) === "broken"` — **persis nilai yang di-hardcode create hari ini**, jadi tampilan
project kosong tidak bergeser.

`toProjectView` dipanggil dari empat tempat, semuanya di `routes/projects.ts` (list, get, create,
dan `scan` yang akan dihapus). Tidak ada jalur SSE atau hot path yang ikut membayar scan.

### 2. Jangan blokir event loop

`scanRepoDocs` memakai `spawnSync` + `readFileSync`. Terukur di repo ini (80 `.md`, 48 dibaca):

```
git ls-files (spawnSync)        18.80 ms
readFileSync x 48 file           0.82 ms   -> spawn = 96% biaya blocking
```

Jadi cukup satu perubahan: `listRepoDocs` memakai `promisify(execFile)`, `scanRepoDocs` menjadi
`async`. `readFileSync` **tetap sync** — `linkedSetFrom` menerima `read` sinkron dan ia pure di
`@hanoman/shared`; mengasinkronkannya akan menyeret `node:*` ke barrel yang di-bundle Vite.

```ts
const exec = promisify(execFile);
export async function listRepoDocs(repoDir: string): Promise<string[]> {
  try {
    const { stdout } = await exec("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.md"],
      { cwd: repoDir, maxBuffer: 1 << 24 });   // default 1 MB ~ 10k path; naikkan sekalian
    return [...new Set(stdout.split("\n").map((s) => s.trim()).filter(Boolean))].sort();
  } catch { return []; }                        // bukan git repo: sama dengan `status !== 0` hari ini
}
```

`GET /projects` lalu menjalankan N scan **konkuren** di bawah `Promise.all` yang sudah ada, bukan
N spawn blocking berurutan.

### 3. Hapus endpoint + tombol Scan

- `server/src/routes/projects.ts` — buang handler `POST /projects/:id/scan`.
- `shared/src/api.ts` — buang `paths.scan`.
- `src/src/api/client.ts` — buang `scanProject`.
- `src/src/App.tsx` — buang `scanAll`, state `scanning`, dan tombol **"Scan semua"** di header
  Overview **dan** Projects.
- `src/src/screens/DocsWorkspace.tsx` — `rescan()` menyusut jadi `reloadIndex()` (sudah ada);
  tombol tetap ada sebagai muat-ulang, begitu pula `action` di empty-state. Label "Scan" → "Muat ulang".

### 4. DB / migration / ADR

```sql
ALTER TABLE "Project" DROP COLUMN "docStatus", DROP COLUMN "coverage";
```

`schema.prisma` kehilangan dua baris di `model Project`. **DTO `ProjectView` tidak berubah** —
`coverage` dan `docStatus` tetap dikirim ke web, hanya sumbernya yang pindah; `shared/src/entities.ts`
dan seluruh tipe frontend tak tersentuh.

ADR-0018 lahir berstatus `proposed` di fase Spec ini (mengunci nomornya terhadap worktree sebelah)
dan menjadi `accepted` bersama migration di fase Execute.

### 5. Tests

| File | Perubahan |
|------|-----------|
| `server/test/factory.ts:34` | buang `docStatus`/`coverage` dari `create` |
| `server/test/github-status-reporter.test.ts:17` | idem |
| `server/test/scan.test.ts` | `scanRepoDocs` jadi async → `await` |
| `server/test/docs.route.test.ts:41` | hapus test `POST /scan` |
| `server/test/projects.route.test.ts:23` | ganti test "scan recomputes coverage" dengan **regression SPEC-141** |

Regression yang wajib ada: project menunjuk temp git repo berisi docs ter-link → `GET /projects/:id`
mengembalikan coverage nyata **tanpa** panggilan scan apa pun; lalu tambah satu doc tak ter-link →
`GET /projects` ikut turun, tetap tanpa scan.

## Docs SoT yang diperbarui **di fase Execute**

Ketiganya mendeskripsikan cache yang masih ada hari ini; mengeditnya sekarang membuat SoT berbohong.

- `internal/docs/architecture/data-model.md:7,33` — hapus kolom + kalimat "disimpan sebagai cache di `Project.coverage`, disegarkan oleh `POST /projects/:id/scan`".
- `internal/docs/architecture/api-contract.md:10,52–53` — hapus route `POST /projects/:id/scan` + kalimat cache.
- `internal/docs/frontend/frontend-implementation.md:5` — "tombol **Scan** per project menyegarkan coverage" → muat ulang.
- `internal/docs/adr/0018-coverage-nilai-turunan.md` — `proposed` → `accepted`.

## Out of scope (noted, not built)

- **Cache HEAD/mtime** — 19 ms per scan, konkuren dan non-blocking. Komentar `ponytail:` di
  `scan.ts:35` sudah menamai syarat pemicunya. Kriteria pembalikan: `GET /projects` melewati ~200 ms.
- **Guardrail run CLI** (`cli/src/verify.ts`) — sudah menghitung dari disk, tak pernah menyentuh DB.
- **Watcher / SSE push untuk coverage** — polling `GET` cukup (batas scope SPEC-011 tetap).
- **Metrik coverage** — `coverageOf` / `docStatusFor` / `linkedSetFrom` dipakai ulang tanpa diubah;
  ambang status dan tree kategori tidak bergeser.
- **Docs workspace tree** — sudah realtime.

## Testing

- Unit: `toProjectView` dengan temp git repo → coverage nyata; `repoDir` null → `0` / `broken`, tanpa crash.
- Unit: `scanRepoDocs` async, non-git dir → `{ coverage: 0, tree: [] }`.
- Route: `POST /api/projects/:id/scan` → **404**.
- Regression SPEC-141 (di atas), dua arah: project baru, dan doc tak ter-link ditambahkan.
- Smoke lokal nyata (CLAUDE.md): boot server, `curl` create → `GET /projects` menunjukkan coverage
  nyata tanpa scan; tambah doc tak ter-link → angka turun tanpa scan; hapus project probe.

## Open questions — resolved

- **Endpoint `scan`: no-op atau hapus?** → **hapus**. Klien satu-satunya adalah web; route mati adalah
  kode mati, dan postur ADR-0011 adalah deletion over addition.
- **Tambah cache sekarang?** → **tidak**. 19 ms, konkuren. Menambah cache berarti memasang kembali
  salinan-yang-bisa-basi yang persis jadi sebab bug ini.
- **Nomor ADR?** → **0018**, dienumerasi di seluruh branch dan 6 worktree.
- **Tombol Scan dibuang total?** → di Overview/Projects ya; di Docs workspace disisakan sebagai
  muat-ulang, karena file bisa berubah dari luar dashboard.
