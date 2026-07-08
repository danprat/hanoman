import { describe, it, expect } from "vitest";
import { checkRunnerCredentials } from "../src/runner/credentials";

describe("checkRunnerCredentials", () => {
  it("boots (silent) with an OAuth token env cred", () => {
    const r = checkRunnerCredentials({ CLAUDE_CODE_OAUTH_TOKEN: "tok" }, false);
    expect(r).toMatchObject({ ok: true, hasEnvCred: true });
    expect(r.found).toContain("CLAUDE_CODE_OAUTH_TOKEN");
  });
  it("boots with an API key env cred", () => {
    expect(checkRunnerCredentials({ ANTHROPIC_API_KEY: "k" }, false)).toMatchObject({ ok: true, hasEnvCred: true });
  });
  it("boots with a cloud-provider flag", () => {
    expect(checkRunnerCredentials({ CLAUDE_CODE_USE_BEDROCK: "1" }, false)).toMatchObject({ ok: true, hasEnvCred: true });
  });
  it("warns (ok) with no env cred but a TTY", () => {
    const r = checkRunnerCredentials({}, true);
    expect(r).toMatchObject({ ok: true, hasEnvCred: false });
    expect(r.reason).toBeTruthy();
  });
  it("refuses with no env cred and no TTY", () => {
    const r = checkRunnerCredentials({}, false);
    expect(r).toMatchObject({ ok: false, hasEnvCred: false });
    expect(r.reason).toBeTruthy();
  });
  it("treats a whitespace-only value as absent", () => {
    expect(checkRunnerCredentials({ ANTHROPIC_API_KEY: "   " }, false).ok).toBe(false);
  });
  it("bypass overrides the refuse path", () => {
    expect(checkRunnerCredentials({ HANOMAN_SKIP_CRED_CHECK: "1" }, false)).toMatchObject({ ok: true, hasEnvCred: false });
  });
});
