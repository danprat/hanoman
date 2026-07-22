# Panel Scheduler (observabilitas) + UI setelan & opt-in — SPEC-299 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bangun screen Scheduler (self-poll) + nav item yang menampilkan observabilitas scheduler (status per-source, antrean, sesi berjalan, done+link-review, gagal+alasan), panel setelan yang menulis semua knob, toggle opt-in per project, dan rem darurat Pause/Stop — semuanya mengonsumsi API read-only fondasi (SPEC-294/ADR-0072).

**Architecture:** Murni konsumen frontend. Tambah tipe view + paths di `@hanoman/shared`, method di client, satu screen React `SchedulerScreen.tsx` (pola `ErrorsScreen`: memuat datanya sendiri via HTTP polling), entri nav di `ds/shell.tsx`, dan cabang `section === "scheduler"` di `App.tsx`. Opt-in per project pakai `PATCH /projects/:id { schedulerOptIn }` yang sudah ada (pola helpEnabled).

**Tech Stack:** React + TypeScript (Vite), zod (shared DTO), Fastify (server sudah ada), vitest + @testing-library/react.

## Global Constraints

- **TANPA** perubahan skema/migration/ADR/endpoint baru. Endpoint yang dipakai sudah ada: `GET /api/scheduler/config`, `PUT /api/scheduler/config`, `GET /api/scheduler/state`, `PATCH /api/projects/:id`.
- TypeScript strict. Ikuti design system (editorial, bone paper, brass accent) — pakai komponen `../ds` (Card, Button, Badge, Select, Switch, Input, StateBlock), token CSS var, JANGAN warna hardcode.
- Realtime = HTTP polling (ADR-0060/0039), bukan WebSocket. Silent poll tak pernah mem-blank data (pola `ErrorsScreen`: `catch { if (!silent) setState("error") }`).
- Test frontend jalan dengan `env -u NODE_ENV` (prod bikin RTL `act` gagal). Test repo: `vitest run --no-file-parallelism`.
- Waktu relatif pakai helper `ago()` gaya `ErrorsScreen` (tanpa dependensi tanggal).
- Bentuk respons `GET /api/scheduler/state` = `{ config: Scheduler, cap: number, liveCount: number, sources: SchedulerSourceView[], queue: SchedulerQueueItemView[], sessions: SchedulerSessionView[] }` — dikonsumsi apa adanya, JANGAN diubah di server.

---

### Task 1: Shared — paths + tipe view state scheduler

**Files:**
- Modify: `shared/src/api.ts` (tambah 2 path sesudah blok `settings`/`config`)
- Modify: `shared/src/dto.ts` (tambah tipe view sesudah `zSchedulerQueueItem`, ~baris 94)
- Test: `shared/src/scheduler-state.test.ts` (create)

**Interfaces:**
- Consumes: `zScheduler`/`Scheduler` (dari `./entities`, sudah ada), `zSchedulerQueueItem`/`SchedulerQueueItemView` (dari `./dto`, sudah ada).
- Produces:
  - `paths.schedulerConfig: string`, `paths.schedulerState: string`.
  - `zSchedulerSourceView`, `SchedulerSourceView` = `{ id: string; enabled: boolean; everyMin: number; minCount?: number; lastRunAt: string | null; nextRunAt: string | null }`.
  - `zSchedulerSessionView`, `SchedulerSessionView` = `{ id: string; projectId: string; specId: string; flow?: string; branch?: string; decision: boolean; exited: boolean }`.
  - `zSchedulerState`, `SchedulerStateView` = `{ config: Scheduler; cap: number; liveCount: number; sources: SchedulerSourceView[]; queue: SchedulerQueueItemView[]; sessions: SchedulerSessionView[] }`.

- [x] **Step 1: Tambah paths di `shared/src/api.ts`**

Sisipkan sesudah baris `configKey: (key: string) => ...` (setelah blok `// SPEC-215 · config runtime`):

```ts
  // SPEC-299 · panel scheduler (daun #6) — konsumen read-only fondasi SPEC-294/ADR-0072.
  schedulerConfig: `${API}/scheduler/config`,
  schedulerState: `${API}/scheduler/state`,
```

- [x] **Step 2: Tambah tipe view di `shared/src/dto.ts`**

Ubah baris import entities (baris 2) agar memuat `zScheduler`:

```ts
import { zProject, zBriefPayload, zQaPayload, zSpec, zScheduler } from "./entities";
```

Sisipkan tepat sesudah blok `zSchedulerQueueItem` / `SchedulerQueueItemView` (sekitar baris 94):

```ts
// SPEC-299 · ADR-0072 · view respons GET /api/scheduler/state (daun #6). Cerminan bentuk yang
// dikembalikan routes/scheduler.ts apa adanya — parse non-strict (field ekstra spt cwd diabaikan).
export const zSchedulerSourceView = z.object({
  id: z.string(), enabled: z.boolean(), everyMin: z.number(),
  minCount: z.number().optional(),           // hanya errors
  lastRunAt: z.string().nullable(), nextRunAt: z.string().nullable(),
});
export type SchedulerSourceView = z.infer<typeof zSchedulerSourceView>;

export const zSchedulerSessionView = z.object({
  id: z.string(), projectId: z.string(), specId: z.string(),
  flow: z.string().optional(), branch: z.string().optional(),
  decision: z.boolean(), exited: z.boolean(),
});
export type SchedulerSessionView = z.infer<typeof zSchedulerSessionView>;

export const zSchedulerState = z.object({
  config: zScheduler,
  cap: z.number(), liveCount: z.number(),
  sources: z.array(zSchedulerSourceView),
  queue: z.array(zSchedulerQueueItem),
  sessions: z.array(zSchedulerSessionView),
});
export type SchedulerStateView = z.infer<typeof zSchedulerState>;
```

