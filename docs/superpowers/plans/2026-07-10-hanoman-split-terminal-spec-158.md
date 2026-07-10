# Split Terminal (SPEC-158) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Screen Terminal menampilkan beberapa sesi Claude Code sekaligus dalam grid `rows × cols` — pengguna menambah kolom (kiri↔kanan) dan baris (atas↔bawah), menempatkan sesi hidup ke sel tanpa membuat sesi baru, dan menata ulang tanpa mematikan claude.

**Architecture:** Murni **frontend**. Logika grid (matematika baris-mayor, keunikan sesi, rekonsiliasi) diisolasi ke modul murni `terminal-layout.ts` agar teruji tanpa DOM; `TerminalScreen.tsx` di-refactor dari satu-pane-aktif menjadi CSS Grid pane. `TerminalPane.tsx`, route `/terminal/sessions`, dan `pty.ts` **dipakai apa adanya** — server sudah melayani N sesi + N klien (`clients: Set`, `resize` per-sesi). Nol perubahan `server/**`, kontrak API, skema, migration, dan ADR.

**Tech Stack:** React 18 + TypeScript 5 strict, Vite, Vitest + Testing Library (jsdom), `@xterm/xterm`. Tanpa dependency runtime baru. `localStorage` untuk persistensi layout.

**Spec:** [`docs/superpowers/specs/2026-07-10-hanoman-split-terminal-spec-158-design.md`]
**Objective:** [`internal/docs/operations/spec-158-split-terminal-objective.md`]

## Global Constraints

- **TypeScript strict. TDD:** test gagal dulu, implementasi minimal, hijau, commit. Commit setiap step hijau.
- **Frontend-only.** Jangan sentuh `server/**`, `prisma/**`, `shared/**`, kontrak API. Tak ada migration, tak ada ADR (`CLAUDE.md` mensyaratkan ADR untuk perubahan **skema** — di sini nol perubahan skema). Bila terasa perlu mengubah server, berhenti — desain mengunci bahwa itu tak dibutuhkan; sebuah kebutuhan server berarti asumsi cacat, bukan izin memperluas scope.
- **Guardrail Source of Truth (`hanoman docs verify`).** `src/` yang berubah **tanpa** perubahan doc di `internal/docs/**` akan memblokir Stop hook. Task 4 memperbarui `internal/docs/frontend/frontend-implementation.md` (bagian Terminal) — itu doc yang menutup gerbang; jangan lupa.
- **Test `src` berjalan di jsdom.** Root `pnpm test` mencakup `src` (`vitest.workspace.ts`). Untuk file tunggal: `pnpm --filter ./src exec vitest run <path>`. `localStorage` ada di jsdom — **`localStorage.clear()` di `beforeEach`** tiap test, kalau tidak layout bocor antar test.
- **Satu sesi ≤ satu sel.** Invarian yang menjaga resize tmux tak berkedip. Ditegakkan `setCell` (Task 1), bukan diserahkan ke pemanggil.
- **Sesi hidup di tmux (ADR-0016), selamat dari restart server.** Karena itu layout yang ter-load **direkonsiliasi** terhadap `listSessions()` yang hidup — sel yang sesinya sudah di-kill dikosongkan; sesi `exited` tetap ada di daftar dan tetap terikat.
- **Jangan `git stash`, jangan `git add -A`** — checkout ini dibagi dengan sesi lain. Selalu `git add` path eksplisit.
- **`key` pada `TerminalPane` = identitas sesi.** Memindah sesi antar sel tak boleh mendaur-ulang WebSocket lama; wrapper sel di-`key` dengan `id` sesi (bukan index) supaya pergeseran index saat `+ Kolom` **memindah** subtree, bukan me-remount-nya.

## File Structure

```
src/src/screens/terminal-layout.ts        new    — Layout + addRow/addColumn/setCell/placeFirstEmpty/reconcile/load/save
src/test/terminal-layout.test.ts          new    — unit murni atas terminal-layout
src/src/screens/TerminalScreen.tsx         modify — dari satu-pane-aktif menjadi CSS Grid pane
src/test/terminal-screen.test.tsx          modify — tab → grid; beberapa pane sekaligus; tray/Lepas/Tutup
src/src/screens/TerminalPane.tsx           (tak disentuh — dipakai apa adanya)
internal/docs/frontend/frontend-implementation.md   modify — bagian Terminal: grid, bukan tab
```

---

### Task 1: `terminal-layout.ts` — logika grid murni

**Files:**
- Create: `src/src/screens/terminal-layout.ts`, `src/test/terminal-layout.test.ts`

