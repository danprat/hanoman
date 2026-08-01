import { createHash } from "node:crypto";
import type { TelegramInlineKeyboardMarkup, TelegramMessage, TelegramUpdate } from "./client";
import { TelegramApiError } from "./client";
import { inboundDigest, parseTelegramUpdate, sanitizeTelegramOutput, splitTelegramText, type AcceptedTelegramInput } from "./protocol";
import type { TelegramStore } from "./store";
import { telegramRuntimeStatus, updateTelegramRuntimeStatus } from "./runtime";

/**
 * SPEC-491 · ADR-0096 §5 · amplop yang DIKARANG gateway, bukan session operator. `kind`-nya
 * sengaja di luar `TELEGRAM_REPLY_KINDS`: `dedupeKey` outbox adalah `chat:update:kind`, jadi
 * memakai "progress" akan membuat baris gateway MENELAN reply progress milik session operator
 * untuk update yang sama (`enqueueReply` mengembalikan baris yang sudah ada). Nilai terpisah juga
 * membuat jejak audit bisa membedakan fakta server dari jawaban agen.
 */
const GATEWAY_PROGRESS_KIND = "gateway-progress";
const GATEWAY_FAILURE_KIND = "gateway-failure";

export type TelegramGatewayClient = {
  getUpdates(input: { offset: number; limit: number; timeout: number; signal?: AbortSignal }): Promise<TelegramUpdate[]>;
  sendMessage(input: { chatId: string; text: string; replyMarkup?: TelegramInlineKeyboardMarkup }): Promise<TelegramMessage>;
  answerCallbackQuery(input: { callbackQueryId: string; text?: string }): Promise<boolean>;
};

export type TelegramInputDispatcher = {
  dispatch(input: AcceptedTelegramInput): Promise<{ sessionId: string; created: boolean }>;
};

type GatewayDeps = {
  client: TelegramGatewayClient;
  store: TelegramStore;
  dispatcher: TelegramInputDispatcher;
  allowedUserIds: ReadonlySet<string>;
  rateLimit: { limit: number; windowMs: number };
  exactSecrets: readonly string[];
  progress: boolean;
  pollTimeout?: number;
};

const digestRaw = (update: unknown): string => createHash("sha256").update(JSON.stringify(update)).digest("hex");

export class TelegramGateway {
  private abort: AbortController | null = null;
  private loopPromise: Promise<void> | null = null;

  constructor(private readonly deps: GatewayDeps) {}

  async processUpdates(updates: readonly unknown[]): Promise<void> {
    for (const raw of updates) await this.processUpdate(raw);
  }

  private async processUpdate(raw: unknown): Promise<void> {
    const parsed = parseTelegramUpdate(raw, this.deps.allowedUserIds);
    const root = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
    const rawUpdateId = Number.isInteger(root.update_id) ? Number(root.update_id) : null;
    if (rawUpdateId === null || rawUpdateId < 0) return;
    const meta = parsed.ok
      ? {
          updateId: parsed.input.updateId,
          chatId: parsed.input.chatId,
          userId: parsed.input.userId,
          kind: parsed.input.kind,
          digest: inboundDigest(parsed.input),
        }
      : {
          updateId: rawUpdateId,
          chatId: parsed.chatId ?? null,
          userId: parsed.userId ?? null,
          kind: "rejected",
          digest: digestRaw(raw),
        };
    if (!await this.deps.store.recordUpdate(meta)) return;
    if (!parsed.ok) {
      await this.deps.store.rejectUpdate(rawUpdateId, parsed.reason);
      await this.deps.store.audit({
        chatId: parsed.chatId ?? null, userId: parsed.userId ?? null, updateId: rawUpdateId,
        action: "inbound", outcome: `rejected:${parsed.reason}`, correlationId: `tg:${rawUpdateId}`,
      });
      return;
    }
    const input = parsed.input;
    if (await this.deps.store.rateLimitExceeded(
      input.userId,
      new Date(Date.now() - this.deps.rateLimit.windowMs),
      this.deps.rateLimit.limit,
    )) {
      await this.deps.store.rejectUpdate(input.updateId, "rate-limit");
      await this.deps.store.audit({
        chatId: input.chatId, userId: input.userId, updateId: input.updateId,
        action: "inbound", outcome: "rejected:rate-limit", correlationId: `tg:${input.updateId}`,
      });
      return;
    }
    if (!await this.deps.store.claimUpdate(input.updateId)) return;
    try {
      if (input.kind === "callback" && input.callbackToken && input.callbackAction && input.callbackQueryId) {
        const outcome = await this.deps.store.resolveConfirmation({
          callbackToken: input.callbackToken,
          chatId: input.chatId,
          userId: input.userId,
          action: input.callbackAction,
        });
        const answer = outcome === "approved" ? "Disetujui"
          : outcome === "denied" ? "Dibatalkan"
            : outcome === "expired" ? "Konfirmasi kedaluwarsa" : "Konfirmasi tidak valid";
        await this.deps.client.answerCallbackQuery({ callbackQueryId: input.callbackQueryId, text: answer });
        if (outcome !== "approved" && outcome !== "denied") {
          await this.deps.store.markDispatched(input.updateId);
          return;
        }
        input.text = `[confirmation ${outcome}] ${input.callbackToken}`;
      }
      const target = await this.deps.dispatcher.dispatch(input);
      await this.deps.store.markDispatched(input.updateId);
      await this.deps.store.audit({
        chatId: input.chatId, userId: input.userId, updateId: input.updateId,
        action: "dispatch", outcome: target.created ? "session-created" : "session-reused",
        correlationId: `tg:${input.updateId}`,
      });
      // Fakta server, bukan layar PTY (ADR-0096 §5). Punya `catch` sendiri: dispatch SUDAH
      // berhasil, jadi gagalnya mengantre pemberitahuan tak boleh mengubahnya jadi kegagalan.
      if (this.deps.progress) {
        await this.deps.store.enqueueReply({
          chatId: input.chatId, updateId: input.updateId, kind: GATEWAY_PROGRESS_KIND,
          text: target.created
            ? "Diterima. Sesi operator Hanoman untuk chat ini sedang dijalankan — jawabannya menyusul."
            : "Diterima. Diteruskan ke sesi operator.",
        }).catch(() => {});
      }
      updateTelegramRuntimeStatus({ lastUpdateAt: new Date().toISOString(), lastError: null });
    } catch (error) {
      const reason = sanitizeTelegramOutput((error as Error).message, this.deps.exactSecrets).slice(0, 200);
      await this.deps.store.markUpdateUncertain(input.updateId, "dispatch-failed");
      await this.deps.store.audit({
        chatId: input.chatId, userId: input.userId, updateId: input.updateId,
        action: "dispatch", outcome: "uncertain", correlationId: `tg:${input.updateId}`,
      });
      // TIDAK digerbangi `progress`: kegagalan bukan progress. Tanpa baris ini update yang
      // tertangkap lalu gagal berakhir sebagai `uncertain` di DB dan DIAM TOTAL di chat.
      await this.deps.store.enqueueReply({
        chatId: input.chatId, updateId: input.updateId, kind: GATEWAY_FAILURE_KIND,
        text: `Pesan Anda tertangkap tapi gagal diteruskan ke sesi operator: ${reason || "sebab tak diketahui"}. `
          + "Kirim ulang setelah masalahnya beres — hanoman tidak pernah mengulanginya sendiri (at-most-once).",
      }).catch(() => {});
      updateTelegramRuntimeStatus({ lastError: reason });
      // Sengaja TIDAK dilempar ulang: satu update yang gagal tak boleh menghentikan sisa batch
      // (sebelumnya lemparan ini keluar sampai `loop`, jadi update berikutnya tak pernah diproses
      // dan `flushOutbox` pada siklus itu terlewat).
    }
  }

