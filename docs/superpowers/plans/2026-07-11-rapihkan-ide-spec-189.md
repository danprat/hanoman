# Rapihkan IDE (SPEC-189) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Rapihkan IDE mendekati VS Code — Explorer jadi tree folder default-collapse (reuse pola Review), Git Graph tersambung dengan kurva & barisnya rapih.

**Architecture:** Ekstrak tree UI Review (`buildFileTree`+`TreeRow`) ke modul bersama `screens/file-tree.tsx`, dipakai Review & IDE Explorer. Git Graph: `computeLanes` tetap; tambah `rowEdges()` pure yang menurunkan segmen edge per-baris; view menggambarnya sebagai cubic-bezier + rapikan kolom.

**Tech Stack:** React + TypeScript (Vite), vitest + @testing-library/react. SVG inline. Zero dependency baru.

## Global Constraints

- TypeScript strict; ikut design-system (`internal/docs/design-system/**`) — token DS, jangan warna/tipografi baru.
- Test dijalankan dengan env bersih: `env -u NODE_ENV -u DATABASE_URL pnpm --filter src test`.
- Perbarui `internal/docs/frontend/frontend-implementation.md` dalam commit yang sama.
- `computeLanes` output (`.lane`, `.width`) TIDAK boleh berubah — test menjaganya.
- JANGAN tambah auto-expand ancestor-of-selected ke `TreeRow` bersama — menggagalkan test Review SPEC-177.

---

### Task 1: Ekstrak modul tree bersama

**Files:**
- Create: `src/src/screens/file-tree.tsx`
- Modify: `src/src/screens/ReviewScreen.tsx` (hapus definisi tree lokal, import dari modul baru)
- Test: `src/test/review-screen.test.tsx` (sudah ada — jadi guard regresi)

**Interfaces:**
- Produces: `type FileNode = { name: string; path: string; kids: FileNode[]; leaf: boolean }`;
  `buildFileTree(paths: string[]): FileNode[]`;
  `ST_COLOR: Record<string,string>`;
  `TreeRow(props: { node: FileNode; selected: string; onSelect: (p: string) => void; depth?: number; meta?: Record<string, ChangedFile>; defaultOpen?: boolean })`.

- [x] **Step 1: Buat `src/src/screens/file-tree.tsx`** — pindahkan verbatim dari ReviewScreen (baris 7-71):

```tsx
/* file-tree — tree file dari path datar (dipakai Review & IDE Explorer, SPEC-189). */
import React from "react";
import { Icon } from "../ds";
import type { ChangedFile } from "../api/client";

export type FileNode = { name: string; path: string; kids: FileNode[]; leaf: boolean };
export function buildFileTree(paths: string[]): FileNode[] {
  const root: FileNode = { name: "", path: "", kids: [], leaf: false };
  for (const p of paths) {
    let cur = root;
    const segs = p.split("/");
    segs.forEach((seg, i) => {
      const leaf = i === segs.length - 1;
      const path = cur.path ? cur.path + "/" + seg : seg;
      let next = cur.kids.find((k) => k.name === seg && k.leaf === leaf);
      if (!next) { next = { name: seg, path, kids: [], leaf }; cur.kids.push(next); }
      cur = next;
    });
  }
  const sort = (n: FileNode) => {
    n.kids.sort((a, b) => (a.leaf === b.leaf ? a.name.localeCompare(b.name) : a.leaf ? 1 : -1));
    n.kids.forEach(sort);
  };
  sort(root);
  return root.kids;
}

export const ST_COLOR: Record<string, string> = { A: "var(--leaf-600)", M: "var(--brass-600)", D: "var(--clay-500)" };

export function TreeRow({ node, selected, onSelect, depth = 0, meta, defaultOpen = false }:
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

- [x] **Step 2: Ubah `ReviewScreen.tsx`** — hapus `type FileNode`, `buildFileTree`, `ST_COLOR`, `TreeRow` (baris 7-71), ganti import.

Hapus blok definisi tree lokal. Tambah di import teratas (setelah import `api`):
```tsx
import { buildFileTree, TreeRow, ST_COLOR } from "./file-tree";
```
`ST_COLOR` masih dipakai di list flat changed (ReviewScreen ~baris 169) — tetap valid via import. `buildFileTree` & `TreeRow` dipakai apa adanya.

- [x] **Step 3: Jalankan test Review** — harus tetap hijau (perilaku identik):

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter src test review-screen`
Expected: PASS (2 describe, 4 test).

