import { describe, it, expect, vi, afterEach } from "vitest";
import { api } from "../src/api/client";
import { paths } from "@hanoman/shared";

afterEach(() => vi.unstubAllGlobals());

describe("api.renameProject (SPEC-255)", () => {
  it("path helper meng-encode id", () => {
    expect(paths.projectRename("a b")).toContain("/projects/a%20b/rename");
  });

  it("POST ke /projects/:id/rename dengan { newId }", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "new", affected: {} }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await api.renameProject("old", "new");
    expect(r.id).toBe("new");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/projects/old/rename");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ newId: "new" });
  });
});
