# Preview Docs in IDE (SPEC-240) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Di IDE Explorer, tampilkan berkas `.md` sebagai preview terender secara default, dengan toggle Preview | Source di samping tombol Edit.

**Architecture:** Perubahan frontend murni pada `src/src/screens/IdeScreen.tsx`. Tambah state lokal `mdView` ("preview" | "source", default "preview") yang hanya aktif saat mode view + file `.md`. Preview memakai `MarkdownView` (renderer marked bersama, `ds/markdown.tsx`); Source memakai `<pre><code class="hljs">` highlight.js yang sudah ada. Toggle memakai pola pill yang sama dengan toggle Diff|Source yang sudah ada di file. Tanpa perubahan server/API/skema.

**Tech Stack:** React + TypeScript (Vite), highlight.js, marked (via `MarkdownView`), vitest + @testing-library/react.

## Global Constraints

- TypeScript strict — tak ada `any` baru, tak ada unused var.
- Tak menambah dependency (marked & highlight.js sudah terpasang).
- Renderer preview = `MarkdownView` dari `src/src/ds/markdown.tsx` (jangan tulis renderer baru).
- File non-`.md`: perilaku view lama utuh (highlighted source + Edit, tanpa toggle).
- Test dijalankan dari root: `env -u NODE_ENV -u DATABASE_URL pnpm --dir src test -- --run ide-screen` (atau `pnpm --dir src vitest run test/ide-screen.test.tsx`).
- Deteksi markdown: `/\.md$/i.test(path)`.

---

### Task 1: `.md` preview default + toggle Preview | Source di IDE Explorer

**Files:**
- Modify: `src/src/screens/IdeScreen.tsx`
- Test: `src/test/ide-screen.test.tsx`

**Interfaces:**
- Consumes: `MarkdownView` dari `../ds/markdown` (`{ text: string; name: string } => JSX`); `api.ideFile(id, path, ref) => Promise<RepoFile>` di mana `RepoFile = { path; content: string|null; binary; truncated }`.
- Produces: perilaku UI baru (tak ada API baru). State internal `mdView: "preview" | "source"`, helper `isMarkdown(path: string): boolean`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan blok berikut ke akhir `src/test/ide-screen.test.tsx` (import `MarkdownView` tak diperlukan — kita assert lewat DOM):

```tsx
// SPEC-240 · .md default preview + toggle Preview | Source
describe("IdeScreen preview .md (SPEC-240)", () => {
  it("memilih .md → render preview (.hn-md), bukan raw source", async () => {
    vi.spyOn(api, "ideFile").mockResolvedValue({ path: "README.md", content: "# Judul Preview", binary: false, truncated: false });
    const { container } = render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByText("README.md"));
    // preview terender: heading <h1> di dalam wrapper .hn-md
    await waitFor(() => {
      const md = container.querySelector(".hn-md");
      expect(md).not.toBeNull();
      expect(md!.querySelector("h1")?.textContent).toBe("Judul Preview");
    });
    // toggle Preview | Source hadir
    expect(screen.getByRole("button", { name: /^Source$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Preview$/i })).toBeInTheDocument();
  });

  it("toggle Source → raw source; balik Preview → terender", async () => {
    vi.spyOn(api, "ideFile").mockResolvedValue({ path: "README.md", content: "# Judul Preview", binary: false, truncated: false });
    const { container } = render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByText("README.md"));
    await screen.findByRole("button", { name: /^Source$/i });
    fireEvent.click(screen.getByRole("button", { name: /^Source$/i }));
    // source: <code class="hljs"> muncul, wrapper .hn-md hilang
    await waitFor(() => {
      expect(container.querySelector("code.hljs")).not.toBeNull();
      expect(container.querySelector(".hn-md")).toBeNull();
    });
    fireEvent.click(screen.getByRole("button", { name: /^Preview$/i }));
    await waitFor(() => expect(container.querySelector(".hn-md")).not.toBeNull());
  });

  it("file non-.md → tak ada toggle Preview|Source, source tampil", async () => {
    vi.spyOn(api, "ideFile").mockResolvedValue({ path: "src/a.ts", content: "const x = 1;", binary: false, truncated: false });
    const { container } = render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByText("src/")); // buka folder
    fireEvent.click(await screen.findByText("a.ts"));
    await waitFor(() => expect(container.querySelector("code.hljs")).not.toBeNull());
    expect(screen.queryByRole("button", { name: /^Preview$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Source$/i })).toBeNull();
    expect(container.querySelector(".hn-md")).toBeNull();
  });

  it("edit .md → Simpan → kembali ke preview", async () => {
    vi.spyOn(api, "ideFile").mockResolvedValue({ path: "README.md", content: "# Judul Preview", binary: false, truncated: false });
    vi.spyOn(api, "putIdeFile").mockResolvedValue({ path: "README.md", content: "# Judul Baru" });
    vi.spyOn(api, "ideWorkingStatus").mockResolvedValue({ branch: "main", staged: [], unstaged: [] });
    const { container } = render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByText("README.md"));
    fireEvent.click(await screen.findByRole("button", { name: /^Edit$/i }));
    const ta = await screen.findByRole("textbox");
    fireEvent.change(ta, { target: { value: "# Judul Baru" } });
    fireEvent.click(screen.getByRole("button", { name: /simpan/i }));
    await waitFor(() => {
      const md = container.querySelector(".hn-md");
      expect(md).not.toBeNull();
      expect(md!.querySelector("h1")?.textContent).toBe("Judul Baru");
    });
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL pnpm vitest run test/ide-screen.test.tsx`
Expected: FAIL — keempat test baru gagal (`.hn-md` tak ada karena `.md` masih dirender sebagai raw `<code class="hljs">`; tombol `Preview`/`Source` belum ada).

