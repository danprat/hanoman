# Status Success Terminal (SPEC-196) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Terminal sesi yang **success** (`exited`) dan yang **menunggu keputusan manusia** punya pembeda visual jelas, dan notifikasi (`done` + `decision`) tetap sampai lewat notifikasi OS saat user pindah tab browser.

**Architecture:** (A) Surface state `decision` dari server ke client — `listSessions()` menghitungnya dari marker keputusan yang sudah ada; `TerminalScreen` mem-poll ringan untuk menyegarkannya live; `Cell` merender pill `awaiting` (sudah ada di DS) + tint header. (B) `NotificationsContext` menembak `new Notification` (Web Notifications API native) saat `document.hidden`, izin diminta pada gestur user pertama. Nol dependency baru, nol migrasi (state decision & skema Notification sudah ada).

**Tech Stack:** Server Node+TS (Fastify, tmux via `pty.ts`, Vitest). Client React+TS (Vite), Vitest + @testing-library/react.

## Global Constraints

- TypeScript strict; test untuk setiap logika (CLAUDE.md).
- Reuse yang ada: `StatusPill status="awaiting"` (DS `ds/components/feedback.tsx:89`, label default "Menunggu keputusan"), marker keputusan `.worktrees/.decisions/<id>` (ADR-0036). Jangan bikin komponen/skema/dependency baru (ponytail/YAGNI).
- Perubahan API bersifat **additif** (field `decision` pada respons `GET /terminal/sessions`) — bukan breaking, tanpa migrasi.
- Update `internal/docs` yang tersentuh **dalam commit yang sama** (Source of Truth by konvensi, SPEC-160).
- Copy Indonesia: pill success = **"Selesai"**, pill decision = **"Menunggu keputusan"** (default DS).
- Jalankan test dengan env bersih: `env -u NODE_ENV -u DATABASE_URL pnpm ...` (shell sesi bisa menunjuk prod).

---

### Task 1: Server — `markerFilled` + field `decision` pada `listSessions`

**Files:**
- Modify: `server/src/services/pty.ts` (imports baris 4; `SessionInfo`/`Pane` baris 33-36; `listSessions` baris 98-99; `createSession` return baris 163)
- Modify: `server/src/services/notifications.ts` (import baris 1-3; `nonEmpty` baris 30; `scanDecisions` baris 36)
- Test: `server/test/pty.test.ts` (import baris 6-9; tambah 2 test di akhir `describe`)

**Interfaces:**
- Produces: `markerFilled(f: string): boolean` (exported dari `pty.ts`). `SessionInfo` bertambah `decision: boolean`. `listSessions(): SessionInfo[]` mengisi `decision`.
- Consumes (Task 2/3): client membaca field `decision` dari respons `GET /terminal/sessions`.

- [x] **Step 1: Tulis test yang gagal**

Di `server/test/pty.test.ts`, tambah `markerFilled` ke import dari `../src/services/pty` (baris 6-9):

```ts
import {
  createSession, getSession, listSessions, killSession, killAll, detachAll, attach, writeTo,
  sessionPhases, markerFilled,
} from "../src/services/pty";
```

Tambahkan dua test sebelum `});` penutup `describe("pty service", ...)` (setelah test "killSession stops..."):

```ts
  it("markerFilled: absent/empty → false, non-empty → true (SPEC-196)", () => {
    const f = join(repoDir, "marker");
    expect(markerFilled(f)).toBe(false);        // berkas belum ada
    appendFileSync(f, "menunggu");
    expect(markerFilled(f)).toBe(true);
  });

  it("listSessions melaporkan decision saat marker keputusan terisi (SPEC-196)", () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const decisionFile = join(repoDir, ".worktrees", ".decisions", "spec-d");
    const s = createSession("p1", repoDir, { specId: "SPEC-D", flow: "feature", prompt: "x", decisionFile });
    const find = () => listSessions().find((x) => x.id === s.id)!;
    expect(find().decision).toBe(false);        // sesi hidup, marker belum ditulis
    appendFileSync(decisionFile, "menunggu\n");  // hook Notification menulis marker
    expect(find().decision).toBe(true);
  });
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL pnpm exec vitest run pty`
Expected: FAIL — `markerFilled is not a function` / `decision` undefined.

