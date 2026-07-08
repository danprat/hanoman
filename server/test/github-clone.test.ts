import { describe, it, expect, vi } from "vitest";
vi.mock("node:child_process", () => ({ spawnSync: vi.fn(() => ({ status: 0, stdout: "", stderr: "" })) }));
import { spawnSync } from "node:child_process";
import { ensureClone } from "../src/github/clone";

describe("ensureClone", () => {
  it("clones when repoDir is missing", async () => {
    await ensureClone({ repoDir: "/nope/missing", repoUrl: "nafanesia/arta", installationId: 5 } as any, async () => "TKN");
    const call = (spawnSync as any).mock.calls.find((c: any[]) => c[1]?.includes("clone"));
    expect(call).toBeTruthy();
    expect(JSON.stringify(call)).toContain("x-access-token:TKN");
  });
});
