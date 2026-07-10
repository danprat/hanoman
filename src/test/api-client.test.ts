import { describe, it, expect, vi } from "vitest";
import { paths } from "@hanoman/shared";
import { api } from "../src/api/client";

// SPEC-162 · SSE run dan control run sudah tak ada; yang tersisa satu POST yang membuka sesi.
describe("api client · sesi backlog", () => {
  it("startSession mem-POST spec + flow ke path sesi terminal", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "spec-1" }), { status: 201, headers: { "content-type": "application/json" } }));
    const res = await api.startSession({ spec: "SPEC-1", flow: "feature" });
    expect(res.id).toBe("spec-1");
    expect(fetchMock).toHaveBeenCalledWith(paths.terminalSessions, expect.objectContaining({
      method: "POST", body: JSON.stringify({ spec: "SPEC-1", flow: "feature" }),
    }));
  });

  it("DELETE sesi mengembalikan undefined pada 204, bukan melempar", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.deleteTerminal("spec-1")).resolves.toBeUndefined();
  });
});
