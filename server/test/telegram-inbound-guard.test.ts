import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { loadConfig, setConfig } from "../src/config";
import { DEFAULT_SETTING } from "../src/services/settings";
import { issueAgentToken } from "../src/services/agent-token";
import { saveTelegramCredentials, telegramInboundReadiness, testTelegramConnection } from "../src/services/telegram/credentials";
import { TELEGRAM_REQUIRED_CAPABILITIES } from "../src/services/telegram/bootstrap";
import { TelegramGateway, type TelegramGatewayClient, type TelegramInputDispatcher } from "../src/services/telegram/gateway";
import { TelegramStore } from "../src/services/telegram/store";
import { clearTelegramRuntime, telegramRuntimeStatus, updateTelegramRuntimeStatus } from "../src/services/telegram/runtime";
import { TelegramApiError } from "../src/services/telegram/client";

const BOT = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";
const store = new TelegramStore(prisma);

const clean = async () => {
  clearTelegramRuntime();
  await prisma.$transaction([
    prisma.telegramAudit.deleteMany(), prisma.telegramConfirmation.deleteMany(),
    prisma.telegramOutbox.deleteMany(), prisma.telegramMemory.deleteMany(),
    prisma.telegramUpdate.deleteMany(), prisma.telegramChat.deleteMany(),
    prisma.telegramGatewayState.deleteMany(), prisma.agentToken.deleteMany(),
    prisma.runtimeConfig.deleteMany(), prisma.setting.deleteMany(),
  ]);
  for (const k of ["HANOMAN_TELEGRAM_BOT_TOKEN", "HANOMAN_TELEGRAM_AGENT_TOKEN",
    "HANOMAN_TELEGRAM_ALLOWED_USER_IDS", "HANOMAN_TELEGRAM_TARGET_CHAT_ID"]) delete process.env[k];
  await loadConfig();
};
beforeEach(clean);
afterAll(clean);

const seedSetting = (patch: Record<string, unknown> = {}) =>
  prisma.setting.create({ data: { id: 1, data: { ...DEFAULT_SETTING, agentAccessEnabled: true, ...patch } } });

/**
 * SPEC-491 · akar keluhan "diam total": nilai yang tersimpan di instalasi hidup adalah 64 hex
 * tanpa awalan `hnm_agt_` — bentuk digest sha256, bukan plaintext AgentToken. Ia lolos pola
 * `^\S{20,}$`, tersimpan sebagai sah, lalu membuat gateway berhenti di gerbang readiness
 * SEBELUM `productionFactory` — nol `getUpdates`, nol `TelegramUpdate`, nol audit.
 */