- [x] **Step 3: Implementasi di `pty.ts`**

1. Tambah `statSync` ke import `node:fs` (baris 4):

```ts
import { mkdirSync, statSync } from "node:fs";
```

2. Tambah helper `markerFilled` tepat sebelum `export type Frame` (setelah baris 23, `const POLL_MS = 500;`):

```ts
// SPEC-196 · marker keputusan (.worktrees/.decisions/<id>) yang terisi = sesi sedang menunggu
// manusia. Satu definisi dipakai listSessions (pembeda terminal) dan scanDecisions (notifikasi).
// statSync gagal (berkas belum ada) → false.
export const markerFilled = (f: string): boolean => {
  try { return statSync(f).size > 0; } catch { return false; }
};
```

3. Tambah `decision: boolean` ke `SessionInfo` dan lepaskan `decision` dari `Pane` (raw pane tak punya field turunan) — ganti baris 33-36:

```ts
export type SessionInfo = {
  id: string; projectId: string; specId?: string; flow?: Flow; cwd: string; exited: boolean;
  decision: boolean;
};
type Pane = Omit<SessionInfo, "decision"> & { code: number; phaseFile?: string; decisionFile?: string };
```

4. Isi `decision` di `listSessions` (baris 98-99):

```ts
export const listSessions = (): SessionInfo[] =>
  listPanes().map(({ id, projectId, specId, flow, cwd, exited, decisionFile }) => ({
    id, projectId, specId, flow, cwd, exited,
    decision: !exited && !!decisionFile && markerFilled(decisionFile),
  }));
```

5. `createSession` return (baris 163) sekarang wajib menyertakan `decision`:

```ts
  return { id, projectId, specId: opts.specId, flow: opts.flow, cwd, exited: false, decision: false };
```

- [x] **Step 4: Reuse `markerFilled` di `notifications.ts` (hapus duplikat)**

Di `server/src/services/notifications.ts`:

1. Ganti import baris 1-3 — buang `statSync`, impor `markerFilled` dari pty:

```ts
import { prisma } from "../db";
import { liveDecisions, markerFilled } from "./pty";
```

2. Hapus definisi `nonEmpty` (baris 30):

```ts
// (hapus baris) const nonEmpty = (f: string): boolean => { try { return statSync(f).size > 0; } catch { return false; } };
```

3. Di `scanDecisions`, ganti pemanggilan `nonEmpty` → `markerFilled` (baris 36):

```ts
    if (!markerFilled(s.decisionFile)) continue;
```

- [x] **Step 5: Jalankan test, pastikan lulus**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL pnpm exec vitest run pty notifications`
Expected: PASS (dua test baru hijau; `notifications.ts` tetap hijau setelah refactor `markerFilled`).

- [x] **Step 6: Typecheck server**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL pnpm exec tsc --noEmit`
Expected: exit 0 (perhatikan konsumen `SessionInfo`/`Pane`; `getSession` masih `Pane | undefined`, route tak menyentuh `decision`).

- [x] **Step 7: Commit**

```bash
git add server/src/services/pty.ts server/src/services/notifications.ts server/test/pty.test.ts
git commit -m "feat(terminal): surface state decision di listSessions (SPEC-196)"
```

---

### Task 2: Client — pembeda `Cell` untuk decision + tint header

**Files:**
- Modify: `src/src/api/client.ts` (`TerminalSession` baris 5-7)
- Modify: `src/src/screens/TerminalScreen.tsx` (`Cell` header baris 409-441; badan sudah menangani `exited`)
- Test: `src/test/terminal-screen.test.tsx` (tambah test di dalam `describe("TerminalScreen (grid)", ...)`)
- Modify: `internal/docs/frontend/frontend-implementation.md` (§Terminal, setelah baris 156)

**Interfaces:**
- Consumes: `session.decision?: boolean`, `session.exited: boolean`, `StatusPill` dari `../ds`.
- Produces: header `Cell` merender pill "Menunggu keputusan" bila `decision && !exited`, pill "Selesai" bila `exited`; `background` header per state.

