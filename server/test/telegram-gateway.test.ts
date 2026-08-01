import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { TelegramGateway, type TelegramGatewayClient, type TelegramInputDispatcher } from "../src/services/telegram/gateway";
import { TelegramStore } from "../src/services/telegram/store";
import { TelegramApiError } from "../src/services/telegram/client";
import { clearTelegramRuntime, telegramRuntimeStatus } from "../src/services/telegram/runtime";

const store = new TelegramStore(prisma);
const message = (updateId: number, text = "halo", userId = 7) => ({
  update_id: updateId,
  message: {
    message_id: updateId, date: 1,
    from: { id: userId, is_bot: false, first_name: "Dena" },
    chat: { id: 42, type: "private" }, text,
  },
});

function fakeClient(): TelegramGatewayClient & {
  sent: { chatId: string; text: string; replyMarkup?: unknown }[];
  answered: { callbackQueryId: string; text?: string }[];
} {
  const sent: { chatId: string; text: string; replyMarkup?: unknown }[] = [];
  const answered: { callbackQueryId: string; text?: string }[] = [];
  return {
    sent, answered,
    getUpdates: async () => [],
    sendMessage: async (input) => {
      sent.push(input);
      return { message_id: sent.length, date: 1, chat: { id: Number(input.chatId), type: "private" }, text: input.text };
    },
    answerCallbackQuery: async (input) => { answered.push(input); return true; },
  };
}

function dispatcher(): TelegramInputDispatcher & { inputs: { updateId: number; text: string }[] } {
  const inputs: { updateId: number; text: string }[] = [];
  return {
    inputs,
    dispatch: async (input) => { inputs.push({ updateId: input.updateId, text: input.text }); return { sessionId: "telegram-deadbeef", created: inputs.length === 1 }; },
  };
}

async function clean() {
  await prisma.$transaction([
    prisma.telegramAudit.deleteMany(), prisma.telegramConfirmation.deleteMany(),
    prisma.telegramOutbox.deleteMany(), prisma.telegramMemory.deleteMany(),
    prisma.telegramUpdate.deleteMany(), prisma.telegramChat.deleteMany(),
    prisma.telegramGatewayState.deleteMany(),
  ]);
}
beforeEach(clean);
afterAll(clean);

function gateway(opts: { rateLimit?: number } = {}) {
  const client = fakeClient();
  const dispatch = dispatcher();
  return {
    client, dispatch,
    gateway: new TelegramGateway({
      client, store, dispatcher: dispatch,
      allowedUserIds: new Set(["7"]),
      rateLimit: { limit: opts.rateLimit ?? 20, windowMs: 60_000 },
      exactSecrets: ["123456:BOT_SECRET", "hnm_agt_AGENT_SECRET"],
      progress: true,
    }),
  };
}

describe("TelegramGateway inbound state machine (SPEC-476)", () => {
  it("dispatches each update at most once and advances the durable offset", async () => {
    const x = gateway();
    await x.gateway.processUpdates([message(17), message(17)]);
    expect(x.dispatch.inputs).toEqual([{ updateId: 17, text: "halo" }]);
    expect(await store.offset()).toBe(18);
    expect((await prisma.telegramUpdate.findUnique({ where: { updateId: 17 } }))?.state).toBe("dispatched");
  });

  it("rejects group/non-allowlisted updates before touching a session", async () => {
    const x = gateway();
    const group = message(17) as any;
    group.message.chat.type = "group";
    await x.gateway.processUpdates([group, message(18, "halo", 8)]);
    expect(x.dispatch.inputs).toEqual([]);
    expect((await prisma.telegramUpdate.findMany({ orderBy: { updateId: "asc" } })).map((row) => row.state))
      .toEqual(["rejected", "rejected"]);
  });

  it("enforces a durable per-user rate limit", async () => {
    const x = gateway({ rateLimit: 1 });
    await x.gateway.processUpdates([message(17), message(18)]);
    expect(x.dispatch.inputs).toHaveLength(1);
    expect(await prisma.telegramUpdate.findUnique({ where: { updateId: 18 } })).toMatchObject({
      state: "rejected", rejectReason: "rate-limit",
    });
  });

  it("approves an owned callback once, acknowledges it, and forwards the result to the same dispatcher", async () => {
    await prisma.telegramConfirmation.create({ data: {
      callbackToken: "abc123", chatId: "42", userId: "7", updateId: 16,
      description: "Stop session", method: "DELETE", path: "/api/terminal/sessions/s-1",
      state: "pending", expiresAt: new Date(Date.now() + 60_000),
    } });
    const callback = {
      update_id: 17,
      callback_query: {
        id: "cb-1", from: { id: 7, is_bot: false, first_name: "Dena" }, data: "tgcf:abc123:approve",
        message: { message_id: 9, date: 1, chat: { id: 42, type: "private" } },
      },
    };
    const x = gateway();
    await x.gateway.processUpdates([callback]);
    expect((await prisma.telegramConfirmation.findUnique({ where: { callbackToken: "abc123" } }))?.state).toBe("approved");
    expect(x.client.answered).toEqual([{ callbackQueryId: "cb-1", text: "Disetujui" }]);
    expect(x.dispatch.inputs).toHaveLength(1);
  });
});