describe("SPEC-491 · kredensial: AgentToken diadu ke tabel saat disimpan", () => {
  it("menolak AgentToken yang tak cocok baris mana pun (bentuk digest 64-hex produksi)", async () => {
    await seedSetting();
    const result = await saveTelegramCredentials({
      HANOMAN_TELEGRAM_AGENT_TOKEN: "61783865e91b7347".repeat(4),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.key).toBe("HANOMAN_TELEGRAM_AGENT_TOKEN");
    expect(result.error).toMatch(/hnm_agt_/);
    expect(await prisma.runtimeConfig.count()).toBe(0);
  });

  it("menolak AgentToken sah yang capability-nya kurang, dan menyebut yang kurang", async () => {
    await seedSetting();
    const { token } = await issueAgentToken({ name: "kurang", capabilities: ["telegram:write"] });
    const result = await saveTelegramCredentials({ HANOMAN_TELEGRAM_AGENT_TOKEN: token });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("sessions:write");
    expect(await prisma.runtimeConfig.count()).toBe(0);
  });

  it("satu AgentToken tak sah membatalkan SELURUH patch, termasuk field yang benar", async () => {
    await seedSetting();
    const result = await saveTelegramCredentials({
      HANOMAN_TELEGRAM_BOT_TOKEN: BOT,
      HANOMAN_TELEGRAM_ALLOWED_USER_IDS: "7",
      HANOMAN_TELEGRAM_AGENT_TOKEN: "x".repeat(40),
    });
    expect(result.ok).toBe(false);
    expect(await prisma.runtimeConfig.count()).toBe(0);
  });

  it("menerima AgentToken sah ber-capability lengkap", async () => {
    await seedSetting();
    const { token } = await issueAgentToken({ name: "penuh", capabilities: [...TELEGRAM_REQUIRED_CAPABILITIES] });
    expect(await saveTelegramCredentials({ HANOMAN_TELEGRAM_AGENT_TOKEN: token, HANOMAN_TELEGRAM_BOT_TOKEN: BOT }))
      .toEqual({ ok: true });
    expect(await prisma.runtimeConfig.count()).toBe(2);
  });

  it("patch tanpa AgentToken tak terpengaruh gerbang ini", async () => {
    expect(await saveTelegramCredentials({ HANOMAN_TELEGRAM_ALLOWED_USER_IDS: "7" })).toEqual({ ok: true });
    expect(await prisma.runtimeConfig.count()).toBe(1);
  });
});

/**
 * Permukaan yang membuat kegagalan itu diam: Test Connection hanya `getMe` + `sendMessage`
 * dengan BOT token — hijau sambil inbound mati adalah hasil normal, bukan anomali.
 */
describe("SPEC-491 · Test Connection ikut menguji gerbang inbound", () => {
  const greenTransport = async (url: string) => new Response(JSON.stringify(
    url.includes("/getMe")
      ? { ok: true, result: { id: 1, is_bot: true, first_name: "H", username: "bot_uji" } }
      : { ok: true, result: { message_id: 5, date: 0, chat: { id: 42, type: "private" } } },
  ), { status: 200 });

  it("bot hijau + AgentToken tak dikenal → inbound dilaporkan TIDAK siap", async () => {
    await seedSetting();
    await setConfig("HANOMAN_TELEGRAM_AGENT_TOKEN", "61783865e91b7347".repeat(4));
    const result = await testTelegramConnection({ botToken: BOT, chatId: "42", transport: greenTransport });
    expect(result.ok).toBe(true);
    expect(result.inbound.ok).toBe(false);
    expect(result.inbound.reason).toMatch(/AgentToken/i);
  });

  it("bot hijau + AgentToken lengkap tapi gateway belum polling → inbound belum siap, alasannya polling", async () => {
    await seedSetting();
    const { token } = await issueAgentToken({ name: "penuh", capabilities: [...TELEGRAM_REQUIRED_CAPABILITIES] });
    await setConfig("HANOMAN_TELEGRAM_AGENT_TOKEN", token);
    const result = await testTelegramConnection({ botToken: BOT, chatId: "42", transport: greenTransport });
    expect(result.inbound.ok).toBe(false);
    expect(result.inbound.missingCapabilities).toEqual([]);
    expect(result.inbound.reason).toMatch(/polling|gateway/i);
  });

  it("AgentToken lengkap + gateway polling → inbound siap", async () => {
    await seedSetting();
    const { token } = await issueAgentToken({ name: "penuh", capabilities: [...TELEGRAM_REQUIRED_CAPABILITIES] });
    await setConfig("HANOMAN_TELEGRAM_AGENT_TOKEN", token);
    updateTelegramRuntimeStatus({ running: true, readiness: "running" });
    const result = await testTelegramConnection({ botToken: BOT, chatId: "42", transport: greenTransport });
    expect(result.inbound).toMatchObject({ ok: true, reason: null, polling: true, missingCapabilities: [] });
  });

  it("master switch akses agent mati → inbound tak pernah siap walau token sah", async () => {
    await seedSetting({ agentAccessEnabled: false });
    const { token } = await issueAgentToken({ name: "penuh", capabilities: [...TELEGRAM_REQUIRED_CAPABILITIES] });
    await setConfig("HANOMAN_TELEGRAM_AGENT_TOKEN", token);
    updateTelegramRuntimeStatus({ running: true, readiness: "running" });
    expect((await telegramInboundReadiness()).ok).toBe(false);
    expect((await telegramInboundReadiness()).reason).toMatch(/akses agent/i);
  });
});

/**
 * ADR-0096 §5 memutuskan gateway boleh menerbitkan FAKTA SERVER sendiri. `deps.progress`
 * dirakit dari Setting lalu tak pernah dibaca, jadi satu-satunya suara di chat adalah session
 * operator — bila ia lambat atau gagal, chat diam total.
 */
describe("SPEC-491 · gateway punya suara sendiri", () => {
  const message = (updateId: number, text = "status", userId = 7) => ({
    update_id: updateId,
    message: {
      message_id: updateId, date: 1,
      from: { id: userId, is_bot: false, first_name: "Dena" },
      chat: { id: 42, type: "private" }, text,
    },
  });

  function fakeClient(): TelegramGatewayClient & {
    sent: { chatId: string; text: string }[];
    actions: string[];
  } {
    const sent: { chatId: string; text: string }[] = [];
    const actions: string[] = [];
    return {
      sent, actions,
      getUpdates: async () => [],
      sendMessage: async (input) => {
        sent.push({ chatId: input.chatId, text: input.text });
        return { message_id: sent.length, date: 1, chat: { id: 42, type: "private" }, text: input.text };
      },
      answerCallbackQuery: async () => true,
      sendChatAction: async (chatId) => { actions.push(chatId); return true; },
    };
  }

  const okDispatcher = (created = true): TelegramInputDispatcher =>
    ({ dispatch: async () => ({ sessionId: "telegram-abc", created }) });
  const failDispatcher = (): TelegramInputDispatcher =>
    ({ dispatch: async () => { throw new Error("pane operator gagal lahir"); } });

  const build = (opts: { progress: boolean; dispatcher: TelegramInputDispatcher; client: TelegramGatewayClient }) =>
    new TelegramGateway({
      client: opts.client, store, dispatcher: opts.dispatcher, allowedUserIds: new Set(["7"]),
      rateLimit: { limit: 20, windowMs: 60_000 }, exactSecrets: [], progress: opts.progress,
    });

  // SPEC-493 · ADR-0104 mengganti "fakta server sebagai pesan teks" dengan indikator typing.
  // Kedua test di bawah dulu mengunci teks `gateway-progress` sebagai kontrak; yang dijaga
  // sekarang adalah kebalikannya — chat tak boleh lagi menerima satu pun kalimat karangan gateway.
  it("progress ON → update yang tertangkap menyalakan typing, BUKAN pesan teks", async () => {
    const client = fakeClient();
    const g = build({ progress: true, dispatcher: okDispatcher(), client });
    await g.processUpdates([message(17)]);
    await g.flushOutbox();
    expect(client.actions).toEqual(["42"]);
    expect(client.sent).toHaveLength(0);
    expect(await prisma.telegramOutbox.count()).toBe(0);
  });

  it("chat hanya memuat kalimat session operator, dan typing di-arm ulang sesudahnya", async () => {
    const client = fakeClient();
    const g = build({ progress: true, dispatcher: okDispatcher(), client });
    await g.processUpdates([message(17)]);
    await store.enqueueReply({ chatId: "42", updateId: 17, kind: "progress", text: "Sedang memeriksa." });
    await g.flushOutbox();
    expect(client.sent.map((s) => s.text)).toEqual(["Sedang memeriksa."]);
    // satu saat dispatch + satu sesudah chunk `progress` (non-final)
    expect(client.actions).toEqual(["42", "42"]);
  });

  it("progress OFF → tak ada fakta server, chat hanya milik session operator", async () => {
    const client = fakeClient();
    const g = build({ progress: false, dispatcher: okDispatcher(), client });
    await g.processUpdates([message(17)]);
    await g.flushOutbox();
    expect(client.sent).toHaveLength(0);
  });

  it("dispatch gagal → operator DIBERI TAHU walau progress OFF, dan update tetap uncertain", async () => {
    const client = fakeClient();
    const g = build({ progress: false, dispatcher: failDispatcher(), client });
    await g.processUpdates([message(17)]);
    await g.flushOutbox();
    expect(await prisma.telegramUpdate.findUnique({ where: { updateId: 17 } })).toMatchObject({ state: "uncertain" });
    expect(client.sent).toHaveLength(1);
    expect(client.sent[0]!.text).toMatch(/gagal/i);
  });

  it("satu update gagal tak menghentikan sisa batch", async () => {
    const client = fakeClient();
    let calls = 0;
    const flaky: TelegramInputDispatcher = {
      dispatch: async () => {
        calls++;
        if (calls === 1) throw new Error("pane operator gagal lahir");
        return { sessionId: "telegram-abc", created: false };
      },
    };
    const g = build({ progress: false, dispatcher: flaky, client });
    await g.processUpdates([message(17), message(18)]);
    expect(calls).toBe(2);
    expect(await prisma.telegramUpdate.findUnique({ where: { updateId: 18 } })).toMatchObject({ state: "dispatched" });
  });
});

describe("SPEC-491 · readiness pulih dari error", () => {
  it("satu kedip jaringan tak membuat status `error` menetap selamanya", async () => {
    clearTelegramRuntime();
    let calls = 0;
    const client: TelegramGatewayClient = {
      getUpdates: async () => {
        calls++;
        if (calls === 1) throw new TelegramApiError("getUpdates", 500, "kedip");
        await new Promise((r) => setTimeout(r, 5));
        return [];
      },
      sendMessage: async () => ({ message_id: 1, date: 1, chat: { id: 42, type: "private" } }),
      answerCallbackQuery: async () => true,
      sendChatAction: async () => true,
    };
    const g = new TelegramGateway({
      client, store, dispatcher: { dispatch: async () => ({ sessionId: "s", created: false }) },
      allowedUserIds: new Set(["7"]), rateLimit: { limit: 20, windowMs: 60_000 },
      exactSecrets: [], progress: false,
    });
    await g.start();
    // Tunggu kedipnya BENAR-BENAR tercatat dulu; tanpa ini `readiness` masih "running" bawaan
    // `start()` dan test lulus tanpa pernah menguji pemulihan.
    for (let i = 0; i < 200 && telegramRuntimeStatus().readiness !== "error"; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(telegramRuntimeStatus().readiness).toBe("error");
    for (let i = 0; i < 200 && telegramRuntimeStatus().readiness !== "running"; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(telegramRuntimeStatus()).toMatchObject({ readiness: "running", lastError: null });
    await g.stop();
  }, 10_000);
});
