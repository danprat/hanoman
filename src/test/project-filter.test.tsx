import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/api/client", () => ({
  api: {
    runChanges: vi.fn(async () => ({ base: null, head: null, commits: [], files: [] })),
    listBranches: vi.fn(async () => ({ branches: [] })),
  },
  subscribeRun: vi.fn(() => () => {}),
  ApiError: class extends Error {},
}));
import { RunsScreen } from "../src/screens/RunsScreen";
import { BacklogScreen } from "../src/screens/BacklogScreen";

const run = (id: string, project: string) => ({
  id, projectId: project, project, specId: null, spec: null, kind: "qa", status: "done",
  trigger: "manual", triggerDetail: "", phases: [], plan: [], files: [], log: [],
  worktree: "", branchFrom: "main", branchTo: "hanoman/" + id.toLowerCase(),
  model: "", tokensIn: "—", tokensOut: "—", cost: "$0.00", progress: 100,
  createdAt: "2026-07-10T00:00:00.000Z", finishedAt: null, title: id, phase: null,
});
const spec = (id: string, projectId: string) => ({
  id, projectId, title: id, source: "qa", stage: "planned", priority: "tinggi",
  author: "qa", objective: "", payload: null,
});

describe("filter project (SPEC-146)", () => {
  it("RunsScreen hanya menampilkan run milik project terpilih", () => {
    render(<RunsScreen runs={[run("RUN-1", "arta"), run("RUN-2", "kirana")] as never}
      projectFilter="arta" onProjectFilter={() => {}} />);
    expect(screen.getAllByText("RUN-1").length).toBeGreaterThan(0);
    expect(screen.queryByText("RUN-2")).toBeNull();
  });

  it("RunsScreen tanpa filter menampilkan semua run (default 'all')", () => {
    render(<RunsScreen runs={[run("RUN-1", "arta"), run("RUN-2", "kirana")] as never} />);
    expect(screen.getAllByText("RUN-2").length).toBeGreaterThan(0);
  });

  it("BacklogScreen hanya menampilkan spec milik project terpilih", () => {
    render(<BacklogScreen backlog={[spec("SPEC-1", "arta"), spec("SPEC-2", "kirana")] as never}
      projects={[{ id: "arta", name: "arta" }, { id: "kirana", name: "kirana" }] as never}
      projectFilter="arta" onProjectFilter={() => {}} />);
    expect(screen.getAllByText("SPEC-1").length).toBeGreaterThan(0);
    expect(screen.queryByText("SPEC-2")).toBeNull();
  });
});