  async flushOutbox(): Promise<void> {
    for (;;) {
      const row = await this.deps.store.claimNextOutbox();
      if (!row) return;
      try {
        const text = sanitizeTelegramOutput(row.text, this.deps.exactSecrets);
        const chunks = splitTelegramText(text);
        if (!chunks.length) {
          await this.deps.store.markOutboxFailed(row.id, "empty-after-sanitize");
          continue;
        }
        const confirmation = row.confirmationId ? await this.deps.store.confirmation(row.confirmationId) : null;
        let messageId = 0;
        for (let index = 0; index < chunks.length; index++) {
          const isLast = index === chunks.length - 1;
          const replyMarkup = isLast && confirmation ? {
            inline_keyboard: [[
              { text: "Lanjutkan", callback_data: `tgcf:${confirmation.callbackToken}:approve` },
              { text: "Batalkan", callback_data: `tgcf:${confirmation.callbackToken}:deny` },
            ]],
          } : undefined;
          const message = await this.deps.client.sendMessage({ chatId: row.chatId, text: chunks[index]!, replyMarkup });
          messageId = message.message_id;
        }
        await this.deps.store.markOutboxSent(row.id, messageId);
      } catch (error) {
        const message = sanitizeTelegramOutput((error as Error).message, this.deps.exactSecrets).slice(0, 500);
        if (error instanceof TelegramApiError && error.code !== undefined) {
          await this.deps.store.markOutboxFailed(row.id, message);
        } else {
          await this.deps.store.markOutboxUncertain(row.id, message || "network-outcome-unknown");
        }
      }
    }
  }

  async start(): Promise<void> {
    if (this.loopPromise) return;
    await this.deps.store.recoverUncertainClaims();
    await this.deps.store.recoverUncertainOutbox();
    this.abort = new AbortController();
    updateTelegramRuntimeStatus({ running: true, readiness: "running", lastError: null });
    this.loopPromise = this.loop(this.abort.signal).finally(() => {
      this.loopPromise = null;
      this.abort = null;
      updateTelegramRuntimeStatus({ running: false });
    });
  }

  private async loop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const updates = await this.deps.client.getUpdates({
          offset: await this.deps.store.offset(), limit: 100, timeout: this.deps.pollTimeout ?? 25, signal,
        });
        // SPEC-491 · poll yang berhasil MEMULIHKAN status. Tanpa ini satu kedip jaringan
        // meninggalkan `readiness: "error"` selamanya — hanya `processUpdate` yang sukses yang
        // membersihkan `lastError`, dan itu tak terjadi pada poll kosong (kasus lazim).
        if (telegramRuntimeStatus().readiness === "error") {
          updateTelegramRuntimeStatus({ running: true, readiness: "running", lastError: null });
        }
        // `finally`: outbox tetap harus terkuras walau pemrosesan batch melempar — di dalamnya
        // ada justru pemberitahuan kegagalan yang harus sampai ke operator.
        try { await this.processUpdates(updates); } finally { await this.flushOutbox(); }
      } catch (error) {
        if (signal.aborted) return;
        const message = sanitizeTelegramOutput((error as Error).message, this.deps.exactSecrets).slice(0, 500);
        updateTelegramRuntimeStatus({ running: false, readiness: "error", lastError: message });
        if (error instanceof TelegramApiError && error.code === 409) return;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  }

  async stop(): Promise<void> {
    this.abort?.abort();
    await this.loopPromise;
  }

}
