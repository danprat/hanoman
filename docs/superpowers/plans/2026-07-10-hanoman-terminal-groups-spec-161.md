# SPEC-161 — Tutup kolom/baris + grouping sesi lewat tabbar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grid terminal bisa menutup kolom dan baris mana pun, dan sesi dikelompokkan ke beberapa grup bernama yang dipindah lewat tabbar.

**Architecture:** Tiga berkas frontend. `terminal-layout.ts` (murni, satu grid) mendapat `removeRow`/`removeColumn` dan melepas `load`/`save`. `terminal-workspace.ts` (baru, murni) memegang `{ groups, active }` dan menegakkan invarian "satu sesi ≤ satu sel, di ≤ satu grup" lintas grup. `TerminalScreen.tsx` menukar state `Layout` jadi `Workspace`, menambah tabbar dan gutter `×`. Server, kontrak API, dan skema tidak disentuh.

**Tech Stack:** React 18 + TypeScript strict, Vite, vitest + @testing-library/react (jsdom), `localStorage`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-10-hanoman-terminal-groups-spec-161-design.md`. Semua keputusan terkunci di sana.
- **Nol perubahan `server/**`**, kontrak API, maupun skema Prisma. Tak ada migration, tak ada ADR baru.
- **Menutup kolom, menutup baris, dan menghapus grup TIDAK PERNAH memanggil `api.deleteTerminal`.** Sesi tmux tetap hidup dan jatuh ke tray. Hanya `×` pada header sel dan `×` pada chip tray yang mematikan sesi.
- **Grid minimum `1×1`, workspace minimum satu grup.** `removeRow` saat `rows === 1`, `removeColumn` saat `cols === 1`, dan `removeGroup` saat `groups.length === 1` semuanya no-op yang mengembalikan objek **yang sama** (identitas referensial), mengikuti pola `setCell` di luar rentang pada `terminal-layout.ts:25`.
- **Aksesibilitas:** setiap `×` baru adalah `<button>` sungguhan dengan `aria-label`, bukan `<span onClick>`. Rename grup lewat tombol `✎`, bukan dobel-klik (tak terjangkau keyboard).
- **Bahasa:** komentar, label UI, dan pesan commit dalam bahasa Indonesia, mengikuti berkas di sekitarnya. Komentar hanya untuk menjelaskan kendala yang tak terlihat dari kode.
- **Perintah test** (env sesi menunjuk production; `env -u` wajib atau test gagal palsu):
  ```bash
  env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/<berkas>
  ```
- **Jangan `git add -A` atau `git stash`.** Checkout ini dibagi dengan sesi lain; `server/src/worker.ts` yang termodifikasi bukan milik pekerjaan ini. Selalu `git add` berkas yang disebut per task.

---

### Task 1: `removeRow` / `removeColumn` di modul layout murni

Cermin dari `addRow`/`addColumn` yang sudah ada. `addRow` meng-append dan `addColumn` me-rebuild karena index baris-mayor `r*cols + c` bergeser saat `cols` berubah tapi tidak saat `rows` berubah — asimetri yang sama berlaku saat membuang.

**Files:**
- Modify: `src/src/screens/terminal-layout.ts` (tambah dua fungsi setelah `addColumn`, baris 20)
- Test: `src/test/terminal-layout.test.ts` (tambah kasus; jangan sentuh kasus yang ada)

**Interfaces:**
- Consumes: `Layout = { rows: number; cols: number; cells: (string | null)[] }` (sudah ada)
- Produces: `removeRow(l: Layout, r: number): Layout`, `removeColumn(l: Layout, c: number): Layout`

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `src/test/terminal-layout.test.ts`, di dalam `describe("terminal-layout", …)` setelah kasus `addColumn` (baris 22). Perbarui juga baris `import` di atas berkas untuk memuat dua nama baru:

```ts
// baris 3-4 menjadi:
import {
  emptyLayout, addRow, addColumn, removeRow, removeColumn, setCell, placeFirstEmpty, reconcile, load, save,
} from "../src/screens/terminal-layout";
```

```ts
  it("removeRow memotong baris yang ditunjuk & tak menggeser sel lain", () => {
    // baris0=[a,b], baris1=[c,d] → buang baris 0
    expect(removeRow({ rows: 2, cols: 2, cells: ["a", "b", "c", "d"] }, 0))
      .toEqual({ rows: 1, cols: 2, cells: ["c", "d"] });
  });

  it("removeRow pada rows===1 → layout apa adanya (grid tak boleh nol baris)", () => {
    const l = { rows: 1, cols: 2, cells: ["a", "b"] };
    expect(removeRow(l, 0)).toBe(l);
  });

  it("removeRow index di luar rentang → layout apa adanya", () => {
    const l = { rows: 2, cols: 1, cells: ["a", "b"] };
    expect(removeRow(l, 2)).toBe(l);
    expect(removeRow(l, -1)).toBe(l);
  });

  it("removeColumn me-rebuild pemetaan baris-mayor (2×3 → 2×2, buang kolom tengah)", () => {
    // baris0=[a,b,c], baris1=[d,e,f] → buang kolom 1 → baris0=[a,c], baris1=[d,f]
    expect(removeColumn({ rows: 2, cols: 3, cells: ["a", "b", "c", "d", "e", "f"] }, 1))
      .toEqual({ rows: 2, cols: 2, cells: ["a", "c", "d", "f"] });
  });

  it("removeColumn pada cols===1 → layout apa adanya", () => {
    const l = { rows: 2, cols: 1, cells: ["a", "b"] };
    expect(removeColumn(l, 0)).toBe(l);
  });

  it("removeColumn index di luar rentang → layout apa adanya", () => {
    const l = { rows: 1, cols: 2, cells: ["a", "b"] };
    expect(removeColumn(l, 2)).toBe(l);
    expect(removeColumn(l, -1)).toBe(l);
  });
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/terminal-layout.test.ts
```

Expected: FAIL. Vitest melaporkan `removeRow is not a function` / `removeColumn is not a function` (import tak ter-resolve) pada 6 kasus baru; 10 kasus lama tetap lolos.

- [ ] **Step 3: Tulis implementasi minimal**

Sisipkan di `src/src/screens/terminal-layout.ts` tepat setelah `addColumn` (setelah baris 20, sebelum komentar `setCell`):

```ts
// − Baris: buang baris r. rows===1 → no-op (grid tak boleh nol baris).
// Index baris-mayor tak bergeser saat rows berubah, jadi cukup potong satu slice sepanjang cols.
export function removeRow(l: Layout, r: number): Layout {
  if (l.rows === 1 || r < 0 || r >= l.rows) return l;
  const cells = [...l.cells];
  cells.splice(r * l.cols, l.cols);
  return { ...l, rows: l.rows - 1, cells };
}

// − Kolom: idx = r*cols + c BERGESER saat cols berubah — cells di-rebuild, alasan yang sama
// dengan addColumn. cols===1 → no-op.
export function removeColumn(l: Layout, c: number): Layout {
  if (l.cols === 1 || c < 0 || c >= l.cols) return l;
  const cols = l.cols - 1;
  const cells: (string | null)[] = [];
  for (let r = 0; r < l.rows; r++)
    for (let cc = 0; cc < l.cols; cc++)
      if (cc !== c) cells.push(l.cells[r * l.cols + cc] ?? null);
  return { rows: l.rows, cols, cells };
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/terminal-layout.test.ts
```

Expected: PASS — `Tests 16 passed (16)`.

- [ ] **Step 5: Typecheck**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src typecheck
```

Expected: keluar tanpa output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add src/src/screens/terminal-layout.ts src/test/terminal-layout.test.ts
git commit -m "feat(terminal): removeRow/removeColumn di modul layout murni (SPEC-161)"
```

---

### Task 2: Modul `terminal-workspace.ts` — grup + invarian satu-rumah + migrasi

Modul murni baru di atas `terminal-layout`. `terminal-layout.ts` **belum** disentuh di task ini: `load`/`save` lama tetap ada supaya `TerminalScreen.tsx` tetap ter-compile. Task 3 yang mencabutnya.

Yang paling mudah salah di sini: `L.setCell` hanya menjamin keunikan **di dalam satu** layout. Menempatkan sesi yang sedang terpasang di grup lain tanpa menyapunya dulu akan membuat sesi kembar di dua grup — dan pane-nya berebut resize satu PTY tmux. `placeInActive` adalah satu-satunya tempat invarian itu ditegakkan.

**Files:**
- Create: `src/src/screens/terminal-workspace.ts`
- Test: `src/test/terminal-workspace.test.ts` (baru)

**Interfaces:**
- Consumes dari Task 1 & modul yang ada: `L.Layout`, `L.emptyLayout()`, `L.setCell(l, idx, id)`, `L.reconcile(l, liveIds)`, `L.addRow`, `L.addColumn`, `L.removeRow(l, r)`, `L.removeColumn(l, c)`
- Produces untuk Task 3 & 4:
  - `type Group = { id: string; name: string; layout: L.Layout }`
  - `type Workspace = { groups: Group[]; active: string }`
  - `emptyWorkspace(): Workspace`
  - `activeGroup(ws: Workspace): Group`
  - `addGroup(ws: Workspace, name: string): Workspace`
  - `renameGroup(ws: Workspace, id: string, name: string): Workspace`
  - `removeGroup(ws: Workspace, id: string): Workspace`
  - `selectGroup(ws: Workspace, id: string): Workspace`
  - `mapActiveLayout(ws: Workspace, f: (l: L.Layout) => L.Layout): Workspace`
  - `placeInActive(ws: Workspace, idx: number, id: string | null): Workspace`
  - `placeFirstEmptyInActive(ws: Workspace, id: string): Workspace`
  - `detach(ws: Workspace, id: string): Workspace`
  - `placedIds(ws: Workspace): Set<string>`
  - `reconcileAll(ws: Workspace, liveIds: Set<string>): Workspace`
  - `load(): Workspace | null`, `save(ws: Workspace): void`, `KEY`, `LEGACY_KEY`

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/terminal-workspace.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import * as W from "../src/screens/terminal-workspace";
import { addColumn } from "../src/screens/terminal-layout";

beforeEach(() => localStorage.clear());

// Dua grup, masing-masing 1×2, dengan sesi "a" di sel 0 grup pertama.
function twoGroups(): W.Workspace {
  let ws = W.emptyWorkspace();
  ws = W.mapActiveLayout(ws, addColumn);        // grup 1 → 1×2
  ws = W.placeInActive(ws, 0, "a");             // a di grup 1, sel 0
  ws = W.addGroup(ws, "Debug");                 // grup 2, jadi aktif
  ws = W.mapActiveLayout(ws, addColumn);        // grup 2 → 1×2
  return ws;
}

describe("terminal-workspace", () => {
  it("emptyWorkspace: satu grup 'Utama' berisi layout 1×1 dan menjadi aktif", () => {
    const ws = W.emptyWorkspace();
    expect(ws.groups).toHaveLength(1);
    expect(ws.groups[0]!.name).toBe("Utama");
    expect(ws.groups[0]!.layout).toEqual({ rows: 1, cols: 1, cells: [null] });
    expect(ws.active).toBe(ws.groups[0]!.id);
  });

  it("addGroup menambah grup kosong dan memindahkan fokus ke sana", () => {
    const ws = W.addGroup(W.emptyWorkspace(), "Debug");
    expect(ws.groups).toHaveLength(2);
    expect(W.activeGroup(ws).name).toBe("Debug");
    expect(W.activeGroup(ws).layout).toEqual({ rows: 1, cols: 1, cells: [null] });
  });

  it("activeGroup jatuh ke grup pertama bila `active` menunjuk grup yang lenyap", () => {
    const ws = W.emptyWorkspace();
    expect(W.activeGroup({ ...ws, active: "hantu" })).toBe(ws.groups[0]);
  });

  it("placeInActive menegakkan satu-rumah LINTAS grup", () => {
    const ws = twoGroups();                     // "a" ada di grup 1
    const moved = W.placeInActive(ws, 1, "a");  // taruh di grup 2 (aktif), sel 1
    expect(moved.groups[0]!.layout.cells).toEqual([null, null]); // sel lamanya dikosongkan
    expect(moved.groups[1]!.layout.cells).toEqual([null, "a"]);
    expect([...W.placedIds(moved)]).toEqual(["a"]);             // bukan dua kali
  });

  it("placeFirstEmptyInActive menaruh di lubang pertama grup aktif; penuh → no-op", () => {
    let ws = W.emptyWorkspace();                 // 1×1
    ws = W.placeFirstEmptyInActive(ws, "a");
    expect(W.activeGroup(ws).layout.cells).toEqual(["a"]);
    expect(W.placeFirstEmptyInActive(ws, "b")).toBe(ws);
  });

  it("detach melepas sesi dari grup mana pun ia berada, bukan hanya grup aktif", () => {
    const ws = twoGroups();                      // "a" di grup 1, grup 2 yang aktif
    expect(W.placedIds(W.detach(ws, "a")).size).toBe(0);
  });

  it("removeGroup membuang grid tapi sesinya lepas ke tray (bukan mati)", () => {
    const ws = twoGroups();
    const gone = W.removeGroup(ws, ws.groups[0]!.id);
    expect(gone.groups).toHaveLength(1);
    expect(W.placedIds(gone).size).toBe(0);      // "a" tak lagi tertempat → tray
  });

  it("removeGroup memindahkan fokus bila yang dihapus adalah grup aktif", () => {
    const ws = twoGroups();                      // grup 2 aktif
    const gone = W.removeGroup(ws, ws.active);
    expect(gone.active).toBe(gone.groups[0]!.id);
  });

  it("removeGroup pada grup terakhir → workspace apa adanya", () => {
    const ws = W.emptyWorkspace();
    expect(W.removeGroup(ws, ws.groups[0]!.id)).toBe(ws);
  });

  it("removeGroup id tak dikenal → workspace apa adanya", () => {
    const ws = twoGroups();
    expect(W.removeGroup(ws, "hantu")).toBe(ws);
  });

  it("renameGroup mengganti nama grup yang ditunjuk saja", () => {
    const ws = twoGroups();
    expect(W.renameGroup(ws, ws.groups[0]!.id, "Backlog").groups.map((g) => g.name))
      .toEqual(["Backlog", "Debug"]);
    expect(W.renameGroup(ws, "hantu", "y").groups.map((g) => g.name))
      .toEqual(["Utama", "Debug"]);   // id tak dikenal → tak ada yang berubah
  });

  it("selectGroup memindahkan fokus; id tak dikenal → workspace apa adanya", () => {
    const ws = twoGroups();                       // grup 2 aktif
    expect(W.selectGroup(ws, ws.groups[0]!.id).active).toBe(ws.groups[0]!.id);
    expect(W.selectGroup(ws, "hantu")).toBe(ws);
  });

  it("mapActiveLayout hanya menyentuh layout grup aktif", () => {
    const ws = twoGroups();                      // grup 2 aktif, keduanya 1×2
    const grown = W.mapActiveLayout(ws, addColumn);
    expect(grown.groups[0]!.layout.cols).toBe(2);
    expect(grown.groups[1]!.layout.cols).toBe(3);
  });

  it("reconcileAll mengosongkan sesi mati di SEMUA grup", () => {
    let ws = twoGroups();                        // "a" di grup 1
    ws = W.placeInActive(ws, 0, "b");            // "b" di grup 2
    const live = W.reconcileAll(ws, new Set(["b"]));
    expect(live.groups[0]!.layout.cells).toEqual([null, null]);
    expect(live.groups[1]!.layout.cells).toEqual(["b", null]);
  });

  it("load/save round-trip lewat localStorage", () => {
    const ws = twoGroups();
    W.save(ws);
    expect(W.load()).toEqual(ws);
  });

  it("load memigrasikan key lama jadi satu grup 'Utama' dan menghapus key lama", () => {
    const legacy = { rows: 1, cols: 2, cells: ["a", null] };
    localStorage.setItem(W.LEGACY_KEY, JSON.stringify(legacy));
    const ws = W.load()!;
    expect(ws.groups).toHaveLength(1);
    expect(ws.groups[0]!.name).toBe("Utama");
    expect(ws.groups[0]!.layout).toEqual(legacy);
    expect(ws.active).toBe(ws.groups[0]!.id);
    expect(localStorage.getItem(W.LEGACY_KEY)).toBeNull();       // tak ditinggal jadi sampah
    expect(JSON.parse(localStorage.getItem(W.KEY)!)).toEqual(ws); // sudah dipersist
  });

  it("load: key baru menang atas key lama", () => {
    const ws = W.emptyWorkspace();
    W.save(ws);
    localStorage.setItem(W.LEGACY_KEY, JSON.stringify({ rows: 9, cols: 9, cells: [] }));
    expect(W.load()).toEqual(ws);
  });

  it("load tanpa data → null", () => {
    expect(W.load()).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/terminal-workspace.test.ts
```

Expected: FAIL — `Failed to resolve import "../src/screens/terminal-workspace"`.

- [ ] **Step 3: Tulis implementasi minimal**

Buat `src/src/screens/terminal-workspace.ts`:

```ts
// Grup terminal: tiap grup memegang satu Layout dan grid-nya sendiri.
// Murni, tanpa React/DOM, agar teruji langsung — seperti terminal-layout.ts.
//
// Invarian "satu rumah": satu sesi terpasang di ≤1 sel, di ≤1 grup, lintas seluruh workspace.
// L.setCell hanya menjamin keunikan DI DALAM satu layout; lintas-grup ditegakkan di placeInActive.
import * as L from "./terminal-layout";

export type Group = { id: string; name: string; layout: L.Layout };
export type Workspace = { groups: Group[]; active: string };

const newGroup = (name: string): Group => ({ id: crypto.randomUUID(), name, layout: L.emptyLayout() });

export function emptyWorkspace(): Workspace {
  const g = newGroup("Utama");
  return { groups: [g], active: g.id };
}

// `active` bisa menunjuk grup yang sudah lenyap (state lama di localStorage) → jatuh ke grup pertama.
// groups tak pernah kosong: emptyWorkspace mengisi satu, removeGroup menolak membuang yang terakhir.
export const activeGroup = (ws: Workspace): Group =>
  ws.groups.find((g) => g.id === ws.active) ?? ws.groups[0]!;

export function addGroup(ws: Workspace, name: string): Workspace {
  const g = newGroup(name);
  return { groups: [...ws.groups, g], active: g.id };
}

export const renameGroup = (ws: Workspace, id: string, name: string): Workspace =>
  ({ ...ws, groups: ws.groups.map((g) => (g.id === id ? { ...g, name } : g)) });

// Grup terakhir tak bisa dihapus. Sesi di dalamnya tidak di-kill — ia lepas dari cells,
// jadi otomatis keluar dari placedIds dan muncul di tray.
export function removeGroup(ws: Workspace, id: string): Workspace {
  if (ws.groups.length === 1) return ws;
  const groups = ws.groups.filter((g) => g.id !== id);
  if (groups.length === ws.groups.length) return ws;
  return { groups, active: ws.active === id ? groups[0]!.id : ws.active };
}

export const selectGroup = (ws: Workspace, id: string): Workspace =>
  (ws.groups.some((g) => g.id === id) ? { ...ws, active: id } : ws);

export function mapActiveLayout(ws: Workspace, f: (l: L.Layout) => L.Layout): Workspace {
  const act = activeGroup(ws);
  return { ...ws, groups: ws.groups.map((g) => (g.id === act.id ? { ...g, layout: f(g.layout) } : g)) };
}

// Sapu `id` dari layout SEMUA grup lain lebih dulu, baru tulis di sel idx grup aktif.
// L.setCell dengan idx -1 (id tak ada di grup itu) mengembalikan layout apa adanya.
export function placeInActive(ws: Workspace, idx: number, id: string | null): Workspace {
  const act = activeGroup(ws);
  const swept = id === null ? ws.groups : ws.groups.map((g) =>
    g.id === act.id ? g : { ...g, layout: L.setCell(g.layout, g.layout.cells.indexOf(id), null) });
  return { ...ws, groups: swept.map((g) => (g.id === act.id ? { ...g, layout: L.setCell(g.layout, idx, id) } : g)) };
}

// Grid aktif penuh → workspace apa adanya (sesi tinggal di tray).
export function placeFirstEmptyInActive(ws: Workspace, id: string): Workspace {
  const idx = activeGroup(ws).layout.cells.indexOf(null);
  return idx === -1 ? ws : placeInActive(ws, idx, id);
}

// Lepas dari grup mana pun ia berada — tombol "lepas" ada di grid aktif, tapi menjaga
// invarian lebih murah daripada mengasumsikan sesi selalu ada di grup yang sedang dilihat.
export const detach = (ws: Workspace, id: string): Workspace =>
  ({ ...ws, groups: ws.groups.map((g) => ({ ...g, layout: L.setCell(g.layout, g.layout.cells.indexOf(id), null) })) });

// Tray = sessions − placedIds. Menutup kolom/baris & menghapus grup membuang sel,
// jadi sesinya jatuh ke tray tanpa satu baris kode pembersih pun.
export const placedIds = (ws: Workspace): Set<string> =>
  new Set(ws.groups.flatMap((g) => g.layout.cells.filter((c): c is string => c !== null)));

export const reconcileAll = (ws: Workspace, liveIds: Set<string>): Workspace =>
  ({ ...ws, groups: ws.groups.map((g) => ({ ...g, layout: L.reconcile(g.layout, liveIds) })) });

export const KEY = "hanoman.terminal.workspace";
export const LEGACY_KEY = "hanoman.terminal.layout"; // SPEC-158, satu layout tanpa grup

export function load(): Workspace | null {
  try {
    const s = localStorage.getItem(KEY);
    if (s) return JSON.parse(s) as Workspace;
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return null;
    const g: Group = { ...newGroup("Utama"), layout: JSON.parse(legacy) as L.Layout };
    const ws: Workspace = { groups: [g], active: g.id };
    save(ws);
    localStorage.removeItem(LEGACY_KEY);
    return ws;
  } catch { return null; }
}

export function save(ws: Workspace): void {
  try { localStorage.setItem(KEY, JSON.stringify(ws)); } catch { /* mode privat / kuota penuh */ }
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/terminal-workspace.test.ts
```

Expected: PASS — `Tests 18 passed (18)`.

- [ ] **Step 5: Typecheck**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src typecheck
```

