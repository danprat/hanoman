# Review Collapse & File Changed Tree — Implementation Plan (SPEC-177)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Buka layar Review dengan semua folder collapsed, dan beri section "Changed" toggle List | Tree agar file changed bisa dilihat dalam rantai folder induknya.

**Architecture:** Perubahan tunggal di `src/src/screens/ReviewScreen.tsx`. `TreeRow` diperluas dengan dua prop opsional (`defaultOpen`, `meta`) — folder default collapsed, leaf bisa membawa status `A/M/D` + `+/−`. Section "Changed" dapat state view `"list" | "tree"`; mode tree me-reuse `buildFileTree` atas path changed.

**Tech Stack:** React 18 + TypeScript (Vite), lucide-react icons, Vitest + @testing-library/react.

## Global Constraints

- TypeScript strict. Read-only UI, tanpa perubahan skema/endpoint/migration → tanpa ADR.
- Reuse `buildFileTree` + `TreeRow` yang ada; jangan bikin komponen tree baru.
- Test repo frontend jalan dari `src/`: `pnpm vitest run test/review-screen.test.tsx`.
- Perbarui docs tersentuh dalam commit yang sama (objective + design + index sudah ada dari fase Spec; tambah catatan di `frontend-implementation.md`).

---

### Task 1: TreeRow default collapsed + prop `defaultOpen`/`meta`

Fix bug "beberapa folder sudah expande" dan siapkan `TreeRow` untuk dipakai tree Changed.

**Files:**
- Modify: `src/src/screens/ReviewScreen.tsx` (fungsi `TreeRow`, ~baris 31-62)
- Test: `src/test/review-screen.test.tsx`

**Interfaces:**
- Consumes: `FileNode`, `ChangedFile`, `ST_COLOR` (sudah ada di file).
- Produces: `TreeRow` dengan signature baru:
  `TreeRow({ node, selected, onSelect, depth?, meta?, defaultOpen? })` di mana
  `meta?: Record<string, ChangedFile>` dan `defaultOpen?: boolean` (default `false`).

- [x] **Step 1: Tulis test gagal — Files tree collapsed saat pertama dibuka**

Tambah di `src/test/review-screen.test.tsx` dalam `describe`:

```tsx
it("Files tree collapsed saat pertama dibuka (folder src/ tertutup)", async () => {
  (api.specReview as any).mockResolvedValue({
    base: "abc", files: ["src/a.ts", "src/b.ts"],
    changed: [{ path: "src/a.ts", add: 3, del: 1, status: "M", binary: false }],
  });
  render(<ReviewScreen specId="SPEC-177" title="X" onBack={() => {}} />);
  // Header folder "src/" muncul di section Files…
  await waitFor(() => expect(screen.getByText("src/")).toBeInTheDocument());
  // …tapi isi folder (b.ts) TIDAK tampil karena collapsed. a.ts tetap tampil di Changed.
  expect(screen.queryByText("b.ts")).toBeNull();
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `cd src && pnpm vitest run test/review-screen.test.tsx -t "collapsed saat pertama"`
Expected: FAIL — `b.ts` tampil karena folder `src/` default open (`depth < 1`).

- [x] **Step 3: Ubah initial open state jadi collapsed + tambah prop**

Di `src/src/screens/ReviewScreen.tsx`, ganti signature dan body `TreeRow`:

```tsx
function TreeRow({ node, selected, onSelect, depth = 0, meta, defaultOpen = false }:
  { node: FileNode; selected: string; onSelect: (p: string) => void; depth?: number;
    meta?: Record<string, ChangedFile>; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  if (node.leaf) {
    const on = node.path === selected;
    const cf = meta?.[node.path];
    return (
      <button onClick={() => onSelect(node.path)} style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%",
        padding: "5px 8px", paddingLeft: 22 + depth * 12, border: "none", cursor: "pointer",
        textAlign: "left", background: on ? "var(--brass-100)" : "transparent",
      }}>
        {cf
          ? <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: ST_COLOR[cf.status] }}>{cf.status}</span>
          : <Icon name="file-text" size={13} color={on ? "var(--brass-700)" : "var(--text-subtle)"} />}
        <span style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-mono)", fontSize: 12,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          color: on ? "var(--brass-700)" : "var(--text-body)", fontWeight: on ? 600 : 400 }}>{node.name}</span>
        {cf && !cf.binary && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
          <span style={{ color: "var(--leaf-600)" }}>+{cf.add}</span>{" "}
          <span style={{ color: "var(--clay-500)" }}>−{cf.del}</span>
        </span>}
      </button>
    );
  }
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%",
        padding: "5px 6px", paddingLeft: 6 + depth * 12, border: "none",
        background: "transparent", cursor: "pointer", textAlign: "left",
      }}>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={14} color="var(--text-subtle)" />
        <Icon name="folder" size={15} color="var(--brass-500)" />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-strong)", fontWeight: 500 }}>{node.name}/</span>
      </button>
      {open && node.kids.map((k) => <TreeRow key={k.path} node={k} selected={selected} onSelect={onSelect} depth={depth + 1} meta={meta} defaultOpen={defaultOpen} />)}
    </div>
  );
}
```

Catatan: `defaultOpen` diteruskan ke anak supaya sub-tree ikut terbuka saat dipakai tree Changed. Files tree tak passing `defaultOpen` → semua collapsed.

- [x] **Step 4: Jalankan test, pastikan hijau**

Run: `cd src && pnpm vitest run test/review-screen.test.tsx`
Expected: PASS semua (test baru + 2 test existing).

- [x] **Step 5: Commit**

```bash
git add src/src/screens/ReviewScreen.tsx src/test/review-screen.test.tsx
git commit -m "fix(spec-177): review Files tree collapsed default + TreeRow meta/defaultOpen"
```

---

### Task 2: Section "Changed" — toggle List | Tree

**Files:**
- Modify: `src/src/screens/ReviewScreen.tsx` (body `ReviewScreen`, header "Changed · N" ~baris 133 + render list ~baris 134-154)
- Test: `src/test/review-screen.test.tsx`
- Modify (docs): `internal/docs/frontend/frontend-implementation.md`

**Interfaces:**
- Consumes: `TreeRow` (dari Task 1) dengan prop `meta` + `defaultOpen`; `buildFileTree(paths)`.
- Produces: state UI `chView: "list" | "tree"` (lokal, tak diekspor).

- [x] **Step 1: Tulis test gagal — toggle Tree menampilkan folder induk file changed**

Tambah di `src/test/review-screen.test.tsx`:

```tsx
it("toggle Changed → Tree menampilkan folder induk file changed", async () => {
  (api.specReview as any).mockResolvedValue({
    base: "abc", files: ["src/a.ts"],
    changed: [{ path: "src/deep/a.ts", add: 3, del: 1, status: "M", binary: false }],
  });
  render(<ReviewScreen specId="SPEC-177" title="X" onBack={() => {}} />);
  // Klik tombol Tree di section Changed
  fireEvent.click(await screen.findByLabelText("Tree changed"));
  // Rantai folder induk tampil + file changed di bawahnya
  await waitFor(() => expect(screen.getByText("src/")).toBeInTheDocument());
  expect(screen.getByText("deep/")).toBeInTheDocument();
  expect(screen.getByText("a.ts")).toBeInTheDocument();
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `cd src && pnpm vitest run test/review-screen.test.tsx -t "toggle Changed"`
Expected: FAIL — tombol `Tree changed` belum ada (`findByLabelText` timeout).

- [x] **Step 3: Tambah state + toggle + render tree**

Di `ReviewScreen`, tambah state (dekat state lain, ~baris 89):

```tsx
const [chView, setChView] = React.useState<"list" | "tree">("list");
```

Tambah memo tree changed (dekat `const tree = ...`, ~baris 117):

```tsx
const changedTree = React.useMemo(() => buildFileTree(changed.map((c) => c.path)), [changed]);
const changedMeta = React.useMemo(
  () => Object.fromEntries(changed.map((c) => [c.path, c])) as Record<string, ChangedFile>, [changed]);
```

Catatan: pindahkan `const changed = review?.changed ?? []` ke ATAS baris memo (sebelum `if (state === "loading")` early returns) supaya memo boleh membacanya — hooks tak boleh setelah early return. Jadi urutannya: semua `useState`/`useEffect`/`useMemo` dulu (termasuk `changed`, `changedTree`, `changedMeta`), baru early return state.

Ganti header "Changed · N" (baris 133) jadi header + toggle:

```tsx
<div className="hn-eyebrow" style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px" }}>
  <span style={{ flex: 1 }}>Changed · {changed.length}</span>
  {changed.length > 0 && (["list", "tree"] as const).map((v) => (
    <button key={v} aria-label={v === "list" ? "List changed" : "Tree changed"} onClick={() => setChView(v)}
      style={{ display: "flex", padding: 3, border: "none", cursor: "pointer", borderRadius: 4,
        background: chView === v ? "var(--brass-100)" : "transparent" }}>
      <Icon name={v === "list" ? "list" : "folder-tree"} size={14}
        color={chView === v ? "var(--brass-700)" : "var(--text-subtle)"} />
    </button>
  ))}
</div>
```

Bungkus render changed (baris 134-154) dengan cabang `chView`:

```tsx
{changed.length === 0
  ? <div style={{ padding: "4px 10px", fontSize: 12, color: "var(--text-subtle)" }}>Tak ada file berubah.</div>
  : chView === "tree"
    ? changedTree.map((n) => <TreeRow key={n.path} node={n} selected={selected} onSelect={setSelected} meta={changedMeta} defaultOpen />)
    : changed.map((c: ChangedFile) => {
        /* …render flat list existing, tak berubah… */
      })}
```

- [x] **Step 4: Jalankan test, pastikan hijau**

Run: `cd src && pnpm vitest run test/review-screen.test.tsx`
Expected: PASS semua.

- [x] **Step 5: Verifikasi typecheck + build render nyata**

Run: `cd src && pnpm tsc --noEmit && pnpm vitest run`
Expected: tsc bersih, seluruh suite frontend hijau. Lalu render nyata (Task verifikasi di fase Execute — lihat catatan bawah).

- [x] **Step 6: Update docs frontend-implementation.md**

Tambah section ringkas tentang layar Review (collapse default + toggle List|Tree) di `internal/docs/frontend/frontend-implementation.md` (setelah section SPEC-170, sebelum "Live run view").

- [x] **Step 7: Commit**

```bash
git add src/src/screens/ReviewScreen.tsx src/test/review-screen.test.tsx internal/docs/frontend/frontend-implementation.md
git commit -m "feat(spec-177): section Changed toggle List|Tree di review screen"
```

---

## Verifikasi nyata (fase Execute)

Bukan endpoint API (murni frontend). Sebagai ganti curl: render `ReviewScreen` di jsdom lewat vitest dengan mock `api` (sudah jadi test di atas) + `pnpm tsc --noEmit` bersih. Kalau memungkinkan, boot `pnpm dev` dan buka Review satu backlog item untuk cek mata: (1) semua folder collapsed saat dibuka, (2) tombol List|Tree di "Changed" berfungsi, tree menampilkan folder induk + status/counts.

## Self-review

- **Spec coverage:** Bug collapse → Task 1. Dua visual Changed (list existing + tree) → Task 2. Status/counts di tree → Task 1 leaf `meta`. Default List → Task 2 state init. ✓
- **Placeholder scan:** Semua step berisi kode nyata; tak ada TODO. ✓
- **Type consistency:** `meta?: Record<string, ChangedFile>` dipakai identik di Task 1 (TreeRow) dan Task 2 (`changedMeta`). `chView` `"list"|"tree"` konsisten. ✓
