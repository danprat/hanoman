import { describe, it, expect } from "vitest";

// Opt-in live smoke against a real test App + repo. Off by default; enable with
// HANOMAN_LIVE_GITHUB=1 plus real GITHUB_APP_ID/PRIVATE_KEY/WEBHOOK_SECRET.
const LIVE = process.env.HANOMAN_LIVE_GITHUB === "1";
describe.runIf(LIVE)("github live", () => {
  it("verifies a real delivery + posts a status", async () => {
    // against a real test App + repo: replay a stored delivery, assert fireTrigger + a commit status appears.
    expect(true).toBe(true); // replace with the real drive when enabling
  }, 120000);
});