Expected: exit code 0. (`crypto.randomUUID` sudah diverifikasi ada di env test jsdom repo ini dan di Node 24 — jangan tambah polyfill atau dependensi uuid. Bila TS mengeluh, periksa `"lib"` di `src/tsconfig.json` memuat `DOM`.)

- [ ] **Step 6: Commit**

```bash
git add src/src/screens/terminal-workspace.ts src/test/terminal-workspace.test.ts
git commit -m "feat(terminal): modul workspace — grup, invarian satu-rumah, migrasi localStorage (SPEC-161)"
```

---

### Task 3: `TerminalScreen` memakai `Workspace` + tabbar

Menukar state `Layout` → `Workspace`, menambah tabbar, dan mencabut `load`/`save` dari `terminal-layout.ts` (kini ada dua penulis untuk satu key kalau dibiarkan).

Tujuh test lama di `terminal-screen.test.tsx` menulis `hanoman.terminal.layout` di `beforeEach`-nya. Test-test itu **tetap lolos tanpa diubah** karena `W.load()` memigrasikan key itu — bukti migrasi bekerja pada jalur yang sebenarnya. Jangan "perbaiki" test lama menjadi key baru.

**Files:**
- Modify: `src/src/screens/TerminalScreen.tsx` (tulis ulang, isi lengkap di Step 3)
- Modify: `src/src/screens/terminal-layout.ts` (hapus `KEY`, `load`, `save` — baris 42-49)
- Modify: `src/test/terminal-layout.test.ts` (hapus dua kasus `load`/`save` dan importnya)
- Test: `src/test/terminal-screen.test.tsx` (tambah kasus tabbar)

