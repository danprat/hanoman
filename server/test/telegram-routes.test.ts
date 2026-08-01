import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { capabilityForRoute } from "../src/services/agent-capabilities";
import { issueAgentToken } from "../src/services/agent-token";
import { DEFAULT_SETTING } from "../src/services/settings";
import { clearTelegramRuntime, setTelegramRuntime } from "../src/services/telegram/runtime";
import { TelegramStore } from "../src/services/telegram/store";

const app = buildApp();
const store = new TelegramStore(prisma);
let headers: { authorization: string };

async function clean() {
  clearTelegramRuntime();
  await prisma.$transaction([
    prisma.telegramAudit.deleteMany(), prisma.telegramConfirmation.deleteMany(),
    prisma.telegramOutbox.deleteMany(), prisma.telegramMemory.deleteMany(),
    prisma.telegramUpdate.deleteMany(), prisma.telegramChat.deleteMany(),
    prisma.telegramGatewayState.deleteMany(), prisma.agentToken.deleteMany(), prisma.setting.deleteMany(),
  ]);
}

beforeEach(async () => {
  await clean();
  await prisma.setting.create({ data: { id: 1, data: { ...DEFAULT_SETTING, agentAccessEnabled: true } } });
  const { token } = await issueAgentToken({ name: "telegram-test", capabilities: ["telegram:read", "telegram:write"] });
  headers = { authorization: `Bearer ${token}` };
  setTelegramRuntime({
    agentTokenId: null,
    status: {
      configured: true, enabled: true, running: true, readiness: "running",
      botUsername: "hanoman_bot", allowlistCount: 1, agentTokenConfigured: true,
      missingCapabilities: [],
      lastUpdateAt: null, lastError: null,
    },
  });
  await store.ensureChat({ chatId: "42", userId: "7", agent: "claude", model: "claude-opus-5", effort: "xhigh" });
});
afterAll(async () => { await clean(); await app.close(); });

describe("Telegram API capability and status (SPEC-476)", () => {
  it("maps Telegram routes by method and exposes secret-free readiness", async () => {
    expect(capabilityForRoute("GET", "/api/telegram/status")).toBe("telegram:read");
    expect(capabilityForRoute("POST", "/api/telegram/replies")).toBe("telegram:write");
    const response = await app.inject({ method: "GET", url: "/api/telegram/status", headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ running: true, botUsername: "hanoman_bot" });
    expect(response.json()).not.toHaveProperty("botToken");
    expect(response.json()).not.toHaveProperty("agentToken");
    expect(JSON.stringify(response.json())).not.toContain("hnm_agt_");
  });

  it("requires Telegram capability", async () => {
    const { token } = await issueAgentToken({ name: "projects-only", capabilities: ["projects:read"] });
    const response = await app.inject({
      method: "GET", url: "/api/telegram/status", headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ need: "telegram:read" });
  });
});

describe("Telegram context, memory, reply, and audit routes (SPEC-476)", () => {
  it("reads and patches a durable chat context", async () => {
    expect((await app.inject({
      method: "PATCH", url: "/api/telegram/chats/42/context", headers,
      payload: { activeProjectId: "hanoman", summary: "Mengerjakan SPEC-476." },
    })).statusCode).toBe(200);
    const response = await app.inject({ method: "GET", url: "/api/telegram/chats/42/context", headers });
    expect(response.json()).toMatchObject({ chatId: "42", activeProjectId: "hanoman", summary: "Mengerjakan SPEC-476." });
    expect(response.json().memories).toEqual([]);
  });

  it("creates, forgets, and resets curated memory", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/telegram/chats/42/memories", headers, payload: { content: "Jawab ringkas." },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    expect((await app.inject({ method: "DELETE", url: `/api/telegram/chats/42/memories/${id}`, headers })).statusCode).toBe(204);
    await app.inject({ method: "POST", url: "/api/telegram/chats/42/memories", headers, payload: { content: "Kedua." } });
    expect((await app.inject({ method: "DELETE", url: "/api/telegram/chats/42/memories", headers })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/telegram/chats/42/context", headers })).json())
      .toMatchObject({ summary: null, memories: [] });
  });

  it("accepts explicit replies only for a matching dispatched update and deduplicates kind", async () => {
    await store.recordUpdate({ updateId: 17, chatId: "42", userId: "7", kind: "text", digest: "a".repeat(64) });
    await store.claimUpdate(17);
    await store.markDispatched(17);
    const payload = { chatId: "42", updateId: 17, kind: "final", text: "Selesai." };
    const first = await app.inject({ method: "POST", url: "/api/telegram/replies", headers, payload });
    const duplicate = await app.inject({ method: "POST", url: "/api/telegram/replies", headers, payload: { ...payload, text: "Duplikat" } });
    expect(first.statusCode).toBe(202);
    expect(duplicate.json().id).toBe(first.json().id);
    expect(await prisma.telegramOutbox.count()).toBe(1);
    expect((await app.inject({
      method: "POST", url: "/api/telegram/replies", headers,
      payload: { ...payload, updateId: 99 },
    })).statusCode).toBe(409);
  });

  it("returns paginated metadata audit without request bodies", async () => {
    await store.audit({ chatId: "42", userId: "7", updateId: 17, action: "dispatch", outcome: "accepted" });
    const response = await app.inject({ method: "GET", url: "/api/telegram/audit?chatId=42&take=10&skip=0", headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ total: 1, items: [expect.objectContaining({ action: "dispatch" })] });
    expect(JSON.stringify(response.json())).not.toContain("requestBody");
  });
});