- [x] **Step 3: Tulis test yang gagal — `shared/src/scheduler-state.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { zSchedulerState, SCHEDULER_DEFAULTS } from "./index";

describe("zSchedulerState (SPEC-299)", () => {
  it("memparse respons state fondasi apa adanya (field ekstra diabaikan)", () => {
    const sample = {
      config: SCHEDULER_DEFAULTS,
      cap: 2, liveCount: 1,
      sources: [
        { id: "backlog", enabled: true, everyMin: 15, lastRunAt: "2026-07-22T00:00:00.000Z", nextRunAt: "2026-07-22T00:15:00.000Z" },
        { id: "errors", enabled: false, everyMin: 15, minCount: 5, lastRunAt: null, nextRunAt: null },
      ],
      queue: [
        { id: "q1", specId: "SPEC-1", projectId: "a", source: "backlog", priority: "sedang",
          status: "done", sessionId: "spec-1", note: null,
          enqueuedAt: "2026-07-22T00:00:00.000Z", launchedAt: "2026-07-22T00:01:00.000Z" },
      ],
      sessions: [
        { id: "spec-2", projectId: "a", specId: "SPEC-2", flow: "feature", branch: "hanoman/spec-2",
          decision: false, exited: false, cwd: "/tmp/wt" },   // cwd ekstra harus diabaikan
      ],
    };
    const parsed = zSchedulerState.parse(sample);
    expect(parsed.sources[0]!.id).toBe("backlog");
    expect(parsed.sources[1]!.minCount).toBe(5);
    expect(parsed.queue[0]!.status).toBe("done");
    expect(parsed.sessions[0]!.specId).toBe("SPEC-2");
  });
});
```

- [x] **Step 4: Jalankan test — verifikasi lulus**

Run: `cd shared && npx vitest run src/scheduler-state.test.ts`
Expected: PASS (2 assertion block, 1 test).

- [x] **Step 5: Commit**

```bash
git add shared/src/api.ts shared/src/dto.ts shared/src/scheduler-state.test.ts
git commit -m "feat(spec-299): shared paths + tipe view GET /api/scheduler/state (panel scheduler)"
```

---

### Task 2: Client — method scheduler + tipe opt-in project

**Files:**
- Modify: `src/src/api/client.ts` (import tipe + 3 method + perluas tipe `updateProject`)
- Test: `src/test/api-client.test.ts` (tambah blok describe)

**Interfaces:**
- Consumes: `paths.schedulerConfig`, `paths.schedulerState` (Task 1); tipe `Scheduler`, `SchedulerStateView` (Task 1 / shared).
- Produces:
  - `api.getSchedulerConfig(): Promise<Scheduler>`
  - `api.putSchedulerConfig(cfg: Scheduler): Promise<Scheduler>`
  - `api.getSchedulerState(): Promise<SchedulerStateView>`
  - `api.updateProject(id, b)` menerima `schedulerOptIn?: boolean`.

- [x] **Step 1: Perluas import tipe di `src/src/api/client.ts`**

Di baris 1 (daftar import tipe dari `@hanoman/shared`), tambah `Scheduler` dan `SchedulerStateView`:

```ts
  ..., type BreakdownDoc, type BreakdownItem, type Scheduler, type SchedulerStateView } from "@hanoman/shared";
```

- [x] **Step 2: Perluas tipe body `updateProject`**

Ganti signature `updateProject` (sekitar baris 87–88) menjadi:

```ts
  updateProject: (id: string, b: { name?: string; desc?: string; gitRemote?: string; repoDir?: string | null; schedulerOptIn?: boolean }) =>
    j<ProjectView>(paths.project(id), { method: "PATCH", ...body(b) }),
```

- [x] **Step 3: Tambah method scheduler**

Sisipkan sebelum penutup `};` objek `api` (sesudah `deleteTicket`, sekitar baris 299):

```ts
  // SPEC-299 · ADR-0072 · panel scheduler (daun #6) — konsumen read-only fondasi.
  getSchedulerConfig: () => j<Scheduler>(paths.schedulerConfig),
  putSchedulerConfig: (cfg: Scheduler) => j<Scheduler>(paths.schedulerConfig, { method: "PUT", ...body(cfg) }),
  getSchedulerState: () => j<SchedulerStateView>(paths.schedulerState),
```

- [x] **Step 4: Tulis test yang gagal — tambah ke `src/test/api-client.test.ts`**

Tambahkan blok describe baru di akhir file (sebelum penutup file):

```ts
// SPEC-299 · panel scheduler
describe("api client · scheduler (SPEC-299)", () => {
  it("getSchedulerState menuju path state", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ config: {}, cap: 2, liveCount: 0, sources: [], queue: [], sessions: [] }),
        { status: 200, headers: { "content-type": "application/json" } }));
    await api.getSchedulerState();
    expect(fetchMock).toHaveBeenCalledWith(paths.schedulerState, expect.anything());
  });
  it("putSchedulerConfig mem-PUT blok config ke path config", async () => {
    const cfg = { enabled: true, paused: true, maxConcurrent: 3, autonomy: "full-control",
      sources: { backlog: { enabled: true, everyMin: 15 }, errors: { enabled: false, everyMin: 15, minCount: 5 }, triase: { enabled: false, everyMin: 30 } } };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(cfg), { status: 200, headers: { "content-type": "application/json" } }));
    await api.putSchedulerConfig(cfg as never);
    expect(fetchMock).toHaveBeenCalledWith(paths.schedulerConfig, expect.objectContaining({
      method: "PUT", body: JSON.stringify(cfg) }));
  });
  it("updateProject mem-PATCH schedulerOptIn", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "a" }), { status: 200, headers: { "content-type": "application/json" } }));
    await api.updateProject("a", { schedulerOptIn: true });
    expect(fetchMock).toHaveBeenCalledWith(paths.project("a"), expect.objectContaining({
      method: "PATCH", body: JSON.stringify({ schedulerOptIn: true }) }));
  });
});
```

