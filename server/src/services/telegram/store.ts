import { Prisma } from "@prisma/client";
import type { Db } from "../../db";
import type { TelegramAuditRecord, TelegramChatContext, TelegramMemoryRecord } from "@hanoman/shared";
import { TELEGRAM_FINAL_REPLY_KINDS } from "./protocol";

type UpdateMeta = {
  updateId: number;
  chatId?: string | null;
  userId?: string | null;
  kind: string;
  digest: string;
};

type ReplyInput = {
  chatId: string;
  updateId: number;
  kind: string;
  text: string;
  confirmation?: {
    callbackToken: string;
    userId: string;
    description: string;
    method: string;
    path: string;
    expiresAt: Date;
  };
};

type AuditInput = {
  chatId?: string | null;
  userId?: string | null;
  updateId?: number | null;
  action: string;
  outcome: string;
  correlationId?: string | null;
  method?: string | null;
  path?: string | null;
  statusCode?: number | null;
};

const isUnique = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export class TelegramStore {
  // SPEC-481 · klien yang diekspor kini ber-extension (tap webhook) sehingga tak lagi
  // assignable ke `PrismaClient` polos. `Db` diturunkan dari nilai nyatanya.
  constructor(private readonly db: Db) {}

  async recordUpdate(input: UpdateMeta): Promise<boolean> {
    try {
      await this.db.$transaction(async (tx) => {
        await tx.telegramUpdate.create({ data: {
          updateId: input.updateId,
          chatId: input.chatId ?? null,
          userId: input.userId ?? null,
          kind: input.kind,
          digest: input.digest,
        } });
        const current = await tx.telegramGatewayState.findUnique({ where: { id: 1 }, select: { offset: true } });
        const offset = Math.max(current?.offset ?? 0, input.updateId + 1);
        await tx.telegramGatewayState.upsert({
          where: { id: 1 },
          create: { id: 1, offset, lastUpdateAt: new Date() },
          update: { offset, lastUpdateAt: new Date() },
        });
      });
      return true;
    } catch (error) {
      if (isUnique(error)) return false;
      throw error;
    }
  }

  async offset(): Promise<number> {
    return (await this.db.telegramGatewayState.findUnique({ where: { id: 1 } }))?.offset ?? 0;
  }

  async claimUpdate(updateId: number): Promise<boolean> {
    return (await this.db.telegramUpdate.updateMany({
      where: { updateId, state: "received" },
      data: { state: "dispatching", claimedAt: new Date() },
    })).count === 1;
  }

  async markDispatched(updateId: number): Promise<void> {
    await this.db.telegramUpdate.updateMany({
      where: { updateId, state: "dispatching" },
      data: { state: "dispatched", dispatchedAt: new Date() },
    });
  }

  async rejectUpdate(updateId: number, reason: string): Promise<boolean> {
    return (await this.db.telegramUpdate.updateMany({
      where: { updateId, state: "received" }, data: { state: "rejected", rejectReason: reason },
    })).count === 1;
  }

  async recoverUncertainClaims(): Promise<number> {
    return (await this.db.telegramUpdate.updateMany({
      where: { state: { in: ["received", "dispatching"] } }, data: { state: "uncertain" },
    })).count;
  }

  async ensureChat(input: { chatId: string; userId: string; agent: string; model: string; effort: string }) {
    return this.db.telegramChat.upsert({
      where: { chatId: input.chatId },
      create: input,
      update: { userId: input.userId },
    });
  }

  async chatContext(chatId: string): Promise<TelegramChatContext | null> {
    const chat = await this.db.telegramChat.findUnique({ where: { chatId } });
    if (!chat) return null;
    const memories = await this.db.telegramMemory.findMany({ where: { chatId }, orderBy: { createdAt: "asc" } });
    return {
      chatId: chat.chatId,
      userId: chat.userId,
      sessionId: chat.sessionId,
      activeProjectId: chat.activeProjectId,
      activeSessionId: chat.activeSessionId,
      personalityAgentId: chat.personalityAgentId,
      summary: chat.summary,
      agent: chat.agent as "claude" | "codex",
      model: chat.model,
      effort: chat.effort,
      memories: memories.map(this.memoryView),
    };
  }

  patchChat(chatId: string, patch: {
    sessionId?: string | null;
    activeProjectId?: string | null;
    activeSessionId?: string | null;
    personalityAgentId?: string | null;
    summary?: string | null;
  }) {
    return this.db.telegramChat.update({ where: { chatId }, data: patch });
  }

  async bindSession(chatId: string, sessionId: string): Promise<void> {
    await this.db.telegramChat.update({ where: { chatId }, data: { sessionId } });
  }

  async rateLimitExceeded(userId: string, since: Date, limit: number): Promise<boolean> {
    return await this.db.telegramUpdate.count({ where: { userId, receivedAt: { gte: since } } }) > limit;
  }

  async markUpdateUncertain(updateId: number, reason: string): Promise<void> {
    await this.db.telegramUpdate.updateMany({
      where: { updateId, state: "dispatching" }, data: { state: "uncertain", rejectReason: reason },
    });
  }

  /**
   * SPEC-493 · chat yang masih menunggu jawaban: ada `TelegramUpdate` `dispatched` sesudah `since`
   * yang belum punya baris outbox ber-kind final. Dihitung pada saat **enqueue**, bukan `sent` —
   * baris outbox lahir begitu session operator memanggil `POST /telegram/replies`, dan jarak
   * enqueue→kirim paling banyak satu iterasi loop. Menunggu `sent` akan menahan typing melewati
   * pesan finalnya sendiri.
   *
   * `since` adalah pagar keras: update yang session operatornya mati mengendap `dispatched`
   * SELAMANYA, dan tanpa pagar ini gateway akan mengetik selamanya sekaligus mengunci long-poll
   * di 4 detik selamanya.
   */
  async chatsAwaitingReply(since: Date): Promise<string[]> {
    const pending = await this.db.telegramUpdate.findMany({
      where: { state: "dispatched", chatId: { not: null }, dispatchedAt: { gte: since } },
      select: { updateId: true, chatId: true },
      orderBy: { updateId: "asc" },
    });
    if (!pending.length) return [];
    const answered = new Set((await this.db.telegramOutbox.findMany({
      where: {
        updateId: { in: pending.map((row) => row.updateId) },
        kind: { in: [...TELEGRAM_FINAL_REPLY_KINDS] },
      },
      select: { updateId: true },
    })).map((row) => row.updateId));
    const chats: string[] = [];
    for (const row of pending) {
      if (answered.has(row.updateId) || !row.chatId || chats.includes(row.chatId)) continue;
      chats.push(row.chatId);
    }
    return chats;
  }

  async addMemory(chatId: string, content: string): Promise<TelegramMemoryRecord> {
    return this.memoryView(await this.db.telegramMemory.create({ data: { chatId, content } }));
  }

  async forgetMemory(chatId: string, id: string): Promise<boolean> {
    return (await this.db.telegramMemory.deleteMany({ where: { id, chatId } })).count === 1;
  }

  async resetMemory(chatId: string): Promise<boolean> {
    const chat = await this.db.telegramChat.findUnique({ where: { chatId }, select: { chatId: true } });
    if (!chat) return false;
    await this.db.$transaction([
      this.db.telegramMemory.deleteMany({ where: { chatId } }),
      this.db.telegramChat.update({ where: { chatId }, data: { summary: null } }),
    ]);
    return true;
  }

  private memoryView(row: { id: string; chatId: string; content: string; createdAt: Date; updatedAt: Date }): TelegramMemoryRecord {
    return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }

  async enqueueReply(input: ReplyInput) {
    const dedupeKey = `${input.chatId}:${input.updateId}:${input.kind}`;
    try {
      return await this.db.$transaction(async (tx) => {
        const existing = await tx.telegramOutbox.findUnique({ where: { dedupeKey } });
        if (existing) return existing;
        let confirmationId: string | null = null;
        if (input.confirmation) {
          const confirmation = await tx.telegramConfirmation.create({ data: {
            callbackToken: input.confirmation.callbackToken,
            chatId: input.chatId,
            userId: input.confirmation.userId,
            updateId: input.updateId,
            description: input.confirmation.description,
            method: input.confirmation.method,
            path: input.confirmation.path,
            expiresAt: input.confirmation.expiresAt,
          } });
          confirmationId = confirmation.id;
        }
        return tx.telegramOutbox.create({ data: {
          chatId: input.chatId,
          updateId: input.updateId,
          kind: input.kind,
          dedupeKey,
          text: input.text,
          confirmationId,
        } });
      });
    } catch (error) {
      if (!isUnique(error)) throw error;
      return (await this.db.telegramOutbox.findUnique({ where: { dedupeKey } }))!;
    }
  }

  async claimNextOutbox() {
    for (;;) {
      const row = await this.db.telegramOutbox.findFirst({ where: { state: "pending" }, orderBy: { createdAt: "asc" } });
      if (!row) return null;
      const claimed = await this.db.telegramOutbox.updateMany({
        where: { id: row.id, state: "pending" }, data: { state: "sending", claimedAt: new Date() },
      });
      if (claimed.count === 1) return this.db.telegramOutbox.findUnique({ where: { id: row.id } });
    }
  }

  async recoverUncertainOutbox(): Promise<number> {
    return (await this.db.telegramOutbox.updateMany({ where: { state: "sending" }, data: { state: "uncertain" } })).count;
  }

  markOutboxSent(id: string, telegramMessageId: number) {
    return this.db.telegramOutbox.updateMany({
      where: { id, state: "sending" }, data: { state: "sent", telegramMessageId, sentAt: new Date() },
    });
  }

  markOutboxFailed(id: string, error: string) {
    return this.db.telegramOutbox.updateMany({ where: { id, state: "sending" }, data: { state: "failed", error } });
  }

  markOutboxUncertain(id: string, error: string) {
    return this.db.telegramOutbox.updateMany({ where: { id, state: "sending" }, data: { state: "uncertain", error } });
  }

  confirmation(id: string) {
    return this.db.telegramConfirmation.findUnique({ where: { id } });
  }

  async resolveConfirmation(input: {
    callbackToken: string;
    chatId: string;
    userId: string;
    action: "approve" | "deny";
    now?: Date;
  }): Promise<"approved" | "denied" | "expired" | "invalid"> {
    const now = input.now ?? new Date();
    const row = await this.db.telegramConfirmation.findUnique({ where: { callbackToken: input.callbackToken } });
    if (!row || row.chatId !== input.chatId || row.userId !== input.userId || row.state !== "pending") return "invalid";
    if (row.expiresAt <= now) {
      await this.db.telegramConfirmation.updateMany({
        where: { id: row.id, state: "pending" }, data: { state: "expired" },
      });
      return "expired";
    }
    const state = input.action === "approve" ? "approved" : "denied";
    const changed = await this.db.telegramConfirmation.updateMany({
      where: { id: row.id, state: "pending" },
      data: { state, ...(state === "approved" ? { approvedAt: now } : {}) },
    });
    return changed.count === 1 ? state : "invalid";
  }

  async audit(input: AuditInput): Promise<TelegramAuditRecord> {
    const row = await this.db.telegramAudit.create({ data: {
      chatId: input.chatId ?? null,
      userId: input.userId ?? null,
      updateId: input.updateId ?? null,
      action: input.action,
      outcome: input.outcome,
      correlationId: input.correlationId ?? null,
      method: input.method ?? null,
      path: input.path ?? null,
      statusCode: input.statusCode ?? null,
    } });
    return { ...row, createdAt: row.createdAt.toISOString() };
  }

  async listAudit(input: { chatId?: string; updateId?: number; take: number; skip: number }) {
    const where = {
      ...(input.chatId ? { chatId: input.chatId } : {}),
      ...(input.updateId !== undefined ? { updateId: input.updateId } : {}),
    };
    const [rows, total] = await this.db.$transaction([
      this.db.telegramAudit.findMany({ where, orderBy: { createdAt: "desc" }, take: input.take, skip: input.skip }),
      this.db.telegramAudit.count({ where }),
    ]);
    return { items: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })), total };
  }
}
