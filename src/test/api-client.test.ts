import { describe, it, expect, vi, beforeEach } from "vitest";
import { paths } from "@hanoman/shared";
import { subscribeRun, api } from "../src/api/client";

class FakeES {
  static last: FakeES;
  url: string; onmessage: ((e: { data: string }) => void) | null = null; closed = false;
  constructor(url: string) { this.url = url; FakeES.last = this; }
  close() { this.closed = true; }
}

beforeEach(() => { (globalThis as any).EventSource = FakeES as any; });

describe("api client live + control (SPEC-008)", () => {
  it("subscribeRun opens the SSE URL and forwards parsed events", () => {
    const seen: any[] = [];
    const off = subscribeRun("RUN-1", (e) => seen.push(e));
    expect(FakeES.last.url).toBe(paths.runLog("RUN-1"));
    FakeES.last.onmessage!({ data: JSON.stringify({ kind: "status", status: "done" }) });
    expect(seen).toEqual([{ kind: "status", status: "done" }]);
    off();
    expect(FakeES.last.closed).toBe(true);
  });

  it("runControl posts the action to the control path", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { "content-type": "application/json" } }));
    await api.runControl("RUN-1", "pause");
    expect(fetchMock).toHaveBeenCalledWith(paths.runControl("RUN-1"), expect.objectContaining({ method: "POST" }));
  });
});