- [x] **Step 3: Implementasi — helper + state + reset**

Di `src/src/screens/IdeScreen.tsx`:

1. Tambah import `MarkdownView` di baris import DS/screens (dekat import `DiffView`):

```tsx
import { MarkdownView } from "../ds/markdown";
```

2. Tambah helper `isMarkdown` di dekat `langOf` (atas file, sebelum `ForceDialog`):

```tsx
const isMarkdown = (p: string): boolean => /\.md$/i.test(p);
```

3. Tambah state `mdView` di samping state `mode`/`draft` (setelah baris `const [draft, setDraft] = React.useState("");`):

```tsx
const [mdView, setMdView] = React.useState<"preview" | "source">("preview"); // SPEC-240 · .md preview vs source
```

4. Reset `mdView` ke `"preview"` saat file baru dimuat. Di efek load file, cabang `selKind === "file"`, ubah callback `.then` agar ikut mereset `mdView`:

Ganti:
```tsx
      api.ideFile(projectId, selected, viewRef).then((f) => { if (alive) { setFile(f); setMode("view"); } })
```
menjadi:
```tsx
      api.ideFile(projectId, selected, viewRef).then((f) => { if (alive) { setFile(f); setMode("view"); setMdView("preview"); } })
```

- [x] **Step 4: Implementasi — toggle di header + render body**

Di `src/src/screens/IdeScreen.tsx`, pane kanan cabang `!inDiff`.

1. Header — cabang `mode === "view"`. Ganti blok:

```tsx
                : mode === "view"
                  ? <Button size="sm" variant="secondary" leftIcon="pencil" onClick={startEdit}
                      disabled={!file || file.binary}>Edit</Button>
```
menjadi (toggle Preview|Source hanya untuk `.md`, sebelum Edit):
```tsx
                : mode === "view"
                  ? <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {file && !file.binary && isMarkdown(selected) && (
                        <div style={{ display: "flex", gap: 2, background: "var(--bone-100)", borderRadius: "var(--radius-pill)", padding: 2 }}>
                          {(["preview", "source"] as const).map((t) => (
                            <button key={t} onClick={() => setMdView(t)} style={{
                              padding: "4px 12px", border: "none", cursor: "pointer", borderRadius: "var(--radius-pill)",
                              fontSize: 12, textTransform: "capitalize",
                              background: mdView === t ? "var(--surface-card)" : "transparent",
                              color: mdView === t ? "var(--text-strong)" : "var(--text-muted)", fontWeight: mdView === t ? 600 : 400,
                            }}>{t === "preview" ? "Preview" : "Source"}</button>
                          ))}
                        </div>
                      )}
                      <Button size="sm" variant="secondary" leftIcon="pencil" onClick={startEdit}
                        disabled={!file || file.binary}>Edit</Button>
                    </div>
```

