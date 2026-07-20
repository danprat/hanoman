import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { init, captureError, initHanomanErrors } from "../src/index";
import hanoman from "../src/index";

type Body = Record<string, unknown>;
function stubFetch() {
  const calls: { url: string; body: Body }[] = [];
  const fn = vi.fn((url: string, opts: { body: string }) => {
    calls.push({ url, body: JSON.parse(opts.body) as Body });
    return Promise.resolve({ ok: true });
  });
  (globalThis as { fetch?: unknown }).fetch = fn as unknown;
  return { calls, fn };
}

describe("hanoman-sdk", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("captureError mem-POST payload sesuai kontrak ADR-0060 ke dsn", () => {
    const { calls } = stubFetch();
    init({ dsn: "https://h.example/api/ingest/p?key=hnm_ing_x", environment: "production", release: "1.2.3" });
    captureError(new TypeError("x is undefined"), { route: "/checkout" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/api/ingest/p");
    expect(calls[0]!.body).toMatchObject({
      type: "TypeError", message: "x is undefined", environment: "production", release: "1.2.3",
      context: { route: "/checkout" },
    });
    expect(typeof calls[0]!.body.stack).toBe("string");
  });

  it("non-Error → type Error, message = String(err)", () => {
    const { calls } = stubFetch();
    init({ dsn: "https://h.example/api/ingest/p?key=k" });
    captureError("boom");
    expect(calls[0]!.body).toMatchObject({ type: "Error", message: "boom" });
  });

  it("dsn kosong → tak ada POST (no-op)", () => {
    const { fn } = stubFetch();
    init({});
    captureError(new Error("nope"));
    expect(fn).not.toHaveBeenCalled();
  });

  it("fire-and-forget: fetch reject tak melempar", () => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn(() => Promise.reject(new Error("down"))) as unknown;
    init({ dsn: "https://h.example/api/ingest/p?key=k" });
    expect(() => captureError(new Error("e"))).not.toThrow();
  });

  it("fire-and-forget: fetch throw sinkron tak melempar", () => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn(() => { throw new Error("sync"); }) as unknown;
    init({ dsn: "https://h.example/api/ingest/p?key=k" });
    expect(() => captureError(new Error("e"))).not.toThrow();
  });

  it("initHanomanErrors alias init; default export punya init+captureError", () => {
    expect(initHanomanErrors).toBe(init);
    expect(typeof hanoman.init).toBe("function");
    expect(typeof hanoman.captureError).toBe("function");
  });
});