**Interfaces:**
- Consumes: seluruh permukaan `terminal-workspace.ts` dari Task 2; `L.addRow`, `L.addColumn` dari modul layout.
- Produces untuk Task 4: `TerminalScreen` merender grid dari `W.activeGroup(ws).layout`; state disimpan di `const [ws, setWs] = React.useState<W.Workspace>(...)`. Task 4 menyisipkan gutter ke dalam `<div>` grid yang sama.

- [ ] **Step 1: Tulis test yang gagal**

Di `src/test/terminal-screen.test.tsx`, tambahkan konstanta key baru di bawah `const LKEY = …` (baris 22):

```ts
const WKEY = "hanoman.terminal.workspace";
```

Lalu tambahkan `describe` baru setelah `describe("TerminalScreen (grid)", …)` yang sudah ada (setelah baris 103):

```ts
describe("TerminalScreen (grup)", () => {
  it("tabbar menampilkan grup 'Utama' hasil migrasi layout lama", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    expect(await screen.findByRole("tab", { name: "Utama" })).toBeInTheDocument();
    expect(localStorage.getItem(LKEY)).toBeNull();
  });

  it("× grup nonaktif saat hanya ada satu grup", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByRole("tab", { name: "Utama" });
    expect(screen.getByLabelText("Hapus grup Utama")).toBeDisabled();
  });

  it("pindah tab mengganti grid: pane grup lain tak dirender", async () => {
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    // taruh sesi di grup "Utama"
    fireEvent.click(await screen.findByRole("button", { name: /aaaa11/ }));
    await waitFor(() => expect(screen.getByTestId("pane")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Grup baru" }));
    const tab2 = await screen.findByRole("tab", { name: "Grup 2" });
    expect(tab2).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("pane")).toBeNull();        // grid grup 2 kosong

    fireEvent.click(screen.getByRole("tab", { name: "Utama" }));
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("aaaa1111"));
  });

  it("menghapus grup melepas sesinya ke tray tanpa mematikannya", async () => {
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    fireEvent.click(await screen.findByRole("button", { name: /aaaa11/ }));
    await waitFor(() => expect(screen.getByTestId("pane")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Grup baru" }));   // grup 2 aktif
    await screen.findByRole("tab", { name: "Grup 2" });
    fireEvent.click(screen.getByRole("tab", { name: "Utama" }));          // kembali ke Utama
    fireEvent.click(screen.getByLabelText("Hapus grup Utama"));

    await waitFor(() => expect(screen.getByRole("button", { name: /aaaa11/ })).toBeInTheDocument());
    expect(screen.queryByTestId("pane")).toBeNull();
    expect(deleteTerminal).not.toHaveBeenCalled();
  });

  it("rename grup: Enter menyimpan, Escape membatalkan", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByRole("tab", { name: "Utama" });

    fireEvent.click(screen.getByLabelText("Ganti nama grup Utama"));
    const input = screen.getByLabelText("Nama grup");
    fireEvent.change(input, { target: { value: "Backlog" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByRole("tab", { name: "Backlog" })).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Ganti nama grup Backlog"));
    const again = screen.getByLabelText("Nama grup");
    fireEvent.change(again, { target: { value: "dibuang" } });
    fireEvent.keyDown(again, { key: "Escape" });
    expect(await screen.findByRole("tab", { name: "Backlog" })).toBeInTheDocument();
  });

  it("workspace tersimpan dipulihkan apa adanya (dua grup)", async () => {
    localStorage.setItem(WKEY, JSON.stringify({
      active: "g2",
      groups: [
        { id: "g1", name: "Backlog", layout: { rows: 1, cols: 1, cells: ["aaaa1111"] } },
        { id: "g2", name: "Debug", layout: { rows: 1, cols: 1, cells: ["bbbb2222"] } },
      ],
    }));
    listTerminals.mockResolvedValue([
      { id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false },
      { id: "bbbb2222", projectId: "p1", cwd: "/repo", exited: false },
    ]);
    render(<TerminalScreen projects={projects} />);
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("bbbb2222"));
    expect(screen.getByRole("tab", { name: "Debug" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("aaaa1111")).toBeNull();   // grup lain tak dirender, juga tak di tray
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/terminal-screen.test.tsx
```