- [x] **Step 4: Commit**

```bash
git add src/src/screens/file-tree.tsx src/src/screens/ReviewScreen.tsx
git commit -m "refactor(ide): ekstrak tree file Review ke modul bersama file-tree"
```

---

### Task 2: Explorer IDE pakai tree folder (default collapse)

**Files:**
- Modify: `src/src/screens/IdeScreen.tsx` (hapus `FileTree` lokal baris 18-37; render `buildFileTree`+`TreeRow`)
- Test: `src/test/ide-screen.test.tsx` (tambah test collapse)

**Interfaces:**
- Consumes: `buildFileTree`, `TreeRow` dari `./file-tree` (Task 1).

- [x] **Step 1: Tulis test collapse yang gagal** — tambahkan ke `src/test/ide-screen.test.tsx` di dalam `describe("IdeScreen Explorer", ...)`:

```tsx
  it("mengelompokkan file per folder, folder collapse default", async () => {
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    // folder src/ tampil sebagai header…
    expect(await screen.findByText("src/")).toBeInTheDocument();
    // …tapi isinya (a.ts) tersembunyi sampai di-expand
    expect(screen.queryByText("a.ts")).toBeNull();
    // buka folder → a.ts muncul
    fireEvent.click(screen.getByText("src/"));
    expect(await screen.findByText("a.ts")).toBeInTheDocument();
  });
```

- [x] **Step 2: Jalankan test — verifikasi GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter src test ide-screen`
Expected: FAIL — `src/` tidak ada (masih flat `src/a.ts`).

- [x] **Step 3: Ubah `IdeScreen.tsx`** — hapus fungsi `FileTree` (baris 18-37). Ganti import baris 6-8 area, tambah:
```tsx
import { buildFileTree, TreeRow } from "./file-tree";
```
Di render Explorer (ganti pemakaian `<FileTree files={files} .../>`, sekitar baris 153) — hitung tree lalu render `TreeRow`:
```tsx
                : buildFileTree(files).map((n) => (
                    <TreeRow key={n.path} node={n} selected={selected} onSelect={setSelected} />
                  ))}
```
(`defaultOpen` dibiarkan default `false` → folder collapse. Tanpa `meta` → ikon file-text biasa.)

- [x] **Step 4: Jalankan test — verifikasi LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter src test ide-screen`
Expected: PASS (5 test: 4 lama + 1 baru). Test lama `README.md` (leaf root) tetap tampil & klik memuat isi.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/IdeScreen.tsx src/test/ide-screen.test.tsx
git commit -m "feat(ide): Explorer pakai tree folder default-collapse (SPEC-189)"
```

---

### Task 3: `rowEdges` — turunkan segmen edge graf (pure)

**Files:**
- Modify: `src/src/screens/git-graph.ts` (tambah `Edge` + `rowEdges`)
- Test: `src/test/git-graph.test.ts` (tambah test `rowEdges`)

**Interfaces:**
- Consumes: `GraphRow` (sudah ada).
- Produces: `type Edge = { fromLane: number; toLane: number; half: "top"|"bottom"|"full"; colorLane: number }`;
  `rowEdges(rows: GraphRow[]): Edge[][]` — satu `Edge[]` per baris, indeks-lane space.

- [x] **Step 1: Tulis test yang gagal** — tambah ke `src/test/git-graph.test.ts`:

```ts
import { computeLanes, rowEdges } from "../src/screens/git-graph";

