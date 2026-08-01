import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

const models = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]));

function fields(name: string): string[] {
  return models.get(name)?.fields.map((field) => field.name) ?? [];
}

describe("Telegram gateway durable schema (SPEC-476)", () => {
  it("exposes every local-only Telegram model", () => {
    expect([...models.keys()].filter((name) => name.startsWith("Telegram")).sort()).toEqual([
      "TelegramAudit",
      "TelegramChat",
      "TelegramConfirmation",
      "TelegramGatewayState",
      "TelegramMemory",
      "TelegramOutbox",
      "TelegramUpdate",
    ]);
  });

  it("persists offset, binding, claims, memory, outbox, confirmation, and metadata audit", () => {
    expect(fields("TelegramGatewayState")).toEqual(expect.arrayContaining(["id", "offset", "lastUpdateAt", "lastError"]));
    expect(fields("TelegramChat")).toEqual(expect.arrayContaining([
      "chatId", "userId", "sessionId", "activeProjectId", "activeSessionId",
      "personalityAgentId", "summary", "agent", "model", "effort", "lastProgressKey",
    ]));
    expect(fields("TelegramUpdate")).toEqual(expect.arrayContaining([
      "updateId", "chatId", "userId", "kind", "digest", "state", "receivedAt", "claimedAt", "dispatchedAt",
    ]));
    expect(fields("TelegramMemory")).toEqual(expect.arrayContaining(["id", "chatId", "content", "createdAt", "updatedAt"]));
    expect(fields("TelegramOutbox")).toEqual(expect.arrayContaining([
      "id", "chatId", "updateId", "kind", "dedupeKey", "text", "state", "telegramMessageId", "createdAt", "sentAt",
      "confirmationId",
    ]));
    expect(fields("TelegramConfirmation")).toEqual(expect.arrayContaining([
      "id", "callbackToken", "chatId", "userId", "updateId", "description", "method", "path", "state", "expiresAt", "usedAt",
    ]));
    expect(fields("TelegramAudit")).toEqual(expect.arrayContaining([
      "id", "chatId", "userId", "updateId", "action", "outcome", "correlationId", "method", "path", "statusCode", "createdAt",
    ]));
  });

  it("enforces identities and dedupe keys at the database boundary", () => {
    expect(models.get("TelegramGatewayState")?.fields.find((field) => field.name === "id")?.isId).toBe(true);
    expect(models.get("TelegramChat")?.fields.find((field) => field.name === "chatId")?.isId).toBe(true);
    expect(models.get("TelegramChat")?.fields.find((field) => field.name === "userId")?.isUnique).toBe(true);
    expect(models.get("TelegramUpdate")?.fields.find((field) => field.name === "updateId")?.isId).toBe(true);
    expect(models.get("TelegramOutbox")?.fields.find((field) => field.name === "dedupeKey")?.isUnique).toBe(true);
    expect(models.get("TelegramConfirmation")?.fields.find((field) => field.name === "callbackToken")?.isUnique).toBe(true);
  });

  it("does not add sync versioning or credential/body columns", () => {
    for (const name of [...models.keys()].filter((candidate) => candidate.startsWith("Telegram"))) {
      expect(fields(name)).not.toContain("version");
      expect(fields(name)).not.toContain("botToken");
      expect(fields(name)).not.toContain("agentToken");
      expect(fields(name)).not.toContain("body");
    }
  });
});
