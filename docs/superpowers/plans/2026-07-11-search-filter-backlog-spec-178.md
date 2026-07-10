# Search Filter Backlog (SPEC-178) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax (`- [x]` when done) for tracking.

**Goal:** Tambahkan pencarian teks + filter stage + filter prioritas ke toolbar backlog, semua client-side.

**Architecture:** `BacklogScreen` sudah memfilter list `backlog` di sisi klien (`backlog.filter(...)`). Tambahkan tiga state lokal (`q`, `stageFilter`, `prioFilter`), perpanjang rantai `filtered`, dan pindah kontrol penyaring ke toolbar baris kedua. Tak ada perubahan API/DB/shared.

**Tech Stack:** React + TypeScript (Vite), design-system `Input`/`Select`, vitest + @testing-library/react (jsdom, `fireEvent`).

## Global Constraints

- TypeScript strict.
- Tanpa dependensi baru — pakai `Input` (leftIcon `search`) & `Select` dari `../ds`.
- Perubahan terisolasi di `src/src/screens/BacklogScreen.tsx` + tesnya. Tidak menyentuh server/runner/shared.
- Update `internal/docs` yang tersentuh **dalam commit yang sama**.
- Filter project tetap *lifted* ke props (`projectFilter`/`onProjectFilter`, SPEC-146) — jangan diubah jadi state lokal.
- Field pencarian: `id + title + objective`, substring case-insensitive. Tanpa debounce.

---

### Task 1: Search + stage + priority filters di BacklogScreen

**Files:**
- Modify: `src/src/screens/BacklogScreen.tsx` (import `Input`; state; `filtered`; `usePaged` key; toolbar 2 baris; reset empty-state)
- Test: `src/test/search-filter.test.tsx` (baru)
- Modify: `internal/docs/frontend/frontend-implementation.md` (dokumentasi toolbar filter)

**Interfaces:**
- Consumes: `BacklogScreen` props yang sudah ada (`backlog: Spec[]`, `projects`, `projectFilter`, `onProjectFilter`). Konstanta modul yang sudah ada: `B_STAGES` (`{key,label}[]`).
- Produces: tidak ada ekspor baru. Test hook DOM: `Input` dengan `placeholder="Cari backlog…"`, `Select` dengan `aria-label="Filter stage"` dan `aria-label="Filter prioritas"`.

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/search-filter.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: [] })) },
  ApiError: class extends Error {},
}));
import { BacklogScreen } from "../src/screens/BacklogScreen";

const spec = (over: Record<string, unknown>) => ({
  id: "SPEC-1", projectId: "arta", title: "t", source: "brief",
  stage: "planned", priority: "sedang", author: "a", objective: "", payload: null, branchFrom: null,
  ...over,
});

function renderBacklog(backlog: unknown[]) {
  return render(
    <BacklogScreen backlog={backlog as never}
      projects={[{ id: "arta", name: "arta" }] as never}
      projectFilter="all" onProjectFilter={() => {}} />
  );
}

