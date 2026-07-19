# Fullscreen 1 Terminal (SPEC-232) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Beri aksi fullscreen pada **satu terminal** yang dituju, terbuka sebagai **modal** yang menutupi layar, terpisah dari maximize-grid yang sudah ada.

**Architecture:** Murni frontend. `TerminalScreen` memegang state `fullId` (id sesi yang penuh). Cell yang sedang penuh **melepas** `TerminalPane`-nya (jaga invariant satu-attach tmux) dan menampilkan placeholder; pane hidup dipindah ke sebuah DS `Modal` (`closeOnEscape={false}` agar Escape milik terminal). Tutup modal → pane kembali ke sel (reconnect murah; scrollback dipegang tmux).

**Tech Stack:** React + TypeScript (Vite), `@xterm/xterm`, lucide-react, DS `Modal` (`src/src/ds/kit.tsx`), Vitest + Testing Library (jsdom).

## Global Constraints

- TypeScript strict.
- Bahasa UI: Indonesia (label/aria-label seperti kode sekitarnya).
- Tanpa perubahan server / kontrak API / data model. Tanpa ADR.
- Test frontend dijalankan dari direktori `src/`: `npx vitest run <file>` (setup `./test/setup.ts`, jsdom).
- Ikuti design system (bone paper, brass accent, token CSS var) dan pola ikon-span di header `Cell`.
- Jaga invariant **satu sesi = satu `TerminalPane` (satu WS attach)** setiap saat.

---

### Task 1: DS `Modal` — prop `closeOnEscape`

**Files:**
- Modify: `src/src/ds/kit.tsx` (fungsi `Modal`, sekitar baris 42-90)
- Test: `src/test/ds.test.tsx`

**Interfaces:**
- Produces: `Modal` menerima prop opsional `closeOnEscape?: boolean` (default `true`). Bila `false`, menekan Escape **tidak** memanggil `onClose`. Perilaku lain (backdrop-click, tombol `×`) tak berubah.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan blok ini di `src/test/ds.test.tsx` (sesuaikan import bila `Modal` belum diimpor — impor dari `../src/ds`):