Expected: FAIL. 6 kasus baru gagal dengan `Unable to find an accessible element with the role "tab"`; 7 kasus lama tetap lolos.

- [ ] **Step 3: Tulis implementasi**

Ganti seluruh isi `src/src/screens/TerminalScreen.tsx` dengan:

```tsx
import React from "react";
import { Button, Select, StateBlock } from "../ds";
import { api, type TerminalSession } from "../api/client";
import { TerminalPane } from "./TerminalPane";
import * as L from "./terminal-layout";
import * as W from "./terminal-workspace";

export function TerminalScreen({ projects }: { projects: { id: string; name: string }[] }) {
  const [sessions, setSessions] = React.useState<TerminalSession[]>([]);
  const [ws, setWs] = React.useState<W.Workspace>(() => W.load() ?? W.emptyWorkspace());
  const [project, setProject] = React.useState(projects[0]?.id ?? "");

  const [loaded, setLoaded] = React.useState(false);
  React.useEffect(() => {
    api.listTerminals().then(setSessions).catch(() => setSessions([])).finally(() => setLoaded(true));
  }, []);

  // Sesi hidup di tmux dan selamat dari restart server (ADR-0016): workspace ter-load bisa
  // menunjuk sesi yang masih hidup (disambung ulang) atau yang sudah di-kill (dikosongkan).
  // Ditahan sampai `loaded`: sebelum listTerminals() resolve, `sessions` masih [] dan
  // rekonsiliasi dini akan mengosongkan workspace yang baru saja dipulihkan dari localStorage.
  React.useEffect(() => {
    if (!loaded) return;
    setWs((w) => W.reconcileAll(w, new Set(sessions.map((s) => s.id))));
  }, [loaded, sessions]);

  React.useEffect(() => { W.save(ws); }, [ws]);

  const byId = (id: string) => sessions.find((s) => s.id === id) ?? null;
  const nameOf = (pid: string) => projects.find((p) => p.id === pid)?.name ?? pid;

  async function openNew() {
    if (!project) return;
    const { id } = await api.createTerminal(project);
    setSessions((s) => [...s, { id, projectId: project, cwd: "", exited: false }]);
    setWs((w) => W.placeFirstEmptyInActive(w, id));
  }

  // Tutup = perilaku hari ini: kill sesi. Selnya dikosongkan oleh efek rekonsiliasi.
  async function close(id: string) {
    await api.deleteTerminal(id).catch(() => {});
    setSessions((s) => s.filter((x) => x.id !== id));
  }

  const markExited = React.useCallback((id: string) => {
    setSessions((s) => s.map((x) => (x.id === id ? { ...x, exited: true } : x)));
  }, []);

  const place = (idx: number, id: string) => setWs((w) => W.placeInActive(w, idx, id));
  const placeFirst = (id: string) => setWs((w) => W.placeFirstEmptyInActive(w, id));
  const detach = (id: string) => setWs((w) => W.detach(w, id));

  const placed = W.placedIds(ws);
  const unplaced = sessions.filter((s) => !placed.has(s.id));

  const layout = W.activeGroup(ws).layout;
  const showEmpty = layout.rows === 1 && layout.cols === 1 && !layout.cells[0] && sessions.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "calc(100vh - 180px)" }}>
      <GroupTabs
        ws={ws}
        onSelect={(id) => setWs((w) => W.selectGroup(w, id))}
        onAdd={() => setWs((w) => W.addGroup(w, `Grup ${w.groups.length + 1}`))}
        onRename={(id, name) => setWs((w) => W.renameGroup(w, id, name))}
        onRemove={(id) => setWs((w) => W.removeGroup(w, id))}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Button size="sm" variant="ghost" onClick={() => setWs((w) => W.mapActiveLayout(w, L.addColumn))}>+ Kolom</Button>
        <Button size="sm" variant="ghost" onClick={() => setWs((w) => W.mapActiveLayout(w, L.addRow))}>+ Baris</Button>
        <div style={{ flex: 1, minWidth: 0 }} />
        <Select size="sm" value={project} onChange={(e) => setProject(e.target.value)}
          options={projects.map((p) => ({ value: p.id, label: p.name }))} />
        <Button size="sm" leftIcon="plus" onClick={() => void openNew()}>Sesi baru</Button>
      </div>

      {unplaced.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>Belum di grid:</span>
          {unplaced.map((s) => (
            <span key={s.id} style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px",
              borderRadius: "var(--radius-sm)", background: "var(--bone-200)",
              border: "1px solid var(--border-hair)", fontFamily: "var(--font-mono)", fontSize: 11,
            }}>
              <button onClick={() => placeFirst(s.id)} title="Taruh di sel kosong pertama grup ini"
                style={{ all: "unset", cursor: "pointer" }}>
                {(s.runId ? `${s.runId} · resume` : nameOf(s.projectId))} · {s.id.slice(0, 6)}
              </button>
              <span aria-label={`Tutup sesi ${s.id}`} onClick={() => void close(s.id)}
                style={{ cursor: "pointer", color: "var(--text-subtle)" }}>×</span>
            </span>
          ))}
        </div>
      )}

      {showEmpty ? (
        // Tanpa `action`: toolbar di atas sudah menawarkan "Sesi baru" — tombol kedua
        // dengan label identik hanya duplikasi, bukan affordance tambahan.
        <StateBlock kind="empty" icon="terminal" title="Belum ada sesi terminal"
          hint="Pilih project lalu buka sesi — hanoman menjalankan claude --dangerously-skip-permissions di direktori project itu." />
      ) : (
        <div style={{
          flex: 1, minHeight: 0, display: "grid", gap: 8,
          gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
        }}>
          {layout.cells.map((id, idx) => {
            const s = id ? byId(id) : null;
            return (
              <div key={id ?? `empty-${idx}`} style={{
                minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column",
                border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", overflow: "hidden",
              }}>
                {s
                  ? <Cell session={s} nameOf={nameOf} onClose={() => void close(s.id)}
                      onDetach={() => detach(s.id)} onExit={() => markExited(s.id)} />
                  : <EmptyCell unplaced={unplaced} nameOf={nameOf} onPick={(sid) => place(idx, sid)} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Tab = grup, tiap grup punya grid sendiri. Grup non-aktif tak dirender: pane-nya unmount
// dan WebSocket-nya tertutup. Kembali ke tab itu meng-attach ulang ke sesi tmux yang sama —
// scrollback dipegang tmux (ADR-0016), bukan buffer xterm di memori.
function GroupTabs({ ws, onSelect, onAdd, onRename, onRemove }: {
  ws: W.Workspace; onSelect: (id: string) => void; onAdd: () => void;
  onRename: (id: string, name: string) => void; onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = React.useState<string | null>(null);
  const active = W.activeGroup(ws);
  const only = ws.groups.length === 1;

  return (
    <div role="tablist" aria-label="Grup terminal"
      style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap",
        borderBottom: "1px solid var(--border-hair)", paddingBottom: 4 }}>
      {ws.groups.map((g) => {
        const isActive = g.id === active.id;
        if (editing === g.id)
          return <RenameInput key={g.id} initial={g.name}
            onCommit={(name) => { if (name.trim()) onRename(g.id, name.trim()); setEditing(null); }}
            onCancel={() => setEditing(null)} />;
        return (
          <span key={g.id} style={{
            display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 6px",
            borderRadius: "var(--radius-sm)", fontSize: 12,
            background: isActive ? "var(--bone-200)" : "transparent",
            border: `1px solid ${isActive ? "var(--border-hair)" : "transparent"}`,
          }}>
            <button role="tab" aria-selected={isActive} onClick={() => onSelect(g.id)}
              style={{ all: "unset", cursor: "pointer", color: isActive ? "var(--text-strong)" : "var(--text-muted)" }}>
              {g.name}
            </button>
            {isActive && (
              <>
                <button aria-label={`Ganti nama grup ${g.name}`} title="Ganti nama"
                  onClick={() => setEditing(g.id)}
                  style={{ all: "unset", cursor: "pointer", color: "var(--text-subtle)", fontSize: 10 }}>✎</button>
                <button aria-label={`Hapus grup ${g.name}`} title={only ? "Grup terakhir tak bisa dihapus" : "Hapus grup (sesi tetap hidup)"}
                  disabled={only} onClick={() => onRemove(g.id)}
                  style={{ all: "unset", cursor: only ? "not-allowed" : "pointer",
                    color: "var(--text-subtle)", opacity: only ? 0.35 : 1 }}>×</button>
              </>
            )}
          </span>
        );
      })}
      <button aria-label="Grup baru" title="Grup baru" onClick={onAdd}
        style={{ all: "unset", cursor: "pointer", padding: "3px 8px", color: "var(--text-subtle)", fontSize: 12 }}>+</button>
    </div>
  );
}

function RenameInput({ initial, onCommit, onCancel }: {
  initial: string; onCommit: (name: string) => void; onCancel: () => void;
}) {
  const [value, setValue] = React.useState(initial);
  return (
    <input autoFocus aria-label="Nama grup" value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(value);
        else if (e.key === "Escape") onCancel();
      }}
      style={{ width: 100, padding: "3px 6px", fontSize: 12, fontFamily: "var(--font-ui)",
        border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)",
        background: "var(--surface-card)", color: "var(--text-strong)" }} />
  );
}

function Cell({ session, nameOf, onClose, onDetach, onExit }: {
  session: TerminalSession; nameOf: (pid: string) => string;
  onClose: () => void; onDetach: () => void; onExit: (code: number) => void;
}) {
  const label = session.runId ? `${session.runId} · resume` : nameOf(session.projectId);
  return (
    <>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", flex: "0 0 auto",
        background: "var(--bone-200)", borderBottom: "1px solid var(--border-hair)",
        fontFamily: "var(--font-mono)", fontSize: 11, color: session.exited ? "var(--text-muted)" : "var(--text-body)",
      }}>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label} · {session.id.slice(0, 6)}{session.exited && " · berakhir"}
        </span>
        <span onClick={onDetach} title="Lepas dari grid (sesi tetap hidup)"
          style={{ cursor: "pointer", color: "var(--text-subtle)" }}>lepas</span>
        <span aria-label={`Tutup sesi ${session.id}`} onClick={onClose}
          style={{ cursor: "pointer", color: "var(--text-subtle)" }}>×</span>
      </div>
      {/* key = identitas sesi: pindah antar sel memindah subtree, bukan me-remount WebSocket. */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <TerminalPane key={session.id} sessionId={session.id} onExit={onExit} />
      </div>
    </>
  );
}

function EmptyCell({ unplaced, nameOf, onPick }: {
  unplaced: TerminalSession[]; nameOf: (pid: string) => string; onPick: (id: string) => void;
}) {
  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 12 }}>
      <Select size="sm" value="" aria-label="Pilih sesi untuk sel" disabled={!unplaced.length}
        onChange={(e) => e.target.value && onPick(e.target.value)}
        options={[{ value: "", label: unplaced.length ? "Pilih sesi…" : "tidak ada sesi bebas" }]
          .concat(unplaced.map((s) => ({
            value: s.id,
            label: `${s.runId ? `${s.runId} · resume` : nameOf(s.projectId)} · ${s.id.slice(0, 6)}`,
          })))} />
    </div>
  );
}
```

