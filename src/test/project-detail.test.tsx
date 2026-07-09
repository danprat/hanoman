import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

const PROJECT = {
  id: "arta", name: "arta", desc: "marketplace", kind: "existing", repoDir: "/repo/arta",
  repoUrl: null, stack: "ts", docStatus: "ok", coverage: 100, createdAt: "2026-07-10T00:00:00.000Z",
  backlog: 1, topStage: "planned", activity: "idle", commit: "belum ada commit",
  run: { status: "idle", phase: null, kind: null },
};
const RUN = {
  id: "RUN-9", projectId: "arta", specId: null, kind: "qa", status: "done",
  trigger: "manual", triggerDetail: "", phases: [], plan: [], files: [], log: [],
  worktree: "", branchFrom: "main", branchTo: "hanoman/run-9", model: "",
  tokensIn: "—", tokensOut: "—", cost: "$0.00", progress: 100,
  createdAt: "2026-07-10T00:00:00.000Z", finishedAt: null,
};

vi.mock("../src/api/client", () => ({
  api: {
    listProjects: vi.fn(async () => [PROJECT]),
    listSpecs: vi.fn(async () => []),
    listRuns: vi.fn(async () => [RUN]),
    listTriggers: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({})),
    runChanges: vi.fn(async () => ({ base: null, head: null, commits: [], files: [] })),
    updateProject: vi.fn(async (_id: string, b: { name?: string }) => ({ ...PROJECT, ...b })),
  },
  subscribeRun: vi.fn(() => () => {}),
  ApiError: class extends Error {},
}));
import App from "../src/App";

describe("detail project (SPEC-146)", () => {
  it("klik baris project membuka detail project, bukan Docs", async () => {
    render(<App />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getAllByText("Projects")[0]!);   // sidebar
    fireEvent.click(screen.getAllByText("arta")[0]!);       // baris project
    // Layar detail punya "Edit project"; layar Docs punya tombol "Muat ulang" (rescan tree,
    // unik untuk DocsWorkspace — "Source of Truth" sendiri juga jadi label pintu di detail).
    expect(await screen.findByText("Edit project")).toBeInTheDocument();
    expect(screen.queryByText("Muat ulang")).toBeNull();
  });

  it("tombol Runs di detail membuka Runs tersaring ke project itu", async () => {
    render(<App />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getAllByText("Projects")[0]!);
    fireEvent.click(screen.getAllByText("arta")[0]!);
    fireEvent.click(await screen.findByText("Lihat runs"));
    expect((await screen.findAllByText("RUN-9")).length).toBeGreaterThan(0);
  });
});