- [x] **Step 5: Jalankan test — verifikasi lulus**

Run: `cd src && env -u NODE_ENV npx vitest run test/api-client.test.ts`
Expected: PASS (semua test lama + 3 baru).

- [x] **Step 6: Commit**

```bash
git add src/src/api/client.ts src/test/api-client.test.ts
git commit -m "feat(spec-299): client getSchedulerState/putSchedulerConfig + updateProject schedulerOptIn"
```

---

### Task 3: SchedulerScreen — observabilitas (read-only sections)

**Files:**
- Create: `src/src/screens/SchedulerScreen.tsx`
- Test: `src/test/scheduler-screen.test.tsx` (create)

**Interfaces:**
- Consumes: `api.getSchedulerState` (Task 2); `SchedulerStateView`, `SchedulerQueueItemView`, `SchedulerSessionView`, `SchedulerSourceView` (shared); `ProjectVM`, `Spec` (`./types`); `specDeepLink` (`./deeplink`).
- Produces (dipakai Task 4 & 5):
  - `export function SchedulerScreen(props: SchedulerScreenProps)` dengan
    `type SchedulerScreenProps = { projects: ProjectVM[]; backlog: Spec[]; onProjectChanged: (id: string) => void | Promise<void>; onToast: (msg: string, kind?: string, icon?: string) => void; onGotoTerminal: () => void }`.
  - Helper internal `titleFor(specId, backlog)` untuk resolve judul spec.

- [x] **Step 1: Tulis test yang gagal — `src/test/scheduler-screen.test.tsx`**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

const { getSchedulerState, putSchedulerConfig, updateProject } = vi.hoisted(() => ({
  getSchedulerState: vi.fn(),
  putSchedulerConfig: vi.fn(),
  updateProject: vi.fn(),
}));
vi.mock("../src/api/client", () => ({ api: { getSchedulerState, putSchedulerConfig, updateProject }, ApiError: class extends Error {} }));

import { SchedulerScreen } from "../src/screens/SchedulerScreen";

const STATE = {
  config: { enabled: true, paused: false, maxConcurrent: 2, autonomy: "butuh-keputusan",
    sources: { backlog: { enabled: true, everyMin: 15 }, errors: { enabled: false, everyMin: 15, minCount: 5 }, triase: { enabled: false, everyMin: 30 } } },
  cap: 2, liveCount: 1,
  sources: [
    { id: "backlog", enabled: true, everyMin: 15, lastRunAt: "2026-07-22T00:00:00.000Z", nextRunAt: "2026-07-22T00:15:00.000Z" },
    { id: "errors", enabled: false, everyMin: 15, minCount: 5, lastRunAt: null, nextRunAt: null },
    { id: "triase", enabled: false, everyMin: 30, lastRunAt: null, nextRunAt: null },
  ],
  queue: [
    { id: "q1", specId: "SPEC-1", projectId: "a", source: "backlog", priority: "tinggi", status: "queued", sessionId: null, note: null, enqueuedAt: "2026-07-22T00:00:00.000Z", launchedAt: null },
    { id: "q2", specId: "SPEC-2", projectId: "a", source: "errors", priority: "tinggi", status: "done", sessionId: "spec-2", note: null, enqueuedAt: "2026-07-22T00:00:00.000Z", launchedAt: "2026-07-22T00:01:00.000Z" },
    { id: "q3", specId: "SPEC-3", projectId: "a", source: "triase", priority: "sedang", status: "failed", sessionId: "spec-3", note: "sesi berakhir sebelum done", enqueuedAt: "2026-07-22T00:00:00.000Z", launchedAt: "2026-07-22T00:01:00.000Z" },
  ],
  sessions: [
    { id: "spec-4", projectId: "a", specId: "SPEC-4", flow: "feature", branch: "hanoman/spec-4", decision: true, exited: false },
  ],
};
const projects = [{ id: "a", name: "Alpha", schedulerOptIn: false }] as unknown as Parameters<typeof SchedulerScreen>[0]["projects"];
const backlog = [
  { id: "SPEC-1", title: "Judul satu" }, { id: "SPEC-2", title: "Judul dua" },
  { id: "SPEC-3", title: "Judul tiga" }, { id: "SPEC-4", title: "Judul empat" },
] as unknown as Parameters<typeof SchedulerScreen>[0]["backlog"];

function renderScreen() {
  return render(<SchedulerScreen projects={projects} backlog={backlog}
    onProjectChanged={vi.fn()} onToast={vi.fn()} onGotoTerminal={vi.fn()} />);
}