describe("rowEdges", () => {
  it("linear: tiap baris punya edge lurus fromLane==toLane", () => {
    const rows = computeLanes([c("C", ["B"]), c("B", ["A"]), c("A", [])]);
    const edges = rowEdges(rows);
    // C→B: outgoing lane0→lane0
    expect(edges[0]).toEqual([{ fromLane: 0, toLane: 0, half: "bottom", colorLane: 0 }]);
    // A: tak ada parent → tak ada outgoing; ada incoming lurus dari atas
    expect(edges[2]).toEqual([{ fromLane: 0, toLane: 0, half: "top", colorLane: 0 }]);
  });
  it("merge: commit merge punya edge outgoing diagonal ke lane parent-2", () => {
    const rows = computeLanes([c("m", ["a", "b"]), c("a", ["r"]), c("b", ["r"]), c("r", [])]);
    const mEdges = rowEdges(rows)[0]!;
    // m di lane0; parent a→lane0 (lurus), parent b→lane1 (diagonal)
    expect(mEdges).toContainEqual({ fromLane: 0, toLane: 0, half: "bottom", colorLane: 0 });
    expect(mEdges).toContainEqual({ fromLane: 0, toLane: 1, half: "bottom", colorLane: 1 });
  });
});
```

- [x] **Step 2: Jalankan — verifikasi GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter src test git-graph.test`
Expected: FAIL — `rowEdges` belum ada.

- [x] **Step 3: Implementasi `rowEdges`** — tambah di akhir `src/src/screens/git-graph.ts`:

```ts
export type Edge = { fromLane: number; toLane: number; half: "top" | "bottom" | "full"; colorLane: number };

// Turunkan segmen penyambung per-baris dari state lane atas (baris sebelumnya) & bawah (baris ini).
export function rowEdges(rows: GraphRow[]): Edge[][] {
  return rows.map((row, i) => {
    const top = i > 0 ? rows[i - 1]!.lanes : [];
    const bottom = row.lanes;
    const sha = row.commit.sha;
    const edges: Edge[] = [];
    const cIn = top.indexOf(sha);                                   // lane yang memesan commit ini
    if (cIn !== -1) edges.push({ fromLane: cIn, toLane: row.lane, half: "top", colorLane: row.lane });
    for (const p of row.commit.parents) {                           // ke tiap parent (bawah)
      const tl = bottom.indexOf(p);
      if (tl !== -1) edges.push({ fromLane: row.lane, toLane: tl, half: "bottom", colorLane: tl });
    }
    top.forEach((s, j) => {                                          // lane lain yang menerus
      if (!s || s === sha) return;
      const k = bottom.indexOf(s);
      if (k !== -1) edges.push({ fromLane: j, toLane: k, half: "full", colorLane: k });
    });
    return edges;
  });
}
```

