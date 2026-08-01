import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app";
import { DEFAULT_SETTING } from "../src/services/settings";
import {
  installTelegramGateway,
  parseTelegramAllowedUserIds,
  TELEGRAM_REQUIRED_CAPABILITIES,
  type TelegramGatewayFactory,
} from "../src/services/telegram/bootstrap";
import { clearTelegramRuntime, telegramRuntimeStatus } from "../src/services/telegram/runtime";

const env = {
  HANOMAN_TELEGRAM_BOT_TOKEN: "123456:BOT_TOKEN_abcdefghijklmnopqrstuvwxyz",
  HANOMAN_TELEGRAM_ALLOWED_USER_IDS: "7, 9",
  HANOMAN_TELEGRAM_AGENT_TOKEN: "hnm_agt_agent-token",
};

beforeEach(clearTelegramRuntime);
afterAll(clearTelegramRuntime);

describe("Telegram gateway bootstrap lifecycle (SPEC-476)", () => {
  it("parses a numeric private-user allowlist strictly", () => {
    expect(parseTelegramAllowedUserIds("7, 9\n10")).toEqual(new Set(["7", "9", "10"]));
    expect(() => parseTelegramAllowedUserIds("7,@admin")).toThrow(/numeric/i);
    expect(() => parseTelegramAllowedUserIds(" ")).toThrow(/allowlist/i);
  });

  it("stays disabled and never creates a client when the setting is off", async () => {
    const app = buildApp({ requireAuth: false });
    const factory = vi.fn<TelegramGatewayFactory>();
    await installTelegramGateway(app, {
      apiBase: "http://127.0.0.1:7777", env,
      getSetting: async () => ({ ...DEFAULT_SETTING, telegram: { enabled: false, progress: true } }),
      verifyAgentToken: async () => null,
      factory,
    });
    expect(factory).not.toHaveBeenCalled();
    expect(telegramRuntimeStatus()).toMatchObject({ enabled: false, running: false, readiness: "disabled", configured: true });
    await app.close();
  });

  it("reports missing env as misconfigured without echoing secret values", async () => {
    const app = buildApp({ requireAuth: false });
    await installTelegramGateway(app, {
      apiBase: "http://127.0.0.1:7777", env: { ...env, HANOMAN_TELEGRAM_BOT_TOKEN: undefined },
      getSetting: async () => ({ ...DEFAULT_SETTING, telegram: { enabled: true, progress: true } }),
      verifyAgentToken: async () => null,
      factory: vi.fn<TelegramGatewayFactory>(),
    });
    const status = telegramRuntimeStatus();
    expect(status).toMatchObject({ configured: false, running: false, readiness: "misconfigured" });
    expect(JSON.stringify(status)).not.toContain("hnm_agt_agent-token");
    await app.close();
  });

  it("starts after readiness checks and stops the in-process gateway on app close", async () => {
    const app = buildApp({ requireAuth: false });
    const start = vi.fn(async () => { clearTelegramRuntime(); });
    const stop = vi.fn(async () => {});
    const factory: TelegramGatewayFactory = vi.fn(async () => ({
      gateway: { start, stop },
      botUsername: "hanoman_bot",
    }));
    await installTelegramGateway(app, {
      apiBase: "http://127.0.0.1:7777", env,
      getSetting: async () => ({
        ...DEFAULT_SETTING, agentAccessEnabled: true, telegram: { enabled: true, progress: true },
      }),
      verifyAgentToken: async () => ({ id: "agent-1", capabilities: [...TELEGRAM_REQUIRED_CAPABILITIES] }),
      factory,
    });
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({
      apiBase: "http://127.0.0.1:7777", allowedUserIds: new Set(["7", "9"]), progress: true,
    }));
    expect(start).toHaveBeenCalledOnce();
    expect(telegramRuntimeStatus()).toMatchObject({
      configured: true, enabled: true, readiness: "running", botUsername: "hanoman_bot", missingCapabilities: [],
    });
    await app.close();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("refuses a valid token whose capability set cannot operate Hanoman", async () => {
    const app = buildApp({ requireAuth: false });
    const factory = vi.fn<TelegramGatewayFactory>();
    await installTelegramGateway(app, {
      apiBase: "http://127.0.0.1:7777", env,
      getSetting: async () => ({
        ...DEFAULT_SETTING, agentAccessEnabled: true, telegram: { enabled: true, progress: true },
      }),
      verifyAgentToken: async () => ({ id: "agent-1", capabilities: ["telegram:write"] }),
      factory,
    });
    expect(factory).not.toHaveBeenCalled();
    expect(telegramRuntimeStatus()).toMatchObject({ readiness: "misconfigured" });
    expect(telegramRuntimeStatus().missingCapabilities).toContain("sessions:write");
    await app.close();
  });
});
