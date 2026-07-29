# Preview modal `.md` di IDE & Review — Implementation Plan (SPEC-385)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dari mana pun sebuah berkas `.md` dibuka di IDE dan Review, ada satu aksi terlihat untuk membacanya sebagai dokumen terender di ruang baca lebar — dan dokumen itu bisa diunduh `.md`/`.pdf` seperti pratinjau dokumen lain (ADR-0078).

**Architecture:** Satu komponen design-system baru `DocPreviewModal` (tak tahu apa-apa soal spec/ide/review) dipanggil sebagai aksi dari tiga layar; Git Graph — yang permukaannya sudah modal — memakai tab ketiga alih-alih modal bertumpuk. Parity unduh diwujudkan dengan menempelkan query `?download=md|pdf` ke lima endpoint yang **sudah ada** (pola ADR-0078), bukan endpoint ekspor baru. Tanpa skema, tanpa migration, tanpa ADR baru.

**Tech Stack:** React 18 + TypeScript (Vite) · `marked` (`ds/markdown.tsx`) · Fastify + `pdfkit` (`server/src/services/doc-export.ts`) · Vitest (jsdom untuk `src`, node untuk `server`) + Testing Library.

## Global Constraints

- Spec/design acuan: `docs/superpowers/specs/2026-07-29-spec-385-preview-modal-md-ide-review-design.md`.
- **Jangan sentuh `shared/src/api.ts`** — semua path builder yang dibutuhkan sudah ada, dan menyentuh modul inti meledakkan blast radius `vitest --changed` ke hampir seluruh suite (ADR-0080).
- **Tanpa endpoint baru, tanpa perubahan skema/Prisma, tanpa ADR baru.** Query `?download=` menempel di endpoint yang sudah ada; nilai absen/tak dikenal → respons JSON lama **utuh**.
- Gerbang preview seragam di semua permukaan: path berakhiran `.md` (case-insensitive) **dan** `binary === false` **dan** `content !== null`.
- Prosa UI berbahasa Indonesia; ikuti design system (`internal/docs/design-system/design-system.md`) — token `var(--…)`, tanpa CSS baru.
- **Jangan menambah tinggi tetap px/vh** di rantai layout pratinjau — `src/test/preview-fill-height.test.tsx` menjaga kontrak ini (SPEC-363).
- Scope verifikasi `changed` (ADR-0080): jalankan test yang tersentuh, typecheck **hanya** `./src` dan `./server`. Jangan `pnpm test`, `vitest run` polos, atau `pnpm -r typecheck`.
- Semua perintah test dijalankan dengan `env -u NODE_ENV -u DATABASE_URL` (env shell menunjuk prod dan membuat ~41 test gagal palsu).
- `--changed` menyalakan `passWithNoTests`: **nol test terlihat hijau**. Setiap langkah "run test" harus memverifikasi jumlah test yang benar-benar berjalan, bukan sekadar exit 0.

## File Structure

| Berkas | Tanggung jawab |
| --- | --- |
| `src/src/ds/markdown.tsx` (modif) | + `isMarkdownPath()` — satu-satunya definisi "ini berkas markdown" untuk seluruh frontend |
| `src/src/ds/DocPreviewModal.tsx` (baru) | Modal baca dokumen: judul + eyebrow + unduh opsional + `MarkdownView` di pane yang menggulir |
| `src/src/ds/index.ts` (modif) | Barrel: ekspor `DocPreviewModal` + `isMarkdownPath` |
| `server/src/services/doc-export.ts` (modif) | + `sendReviewDownload()` — satu tempat aturan "biner/terhapus tak bisa diunduh" |
| `server/src/routes/specs.ts` (modif) | `?download=` di `GET /specs/:id/review/*` |
| `server/src/routes/terminal.ts` (modif) | `?download=` di `GET /terminal/sessions/:id/review/*` |
| `server/src/routes/ide.ts` (modif) | `?download=` di `file-diff`, `commit/:sha/file`, `compare/file` |
| `src/src/api/client.ts` (modif) | 5 builder URL unduh (satu baris masing-masing) |
| `src/src/screens/ReviewScreen.tsx` (modif) | Tombol Preview + modal (backlog **dan** sesi PRD) |
| `src/src/screens/IdeScreen.tsx` (modif) | Tombol Preview di mode file **dan** mode diff |
| `src/src/screens/GitGraph.tsx` (modif) | Tab ketiga `preview` + unduh di modal berkas commit |

---

### Task 1: `isMarkdownPath` + `DocPreviewModal` (design system)

Komponen berdiri sendiri tanpa konsumen — bisa di-review terpisah dari layar mana pun.

**Files:**
- Modify: `src/src/ds/markdown.tsx`
- Create: `src/src/ds/DocPreviewModal.tsx`
- Modify: `src/src/ds/index.ts`
- Test: `src/test/doc-preview-modal.test.tsx` (baru)

**Interfaces:**
- Consumes: `Modal` (`ds/kit.tsx`, prop `fillHeight` sudah ada sejak SPEC-363), `MarkdownView` (`ds/markdown.tsx`), `DocDownload` (`ds/DocDownload.tsx`), `StateBlock` (`ds/components/state`).
- Produces:
  - `isMarkdownPath(p: string): boolean`
  - `DocPreviewModal(props: { path: string; text: string; eyebrow?: React.ReactNode; download?: (fmt: "md" | "pdf") => string; onClose: () => void })`

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/doc-preview-modal.test.tsx`:

```tsx
/* SPEC-385 · DocPreviewModal — pratinjau `.md` terender sebagai AKSI dari permukaan
   berorientasi diff/kode. Test menuntut markdown BENAR-BENAR terparse (heading, bukan
   sekadar teks mentah) supaya tak lulus palsu saat renderer tak terpasang. */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DocPreviewModal, isMarkdownPath } from "../src/ds";

describe("isMarkdownPath", () => {
  it("mengenali .md tanpa peduli besar-kecil huruf", () => {
    expect(isMarkdownPath("docs/a.md")).toBe(true);
    expect(isMarkdownPath("README.MD")).toBe(true);
  });
  it("menolak yang bukan .md", () => {
    expect(isMarkdownPath("src/a.ts")).toBe(false);
    expect(isMarkdownPath("a.md.ts")).toBe(false);
    expect(isMarkdownPath("")).toBe(false);
  });
});