describe("SchedulerScreen observabilitas (SPEC-299)", () => {
  it("menampilkan status per-source, antrean, sesi berjalan, done, dan gagal+alasan", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    renderScreen();
    // status per-source
    expect(await screen.findByText(/backlog/i)).toBeInTheDocument();
    expect(screen.getByText(/errors/i)).toBeInTheDocument();
    // antrean (queued) → judul spec ter-resolve
    expect(screen.getByText("Judul satu")).toBeInTheDocument();
    // sesi berjalan + indikator menunggu keputusan
    expect(screen.getByText("Judul empat")).toBeInTheDocument();
    expect(screen.getByText(/menunggu keputusan/i)).toBeInTheDocument();
    // done + gagal + alasan
    expect(screen.getByText("Judul dua")).toBeInTheDocument();
    expect(screen.getByText("Judul tiga")).toBeInTheDocument();
    expect(screen.getByText(/sesi berakhir sebelum done/i)).toBeInTheDocument();
  });

  it("done item punya tombol Buka review deep-link #spec=", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    renderScreen();
    const btn = await screen.findByRole("button", { name: /buka review/i });
    btn.click();
    expect(openSpy).toHaveBeenCalledWith(expect.stringContaining("#spec=SPEC-2"), "_blank", "noreferrer");
    openSpy.mockRestore();
  });
});
```

- [x] **Step 2: Jalankan test — verifikasi gagal**

Run: `cd src && env -u NODE_ENV npx vitest run test/scheduler-screen.test.tsx`
Expected: FAIL ("Failed to resolve import ../src/screens/SchedulerScreen").

- [x] **Step 3: Buat `src/src/screens/SchedulerScreen.tsx` (observabilitas)**

```tsx
/* SchedulerScreen — panel scheduler otonom (SPEC-299, daun #6 ADR-0072). Screen mandiri (pola
   ErrorsScreen/VpsScreen): memuat state fondasi sendiri + silent poll. Menampilkan status per
   source, antrean, sesi berjalan, done+link review, gagal+alasan; panel setelan + opt-in per
   project + rem darurat Pause/Stop. Mengonsumsi API read-only GET /api/scheduler/state. */
import React from "react";
import { Card, Button, Badge, Select, Switch, Input, StateBlock, Icon } from "../ds";
import { api } from "../api/client";
import type { SchedulerStateView, SchedulerQueueItemView, SchedulerSessionView, SchedulerSourceView, Scheduler } from "@hanoman/shared";
import type { ProjectVM, Spec } from "./types";
import { specDeepLink } from "./deeplink";

const POLL_MS = 5000;

function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const d = Math.max(0, now - new Date(iso).getTime());
  const m = Math.floor(d / 60_000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}j`;
  return `${Math.floor(h / 24)}h`;
}
function until(iso: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime() - now;
  if (d <= 0) return "jatuh tempo";
  const m = Math.ceil(d / 60_000);
  if (m < 60) return `${m}m lagi`;
  return `${Math.ceil(m / 60)}j lagi`;
}
const PRIO_TONE: Record<string, string> = { tinggi: "err", sedang: "warn", rendah: "neutral" };

export type SchedulerScreenProps = {
  projects: ProjectVM[]; backlog: Spec[];
  onProjectChanged: (id: string) => void | Promise<void>;
  onToast: (msg: string, kind?: string, icon?: string) => void;
  onGotoTerminal: () => void;
};

function titleFor(specId: string, backlog: Spec[]): string {
  return backlog.find((s) => s.id === specId)?.title ?? specId;
}

function SourceCard({ s }: { s: SchedulerSourceView }) {
  return (
    <div style={{ padding: "12px 14px", border: "1px solid var(--border-hair)", borderRadius: "var(--radius-md)",
      background: "var(--surface-card)", display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 180 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text-strong)" }}>{s.id}</span>
        <Badge tone={s.enabled ? "ok" : "neutral"} size="sm">{s.enabled ? "aktif" : "nonaktif"}</Badge>
      </div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
        tiap {s.everyMin}m{s.minCount != null ? ` · ambang ${s.minCount}×` : ""}
      </div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
        terakhir {ago(s.lastRunAt)} · berikutnya {until(s.nextRunAt)}
      </div>
    </div>
  );
}

function QueueRow({ q, backlog }: { q: SchedulerQueueItemView; backlog: Spec[] }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
      border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", background: "var(--surface-card)", marginBottom: 6 }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: "var(--text-strong)", fontWeight: 500 }}>{titleFor(q.specId, backlog)}</span>
        <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>{q.projectId} · {q.source}</span>
      </span>
      <Badge tone={PRIO_TONE[q.priority] ?? "neutral"} size="sm">{q.priority}</Badge>
    </div>
  );
}

function SessionRow({ s, backlog, onGotoTerminal }: { s: SchedulerSessionView; backlog: Spec[]; onGotoTerminal: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
      border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", background: "var(--surface-card)", marginBottom: 6 }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: "var(--text-strong)", fontWeight: 500 }}>{titleFor(s.specId, backlog)}</span>
        <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>{s.projectId}{s.flow ? ` · ${s.flow}` : ""}</span>
      </span>
      {s.decision && <Badge tone="warn" icon="bell" size="sm">menunggu keputusan</Badge>}
      <Button size="sm" variant="ghost" leftIcon="terminal" onClick={onGotoTerminal}>Buka terminal</Button>
    </div>
  );
}

function DoneRow({ q, backlog, onToast }: { q: SchedulerQueueItemView; backlog: Spec[]; onToast: SchedulerScreenProps["onToast"] }) {
  const link = specDeepLink(q.specId);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
      border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", background: "var(--surface-card)", marginBottom: 6 }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: "var(--text-strong)", fontWeight: 500 }}>{titleFor(q.specId, backlog)}</span>
        <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
          {q.projectId} · {q.source} · selesai {ago(q.launchedAt)}{q.sessionId ? ` · hanoman/${q.sessionId}` : ""}
        </span>
      </span>
      <Button size="sm" variant="ghost" leftIcon="external-link" onClick={() => window.open(link, "_blank", "noreferrer")}>Buka review</Button>
      <Button size="sm" variant="ghost" leftIcon="copy" onClick={() => { void navigator.clipboard?.writeText(link); onToast("Link review disalin", "ok", "copy"); }}>Salin</Button>
    </div>
  );
}

function FailedRow({ q, backlog }: { q: SchedulerQueueItemView; backlog: Spec[] }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
      border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", background: "var(--surface-card)", marginBottom: 6 }}>
      <Icon name="x-circle" size={16} color="var(--clay-500)" />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: "var(--text-strong)", fontWeight: 500 }}>{titleFor(q.specId, backlog)}</span>
        <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
          {q.projectId} · {q.note ?? "gagal tanpa alasan tercatat"}
        </span>
      </span>
    </div>
  );
}

function Section({ title, count, empty, children }: { title: string; count: number; empty: string; children?: React.ReactNode }) {
  return (
    <Card eyebrow="scheduler" title={`${title}${count ? ` · ${count}` : ""}`}>
      {count === 0 ? <div style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>{empty}</div> : children}
    </Card>
  );
}

export function SchedulerScreen({ projects, backlog, onProjectChanged, onToast, onGotoTerminal }: SchedulerScreenProps) {
  const [state, setState] = React.useState<SchedulerStateView | null>(null);
  const [phase, setPhase] = React.useState<"loading" | "ready" | "error">("loading");

  const load = React.useCallback((silent = false) => {
    if (!silent) setPhase("loading");
    api.getSchedulerState()
      .then((s) => { setState(s); setPhase("ready"); })
      .catch(() => { if (!silent) setPhase("error"); });
  }, []);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(true); }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  if (phase === "loading") return <StateBlock kind="loading" />;
  if (phase === "error" || !state) return <StateBlock kind="error" hint="Gagal memuat state scheduler." action={() => load()} actionLabel="Coba lagi" />;

  const queued = state.queue.filter((q) => q.status === "queued");
  const done = state.queue.filter((q) => q.status === "done")
    .sort((a, b) => (b.launchedAt ?? "").localeCompare(a.launchedAt ?? ""));
  const failed = state.queue.filter((q) => q.status === "failed");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
      {/* Task 4 menyisipkan ControlBar + SettingsPanel + OptInPanel di sini */}
      <Card eyebrow="scheduler · observabilitas" title="Status per source">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {state.sources.map((s) => <SourceCard key={s.id} s={s} />)}
        </div>
      </Card>

      <Section title="Antrean" count={queued.length} empty="Antrean kosong.">
        {queued.map((q) => <QueueRow key={q.id} q={q} backlog={backlog} />)}
      </Section>

      <Section title="Sesi berjalan" count={state.sessions.length} empty="Tak ada sesi scheduler berjalan.">
        {state.sessions.map((s) => <SessionRow key={s.id} s={s} backlog={backlog} onGotoTerminal={onGotoTerminal} />)}
      </Section>

      <Section title="Selesai (done)" count={done.length} empty="Belum ada hasil selesai.">
        {done.map((q) => <DoneRow key={q.id} q={q} backlog={backlog} onToast={onToast} />)}
      </Section>

      <Section title="Gagal" count={failed.length} empty="Tak ada sesi gagal.">
        {failed.map((q) => <FailedRow key={q.id} q={q} backlog={backlog} />)}
      </Section>
    </div>
  );
}
```

