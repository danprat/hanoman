import { describe, expect, it } from "vitest";
import { TelegramApiClient, TelegramApiError, type TelegramTransport } from "../src/services/telegram/client";

type Call = { url: string; init: RequestInit; body: Record<string, unknown> };

function fakeClient(results: unknown[]) {
  const calls: Call[] = [];
  const queue = [...results];
  const transport: TelegramTransport = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {}, body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify(queue.shift()), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { client: new TelegramApiClient("123456:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz", transport), calls };
}

describe("TelegramApiClient fake contract (SPEC-476)", () => {
  it("reads bot identity during readiness without exposing the token", async () => {
    const me = { id: 1, is_bot: true, first_name: "Hanoman", username: "hanoman_bot" };
    const { client, calls } = fakeClient([{ ok: true, result: me }]);
    expect(await client.getMe()).toEqual(me);
    expect(calls[0]!.url).toMatch(/\/getMe$/);
    expect(calls[0]!.body).toEqual({});
  });

  it("long-polls only message/callback updates with durable offset parameters", async () => {
    const update = { update_id: 44, message: { message_id: 2, date: 1, chat: { id: 42, type: "private" }, text: "/status" } };
    const { client, calls } = fakeClient([{ ok: true, result: [update] }]);
    expect(await client.getUpdates({ offset: 44, limit: 50, timeout: 25 })).toEqual([update]);
    expect(calls[0]!.url).toContain("/bot123456:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz/getUpdates");
    expect(calls[0]!.body).toEqual({
      offset: 44, limit: 50, timeout: 25, allowed_updates: ["message", "callback_query"],
    });
  });

  it("sends and edits plain text without parse_mode", async () => {
    const message = { message_id: 9, date: 1, chat: { id: 42, type: "private" }, text: "ok" };
    const { client, calls } = fakeClient([{ ok: true, result: message }, { ok: true, result: message }]);
    await client.sendMessage({ chatId: "42", text: "*literal*" });
    await client.editMessageText({ chatId: "42", messageId: 9, text: "done" });
    expect(calls[0]!.body).toEqual({ chat_id: "42", text: "*literal*" });
    expect(calls[1]!.body).toEqual({ chat_id: "42", message_id: 9, text: "done" });
    expect(calls.some((call) => "parse_mode" in call.body)).toBe(false);
  });

  it("arms the Telegram typing indicator through sendChatAction (SPEC-493)", async () => {
    const { client, calls } = fakeClient([{ ok: true, result: true }]);
    expect(await client.sendChatAction("42", "typing")).toBe(true);
    expect(calls[0]!.url).toMatch(/\/sendChatAction$/);
    expect(calls[0]!.body).toEqual({ chat_id: "42", action: "typing" });
  });

  it("defaults the chat action to typing (SPEC-493)", async () => {
    const { client, calls } = fakeClient([{ ok: true, result: true }]);
    await client.sendChatAction("42");
    expect(calls[0]!.body).toEqual({ chat_id: "42", action: "typing" });
  });

  it("keeps retry_after readable when Telegram answers HTTP 429 (SPEC-493)", async () => {
    const transport: TelegramTransport = async () => new Response(JSON.stringify({
      ok: false, error_code: 429,
      description: "Too Many Requests: retry after 7",
      parameters: { retry_after: 7 },
    }), { status: 429, headers: { "content-type": "application/json" } });
    const client = new TelegramApiClient("123456:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz", transport);
    await expect(client.sendChatAction("42", "typing")).rejects.toMatchObject({
      name: "TelegramApiError", code: 429, retryAfter: 7,
    });
  });

  it("survives a non-JSON error body without losing the status code (SPEC-493)", async () => {
    const transport: TelegramTransport = async () => new Response("<html>502</html>", { status: 502 });
    const client = new TelegramApiClient("123456:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz", transport);
    await expect(client.sendChatAction("42", "typing")).rejects.toMatchObject({
      name: "TelegramApiError", code: 502, retryAfter: undefined,
    });
  });

  it("supports inline confirmation markup and callback acknowledgement", async () => {
    const message = { message_id: 9, date: 1, chat: { id: 42, type: "private" }, text: "confirm" };
    const { client, calls } = fakeClient([{ ok: true, result: message }, { ok: true, result: true }]);
    await client.sendMessage({
      chatId: "42", text: "Hentikan?", replyMarkup: {
        inline_keyboard: [[
          { text: "Lanjutkan", callback_data: "tgcf:abc:approve" },
          { text: "Batalkan", callback_data: "tgcf:abc:deny" },
        ]],
      },
    });
    await client.answerCallbackQuery({ callbackQueryId: "cb-1", text: "Diterima" });
    expect(calls[0]!.body.reply_markup).toEqual(expect.objectContaining({ inline_keyboard: expect.any(Array) }));
    expect(calls[1]!.body).toEqual({ callback_query_id: "cb-1", text: "Diterima" });
  });

  it("bounds getUpdates arguments before making a request", async () => {
    const { client, calls } = fakeClient([{ ok: true, result: [] }]);
    await expect(client.getUpdates({ offset: 0, limit: 101, timeout: 25 })).rejects.toThrow(/limit/);
    expect(calls).toHaveLength(0);
  });

  it("throws typed API errors without leaking the bot token", async () => {
    const token = "123456:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz";
    const transport: TelegramTransport = async () => new Response(JSON.stringify({
      ok: false, error_code: 409, description: `Conflict for ${token}`,
    }), { status: 200 });
    const client = new TelegramApiClient(token, transport);
    let caught: unknown;
    try { await client.getUpdates({ offset: 0, limit: 1, timeout: 1 }); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(TelegramApiError);
    expect(caught).toMatchObject({ code: 409, method: "getUpdates" });
    expect(String(caught)).not.toContain(token);
  });
});