describe("DocPreviewModal", () => {
  it("merender markdown (bukan teks mentah) dan memakai basename sebagai judul", () => {
    render(<DocPreviewModal path="internal/docs/product/prd.md"
      text={"# Judul\n\nisi paragraf"} onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: "Judul" })).toBeInTheDocument();
    expect(screen.getByText("prd.md")).toBeInTheDocument();
    expect(screen.queryByText("# Judul")).toBeNull();
  });

  it("eyebrow default = path penuh, bisa ditimpa", () => {
    const { unmount } = render(<DocPreviewModal path="a/b.md" text="# x" onClose={() => {}} />);
    expect(screen.getByText("a/b.md")).toBeInTheDocument();
    unmount();
    render(<DocPreviewModal path="a/b.md" text="# x" eyebrow="SPEC-385" onClose={() => {}} />);
    expect(screen.getByText("SPEC-385")).toBeInTheDocument();
  });

  it("tanpa prop download tak ada tombol unduh; dengan download ada .md & .pdf (ADR-0078)", () => {
    const { unmount } = render(<DocPreviewModal path="a/b.md" text="# x" onClose={() => {}} />);
    expect(screen.queryByRole("link", { name: /unduh \.md/i })).toBeNull();
    unmount();
    render(<DocPreviewModal path="a/b.md" text="# x" onClose={() => {}}
      download={(f) => `/api/x?download=${f}`} />);
    expect(screen.getByRole("link", { name: /unduh \.md/i })).toHaveAttribute("href", "/api/x?download=md");
    expect(screen.getByRole("link", { name: /unduh \.pdf/i })).toHaveAttribute("href", "/api/x?download=pdf");
  });

  it("berkas kosong memberi keadaan kosong, bukan pane hampa", () => {
    render(<DocPreviewModal path="a/b.md" text="" onClose={() => {}} />);
    expect(screen.getByText(/berkas kosong/i)).toBeInTheDocument();
  });

  it("Escape & tombol tutup memanggil onClose", () => {
    const onClose = vi.fn();
    render(<DocPreviewModal path="a/b.md" text="# x" onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Tutup"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("pane baca tak memasang tinggi tetap px/vh (kontrak SPEC-363)", () => {
    render(<DocPreviewModal path="a/b.md" text="# x" onClose={() => {}} />);
    const pane = screen.getByTestId("doc-preview-scroll");
    for (const prop of ["height", "maxHeight", "minHeight"]) {
      const v = pane.style.getPropertyValue(prop);
      expect(v === "" || v === "0px" || v === "0").toBe(true);
    }
    expect(pane.style.overflow).toBe("auto");
  });
});
```

- [x] **Step 2: Jalankan test — harus gagal**

```bash
cd src && env -u NODE_ENV -u DATABASE_URL npx vitest run test/doc-preview-modal.test.tsx
```
Expected: FAIL — `No "DocPreviewModal" export is defined on the "../src/ds" mock` / resolusi impor gagal.

- [x] **Step 3: Tambahkan `isMarkdownPath` ke `ds/markdown.tsx`**

Sisipkan tepat di bawah `hnLang`, di atas `hnDocHtml`:

```tsx
/* SPEC-385 · satu-satunya definisi "berkas markdown" untuk frontend. Dulu hidup sebagai const
   lokal `isMarkdown` di IdeScreen; kini dipakai IDE, Git Graph, dan Review sekaligus. */
export const isMarkdownPath = (p: string): boolean => /\.md$/i.test(p);
```

- [x] **Step 4: Buat `src/src/ds/DocPreviewModal.tsx`**

```tsx
/* DocPreviewModal (SPEC-385) — pratinjau `.md` terender di ruang baca lebar, dipanggil sebagai
   AKSI dari permukaan yang berorientasi diff/kode (IDE Explorer, Git Graph, Review). Sengaja
   tak tahu apa-apa soal spec/ide/review: pemanggil menyerahkan isi + (opsional) URL unduh
   ADR-0078, jadi komponen ini tak pernah menyentuh api client.

   Tinggi diwarisi dari panel modal lewat `fillHeight` (SPEC-363) — jangan menaruh angka px/vh
   di rantai ini; `.hn-md` sudah memasang overflow-wrap/table-layout/pre-wrap secara global. */
import React from "react";
import { Modal } from "./kit";
import { StateBlock } from "./components/state";
import { MarkdownView } from "./markdown";
import { DocDownload } from "./DocDownload";

export function DocPreviewModal({ path, text, eyebrow, download, onClose }: {
  path: string; text: string; eyebrow?: React.ReactNode;
  download?: (fmt: "md" | "pdf") => string; onClose: () => void;
}) {
  const name = path.slice(path.lastIndexOf("/") + 1) || path;
  return (
    <Modal open title={name} eyebrow={eyebrow ?? path} icon="book-open"
      onClose={onClose} width={980} fillHeight>
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {download && (
          <div style={{ display: "flex", justifyContent: "flex-end", paddingBottom: 6,
            borderBottom: "1px solid var(--border-hair)", marginBottom: 8 }}>
            <DocDownload href={download} />
          </div>
        )}
        <div data-testid="doc-preview-scroll"
          style={{ flex: "1 1 0", minHeight: 0, overflow: "auto", padding: "0 4px 8px" }}>
          {text
            ? <MarkdownView text={text} name={path} />
            : <StateBlock kind="empty" icon="file-text" title="Berkas kosong" hint={path} />}
        </div>
      </div>
    </Modal>
  );
}
```

- [x] **Step 5: Ekspor dari barrel `src/src/ds/index.ts`**

Ganti baris `export { MarkdownView, hnDocHtml } from "./markdown";` menjadi:

```ts
export { MarkdownView, hnDocHtml, isMarkdownPath } from "./markdown";
export { DocPreviewModal } from "./DocPreviewModal";
```

- [x] **Step 6: Jalankan test — harus lulus**

```bash
cd src && env -u NODE_ENV -u DATABASE_URL npx vitest run test/doc-preview-modal.test.tsx
```
Expected: PASS, **8 test** (2 `isMarkdownPath` + 6 `DocPreviewModal`). Kalau tertulis "no test files", berkasnya salah path — jangan terima itu sebagai hijau.

- [x] **Step 7: Typecheck paket `src`**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src typecheck
```
Expected: exit 0, tanpa keluaran error.

- [x] **Step 8: Commit**

```bash
git add src/src/ds/DocPreviewModal.tsx src/src/ds/markdown.tsx src/src/ds/index.ts src/test/doc-preview-modal.test.tsx
git commit -m "feat(spec-385): DocPreviewModal + isMarkdownPath di design system"
```

---

### Task 2: `?download=` di endpoint review & diff (server)

Lima endpoint, satu pola. Bisa di-review dan ditolak tanpa menyentuh frontend sama sekali.

**Files:**
- Modify: `server/src/services/doc-export.ts` (tambah `sendReviewDownload`)
- Modify: `server/src/routes/specs.ts:294-307`
- Modify: `server/src/routes/terminal.ts:313-320`
- Modify: `server/src/routes/ide.ts` (`/projects/:id/file-diff`, `/projects/:id/commit/:sha/file`, `/projects/:id/compare/file`)
- Test: `server/test/review-download.route.test.ts` (baru)

**Interfaces:**
- Consumes: `downloadFormat(q: unknown): "md" | "pdf" | null` dan `sendDocDownload(reply, fmt, { content, name, prefix, eyebrow, path })` — keduanya sudah ada di `doc-export.ts`. `ReviewFile` (`server/src/services/spec-review.ts:19`) punya `binary: boolean` dan `content: string | null`.
- Produces: `sendReviewDownload(reply: FastifyReply, fmt: "md" | "pdf", rf: { binary: boolean; content: string | null }, a: { prefix: string; eyebrow: string; path: string }): Promise<unknown>`

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/review-download.route.test.ts`:

```ts
/* SPEC-385 · ADR-0078 · parity unduh untuk pratinjau `.md` di Review & pane diff IDE.
   Query `?download=` menempel di endpoint yang SUDAH ada — tanpa query, bentuk JSON
   ReviewFile lama harus utuh. */
import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeSpec, makeRepoWithWorktree, makeRepoWithChanges } from "./factory";

const app = buildApp({ requireAuth: false });
const DOC = "docs/catatan.md";
const AFTER = "# Catatan\n\nbaris baru sesudah perubahan.";

beforeAll(async () => {
  await resetDb();
  const wtRepo = makeRepoWithWorktree("SPEC-385", { [DOC]: "# Catatan\n", "bin.png": "x" }, { [DOC]: AFTER });
  await makeProject({ id: "rv", repoDir: wtRepo });
  await makeSpec({ id: "SPEC-385", projectId: "rv" });
  await makeProject({ id: "chg2", repoDir: makeRepoWithChanges() });
});

