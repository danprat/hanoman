import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb } from "./factory";

const app = buildApp({ requireAuth: false });

beforeEach(async () => {
  await resetDb();
  await prisma.notification.create({ data: { specId: "SPEC-1", title: "satu", projectId: "p1" } });
  await prisma.notification.create({ data: { specId: "SPEC-2", title: "dua", projectId: "p1" } });
});

describe("notifications routes", () => {
  it("GET mengembalikan items terbaru dulu + hitungan unread", async () => {
    const res = await app.inject({ url: "/api/notifications" });
    const body = res.json();
    expect(body.items).toHaveLength(2);
    expect(body.unread).toBe(2);
    // terbaru dulu: SPEC-2 dibuat setelah SPEC-1
    expect(body.items[0].specId).toBe("SPEC-2");
  });

  it("POST /read menandai semua terbaca → unread 0", async () => {
    expect((await app.inject({ method: "POST", url: "/api/notifications/read" })).statusCode).toBe(204);
    const res = await app.inject({ url: "/api/notifications" });
    expect(res.json().unread).toBe(0);
  });

  it("DELETE mengosongkan daftar", async () => {
    expect((await app.inject({ method: "DELETE", url: "/api/notifications" })).statusCode).toBe(204);
    const res = await app.inject({ url: "/api/notifications" });
    expect(res.json().items).toHaveLength(0);
  });
});