**Interfaces:**
- Consumes: tak ada.
- Produces:
  - `type Layout = { rows: number; cols: number; cells: (string | null)[] }` — `cells.length === rows*cols`, baris-mayor (`idx = r*cols + c`).
  - `emptyLayout(): Layout` → `{1,1,[null]}`
  - `addRow(l): Layout` — append `cols` null.
  - `addColumn(l): Layout` — rebuild (index bergeser).
  - `setCell(l, idx, id): Layout` — taruh id di idx, kosongkan sel lain yang memegang id; idx di luar rentang → `l` apa adanya.
  - `placeFirstEmpty(l, id): Layout` — taruh di sel kosong pertama; penuh → `l` apa adanya.
  - `reconcile(l, liveIds: Set<string>): Layout` — kosongkan sel yang id-nya bukan anggota `liveIds`.
  - `load(): Layout | null`, `save(l): void` — lewat `localStorage` key `hanoman.terminal.layout`.

- [x] **Step 1: Tulis test yang gagal**

```ts
// src/test/terminal-layout.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  emptyLayout, addRow, addColumn, setCell, placeFirstEmpty, reconcile, load, save,
} from "../src/screens/terminal-layout";

beforeEach(() => localStorage.clear());

describe("terminal-layout", () => {
  it("emptyLayout: 1×1 satu sel kosong", () => {
    expect(emptyLayout()).toEqual({ rows: 1, cols: 1, cells: [null] });
  });

  it("addRow meng-append cols sel & tak menggeser sel lama", () => {
    expect(addRow({ rows: 1, cols: 2, cells: ["a", "b"] }))
      .toEqual({ rows: 2, cols: 2, cells: ["a", "b", null, null] });
  });

  it("addColumn me-rebuild pemetaan baris-mayor (2×2 → 2×3)", () => {
    // baris0=[a,b], baris1=[c,d] → baris0=[a,b,null], baris1=[c,d,null]
    expect(addColumn({ rows: 2, cols: 2, cells: ["a", "b", "c", "d"] }))
      .toEqual({ rows: 2, cols: 3, cells: ["a", "b", null, "c", "d", null] });
  });

  it("setCell menegakkan satu sesi ≤ satu sel (pindah, bukan duplikat)", () => {
    expect(setCell({ rows: 1, cols: 2, cells: ["a", null] }, 1, "a").cells).toEqual([null, "a"]);
  });

  it("setCell idx di luar rentang → layout apa adanya", () => {
    const l = { rows: 1, cols: 1, cells: ["a"] };
    expect(setCell(l, -1, null)).toBe(l);
  });

  it("setCell dengan null hanya mengosongkan idx", () => {
    expect(setCell({ rows: 1, cols: 2, cells: ["a", "b"] }, 0, null).cells).toEqual([null, "b"]);
  });

  it("placeFirstEmpty menaruh di lubang pertama; penuh → no-op", () => {
    expect(placeFirstEmpty({ rows: 1, cols: 2, cells: ["a", null] }, "b").cells).toEqual(["a", "b"]);
    const full = { rows: 1, cols: 1, cells: ["a"] };
    expect(placeFirstEmpty(full, "b")).toBe(full);
  });

  it("reconcile mengosongkan sesi yang lenyap, mempertahankan yang hidup", () => {
    expect(reconcile({ rows: 1, cols: 2, cells: ["a", "b"] }, new Set(["a"])).cells).toEqual(["a", null]);
  });

  it("load/save round-trip lewat localStorage", () => {
    const l = { rows: 2, cols: 2, cells: ["a", null, null, "b"] };
    save(l);
    expect(load()).toEqual(l);
  });

  it("load tanpa data → null", () => {
    expect(load()).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./src exec vitest run test/terminal-layout.test.ts`
Expected: FAIL — cannot resolve `../src/screens/terminal-layout`.

- [x] **Step 3: Implementasi minimal**

