import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  WEBHOOK_BACKOFF_SEC, WEBHOOK_FAIL_LIMIT, WEBHOOK_HISTORY_KEEP, WEBHOOK_MAX_ATTEMPTS,
} from "@hanoman/shared";
import { prisma } from "../src/db";
import { refreshWebhookCache } from "../src/services/webhooks/endpoints";
import {
  deliverDue, pruneHistory, resetStuckDeliveries, backoffAt, __resetBuckets,
} from "../src/services/webhooks/engine";
import { encryptSecret } from "../src/services/secret-box";

const clean = async () => {
  await prisma.webhookDelivery.deleteMany();
  await prisma.webhookEndpoint.deleteMany();
  await prisma.notification.deleteMany();
};
beforeEach(async () => { await clean(); __resetBuckets(); await refreshWebhookCache(); });
afterAll(async () => { await clean(); await refreshWebhookCache(); });

const mkEndpoint = async (over: Record<string, unknown> = {}) => {
  const e = await prisma.webhookEndpoint.create({
    data: {
      name: "e", url: "https://contoh.id/hook", secret: encryptSecret("s".repeat(32)),
      events: ["*"] as never, ...over,
    } as never,
  });
  await refreshWebhookCache();
  return e;
};
const mkDelivery = (endpointId: string, over: Record<string, unknown> = {}) =>
  prisma.webhookDelivery.create({
    data: {
      endpointId, eventId: "evt_1", eventType: "spec.created",
      payload: { id: "evt_1", type: "spec.created" } as never,
      maxAttempts: WEBHOOK_MAX_ATTEMPTS, ...over,
    } as never,
  });

const ok = () => ({ fetcher: async () => ({ status: 200 }), lookup: async () => [{ address: "93.184.216.34" }] });
const bad = (status = 500) => ({ fetcher: async () => ({ status }), lookup: async () => [{ address: "93.184.216.34" }] });
const boom = () => ({
  fetcher: async () => { throw new Error("ECONNREFUSED"); },
  lookup: async () => [{ address: "93.184.216.34" }],
});

describe("backoffAt", () => {
  it("mengikuti tabel eksplisit", () => {
    const t0 = new Date("2026-08-01T00:00:00.000Z");
    for (let a = 1; a < WEBHOOK_MAX_ATTEMPTS; a++)
      expect(backoffAt(t0, a).getTime() - t0.getTime()).toBe(WEBHOOK_BACKOFF_SEC[a]! * 1000);
  });
});

describe("deliverDue · sukses", () => {
  it("menandai sent, mengisi httpStatus, mengosongkan streak", async () => {
    const e = await mkEndpoint({ failureStreak: 3 });
    await mkDelivery(e.id);
    expect(await deliverDue(new Date(), ok())).toBe(1);
    const d = await prisma.webhookDelivery.findFirst();
    expect(d!.status).toBe("sent");
    expect(d!.httpStatus).toBe(200);
    expect(d!.sentAt).not.toBeNull();
    const fresh = await prisma.webhookEndpoint.findUnique({ where: { id: e.id } });
    expect(fresh!.failureStreak).toBe(0);
    expect(fresh!.lastSuccessAt).not.toBeNull();
  });
});