> Catatan: import `Switch`, `Input`, `Select` sudah disiapkan untuk Task 4. `projects`/`onProjectChanged` belum dipakai sampai Task 4 — biarkan di signature (dipakai Task 4). Bila linter no-unused-vars mengeluh sebelum Task 4, tandai dengan komentar `// dipakai Task 4` atau gabungkan Task 3+4 dalam satu sesi eksekusi.

- [x] **Step 4: Jalankan test — verifikasi lulus**

Run: `cd src && env -u NODE_ENV npx vitest run test/scheduler-screen.test.tsx`
Expected: PASS (2 test observabilitas).

- [x] **Step 5: Commit**

```bash
git add src/src/screens/SchedulerScreen.tsx src/test/scheduler-screen.test.tsx
git commit -m "feat(spec-299): SchedulerScreen observabilitas (per-source/antrean/berjalan/done/gagal)"
```

---

### Task 4: SchedulerScreen — kontrol (Pause/Stop), panel setelan, opt-in per project

**Files:**
- Modify: `src/src/screens/SchedulerScreen.tsx` (tambah ControlBar, SettingsPanel, OptInPanel + render di dalam `SchedulerScreen`)
- Test: `src/test/scheduler-screen.test.tsx` (tambah test kontrol)

**Interfaces:**
- Consumes: `api.putSchedulerConfig`, `api.updateProject` (Task 2); `state.config: Scheduler` (Task 3).
- Produces: perilaku UI — semua knob `zScheduler` tertulis via `putSchedulerConfig`; opt-in via `updateProject` + `onProjectChanged`.

- [x] **Step 1: Tulis test yang gagal — tambah ke `src/test/scheduler-screen.test.tsx`**

Tambahkan describe berikut di akhir file:

```tsx
import { fireEvent, act } from "@testing-library/react";

describe("SchedulerScreen kontrol (SPEC-299)", () => {
  it("tombol Pause menulis paused:true via putSchedulerConfig", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    putSchedulerConfig.mockResolvedValue(STATE.config);
    renderScreen();
    const btn = await screen.findByRole("button", { name: /^pause$/i });
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(putSchedulerConfig).toHaveBeenCalledWith(expect.objectContaining({ paused: true })));
  });

  it("tombol Stop menulis enabled:false", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    putSchedulerConfig.mockResolvedValue(STATE.config);
    renderScreen();
    const btn = await screen.findByRole("button", { name: /stop/i });
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(putSchedulerConfig).toHaveBeenCalledWith(expect.objectContaining({ enabled: false })));
  });

  it("Simpan setelan mengirim blok config lengkap dgn perubahan maxConcurrent", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    putSchedulerConfig.mockResolvedValue(STATE.config);
    renderScreen();
    await screen.findByText("Status per source");
    const capInput = screen.getByLabelText(/cap concurrent/i);
    await act(async () => { fireEvent.change(capInput, { target: { value: "4" } }); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /simpan setelan/i })); });
    await waitFor(() => expect(putSchedulerConfig).toHaveBeenCalledWith(expect.objectContaining({ maxConcurrent: 4 })));
  });

  it("toggle opt-in project memanggil updateProject + onProjectChanged", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    updateProject.mockResolvedValue({ id: "a", schedulerOptIn: true });
    const onProjectChanged = vi.fn();
    render(<SchedulerScreen projects={projects} backlog={backlog}
      onProjectChanged={onProjectChanged} onToast={vi.fn()} onGotoTerminal={vi.fn()} />);
    const sw = await screen.findByLabelText(/Alpha/i);
    await act(async () => { fireEvent.click(sw); });
    await waitFor(() => expect(updateProject).toHaveBeenCalledWith("a", { schedulerOptIn: true }));
    await waitFor(() => expect(onProjectChanged).toHaveBeenCalledWith("a"));
  });
});
```

- [x] **Step 2: Jalankan test — verifikasi gagal**

Run: `cd src && env -u NODE_ENV npx vitest run test/scheduler-screen.test.tsx`
Expected: FAIL (tombol Pause/Stop/Simpan/label Alpha belum ada).

- [x] **Step 3: Tambah komponen kontrol di `SchedulerScreen.tsx`**

Sisipkan komponen berikut sebelum `export function SchedulerScreen`:

```tsx
function ControlBar({ cfg, cap, liveCount, onWrite, busy }:
  { cfg: Scheduler; cap: number; liveCount: number; onWrite: (next: Scheduler) => void; busy: boolean }) {
  const stopped = !cfg.enabled;
  const tone = stopped ? "neutral" : cfg.paused ? "warn" : "ok";
  const label = stopped ? "berhenti" : cfg.paused ? "dijeda" : "aktif";
  return (
    <Card eyebrow="scheduler · rem darurat" title="Kendali">
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Badge tone={tone as never}>{label}</Badge>
        <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{liveCount} / {cap} sesi hidup</span>
        <span style={{ flex: 1 }} />
        {cfg.enabled
          ? <Button size="sm" variant="secondary" leftIcon={cfg.paused ? "play" : "pause"} disabled={busy}
              onClick={() => onWrite({ ...cfg, paused: !cfg.paused })}>{cfg.paused ? "Lanjutkan" : "Pause"}</Button>
          : null}
        {cfg.enabled
          ? <Button size="sm" variant="ghost" leftIcon="square" disabled={busy}
              onClick={() => onWrite({ ...cfg, enabled: false })}>Stop</Button>
          : <Button size="sm" leftIcon="play" disabled={busy}
              onClick={() => onWrite({ ...cfg, enabled: true })}>Aktifkan</Button>}
      </div>
    </Card>
  );
}

function SettingsPanel({ cfg, onWrite, busy }: { cfg: Scheduler; onWrite: (next: Scheduler) => void; busy: boolean }) {
  const [draft, setDraft] = React.useState<Scheduler>(cfg);
  React.useEffect(() => { setDraft(cfg); }, [cfg]);
  const src = (k: "backlog" | "errors" | "triase") => draft.sources[k];
  const setSrc = (k: "backlog" | "errors" | "triase", patch: Record<string, unknown>) =>
    setDraft({ ...draft, sources: { ...draft.sources, [k]: { ...draft.sources[k], ...patch } } });
  const num = (v: string, min = 1) => Math.max(min, Number(v) || min);
  return (
    <Card eyebrow="scheduler · setelan" title="Konfigurasi"
      actions={<Button size="sm" leftIcon="save" disabled={busy} onClick={() => onWrite(draft)}>Simpan setelan</Button>}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="hn-eyebrow">Cap concurrent</span>
          <Input type="number" min={1} value={String(draft.maxConcurrent)} aria-label="Cap concurrent"
            onChange={(e) => setDraft({ ...draft, maxConcurrent: num((e.target as HTMLInputElement).value) })} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="hn-eyebrow">Autonomy</span>
          <Select value={draft.autonomy} aria-label="Autonomy"
            onChange={(e) => setDraft({ ...draft, autonomy: (e.target as HTMLSelectElement).value as Scheduler["autonomy"] })}
            options={[{ value: "butuh-keputusan", label: "butuh-keputusan" }, { value: "full-control", label: "full-control" }]} />
        </label>
      </div>
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        {(["backlog", "errors", "triase"] as const).map((k) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
            padding: "10px 12px", border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)" }}>
            <Switch label={k} checked={src(k).enabled} onChange={(e) => setSrc(k, { enabled: (e.target as HTMLInputElement).checked })} />
            <span style={{ flex: 1 }} />
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-xs)" }}>
              tiap
              <Input type="number" min={1} style={{ width: 72 }} aria-label={`cadence ${k}`}
                value={String(src(k).everyMin)}
                onChange={(e) => setSrc(k, { everyMin: num((e.target as HTMLInputElement).value) })} />
              menit
            </label>
            {k === "errors" && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-xs)" }}>
                ambang
                <Input type="number" min={1} style={{ width: 72 }} aria-label="ambang errors"
                  value={String((src("errors") as { minCount: number }).minCount)}
                  onChange={(e) => setSrc("errors", { minCount: num((e.target as HTMLInputElement).value) })} />
                ×
              </label>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function OptInPanel({ projects, onToggle, busyId }:
  { projects: ProjectVM[]; onToggle: (id: string, next: boolean) => void; busyId: string | null }) {
  return (
    <Card eyebrow="scheduler · opt-in project" title="Project yang diizinkan">
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)", marginBottom: 10 }}>
        Scheduler hanya menyentuh project yang di-opt-in. Default mati.
      </div>
      {projects.length === 0
        ? <div style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>Belum ada project.</div>
        : projects.map((p) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px" }}>
            <Switch label={p.name} checked={!!p.schedulerOptIn} disabled={busyId === p.id}
              onChange={(e) => onToggle(p.id, (e.target as HTMLInputElement).checked)} />
          </div>
        ))}
    </Card>
  );
}
```

