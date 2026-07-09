import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const runControl = vi.fn(async (_id: string, _action: string) => ({ accepted: true }));

vi.mock("../src/api/client", () => ({
  api: {
    runControl: (id: string, action: string) => runControl(id, action),
    runChanges: vi.fn(async () => ({ base: null, head: null, commits: [], files: [] })),
  },
  subscribeRun: vi.fn(() => () => {}),
  ApiError: class extends Error {},
}));
import { RunsScreen } from "../src/screens/RunsScreen";

const RUN = {
  id: "RUN-1", projectId: "arta", specId: "SPEC-149", kind: "qa", status: "failed",
  trigger: "manual", triggerDetail: "", phases: [], plan: [], files: [], log: [],
  worktree: ".worktrees/run-1", branchFrom: "main", branchTo: "hanoman/run-1",
  model: "", tokensIn: "—", tokensOut: "—", cost: "$0.00", progress: 0,
  createdAt: "2026-07-09T00:00:00.000Z", finishedAt: "2026-07-09T00:01:00.000Z",
  project: "demo", spec: "SPEC-149", title: "Retry Runs", phase: null,
};

describe("retry run yang failed (SPEC-149)", () => {
  beforeEach(() => { runControl.mockClear(); });

  it("run failed menampilkan tombol Retry yang memanggil control action retry", () => {
    render(<RunsScreen runs={[RUN] as never[]} />);
    fireEvent.click(screen.getByText("Retry"));
    expect(runControl).toHaveBeenCalledWith("RUN-1", "retry");
  });

  it("run running tidak menampilkan tombol Retry", () => {
    render(<RunsScreen runs={[{ ...RUN, status: "running" }] as never[]} />);
    expect(screen.queryByText("Retry")).toBeNull();
  });
});