```ts
// src/src/screens/terminal-layout.ts
// State layout grid terminal — murni, tanpa React/DOM, agar teruji langsung.
// cells baris-mayor: idx = r*cols + c, panjang selalu rows*cols.
export type Layout = { rows: number; cols: number; cells: (string | null)[] };

export const emptyLayout = (): Layout => ({ rows: 1, cols: 1, cells: [null] });

// + Baris: append satu baris (cols sel kosong). Index sel lama TAK bergeser.
export const addRow = (l: Layout): Layout =>
  ({ ...l, rows: l.rows + 1, cells: [...l.cells, ...Array<string | null>(l.cols).fill(null)] });

// + Kolom: idx = r*cols + c BERGESER saat cols berubah — jadi cells di-rebuild, bukan di-append.
// Menyamakannya dengan addRow (append) akan mengacak isi sel; itu sebabnya keduanya diuji terpisah.
export function addColumn(l: Layout): Layout {
  const cols = l.cols + 1;
  const cells: (string | null)[] = [];
  for (let r = 0; r < l.rows; r++)
    for (let c = 0; c < cols; c++)
      // `?? null`: index literal bertipe `T | undefined` di bawah noUncheckedIndexedAccess.
      cells.push(c < l.cols ? (l.cells[r * l.cols + c] ?? null) : null);
  return { rows: l.rows, cols, cells };
}

// Taruh sesi di sel idx; kosongkan sel lain yang memegang id sama (satu sesi ≤ satu sel).
// id null = kosongkan idx saja. idx di luar rentang → layout apa adanya (mis. detach id tak tertempat).
export function setCell(l: Layout, idx: number, id: string | null): Layout {
  if (idx < 0 || idx >= l.cells.length) return l;
  const cells = l.cells.map((c) => (id !== null && c === id ? null : c));
  cells[idx] = id;
  return { ...l, cells };
}

// Taruh di sel kosong pertama; penuh → layout apa adanya (sesi tinggal di tray).
export function placeFirstEmpty(l: Layout, id: string): Layout {
  const idx = l.cells.indexOf(null);
  return idx === -1 ? l : setCell(l, idx, id);
}

// Sesi yang lenyap dari server (di-kill) dikosongkan. Sesi `exited` TETAP di liveIds
// (listSessions memuat pane mati), jadi ia tetap terikat dan tampil "berakhir".
export const reconcile = (l: Layout, liveIds: Set<string>): Layout =>
  ({ ...l, cells: l.cells.map((c) => (c && liveIds.has(c) ? c : null)) });

const KEY = "hanoman.terminal.layout";
export function load(): Layout | null {
  try { const s = localStorage.getItem(KEY); return s ? (JSON.parse(s) as Layout) : null; }
  catch { return null; }
}
export function save(l: Layout): void {
  try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* mode privat / kuota penuh */ }
}
```

- [x] **Step 4: Jalankan test, pastikan hijau**

Run: `pnpm --filter ./src exec vitest run test/terminal-layout.test.ts`
Expected: PASS (10).

- [x] **Step 5: Commit**

```bash
git add src/src/screens/terminal-layout.ts src/test/terminal-layout.test.ts
git commit -m "feat(spec-158): modul terminal-layout — grid murni (addRow/addColumn/setCell/reconcile)"
```

---

### Task 2: `TerminalScreen` grid — beberapa pane sekaligus

**Files:**
- Modify: `src/src/screens/TerminalScreen.tsx`
- Test: `src/test/terminal-screen.test.tsx`

**Interfaces:**
- Consumes: `terminal-layout` (Task 1); `api.listTerminals/createTerminal/deleteTerminal`, `type TerminalSession` (sudah ada); `TerminalPane` (dipakai apa adanya).
- Produces: `TerminalScreen({ projects })` merender CSS Grid; toolbar `+ Kolom`/`+ Baris`/`Sesi baru`; `Sesi baru` menaruh sesi di sel kosong pertama; sel terisi me-mount `<TerminalPane>` dengan tombol Tutup (`×`, kill lewat `deleteTerminal`). Empty state hanya saat layout default 1×1 kosong **dan** tak ada sesi.

**Catatan:** ini menggantikan strip tab. Test lama berbasis `role="tab"` **ditulis ulang** — tak ada lagi tab.

- [x] **Step 1: Tulis test yang gagal (ganti isi file test)**

Ganti seluruh `src/test/terminal-screen.test.tsx`:

```tsx
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TerminalScreen } from "../src/screens/TerminalScreen";

// TerminalPane membuka WebSocket + xterm (butuh canvas). jsdom tak punya keduanya; yang
// diuji di sini adalah komposisi grid, bukan rendering terminalnya.
vi.mock("../src/screens/TerminalPane", () => ({
  TerminalPane: ({ sessionId }: { sessionId: string }) => <div data-testid="pane">{sessionId}</div>,
}));
const listTerminals = vi.fn();
const createTerminal = vi.fn();
const deleteTerminal = vi.fn();
vi.mock("../src/api/client", () => ({
  api: {
    listTerminals: (...a: unknown[]) => listTerminals(...a),
    createTerminal: (...a: unknown[]) => createTerminal(...a),
    deleteTerminal: (...a: unknown[]) => deleteTerminal(...a),
  },
}));

const projects = [{ id: "p1", name: "hanoman" }];
const LKEY = "hanoman.terminal.layout";

beforeEach(() => {
  localStorage.clear();
  listTerminals.mockReset(); createTerminal.mockReset(); deleteTerminal.mockReset();
  deleteTerminal.mockResolvedValue(undefined);
});

describe("TerminalScreen (grid)", () => {
  it("empty state saat tak ada sesi & layout default kosong", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} />);
    expect(await screen.findByText("Belum ada sesi terminal")).toBeInTheDocument();
    expect(screen.queryByTestId("pane")).toBeNull();
  });

  it("me-mount satu pane per sel terisi — beberapa sekaligus", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 2, cells: ["aaaa1111", "bbbb2222"] }));
    listTerminals.mockResolvedValue([
      { id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false },
      { id: "bbbb2222", projectId: "p1", cwd: "/repo", exited: false },
    ]);
    render(<TerminalScreen projects={projects} />);
    await waitFor(() => expect(screen.getAllByTestId("pane")).toHaveLength(2));
    expect(screen.getByText("aaaa1111")).toBeInTheDocument();
    expect(screen.getByText("bbbb2222")).toBeInTheDocument();
  });

  it("rekonsiliasi: sel yang sesinya sudah lenyap tak me-mount pane", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 2, cells: ["aaaa1111", "dead0000"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await waitFor(() => expect(screen.getAllByTestId("pane")).toHaveLength(1));
  });

  it("Sesi baru menaruh sesi di sel kosong pertama", async () => {
    listTerminals.mockResolvedValue([]);
    createTerminal.mockResolvedValue({ id: "newsesi1" });
    render(<TerminalScreen projects={projects} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Sesi baru" }));
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("newsesi1"));
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./src exec vitest run test/terminal-screen.test.tsx`
Expected: FAIL — masih render tab; `getAllByTestId("pane")` hanya 1 (tab aktif), grid belum ada.