describe("deliverDue · gagal", () => {
  it("menjadwalkan percobaan berikutnya, bukan langsung menyerah", async () => {
    const e = await mkEndpoint();
    await mkDelivery(e.id);
    await deliverDue(new Date("2026-08-01T00:00:00.000Z"), bad());
    const d = await prisma.webhookDelivery.findFirst();
    expect(d!.status).toBe("pending");
    expect(d!.attempt).toBe(1);
    expect(d!.httpStatus).toBe(500);
    expect(d!.nextAttemptAt!.toISOString()).toBe("2026-08-01T00:00:30.000Z");
  });

  it("menyimpan alasan galat jaringan yang terbaca operator", async () => {
    const e = await mkEndpoint();
    await mkDelivery(e.id);
    await deliverDue(new Date(), boom());
    expect((await prisma.webhookDelivery.findFirst())!.error).toContain("ECONNREFUSED");
  });

  it("percobaan terakhir habis → failed + streak endpoint naik", async () => {
    const e = await mkEndpoint();
    await mkDelivery(e.id, { attempt: WEBHOOK_MAX_ATTEMPTS - 1 });
    await deliverDue(new Date(), bad());
    expect((await prisma.webhookDelivery.findFirst())!.status).toBe("failed");
    expect((await prisma.webhookEndpoint.findUnique({ where: { id: e.id } }))!.failureStreak).toBe(1);
  });

  it("streak mencapai ambang → endpoint dinonaktifkan + satu notifikasi", async () => {
    const e = await mkEndpoint({ failureStreak: WEBHOOK_FAIL_LIMIT - 1 });
    await mkDelivery(e.id, { attempt: WEBHOOK_MAX_ATTEMPTS - 1 });
    await deliverDue(new Date(), bad());
    const fresh = await prisma.webhookEndpoint.findUnique({ where: { id: e.id } });
    expect(fresh!.enabled).toBe(false);
    expect(fresh!.disabledAt).not.toBeNull();
    expect(fresh!.disabledReason).toContain("gagal");
    const n = await prisma.notification.findMany({ where: { type: "webhook" } });
    expect(n).toHaveLength(1);
    expect(n[0]!.title).toContain(fresh!.name);
  });

  it("410 Gone menonaktifkan seketika tanpa menunggu enam percobaan", async () => {
    const e = await mkEndpoint();
    await mkDelivery(e.id);
    await deliverDue(new Date(), bad(410));
    expect((await prisma.webhookDelivery.findFirst())!.status).toBe("failed");
    expect((await prisma.webhookEndpoint.findUnique({ where: { id: e.id } }))!.enabled).toBe(false);
  });
});

describe("deliverDue · pagar", () => {
  it("tak mengirim ke alamat internal tanpa izin eksplisit", async () => {
    const e = await mkEndpoint();
    await mkDelivery(e.id);
    await deliverDue(new Date(), {
      fetcher: async () => ({ status: 200 }), lookup: async () => [{ address: "127.0.0.1" }],
    });
    const d = await prisma.webhookDelivery.findFirst();
    expect(d!.status).toBe("pending");
    expect(d!.error).toContain("internal");
  });

  it("melewati baris yang belum jatuh tempo", async () => {
    const e = await mkEndpoint();
    await mkDelivery(e.id, { nextAttemptAt: new Date("2030-01-01T00:00:00.000Z") });
    expect(await deliverDue(new Date("2026-08-01T00:00:00.000Z"), ok())).toBe(0);
  });

  it("menghormati batas laju per endpoint", async () => {
    const e = await mkEndpoint({ maxPerMinute: 2 });
    for (let i = 0; i < 5; i++) await mkDelivery(e.id, { eventId: `evt_${i}` });
    const now = new Date("2026-08-01T00:00:00.000Z");
    expect(await deliverDue(now, ok())).toBe(2);
    expect(await deliverDue(now, ok())).toBe(0);
  });
});

describe("resetStuckDeliveries", () => {
  it("mengembalikan baris `sending` yang tertinggal crash ke `pending`", async () => {
    const e = await mkEndpoint();
    await mkDelivery(e.id, { status: "sending" });
    expect(await resetStuckDeliveries()).toBe(1);
    expect((await prisma.webhookDelivery.findFirst())!.status).toBe("pending");
  });
});

describe("pruneHistory", () => {
  it("menyimpan hanya N terakhir per endpoint", async () => {
    const e = await mkEndpoint();
    for (let i = 0; i < WEBHOOK_HISTORY_KEEP + 7; i++)
      await mkDelivery(e.id, { eventId: `evt_${i}`, status: "sent" });
    expect(await pruneHistory()).toBe(7);
    expect(await prisma.webhookDelivery.count()).toBe(WEBHOOK_HISTORY_KEEP);
  });

  it("tak pernah memangkas baris yang masih mengantre", async () => {
    const e = await mkEndpoint();
    for (let i = 0; i < WEBHOOK_HISTORY_KEEP + 5; i++)
      await mkDelivery(e.id, { eventId: `evt_${i}`, status: "pending" });
    expect(await pruneHistory()).toBe(0);
  });
});
