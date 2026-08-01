export type TelegramUser = {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
};

export type TelegramChat = { id: number; type: string };
export type TelegramMessage = {
  message_id: number;
  date: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
};
export type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
};
export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

export type TelegramInlineKeyboardMarkup = {
  inline_keyboard: { text: string; callback_data: string }[][];
};

export type TelegramTransport = (url: string, init?: RequestInit) => Promise<Response>;

type TelegramEnvelope<T> = {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
};

export class TelegramApiError extends Error {
  constructor(public readonly method: string, public readonly code: number | undefined, message: string) {
    super(`Telegram ${method} gagal${code ? ` (${code})` : ""}: ${message}`);
    this.name = "TelegramApiError";
  }
}

export class TelegramApiClient {
  constructor(
    private readonly token: string,
    private readonly transport: TelegramTransport = (url, init) => fetch(url, init),
    private readonly baseUrl = "https://api.telegram.org",
  ) {}

  private safe(message: string): string {
    return message.split(this.token).join("[REDACTED]")
      .replace(/https:\/\/api\.telegram\.org\/bot[^/\s]+/g, "https://api.telegram.org/bot[REDACTED]");
  }

  private async call<T>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try {
      response = await this.transport(`${this.baseUrl}/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      throw new TelegramApiError(method, undefined, this.safe((error as Error).message || "network error"));
    }
    if (!response.ok) throw new TelegramApiError(method, response.status, `HTTP ${response.status}`);
    let envelope: TelegramEnvelope<T>;
    try {
      envelope = await response.json() as TelegramEnvelope<T>;
    } catch {
      throw new TelegramApiError(method, response.status, "respons bukan JSON");
    }
    if (!envelope.ok || envelope.result === undefined) {
      throw new TelegramApiError(method, envelope.error_code, this.safe(envelope.description ?? "respons tidak valid"));
    }
    return envelope.result;
  }

  getMe(): Promise<TelegramUser> {
    return this.call("getMe", {});
  }

  async getUpdates(input: { offset: number; limit: number; timeout: number; signal?: AbortSignal }): Promise<TelegramUpdate[]> {
    if (!Number.isInteger(input.offset) || input.offset < 0) throw new Error("offset harus integer non-negatif");
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new Error("limit harus 1..100");
    if (!Number.isInteger(input.timeout) || input.timeout < 0 || input.timeout > 50) throw new Error("timeout harus 0..50");
    return this.call<TelegramUpdate[]>("getUpdates", {
      offset: input.offset,
      limit: input.limit,
      timeout: input.timeout,
      allowed_updates: ["message", "callback_query"],
    }, input.signal);
  }

  sendMessage(input: {
    chatId: string;
    text: string;
    replyMarkup?: TelegramInlineKeyboardMarkup;
  }): Promise<TelegramMessage> {
    return this.call("sendMessage", {
      chat_id: input.chatId,
      text: input.text,
      ...(input.replyMarkup ? { reply_markup: input.replyMarkup } : {}),
    });
  }

  editMessageText(input: { chatId: string; messageId: number; text: string }): Promise<TelegramMessage> {
    return this.call("editMessageText", {
      chat_id: input.chatId,
      message_id: input.messageId,
      text: input.text,
    });
  }

  answerCallbackQuery(input: { callbackQueryId: string; text?: string }): Promise<boolean> {
    return this.call("answerCallbackQuery", {
      callback_query_id: input.callbackQueryId,
      ...(input.text ? { text: input.text } : {}),
    });
  }
}