- [x] **Step 4: Render kontrol di dalam `SchedulerScreen` + tambah state busy**

Di dalam `SchedulerScreen`, tambah state & handler sesudah `load` effect:

```tsx
  const [busy, setBusy] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const writeConfig = React.useCallback(async (next: Scheduler) => {
    setBusy(true);
    try { await api.putSchedulerConfig(next); onToast("Setelan scheduler tersimpan", "ok", "save"); load(true); }
    catch { onToast("Gagal menyimpan setelan", "err", "x-circle"); }
    finally { setBusy(false); }
  }, [load, onToast]);

  const toggleOptIn = React.useCallback(async (id: string, next: boolean) => {
    setBusyId(id);
    try { await api.updateProject(id, { schedulerOptIn: next }); await onProjectChanged(id); onToast(next ? "Project di-opt-in" : "Opt-in dicabut", "ok"); }
    catch { onToast("Gagal mengubah opt-in", "err", "x-circle"); }
    finally { setBusyId(null); }
  }, [onProjectChanged, onToast]);
```

Ganti komentar `{/* Task 4 menyisipkan ... */}` dengan:

```tsx
      <ControlBar cfg={state.config} cap={state.cap} liveCount={state.liveCount} onWrite={writeConfig} busy={busy} />
      <SettingsPanel cfg={state.config} onWrite={writeConfig} busy={busy} />
      <OptInPanel projects={projects} onToggle={toggleOptIn} busyId={busyId} />
```

- [x] **Step 5: Jalankan test — verifikasi lulus**

Run: `cd src && env -u NODE_ENV npx vitest run test/scheduler-screen.test.tsx`
Expected: PASS (observabilitas + kontrol, 6 test).

- [x] **Step 6: Commit**

```bash
git add src/src/screens/SchedulerScreen.tsx src/test/scheduler-screen.test.tsx
git commit -m "feat(spec-299): kontrol Pause/Stop + panel setelan + opt-in per project di SchedulerScreen"
```

---

### Task 5: Navigasi (shell) + wiring App

**Files:**
- Modify: `src/src/ds/shell.tsx` (tambah nav item)
- Modify: `src/src/App.tsx` (import + cabang `section === "scheduler"`)
- Test: `src/test/scheduler-nav.test.tsx` (create)

**Interfaces:**
- Consumes: `SchedulerScreen` (Task 3/4); `projectsView`, `backlog`, `refreshProject`, `showToast`, `setSection` (App, sudah ada).
- Produces: nav item `scheduler` + section render.

- [x] **Step 1: Tambah nav item di `src/src/ds/shell.tsx`**

Di array `HN_NAV`, sisipkan sesudah baris `triage` (sebelum `terminal`):

```ts
  { key: "scheduler", label: "Scheduler", icon: "calendar-clock" },
```

- [x] **Step 2: Import + cabang section di `src/src/App.tsx`**

Tambah import (dekat import screen lain, mis. sesudah `TriageScreen`):

```ts
import { SchedulerScreen } from "./screens/SchedulerScreen";
```

Sisipkan cabang baru sesudah blok `} else if (section === "vps") { ... }` (dan sebelum `} else if (section === "docs") {`):

```tsx
  } else if (section === "scheduler") {
    // SPEC-299 · Panel Scheduler otonom: observabilitas + setelan + opt-in + rem darurat.
    // Screen mandiri (pola VPS/Errors) — memuat state fondasi sendiri (HTTP polling), tak lewat `gate`.
    screen = (
      <Shell active="scheduler" title="Scheduler" breadcrumb="otonom · jadwal → antrean → sesi" onNavigate={setSection}>
        <SchedulerScreen projects={projectsView} backlog={backlog}
          onProjectChanged={refreshProject} onToast={showToast}
          onGotoTerminal={() => setSection("terminal")} />
      </Shell>
    );
  }
```

- [x] **Step 3: Tulis test — `src/test/scheduler-nav.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Shell } from "../src/ds/shell";

// Nav item Scheduler harus ada & memicu navigasi.
describe("Shell nav · Scheduler (SPEC-299)", () => {
  it("merender item nav Scheduler dan memanggil onNavigate('scheduler')", () => {
    const onNavigate = vi.fn();
    render(<Shell active="overview" title="x" onNavigate={onNavigate}><div /></Shell>);
    const item = screen.getByText("Scheduler");
    expect(item).toBeInTheDocument();
    item.click();
    expect(onNavigate).toHaveBeenCalledWith("scheduler");
  });
});
```

- [x] **Step 4: Jalankan test — verifikasi lulus**

Run: `cd src && env -u NODE_ENV npx vitest run test/scheduler-nav.test.tsx`
Expected: PASS.