> **Catatan lingkungan.** Shell eksekusi punya `NODE_ENV=production` di environment-nya (bukan
> milik repo). React resolve ke build produksi dan `@testing-library/react` melempar
> `act(...) is not supported in production builds`, pada test **apa pun** yang me-render,
> termasuk test lama yang tak tersentuh SPEC-158 (`app-flows.test.tsx`). Bukan bug SPEC-158.
> Perbaikan: jalankan test `src` dengan `NODE_ENV=test` di depan (atau `export NODE_ENV=test`
> sekali per sesi shell) — dipakai konsisten mulai step ini.

- [x] **Step 3: Implementasi — tulis ulang `TerminalScreen.tsx`**

> **Deviasi Execute.** Implementasi mentah di plan ini menyalakan dua bug, keduanya ketahuan
> lewat test/typecheck di step berikutnya, bukan ditebak di muka:
> 1. **Efek rekonsiliasi menembak sebelum `listTerminals()` resolve.** Render pertama punya
>    `sessions=[]`; efek yang bergantung pada `[sessions]` langsung jalan dengan `liveIds` kosong
>    dan mengosongkan **seluruh** layout yang baru dipulihkan dari `localStorage`, sebelum data
>    sesi asli sempat datang. Ditahan dengan flag `loaded` — reconcile hanya jalan setelah
>    `listTerminals()` (atau kegagalannya) selesai.
> 2. **Tombol "Sesi baru" dobel di empty state.** Toolbar (selalu tampil) dan `StateBlock` action
>    sama-sama berlabel "Sesi baru" — `getByRole("button", { name: "Sesi baru" })` menabrak dua
>    elemen. Ini **sudah ada sebelum SPEC-158** (kode lama punya pola identik), hanya belum pernah
>    ketahuan karena tak ada test yang benar-benar mengklik tombolnya. Aksi `StateBlock` dilepas;
>    toolbar sudah cukup sebagai satu-satunya jalan membuka sesi baru.
>
> Kode di bawah ini **sudah memuat kedua perbaikan** (bukan draft awal) — lihat komentar
> `// Ditahan sampai loaded` dan `// Tanpa action` di berkas nyata.

Ganti seluruh isi `src/src/screens/TerminalScreen.tsx`:

Ganti seluruh isi `src/src/screens/TerminalScreen.tsx`:

