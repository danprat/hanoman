import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { ingestError, rateLimitOk, __resetBuckets } from "../src/services/error-ingest";

const clean = async () => {
  await prisma.errorEvent.deleteMany();
  await prisma.errorGroup.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "p1", name: "Proj One", desc: "d", kind: "existing" } });
  __resetBuckets();
});
afterAll(clean);

const evt = (over: Record<string, unknown> = {}) => ({
  type: "TypeError", message: "x is undefined",
  stack: "Error\n    at f (/a/b.js:1:1)", environment: "production", ...over,
});

describe("ingestError grouping", () => {
  it("first event creates a new group; identical second dedups into it", async () => {
    const r1 = await ingestError("p1", "Proj One", evt());
    expect(r1.new).toBe(true);
    const r2 = await ingestError("p1", "Proj One", evt({ message: "x is undefined" }));
    expect(r2.new).toBe(false);
    expect(r2.groupId).toBe(r1.groupId);
    const g = await prisma.errorGroup.findUnique({ where: { id: r1.groupId } });
    expect(g!.count).toBe(2);
    const events = await prisma.errorEvent.count({ where: { groupId: r1.groupId } });
    expect(events).toBe(2);
  });

  it("numeric variants of same shape collapse into one group", async () => {
    const a = await ingestError("p1", "Proj One", evt({ message: "user 12 missing" }));
    const b = await ingestError("p1", "Proj One", evt({ message: "user 99 missing" }));
    expect(b.groupId).toBe(a.groupId);
    expect(await prisma.errorGroup.count()).toBe(1);
  });

  it("notifies once for a new production group; not for repeats", async () => {
    const r = await ingestError("p1", "Proj One", evt());
    await ingestError("p1", "Proj One", evt());
    const notifs = await prisma.notification.findMany({ where: { type: "error" } });
    expect(notifs).toHaveLength(1);
    expect(notifs[0]!.key).toBe(`error:${r.groupId}`);
  });

  it("does not notify for non-production environments", async () => {
    await ingestError("p1", "Proj One", evt({ environment: "dev" }));
    expect(await prisma.notification.count({ where: { type: "error" } })).toBe(0);
  });

  it("caps stored events per group (retention)", async () => {
    process.env.HANOMAN_ERROR_EVENTS_PER_GROUP = "3";
    for (let i = 0; i < 6; i++) await ingestError("p1", "Proj One", evt());
    delete process.env.HANOMAN_ERROR_EVENTS_PER_GROUP;
    const g = await prisma.errorGroup.findFirst();
    expect(await prisma.errorEvent.count({ where: { groupId: g!.id } })).toBeLessThanOrEqual(3);
    expect(g!.count).toBe(6); // ringkasan grup tetap akurat
  });

  it("truncates oversized message and stack", async () => {
    const big = "z".repeat(5000);
    const r = await ingestError("p1", "Proj One", evt({ message: big, stack: "at f\n" + "y".repeat(20000) }));
    const ev = await prisma.errorEvent.findFirst({ where: { groupId: r.groupId } });
    expect(ev!.message.length).toBe(2000);
    expect(ev!.stack!.length).toBe(16000);
  });
});

describe("rateLimitOk", () => {
  it("allows within budget and blocks once the bucket drains", () => {
    process.env.HANOMAN_INGEST_RATE_PER_MIN = "3";
    const now = 1_000_000;
    expect(rateLimitOk("p1", now)).toBe(true);
    expect(rateLimitOk("p1", now)).toBe(true);
    expect(rateLimitOk("p1", now)).toBe(true);
    expect(rateLimitOk("p1", now)).toBe(false); // drained
    expect(rateLimitOk("other", now)).toBe(true); // isolated per project
    delete process.env.HANOMAN_INGEST_RATE_PER_MIN;
  });
});
