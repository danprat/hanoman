import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import {
  issueAgentToken, verifyAgentToken, listAgentTokens, patchAgentToken, revokeAgentToken,
} from "../src/services/agent-token";

const clean = async () => { await prisma.agentToken.deleteMany(); };
beforeEach(clean);
afterAll(clean);

describe("agent-token service", () => {
  it("issues a token: plaintext once, hash-at-rest, prefix hint", async () => {
    const { view, token } = await issueAgentToken({ name: "ci-bot", capabilities: ["projects:read"] });
    expect(token).toMatch(/^hnm_agt_[0-9a-f]{48}$/);
    expect(view.tokenPrefix).toBe(token.slice(0, 16));
    expect(view.capabilities).toEqual(["projects:read"]);
    expect(view.enabled).toBe(true);
    expect(view).not.toHaveProperty("tokenHash");
    const row = await prisma.agentToken.findUnique({ where: { id: view.id } });
    expect(row!.tokenHash).not.toContain(token);
  });

  it("verifies a valid token, rejects wrong/revoked/disabled, bumps lastUsedAt", async () => {
    const { view, token } = await issueAgentToken({ name: "bot", capabilities: ["backlog:write"] });
    const ok = await verifyAgentToken(token);
    expect(ok).toMatchObject({ id: view.id, capabilities: ["backlog:write"] });
    expect(await verifyAgentToken("hnm_agt_deadbeef")).toBeNull();

    await patchAgentToken(view.id, { enabled: false });
    expect(await verifyAgentToken(token)).toBeNull();
    await patchAgentToken(view.id, { enabled: true });
    expect(await verifyAgentToken(token)).not.toBeNull();

    await revokeAgentToken(view.id);
    expect(await verifyAgentToken(token)).toBeNull();
  });

  it("lists (no secrets) and patches capabilities", async () => {
    const { view } = await issueAgentToken({ name: "bot", capabilities: ["projects:read"] });
    const patched = await patchAgentToken(view.id, { capabilities: ["projects:read", "docs:write"], name: "bot2" });
    expect(patched!.capabilities).toEqual(["projects:read", "docs:write"]);
    expect(patched!.name).toBe("bot2");
    const list = await listAgentTokens();
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty("tokenHash");
    expect(await patchAgentToken("nope", { name: "x" })).toBeNull();
    expect(await revokeAgentToken("nope")).toBe(false);
  });
});
