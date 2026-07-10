# Take Backlog dari Terminal (SPEC-179) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambahkan tombol "Ambil backlog" di toolbar Terminal yang membuka modal picker; memilih backlog item memulai sesi `claude` interaktifnya dan menaruhnya langsung di grid — tanpa pindah ke halaman Backlog.

**Architecture:** Frontend-only, nol perubahan server. `TerminalScreen` menerima prop baru `backlog: Spec[]` dari `App.tsx` (App sudah memuatnya). Sebuah `BacklogPicker` modal menampilkan spec yang bisa diambil (`stage !== "done"` & belum punya sesi hidup). `onPick` memanggil `api.startSession({ spec, flow })` — endpoint idempoten yang sama yang dipakai tombol Mulai/Lanjutkan di Backlog — lalu menambahkan sesi ke state lokal dan memanggil `W.placeFirstEmptyInActive`.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest + @testing-library/react (jsdom), design-system `ds` (`Modal`, `Input`, `Badge`, `StateBlock`, `Button`, `Icon`).

## Global Constraints

- TypeScript strict — semua kode harus lolos `tsc --noEmit`.
- Ikuti design system `internal/docs/design-system/**` (editorial, bone paper, brass accent); reuse komponen `ds`, jangan bikin styling ad-hoc baru bila ada tokennya.
- Update `internal/docs` yang tersentuh dalam commit yang sama (`internal/docs/frontend/frontend-implementation.md`).
- Nol perubahan server: route `POST /terminal/sessions` `{spec, flow}` dipakai apa adanya.
- `flow` dipilih otomatis: `spec.source === "qa" ? "qa" : "feature"` (cermin `App.startSession`).
- Worktree ini butuh `pnpm install` sebelum test bisa jalan (tak ada `node_modules` bawaan).

---

### Task 1: Tombol "Ambil backlog" + `BacklogPicker` modal di TerminalScreen

**Files:**
- Modify: `src/src/screens/TerminalScreen.tsx` (tambah prop `backlog`, state picker, handler `pickBacklog`, tombol toolbar, komponen `BacklogPicker`)
- Modify: `src/src/App.tsx:512` (teruskan `backlog={backlog}` ke `<TerminalScreen>`)
- Modify: `src/test/terminal-screen.test.tsx` (mock `startSession` + `ApiError`, fixture `backlog`, test baru)
- Modify: `internal/docs/frontend/frontend-implementation.md:120-146` (dokumentasikan tombol Ambil backlog)

**Interfaces:**
- Consumes:
  - `api.startSession(b: { spec: string; flow: Flow }): Promise<{ id: string }>` (sudah ada di `src/src/api/client.ts:58`)
  - `ApiError` (class, `src/src/api/client.ts:2`) — untuk membedakan 400/422 project tanpa repoDir
  - `W.placeFirstEmptyInActive(ws, id): Workspace` (`src/src/screens/terminal-workspace.ts:58`)
  - `type Spec` dari `@hanoman/shared` — `{ id, projectId, title, source: "brief"|"qa", stage, priority, author, objective, payload, branchFrom }`
  - `type Flow` dari `../api/client` — `"feature" | "qa" | "scaffold" | "reverse"`
- Produces:
  - Prop baru `TerminalScreen({ backlog?: Spec[] })` (default `[]`, jadi test lama yang tak mengirim prop tetap lolos)

- [ ] **Step 1: Setup — install deps di worktree (sekali)**

Run:
```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-179
pnpm install
```
Expected: selesai tanpa error; `src/node_modules` terisi. (Kalau sudah pernah, ia no-op cepat.)

- [ ] **Step 2: Tulis test yang gagal — modal membuka & menyaring spec startable**

Di `src/test/terminal-screen.test.tsx`, tambahkan mock `startSession` + `ApiError` ke blok mock yang ada, fixture `backlog`, dan sebuah `describe` baru. Ubah blok mock jadi:

```tsx
import type { Spec } from "@hanoman/shared";

const listTerminals = vi.fn();
const createTerminal = vi.fn();
const deleteTerminal = vi.fn();
const startSession = vi.fn();
class MockApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }
vi.mock("../src/api/client", () => ({
  ApiError: MockApiError,
  api: {
    listTerminals: (...a: unknown[]) => listTerminals(...a),
    createTerminal: (...a: unknown[]) => createTerminal(...a),
    deleteTerminal: (...a: unknown[]) => deleteTerminal(...a),
    startSession: (...a: unknown[]) => startSession(...a),
  },
}));
```