- [x] **Step 4: Jalankan — verifikasi LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter src test git-graph.test`
Expected: PASS (computeLanes lama + rowEdges baru).

- [x] **Step 5: Commit**

```bash
git add src/src/screens/git-graph.ts src/test/git-graph.test.ts
git commit -m "feat(ide): rowEdges — segmen penyambung graf (SPEC-189)"
```

---

### Task 4: GitGraph view — gambar kurva + rapikan baris

**Files:**
- Modify: `src/src/screens/GitGraph.tsx` (`RowSvg` gambar edge bezier; kolom author/tanggal rata; hover; `rel` relatif)
- Test: `src/test/git-graph-view.test.tsx` (harus tetap hijau)

**Interfaces:**
- Consumes: `rowEdges`, `Edge`, `GraphRow` dari `./git-graph`.

- [x] **Step 1: Ubah import & konstanta** — di `GitGraph.tsx` baris 6, tambah `rowEdges`, `Edge`:
```tsx
import { computeLanes, rowEdges, type GraphRow, type Edge } from "./git-graph";
```
Ganti helper `rel` (baris 11) jadi relatif ringkas:
```tsx
const rel = (iso: string): string => {
  const t = new Date(iso).getTime();
  if (!t) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 2592000) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString();
};
```

- [x] **Step 2: Ganti `RowSvg` (baris 13-24)** — gambar edge dari `rowEdges`:

```tsx
function RowSvg({ row, edges, maxLanes }: { row: GraphRow; edges: Edge[]; maxLanes: number }) {
  const x = (i: number) => LANE_W / 2 + i * LANE_W;
  const seg = (e: Edge) => {
    const y1 = e.half === "bottom" ? ROW_H / 2 : 0;
    const y2 = e.half === "top" ? ROW_H / 2 : ROW_H;
    const x1 = x(e.fromLane), x2 = x(e.toLane), ym = (y1 + y2) / 2;
    return x1 === x2 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}C${x1} ${ym},${x2} ${ym},${x2} ${y2}`;
  };
  return (
    <svg width={maxLanes * LANE_W} height={ROW_H} style={{ flex: "0 0 auto" }}>
      {edges.map((e, i) => (
        <path key={i} d={seg(e)} fill="none" stroke={laneColor(e.colorLane)} strokeWidth={1.5} />
      ))}
      <circle cx={x(row.lane)} cy={ROW_H / 2} r={DOT} fill={laneColor(row.lane)}
        stroke="var(--surface-card)" strokeWidth={1.5} />
    </svg>
  );
}
```

- [x] **Step 3: Hitung edges di komponen & teruskan** — di `GitGraph` (setelah `maxLanes`, sekitar baris 62):
```tsx
  const allEdges = React.useMemo(() => rowEdges(rows), [rows]);
```
Di map baris (baris 71-93) teruskan `edges={allEdges[i]}` — ubah `rows.map((r) => {` jadi `rows.map((r, i) => {` dan `<RowSvg row={r} maxLanes={maxLanes} />` jadi:
```tsx
              <RowSvg row={r} edges={allEdges[i] ?? []} maxLanes={maxLanes} />
```

- [x] **Step 4: Rapikan kolom baris** — pada baris commit (div baris 77) tambah `background` hover via CSS-in-JS onMouseEnter/Leave sederhana ATAU class. Lazy: bungkus author & tanggal dengan lebar tetap. Ganti dua `<span>` author/date (baris 89-90):
```tsx
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)",
                flex: "0 0 auto", width: 88, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right" }}>{c.author}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)",
                flex: "0 0 auto", width: 40, textAlign: "right" }}>{rel(c.at)}</span>
```

- [x] **Step 5: Jalankan test view — harus LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter src test git-graph-view`
Expected: PASS (subject "kedua", ref chip "main", klik detail "a.ts", context-menu checkout).

- [x] **Step 6: Commit**

```bash
git add src/src/screens/GitGraph.tsx
git commit -m "feat(ide): Git Graph gambar kurva penyambung + kolom rapih (SPEC-189)"
```

---

### Task 5: Perbarui docs

**Files:**
- Modify: `internal/docs/frontend/frontend-implementation.md`

- [x] **Step 1: Update bagian IDE Visual (sekitar baris 248-254)** — ganti "pohon file datar" → tree folder default-collapse (reuse `file-tree.tsx`); catatan graf → edge routing kurva via `rowEdges`.

- [x] **Step 2: Update catatan ReviewScreen (sekitar baris 180-182)** — `buildFileTree`/`TreeRow` kini di modul bersama `screens/file-tree.tsx` (dipakai Review & IDE).

- [x] **Step 3: Jalankan seluruh test frontend**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter src test`
Expected: PASS semua.

- [x] **Step 4: Commit**

```bash
git add internal/docs/frontend/frontend-implementation.md
git commit -m "docs(ide): perbarui frontend-implementation untuk SPEC-189"
```

---

## Self-Review

- **Spec coverage:** Explorer folder-grouping default-collapse → Task 1+2. Git graph "lebih rapih" (edge tersambung) → Task 3+4. UI baris → Task 4. Docs → Task 5. ✓
- **Placeholder scan:** semua step berisi kode/perintah nyata. ✓
- **Type consistency:** `Edge`/`rowEdges` signature konsisten Task 3↔4; `TreeRow`/`buildFileTree` konsisten Task 1↔2. ✓
- **No data model / API change.** ✓
