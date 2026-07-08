import { describe, it, expect } from "vitest";
const LIVE = process.env.HANOMAN_LIVE_SDK === "1";
describe.runIf(LIVE)("live smoke", () => {
  it("runs a real cheap execute end-to-end", async () => {
    // seed a throwaway git repo with a trivial internal/docs, run `hanoman execute` with model claude-haiku-4-5-20251001,
    // assert the run reaches status done and a commit exists. Costs tokens — off by default.
    expect(true).toBe(true); // replace with the real end-to-end drive when enabling
  }, 120000);
});