```tsx
import React from "react";
import { Button, Select, StateBlock } from "../ds";
import { api, type TerminalSession } from "../api/client";
import { TerminalPane } from "./TerminalPane";
import * as L from "./terminal-layout";

export function TerminalScreen({ projects }: { projects: { id: string; name: string }[] }) {
  const [sessions, setSessions] = React.useState<TerminalSession[]>([]);
  const [layout, setLayout] = React.useState<L.Layout>(() => L.load() ?? L.emptyLayout());
  const [project, setProject] = React.useState(projects[0]?.id ?? "");

  const [loaded, setLoaded] = React.useState(false);
  React.useEffect(() => {
    api.listTerminals().then(setSessions).catch(() => setSessions([])).finally(() => setLoaded(true));
  }, []);

  // Sesi hidup di tmux dan selamat dari restart server (ADR-0016): layout ter-load bisa
  // menunjuk sesi yang masih hidup (disambung ulang) atau yang sudah di-kill (dikosongkan).
  // Ditahan sampai `loaded`: sebelum listTerminals() resolve, `sessions` masih [] dan
  // rekonsiliasi dini akan mengosongkan layout yang baru saja dipulihkan dari localStorage.
  React.useEffect(() => {
    if (!loaded) return;
    setLayout((l) => L.reconcile(l, new Set(sessions.map((s) => s.id))));
  }, [loaded, sessions]);

  React.useEffect(() => { L.save(layout); }, [layout]);

  const byId = (id: string) => sessions.find((s) => s.id === id) ?? null;
  const nameOf = (pid: string) => projects.find((p) => p.id === pid)?.name ?? pid;

  async function openNew() {
    if (!project) return;
    const { id } = await api.createTerminal(project);
    setSessions((s) => [...s, { id, projectId: project, cwd: "", exited: false }]);
    setLayout((l) => L.placeFirstEmpty(l, id));
  }

  // Tutup = perilaku hari ini: kill sesi. Sel-nya dikosongkan oleh efek rekonsiliasi.
  async function close(id: string) {
    await api.deleteTerminal(id).catch(() => {});
    setSessions((s) => s.filter((x) => x.id !== id));
  }

  const markExited = React.useCallback((id: string) => {
    setSessions((s) => s.map((x) => (x.id === id ? { ...x, exited: true } : x)));
  }, []);

  const showEmpty = layout.rows === 1 && layout.cols === 1 && !layout.cells[0] && sessions.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "calc(100vh - 180px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Button size="sm" variant="ghost" onClick={() => setLayout(L.addColumn)}>+ Kolom</Button>
        <Button size="sm" variant="ghost" onClick={() => setLayout(L.addRow)}>+ Baris</Button>
        <div style={{ flex: 1, minWidth: 0 }} />
        <Select size="sm" value={project} onChange={(e) => setProject(e.target.value)}
          options={projects.map((p) => ({ value: p.id, label: p.name }))} />
        <Button size="sm" leftIcon="plus" onClick={() => void openNew()}>Sesi baru</Button>
      </div>

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
                  ? <Cell session={s} nameOf={nameOf} onClose={() => void close(s.id)} onExit={() => markExited(s.id)} />
                  : <EmptyCell />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Cell({ session, nameOf, onClose, onExit }: {
  session: TerminalSession; nameOf: (pid: string) => string;
  onClose: () => void; onExit: (code: number) => void;
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

function EmptyCell() {
  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", color: "var(--text-subtle)", fontSize: 12 }}>
      kosong
    </div>
  );
}
```

- [x] **Step 4: Jalankan test, pastikan hijau**

Run: `NODE_ENV=test pnpm --filter ./src exec vitest run test/terminal-screen.test.tsx`
Expected: PASS (4).

- [x] **Step 5: Typecheck**

Run: `pnpm --filter ./src typecheck`
Expected: PASS. (Butuh perbaikan `?? null` di `addColumn` — lihat Task 1 di atas, disatukan ke
commit Task 2 karena di sinilah typecheck menangkapnya.)

- [x] **Step 6: Commit**

```bash
git add src/src/screens/TerminalScreen.tsx src/test/terminal-screen.test.tsx src/src/screens/terminal-layout.ts
git commit -m "feat(spec-158): TerminalScreen grid — beberapa pane sekaligus, + Kolom/+ Baris"
```

---

### Task 3: Tempatkan sesi hidup (picker + tray) & aksi Lepas

**Files:**
- Modify: `src/src/screens/TerminalScreen.tsx`
- Test: `src/test/terminal-screen.test.tsx`

**Interfaces:**
- Consumes: state `sessions`/`layout` + helper Task 2; `L.setCell`, `L.placeFirstEmpty`.
- Produces: sel kosong menjadi **picker** sesi yang belum tertempat; **tray** chip untuk sesi belum tertempat (klik → sel kosong pertama; `×` → kill); tombol **Lepas** per sel (unbind, sesi tetap hidup, `deleteTerminal` **tidak** dipanggil).

**Kenapa dua aksi:** memindahkan pane dari tampilan (Lepas) berbeda dari mematikan claude (Tutup). Lepas menata split tanpa kehilangan pekerjaan; Tutup = perilaku `close()` hari ini.

- [x] **Step 1: Tulis test yang gagal (tambahkan ke describe)**

Tambahkan di `src/test/terminal-screen.test.tsx`, di dalam `describe("TerminalScreen (grid)", …)`:

```tsx
  it("menempatkan sesi bebas dari tray ke sel kosong pertama", async () => {
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    const chip = await screen.findByRole("button", { name: /aaaa11/ }); // chip tray
    fireEvent.click(chip);
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("aaaa1111"));
  });

  it("picker sel kosong menempatkan sesi bebas", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 2, cells: [null, null] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    const picker = (await screen.findAllByLabelText("Pilih sesi untuk sel"))[0];
    fireEvent.change(picker, { target: { value: "aaaa1111" } });
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("aaaa1111"));
  });

  it("Lepas mengosongkan sel tanpa mematikan sesi", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    fireEvent.click(screen.getByText("lepas"));
    await waitFor(() => expect(screen.queryByTestId("pane")).toBeNull());
    expect(deleteTerminal).not.toHaveBeenCalled();
    // sesi masih ada → muncul kembali sebagai chip tray
    expect(screen.getByRole("button", { name: /aaaa11/ })).toBeInTheDocument();
  });

  it("Tutup (×) memanggil deleteTerminal", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    fireEvent.click(screen.getByLabelText("Tutup sesi aaaa1111"));
    await waitFor(() => expect(deleteTerminal).toHaveBeenCalledWith("aaaa1111"));
  });
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `NODE_ENV=test pnpm --filter ./src exec vitest run test/terminal-screen.test.tsx`
Expected: FAIL — belum ada chip tray/picker/"lepas". (3 dari 8 gagal; 5 lama tetap hijau.)

- [x] **Step 3: Implementasi — tambahkan tray, picker, dan Lepas**

Di `TerminalScreen.tsx`, tambahkan handler di dalam komponen (setelah `close`):

```tsx
  const place = (idx: number, id: string) => setLayout((l) => L.setCell(l, idx, id));
  const placeFirst = (id: string) => setLayout((l) => L.placeFirstEmpty(l, id));
  const detach = (id: string) => setLayout((l) => L.setCell(l, l.cells.indexOf(id), null));

  const placedIds = new Set(layout.cells.filter((c): c is string => c !== null));
  const unplaced = sessions.filter((s) => !placedIds.has(s.id));
