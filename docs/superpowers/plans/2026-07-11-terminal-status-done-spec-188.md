# Terminal Status Done (SPEC-188) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Sesi terminal yang sudah selesai (`exited`) mendapat pembeda kontras — badge hijau "Selesai" (StatusPill DS) di header cell + badan terminal yang meredup — menggantikan suffix samar `" · berakhir"`.

**Architecture:** Perubahan UI murni di komponen `Cell` (`src/src/screens/TerminalScreen.tsx`). Reuse `StatusPill status="done"` dari design system. Nol perubahan server/skema/tipe. Docs frontend diperbarui dalam commit yang sama.

**Tech Stack:** React + TypeScript (Vite), Vitest + @testing-library/react. Semua di paket `src`.

## Global Constraints

- TypeScript strict; test untuk logika UI (CLAUDE.md).
- Reuse komponen DS yang ada (`StatusPill`) — jangan bikin komponen status baru (ponytail/YAGNI).
- Nol perubahan server, route, `pty.ts`, skema Prisma, atau tipe `TerminalSession`.
- Label badge **"Selesai"** (Indonesia, override default "Done"); opacity badan cell **0.6**.
- Update `internal/docs` yang tersentuh dalam commit yang sama (Source of Truth by konvensi, SPEC-160).

---

### Task 1: Badge "Selesai" + badan terminal meredup di `Cell`

**Files:**
- Modify: `src/src/screens/TerminalScreen.tsx` (import baris 2; `Cell` baris ~384-445)
- Test: `src/test/terminal-screen.test.tsx` (tambah `describe` baru)
- Modify: `internal/docs/frontend/frontend-implementation.md` (§Terminal, sekitar baris 113-154)

**Interfaces:**
- Consumes: `StatusPill` dari `../ds` (barrel `src/src/ds/index.ts` sudah mengekspornya); `session.exited: boolean` dari `TerminalSession`.
- Produces: header `Cell` merender `<StatusPill status="done" size="sm">Selesai</StatusPill>` hanya bila `session.exited`; badan (`PhaseStrip` + kontainer `TerminalPane`) `opacity: 0.6` bila `session.exited`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `describe("TerminalScreen (grid)", ...)` (setelah test "Tutup (×)"), sebelum `});` penutup describe:

```tsx
  it("sesi yang exited menampilkan badge Selesai (bukan suffix berakhir)", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["done1111"] }));
    listTerminals.mockResolvedValue([{ id: "done1111", projectId: "p1", cwd: "/repo", exited: true }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    expect(screen.getByText("Selesai")).toBeInTheDocument();
    expect(screen.queryByText(/berakhir/)).toBeNull();
  });

  it("sesi yang masih hidup tak menampilkan badge Selesai", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["live1111"] }));
    listTerminals.mockResolvedValue([{ id: "live1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    expect(screen.queryByText("Selesai")).toBeNull();
  });
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `cd src && pnpm exec vitest run terminal-screen`
Expected: FAIL — `getByText("Selesai")` tak ketemu (masih render `" · berakhir"`).

- [x] **Step 3: Implementasi minimal**

Di `src/src/screens/TerminalScreen.tsx`:

1. Tambah `StatusPill` ke import DS (baris 2):

```tsx
import { Button, IconButton, Icon, Select, StateBlock, Modal, Input, Badge, StatusPill } from "../ds";
```

2. Di `Cell`, bersihkan suffix label (hapus `{session.exited && " · berakhir"}`) dan sisipkan badge setelah `<span>` label, sebelum ikon dokumen:

```tsx
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label} · {session.id.slice(0, 6)}
        </span>
        {session.exited && <StatusPill status="done" size="sm">Selesai</StatusPill>}
```

3. Redupkan badan cell saat exited — bungkus `PhaseStrip` + div `TerminalPane` dengan opacity bersyarat. Ganti dua node itu:

```tsx
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0,
        opacity: session.exited ? 0.6 : 1 }}>
        <PhaseStrip phases={phases} />
        {/* key = identitas sesi: pindah antar sel memindah subtree, bukan me-remount WebSocket. */}
        <div style={{ flex: 1, minHeight: 0 }}>
          <TerminalPane key={session.id} sessionId={session.id} onExit={onExit} onPhases={setPhases} />
        </div>
      </div>
```

(`PhaseStrip` punya `flex: "0 0 auto"`; div terminal `flex: 1` — sama seperti sebelumnya, hanya dibungkus satu kolom flex untuk menerapkan opacity ke keduanya.)

- [x] **Step 4: Jalankan test, pastikan lulus**

Run: `cd src && pnpm exec vitest run terminal-screen`
Expected: PASS (dua test baru hijau + semua test lama tetap hijau).

- [x] **Step 5: Perbarui docs (Source of Truth)**

Di `internal/docs/frontend/frontend-implementation.md`, §Terminal (setelah paragraf "Layar penuh", sekitar baris 152), tambahkan satu kalimat:

```markdown
Sesi yang **berakhir** (`exited`) ditandai kontras di header cell dengan `StatusPill`
hijau **"Selesai"**, dan badan terminalnya diredupkan (`opacity: 0.6`) untuk menandakan
proses sudah beku — menggantikan suffix teks `· berakhir` yang lama (SPEC-188).
```

- [x] **Step 6: Commit**

```bash
git add src/src/screens/TerminalScreen.tsx src/test/terminal-screen.test.tsx internal/docs/frontend/frontend-implementation.md docs/superpowers/specs/2026-07-11-terminal-status-done-spec-188-design.md docs/superpowers/plans/2026-07-11-terminal-status-done-spec-188.md
git commit -m "feat(terminal): badge Selesai + badan meredup untuk sesi exited (SPEC-188)"
```

---

### Task 2: Verifikasi penuh + smoke UI nyata

**Files:** —

- [x] **Step 1: Suite penuh paket `src`** — `cd src && pnpm exec vitest run` → semua hijau (tak ada regresi di terminal/app-flows).
- [x] **Step 2: Typecheck** — `cd src && pnpm exec tsc --noEmit` → exit 0.
- [x] **Step 3: Smoke UI nyata** — boot dev (`pnpm dev` atau build `src`), buka Terminal, verifikasi: sesi hidup tanpa badge; saat sesi berakhir muncul pill hijau "Selesai" + badan meredup. Kalau tak bisa driving sesi nyata, render cell dengan `exited: true` via test-build/DOM snapshot untuk konfirmasi visual. Catat hasil.
- [x] **Step 4: Centang plan + commit docs bila ada perubahan** — pastikan semua `- [x]` jadi `- [x]`.