- [x] **Step 1: Tulis test yang gagal**

Di `src/test/terminal-screen.test.tsx`, tambahkan di akhir `describe("TerminalScreen (grid)", ...)` (setelah test terakhir, sebelum `});` penutup describe):

```tsx
  it("sesi menunggu keputusan menampilkan pill Menunggu keputusan (SPEC-196)", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["dec11111"] }));
    listTerminals.mockResolvedValue([{ id: "dec11111", projectId: "p1", cwd: "/repo", exited: false, decision: true }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    expect(screen.getByText("Menunggu keputusan")).toBeInTheDocument();
    expect(screen.queryByText("Selesai")).toBeNull();
  });

  it("exited menang atas decision: pill Selesai, bukan Menunggu (SPEC-196)", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["done2222"] }));
    listTerminals.mockResolvedValue([{ id: "done2222", projectId: "p1", cwd: "/repo", exited: true, decision: true }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    expect(screen.getByText("Selesai")).toBeInTheDocument();
    expect(screen.queryByText("Menunggu keputusan")).toBeNull();
  });

  it("sesi bekerja (tanpa decision/exited) tak ada pill (SPEC-196)", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["run33333"] }));
    listTerminals.mockResolvedValue([{ id: "run33333", projectId: "p1", cwd: "/repo", exited: false, decision: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    expect(screen.queryByText("Menunggu keputusan")).toBeNull();
    expect(screen.queryByText("Selesai")).toBeNull();
  });
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL pnpm exec vitest run terminal-screen`
Expected: FAIL — "Menunggu keputusan" tak ketemu (belum dirender).

- [x] **Step 3: Tambah `decision` ke tipe client**

Di `src/src/api/client.ts` (baris 5-7):

```ts
export type TerminalSession = {
  id: string; projectId: string; specId?: string; flow?: Flow; cwd: string; exited: boolean;
  decision?: boolean;
};
```

- [x] **Step 4: Render pembeda di `Cell`**

Di `src/src/screens/TerminalScreen.tsx`, di dalam `Cell` (mulai baris ~407). Tepat sebelum `return (`, hitung flag:

```tsx
  // SPEC-196 · sesi yang berhenti menunggu keputusan manusia (marker) belum `exited` — beri
  // pembeda sendiri. `exited` menang bila keduanya benar (proses sudah beku).
  const awaiting = !session.exited && !!session.decision;
```

Ganti blok pembuka header (baris 409-417) — tambahkan `background` bersyarat dan pill decision:

```tsx
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", flex: "0 0 auto",
        background: session.exited ? "var(--status-ok-tint)" : awaiting ? "var(--status-warn-tint)" : "var(--bone-200)",
        borderBottom: "1px solid var(--border-hair)",
        fontFamily: "var(--font-mono)", fontSize: 11, color: session.exited ? "var(--text-muted)" : "var(--text-body)",
      }}>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label} · {session.id.slice(0, 6)}
        </span>
        {session.exited && <StatusPill status="done" size="sm">Selesai</StatusPill>}
        {awaiting && <StatusPill status="awaiting" size="sm" />}
```

(`StatusPill status="awaiting"` tanpa `children` memakai label default DS "Menunggu keputusan", warna amber, dot berdenyut. Badan cell yang meredup saat `exited` sudah ada di baris ~444 — tak berubah.)

- [x] **Step 5: Jalankan test, pastikan lulus**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL pnpm exec vitest run terminal-screen`
Expected: PASS (tiga test baru + semua test lama, termasuk "sesi yang exited menampilkan badge Selesai" SPEC-188, tetap hijau).

- [x] **Step 6: Perbarui docs (Source of Truth)**

Di `internal/docs/frontend/frontend-implementation.md`, setelah baris 156 (paragraf SPEC-188), sisipkan:

```markdown