- [ ] **Step 4: Cabut `load`/`save` dari modul layout**

Pastikan dulu tak ada pemakai lain selain `TerminalScreen.tsx` yang baru saja ditulis ulang:

```bash
grep -rn "terminal-layout" src/ --include=*.ts --include=*.tsx
```

Expected: hanya `TerminalScreen.tsx`, `terminal-workspace.ts`, dan kedua berkas test. Bila ada pemakai lain, ia harus dialihkan ke `terminal-workspace` lebih dulu.

Hapus baris 42-49 `src/src/screens/terminal-layout.ts` (blok `const KEY` sampai akhir `save`). Berkas ini kini nol efek samping — semua persistensi milik `terminal-workspace.ts`.

Lalu di `src/test/terminal-layout.test.ts`: hapus dua kasus `"load/save round-trip lewat localStorage"` dan `"load tanpa data → null"`, hapus `load, save` dari daftar import, dan hapus `beforeEach(() => localStorage.clear())` beserta `beforeEach` dari import `vitest` (modul ini tak lagi menyentuh `localStorage`).

- [ ] **Step 5: Jalankan test, pastikan LULUS**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/terminal-layout.test.ts test/terminal-workspace.test.ts test/terminal-screen.test.tsx
```

Expected: PASS — `terminal-layout` 14 tests, `terminal-workspace` 18 tests, `terminal-screen` 13 tests.

Jika kasus lama `terminal-screen` gagal, penyebabnya hampir pasti migrasi `LEGACY_KEY` yang tak jalan — perbaiki `W.load()`, **jangan** ubah test lama ke key baru.

- [ ] **Step 6: Typecheck**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src typecheck
```