Tambahkan `startSession.mockReset();` di `beforeEach`. Tambahkan fixture di dekat `const projects`:

```tsx
const backlog: Spec[] = [
  { id: "SPEC-100", projectId: "p1", title: "Fitur A", source: "brief", stage: "brainstorming",
    priority: "tinggi", author: "human", objective: "obj A", payload: null, branchFrom: null },
  { id: "SPEC-101", projectId: "p1", title: "Bug B", source: "qa", stage: "planned",
    priority: "sedang", author: "human", objective: "obj B", payload: null, branchFrom: null },
  { id: "SPEC-102", projectId: "p1", title: "Selesai C", source: "brief", stage: "done",
    priority: "rendah", author: "human", objective: "obj C", payload: null, branchFrom: null },
];
```

Lalu tambahkan describe baru:

```tsx
describe("TerminalScreen (Ambil backlog)", () => {
  it("membuka modal berisi spec yang bisa diambil — bukan yang done", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} backlog={backlog} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Ambil backlog" }));
    expect(await screen.findByText("Fitur A")).toBeInTheDocument();
    expect(screen.getByText("Bug B")).toBeInTheDocument();
    expect(screen.queryByText("Selesai C")).toBeNull();       // done tak ditawarkan
  });

  it("spec yang sudah punya sesi hidup tak ditawarkan lagi", async () => {
    listTerminals.mockResolvedValue([
      { id: "spec-100", projectId: "p1", specId: "SPEC-100", flow: "feature", cwd: "/repo", exited: false },
    ]);
    render(<TerminalScreen projects={projects} backlog={backlog} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ambil backlog" }));
    expect(await screen.findByText("Bug B")).toBeInTheDocument();
    expect(screen.queryByText("Fitur A")).toBeNull();          // sudah aktif
  });

  it("cari memfilter daftar backlog", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} backlog={backlog} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Ambil backlog" }));
    fireEvent.change(await screen.findByLabelText("Cari backlog"), { target: { value: "bug" } });
    expect(screen.getByText("Bug B")).toBeInTheDocument();
    expect(screen.queryByText("Fitur A")).toBeNull();
  });

  it("memilih spec memanggil startSession (flow qa) & menaruh sesinya di grid", async () => {
    listTerminals.mockResolvedValue([]);
    startSession.mockResolvedValue({ id: "spec101sess" });
    render(<TerminalScreen projects={projects} backlog={backlog} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Ambil backlog" }));
    fireEvent.click(await screen.findByText("Bug B"));         // SPEC-101, source qa
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("spec101sess"));
    expect(startSession).toHaveBeenCalledWith({ spec: "SPEC-101", flow: "qa" });
  });

  it("brief memakai flow feature", async () => {
    listTerminals.mockResolvedValue([]);
    startSession.mockResolvedValue({ id: "sfeat" });
    render(<TerminalScreen projects={projects} backlog={backlog} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Ambil backlog" }));
    fireEvent.click(await screen.findByText("Fitur A"));       // SPEC-100, source brief
    await waitFor(() => expect(startSession).toHaveBeenCalledWith({ spec: "SPEC-100", flow: "feature" }));
  });
});
```

- [ ] **Step 3: Jalankan test — pastikan gagal**

Run: `pnpm --filter ./src exec vitest run src/test/terminal-screen.test.tsx -t "Ambil backlog"`
Expected: FAIL — tombol `name: "Ambil backlog"` belum ada / prop `backlog` belum dikenal.

- [ ] **Step 4: Implementasi — prop, handler, tombol, modal di `TerminalScreen.tsx`**

Ubah baris import teratas:

```tsx
import { Button, IconButton, Icon, Select, StateBlock, Modal, Input, Badge } from "../ds";
import { api, ApiError, type TerminalSession, type Phase, type Flow } from "../api/client";
import type { Spec } from "@hanoman/shared";
```

Ubah signature + tambah state (di dalam `TerminalScreen`, dekat state lain):

