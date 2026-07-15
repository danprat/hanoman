import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../src/api/client";

describe("client binding (SPEC-217)", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("putBinding memanggil PUT /api/projects/:id/binding", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ repoDir: "/tmp/x" }), { status: 200, headers: { "content-type": "application/json" } }));
    await api.putBinding("p1", "/tmp/x");
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/binding", expect.objectContaining({ method: "PUT" }));
  });

  it("deleteBinding memanggil DELETE /api/projects/:id/binding", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await api.deleteBinding("p1");
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/binding", expect.objectContaining({ method: "DELETE" }));
  });

  it("updateProject bisa mengirim repoDir", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "p1" }), { status: 200, headers: { "content-type": "application/json" } }));
    await api.updateProject("p1", { repoDir: "/srv/x" });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ repoDir: "/srv/x" });
  });
});
