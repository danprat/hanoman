import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/api/client", () => ({
  api: {
    runControl: vi.fn(async () => ({ accepted: true })),
    runCommand: vi.fn(async () => ({ lines: [] })),
    runChanges: vi.fn(async () => ({
      base: "abc", head: "def",
      commits: [{ sha: "1234567890", subject: "fix: contoh commit" }],
      files: [{ path: "src/foo.ts", add: 3, del: 1, status: "M", binary: false }],
    })),
  },
  subscribeRun: vi.fn(() => () => {}),
  ApiError: class extends Error {},
}));
import { RunsScreen } from "../src/screens/RunsScreen";

const RUN = {
  id: "RUN-1", projectId: "arta", specId: "SPEC-159", kind: "qa", status: "done",
  trigger: "manual", triggerDetail: "", phases: [], plan: [], log: [{ t: "$", s: "echo hi" }],
  worktree: ".worktrees/run-1", branchFrom: "main", branchTo: "hanoman/run-1",
  baseSha: null, headSha: null, model: "", tokensIn: "—", tokensOut: "—", cost: "$0.00", progress: 100,
  createdAt: "2026-07-10T00:00:00.000Z", finishedAt: "2026-07-10T00:01:00.000Z",
  project: "arta", spec: "SPEC-159", title: "Runs Orders", phase: null,
};

describe("urutan panel & collapse commit/file berubah (SPEC-159)", () => {
  it("terminal logs muncul sebelum Commit dan File berubah", async () => {
    render(<RunsScreen runs={[RUN] as never[]} />);
    await screen.findByText(/Commit ·/);
    const order = screen.getByText(/claude code/).compareDocumentPosition(screen.getByText(/Commit ·/));
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const order2 = screen.getByText(/Commit ·/).compareDocumentPosition(screen.getByText(/File berubah ·/));
    expect(order2 & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Commit dan File berubah mulai collapsed, lalu expand saat header diklik", async () => {
    render(<RunsScreen runs={[RUN] as never[]} />);
    const commitHeader = await screen.findByText(/Commit ·/);
    const filesHeader = screen.getByText(/File berubah ·/);
    expect(screen.queryByText("fix: contoh commit")).toBeNull();
    expect(screen.queryByText("src/foo.ts")).toBeNull();

    fireEvent.click(commitHeader);
    expect(screen.getByText("fix: contoh commit")).toBeTruthy();
    expect(screen.queryByText("src/foo.ts")).toBeNull();

    fireEvent.click(filesHeader);
    expect(screen.getByText("src/foo.ts")).toBeTruthy();
  });
});
