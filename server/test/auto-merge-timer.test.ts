import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startAutoMerge, stopAutoMerge } from "../src/services/auto-merge";

afterEach(() => stopAutoMerge());

describe("timer sweep auto-merge (SPEC-486)", () => {
  it("startAutoMerge idempoten — dua panggilan satu timer", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    startAutoMerge();
    startAutoMerge();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  // app.ts bebas-timer (kontrak SPEC-294/ADR-0072): test yang mem-build app tak boleh
  // menghidupkan pekerjaan latar.
  it("dipasang dari server.ts, bukan app.ts", () => {
    const root = join(__dirname, "..", "src");
    expect(readFileSync(join(root, "server.ts"), "utf8")).toContain("startAutoMerge");
    expect(readFileSync(join(root, "app.ts"), "utf8")).not.toContain("startAutoMerge");
  });
});