Sesi yang **berhenti menunggu keputusan manusia** (marker `.worktrees/.decisions/<id>` terisi,
disurface `listSessions().decision`) ditandai pill amber berdenyut **"Menunggu keputusan"**
(`StatusPill status="awaiting"`). Header cell diberi tint sesuai state — hijau untuk `exited`,
amber untuk menunggu keputusan — supaya pembeda terbaca sekilas, bukan hanya dari pill (SPEC-196).
```

- [x] **Step 7: Commit**

```bash
git add src/src/api/client.ts src/src/screens/TerminalScreen.tsx src/test/terminal-screen.test.tsx internal/docs/frontend/frontend-implementation.md
git commit -m "feat(terminal): pill Menunggu keputusan + tint header per state (SPEC-196)"
```

---

### Task 3: Client — poll ringan agar state decision hidup

**Files:**
- Modify: `src/src/screens/TerminalScreen.tsx` (tambah `useEffect` poll setelah efek mount baris 27-29)
- Test: `src/test/terminal-screen.test.tsx` (import `act`; tambah 1 test)
- Modify: `internal/docs/frontend/frontend-implementation.md` (§Terminal, lanjutan kalimat SPEC-196)

**Interfaces:**
- Consumes: `api.listTerminals()`, `session.decision`, `session.exited`.
- Produces: `sessions` disegarkan tiap ~8s; hanya `setSessions` bila signature `id:exited:decision` berubah.

- [x] **Step 1: Tulis test yang gagal**

Di `src/test/terminal-screen.test.tsx`, tambah `act` ke import baris 1:

```tsx
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
```

Tambah test di akhir `describe("TerminalScreen (grid)", ...)`:

```tsx
  it("poll menyegarkan state decision live (SPEC-196)", async () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["poll1111"] }));
      listTerminals
        .mockResolvedValueOnce([{ id: "poll1111", projectId: "p1", cwd: "/repo", exited: false, decision: false }])
        .mockResolvedValue([{ id: "poll1111", projectId: "p1", cwd: "/repo", exited: false, decision: true }]);
      render(<TerminalScreen projects={projects} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });      // fetch mount
      expect(screen.queryByText("Menunggu keputusan")).toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(8000); });   // satu tick poll
      expect(screen.getByText("Menunggu keputusan")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL pnpm exec vitest run terminal-screen`
Expected: FAIL — pill tak muncul setelah 8s (belum ada poll).

- [x] **Step 3: Tambah efek poll**

Di `src/src/screens/TerminalScreen.tsx`, tepat setelah efek mount (baris 27-29, yang men-set `loaded`), tambahkan:

```tsx
  // SPEC-196 · `exited` datang lewat WS, tapi "menunggu keputusan" hanya diketahui server
  // (marker). Poll ringan menyegarkan keduanya. tmux = source of truth, jadi respons list
  // menggantikan state; guard signature `id:exited:decision` agar tak men-thrash efek
  // rekonsiliasi/simpan tiap tick. ponytail: sesi optimistik dari openNew/pickBacklog sudah
  // hidup di tmux saat POST resolve, jadi replace tak menjatuhkannya.
  React.useEffect(() => {
    if (!loaded) return;
    const sig = (xs: TerminalSession[]) =>
      xs.map((s) => `${s.id}:${s.exited ? 1 : 0}:${s.decision ? 1 : 0}`).sort().join("|");
    const t = setInterval(() => {
      api.listTerminals()
        .then((fresh) => setSessions((prev) => (sig(prev) === sig(fresh) ? prev : fresh)))
        .catch(() => {});
    }, 8000);
    return () => clearInterval(t);
  }, [loaded]);
```

- [x] **Step 4: Jalankan test, pastikan lulus**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL pnpm exec vitest run terminal-screen`
Expected: PASS (semua test terminal-screen hijau; poll test hijau).

- [x] **Step 5: Perbarui docs**

Di `internal/docs/frontend/frontend-implementation.md`, sambung paragraf SPEC-196 (yang ditambah Task 2) dengan satu kalimat:

```markdown
`TerminalScreen` mem-poll `GET /terminal/sessions` tiap ~8s (guard signature `id:exited:decision`,
tak men-thrash) agar transisi ke/keluar "menunggu keputusan" tampak tanpa refresh — `exited` sendiri
tetap datang instan lewat WebSocket.
```

- [x] **Step 6: Commit**

```bash
git add src/src/screens/TerminalScreen.tsx src/test/terminal-screen.test.tsx internal/docs/frontend/frontend-implementation.md
git commit -m "feat(terminal): poll ringan menyegarkan state decision live (SPEC-196)"
```

---

### Task 4: Client — notifikasi OS lintas tab (Web Notifications API)

**Files:**
- Modify: `src/src/notifications/NotificationsContext.tsx` (import type baris 2; `tick` baris 54-57; efek `unlock` baris 63-67)
- Create: `src/test/notifications-os.test.tsx`
- Modify: `internal/docs/frontend/frontend-implementation.md` (§Notifikasi, setelah baris 229)

**Interfaces:**
- Consumes: `window.Notification` (DOM), `document.hidden`, `onOpen?: (n) => void` (prop provider), `toastFor`.
- Produces: `new Notification(msg, { tag })` saat notif fresh & `t.enabled` & `document.hidden` & izin granted.

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/notifications-os.test.tsx`:

```tsx
import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getSettings = vi.fn();
const listNotifications = vi.fn();
vi.mock("../src/api/client", () => ({
  api: {
    getSettings: (...a: unknown[]) => getSettings(...a),
    listNotifications: (...a: unknown[]) => listNotifications(...a),
    markNotificationsRead: vi.fn(),
    clearNotifications: vi.fn(),
  },
}));
vi.mock("../src/notifications/sound", () => ({ playNotifySound: vi.fn(), unlockNotifySound: vi.fn() }));

import { NotificationsProvider } from "../src/notifications/NotificationsContext";

const settings = { notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert" };
const done = { id: "n1", type: "done", specId: "SPEC-196", sessionId: "spec_196", title: "Judul",
  projectId: "p", createdAt: "2026-07-12T00:00:00.000Z", readAt: null };

let ctor: ReturnType<typeof vi.fn>;
function setHidden(v: boolean) { Object.defineProperty(document, "hidden", { configurable: true, get: () => v }); }

beforeEach(() => {
  getSettings.mockResolvedValue(settings);
  ctor = vi.fn();
  class FakeNotification {
    static permission = "granted";
    static requestPermission = vi.fn();
    onclick: unknown = null;
    close = vi.fn();
    constructor(title: string, opts?: unknown) { ctor(title, opts); }
  }
  vi.stubGlobal("Notification", FakeNotification);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); setHidden(false); vi.clearAllMocks(); });

async function boot() {
  render(<NotificationsProvider showToast={vi.fn()}>{null}</NotificationsProvider>);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });     // tick mount → seed baseline
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); }); // tick poll → notif fresh
}