2. Body — cabang `!inDiff`, sub-cabang `mode === "edit" ? <textarea…> : <pre…highlighted…>`. Ganti cabang view (yang menampilkan `<pre>…<code className="hljs">`) agar `.md` dalam mode preview memakai `MarkdownView`:

Ganti:
```tsx
                      : <pre style={{ margin: 0, padding: "16px 18px", overflow: "auto" }}>
                          <code className="hljs" style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.7 }}
                            dangerouslySetInnerHTML={{ __html: highlighted }} />
                        </pre>)}
```
menjadi:
```tsx
                      : isMarkdown(selected) && mdView === "preview"
                        ? <div style={{ padding: "16px 20px" }}><MarkdownView text={file.content ?? ""} name={selected} /></div>
                        : <pre style={{ margin: 0, padding: "16px 18px", overflow: "auto" }}>
                            <code className="hljs" style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.7 }}
                              dangerouslySetInnerHTML={{ __html: highlighted }} />
                          </pre>)}
```

- [x] **Step 5: Jalankan test, pastikan lulus**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL pnpm vitest run test/ide-screen.test.tsx`
Expected: PASS — semua test di file (lama + 4 baru) hijau.

- [x] **Step 6: Typecheck**

Run: `cd src && pnpm tsc --noEmit` (atau skrip typecheck project bila ada)
Expected: tanpa error.

- [x] **Step 7: Perbarui docs SoT**

Di `internal/docs/frontend/frontend-implementation.md`, section **IDE Visual (SPEC-182 · ADR-0034)**, pada bullet Explorer yang menjelaskan pane kanan (`api.ideFile … Preview = <pre><code class="hljs"> …`), tambahkan catatan SPEC-240: untuk `.md`, pane kanan **default preview terender** (`MarkdownView`/`.hn-md`, renderer bersama Docs·SoT) dengan toggle **Preview | Source** di samping Edit; file non-`.md` tetap highlighted source. Index `internal/docs/README.md` sudah men-link frontend-implementation (tak perlu link baru).

- [x] **Step 8: Verifikasi nyata di local**

Boot server + frontend, buka **IDE → Explorer**, pilih project, klik `README.md`:
- default menampilkan preview terender (heading/list ter-styling `.hn-md`);
- toggle **Source** → raw markdown (highlighted); **Preview** → terender lagi;
- klik file `.ts` → tak ada toggle, source highlighted;
- **Edit** `.md` → ubah → **Simpan** → kembali ke preview terender.

- [x] **Step 9: Commit**

```bash
git add src/src/screens/IdeScreen.tsx src/test/ide-screen.test.tsx internal/docs/frontend/frontend-implementation.md
git commit -m "feat(spec-240): preview .md default di IDE Explorer + toggle Preview/Source"
```

---

## Self-Review

**Spec coverage:**
- Default preview `.md` → Step 3 (reset `mdView="preview"`) + Step 4 body render. ✓
- Toggle Preview | Source di samping Edit → Step 4 header. ✓
- Source raw untuk `.md` → Step 4 (cabang non-preview = highlighted source). ✓
- Non-`.md` perilaku lama → Step 4 (`isMarkdown` guard), diuji Step 1 test #3. ✓
- Edit → Simpan → preview → diuji Step 1 test #4. ✓
- Docs tersentuh diperbarui → Step 7. ✓

**Placeholder scan:** tak ada TBD/TODO; semua kode ditunjukkan penuh. ✓

**Type consistency:** `mdView: "preview" | "source"`, `setMdView`, `isMarkdown(p: string): boolean`, `MarkdownView({ text, name })` konsisten di semua step. `file.content` bertipe `string | null` → dipakai `file.content ?? ""` saat memanggil `MarkdownView`. ✓