```

Sisipkan **tray** tepat sebelum blok `{showEmpty ? …}` (hanya saat ada sesi belum tertempat):

```tsx
      {unplaced.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>Belum di grid:</span>
          {unplaced.map((s) => (
            <span key={s.id} style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px",
              borderRadius: "var(--radius-sm)", background: "var(--bone-200)",
              border: "1px solid var(--border-hair)", fontFamily: "var(--font-mono)", fontSize: 11,
            }}>
              <button onClick={() => placeFirst(s.id)} title="Taruh di sel kosong pertama"
                style={{ all: "unset", cursor: "pointer" }}>
                {(s.runId ? `${s.runId} · resume` : nameOf(s.projectId))} · {s.id.slice(0, 6)}
              </button>
              <span aria-label={`Tutup sesi ${s.id}`} onClick={() => void close(s.id)}
                style={{ cursor: "pointer", color: "var(--text-subtle)" }}>×</span>
            </span>
          ))}
        </div>
      )}
```

Ganti pemakaian `<EmptyCell />` menjadi picker ber-konteks:

```tsx
                  : <EmptyCell unplaced={unplaced} nameOf={nameOf} onPick={(sid) => place(idx, sid)} />}
```

Ganti definisi `EmptyCell`:

```tsx
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

Tambahkan tombol **Lepas** di header `Cell` — beri prop `onDetach` dan render sebelum `×`:

```tsx
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
      <div style={{ flex: 1, minHeight: 0 }}>
        <TerminalPane key={session.id} sessionId={session.id} onExit={onExit} />
      </div>
    </>
  );
}
```

Dan teruskan `onDetach` di pemakaian `Cell`:

```tsx
                  ? <Cell session={s} nameOf={nameOf} onClose={() => void close(s.id)}
                      onDetach={() => detach(s.id)} onExit={() => markExited(s.id)} />
```

- [x] **Step 4: Jalankan test, pastikan hijau**

Run: `NODE_ENV=test pnpm --filter ./src exec vitest run test/terminal-screen.test.tsx`
Expected: PASS (8).

- [x] **Step 5: Typecheck**

Run: `pnpm --filter ./src typecheck`
Expected: PASS. (`(await screen.findAllByLabelText(…))[0]` butuh `!` non-null di bawah
`noUncheckedIndexedAccess` — konvensi yang sudah dipakai test lain di paket ini, mis.
`project-detail.test.tsx:37`.)

- [x] **Step 6: Commit**

```bash
git add src/src/screens/TerminalScreen.tsx src/test/terminal-screen.test.tsx
git commit -m "feat(spec-158): tempatkan sesi hidup (picker + tray) & aksi Lepas vs Tutup"
```

---

### Task 4: Docs Source of Truth, guardrail, suite penuh, smoke nyata

**Files:**
- Modify: `internal/docs/frontend/frontend-implementation.md` (bagian Terminal)

- [x] **Step 1: Perbarui bagian Terminal di frontend-implementation.md**

Ganti paragraf di bawah `## Terminal (sesi Claude Code interaktif)` (baris ~113-119) menjadi:

```markdown
`TerminalScreen` menampilkan sesi dalam **grid `rows × cols`** (CSS Grid): `+ Kolom` menambah
kolom (kiri↔kanan), `+ Baris` menambah baris (atas↔bawah). Tiap sel me-mount satu `TerminalPane`
yang membuka WebSocket ke `/api/terminal/sessions/:id/ws`; sel kosong menampilkan picker sesi yang
belum tertempat, dan sesi yang belum di grid duduk di **tray**. Satu sesi menempati **paling banyak
satu sel** (menjaga resize tmux tak berkedip). Dua aksi per sel: **Lepas** (unbind, sesi tetap
hidup) dan **Tutup/`×`** (kill lewat `DELETE`). Layout (`{rows,cols,cells}`) disimpan di
`localStorage` dan **direkonsiliasi** ke `listSessions()` saat mount — sesi hidup di tmux dan
selamat dari restart server (ADR-0016), jadi sel yang sesinya masih hidup tersambung ulang dan sel
yang sesinya sudah di-kill dikosongkan. Logika grid murni ada di `screens/terminal-layout.ts`
(teruji tanpa DOM). Ini bukan chat buatan sendiri — yang dirender adalah TUI Claude Code asli, byte
demi byte. Terminal di `RunsScreen` adalah hal yang berbeda: interpreter perintah
(`status`/`plan`/`steer`) untuk run terjadwal, bukan TTY. Nol perubahan server: route dan `pty.ts`
dipakai apa adanya (SPEC-158).
```

