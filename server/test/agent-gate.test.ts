import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueAgentToken } from "../src/services/agent-token";

const app = buildApp();
const clean = async () => {
  await prisma.agentToken.deleteMany(); await prisma.setting.deleteMany();
  await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(clean);
afterAll(clean);

const blob = (agentAccessEnabled: boolean) => ({
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true,
  notifyFail: true, notifyDone: true, notifySound: "short",
  notifyDecision: true, notifyDecisionSound: "alert", agentAccessEnabled,
});
const setMaster = (on: boolean) => prisma.setting.upsert({
  where: { id: 1 }, update: { data: blob(on) }, create: { id: 1, data: blob(on) },
});

describe("agent token gate", () => {
  it("no token → 401", async () => {
    expect((await app.inject({ method: "GET", url: "/api/projects" })).statusCode).toBe(401);
  });

  it("valid token + master ON + capability → 200; missing capability → 403", async () => {
    await setMaster(true);
    const { token } = await issueAgentToken({ name: "bot", capabilities: ["projects:read"] });
    const h = { authorization: `Bearer ${token}` };
    expect((await app.inject({ method: "GET", url: "/api/projects", headers: h })).statusCode).toBe(200);
    const r = await app.inject({ method: "GET", url: "/api/specs", headers: h });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ error: expect.any(String), need: "backlog:read" });
  });

  it("master switch OFF → valid token still 401", async () => {
    await setMaster(false);
    const { token } = await issueAgentToken({ name: "bot", capabilities: ["projects:read"] });
    expect((await app.inject({ method: "GET", url: "/api/projects", headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
  });

  it("cookie-only route (device-tokens, auth) → 403 for agent even with all caps", async () => {
    await setMaster(true);
    const { token } = await issueAgentToken({ name: "bot", capabilities: ["settings:write", "projects:write"] });
    const h = { authorization: `Bearer ${token}` };
    expect((await app.inject({ method: "GET", url: "/api/device-tokens", headers: h })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/auth/users", headers: h })).statusCode).toBe(403);
  });

  it("revoked token → 401", async () => {
    await setMaster(true);
    const { token, view } = await issueAgentToken({ name: "bot", capabilities: ["projects:read"] });
    await prisma.agentToken.update({ where: { id: view.id }, data: { revokedAt: new Date() } });
    expect((await app.inject({ method: "GET", url: "/api/projects", headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
  });
});
