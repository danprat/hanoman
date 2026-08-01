import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { loadConfig, setConfig } from "../src/config";
import { DEFAULT_SETTING } from "../src/services/settings";
import { issueAgentToken } from "../src/services/agent-token";
import { clearTelegramRuntime } from "../src/services/telegram/runtime";
import { testTelegramConnection } from "../src/services/telegram/credentials";

const app = buildApp();
const TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";
const ENV_KEYS = [
  "HANOMAN_TELEGRAM_BOT_TOKEN", "HANOMAN_TELEGRAM_AGENT_TOKEN",
  "HANOMAN_TELEGRAM_ALLOWED_USER_IDS", "HANOMAN_TELEGRAM_TARGET_CHAT_ID",
];

const cookieOf = (r: { headers: Record<string, unknown> }) => (r.headers["set-cookie"] as string).split(";")[0];
async function login() {
  return cookieOf(await app.inject({
    method: "POST", url: "/api/auth/setup", payload: { email: "a@b.co", password: "password1" },
  }));
}

const clean = async () => {
  clearTelegramRuntime();
  await prisma.runtimeConfig.deleteMany();
  await prisma.agentToken.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.setting.deleteMany();
  for (const k of ENV_KEYS) delete process.env[k];
  await loadConfig();
};
beforeEach(clean);
afterAll(async () => { await clean(); await app.close(); });

