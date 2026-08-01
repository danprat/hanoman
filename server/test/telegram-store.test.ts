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
