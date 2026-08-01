import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueAgentToken } from "../src/services/agent-token";
import { DEFAULT_SETTING } from "../src/services/settings";
import {
  setTelegramEngine, telegramAgentDefaults, telegramEngineContext,
} from "../src/services/telegram/config";
import { TELEGRAM_REQUIRED_CAPABILITIES } from "../src/services/telegram/bootstrap";
import { TelegramGateway, type TelegramGatewayClient, type TelegramInputDispatcher } from "../src/services/telegram/gateway";
import { TelegramSessionCoordinator, type TelegramSessionPort } from "../src/services/telegram/session";
import { setTelegramRuntime, clearTelegramRuntime } from "../src/services/telegram/runtime";
import { TelegramStore } from "../src/services/telegram/store";

const app = buildApp();
const store = new TelegramStore(prisma);
let bearer = "";
let origin = "";

type Birth = { id: string; prompt: string; agent: string; env: Record<string, string> };
const live = new Map<string, { id: string; exited: boolean }>();
const births: Birth[] = [];
const steers: { id: string; text: string }[] = [];
const port: TelegramSessionPort = {
  getSession: (id) => live.get(id),
  createSession: (_projectId, _cwd, opts) => {
    births.push({ id: opts.id, prompt: opts.prompt, agent: opts.agent, env: opts.env });
    const session = { id: opts.id, exited: false };
    live.set(opts.id, session);
    return session;
  },
  sendToPane: async (id, text) => { steers.push({ id, text }); return live.has(id); },
  killSession: (id) => live.delete(id),
};

const sent: { chatId: string; text: string; replyMarkup?: unknown }[] = [];
const answered: string[] = [];
const client: TelegramGatewayClient = {
  getUpdates: async () => [],
  sendMessage: async (input) => {
    sent.push(input);
    return { message_id: sent.length, date: 1, chat: { id: Number(input.chatId), type: "private" }, text: input.text };
  },
  answerCallbackQuery: async (input) => { answered.push(input.text ?? ""); return true; },
};

const update = (updateId: number, text: string, userId = 7, chatId = 42) => ({
  update_id: updateId,
  message: {
    message_id: updateId, date: 1,
    from: { id: userId, is_bot: false, first_name: "Operator" },
    chat: { id: chatId, type: "private" }, text,
  },
});

async function clean() {
  clearTelegramRuntime();
  await prisma.$transaction([
    prisma.telegramAudit.deleteMany(), prisma.telegramConfirmation.deleteMany(),
    prisma.telegramOutbox.deleteMany(), prisma.telegramMemory.deleteMany(),
    prisma.telegramUpdate.deleteMany(), prisma.telegramChat.deleteMany(),
    prisma.telegramGatewayState.deleteMany(), prisma.customAgent.deleteMany(),
    prisma.agentToken.deleteMany(), prisma.setting.deleteMany(),
  ]);
  live.clear(); births.length = 0; steers.length = 0; sent.length = 0; answered.length = 0;
}