describe("SPEC-477 · GET/PUT/DELETE kredensial Telegram", () => {
  it("GET memasked bot token dan TAK PERNAH memuat plaintext-nya", async () => {
    const cookie = await login();
    await setConfig("HANOMAN_TELEGRAM_BOT_TOKEN", TOKEN);
    const r = await app.inject({ method: "GET", url: "/api/telegram/settings", headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain(TOKEN);
    const field = r.json().fields.find((f: { key: string }) => f.key === "HANOMAN_TELEGRAM_BOT_TOKEN");
    expect(field.masked).toBe("••••Dsaw");
    expect(field.hasValue).toBe(true);
    expect(field.value).toBeUndefined();
    expect(field.source).toBe("db");
  });

  it("GET menandai nilai yang masih datang dari .env sebagai deprecated", async () => {
    const cookie = await login();
    process.env.HANOMAN_TELEGRAM_BOT_TOKEN = TOKEN;
    const r = await app.inject({ method: "GET", url: "/api/telegram/settings", headers: { cookie } });
    const field = r.json().fields.find((f: { key: string }) => f.key === "HANOMAN_TELEGRAM_BOT_TOKEN");
    expect(field.source).toBe("env");
    expect(field.hasValue).toBe(true);
  });

  it("PUT menyimpan, dan secret kosong = pertahankan nilai lama", async () => {
    const cookie = await login();
    await app.inject({ method: "PUT", url: "/api/telegram/settings", headers: { cookie },
      payload: { HANOMAN_TELEGRAM_BOT_TOKEN: TOKEN, HANOMAN_TELEGRAM_ALLOWED_USER_IDS: "7" } });
    await app.inject({ method: "PUT", url: "/api/telegram/settings", headers: { cookie },
      payload: { HANOMAN_TELEGRAM_BOT_TOKEN: "", HANOMAN_TELEGRAM_TARGET_CHAT_ID: "-1001234567890" } });
    const r = await app.inject({ method: "GET", url: "/api/telegram/settings", headers: { cookie } });
    const fields = r.json().fields as { key: string; hasValue?: boolean; value?: string }[];
    expect(fields.find((f) => f.key === "HANOMAN_TELEGRAM_BOT_TOKEN")!.hasValue).toBe(true);
    expect(fields.find((f) => f.key === "HANOMAN_TELEGRAM_TARGET_CHAT_ID")!.value).toBe("-1001234567890");
  });

  it("PUT format salah → 400 dan DB tak tersentuh", async () => {
    const cookie = await login();
    const r = await app.inject({ method: "PUT", url: "/api/telegram/settings", headers: { cookie },
      payload: { HANOMAN_TELEGRAM_BOT_TOKEN: "bukan-token" } });
    expect(r.statusCode).toBe(400);
    expect(await prisma.runtimeConfig.findUnique({ where: { key: "HANOMAN_TELEGRAM_BOT_TOKEN" } })).toBeNull();
  });

  it("PUT key di luar daftar Telegram ditolak", async () => {
    const cookie = await login();
    const r = await app.inject({ method: "PUT", url: "/api/telegram/settings", headers: { cookie },
      payload: { GITHUB_TOKEN: "ghp_x" } });
    expect(r.statusCode).toBe(400);
  });

  // Satu field salah tak boleh meninggalkan separuh kredensial tersimpan.
  it("PUT atomik: satu field salah membatalkan seluruh patch", async () => {
    const cookie = await login();
    const r = await app.inject({ method: "PUT", url: "/api/telegram/settings", headers: { cookie },
      payload: { HANOMAN_TELEGRAM_ALLOWED_USER_IDS: "7", HANOMAN_TELEGRAM_TARGET_CHAT_ID: "@kanal" } });
    expect(r.statusCode).toBe(400);
    expect(await prisma.runtimeConfig.count()).toBe(0);
  });

  it("DELETE mengosongkan DB dan melaporkan envFallback yang tersisa", async () => {
    const cookie = await login();
    await setConfig("HANOMAN_TELEGRAM_BOT_TOKEN", TOKEN);
    process.env.HANOMAN_TELEGRAM_TARGET_CHAT_ID = "42";
    const r = await app.inject({ method: "DELETE", url: "/api/telegram/credentials", headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json().cleared).toContain("HANOMAN_TELEGRAM_BOT_TOKEN");
    expect(r.json().envFallback).toEqual(["HANOMAN_TELEGRAM_TARGET_CHAT_ID"]);
    expect(await prisma.runtimeConfig.count()).toBe(0);
  });

  it("agent token ber-telegram:write ditolak di keempat endpoint", async () => {
    await prisma.setting.create({ data: { id: 1, data: { ...DEFAULT_SETTING, agentAccessEnabled: true } } });
    const { token } = await issueAgentToken({
      name: "tg", capabilities: ["telegram:read", "telegram:write", "settings:write"],
    });
    const headers = { authorization: `Bearer ${token}` };
    const calls = [
      ["GET", "/api/telegram/settings"],
      ["PUT", "/api/telegram/settings"],
      ["POST", "/api/telegram/test"],
      ["DELETE", "/api/telegram/credentials"],
    ] as const;
    for (const [method, url] of calls) {
      expect((await app.inject({ method, url, headers, payload: {} })).statusCode).toBe(403);
    }
  });
});

describe("SPEC-477 · Test Connection", () => {
  const base = { botToken: TOKEN, chatId: "42" };

  it("sukses mengembalikan username bot & chat tujuan", async () => {
    const transport = async (url: string) => new Response(JSON.stringify(
      url.includes("/getMe")
        ? { ok: true, result: { id: 1, is_bot: true, first_name: "H", username: "bot_uji" } }
        : { ok: true, result: { message_id: 5, date: 0, chat: { id: 42, type: "private" } } },
    ), { status: 200 });
    // SPEC-491 · hasilnya SELALU membawa kesiapan jalur masuk: hijau bot token saja pernah
    // berdampingan dengan inbound mati total, dan itulah keluhan yang dilaporkan.
    await expect(testTelegramConnection({ ...base, transport })).resolves.toEqual({
      ok: true, botUsername: "bot_uji", chatId: "42",
      inbound: { ok: false, reason: expect.any(String), missingCapabilities: expect.any(Array), polling: false },
    });
  });

  it("401 → ok:false TANPA token di pesan galat", async () => {
    const transport = async () => new Response(
      JSON.stringify({ ok: false, error_code: 401, description: `bad token ${TOKEN}` }), { status: 200 });
    const result = await testTelegramConnection({ ...base, transport });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  // "Test Connection harus punya timeout dan tidak boleh menggantung UI."
  it("transport yang tak pernah selesai dibatalkan, bukan menggantung", async () => {
    const transport = (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, rejectFn) => {
      init?.signal?.addEventListener("abort", () => rejectFn(new Error("aborted")));
    });
    const result = await testTelegramConnection({ ...base, transport, timeoutMs: 20 });
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty("error");
  }, 2_000);

  it("tanpa target chat & allowlist bercabang → galat sebelum menyentuh jaringan", async () => {
    let called = false;
    const transport = async () => { called = true; return new Response("{}", { status: 200 }); };
    await setConfig("HANOMAN_TELEGRAM_ALLOWED_USER_IDS", "7 8");
    const result = await testTelegramConnection({ botToken: TOKEN, transport });
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("target kosong tapi allowlist tunggal → dipakai sebagai tujuan", async () => {
    await setConfig("HANOMAN_TELEGRAM_ALLOWED_USER_IDS", "77");
    const transport = async (url: string) => new Response(JSON.stringify(
      url.includes("/getMe")
        ? { ok: true, result: { id: 1, is_bot: true, first_name: "H", username: "bot_uji" } }
        : { ok: true, result: { message_id: 5, date: 0, chat: { id: 77, type: "private" } } },
    ), { status: 200 });
    await expect(testTelegramConnection({ botToken: TOKEN, transport })).resolves.toMatchObject({
      ok: true, botUsername: "bot_uji", chatId: "77",
    });
  });
});