describe("TelegramGateway explicit outbox (SPEC-476)", () => {
  it("sends only sanitized explicit replies, split safely, then marks the row sent", async () => {
    const x = gateway();
    await store.enqueueReply({
      chatId: "42", updateId: 17, kind: "final",
      text: `${"a".repeat(4_100)} 123456:BOT_SECRET hnm_agt_AGENT_SECRET \u001b[31mDONE\u001b[0m`,
    });
    await x.gateway.flushOutbox();
    expect(x.client.sent.length).toBeGreaterThan(1);
    expect(x.client.sent.every((item) => item.text.length <= 4_096)).toBe(true);
    expect(x.client.sent.map((item) => item.text).join(" ")).not.toMatch(/BOT_SECRET|AGENT_SECRET|\u001b/);
    expect((await prisma.telegramOutbox.findFirst())?.state).toBe("sent");
  });

  it("adds opaque approve/deny buttons only to confirmation replies", async () => {
    const x = gateway();
    await store.enqueueReply({
      chatId: "42", updateId: 17, kind: "confirmation", text: "Stop?",
      confirmation: {
        callbackToken: "opaque123", userId: "7", description: "Stop", method: "DELETE",
        path: "/api/terminal/sessions/s-1", expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await x.gateway.flushOutbox();
    expect(x.client.sent[0]!.replyMarkup).toEqual({ inline_keyboard: [[
      { text: "Lanjutkan", callback_data: "tgcf:opaque123:approve" },
      { text: "Batalkan", callback_data: "tgcf:opaque123:deny" },
    ]] });
  });
});

describe("TelegramGateway lifecycle recovery (SPEC-476)", () => {
  it("marks crash-boundary claims uncertain and aborts a live long poll cleanly", async () => {
    clearTelegramRuntime();
    await store.recordUpdate({ updateId: 17, chatId: "42", userId: "7", kind: "text", digest: "a".repeat(64) });
    await store.enqueueReply({ chatId: "42", updateId: 17, kind: "progress", text: "mulai" });
    await store.claimNextOutbox();
    let polledOffset: number | null = null;
    const client = fakeClient();
    client.getUpdates = ({ offset, signal }) => new Promise((_, reject) => {
      polledOffset = offset;
      signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    });
    const g = new TelegramGateway({
      client, store, dispatcher: dispatcher(), allowedUserIds: new Set(["7"]),
      rateLimit: { limit: 20, windowMs: 60_000 }, exactSecrets: [], progress: true,
    });
    await g.start();
    expect((await prisma.telegramUpdate.findUnique({ where: { updateId: 17 } }))?.state).toBe("uncertain");
    expect((await prisma.telegramOutbox.findFirst())?.state).toBe("uncertain");
    expect(polledOffset).toBe(18);
    expect(telegramRuntimeStatus().running).toBe(true);
    await g.stop();
    expect(telegramRuntimeStatus().running).toBe(false);
  });

  it("stops instead of competing when Telegram reports long-poll conflict", async () => {
    clearTelegramRuntime();
    const client = fakeClient();
    client.getUpdates = async () => { throw new TelegramApiError("getUpdates", 409, "Conflict"); };
    const g = new TelegramGateway({
      client, store, dispatcher: dispatcher(), allowedUserIds: new Set(["7"]),
      rateLimit: { limit: 20, windowMs: 60_000 }, exactSecrets: [], progress: true,
    });
    await g.start();
    for (let i = 0; i < 50 && telegramRuntimeStatus().running; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(telegramRuntimeStatus()).toMatchObject({ running: false, readiness: "error" });
    expect(telegramRuntimeStatus().lastError).toContain("409");
    await g.stop();
  });
});