```tsx
import { Modal } from "../src/ds";

describe("Modal closeOnEscape", () => {
  it("default: Escape memanggil onClose", () => {
    const onClose = vi.fn();
    render(<Modal open title="X" onClose={onClose}>isi</Modal>);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closeOnEscape=false: Escape TIDAK memanggil onClose", () => {
    const onClose = vi.fn();
    render(<Modal open title="X" onClose={onClose} closeOnEscape={false}>isi</Modal>);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closeOnEscape=false: tombol tutup tetap memanggil onClose", () => {
    const onClose = vi.fn();
    render(<Modal open title="X" onClose={onClose} closeOnEscape={false}>isi</Modal>);
    fireEvent.click(screen.getByLabelText("Tutup"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

Pastikan `render, screen, fireEvent` dan `describe, it, expect, vi` sudah diimpor di file itu (tambah yang kurang).

- [x] **Step 2: Jalankan test, pastikan gagal**

Run (dari `src/`): `npx vitest run test/ds.test.tsx`
Expected: test "closeOnEscape=false: Escape TIDAK memanggil onClose" FAIL — `onClose` terpanggil (Escape masih di-bind).

- [x] **Step 3: Implementasi minimal**

Di `src/src/ds/kit.tsx`, ubah signature `Modal` untuk menerima `closeOnEscape` (default `true`) dan gerbang effect-nya:

```tsx
export function Modal({ open, title, eyebrow, icon, onClose, footer, width = 560, closeOnEscape = true, children }:
  { open: boolean; title?: React.ReactNode; eyebrow?: React.ReactNode; icon?: string;
    onClose?: () => void; footer?: React.ReactNode; width?: number; closeOnEscape?: boolean; children?: React.ReactNode }) {
  React.useEffect(() => {
    if (!open || !closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose && onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, closeOnEscape]);
  // ... sisa body tak berubah
```

- [x] **Step 4: Jalankan test, pastikan hijau**

Run (dari `src/`): `npx vitest run test/ds.test.tsx`
Expected: PASS semua.

- [x] **Step 5: Commit**

```bash
git add src/src/ds/kit.tsx src/test/ds.test.tsx
git commit -m "feat(ds): Modal closeOnEscape untuk modal yang memuat terminal (SPEC-232)"
```

---

### Task 2: Fullscreen 1 terminal di `TerminalScreen`

**Files:**
- Modify: `src/src/screens/TerminalScreen.tsx`
  - `TerminalScreen` (state `fullId` + effect pembersih + render `FullscreenTerminal`)
  - `Cell` (props `onFullscreen`, `fullscreen`; ikon header; supresi pane)
  - Tambah komponen `FullscreenTerminal`
- Test: `src/test/terminal-screen.test.tsx`

**Interfaces:**
- Consumes: `Modal` dengan `closeOnEscape` (Task 1); `TerminalPane` (dimock di test jadi `<div data-testid="pane">{sessionId}</div>`).
- Produces:
  - `Cell` props tambahan: `onFullscreen: () => void`, `fullscreen: boolean`.
  - Header `Cell`: ikon `aria-label="Layar penuh sesi <session.id>"` → `onFullscreen()`.
  - `FullscreenTerminal({ session, label, onClose })` — modal berisi satu `TerminalPane key={session.id}`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan `describe` ini di `src/test/terminal-screen.test.tsx` (pakai helper/mock yang sudah ada di file — `listTerminals`, `LKEY`, `projects`):

```tsx
describe("TerminalScreen · fullscreen 1 terminal (SPEC-232)", () => {
  it("klik ikon fullscreen membuka modal berisi terminal sesi itu (pane pindah, tetap satu)", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");

    fireEvent.click(screen.getByLabelText("Layar penuh sesi aaaa1111"));

    // modal muncul; pane tetap TEPAT SATU (dipindah dari sel ke modal)
    expect(screen.getByLabelText("Tutup")).toBeInTheDocument();
    expect(screen.getAllByTestId("pane")).toHaveLength(1);
    expect(screen.getByText("Terbuka di layar penuh")).toBeInTheDocument(); // placeholder di sel
  });

  it("tombol tutup modal mengembalikan terminal ke sel", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    fireEvent.click(screen.getByLabelText("Layar penuh sesi aaaa1111"));
    expect(screen.getByLabelText("Tutup")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Tutup"));

    await waitFor(() => expect(screen.queryByText("Terbuka di layar penuh")).toBeNull());
    expect(screen.getByTestId("pane")).toHaveTextContent("aaaa1111"); // kembali di sel
  });

  it("Escape TIDAK menutup modal fullscreen — Escape milik terminal", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    fireEvent.click(screen.getByLabelText("Layar penuh sesi aaaa1111"));

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.getByLabelText("Tutup")).toBeInTheDocument(); // masih terbuka
    expect(screen.getByText("Terbuka di layar penuh")).toBeInTheDocument();
  });

  it("sesi yang hilang lewat frame WS menutup modal fullscreen", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    fireEvent.click(screen.getByLabelText("Layar penuh sesi aaaa1111"));
    expect(screen.getByLabelText("Tutup")).toBeInTheDocument();

    await act(async () => { ev.handler?.({ t: "sessions", sessions: [] }); }); // sesi lenyap

    await waitFor(() => expect(screen.queryByLabelText("Tutup")).toBeNull());
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run (dari `src/`): `npx vitest run test/terminal-screen.test.tsx`
Expected: FAIL — `getByLabelText("Layar penuh sesi aaaa1111")` tak ditemukan (kontrol belum ada).

- [x] **Step 3: Implementasi — state `fullId` + render modal di `TerminalScreen`**

Di komponen `TerminalScreen` (`src/src/screens/TerminalScreen.tsx`):

Tambah state (dekat `const [maxed, setMaxed] = ...`):

```tsx
  const [fullId, setFullId] = React.useState<string | null>(null);
```

Tambah effect pembersih (setelah effect subscribe/reconcile yang ada) — tutup fullscreen bila sesinya lenyap:

```tsx
  // SPEC-232 · fullscreen menunjuk satu sesi hidup; bila sesi itu hilang (kill/exit lewat
  // frame WS), lepas fullscreen supaya modal tak menggantung ke sesi mati.
  React.useEffect(() => {
    if (fullId && !sessions.some((s) => s.id === fullId)) setFullId(null);
  }, [fullId, sessions]);
```

Di dalam `return (...)`, teruskan handler ke `Cell` (pada pemanggilan `<Cell ... />` di dalam grid) — tambahkan dua prop:

```tsx
                      <Cell session={s} nameOf={nameOf} onClose={() => void close(s.id)}
                          onDetach={() => detach(s.id)} onExit={() => markExited(s.id)} onReview={onOpenReview}
                          titleOf={titleOf} onIntegrate={onIntegrate} specOf={specOf}
                          fullscreen={fullId === s.id} onFullscreen={() => setFullId(s.id)} />
```

Render modal sebelum penutup `</div>` root (setelah blok `{picking && (...)}`):

```tsx
      {fullId && byId(fullId) && (
        <FullscreenTerminal
          session={byId(fullId)!}
          label={(() => {
            const fs = byId(fullId)!;
            const proj = nameOf(fs.projectId);
            const t = fs.specId ? titleOf?.(fs.specId) : undefined;
            return fs.specId ? `${proj} · ${fs.specId}${t ? ` · ${t}` : ""}` : proj;
          })()}
          onClose={() => setFullId(null)} />
      )}
```

- [x] **Step 4: Implementasi — `Cell` (ikon + supresi pane)**

Perbarui signature `Cell` untuk menerima props baru:

```tsx
function Cell({ session, nameOf, onClose, onDetach, onExit, onReview, titleOf, onIntegrate, specOf, fullscreen, onFullscreen }: {
  session: TerminalSession; nameOf: (pid: string) => string;
  onClose: () => void; onDetach: () => void; onExit: (code: number) => void;
  onReview?: (specId: string) => void; titleOf?: (specId: string) => string | undefined;
  onIntegrate?: (spec: Spec, op: "merge" | "rebase", target: string) => void;
  specOf?: (specId: string) => Spec | undefined;
  fullscreen: boolean; onFullscreen: () => void;
}) {
```

Di header, tambah ikon fullscreen tepat sebelum aksi `lepas`:

```tsx
        <span onClick={onFullscreen} title="Layar penuh — fokus 1 terminal"
          aria-label={`Layar penuh sesi ${session.id}`}
          style={{ cursor: "pointer", color: "var(--text-subtle)", display: "inline-flex", alignItems: "center" }}>
          <Icon name="fullscreen" size={12} />
        </span>
```

Ganti badan yang memuat `TerminalPane` agar melepas pane saat `fullscreen` (placeholder), jika tidak render seperti biasa. Ganti blok:

```tsx
        <div style={{ flex: 1, minHeight: 0 }}>
          <TerminalPane key={session.id} sessionId={session.id} onExit={onExit} onPhases={setPhases} />
        </div>
```

menjadi:

```tsx
        <div style={{ flex: 1, minHeight: 0 }}>
          {fullscreen
            ? <div style={{ height: "100%", display: "grid", placeItems: "center", padding: 12,
                color: "var(--text-subtle)", fontSize: 12, textAlign: "center" }}>
                Terbuka di layar penuh
              </div>
            : <TerminalPane key={session.id} sessionId={session.id} onExit={onExit} onPhases={setPhases} />}
        </div>
```

- [x] **Step 5: Implementasi — komponen `FullscreenTerminal`**

Tambahkan di `src/src/screens/TerminalScreen.tsx` (mis. setelah `Cell`):

```tsx
// SPEC-232 · fullscreen SATU terminal sebagai modal. Pane-nya dipindah ke sini dari sel
// (sel menampilkan placeholder) supaya tetap satu attach tmux. closeOnEscape=false: Escape
// tombol tersibuk TUI Claude Code — keluar via × / backdrop saja (sejalan maximize-grid SPEC-163).
function FullscreenTerminal({ session, label, onClose }: {
  session: TerminalSession; label: string; onClose: () => void;
}) {
  return (
    <Modal open icon="terminal" title={label} onClose={onClose} closeOnEscape={false} width={1600}>
      <div style={{ height: "72vh", minHeight: 0, display: "flex", flexDirection: "column" }}>
        <TerminalPane key={session.id} sessionId={session.id} onExit={() => {}} />
      </div>
    </Modal>
  );
}
```

(`Modal` sudah diimpor di file ini; `TerminalPane` juga.)

- [x] **Step 6: Jalankan test fitur, pastikan hijau**

Run (dari `src/`): `npx vitest run test/terminal-screen.test.tsx`
Expected: PASS semua (termasuk 4 test SPEC-232 baru dan semua test lama).

- [x] **Step 7: Typecheck**

Run (dari `src/`): `npx tsc --noEmit`
Expected: tanpa error.

- [x] **Step 8: Commit**

```bash
git add src/src/screens/TerminalScreen.tsx src/test/terminal-screen.test.tsx
git commit -m "feat(terminal): fullscreen 1 terminal sebagai modal per-sesi (SPEC-232)"
```

---

### Task 3: Dokumentasi + verifikasi menyeluruh

**Files:**
- Modify: `internal/docs/frontend/frontend-implementation.md` (bagian Terminal)
- (index `internal/docs/README.md` sudah menautkan frontend-implementation — tak perlu diubah)

**Interfaces:** —

- [x] **Step 1: Perbarui doc frontend**

Di `internal/docs/frontend/frontend-implementation.md`, pada bagian "## Terminal (sesi Claude Code interaktif)", tambahkan paragraf setelah paragraf tombol **Layar penuh** (yang menjelaskan maximize-grid), berisi:

```markdown
Selain maximize-grid itu, tiap **sel** punya ikon **`fullscreen`** di header-nya (SPEC-232):
mengklik membuka **satu** terminal itu dalam **modal** besar (DS `Modal`, `closeOnEscape={false}`
karena Escape milik TUI Claude Code). Supaya invariant *satu sesi = satu attach tmux* terjaga,
sel yang sedang penuh **melepas** `TerminalPane`-nya dan menampilkan placeholder "Terbuka di
layar penuh"; pane hidup pindah ke modal. Menutup modal (× / backdrop) memasang ulang pane di
sel (reconnect murah — scrollback dipegang tmux). State `fullId` tak dipersist; bila sesinya
lenyap (frame WS), modal tertutup sendiri. Ini **berbeda** dari tombol maximize-grid yang
memperbesar seluruh grid.
```

- [x] **Step 2: Boot server + smoke UI nyata (opsional bila lingkungan mendukung), lalu jalankan seluruh test frontend**

Jalankan seluruh test package `src` (dari `src/`):

Run: `npx vitest run`
Expected: semua file test hijau.

- [x] **Step 3: Verifikasi build frontend**

Run (dari `src/`): `npx tsc --noEmit && npx vite build`
Expected: build sukses tanpa error TypeScript.

- [x] **Step 4: Commit docs**

```bash
git add internal/docs/frontend/frontend-implementation.md
git commit -m "docs(frontend): fullscreen 1 terminal modal per-sesi (SPEC-232)"
```

---

## Catatan verifikasi

- Fitur ini frontend-only; tak ada endpoint baru untuk di-curl. "Test API nyata" (kebiasaan
  hanoman) di sini = **build + test jsdom hijau** dan, bila memungkinkan, smoke visual di
  browser terhadap dev server (`pnpm --filter ./src dev`). Tidak ada perubahan `server/`.
- Jaga agar hitungan `data-testid="pane"` tetap **satu** saat fullscreen — itu bukti invariant
  satu-attach tmux terpenuhi.