- [x] **Step 5: Verifikasi typecheck & build frontend**

Run: `cd src && npx tsc --noEmit`
Expected: exit 0 (tak ada unused `projects`/`onProjectChanged` karena sudah dipakai Task 4).

- [x] **Step 6: Commit**

```bash
git add src/src/ds/shell.tsx src/src/App.tsx src/test/scheduler-nav.test.tsx
git commit -m "feat(spec-299): nav item Scheduler + wiring section di App"
```

---

### Task 6: Docs SoT + verifikasi nyata (curl + visual) + full suite

**Files:**
- Modify: `internal/docs/architecture/api-contract.md` (dokumentasikan konsumsi endpoint scheduler oleh panel)
- Modify: `internal/docs/README.md` (pastikan link SPEC-299/panel bila perlu — index sudah punya ADR-0072)
- Modify: file plan ini (centang semua `- [ ]` → `- [x]`)

**Interfaces:** — (dokumentasi & verifikasi; tak menghasilkan API baru)

- [x] **Step 1: Perbarui `internal/docs/architecture/api-contract.md`**

Cari bagian scheduler (SPEC-294). Tambahkan catatan singkat bahwa panel Scheduler (SPEC-299) mengonsumsi `GET /api/scheduler/config`, `GET /api/scheduler/state` (read-only) dan `PUT /api/scheduler/config` (Pause/Stop/knob), serta `PATCH /projects/:id { schedulerOptIn }` untuk opt-in — tanpa endpoint baru. (Bila belum ada bagian scheduler, tambahkan sub-bagian ringkas.)

- [x] **Step 2: Boot server terhadap DB throwaway + curl endpoint**

```bash
# dari root worktree — pola live-smoke DB khusus (bukan hanoman_test)
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-299
# (asumsi node_modules + prisma generate + migrate deploy sudah untuk DB base hanoman299)
# 1. login → cookie; 2. GET config/state; 3. PUT pause; 4. PATCH opt-in; 5. GET state ulang
```

Jalankan langkah nyata (lihat catatan smoke di memory): buat user via `POST /api/auth/setup`, simpan cookie, lalu:
- `curl -b cookie GET /api/scheduler/config` → 200 blok Scheduler (default mati).
- `curl -b cookie GET /api/scheduler/state` → 200 `{config,cap,liveCount,sources,queue,sessions}`.
- `curl -b cookie -X PUT /api/scheduler/config -d '{..., "paused":true}'` → 200; GET state → `config.paused=true`.
- Seed satu project + `curl -b cookie -X PATCH /api/projects/<id> -d '{"schedulerOptIn":true}'` → 200 `schedulerOptIn:true`.

Expected: semua 200 & nilai berubah sesuai. Fix bila ada yang merah sebelum lanjut.

- [x] **Step 3: Bukti visual (smoke browser CDP)**

Boot dev/preview frontend + server, buka `#` → nav Scheduler, screenshot panel dengan minimal satu queue item (seed via SQL `SchedulerQueueItem` status done + failed) agar section done/gagal terisi. Simpan screenshot ke scratchpad.

- [x] **Step 4: Full suite hijau**

Run (root): `env -u NODE_ENV -u DATABASE_URL npx vitest run --no-file-parallelism`
Expected: seluruh test lama + baru PASS.

- [x] **Step 5: Centang plan + commit docs**

Tandai semua `- [ ]` di plan ini menjadi `- [x]`.

```bash
git add internal/docs/architecture/api-contract.md internal/docs/README.md docs/superpowers/plans/2026-07-22-scheduler-panel-observability-spec-299.md
git commit -m "docs(spec-299): panel scheduler konsumsi API fondasi + tandai plan selesai"
```

---

## Self-Review

**Spec coverage** (design → task):
- §Observabilitas per-source (status/last-run/next-run) → Task 3 (SourceCard). ✓
- Antrean, sesi berjalan, done+ringkasan(link review), gagal+alasan → Task 3 (Queue/Session/Done/Failed rows). ✓
- §Setting semua knob (enable+cadence per source, cap, autonomy, ambang errors) → Task 4 (SettingsPanel → putSchedulerConfig). ✓
- Opt-in per project (default mati, pola helpEnabled) → Task 4 (OptInPanel → updateProject schedulerOptIn). ✓
- §Rem darurat Pause/Stop → Task 4 (ControlBar). ✓
- Nav item ds/shell.tsx + screen mandiri self-poll → Task 5 + Task 3. ✓
- Konsumsi API read-only fondasi, tanpa endpoint/skema/ADR baru → Task 1/2 (hanya tipe+client). ✓
- Bukti curl + visual → Task 6. ✓

**Type consistency:** `SchedulerScreenProps` (Task 3) dipakai identik di Task 4 & 5. `Scheduler`/`SchedulerStateView`/`SchedulerQueueItemView`/`SchedulerSessionView`/`SchedulerSourceView` konsisten dari Task 1 → 3/4. `writeConfig(next: Scheduler)` dipakai ControlBar & SettingsPanel. `toggleOptIn(id, next)` cocok `OptInPanel.onToggle`. ✓

**Placeholder scan:** tak ada TBD/TODO; semua step berisi kode/perintah nyata. ✓

**Catatan eksekusi:** Task 3 & 4 memodifikasi file yang sama (`SchedulerScreen.tsx`); `projects`/`onProjectChanged` di signature Task 3 baru terpakai di Task 4 — bila menjalankan `tsc --noEmit` di antara keduanya, gabungkan Task 3+4 dalam satu sesi eksekusi atau abaikan unused sampai Task 4 selesai (typecheck final di Task 5 Step 5).
