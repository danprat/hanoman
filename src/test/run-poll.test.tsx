import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const QUEUED_RUN = {
  id: "RUN-1", projectId: "arta", specId: "SPEC-142", kind: "qa", status: "queued",
  trigger: "manual", triggerDetail: "", phases: [], plan: [], files: [], log: [],
  worktree: ".worktrees/run-1", branchFrom: "main", branchTo: "hanoman/run-1",
  model: "", tokensIn: "—", tokensOut: "—", cost: "$0.00", progress: 0,
  createdAt: "2026-07-09T00:00:00.000Z", finishedAt: null,
};
const QA_SPEC = {
  id: "SPEC-142", projectId: "arta", title: "Runs", source: "qa", stage: "spec-ready",
  priority: "tinggi", author: "qa", objective: "runs status auto update", payload: null,
};

const runsFn = vi.fn(async () => [QUEUED_RUN]);
const specsFn = vi.fn(async () => [QA_SPEC]);

vi.mock("../src/api/client", () => ({
  api: {
    listProjects: vi.fn(async () => []),
    listSpecs: (...a: unknown[]) => specsFn(...(a as [])),
    listRuns: (...a: unknown[]) => runsFn(...(a as [])),
    listTriggers: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({})),
    startRun: vi.fn(), deleteSpec: vi.fn(), createSpec: vi.fn(),
    runChanges: vi.fn(async () => ({ base: null, head: null, commits: [], files: [] })),
  },
  subscribeRun: vi.fn(() => () => {}),
  ApiError: class extends Error {},
}));
import App from "../src/App";
import { RunsScreen } from "../src/screens/RunsScreen";

describe("daftar run auto-update (SPEC-142)", () => {
  beforeEach(() => { runsFn.mockClear(); specsFn.mockClear(); });
  afterEach(() => { vi.useRealTimers(); });

  it("me-refetch daftar run selama run masih queued", async () => {
    vi.useFakeTimers();
    render(<App />);
    // Dua langkah, dan urutannya penting. `load()` memanggil listRuns() sinkron, jadi
    // menunggu call-count-nya lolos sebelum React sempat commit setRuns. Tanpa flush
    // terpisah, advanceTimersByTimeAsync melompat ke 3100 ms selagi belum ada timer
    // terjadwal — interval poll baru terpasang setelah jam sudah lewat, dan tak pernah
    // berbunyi. Flush muat awal dulu, baru majukan satu tick poll 3 dtk.
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    expect(runsFn.mock.calls.length).toBeGreaterThan(1);
  });

  it("kartu backlog run queued menampilkan 'Buka run', bukan 'Mulai'", async () => {
    render(<App />);
    await act(async () => { await Promise.resolve(); }); // muat awal commit
    // Sidebar dirender sebelum konten, jadi [0] adalah item nav "Backlog".
    fireEvent.click(screen.getAllByText("Backlog")[0]!);
    expect(await screen.findByText("Buka run")).toBeInTheDocument();
    expect(screen.queryByText("Mulai")).toBeNull();
  });

  it("panel detail ikut jadi Running saat poll membawa status baru", () => {
    const vm = (status: string) => [{ ...QUEUED_RUN, status, project: "demo", spec: "SPEC-142",
      title: "Runs", phase: null }] as never[];
    // Overlay `live` di-snapshot sekali per run. Kalau deps-nya cuma id, re-render
    // dengan status baru membiarkan panel detail tertinggal di Queued.
    const { rerender } = render(<RunsScreen runs={vm("queued")} />);
    expect(screen.getAllByText("Queued").length).toBeGreaterThan(0);
    rerender(<RunsScreen runs={vm("running")} />);
    expect(screen.queryByText("Queued")).toBeNull();
    expect(screen.getAllByText("Running").length).toBe(2); // baris daftar + panel detail
  });
});