describe("search + filter backlog (SPEC-178)", () => {
  it("search mencocokkan judul", () => {
    renderBacklog([
      spec({ id: "SPEC-1", title: "Login page" }),
      spec({ id: "SPEC-2", title: "Export CSV" }),
    ]);
    fireEvent.change(screen.getByPlaceholderText("Cari backlog…"), { target: { value: "csv" } });
    expect(screen.queryByText("SPEC-1")).toBeNull();
    expect(screen.getAllByText("SPEC-2").length).toBeGreaterThan(0);
  });

  it("search mencocokkan objective (bukan hanya judul/id)", () => {
    renderBacklog([
      spec({ id: "SPEC-1", title: "A", objective: "perbaiki tombol simpan" }),
      spec({ id: "SPEC-2", title: "B", objective: "tambah ekspor pdf" }),
    ]);
    fireEvent.change(screen.getByPlaceholderText("Cari backlog…"), { target: { value: "ekspor" } });
    expect(screen.queryByText("SPEC-1")).toBeNull();
    expect(screen.getAllByText("SPEC-2").length).toBeGreaterThan(0);
  });

  it("filter stage menyaring per stage", () => {
    renderBacklog([
      spec({ id: "SPEC-1", stage: "brainstorming" }),
      spec({ id: "SPEC-2", stage: "planned" }),
    ]);
    fireEvent.change(screen.getByLabelText("Filter stage"), { target: { value: "planned" } });
    expect(screen.queryByText("SPEC-1")).toBeNull();
    expect(screen.getAllByText("SPEC-2").length).toBeGreaterThan(0);
  });

  it("filter prioritas menyaring per prioritas", () => {
    renderBacklog([
      spec({ id: "SPEC-1", priority: "tinggi" }),
      spec({ id: "SPEC-2", priority: "rendah" }),
    ]);
    fireEvent.change(screen.getByLabelText("Filter prioritas"), { target: { value: "rendah" } });
    expect(screen.queryByText("SPEC-1")).toBeNull();
    expect(screen.getAllByText("SPEC-2").length).toBeGreaterThan(0);
  });

  it("kombinasi search + stage + prioritas = irisan", () => {
    renderBacklog([
      spec({ id: "SPEC-1", title: "alpha", stage: "planned", priority: "tinggi" }),
      spec({ id: "SPEC-2", title: "alpha", stage: "planned", priority: "rendah" }),
      spec({ id: "SPEC-3", title: "beta", stage: "planned", priority: "tinggi" }),
    ]);
    fireEvent.change(screen.getByPlaceholderText("Cari backlog…"), { target: { value: "alpha" } });
    fireEvent.change(screen.getByLabelText("Filter stage"), { target: { value: "planned" } });
    fireEvent.change(screen.getByLabelText("Filter prioritas"), { target: { value: "tinggi" } });
    expect(screen.getAllByText("SPEC-1").length).toBeGreaterThan(0);
    expect(screen.queryByText("SPEC-2")).toBeNull();
    expect(screen.queryByText("SPEC-3")).toBeNull();
  });

  it("tanpa filter menampilkan semua (tak menyaring)", () => {
    renderBacklog([spec({ id: "SPEC-1" }), spec({ id: "SPEC-2" })]);
    expect(screen.getAllByText("SPEC-1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("SPEC-2").length).toBeGreaterThan(0);
  });
});
```

- [x] **Step 2: Jalankan test → pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/web test -- search-filter`
(atau dari `src/`: `pnpm test -- search-filter`)
Expected: FAIL — `getByPlaceholderText("Cari backlog…")` melempar karena input belum ada.

- [x] **Step 3: Tambah import `Input`**

Di `src/src/screens/BacklogScreen.tsx`, ubah baris import DS (baris ~4-7) untuk menyertakan `Input`:

```tsx
import {
  Card, Badge, Tabs, Select, Button, IconButton, Icon, usePaged, Pager, Modal, StateBlock, Input,
  LIST_SCROLL_STYLE, LIST_SCREEN_STYLE, FIXED_ROW_STYLE
} from "../ds";
```

- [x] **Step 4: Tambah state + perpanjang `filtered` + `usePaged` key**

Ganti blok state & `filtered` (baris ~441-451). Dari:

```tsx
  const [tab, setTab] = React.useState("all");
  const [view, setView] = React.useState("grid");
  // Filter project dimiliki App (SPEC-146): detail project membuka layar ini sudah tersaring.
  const proj = projectFilter;
  const setProj = onProjectFilter;
  // keep the id, not the object: backlog re-polls and the stage bar must stay live
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const projOptions = projects || [...new Set(backlog.map((s) => s.projectId))].map((id) => ({ id, name: id }));
  const filtered = backlog.filter((s) =>
    (tab === "all" || s.source === tab) && (proj === "all" || s.projectId === proj));
  const pg = usePaged(filtered, pageSize, tab + "|" + proj);
```

Menjadi:

```tsx
  const [tab, setTab] = React.useState("all");
  const [view, setView] = React.useState("grid");
  // SPEC-178 · search + filter stage/prioritas, semua view-local (tak diangkat ke App).
  const [q, setQ] = React.useState("");
  const [stageFilter, setStageFilter] = React.useState("all");
  const [prioFilter, setPrioFilter] = React.useState("all");
  // Filter project dimiliki App (SPEC-146): detail project membuka layar ini sudah tersaring.
  const proj = projectFilter;
  const setProj = onProjectFilter;
  // keep the id, not the object: backlog re-polls and the stage bar must stay live
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const projOptions = projects || [...new Set(backlog.map((s) => s.projectId))].map((id) => ({ id, name: id }));
  const needle = q.trim().toLowerCase();
  const filtered = backlog.filter((s) =>
    (tab === "all" || s.source === tab) &&
    (proj === "all" || s.projectId === proj) &&
    (stageFilter === "all" || s.stage === stageFilter) &&
    (prioFilter === "all" || s.priority === prioFilter) &&
    (needle === "" || (s.id + " " + s.title + " " + s.objective).toLowerCase().includes(needle)));
  const pg = usePaged(filtered, pageSize, [tab, proj, stageFilter, prioFilter, needle].join("|"));
```

- [x] **Step 5: Toolbar 2 baris**

Ganti blok header toolbar (baris ~454-464). Dari:

```tsx
      <div style={{ ...FIXED_ROW_STYLE, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <Tabs variant="pill" value={tab} onChange={setTab} tabs={[
          { value: "all", label: "Semua spec" }, { value: "brief", label: "Dari brief" }, { value: "qa", label: "Dari QA" },
        ]} />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Select size="sm" value={proj} onChange={(e) => setProj(e.target.value)}
            options={[{ value: "all", label: "Semua project" }].concat(projOptions.map((p) => ({ value: p.id, label: p.name })))} />
          <Tabs variant="pill" value={view} onChange={setView} tabs={VIEWS} aria-label="Mode tampilan" />
          <span className="hn-eyebrow">{filtered.length} spec</span>
        </div>
      </div>
```

Menjadi:

```tsx
      <div style={{ ...FIXED_ROW_STYLE, marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <Tabs variant="pill" value={tab} onChange={setTab} tabs={[
            { value: "all", label: "Semua spec" }, { value: "brief", label: "Dari brief" }, { value: "qa", label: "Dari QA" },
          ]} />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Tabs variant="pill" value={view} onChange={setView} tabs={VIEWS} aria-label="Mode tampilan" />
            <span className="hn-eyebrow">{filtered.length} spec</span>
          </div>
        </div>
        {/* SPEC-178 · baris penyaring: search + project + stage + prioritas. */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Input size="sm" leftIcon="search" placeholder="Cari backlog…" aria-label="Cari backlog"
            value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: "1 1 220px" }} />
          <Select size="sm" value={proj} onChange={(e) => setProj(e.target.value)}
            options={[{ value: "all", label: "Semua project" }].concat(projOptions.map((p) => ({ value: p.id, label: p.name })))} />
          <Select size="sm" aria-label="Filter stage" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}
            options={[{ value: "all", label: "Semua stage" }].concat(B_STAGES.map((s) => ({ value: s.key, label: s.label })))} />
          <Select size="sm" aria-label="Filter prioritas" value={prioFilter} onChange={(e) => setPrioFilter(e.target.value)}
            options={[
              { value: "all", label: "Semua prioritas" }, { value: "tinggi", label: "Tinggi" },
              { value: "sedang", label: "Sedang" }, { value: "rendah", label: "Rendah" },
            ]} />
        </div>
      </div>
```

- [x] **Step 6: Reset empty-state ikut membersihkan filter baru**

Di blok `StateBlock kind="empty"` untuk "Tidak ada spec untuk filter ini" (baris ~470-472), ganti `action`:

Dari:
```tsx
            action={() => { setTab("all"); setProj("all"); }} actionLabel="Reset filter" actionIcon="rotate-ccw" />
```
Menjadi:
```tsx
            action={() => { setTab("all"); setProj("all"); setQ(""); setStageFilter("all"); setPrioFilter("all"); }} actionLabel="Reset filter" actionIcon="rotate-ccw" />
```

- [x] **Step 7: Jalankan test → pastikan LULUS + typecheck**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/web test -- search-filter`
Expected: PASS (6 test).
Lalu typecheck build: dari `src/`, `pnpm exec tsc --noEmit` (atau `pnpm build`) → tanpa error.

- [x] **Step 8: Update internal/docs (commit yang sama)**

Di `internal/docs/frontend/frontend-implementation.md`:

(a) Baris ~5, ganti frasa `Backlog (filter project + tab + tiga mode tampilan grid/list/board + aksi per spec + detail spec via modal...` sehingga menyebut penyaring baru:
`Backlog (cari teks + filter project/stage/prioritas + tab sumber + tiga mode tampilan grid/list/board + aksi per spec + detail spec via modal...`

(b) Di section `## Backlog: tiga mode tampilan...` (setelah baris ~60), tambahkan satu paragraf:

```markdown
Toolbar dua baris (SPEC-178): baris atas tab sumber + toggle view + hitungan; baris bawah
kotak **Cari backlog** (substring case-insensitive pada `id + title + objective`) diikuti
`Select` project, stage, dan prioritas. Semua penyaring digabung serentak ke satu `filtered`
dan berlaku di ketiga view; kuncinya masuk `usePaged` agar halaman reset saat filter berubah.
Search/stage/prioritas view-local; project tetap `App.projectFilter` (SPEC-146).
```

- [x] **Step 9: Verifikasi nyata (boot UI)**

Frontend-only, tak ada endpoint tersentuh — verifikasi = test hijau (Step 7) + build sukses. Opsional smoke visual: dari `src/`, `pnpm dev` dan buka backlog, ketik di kotak cari, pilih stage/prioritas, pastikan list menyaring live dan tombol "Reset filter" mengosongkan semuanya.

- [x] **Step 10: Commit**

```bash
git add src/src/screens/BacklogScreen.tsx src/test/search-filter.test.tsx internal/docs/frontend/frontend-implementation.md
git commit -m "feat(spec-178): search + stage + priority filter di backlog"
```

---

## Self-Review

**Spec coverage:**
- Kotak pencarian teks (id+title+objective) → Step 1 test + Step 4/5. ✓
- Filter stage → Step 4 (`stageFilter`) + Step 5 (Select). ✓
- Filter prioritas → Step 4 (`prioFilter`) + Step 5 (Select). ✓
- Berlaku di grid/list/board → semua pakai `filtered` yang sama (tak ada cabang per-view). ✓
- Pagination reset saat filter berubah → Step 4 `usePaged` key. ✓
- Empty-state "Reset filter" bersihkan filter baru → Step 6. ✓
- Frontend-only, tanpa dependensi baru → hanya `BacklogScreen.tsx` + test + doc. ✓
- Docs tersentuh di commit yang sama → Step 8 + Step 10. ✓

**Placeholder scan:** tak ada TBD/TODO; semua step berisi kode nyata. ✓

**Type consistency:** `stageFilter`/`prioFilter`/`q` konsisten dari deklarasi (Step 4) sampai pemakaian (Step 5, 6). Opsi stage dari `B_STAGES` (kunci `key`/`label` yang memang ada). Prioritas `tinggi|sedang|rendah` cocok dengan `zPriority` & `B_PRIO`. ✓