Expected: exit code 0.

- [ ] **Step 7: Perbarui docs yang tersentuh**

Di `internal/docs/frontend/frontend-implementation.md`, bagian `## Terminal (sesi Claude Code interaktif)` (baris 112-125). Sisipkan setelah kalimat yang berakhir `…dan sesi yang belum di grid duduk di **tray**.`:

```markdown
Grid-grid itu dikelompokkan ke **grup** bernama yang dipindah lewat tabbar (`+` menambah, `✎`
mengganti nama, `×` menghapus; grup terakhir tak bisa dihapus). Tiap grup memegang `Layout`-nya
sendiri, dan satu sesi menempati paling banyak satu sel **di satu grup** — tray karena itu global,
berisi sesi yang tak punya sel di grup mana pun. Grup non-aktif tidak dirender, jadi pindah tab
menutup lalu membuka ulang WebSocket sesi di grup tujuan; scrollback dipegang tmux, bukan buffer
xterm. State `{groups, active}` disimpan di `localStorage` (`hanoman.terminal.workspace`) dan
memigrasikan key lama `hanoman.terminal.layout` menjadi satu grup "Utama" saat pertama dibaca.
Logika grup murni ada di `screens/terminal-workspace.ts` (SPEC-161).
```

Ganti juga kalimat `Layout (`{rows,cols,cells}`) disimpan di `localStorage`` menjadi `Layout (`{rows,cols,cells}`) tiap grup disimpan di `localStorage``.