```tsx
export function TerminalScreen({ projects, backlog = [], onOpenReview, titleOf }: {
  projects: { id: string; name: string }[]; backlog?: Spec[];
  onOpenReview?: (specId: string) => void;
  titleOf?: (specId: string) => string | undefined;
}) {
  const [sessions, setSessions] = React.useState<TerminalSession[]>([]);
  const [ws, setWs] = React.useState<W.Workspace>(() => W.load() ?? W.emptyWorkspace());
  const [project, setProject] = React.useState(projects[0]?.id ?? "");
  const [maxed, setMaxed] = React.useState(false);
  const [picking, setPicking] = React.useState(false);
  const [pickError, setPickError] = React.useState<string | null>(null);
```

Tambah handler (di dekat `openNew`):

```tsx
  // SPEC-179 · ambil backlog item tanpa pindah page. Reuse start API idempoten +
  // placeFirstEmptyInActive — sesi baru langsung masuk grid aktif.
  async function pickBacklog(spec: Spec) {
    const flow: Flow = spec.source === "qa" ? "qa" : "feature";
    try {
      const { id } = await api.startSession({ spec: spec.id, flow });
      setSessions((s) => s.some((x) => x.id === id)
        ? s
        : [...s, { id, projectId: spec.projectId, specId: spec.id, flow, cwd: "", exited: false }]);
      setWs((w) => W.placeFirstEmptyInActive(w, id));
      setPicking(false);
      setPickError(null);
    } catch (e) {
      const noRepo = e instanceof ApiError && (e.status === 400 || e.status === 422);
      setPickError(`${spec.id} · gagal mulai${noRepo ? " · project belum punya repoDir" : ""}`);
    }
  }

  // Startable = belum selesai & belum punya sesi hidup di terminal ini (cermin Backlog
  // "Mulai/Lanjutkan": stage !== "done" && !running).
  const activeSpecIds = new Set(
    sessions.filter((s) => s.specId && !s.exited).map((s) => s.specId as string));
  const startable = backlog.filter((s) => s.stage !== "done" && !activeSpecIds.has(s.id));
```

Tambah tombol di toolbar, sebelum "Sesi baru" (baris ~99):

```tsx
          <Button size="sm" variant="secondary" leftIcon="inbox"
            onClick={() => { setPickError(null); setPicking(true); }}>Ambil backlog</Button>
          <Button size="sm" leftIcon="plus" onClick={() => void openNew()}>Sesi baru</Button>
```

Render modal di akhir root `<div data-testid="terminal-root">` (sebelum penutupnya):

```tsx
      {picking && (
        <BacklogPicker specs={startable} error={pickError}
          onPick={(s) => void pickBacklog(s)} onClose={() => setPicking(false)} />
      )}
```

Tambah komponen di bawah (dekat `EmptyCell`):

```tsx
// SPEC-179 · picker backlog dari Terminal. Daftar padat + cari; klik baris = ambil.
function BacklogPicker({ specs, error, onPick, onClose }: {
  specs: Spec[]; error: string | null; onPick: (s: Spec) => void; onClose: () => void;
}) {
  const [q, setQ] = React.useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? specs.filter((s) => `${s.id} ${s.title} ${s.objective}`.toLowerCase().includes(needle))
    : specs;
  return (
    <Modal open title="Ambil backlog" icon="inbox" onClose={onClose} width={520}>
      {error && (
        <div style={{ marginBottom: 10, padding: "8px 10px", borderRadius: "var(--radius-sm)",
          background: "var(--clay-100)", color: "var(--clay-600)", fontSize: 12 }}>{error}</div>
      )}
      <Input size="sm" leftIcon="search" placeholder="Cari backlog…" aria-label="Cari backlog"
        value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} />
      {shown.length === 0 ? (
        <StateBlock kind="empty" icon="inbox" title="Tak ada backlog untuk diambil"
          hint="Semua item sudah selesai atau sedang aktif — buat brief baru di halaman Backlog." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", maxHeight: "48vh", overflowY: "auto" }}>
          {shown.map((s) => (
            <button key={s.id} onClick={() => onPick(s)} style={{
              all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
              padding: "9px 8px", borderBottom: "1px solid var(--border-hair)",
            }}>
              <Icon name={s.source === "qa" ? "bug" : "lightbulb"} size={14}
                color={s.source === "qa" ? "var(--clay-500)" : "var(--brass-500)"} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-subtle)",
                flex: "0 0 78px" }}>{s.id}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--text-strong)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
              <Badge tone={s.priority === "tinggi" ? "err" : "neutral"} size="sm">{s.priority}</Badge>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11,
                color: "var(--text-muted)" }}>{s.projectId}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
```