describe("NotificationsProvider · notifikasi OS lintas tab (SPEC-196)", () => {
  it("tab tersembunyi + izin granted → new Notification saat notif fresh", async () => {
    vi.useFakeTimers();
    setHidden(true);
    listNotifications.mockResolvedValueOnce({ items: [], unread: 0 }).mockResolvedValue({ items: [done], unread: 1 });
    await boot();
    expect(ctor).toHaveBeenCalledWith('SPEC-196 · "Judul" selesai', { tag: "n1" });
  });

  it("tab terlihat → tak menembak OS (toast in-app cukup)", async () => {
    vi.useFakeTimers();
    setHidden(false);
    listNotifications.mockResolvedValueOnce({ items: [], unread: 0 }).mockResolvedValue({ items: [done], unread: 1 });
    await boot();
    expect(ctor).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL pnpm exec vitest run notifications-os`
Expected: FAIL — `ctor` tak pernah dipanggil (belum ada `notifyOS`).

- [x] **Step 3: Implementasi `notifyOS` + panggil di `tick`**

Di `src/src/notifications/NotificationsContext.tsx`, tambahkan helper tepat sebelum `type Ctx = ...` (baris 26):

```tsx
// SPEC-196 · toast in-app hanya terlihat di tab yang fokus. Web Notifications API (native)
// muncul di level OS lepas dari tab mana yang aktif — supaya notifikasi tetap sampai saat user
// pindah tab. Hanya menembak saat document.hidden (tab fokus sudah dilayani toast → hindari
// double) dan izin granted. tag = id → OS mendedup bila poll mengulang notif yang sama.
function notifyOS(msg: string, n: Notification, onOpen?: (n: Notification) => void): void {
  if (!("Notification" in window) || window.Notification.permission !== "granted" || !document.hidden) return;
  try {
    const notif = new window.Notification(msg, { tag: n.id });
    notif.onclick = () => { window.focus(); onOpen?.(n); notif.close(); };
  } catch { /* sebagian browser melempar bila dipanggil tanpa service worker; abaikan */ }
}
```

Di `tick`, di blok `if (latest)` (baris 54-57), tambahkan `notifyOS`:

```tsx
    if (latest) {
      const t = toastFor(latest, prefs.current);
      if (t.enabled) { showToast(t.msg, t.tone, t.icon); playNotifySound(t.sound); notifyOS(t.msg, latest, onOpen); }
    }
```

Tambahkan `onOpen` ke deps `useCallback` `tick` (baris 58): `}, [showToast, onOpen]);`

- [x] **Step 4: Minta izin pada gestur pertama**

Di efek yang memasang listener `unlock` (baris 63-67), tambahkan permintaan izin di dalam `unlock`:

```tsx
    const unlock = () => {
      unlockNotifySound();
      // SPEC-196 · requestPermission butuh gestur user; bonceng gestur unlock audio yang sama.
      if ("Notification" in window && window.Notification.permission === "default") void window.Notification.requestPermission();
      window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock);
    };
```

- [x] **Step 5: Jalankan test, pastikan lulus**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL pnpm exec vitest run notifications-os notifications-context notification-bell`
Expected: PASS (dua test OS baru + test notifikasi lama tetap hijau).

- [x] **Step 6: Perbarui docs (Source of Truth)**

Di `internal/docs/frontend/frontend-implementation.md`, §Notifikasi (setelah baris 229, akhir bullet `NotificationsProvider`), tambahkan bullet:

```markdown
- **Notifikasi OS lintas tab (SPEC-196):** toast in-app hanya terlihat di tab hanoman yang fokus.
  Saat `document.hidden` (user pindah tab) dan izin `Notification` sudah granted, `notifyOS` menembak
  `new Notification(msg, { tag: id })` (Web Notifications API native) untuk `done` **dan** `decision`,
  sehingga notifikasi tetap sampai di level OS. Izin diminta pada gestur user pertama (membonceng
  listener unlock audio). Klik notifikasi OS → `window.focus()` + redirect ke sesi (`onOpen`).
```

- [x] **Step 7: Commit**

```bash
git add src/src/notifications/NotificationsContext.tsx src/test/notifications-os.test.tsx internal/docs/frontend/frontend-implementation.md
git commit -m "feat(notif): notifikasi OS lintas tab via Web Notifications API (SPEC-196)"
```

---

### Task 5: Catatan ADR + verifikasi penuh + smoke nyata

**Files:**
- Modify: `internal/docs/adr/0036-notifikasi-human-decision.md` (tambah catatan SPEC-196)
- Modify: `docs/superpowers/plans/2026-07-12-status-success-terminal-spec-196.md` (centang task)

- [x] **Step 1: Catatan ADR (additif, tanpa ADR baru)**

Perubahan bersifat additif (field `decision` pada respons list; kanal notifikasi OS) tanpa perubahan skema — cukup catatan di ADR-0036. Tambahkan di akhir `internal/docs/adr/0036-notifikasi-human-decision.md`:

```markdown

## Pembaruan SPEC-196

- State decision kini juga **disurface ke grid terminal**: `listSessions()` mengisi `decision`
  (`!exited && marker terisi`, cek `markerFilled` yang sama dgn `scanDecisions`), dirender sebagai
  pill `awaiting` "Menunggu keputusan" di `Cell`. Additif pada respons `GET /terminal/sessions`,
  tanpa perubahan skema.
- **Notifikasi OS lintas tab**: `done` & `decision` juga menembak `new Notification` (Web Notifications
  API) saat `document.hidden`, sehingga notifikasi sampai meski user pindah tab. Toast in-app tetap
  untuk tab yang fokus (hindari double).
```

- [x] **Step 2: Suite penuh kedua paket**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL pnpm exec vitest run --no-file-parallelism`
Run: `cd src && env -u NODE_ENV -u DATABASE_URL pnpm exec vitest run`
Expected: semua hijau, tanpa regresi.

- [x] **Step 3: Typecheck kedua paket**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL pnpm exec tsc --noEmit`
Run: `cd src && env -u NODE_ENV -u DATABASE_URL pnpm exec tsc --noEmit`
Expected: exit 0 di keduanya.

- [x] **Step 4: Smoke nyata (server) — field `decision` di respons**

Boot server terisolasi (DB throwaway, jangan port dev 8787 / DB hanoman_test — lihat memory). Verifikasi `GET /api/terminal/sessions` mengembalikan field `decision` untuk sesi. Minimal, buat satu sesi terminal biasa via `POST /api/terminal/sessions {"project":"..."}` lalu `curl` list dan pastikan tiap item punya `"decision": false`. Untuk sesi decision, tulis marker `.worktrees/.decisions/<id>` non-kosong dan pastикан `"decision": true`. Catat hasil curl.

- [x] **Step 5: Smoke nyata (UI)** — build/boot `src`, buka Terminal: sesi bekerja tanpa pill; suntik `decision:true` (atau tulis marker sesi nyata) → pill amber "Menunggu keputusan" + header amber; sesi `exited` → pill hijau "Selesai" + badan meredup. Untuk notifikasi OS: dengan izin granted, pindah tab lalu picu satu notif `done`/`decision` → notifikasi OS muncul; kembali fokus → hanya toast. Bila tak bisa driving sesi nyata, konfirmasi via test-build/DOM. Catat hasil.

- [x] **Step 6: Centang plan + commit**

Pastikan semua `- [x]` di plan ini jadi `- [x]`.

```bash
git add internal/docs/adr/0036-notifikasi-human-decision.md docs/superpowers/plans/2026-07-12-status-success-terminal-spec-196.md docs/superpowers/specs/2026-07-12-status-success-terminal-spec-196-design.md
git commit -m "docs(spec-196): catatan ADR-0036 + centang plan selesai"
```

---

## Hasil verifikasi (2026-07-12)

- **Server suite:** `vitest run --no-file-parallelism` → **308 passed** (38 files).
- **Src suite:** `vitest run` → **183 passed** (33 files).
- **Typecheck:** `tsc --noEmit` server → exit 0; src → exit 0.
- **Smoke server (boot HTTP nyata + fetch TCP):** `GET /api/terminal/sessions` mengembalikan
  `"decision":false` sebelum marker ditulis, lalu `"decision":true` sesudah marker
  `.worktrees/.decisions/<id>` terisi — end-to-end lewat `app.listen` + `fetch`. Berkas smoke throwaway
  dihapus. Socket tmux terisolasi (`hanoman-test`); sesi dev (`hanoman-spec-195/196`) tak tersentuh.
- **Smoke UI:** `vite build` sukses (1768 modul). Pill/tint dirender & diuji via DOM dengan komponen DS
  `StatusPill` nyata (bukan mock) di `terminal-screen.test.tsx`; jalur notifikasi OS diuji via render
  `NotificationsProvider` nyata dengan global `Notification` palsu (`notifications-os.test.tsx`).

## Self-Review (writing-plans)

**Spec coverage:**
- Pembeda success (`exited`) → sudah ada (SPEC-188), tint header diperkuat di Task 2. ✓
- Pembeda human-decision → Task 1 (surface `decision`) + Task 2 (pill+tint) + Task 3 (poll live). ✓
- Notifikasi lintas tab untuk `done` & `decision` → Task 4 (Web Notifications API). ✓
- Docs SoT + ADR → Task 2/3/4 (frontend-implementation) + Task 5 (ADR-0036). ✓

**Placeholder scan:** tak ada TBD/TODO; semua step berisi kode/perintah konkret. ✓

**Type consistency:** `markerFilled(f: string): boolean`, `SessionInfo.decision: boolean`, `TerminalSession.decision?: boolean`, `notifyOS(msg, n, onOpen)` — konsisten antar task. Implementasi final menghitung `decision` di `listPanes` (tempat `decisionFile` dibaca) sehingga `Pane = SessionInfo & {...}` tetap valid untuk `getSession`/`createSession`. ✓
