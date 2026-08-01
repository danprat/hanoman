import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { TelegramStore } from "../src/services/telegram/store";

const store = new TelegramStore(prisma);

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

describe("TelegramStore update claims (SPEC-476)", () => {
  it("durably inserts an update and advances offset in one idempotent operation", async () => {
    expect(await store.recordUpdate({
      updateId: 17, chatId: "42", userId: "7", kind: "text", digest: "a".repeat(64),
    })).toBe(true);
    expect(await store.recordUpdate({
      updateId: 17, chatId: "42", userId: "7", kind: "text", digest: "b".repeat(64),
    })).toBe(false);
    expect(await prisma.telegramGatewayState.findUnique({ where: { id: 1 } })).toMatchObject({ offset: 18 });
    expect(await prisma.telegramUpdate.count({ where: { updateId: 17 } })).toBe(1);
  });

  it("allows exactly one received-to-dispatching claimant", async () => {
    await store.recordUpdate({ updateId: 17, chatId: "42", userId: "7", kind: "text", digest: "a".repeat(64) });
    expect(await store.claimUpdate(17)).toBe(true);
    expect(await store.claimUpdate(17)).toBe(false);
    await store.markDispatched(17);
    expect(await prisma.telegramUpdate.findUnique({ where: { updateId: 17 } })).toMatchObject({ state: "dispatched" });
  });

  it("fails closed across restart by marking unfinished claims uncertain", async () => {
    await store.recordUpdate({ updateId: 17, chatId: "42", userId: "7", kind: "text", digest: "a".repeat(64) });
    await store.recordUpdate({ updateId: 18, chatId: "42", userId: "7", kind: "text", digest: "b".repeat(64) });
    await store.claimUpdate(18);
    expect(await store.recoverUncertainClaims()).toBe(2);
    expect((await prisma.telegramUpdate.findMany({ orderBy: { updateId: "asc" } })).map((row) => row.state))
      .toEqual(["uncertain", "uncertain"]);
    expect(await store.claimUpdate(17)).toBe(false);
  });

  it("records a rejected update without dispatching it", async () => {
    await store.recordUpdate({ updateId: 17, chatId: "42", userId: "7", kind: "text", digest: "a".repeat(64) });
    expect(await store.rejectUpdate(17, "rate-limit")).toBe(true);
    expect(await prisma.telegramUpdate.findUnique({ where: { updateId: 17 } })).toMatchObject({
      state: "rejected", rejectReason: "rate-limit",
    });
  });
});

describe("TelegramStore outbox claims (SPEC-476)", () => {
  it("deduplicates replies and gives one sender an at-most-once claim", async () => {
    const first = await store.enqueueReply({ chatId: "42", updateId: 17, kind: "final", text: "selesai" });
    const duplicate = await store.enqueueReply({ chatId: "42", updateId: 17, kind: "final", text: "beda" });
    expect(duplicate.id).toBe(first.id);
    expect(duplicate.text).toBe("selesai");
    expect((await store.claimNextOutbox())?.id).toBe(first.id);
    expect(await store.claimNextOutbox()).toBeNull();
  });

  it("marks a sending row uncertain on recovery instead of retrying it", async () => {
    await store.enqueueReply({ chatId: "42", updateId: 17, kind: "progress", text: "mulai" });
    await store.claimNextOutbox();
    expect(await store.recoverUncertainOutbox()).toBe(1);
    expect((await prisma.telegramOutbox.findFirst())?.state).toBe("uncertain");
    expect(await store.claimNextOutbox()).toBeNull();
  });
});

describe("TelegramStore typing liveness (SPEC-493)", () => {
  const dispatched = async (updateId: number, chatId: string) => {
    await store.recordUpdate({ updateId, chatId, userId: "7", kind: "text", digest: String(updateId).repeat(8).slice(0, 64) });
    await store.claimUpdate(updateId);
    await store.markDispatched(updateId);
  };
  const since = () => new Date(Date.now() - 600_000);

  it("lists a chat whose dispatched update has no reply at all", async () => {
    await dispatched(17, "42");
    expect(await store.chatsAwaitingReply(since())).toEqual(["42"]);
  });

  it("keeps listing while only a non-final progress reply is queued", async () => {
    await dispatched(17, "42");
    await store.enqueueReply({ chatId: "42", updateId: 17, kind: "progress", text: "sebentar" });
    expect(await store.chatsAwaitingReply(since())).toEqual(["42"]);
  });

  it("drops the chat as soon as a final reply is enqueued", async () => {
    await dispatched(17, "42");
    await store.enqueueReply({ chatId: "42", updateId: 17, kind: "final", text: "selesai" });
    expect(await store.chatsAwaitingReply(since())).toEqual([]);
  });

  it("treats decision, confirmation, failure and gateway-failure as final", async () => {
    const kinds = ["decision", "confirmation", "failure", "gateway-failure"];
    for (const [index, kind] of kinds.entries()) {
      const updateId = 100 + index;
      await dispatched(updateId, String(200 + index));
      await store.enqueueReply({ chatId: String(200 + index), updateId, kind, text: kind });
    }
    expect(await store.chatsAwaitingReply(since())).toEqual([]);
  });

  it("ignores updates that are not dispatched, and de-duplicates one chat", async () => {
    await store.recordUpdate({ updateId: 21, chatId: "42", userId: "7", kind: "text", digest: "c".repeat(64) });
    expect(await store.chatsAwaitingReply(since())).toEqual([]);
    await store.claimUpdate(21);
    await store.markDispatched(21);
    await dispatched(22, "42");
    expect(await store.chatsAwaitingReply(since())).toEqual(["42"]);
  });

  it("forgets updates older than the caller's window so typing cannot run forever", async () => {
    await dispatched(17, "42");
    expect(await store.chatsAwaitingReply(new Date(Date.now() + 60_000))).toEqual([]);
  });
});