- [ ] **Step 5: Jalankan test — pastikan lolos**

Run: `pnpm --filter ./src exec vitest run src/test/terminal-screen.test.tsx -t "Ambil backlog"`
Expected: PASS (5 test hijau).

- [ ] **Step 6: Wire `backlog` prop dari App.tsx**

Di `src/src/App.tsx` (blok `section === "terminal"`, ~baris 512), tambahkan prop:

```tsx
          : <TerminalScreen projects={projectsView} backlog={backlog}
              onOpenReview={(specId) => { setReviewSpecId(specId); setSection("review"); }}
              titleOf={(id) => backlog.find((s) => s.id === id)?.title} />)}
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter ./src typecheck`
Expected: PASS, nol error.

- [ ] **Step 8: Update doc Source of Truth**

Di `internal/docs/frontend/frontend-implementation.md`, di bagian `## Terminal`, tambahkan satu paragraf (setelah paragraf pertama tentang grid, sebelum paragraf grup):

```markdown
Toolbar juga punya **Ambil backlog** (SPEC-179): tombol yang membuka modal picker berisi
backlog item yang bisa diambil (`stage !== "done"` dan belum punya sesi hidup). Memilih satu
memanggil `POST /terminal/sessions {spec, flow}` — endpoint idempoten yang sama dengan tombol
Mulai/Lanjutkan di halaman Backlog — lalu menaruh sesinya di sel kosong pertama grup aktif.
`flow` dipilih otomatis dari `spec.source` (`qa`/`feature`). Nol perubahan server.
```

- [ ] **Step 9: Jalankan seluruh suite frontend + typecheck (regression)**

Run:
```bash
pnpm --filter ./src exec vitest run src/test/terminal-screen.test.tsx
pnpm --filter ./src typecheck
```
Expected: semua test file hijau (test lama + 5 baru), typecheck bersih. Test lama tetap lolos karena `backlog` opsional (default `[]`).

- [ ] **Step 10: Verifikasi build produksi frontend**

Run: `pnpm --filter ./src build`
Expected: `tsc && vite build` sukses tanpa error.

- [ ] **Step 11: Commit**

```bash
git add src/src/screens/TerminalScreen.tsx src/src/App.tsx src/test/terminal-screen.test.tsx internal/docs/frontend/frontend-implementation.md
git commit -m "feat(spec-179): Ambil backlog dari Terminal

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Verifikasi API nyata (CLAUDE.md)

Perubahan ini **frontend-only** — tak ada route/handler server yang berubah. Endpoint yang
dipakai (`POST /terminal/sessions` dengan `{spec, flow}`) sudah ada dan diuji
(`server/test/terminal.route.test.ts`). Bukti "berjalan nyata" untuk task ini = suite
frontend hijau + typecheck + `vite build` sukses (Step 9–10). Boot server penuh tidak
diperlukan karena tak ada perilaku server baru untuk di-curl; menjalankannya justru berisiko
menyentuh DB/worktree sesi lain (lihat memori: live smoke butuh DB khusus).

## Self-Review

- **Spec coverage:** tombol Ambil backlog (Step 4 toolbar), modal picker + cari (Step 4
  `BacklogPicker`), start idempoten + place di grid (`pickBacklog`), filter `stage !== "done"`
  & bukan aktif (`startable`), flow otomatis qa/feature, error inline no-repoDir, prop dari App
  (Step 6), doc update (Step 8). Semua bagian "Keputusan" di spec terpetakan.
- **Placeholder scan:** tak ada TBD/TODO; setiap step berkode konkret.
- **Type consistency:** `pickBacklog(spec: Spec)`, `flow: Flow`, `BacklogPicker` props
  (`specs/error/onPick/onClose`) konsisten antar step; `startable`/`activeSpecIds` dipakai
  sesuai definisi; `backlog?: Spec[]` opsional agar test lama tetap lolos.