- [ ] **Step 8: Commit**

```bash
git add src/src/screens/TerminalScreen.tsx src/src/screens/terminal-layout.ts \
        src/test/terminal-layout.test.ts src/test/terminal-screen.test.tsx \
        internal/docs/frontend/frontend-implementation.md
git commit -m "feat(terminal): grouping sesi lewat tabbar, workspace gantikan layout tunggal (SPEC-161)"
```

---

### Task 4: Gutter `×` untuk menutup kolom dan baris

Grid diperlebar satu track di kiri dan satu di atas untuk menampung tombol `×`. Pojok kiri-atas kosong.

**Files:**
- Modify: `src/src/screens/TerminalScreen.tsx` (blok `<div style={{ …display: "grid"… }}>` dan tambah komponen `GutterX`)
- Test: `src/test/terminal-screen.test.tsx` (tambah `describe` baru)

**Interfaces:**
- Consumes: `W.mapActiveLayout(ws, f)` dan `L.removeRow(l, r)` / `L.removeColumn(l, c)` dari Task 1 & 2; state `[ws, setWs]` dari Task 3.
- Produces: tombol ber-`aria-label` `Tutup kolom ${c + 1}` dan `Tutup baris ${r + 1}` (1-indexed untuk manusia).

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `src/test/terminal-screen.test.tsx` setelah `describe("TerminalScreen (grup)", …)`:

```ts
describe("TerminalScreen (tutup kolom/baris)", () => {
  it("menutup kolom melepas sesinya ke tray tanpa mematikannya", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 2, cells: [null, "aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("aaaa1111"));

    fireEvent.click(screen.getByLabelText("Tutup kolom 2"));

    await waitFor(() => expect(screen.queryByTestId("pane")).toBeNull());
    expect(screen.getByRole("button", { name: /aaaa11/ })).toBeInTheDocument();  // ada di tray
    expect(deleteTerminal).not.toHaveBeenCalled();                               // sesi tetap hidup
  });

  it("menutup baris melepas sesinya ke tray tanpa mematikannya", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 2, cols: 1, cells: [null, "aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("aaaa1111"));

    fireEvent.click(screen.getByLabelText("Tutup baris 2"));

    await waitFor(() => expect(screen.queryByTestId("pane")).toBeNull());
    expect(screen.getByRole("button", { name: /aaaa11/ })).toBeInTheDocument();
    expect(deleteTerminal).not.toHaveBeenCalled();
  });

  it("× kolom & baris nonaktif pada grid 1×1 (tak boleh menyusut ke nol)", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    expect(screen.getByLabelText("Tutup kolom 1")).toBeDisabled();
    expect(screen.getByLabelText("Tutup baris 1")).toBeDisabled();
  });

  it("menutup kolom hanya mengubah grid grup aktif", async () => {
    localStorage.setItem(WKEY, JSON.stringify({
      active: "g2",
      groups: [
        { id: "g1", name: "Backlog", layout: { rows: 1, cols: 2, cells: [null, null] } },
        { id: "g2", name: "Debug", layout: { rows: 1, cols: 2, cells: [null, null] } },
      ],
    }));
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByRole("tab", { name: "Debug" });

    fireEvent.click(screen.getByLabelText("Tutup kolom 2"));
    await waitFor(() => expect(screen.queryByLabelText("Tutup kolom 2")).toBeNull());

    fireEvent.click(screen.getByRole("tab", { name: "Backlog" }));
    expect(await screen.findByLabelText("Tutup kolom 2")).toBeInTheDocument();  // grup lain utuh
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/terminal-screen.test.tsx
```

Expected: FAIL — 4 kasus baru gagal dengan `Unable to find a label with the text of: Tutup kolom 2`; 13 kasus lama tetap lolos.

- [ ] **Step 3: Tulis implementasi**

Di `src/src/screens/TerminalScreen.tsx`, ganti blok grid (cabang `else` dari `showEmpty`) dengan:

```tsx
        <div style={{
          flex: 1, minHeight: 0, display: "grid", gap: 8,
          gridTemplateColumns: `18px repeat(${layout.cols}, minmax(0, 1fr))`,
          gridTemplateRows: `16px repeat(${layout.rows}, minmax(0, 1fr))`,
        }}>
          <div />{/* pojok kiri-atas: perpotongan kedua gutter */}
          {Array.from({ length: layout.cols }, (_, c) => (
            <GutterX key={`col-${c}`} label={`Tutup kolom ${c + 1}`} disabled={layout.cols === 1}
              onClick={() => setWs((w) => W.mapActiveLayout(w, (l) => L.removeColumn(l, c)))} />
          ))}
          {Array.from({ length: layout.rows }, (_, r) => (
            <React.Fragment key={`row-${r}`}>
              <GutterX label={`Tutup baris ${r + 1}`} disabled={layout.rows === 1}
                onClick={() => setWs((w) => W.mapActiveLayout(w, (l) => L.removeRow(l, r)))} />
              {Array.from({ length: layout.cols }, (_, c) => {
                const idx = r * layout.cols + c;
                const id = layout.cells[idx] ?? null;
                const s = id ? byId(id) : null;
                return (
                  <div key={id ?? `empty-${idx}`} style={{
                    minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column",
                    border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", overflow: "hidden",
                  }}>
                    {s
                      ? <Cell session={s} nameOf={nameOf} onClose={() => void close(s.id)}
                          onDetach={() => detach(s.id)} onExit={() => markExited(s.id)} />
                      : <EmptyCell unplaced={unplaced} nameOf={nameOf} onPick={(sid) => place(idx, sid)} />}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
```

Dan tambahkan komponen ini setelah `GroupTabs`:

```tsx
// Menutup kolom/baris TIDAK mematikan sesi — selnya lenyap, sesinya jatuh ke tray lewat
// placedIds. Karena itu tak ada konfirmasi, sama seperti "lepas".
function GutterX({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={disabled ? "Grid tak boleh menyusut ke nol" : label}
      disabled={disabled} onClick={onClick}
      style={{ all: "unset", display: "grid", placeItems: "center", fontSize: 11, lineHeight: 1,
        color: "var(--text-subtle)", opacity: disabled ? 0.3 : 1,
        cursor: disabled ? "not-allowed" : "pointer" }}>×</button>
  );
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/terminal-screen.test.tsx
```

Expected: PASS — `Tests 17 passed (17)`.

- [ ] **Step 5: Seluruh suite `src` + typecheck**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src typecheck
```

Expected: semua berkas test lolos; typecheck exit 0.

- [ ] **Step 6: Perbarui docs yang tersentuh**

Di `internal/docs/frontend/frontend-implementation.md`, bagian Terminal, ganti kalimat `` `+ Kolom` menambah kolom (kiri↔kanan), `+ Baris` menambah baris (atas↔bawah).`` menjadi:

```markdown
`+ Kolom` menambah kolom (kiri↔kanan), `+ Baris` menambah baris (atas↔bawah); tiap kolom dan baris
punya `×` di gutter untuk menutupnya (grid tak boleh menyusut di bawah 1×1). Menutup kolom/baris
**tidak** mematikan sesi — selnya lenyap dan sesinya jatuh ke tray, karena itu tak ada konfirmasi.
```

- [ ] **Step 7: Commit**

```bash
git add src/src/screens/TerminalScreen.tsx src/test/terminal-screen.test.tsx \
        internal/docs/frontend/frontend-implementation.md
git commit -m "feat(terminal): × per kolom & baris di gutter grid (SPEC-161)"
```

---

### Task 5: Verifikasi nyata di browser + centang checklist

Unit test memakai `TerminalPane` yang di-mock. Yang belum terbukti: gutter tak merusak layout CSS Grid asli, `crypto.randomUUID` ada di browser target, dan pindah tab benar-benar meng-attach ulang tmux tanpa kehilangan scrollback. CLAUDE.md mewajibkan uji nyata di local sebelum task dianggap selesai.

**Files:**
- Modify: `docs/superpowers/plans/2026-07-10-hanoman-terminal-groups-spec-161.md` (centang `- [ ]` → `- [x]`)

- [ ] **Step 1: Boot stack**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm dev
```

Tunggu sampai Vite mencetak URL-nya (biasanya `http://localhost:5173`). `predev` menaikkan Postgres lewat docker compose.

- [ ] **Step 2: Verifikasi migrasi dari key lama**

Di devtools console, sebelum membuka screen Terminal:

```js
localStorage.clear();
localStorage.setItem("hanoman.terminal.layout", JSON.stringify({ rows: 1, cols: 2, cells: [null, null] }));
location.reload();
```

Buka screen **Terminal**. Expected: satu tab bernama **Utama**, grid 1×2. Lalu di console:

```js
localStorage.getItem("hanoman.terminal.layout");  // → null
JSON.parse(localStorage.getItem("hanoman.terminal.workspace")).groups[0].name;  // → "Utama"
```

- [ ] **Step 3: Verifikasi tutup kolom/baris tidak membunuh sesi**

1. Pilih project, klik **Sesi baru** dua kali. Kedua sel terisi; ketik `echo halo` di masing-masing.
2. Klik `×` di atas kolom 2. Expected: kolom lenyap, grid jadi 1×1, sesi kolom 2 muncul sebagai chip di **Belum di grid**.
3. Klik chip itu — ia tak muat (grid penuh). Klik `+ Kolom`, lalu klik chip lagi. Expected: terminal kembali **dengan scrollback `echo halo`-nya utuh**, bukan sesi baru.
4. Konfirmasi di terminal lain bahwa sesi tmux-nya memang tak pernah mati:
   ```bash
   tmux ls
   ```
   Expected: jumlah sesi `hanoman-*` tak berkurang saat kolom ditutup.

- [ ] **Step 4: Verifikasi grup**

1. Klik `+` di tabbar → tab **Grup 2** muncul dan aktif, grid-nya kosong (grid Utama tak terlihat).
2. Klik `✎` → ketik `Debug` → Enter. Tab berganti nama.
3. Buat sesi baru di Debug. Kembali ke **Utama** — pane Debug hilang, pane Utama kembali dengan scrollback utuh.
4. Reload browser. Expected: dua tab, nama, grid, dan sesi kembali persis.
5. Aktifkan **Debug**, klik `×` pada tab-nya. Expected: tab hilang, sesinya muncul di tray, `tmux ls` tetap menunjukkan sesi itu hidup.
6. Dengan satu grup tersisa, `×` pada tab **disabled**.

- [ ] **Step 5: Verifikasi invarian satu-rumah**

Dengan sesi `X` terpasang di grup **Utama**: pindah ke grup lain, taruh `X` dari tray ke sel di sana. Kembali ke **Utama**. Expected: sel lama `X` sudah kosong — `X` tidak tampil di dua grup.

- [ ] **Step 6: Centang checklist plan & commit**

Ubah setiap `- [ ]` yang sudah dikerjakan menjadi `- [x]` di berkas plan ini, lalu:

```bash
git add docs/superpowers/plans/2026-07-10-hanoman-terminal-groups-spec-161.md
git commit -m "docs(spec-161): centang checklist + catat verifikasi browser nyata"
```

Bila ada langkah verifikasi yang gagal: **perbaiki dulu sampai hijau** sebelum menganggap SPEC-161 selesai. Jangan centang langkah yang tak dijalankan.