beforeAll(async () => {
  await clean();
  await prisma.setting.create({ data: { id: 1, data: {
    ...DEFAULT_SETTING,
    agentAccessEnabled: true,
    telegram: { ...DEFAULT_SETTING.telegram, enabled: true, progress: true },
  } } });
  const token = await issueAgentToken({ name: "telegram-e2e", capabilities: [...TELEGRAM_REQUIRED_CAPABILITIES] });
  bearer = token.token;
  setTelegramRuntime({ agentTokenId: token.view.id });
  await app.listen({ port: 0, host: "127.0.0.1" });
  origin = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(async () => { await app.close(); await clean(); });

function coordinator() {
  return new TelegramSessionCoordinator({
    store, port, defaults: telegramAgentDefaults,
    // SPEC-492 · permukaan setelan runtime dari chat. Dipasang dari `config.ts` yang sama dengan
    // produksi supaya `/engine` & kawan-kawan di e2e ini menempuh jalur yang sungguhan.
    engine: { read: telegramEngineContext, write: setTelegramEngine },
    personality: async (id) => {
      if (!id) return null;
      const row = await prisma.customAgent.findUnique({ where: { id } });
      return row ? { name: row.name, description: row.description, instructions: row.instructions } : null;
    },
    ensureCodexTrust: () => {}, home: "/tmp/hanoman-telegram-e2e", apiBase: origin,
    agentToken: bearer, ensureDir: () => {},
  });
}

function dispatcher(session = coordinator()): TelegramInputDispatcher {
  return {
    dispatch: async (input) => {
      const target = await session.dispatch(input);
      const common = {
        authorization: `Bearer ${bearer}`,
        "x-hanoman-telegram-update": String(input.updateId),
      };
      if (input.kind !== "callback") {
        const kinds = input.text === "/stop" ? ["confirmation"] : ["progress", "final"];
        for (const kind of kinds) {
          const payload = kind === "confirmation"
            ? {
                chatId: input.chatId, updateId: input.updateId, kind, text: "Hentikan sesi aktif?",
                confirmation: { description: "Hentikan sesi aktif", method: "DELETE", path: "/api/terminal/sessions/active" },
              }
            : { chatId: input.chatId, updateId: input.updateId, kind, text: kind === "progress" ? "Sedang memeriksa." : `Jawaban: ${input.text}` };
          const response = await app.inject({ method: "POST", url: "/api/telegram/replies", headers: common, payload });
          expect(response.statusCode).toBe(202);
        }
      }
      return target;
    },
  };
}

function gateway(session = coordinator()) {
  return new TelegramGateway({
    client, store, dispatcher: dispatcher(session), allowedUserIds: new Set(["7", "8"]),
    rateLimit: { limit: 20, windowMs: 60_000 }, exactSecrets: [bearer, "123456:BOT_SECRET"], progress: true,
  });
}

describe("Telegram operator live contract E2E (SPEC-476)", () => {
  it("creates once, replies explicitly, survives gateway restart, and suppresses replay", async () => {
    const firstGateway = gateway();
    await firstGateway.processUpdates([update(17, "status proyek")]);
    await firstGateway.flushOutbox();
    expect(births).toHaveLength(1);
    expect(births[0]!.prompt).toContain("status proyek");
    expect(births[0]!.env.HANOMAN_TELEGRAM_AGENT_TOKEN).toBe(bearer);
    expect(JSON.stringify(births[0]!.env)).not.toContain("BOT_SECRET");
    // SPEC-491 · dua yang pertama milik session operator; yang ketiga adalah FAKTA SERVER yang
    // dikarang gateway sendiri (ADR-0096 §5), diantrekan sesudah dispatch berhasil.
    expect(sent.map((item) => item.text)).toEqual([
      "Sedang memeriksa.", "Jawaban: status proyek", expect.stringMatching(/^Diterima\./),
    ]);

    const restartedGateway = gateway();
    await restartedGateway.processUpdates([update(17, "replay"), update(18, "/status")]);
    await restartedGateway.flushOutbox();
    expect(births).toHaveLength(1);
    expect(steers.at(-1)?.text).toContain("/status");
    expect(await prisma.telegramUpdate.count({ where: { updateId: 17 } })).toBe(1);
  });

  it("restores curated memory into the same deterministic session id after the pane disappears", async () => {
    const headers = { authorization: `Bearer ${bearer}`, "x-hanoman-telegram-update": "18" };
    expect((await app.inject({
      method: "POST", url: "/api/telegram/chats/42/memories", headers, payload: { content: "Jawab singkat." },
    })).statusCode).toBe(201);
    const oldId = births[0]!.id;
    live.delete(oldId);
    await gateway().processUpdates([update(19, "lanjut")]);
    expect(births.at(-1)!.id).toBe(oldId);
    expect(births.at(-1)!.prompt).toContain("Jawab singkat.");
  });

  it("round-trips opaque confirmation callbacks and keeps them single-use", async () => {
    const g = gateway();
    await g.processUpdates([update(20, "/stop")]);
    await g.flushOutbox();
    // Bukan `sent.at(-1)`: sejak SPEC-491 baris fakta server gateway ikut antre sesudahnya.
    const markup = sent.filter((item) => item.replyMarkup).at(-1)!.replyMarkup as
      { inline_keyboard: { callback_data: string }[][] };
    const callbackData = markup.inline_keyboard[0]![0]!.callback_data;
    await g.processUpdates([{
      update_id: 21,
      callback_query: {
        id: "cb-21", from: { id: 7, is_bot: false, first_name: "Operator" }, data: callbackData,
        message: { message_id: 20, date: 1, chat: { id: 42, type: "private" } },
      },
    }]);
    expect(answered).toContain("Disetujui");
    expect((await prisma.telegramConfirmation.findFirst({ orderBy: { createdAt: "desc" } }))?.state).toBe("approved");
    await g.processUpdates([{
      update_id: 22,
      callback_query: {
        id: "cb-22", from: { id: 7, is_bot: false, first_name: "Operator" }, data: callbackData,
        message: { message_id: 20, date: 1, chat: { id: 42, type: "private" } },
      },
    }]);
    expect(answered).toContain("Konfirmasi tidak valid");
  });

  it("uses the same contract for a new Codex-backed operator chat", async () => {
    await prisma.setting.update({ where: { id: 1 }, data: { data: {
      ...DEFAULT_SETTING,
      agentAccessEnabled: true,
      agent: "codex",
      codex: { model: "gpt-5.6-sol", effort: "xhigh" },
      telegram: { ...DEFAULT_SETTING.telegram, enabled: true, progress: true },
    } } });
    await gateway().processUpdates([update(23, "status", 8, 84)]);
    expect(births.at(-1)!.agent).toBe("codex");
    expect(births.at(-1)!.prompt).toContain("status");
  });
});
