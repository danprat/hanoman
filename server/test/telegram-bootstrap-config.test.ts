import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { clearConfig, loadConfig, setConfig } from "../src/config";
import { DEFAULT_SETTING } from "../src/services/settings";
import {
  installTelegramGateway, reloadTelegramGateway, TELEGRAM_REQUIRED_CAPABILITIES,
} from "../src/services/telegram/bootstrap";
import { clearTelegramRuntime, telegramRuntimeStatus } from "../src/services/telegram/runtime";

const app = buildApp({ requireAuth: false });
const TOKEN_DB = "111111:DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";
const TOKEN_ENV = "222222:EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
const AGENT = "hnm_agt_dummy_token_value_123456";
const ENV_KEYS = [
  "HANOMAN_TELEGRAM_BOT_TOKEN", "HANOMAN_TELEGRAM_AGENT_TOKEN",
  "HANOMAN_TELEGRAM_ALLOWED_USER_IDS", "HANOMAN_TELEGRAM_TARGET_CHAT_ID",
];

const clean = async () => {
  clearTelegramRuntime();
  await prisma.runtimeConfig.deleteMany();
  await prisma.setting.deleteMany();
  await loadConfig();
};

beforeEach(async () => {
  await clean();
  await prisma.setting.create({
    data: { id: 1, data: { ...DEFAULT_SETTING, agentAccessEnabled: true, telegram: { enabled: true, progress: true } } },
  });
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => { for (const k of ENV_KEYS) delete process.env[k]; });
afterAll(async () => { await clean(); await app.close(); });

// Factory palsu: merekam token yang dipakai, gateway-nya no-op.
function recorder() {
  const seen: { botToken: string; agentToken: string; allowlist: string[] }[] = [];
  const stops: string[] = [];
  const factory = async (input: { botToken: string; agentToken: string; allowedUserIds: ReadonlySet<string> }) => {
    seen.push({ botToken: input.botToken, agentToken: input.agentToken, allowlist: [...input.allowedUserIds] });
    return { gateway: { start: async () => {}, stop: async () => { stops.push(input.botToken); } }, botUsername: "bot_uji" };
  };
  return { seen, stops, factory };
}

const verify = async () => ({ id: "agt1", capabilities: [...TELEGRAM_REQUIRED_CAPABILITIES] });

describe("SPEC-477 · bootstrap Telegram membaca store config", () => {
  it("nilai DB MENANG atas .env", async () => {
    process.env.HANOMAN_TELEGRAM_BOT_TOKEN = TOKEN_ENV;
    await setConfig("HANOMAN_TELEGRAM_BOT_TOKEN", TOKEN_DB);
    await setConfig("HANOMAN_TELEGRAM_AGENT_TOKEN", AGENT);
    await setConfig("HANOMAN_TELEGRAM_ALLOWED_USER_IDS", "7 8");
    const { seen, factory } = recorder();
    await installTelegramGateway(app, { apiBase: "http://127.0.0.1:1", factory, verifyAgentToken: verify });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.botToken).toBe(TOKEN_DB);
    expect(seen[0]!.allowlist).toEqual(["7", "8"]);
    expect(telegramRuntimeStatus().running).toBe(true);
  });

  // Backward compatible: instance yang hari ini hidup dari .env tak boleh mati karena spec ini.
  it("DB kosong → .env dipakai apa adanya", async () => {
    process.env.HANOMAN_TELEGRAM_BOT_TOKEN = TOKEN_ENV;
    process.env.HANOMAN_TELEGRAM_AGENT_TOKEN = AGENT;
    process.env.HANOMAN_TELEGRAM_ALLOWED_USER_IDS = "9";
    const { seen, factory } = recorder();
    await installTelegramGateway(app, { apiBase: "http://127.0.0.1:1", factory, verifyAgentToken: verify });
    expect(seen[0]!.botToken).toBe(TOKEN_ENV);
  });

  it("reload MENGHENTIKAN gateway lama sebelum memulai yang baru", async () => {
    await setConfig("HANOMAN_TELEGRAM_BOT_TOKEN", TOKEN_DB);
    await setConfig("HANOMAN_TELEGRAM_AGENT_TOKEN", AGENT);
    await setConfig("HANOMAN_TELEGRAM_ALLOWED_USER_IDS", "7");
    const { seen, stops, factory } = recorder();
    await installTelegramGateway(app, { apiBase: "http://127.0.0.1:1", factory, verifyAgentToken: verify });
    await setConfig("HANOMAN_TELEGRAM_BOT_TOKEN", TOKEN_ENV);
    await reloadTelegramGateway();
    expect(stops).toEqual([TOKEN_DB]);
    expect(seen.map((s) => s.botToken)).toEqual([TOKEN_DB, TOKEN_ENV]);
  });

  it("kredensial dihapus → reload berhenti dengan readiness misconfigured", async () => {
    await setConfig("HANOMAN_TELEGRAM_BOT_TOKEN", TOKEN_DB);
    await setConfig("HANOMAN_TELEGRAM_AGENT_TOKEN", AGENT);
    await setConfig("HANOMAN_TELEGRAM_ALLOWED_USER_IDS", "7");
    const { stops, factory } = recorder();
    await installTelegramGateway(app, { apiBase: "http://127.0.0.1:1", factory, verifyAgentToken: verify });
    for (const k of ENV_KEYS) await clearConfig(k);
    await reloadTelegramGateway();
    expect(stops).toEqual([TOKEN_DB]);
    expect(telegramRuntimeStatus().readiness).toBe("misconfigured");
    expect(telegramRuntimeStatus().running).toBe(false);
  });
});
