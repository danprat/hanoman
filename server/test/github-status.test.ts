import { describe, it, expect, vi } from "vitest";
import { postStatus } from "../src/github/status";

describe("status", () => {
  it("maps run status to commit state", async () => {
    const createCommitStatus = vi.fn(async () => ({}));
    const octo = { rest: { repos: { createCommitStatus } } } as any;
    await postStatus(octo, { owner: "n", repo: "arta", sha: "abc" }, "done");
    expect(createCommitStatus).toHaveBeenCalledWith(expect.objectContaining({ state: "success" }));
  });

  it("skips unmapped statuses (e.g. paused)", async () => {
    const createCommitStatus = vi.fn(async () => ({}));
    const octo = { rest: { repos: { createCommitStatus } } } as any;
    await postStatus(octo, { owner: "n", repo: "arta", sha: "abc" }, "paused");
    expect(createCommitStatus).not.toHaveBeenCalled();
  });
});
