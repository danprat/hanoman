import { describe, it, expect } from "vitest";
import { capabilityForRoute, checkAgentCapability } from "../src/services/agent-capabilities";

describe("capabilityForRoute", () => {
  const cases: [string, string, unknown][] = [
    ["GET", "/api/projects", "projects:read"],
    ["POST", "/api/projects", "projects:write"],
    ["GET", "/api/projects/foo", "projects:read"],
    ["POST", "/api/projects/foo/rename", "projects:write"],
    ["GET", "/api/projects/foo/branches", "projects:read"],
    ["PUT", "/api/projects/foo/binding", "projects:write"],
    ["GET", "/api/projects/foo/docs/README.md", "docs:read"],
    ["PUT", "/api/projects/foo/docs/x.md", "docs:write"],
    ["GET", "/api/projects/foo/prds", "docs:read"],
    ["GET", "/api/prds", "docs:read"],
    ["GET", "/api/projects/foo/tree", "ide:read"],
    ["POST", "/api/projects/foo/git", "ide:write"],
    ["GET", "/api/projects/foo/status", "ide:read"],
    ["POST", "/api/projects/foo/remotes", "ide:write"],
    ["GET", "/api/specs", "backlog:read"],
    ["POST", "/api/specs", "backlog:write"],
    ["POST", "/api/specs/SPEC-1/integrate", "backlog:write"],
    ["GET", "/api/terminal/sessions", "sessions:read"],
    ["POST", "/api/terminal/sessions", "sessions:write"],
    ["GET", "/api/terminal/sessions/abc/ws", "sessions:write"], // WS = kontrol interaktif
    ["GET", "/api/vps", "vps:read"],
    ["POST", "/api/vps/v1/harden", "vps:write"],
    ["GET", "/api/settings", "settings:read"],
    ["PUT", "/api/settings", "settings:write"],
    ["GET", "/api/config", "settings:read"],
    ["GET", "/api/errors", "support:read"],
    ["POST", "/api/errors/e1/escalate", "support:write"],
    ["GET", "/api/tickets", "support:read"],
    ["POST", "/api/tickets/t1/accept", "support:write"],
    ["GET", "/api/notifications", "notifications:read"],
    ["POST", "/api/notifications/read", "notifications:write"],
    ["GET", "/api/limits", "GLOBAL_READ"],
    ["GET", "/api/update", "GLOBAL_READ"],
    ["GET", "/api/events/ws", "GLOBAL_READ"],
    ["GET", "/api/fs/browse", "GLOBAL_READ"],
    ["GET", "/api/auth/users", "COOKIE_ONLY"],
    ["GET", "/api/agent-tokens", "COOKIE_ONLY"],
    ["POST", "/api/agent-tokens", "COOKIE_ONLY"],
    ["GET", "/api/device-tokens", "COOKIE_ONLY"],
    ["GET", "/api/sync/pull", "COOKIE_ONLY"],
    ["GET", "/api/nonsense", null],
  ];
  it.each(cases)("%s %s → %s", (m, p, want) => {
    expect(capabilityForRoute(m, p)).toBe(want);
  });
});

describe("checkAgentCapability", () => {
  it("allows when granted, write covers read, denies otherwise", () => {
    expect(checkAgentCapability(["projects:read"], "GET", "/api/projects")).toEqual({ ok: true });
    expect(checkAgentCapability(["projects:write"], "GET", "/api/projects")).toEqual({ ok: true });
    expect(checkAgentCapability(["projects:read"], "POST", "/api/projects"))
      .toMatchObject({ ok: false, status: 403, need: "projects:write", reason: "capability" });
    expect(checkAgentCapability(["projects:read"], "GET", "/api/auth/users"))
      .toMatchObject({ ok: false, status: 403, reason: "cookie-only" });
    expect(checkAgentCapability(["projects:read"], "GET", "/api/nonsense"))
      .toMatchObject({ ok: false, status: 403, reason: "cookie-only" });
    // GLOBAL_READ: token dengan capability apa pun boleh
    expect(checkAgentCapability(["projects:read"], "GET", "/api/limits")).toEqual({ ok: true });
  });
});