describe("unduh berkas review backlog (?download=)", () => {
  it("md mentah = isi SESUDAH perubahan, dengan content-disposition", async () => {
    const res = await app.inject({ url: `/api/specs/SPEC-385/review/${DOC}?download=md` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/markdown");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="SPEC-385-catatan.md"');
    expect(res.body).toBe(AFTER);
  });

  it("pdf valid", async () => {
    const res = await app.inject({ url: `/api/specs/SPEC-385/review/${DOC}?download=pdf` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("tanpa query: bentuk JSON ReviewFile lama utuh", async () => {
    const res = await app.inject({ url: `/api/specs/SPEC-385/review/${DOC}` });
    expect(res.statusCode).toBe(200);
    const j = res.json();
    expect(j).toHaveProperty("binary", false);
    expect(j).toHaveProperty("diff");
    expect(j.content).toBe(AFTER);
  });

  it("nilai download tak dikenal diabaikan (tetap JSON)", async () => {
    const res = await app.inject({ url: `/api/specs/SPEC-385/review/${DOC}?download=docx` });
    expect(res.json().content).toBe(AFTER);
  });
});

describe("unduh berkas diff working tree IDE (?download=)", () => {
  it("unstaged: md mentah + pdf", async () => {
    const md = await app.inject({ url: "/api/projects/chg2/file-diff?path=tracked.txt&download=md" });
    expect(md.statusCode).toBe(200);
    expect(md.body).toBe("keep\nmore\n");
    const pdf = await app.inject({ url: "/api/projects/chg2/file-diff?path=tracked.txt&download=pdf" });
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("staged: isi dari index", async () => {
    const md = await app.inject({ url: "/api/projects/chg2/file-diff?path=staged.txt&staged=1&download=md" });
    expect(md.statusCode).toBe(200);
    expect(md.body).toBe("one\ntwo\n");
  });

  it("tanpa query: JSON ReviewFile lama", async () => {
    const res = await app.inject({ url: "/api/projects/chg2/file-diff?path=tracked.txt" });
    expect(res.json()).toHaveProperty("binary", false);
  });
});

describe("unduh berkas commit & compare di Git Graph (?download=)", () => {
  it("commit/:sha/file mengunduh isi berkas di commit itu", async () => {
    const head = await app.inject({ url: "/api/projects/rv/graph?limit=5" });
    const sha = head.json().commits[0].sha as string;
    const md = await app.inject({ url: `/api/projects/rv/commit/${sha}/file?path=${DOC}&download=md` });
    expect(md.statusCode).toBe(200);
    expect(md.headers["content-disposition"]).toContain("catatan.md");
    expect(md.body).toContain("# Catatan");
  });

  it("compare/file mengunduh isi berkas di ujung `to`", async () => {
    const head = await app.inject({ url: "/api/projects/rv/graph?limit=5" });
    const sha = head.json().commits[0].sha as string;
    const md = await app.inject({ url: `/api/projects/rv/compare/file?from=${sha}&to=${sha}&path=${DOC}&download=md` });
    expect(md.statusCode).toBe(200);
    expect(md.body).toContain("# Catatan");
  });
});
```

- [x] **Step 2: Jalankan test — harus gagal**

```bash
cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run test/review-download.route.test.ts --no-file-parallelism
```
Expected: FAIL — permintaan ber-`?download=md` masih membalas JSON, jadi `res.body` bukan markdown mentah dan `content-disposition` tak ada.

- [x] **Step 3: Tambahkan `sendReviewDownload` ke `server/src/services/doc-export.ts`**

Sisipkan tepat di bawah `sendDocDownload`:

```ts
/** SPEC-385 · ADR-0078 · unduh isi sebuah `ReviewFile` (isi SESUDAH perubahan) dari endpoint
    review/diff yang sudah ada. Berkas biner atau yang dihapus (`content === null`) → 404: tak
    ada dokumen untuk diunduh, dan mengarang string kosong akan menghasilkan PDF menyesatkan. */
export async function sendReviewDownload(
  reply: FastifyReply, fmt: "md" | "pdf",
  rf: { binary: boolean; content: string | null },
  a: { prefix: string; eyebrow: string; path: string },
): Promise<unknown> {
  if (rf.binary || rf.content === null)
    return reply.code(404).send({ error: "tak ada isi untuk diunduh" });
  return sendDocDownload(reply, fmt, {
    content: rf.content, name: a.path, prefix: a.prefix, eyebrow: a.eyebrow, path: a.path,
  });
}
```

- [x] **Step 4: Pasang di `server/src/routes/specs.ts`**

Ganti dua baris terakhir handler `app.get("/specs/:id/review/*", …)`:

```ts
    const rf = r.wt ? await reviewFile(repoDir, id, spec.baseSha, spec.branchFrom, path)
      : await reviewFileRange(repoDir, r.base, r.head, path);
    return rf === null ? reply.code(404).send({ error: "not found" }) : rf;
```

menjadi:

```ts
    const rf = r.wt ? await reviewFile(repoDir, id, spec.baseSha, spec.branchFrom, path)
      : await reviewFileRange(repoDir, r.base, r.head, path);
    if (rf === null) return reply.code(404).send({ error: "not found" });
    // SPEC-385 · ADR-0078 · unduh berkas yang sedang dipratinjau di Review. Tanpa query → JSON lama.
    const fmt = downloadFormat(req.query);
    if (fmt) return sendReviewDownload(reply, fmt, rf, { prefix: id, eyebrow: `hanoman · ${id}`, path });
    return rf;
```

Lalu perluas impor `doc-export` yang sudah ada di baris 20 menjadi:

```ts
import { downloadFormat, sendDocDownload, sendReviewDownload } from "../services/doc-export";
```

- [x] **Step 5: Pasang di `server/src/routes/terminal.ts`**

Ganti dua baris terakhir handler `app.get("/terminal/sessions/:id/review/*", …)`:

```ts
    const rf = await reviewFile(r.repoDir, r.id, null, null, path);
    return rf === null ? reply.code(404).send({ error: "not found" }) : rf;
```

menjadi:

```ts
    const rf = await reviewFile(r.repoDir, r.id, null, null, path);
    if (rf === null) return reply.code(404).send({ error: "not found" });
    // SPEC-385 · ADR-0078 · sama seperti review backlog; Review sesi PRD memakai layar yang sama.
    const fmt = downloadFormat(req.query);
    if (fmt) return sendReviewDownload(reply, fmt, rf, { prefix: id, eyebrow: `hanoman · ${id}`, path });
    return rf;
```

Tambahkan impor di bagian atas berkas (setelah impor `spec-review` di baris 8):

```ts
import { downloadFormat, sendReviewDownload } from "../services/doc-export";
```

- [x] **Step 6: Pasang di tiga handler `server/src/routes/ide.ts`**

`/projects/:id/file-diff` — ganti isi `try`:

```ts
      const f = await workingFileDiff(repoDir, path, staged === "1" || staged === "true");
      if (f === null) return reply.code(404).send({ error: "not found" });
      // SPEC-385 · ADR-0078 · unduh berkas .md yang sedang dipratinjau dari pane diff Explorer.
      const fmt = downloadFormat(req.query);
      if (fmt) return sendReviewDownload(reply, fmt, f, {
        prefix: (req.params as { id: string }).id,
        eyebrow: `hanoman · ${(req.params as { id: string }).id}`, path,
      });
      return f;
```

`/projects/:id/compare/file` — ganti isi `try`:

```ts
      const f = await compareFile(repoDir, from, to, path);
      if (f === null) return reply.code(404).send({ error: "not found" });
      // SPEC-385 · ADR-0078 · unduh berkas .md yang dipratinjau dari compare dua commit.
      const fmt = downloadFormat(req.query);
      if (fmt) return sendReviewDownload(reply, fmt, f, {
        prefix: `${(req.params as { id: string }).id}-${to.slice(0, 8)}`,
        eyebrow: `hanoman · ${from.slice(0, 8)}…${to.slice(0, 8)}`, path,
      });
      return f;
```

`/projects/:id/commit/:sha/file` — ganti isi `try`:

```ts
      const f = await commitFileDiff(repoDir, sha, path);
      if (f === null) return reply.code(404).send({ error: "not found" });
      // SPEC-385 · ADR-0078 · unduh berkas .md yang dipratinjau dari detail commit di Git Graph.
      const fmt = downloadFormat(req.query);
      if (fmt) return sendReviewDownload(reply, fmt, f, {
        prefix: `${id}-${sha.slice(0, 8)}`, eyebrow: `hanoman · ${id} · ${sha.slice(0, 8)}`, path,
      });
      return f;
```

Perluas impor baris 5 menjadi:

```ts
import { downloadFormat, sendDocDownload, sendReviewDownload } from "../services/doc-export";
```

- [x] **Step 7: Jalankan test — harus lulus**

```bash
cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run test/review-download.route.test.ts --no-file-parallelism
```
Expected: PASS, **9 test**.

- [x] **Step 8: Jalankan test route tetangga yang bisa terdampak**

```bash
cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run test/ide.route.test.ts test/doc-download.route.test.ts test/spec-docs.route.test.ts --no-file-parallelism
```
Expected: PASS semua — membuktikan respons tanpa `?download=` tak berubah bentuk.

- [x] **Step 9: Typecheck paket `server`**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server typecheck
```
Expected: exit 0.

- [x] **Step 10: Commit**

```bash
git add server/src/services/doc-export.ts server/src/routes/specs.ts server/src/routes/terminal.ts server/src/routes/ide.ts server/test/review-download.route.test.ts
git commit -m "feat(spec-385): ?download=md|pdf di endpoint review & diff (ADR-0078)"
```

---

### Task 3: Builder URL unduh di api client

**Files:**
- Modify: `src/src/api/client.ts` (blok builder unduh SPEC-361, sekitar baris 157-164)
- Test: `src/test/api-client.test.ts`

**Interfaces:**
- Consumes: `paths.download`, `paths.specReviewFile`, `paths.sessionReviewFile`, `paths.ideFileDiff`, `paths.ideCommitFile`, `paths.ideCompareFile` — semuanya sudah ada di `@hanoman/shared`.
- Produces (dipakai Task 4-6):
  - `api.specReviewFileDownloadUrl(id: string, path: string, fmt: "md" | "pdf"): string`
  - `api.sessionReviewFileDownloadUrl(id: string, path: string, fmt: "md" | "pdf"): string`
  - `api.ideFileDiffDownloadUrl(id: string, path: string, staged: boolean, fmt: "md" | "pdf"): string`
  - `api.ideCommitFileDownloadUrl(id: string, sha: string, path: string, fmt: "md" | "pdf"): string`
  - `api.ideCompareFileDownloadUrl(id: string, from: string, to: string, path: string, fmt: "md" | "pdf"): string`

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `src/test/api-client.test.ts` (di luar `describe` yang sudah ada):

```ts
// SPEC-385 · URL unduh untuk pratinjau di Review & pane diff IDE (ADR-0078: query di endpoint
// yang sudah ada, bukan endpoint ekspor baru).
describe("URL unduh pratinjau review & diff (SPEC-385)", () => {
  it("review backlog & review sesi", () => {
    expect(api.specReviewFileDownloadUrl("SPEC-385", "docs/a.md", "md"))
      .toBe("/api/specs/SPEC-385/review/docs/a.md?download=md");
    expect(api.sessionReviewFileDownloadUrl("sess1", "docs/a.md", "pdf"))
      .toBe("/api/terminal/sessions/sess1/review/docs/a.md?download=pdf");
  });

  it("diff working tree: query download digabung dengan query yang sudah ada", () => {
    expect(api.ideFileDiffDownloadUrl("p1", "docs/a.md", false, "md"))
      .toBe("/api/projects/p1/file-diff?path=docs%2Fa.md&download=md");
    expect(api.ideFileDiffDownloadUrl("p1", "docs/a.md", true, "pdf"))
      .toBe("/api/projects/p1/file-diff?path=docs%2Fa.md&staged=1&download=pdf");
  });

  it("berkas commit & compare di Git Graph", () => {
    expect(api.ideCommitFileDownloadUrl("p1", "abc1234", "docs/a.md", "md"))
      .toBe("/api/projects/p1/commit/abc1234/file?path=docs%2Fa.md&download=md");
    expect(api.ideCompareFileDownloadUrl("p1", "aaa", "bbb", "docs/a.md", "pdf"))
      .toBe("/api/projects/p1/compare/file?from=aaa&to=bbb&path=docs%2Fa.md&download=pdf");
  });
});
```

Kalau `describe`/`it`/`expect`/`api` belum diimpor di berkas itu, pakai impor yang sudah ada di puncak berkas — jangan menduplikasi.

- [x] **Step 2: Jalankan test — harus gagal**

```bash
cd src && env -u NODE_ENV -u DATABASE_URL npx vitest run test/api-client.test.ts
```
Expected: FAIL — `api.specReviewFileDownloadUrl is not a function`.

- [x] **Step 3: Tambahkan lima builder**

Di `src/src/api/client.ts`, tepat di bawah baris `ideFileDownloadUrl: …` yang sudah ada:

```ts
  // SPEC-385 · ADR-0078 · URL unduh untuk pratinjau di Review & pane diff IDE. Isi yang diunduh
  // = `ReviewFile.content` (isi SESUDAH perubahan), persis yang dirender DocPreviewModal.
  specReviewFileDownloadUrl: (id: string, path: string, fmt: "md" | "pdf") =>
    paths.download(paths.specReviewFile(id, path), fmt),
  sessionReviewFileDownloadUrl: (id: string, path: string, fmt: "md" | "pdf") =>
    paths.download(paths.sessionReviewFile(id, path), fmt),
  ideFileDiffDownloadUrl: (id: string, path: string, staged: boolean, fmt: "md" | "pdf") =>
    paths.download(paths.ideFileDiff(id, path, staged), fmt),
  ideCommitFileDownloadUrl: (id: string, sha: string, path: string, fmt: "md" | "pdf") =>
    paths.download(paths.ideCommitFile(id, sha, path), fmt),
  ideCompareFileDownloadUrl: (id: string, from: string, to: string, path: string, fmt: "md" | "pdf") =>
    paths.download(paths.ideCompareFile(id, from, to, path), fmt),
```

- [x] **Step 4: Jalankan test — harus lulus**

```bash
cd src && env -u NODE_ENV -u DATABASE_URL npx vitest run test/api-client.test.ts
```
Expected: PASS, termasuk **3 test baru**.

- [x] **Step 5: Commit**

```bash
git add src/src/api/client.ts src/test/api-client.test.ts
git commit -m "feat(spec-385): builder URL unduh untuk pratinjau review & diff"
```

---

### Task 4: Aksi Preview di Review (backlog + sesi PRD)

`ReviewScreen` dipakai dua kali: `kind="spec"` (backlog) dan `kind="session"` (sesi PRD). Satu perubahan menutup keduanya.

**Files:**
- Modify: `src/src/screens/ReviewScreen.tsx`
- Test: `src/test/review-screen.test.tsx`

**Interfaces:**
- Consumes: `DocPreviewModal`, `isMarkdownPath` (Task 1); `api.specReviewFileDownloadUrl`, `api.sessionReviewFileDownloadUrl` (Task 3).
- Produces: — (tak ada yang bergantung padanya)

- [x] **Step 1: Tulis test yang gagal**

Di `src/test/review-screen.test.tsx`, perluas `vi.mock` di puncak berkas menjadi:

```ts
vi.mock("../src/api/client", () => ({
  api: {
    specReview: vi.fn(), specReviewFile: vi.fn(),
    sessionReview: vi.fn(), sessionReviewFile: vi.fn(),
    specReviewFileDownloadUrl: (id: string, p: string, f: string) => `/api/specs/${id}/review/${p}?download=${f}`,
    sessionReviewFileDownloadUrl: (id: string, p: string, f: string) => `/api/terminal/sessions/${id}/review/${p}?download=${f}`,
  },
}));
```

lalu tambahkan `describe` baru di akhir berkas:

```tsx
// SPEC-385 · aksi Preview untuk .md — Review dulu hanya punya Diff|Source, jadi dokumen
// tampil sebagai teks mentah.
describe("ReviewScreen preview .md (SPEC-385)", () => {
  const mdReview = {
    base: "abc", files: ["docs/a.md"],
    changed: [{ path: "docs/a.md", add: 2, del: 0, status: "M", binary: false }],
  };
  const mdFile = {
    path: "docs/a.md", status: "M", binary: false, truncated: false,
    diff: "@@ -1 +1 @@\n+# Judul", content: "# Judul\n\nisi",
  };

  it("tombol Preview membuka modal berisi markdown terender", async () => {
    (api.specReview as any).mockResolvedValue(mdReview);
    (api.specReviewFile as any).mockResolvedValue(mdFile);
    render(<ReviewScreen specId="SPEC-385" title="X" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /preview/i }));
    expect(await screen.findByRole("heading", { name: "Judul" })).toBeInTheDocument();
  });

  it("modal menaut unduh .md/.pdf ke endpoint review backlog (ADR-0078)", async () => {
    (api.specReview as any).mockResolvedValue(mdReview);
    (api.specReviewFile as any).mockResolvedValue(mdFile);
    render(<ReviewScreen specId="SPEC-385" title="X" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /preview/i }));
    expect(await screen.findByRole("link", { name: /unduh \.md/i }))
      .toHaveAttribute("href", "/api/specs/SPEC-385/review/docs/a.md?download=md");
  });

  it("kind=session memakai endpoint review sesi", async () => {
    (api.sessionReview as any).mockResolvedValue(mdReview);
    (api.sessionReviewFile as any).mockResolvedValue(mdFile);
    render(<ReviewScreen specId="sess1" title="X" onBack={() => {}} kind="session" />);
    fireEvent.click(await screen.findByRole("button", { name: /preview/i }));
    expect(await screen.findByRole("link", { name: /unduh \.pdf/i }))
      .toHaveAttribute("href", "/api/terminal/sessions/sess1/review/docs/a.md?download=pdf");
  });

  it("berkas non-.md tak menawarkan Preview", async () => {
    (api.specReview as any).mockResolvedValue({
      base: "abc", files: ["src/a.ts"],
      changed: [{ path: "src/a.ts", add: 1, del: 0, status: "M", binary: false }],
    });
    (api.specReviewFile as any).mockResolvedValue({
      path: "src/a.ts", status: "M", binary: false, truncated: false, diff: "@@", content: "const x = 1",
    });
    render(<ReviewScreen specId="SPEC-385" title="X" onBack={() => {}} />);
    await screen.findByText("const x = 1".slice(0, 0) || "src/a.ts", { exact: false });
    expect(screen.queryByRole("button", { name: /preview/i })).toBeNull();
  });

  it("berkas .md yang DIHAPUS tak menawarkan Preview (tak ada isi)", async () => {
    (api.specReview as any).mockResolvedValue({
      base: "abc", files: ["docs/a.md"],
      changed: [{ path: "docs/a.md", add: 0, del: 3, status: "D", binary: false }],
    });
    (api.specReviewFile as any).mockResolvedValue({
      path: "docs/a.md", status: "D", binary: false, truncated: false, diff: "@@", content: null,
    });
    render(<ReviewScreen specId="SPEC-385" title="X" onBack={() => {}} />);
    await waitFor(() => expect(api.specReviewFile).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /preview/i })).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan test — harus gagal**

```bash
cd src && env -u NODE_ENV -u DATABASE_URL npx vitest run test/review-screen.test.tsx
```
Expected: FAIL pada tiga test pertama — `Unable to find an accessible element with the role "button" and name /preview/i`.

- [x] **Step 3: Implementasi di `ReviewScreen.tsx`**

Perluas impor DS di baris 4:

```tsx
import { Card, Badge, Button, Icon, StateBlock, DocPreviewModal, isMarkdownPath } from "../ds";
```

Tambahkan state tepat di bawah `const [chView, setChView] = React.useState<"list" | "tree">("list");`:

```tsx
  // SPEC-385 · pratinjau .md sebagai dokumen terbaca; pane ini berorientasi diff, jadi
  // preview-nya sebuah AKSI, bukan tab ketiga (Diff|Source tetap apa adanya).
  const [preview, setPreview] = React.useState(false);
  const canPreview = !!file && !file.binary && file.content !== null && isMarkdownPath(selected);
  const downloadUrl = kind === "session" ? api.sessionReviewFileDownloadUrl : api.specReviewFileDownloadUrl;
```

Tutup modal saat file berpindah — sisipkan `setPreview(false);` di efek pemuatan file, tepat setelah `setFile(null);`:

```tsx
    setFile(null); setPreview(false);
```

Sisipkan tombol di toolbar viewer, tepat SEBELUM grup toggle `diff | source` (setelah `<span style={{ flex: 1 }} />`):

```tsx
          {canPreview && (
            <Button size="sm" variant="secondary" leftIcon="book-open" onClick={() => setPreview(true)}>Preview</Button>
          )}
```

Render modalnya tepat sebelum `</div>` penutup komponen (setelah `</Card>` kedua):

```tsx
      {preview && canPreview && (
        <DocPreviewModal path={selected} text={file!.content ?? ""} eyebrow={specId}
          download={(f) => downloadUrl(specId, selected, f)} onClose={() => setPreview(false)} />
      )}
```

- [x] **Step 4: Jalankan test — harus lulus**

```bash
cd src && env -u NODE_ENV -u DATABASE_URL npx vitest run test/review-screen.test.tsx
```
Expected: PASS seluruh berkas (4 test lama + **5 test baru** = 9).

- [x] **Step 5: Commit**

```bash
git add src/src/screens/ReviewScreen.tsx src/test/review-screen.test.tsx
git commit -m "feat(spec-385): aksi Preview .md di Review (backlog & sesi PRD)"
```

---

### Task 5: Aksi Preview di IDE Explorer (mode file + mode diff)

**Files:**
- Modify: `src/src/screens/IdeScreen.tsx`
- Test: `src/test/ide-screen.test.tsx`

**Interfaces:**
- Consumes: `DocPreviewModal`, `isMarkdownPath` (Task 1); `api.ideFileDownloadUrl` (sudah ada), `api.ideFileDiffDownloadUrl` (Task 3).
- Produces: — (tak ada yang bergantung padanya)

- [x] **Step 1: Tulis test yang gagal**

Tambahkan `describe` baru di akhir `src/test/ide-screen.test.tsx`:

```tsx
// SPEC-385 · aksi Preview membuka .md di ruang baca lebar — di mode file (di samping toggle
// SPEC-240 yang tetap ada) DAN di pane diff, yang dulu hanya punya <pre> mentah.
describe("IdeScreen preview .md (SPEC-385)", () => {
  it("mode file: Preview membuka modal berisi markdown terender + unduh berkas itu", async () => {
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByText("README.md"));
    fireEvent.click(await screen.findByRole("button", { name: /^preview$/i }));
    expect(await screen.findByRole("heading", { name: "hi" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /unduh \.md/i }))
      .toHaveAttribute("href", "/api/projects/p1/file?path=README.md&download=md");
  });

  it("toggle inline Preview|Source SPEC-240 tetap ada", async () => {
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByText("README.md"));
    expect(await screen.findByText("Source")).toBeInTheDocument();
  });

  it("pane diff: Preview merender isi sesudah perubahan + unduh dari endpoint file-diff", async () => {
    vi.spyOn(api, "ideWorkingStatus").mockResolvedValue({
      branch: "main", staged: [],
      unstaged: [{ path: "docs/a.md", add: 2, del: 0, status: "M", binary: false }],
    });
    vi.spyOn(api, "ideFileDiff").mockResolvedValue({
      path: "docs/a.md", status: "M", binary: false, truncated: false,
      diff: "@@ -1 +1 @@\n+# Sesudah", content: "# Sesudah\n\nteks",
    });
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByText("docs/a.md"));
    await waitFor(() => expect(api.ideFileDiff).toHaveBeenCalledWith("p1", "docs/a.md", false));
    fireEvent.click(await screen.findByRole("button", { name: /^preview$/i }));
    expect(await screen.findByRole("heading", { name: "Sesudah" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /unduh \.pdf/i }))
      .toHaveAttribute("href", "/api/projects/p1/file-diff?path=docs%2Fa.md&download=pdf");
  });

  it("berkas non-.md tak menawarkan Preview di mode file", async () => {
    vi.spyOn(api, "ideFile").mockResolvedValue({ path: "src/a.ts", content: "const x = 1", binary: false, truncated: false });
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByText("src/"));
    fireEvent.click(await screen.findByText("a.ts"));
    await waitFor(() => expect(api.ideFile).toHaveBeenCalledWith("p1", "src/a.ts", ""));
    expect(screen.queryByRole("button", { name: /^preview$/i })).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan test — harus gagal**

```bash
cd src && env -u NODE_ENV -u DATABASE_URL npx vitest run test/ide-screen.test.tsx
```
Expected: FAIL pada test 1 & 3 — tombol `Preview` (role button) belum ada; yang ada hanya `<button>` teks "Preview" milik toggle SPEC-240, yang di test 3 tak muncul sama sekali karena pane diff tak punya toggle itu.

Catatan: toggle SPEC-240 memang merender `<button>Preview</button>`, jadi di mode file `getByRole("button", {name: /^preview$/i})` akan menemukan **dua** elemen setelah tombol baru ditambahkan. Karena itu Step 3 memberi tombol aksi label yang berbeda: **"Preview lebar"**. Sesuaikan test ke `/preview lebar/i` di Step 3 kalau bentrok.

- [x] **Step 3: Implementasi di `IdeScreen.tsx`**

Perluas impor DS di baris 6:

```tsx
import { Card, Button, Select, Icon, StateBlock, Tabs, Badge, DocDownload, DocPreviewModal, isMarkdownPath } from "../ds";
```

Hapus const lokal di baris 22-23 (`// SPEC-240 …` + `const isMarkdown = …`) dan ganti seluruh pemakaian `isMarkdown(` menjadi `isMarkdownPath(` (ada 2: baris ~274 dan ~315).

Tambahkan state tepat di bawah `const [showRemotes, setShowRemotes] = React.useState(false);`:

```tsx
  // SPEC-385 · ruang baca lebar untuk .md — di mode file toggle SPEC-240 tetap ada (preview
  // sempit di samping tree), di mode diff inilah satu-satunya cara membacanya terender.
  const [preview, setPreview] = React.useState(false);
```

Tutup modal saat seleksi berpindah — di efek `[selected, selKind, projectId, viewRef]`, sisipkan `setPreview(false);` tepat setelah `let alive = true;`:

```tsx
    let alive = true;
    setPreview(false);
```

Turunkan sumber preview tepat sebelum `const toolbar = (`:

```tsx
  // Sumber preview mengikuti pane yang aktif: mode file = isi berkas di ref yang dilihat,
  // mode diff = isi SESUDAH perubahan (bukan diff-nya). Unduhannya menunjuk endpoint yang sama.
  const previewSrc = inDiffSrc();
  function inDiffSrc() {
    const isDiff = selKind !== "file";
    const rf = isDiff ? diff : file;
    if (!rf || rf.binary || rf.content === null || !isMarkdownPath(selected)) return null;
    return {
      text: rf.content,
      download: isDiff
        ? (f: "md" | "pdf") => api.ideFileDiffDownloadUrl(projectId, selected, selKind === "staged", f)
        : (f: "md" | "pdf") => api.ideFileDownloadUrl(projectId, selected, viewRef, f),
    };
  }
```

> Catat: `const inDiff = selKind !== "file";` yang sudah ada di baris ~212 dideklarasikan SESUDAH blok ini, jadi jangan memakainya di sini — hitung ulang secara lokal seperti di atas.

Tambahkan tombol di **kedua** cabang toolbar viewer. Di cabang `inDiff` (grup `diff|source`), sisipkan sebelum `<div style={{ display: "flex", gap: 2, …`:

```tsx
              ? <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {previewSrc && (
                    <Button size="sm" variant="secondary" leftIcon="book-open"
                      onClick={() => setPreview(true)}>Preview lebar</Button>
                  )}
                  <div style={{ display: "flex", gap: 2, background: "var(--bone-100)", borderRadius: "var(--radius-pill)", padding: 2 }}>
```

(dan tutup `</div>` tambahan setelah grup toggle diff/source).

Di cabang `mode === "view"`, sisipkan tepat setelah grup toggle `Preview | Source` yang sudah ada dan sebelum `<DocDownload …>`:

```tsx
                      {previewSrc && (
                        <Button size="sm" variant="secondary" leftIcon="book-open"
                          onClick={() => setPreview(true)}>Preview lebar</Button>
                      )}
```

Render modalnya bersama dialog lain di akhir komponen, tepat sebelum `{showRemotes && …}`:

```tsx
      {preview && previewSrc && (
        <DocPreviewModal path={selected} text={previewSrc.text} eyebrow={viewRef || status?.branch || projectId}
          download={previewSrc.download} onClose={() => setPreview(false)} />
      )}
```

- [x] **Step 4: Selaraskan nama tombol di test**

Ubah ketiga query `/^preview$/i` di test Step 1 menjadi `/preview lebar/i` (dan yang `queryByRole` juga), agar tak bentrok dengan tombol toggle SPEC-240 yang berlabel "Preview".

- [x] **Step 5: Jalankan test — harus lulus**

```bash
cd src && env -u NODE_ENV -u DATABASE_URL npx vitest run test/ide-screen.test.tsx test/preview-fill-height.test.tsx test/doc-download-screens.test.tsx
```
Expected: PASS semua tiga berkas — `preview-fill-height` & `doc-download-screens` membuktikan perilaku SPEC-361/363 di IDE tak mundur.

- [x] **Step 6: Typecheck paket `src`**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src typecheck
```
Expected: exit 0.

- [x] **Step 7: Commit**

```bash
git add src/src/screens/IdeScreen.tsx src/test/ide-screen.test.tsx
git commit -m "feat(spec-385): aksi Preview .md di IDE Explorer (mode file & diff)"
```

---

### Task 6: Tab `preview` di modal berkas Git Graph

Permukaannya **sudah** modal, jadi aksinya berupa tab ketiga — modal bertumpuk adalah pola yang buruk dan Escape-nya jadi ambigu.

**Files:**
- Modify: `src/src/screens/GitGraph.tsx:177-182, 573-601`
- Test: `src/test/git-graph-view.test.tsx`

**Interfaces:**
- Consumes: `MarkdownView`, `isMarkdownPath` (Task 1); `api.ideCommitFileDownloadUrl`, `api.ideCompareFileDownloadUrl` (Task 3).
- Produces: — (tak ada yang bergantung padanya)

- [x] **Step 1: Tulis test yang gagal**

Tambahkan `describe` di akhir `src/test/git-graph-view.test.tsx`:

```tsx
// SPEC-385 · berkas .md di detail commit dulu hanya bisa dibaca sebagai <pre> mentah.
describe("GitGraph preview .md (SPEC-385)", () => {
  beforeEach(() => {
    vi.spyOn(api, "ideCommit").mockResolvedValue({ sha: "aaaa111", parents: ["bbbb222"], author: "t", at: "",
      subject: "kedua", body: "", changed: [{ path: "docs/a.md", add: 1, del: 0, status: "M", binary: false }],
      signed: false, committer: "t", committedAt: "", authorEmail: "t@t" });
    vi.spyOn(api, "ideCommitFile").mockResolvedValue({ path: "docs/a.md", status: "M", binary: false,
      truncated: false, diff: "@@ -1 +1 @@\n+# Judul", content: "# Judul\n\nisi" });
  });

  const openFile = async () => {
    render(<GitGraph projectId="p1" onRunGit={vi.fn()} onMerge={vi.fn()} onRebase={vi.fn()} onPull={vi.fn()} onDrop={vi.fn()} onOpenFile={vi.fn()} />);
    fireEvent.click(await screen.findByText("kedua"));
    fireEvent.click(await screen.findByText("docs/a.md"));
    await waitFor(() => expect(api.ideCommitFile).toHaveBeenCalledWith("p1", "aaaa111", "docs/a.md"));
  };

  it("tab preview merender markdown, bukan teks mentah", async () => {
    await openFile();
    fireEvent.click(await screen.findByText("preview"));
    expect(await screen.findByRole("heading", { name: "Judul" })).toBeInTheDocument();
  });

  it("modal berkas commit menaut unduh .md/.pdf (ADR-0078)", async () => {
    await openFile();
    expect(await screen.findByRole("link", { name: /unduh \.md/i }))
      .toHaveAttribute("href", "/api/projects/p1/commit/aaaa111/file?path=docs%2Fa.md&download=md");
  });

  it("berkas non-.md tak punya tab preview", async () => {
    vi.spyOn(api, "ideCommit").mockResolvedValue({ sha: "aaaa111", parents: [], author: "t", at: "",
      subject: "kedua", body: "", changed: [{ path: "src/a.ts", add: 1, del: 0, status: "M", binary: false }],
      signed: false, committer: "t", committedAt: "", authorEmail: "t@t" });
    vi.spyOn(api, "ideCommitFile").mockResolvedValue({ path: "src/a.ts", status: "M", binary: false,
      truncated: false, diff: "@@", content: "const x = 1" });
    render(<GitGraph projectId="p1" onRunGit={vi.fn()} onMerge={vi.fn()} onRebase={vi.fn()} onPull={vi.fn()} onDrop={vi.fn()} onOpenFile={vi.fn()} />);
    fireEvent.click(await screen.findByText("kedua"));
    fireEvent.click(await screen.findByText("src/a.ts"));
    await waitFor(() => expect(api.ideCommitFile).toHaveBeenCalled());
    expect(screen.queryByText("preview")).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan test — harus gagal**

```bash
cd src && env -u NODE_ENV -u DATABASE_URL npx vitest run test/git-graph-view.test.tsx
```
Expected: FAIL — tak ada teks "preview" dan tak ada tautan unduh di modal berkas commit.

- [x] **Step 3: Implementasi di `GitGraph.tsx`**

Perluas impor DS (baris ~4, blok `from "../ds"`) dengan `DocDownload`, `MarkdownView`, `isMarkdownPath`.

Longgarkan tipe state di baris 177:

```tsx
  const [fileDiff, setFileDiff] = React.useState<{ path: string; sha: string; from?: string; data: ReviewFile | null; tab: "diff" | "source" | "preview" } | null>(null);
```

Di dalam blok render modal (baris ~573), ganti grup tab + isi. Grup tab menjadi:

```tsx
              {(isMarkdownPath(fileDiff.path)
                ? (["diff", "source", "preview"] as const)
                : (["diff", "source"] as const)
              ).map((t) => (
                <button key={t} onClick={() => setFileDiff((s) => (s ? { ...s, tab: t } : s))} style={{ padding: "4px 12px", border: "none",
                  cursor: "pointer", borderRadius: "var(--radius-pill)", fontSize: 12, textTransform: "capitalize",
                  background: fileDiff.tab === t ? "var(--surface-card)" : "transparent",
                  color: fileDiff.tab === t ? "var(--text-strong)" : "var(--text-muted)", fontWeight: fileDiff.tab === t ? 600 : 400 }}>{t}</button>
              ))}
```

Sisipkan tombol unduh tepat setelah `</div>` penutup grup tab, sebelum tombol Tutup:

```tsx
              {/* SPEC-385 · ADR-0078 · pratinjau baru wajib bisa dibawa pergi sebagai .md/.pdf */}
              {isMarkdownPath(fileDiff.path) && !fileDiff.data?.binary && fileDiff.data?.content != null && (
                <DocDownload href={(f) => (fileDiff.from
                  ? api.ideCompareFileDownloadUrl(projectId, fileDiff.from, fileDiff.sha, fileDiff.path, f)
                  : api.ideCommitFileDownloadUrl(projectId, fileDiff.sha, fileDiff.path, f))} />
              )}
```

Tambahkan cabang render sebelum cabang `<pre>` terakhir:

```tsx
                : fileDiff.tab === "preview"
                  ? <div style={{ padding: "0 16px" }}>
                      <MarkdownView text={fileDiff.data.content ?? ""} name={fileDiff.path} />
                    </div>
```

- [x] **Step 4: Jalankan test — harus lulus**

```bash
cd src && env -u NODE_ENV -u DATABASE_URL npx vitest run test/git-graph-view.test.tsx test/git-graph-render.test.tsx
```
Expected: PASS kedua berkas (test lama + **3 test baru**).

- [x] **Step 5: Typecheck paket `src`**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src typecheck
```
Expected: exit 0.

- [x] **Step 6: Commit**

```bash
git add src/src/screens/GitGraph.tsx src/test/git-graph-view.test.tsx
git commit -m "feat(spec-385): tab preview .md di modal berkas Git Graph"
```

---

### Task 7: Docs Source of Truth + verifikasi akhir (test tersentuh + smoke endpoint)

**Files:**
- Modify: `internal/docs/architecture/api-contract.md`
- Modify: `internal/docs/frontend/frontend-implementation.md`
- Modify: `internal/skills/hanoman/SKILL.md`
- Modify: `internal/docs/README.md` (index — tautan/keterangan SPEC-385)

**Interfaces:**
- Consumes: seluruh perilaku dari Task 1-6.
- Produces: — (fase terakhir)

- [x] **Step 1: Perbarui `internal/docs/architecture/api-contract.md`**

Cari bagian yang mendokumentasikan `?download=` (SPEC-361/ADR-0078) dan endpoint review/IDE. Tambahkan kelima endpoint baru ke daftar yang menerima `?download=md|pdf`, dengan aturan eksplisit:

- `GET /api/specs/:id/review/<path>?download=md|pdf`
- `GET /api/terminal/sessions/:id/review/<path>?download=md|pdf`
- `GET /api/projects/:id/file-diff?path=…[&staged=1]&download=md|pdf`
- `GET /api/projects/:id/commit/:sha/file?path=…&download=md|pdf`
- `GET /api/projects/:id/compare/file?from=…&to=…&path=…&download=md|pdf`

Aturan yang harus tertulis: isi yang dikirim = `ReviewFile.content` (isi **sesudah** perubahan, sama dengan yang dirender pratinjau); berkas biner atau `content === null` → **404**; `download` absen/tak dikenal → JSON `ReviewFile` lama **utuh**; tak ada endpoint ekspor baru.

- [x] **Step 2: Perbarui `internal/docs/frontend/frontend-implementation.md`**

Tambahkan entri untuk `ds/DocPreviewModal.tsx` dan `isMarkdownPath`: satu komponen pratinjau dokumen dipakai `ReviewScreen` + `IdeScreen`; Git Graph memakai **tab** karena permukaannya sudah modal (hindari modal bertumpuk); toggle inline `Preview | Source` SPEC-240 di IDE mode file **tetap ada**; gerbang seragam `.md` + non-biner + `content !== null`; tinggi diwarisi lewat `Modal fillHeight` (SPEC-363) — jangan menambah px/vh.

- [x] **Step 3: Perbarui `internal/skills/hanoman/SKILL.md`**

Di bagian "Aturan Dokumentasi & Alur", tepat setelah butir SPEC-363, tambahkan butir SPEC-385 yang memuat: empat permukaan yang mendapat aksi preview, keputusan tab-vs-modal di Git Graph, parity unduh lewat query di lima endpoint yang sudah ada (tanpa endpoint/skema/ADR baru), dan gerbang `.md` + non-biner + `content !== null`.

- [x] **Step 4: Perbarui index `internal/docs/README.md`**

Pastikan doc yang tersentuh tetap ter-link dan tambahkan keterangan SPEC-385 pada baris ADR-0078 (bahwa cakupan `?download=` kini termasuk endpoint review/diff).

- [x] **Step 5: Jalankan SELURUH test yang tersentuh perubahan**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism
```
Expected: PASS. **Verifikasi jumlah berkas test yang benar-benar berjalan** — harus mencakup minimal `doc-preview-modal`, `api-client`, `review-screen`, `ide-screen`, `git-graph-view`, `preview-fill-height`, `doc-download-screens`, `review-download.route`, `ide.route`, `doc-download.route`. Kalau vitest melaporkan "no test files", perintahnya salah — jangan terima sebagai hijau.

Kalau `sync-ws.test.ts` gagal: ia **non-deterministik** (SPEC-376). Ulangi set yang sama sebelum menyalahkan perubahan ini.

- [x] **Step 6: Typecheck kedua paket yang tersentuh**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src typecheck
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server typecheck
```
Expected: exit 0 keduanya. **Jangan** `pnpm -r typecheck`.

- [x] **Step 7: Smoke nyata endpoint (sekali, di akhir)**

Task ini menyentuh endpoint, jadi wajib satu smoke sungguhan. Pakai DB sekali-pakai (bukan `hanoman_test` — sesi tetangga men-truncate-nya di tengah jalan) dan port bukan 8787.

```bash
# 1. DB sekali-pakai + migrate
docker exec hanoman-db-1 psql -U hanoman -d postgres -c 'CREATE DATABASE hanoman385_smoke;'
export SMOKE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman385_smoke'
env -u NODE_ENV DATABASE_URL="$SMOKE_URL" npx prisma migrate deploy --schema server/prisma/schema.prisma

# 2. boot server di port lain
env -u NODE_ENV DATABASE_URL="$SMOKE_URL" PORT=8799 node server/dist/server.js &

# 3. buat project+spec berisi worktree, lalu curl kelima endpoint dengan & tanpa ?download=
```

Yang harus dibuktikan untuk **setiap** endpoint:
1. tanpa query → JSON `ReviewFile` (ada field `binary`, `diff`, `content`);
2. `?download=md` → header `content-disposition: attachment; …` + body **identik** dengan `content` pada (1);
3. `?download=pdf` → berkas PDF yang **isinya memuat teks dokumen** — ekstrak teksnya (mis. `pdftotext` atau cek `Tj` stream), jangan berhenti di `%PDF-`. pdfkit gagal **senyap** (mojibake WinAnsi, SPEC-361), jadi magic bytes bukan bukti.

Bersihkan sesudahnya: `kill %1` dan `docker exec hanoman-db-1 psql -U hanoman -d postgres -c 'DROP DATABASE hanoman385_smoke;'`.

- [x] **Step 8: Commit docs + hasil verifikasi**

```bash
git add internal/docs internal/skills docs/superpowers/plans
git commit -m "docs(spec-385): kontrak ?download= endpoint review/diff + DocPreviewModal di SoT"
```

- [x] **Step 9: Push**

```bash
git push origin HEAD:refs/heads/hanoman/spec-385
```

---

## Self-Review

**Spec coverage** — setiap bagian design terpetakan:

| Bagian spec | Task |
| --- | --- |
| `DocPreviewModal` (§1) | Task 1 |
| Aksi IDE mode file (§2.1) | Task 5 |
| Aksi IDE mode diff (§2.2) | Task 5 |
| Tab Git Graph (§2.3) | Task 6 |
| Aksi Review, backlog + sesi PRD (§2.4) | Task 4 |
| Parity unduh, 5 endpoint (§3) | Task 2 (server) + Task 3 (klien) |
| Docs SoT tersentuh | Task 7 |
| Rencana verifikasi (test tersentuh, typecheck per paket, smoke endpoint) | Task 7 Step 5-7 |

**Type consistency** — `isMarkdownPath` dipakai dengan nama yang sama di Task 1/4/5/6; `sendReviewDownload` dengan tanda tangan yang sama di lima call site Task 2; kelima builder URL di Task 3 dipanggil persis dengan urutan argumen yang dideklarasikan (`ideFileDiffDownloadUrl(id, path, staged, fmt)` — `staged` sebelum `fmt`).

**Risiko yang sudah dijaga:**
- Bentrok label tombol "Preview" dengan toggle SPEC-240 → tombol aksi diberi label "Preview lebar" (Task 5 Step 4).
- `const inDiff` di `IdeScreen` dideklarasikan setelah blok `previewSrc` → dihitung ulang lokal (Task 5 Step 3).
- `vi.mock` di `review-screen.test.tsx` mengganti seluruh modul → mock harus ditambah fungsi baru (Task 4 Step 1).
- Test PDF yang lulus palsu → Task 7 Step 7 menuntut ekstraksi teks, bukan magic bytes.

---

## Hasil verifikasi (2026-07-29)

**Test tersentuh** — `pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism`:
**129 berkas / 874 test, 0 gagal**. Bukan "no test files" — daftar berkas yang benar-benar berjalan
diperiksa dari laporan JSON dan memuat seluruh berkas yang direncanakan (`doc-preview-modal`,
`api-client`, `review-screen`, `ide-screen`, `git-graph-view`, `preview-fill-height`,
`doc-download-screens`, `review-download.route`, `ide.route`, `doc-download.route`,
`spec-docs.route`, tiga berkas `terminal*`). 129 berkas memang mendekati seluruh paket `src`:
`ds/index.ts` diimpor hampir semua layar, jadi itulah blast radius sebenarnya (ADR-0080).

**Typecheck** — `pnpm --filter ./src typecheck` dan `pnpm --filter ./server typecheck`: keduanya
exit 0. `pnpm -r typecheck` sengaja tak dijalankan.

**Smoke endpoint nyata** — server `node server/dist/server.js` di `PORT=8799` dengan DB sekali-pakai
`hanoman385_smoke` (dibuat + `migrate deploy`, di-`DROP` sesudahnya) dan tmux socket terpisah
`hanoman-smoke385`; repo uji ber-worktree `.worktrees/spec-141` + perubahan working tree. Empat
endpoint diuji lewat `curl` sungguhan — `/specs/:id/review/*`, `/projects/:id/file-diff`,
`/projects/:id/commit/:sha/file`, `/projects/:id/compare/file` — masing-masing tiga hal:

1. tanpa query → JSON `ReviewFile` (`binary`/`diff`/`content` ada) — bentuk lama utuh;
2. `?download=md` → `content-disposition: attachment; filename="<prefix>-catatan.md"` dan badan
   `cmp`-identik dengan `content` pada (1);
3. `?download=pdf` → `%PDF-` **dan** teks yang diekstrak `pdftotext` benar-benar memuat isi
   dokumen (judul, paragraf, tabel), bukan sekadar magic bytes. Prefix nama berkas terbukti
   sesuai kontrak: `SPEC-141-catatan.md`, `smoke-catatan.md`, `smoke-f6465b86-catatan.md`.
   Panah `→` tercetak `->` — `toWinAnsi()` bekerja, tak ada mojibake senyap (jebakan SPEC-361).

Endpoint kelima `/terminal/sessions/:id/review/*` butuh sesi hidup ber-worktree; ia diuji lewat
`app.inject` sungguhan di `review-download.route.test.ts` dengan sesi yang dibuat langsung dari
service ber-`command: ["/bin/sleep","30"]` (pola `terminal.route.test.ts`) — **tak pernah** men-spawn
agen sungguhan dari test. Test yang sama juga mengunci aturan **berkas dihapus**: JSON tetap 200
(diff-nya masih berguna) tapi `?download=` → 404, karena PDF dari string kosong tampak sah padahal
isinya bohong.