- [x] **Step 2: Guardrail Source of Truth**

Run: `pnpm --filter ./cli build && node cli/dist/hanoman.js docs verify`
Expected: `Source of Truth clean · coverage 100%`. (Bila merah karena `src/` berubah tanpa doc —
pastikan Step 1 tersimpan.)

- [x] **Step 3: Suite penuh + typecheck + build web**

```bash
pnpm test                       # shared + server + src + runner + cli (vitest.workspace.ts)
pnpm -r typecheck
pnpm --filter ./src build       # tsc && vite build — pastikan grid mem-build bersih
```
Expected: semua PASS.

> **Catatan Execute.** Worktree ini butuh `prisma generate` sekali (Prisma Client belum
> tergenerate) sebelum suite server bisa jalan sama sekali — tak terkait SPEC-158. Dua run
> pertama `pnpm test` gagal acak di `triggers-settings.route.test.ts` lalu `terminal.route.test.ts`
> dengan kegagalan **berbeda** tiap kali; terverifikasi kontensi eksternal, bukan regresi:
> sesi tmux live lain (`hanoman-c5ff8c21`, socket default `hanoman`) sedang berjalan di mesin yang
> sama saat suite jalan. Run ketiga: **507 passed | 3 skipped**, bersih. Nol file `server/**`
> tersentuh sepanjang SPEC-158 — kegagalan itu tak mungkin berasal dari perubahan ini.

- [x] **Step 4: Smoke lokal nyata (CLAUDE.md) — grid hidup di browser**

RTL me-mock `TerminalPane`, jadi yang **belum** terbukti adalah beberapa xterm hidup berdampingan.
Fitur ini tak menambah endpoint — verifikasinya di UI, bukan `curl`. Boot dengan DB scratch (feature
tak mengubah skema, migrasi saat ini cukup) dan **claude bin palsu** supaya tak menyalakan claude asli:

```bash
docker compose up -d --wait
docker exec hanoman-db-1 psql -U hanoman -d hanoman -c 'CREATE DATABASE hanoman_smoke OWNER hanoman;'
DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman_smoke' pnpm --filter ./server exec prisma migrate deploy
lsof -nP -iTCP -sTCP:LISTEN     # pilih port bebas (8787/8799 sudah dipakai instance lain)
DATABASE_URL='…/hanoman_smoke' PORT=8850 HANOMAN_CLAUDE_BIN=/bin/bash HANOMAN_TMUX_SOCKET=smoke158 \
  pnpm --filter ./server exec tsx src/server.ts &
lsof -nP -iTCP:8850 -sTCP:LISTEN   # pastikan PID-nya milikmu
pnpm --filter ./src dev &          # Vite; proxy /api sudah ws:true
```

Buat satu project menunjuk repo nyata, lalu di browser (`http://localhost:5173`, screen **Terminal**):

| # | Aksi | Harapan |
|---|------|---------|
| 1 | `POST /api/projects` repoDir = worktree ini | `201` |
| 2 | Klik `+ Kolom` | grid jadi 2 sel |
| 3 | `Sesi baru` ×2 | dua pane `bash` berdampingan, masing-masing menerima ketikan **independen** |
| 4 | Reload browser | grid & kedua sesi kembali (localStorage + sesi tmux selamat) |
| 5 | `Lepas` satu sel | pane hilang dari grid; sesi muncul di **tray**; masih hidup |
| 6 | Klik chip tray | sesi kembali menempati sel kosong |
| 7 | `×` pada satu sel | sesi mati (hilang dari tray & grid) |
| 8 | `+ Baris` lalu taruh sesi | baris kedua muncul di bawah |

Bersihkan: hentikan server & Vite, `tmux -L smoke158 kill-server`, `DROP DATABASE hanoman_smoke`.

> **Jangan `POST /runs`** saat smoke bila ada worker dev hidup — itu mengeksekusi run background.

