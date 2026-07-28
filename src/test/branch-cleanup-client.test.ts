import { describe, it, expect, vi, afterEach } from "vitest";
import { api, LOCK_LABEL } from "../src/api/client";

// j() di client.ts: fetch → cek res.ok → res.json(). Mock cukup memenuhi tiga hal itu.
const mockFetch = (data: unknown) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true, status: 200, json: async () => data,
  } as unknown as Response);

afterEach(() => vi.restoreAllMocks());

describe("api branch cleanup (SPEC-360)", () => {
  it("branchesUnused memanggil path yang benar", async () => {
    const f = mockFetch({ base: "main", baseRemote: "origin/main", current: "main", branches: [] });
    await api.branchesUnused("p1");
    expect(String(f.mock.calls[0]![0])).toContain("/api/projects/p1/branches/unused");
  });

  it("branchesUnused meneruskan base sebagai query", async () => {
    const f = mockFetch({ base: "dev", baseRemote: null, current: "main", branches: [] });
    await api.branchesUnused("p1", "dev");
    expect(String(f.mock.calls[0]![0])).toContain("base=dev");
  });

  it("deleteBranches POST dengan names & scope", async () => {
    const f = mockFetch({ base: "main", results: [] });
    await api.deleteBranches("p1", { names: ["hanoman/x"], scope: "local" });
    expect(String(f.mock.calls[0]![0])).toContain("/api/projects/p1/branches/delete");
    const init = f.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ names: ["hanoman/x"], scope: "local" });
  });

  it("LOCK_LABEL punya prosa untuk tiap kunci", () => {
    for (const k of ["current", "base", "worktree", "spec-open", "session"] as const) {
      expect(LOCK_LABEL[k]).toMatch(/\S/);
    }
  });
});