> **Deviasi Execute — dijalankan lewat headless Chromium (Playwright), bukan browser manusia.**
> Tak ada `chromium-cli`/browser interaktif di sesi ini; `playwright` (v1.59.1, sudah terpasang
> global di `/opt/homebrew/lib/node_modules/playwright`, Chromium sudah ter-download) dipakai
> lewat skrip driver sekali-pakai — bukan sekadar `curl`, karena yang diverifikasi adalah dua
> `xterm` hidup berdampingan, sesuatu yang cuma kelihatan lewat rendering nyata.
>
> **Perbaikan mekanis yang dibutuhkan, di luar SPEC-158:**
> - Background job (`&` + `nohup`) mati begitu tool call berikutnya berjalan, sekalipun `nohup` —
>   server/Vite harus di-boot lewat `run_in_background` tool, bukan `&` shell biasa.
> - `HANOMAN_CLAUDE_BIN=/bin/bash` salah pilihan: bash membaca `--dangerously-skip-permissions`
>   sebagai opsi tak dikenal dan keluar (exit 2) seketika, semua pane langsung "berakhir". Dipakai
>   `server/test/fixtures/fake-claude.sh` (fixture repo yang sudah ada, dipakai `terminal.route.test.ts`)
>   — mencetak argv lalu `exec cat`, sehingga pane tetap hidup dan meng-echo ketikan.
> - `vite.config.ts` men-hardcode proxy `/api` ke `:8787` — port itu sudah dipakai instance hanoman
>   lain yang hidup (dikonfirmasi `lsof` + memori sesi). Diedit sementara ke `:8850` (port server
>   smoke), diuji, **lalu dikembalikan persis semula (`git checkout --`) sebelum Step 5** — tak
>   pernah masuk commit.
> - Reload penuh membawa app kembali ke screen **Overview** (tak ada URL routing per-screen) — ini
>   bukan bug SPEC-158; skenario "reload lalu grid kembali" diuji dengan klik "Terminal" lagi
>   setelah reload, persis seperti pengguna asli akan lakukan.
> - Socket tmux default (`hanoman`) sedang dipegang sesi live lain di mesin ini
>   (`hanoman-c5ff8c21`) — smoke **wajib** `HANOMAN_TMUX_SOCKET=smoke158` supaya tak pernah
>   menyentuhnya. Dikonfirmasi utuh (`tmux -L hanoman list-sessions`) sebelum dan sesudah.
>
> **Hasil, seluruh 8 baris tabel di atas diverifikasi lewat screenshot nyata:**
> baris 1 (`201`), baris 2 (grid 1×2), baris 3 (dua pane `fake-claude.sh` berdampingan — mengetik
> `echo FIRST_PANE` di pane kiri dan `echo SECOND_PANE` di pane kanan, tiap teks **hanya** muncul di
> pane yang dituju), baris 4 (reload + klik "Terminal" → kedua pane tersambung ulang **dengan**
> scrollback lengkapnya, dari `localStorage` + sesi tmux yang selamat), baris 5 (`Lepas` mengosongkan
> sel, sesi pindah ke tray, tetap hidup), baris 6 (klik chip tray menempati sel kosong lagi), baris 7
> (`×` mematikan sesi, hilang dari tray **dan** grid), baris 8 (`+ Baris` menambah baris kedua kosong,
> sesi sisa ditempatkan). **Nol console/page error** di seluruh alur. Screenshot & skrip driver hidup
> di `/tmp` (di luar repo), bukan bagian dari commit.

- [x] **Step 5: Commit**

```bash
git add internal/docs/frontend/frontend-implementation.md
git commit -m "docs(spec-158): frontend-implementation — Terminal kini grid split, bukan tab"
```

---

## Self-review

**Cakupan spec (design → task).** Modul layout murni (`terminal-layout.ts`) → Task 1. Grid `rows×cols`
+ `+ Kolom`/`+ Baris` + reconcile + persist localStorage → Task 2. "Sesi hidup ditempatkan tanpa buat
baru" (picker + tray) + "Lepas vs Tutup" → Task 3. Docs SoT + guardrail + smoke nyata → Task 4.
`TerminalPane`/route/`pty.ts` sengaja **tak** disentuh (design: nol perubahan server). Nol
migration/ADR — tak ada task skema, sesuai objective.

**Konsistensi tipe.** `Layout` & tanda tangan (`addRow/addColumn/setCell/placeFirstEmpty/reconcile/
load/save`) identik di Task 1 (definisi), Task 2 (`L.load/emptyLayout/reconcile/placeFirstEmpty/
addColumn/addRow`), dan Task 3 (`L.setCell/placeFirstEmpty`). `setCell(l, idx, id)` menerima `idx`
di luar rentang (dipakai `detach` via `indexOf` yang bisa `-1`). `Cell` prop bertambah `onDetach`
di Task 3 — dipakai konsisten di pemanggilnya. Key `TerminalPane` = `session.id` di kedua versi.

**Yang sengaja tidak dikerjakan.** Divider yang bisa di-drag / nesting rekursif; `− Kolom`/`− Baris`
(menyusut dimensi — Lepas/Tutup sudah mengosongkan sel); drag-and-drop antar sel (D&D dibatasi ke
Brainstorm, commit 6d15c25); persistensi ke DB; batas jumlah pane; optimasi poll `pty.ts` pada
puluhan pane (langit-langit lama yang tercatat di `pty.ts:165`, bukan milik SPEC-158).
```
