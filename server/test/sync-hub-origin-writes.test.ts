import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, makeProject, makeSpec } from "./factory";
import { setConfig, clearConfig } from "../src/config";
import { recordSessionResult } from "../src/services/session-result";

// SPEC-330 · write yang LAHIR di instance HUB (tak ada SYNC_SERVER_URL) harus masuk change-feed
// (SyncLog) supaya bisa di-pull client. Sebelum fix, route/service ini memanggil enqueueOutbox
// langsung — mekanisme khusus-CLIENT — sehingga di hub record menumpuk di SyncOutbox yang TAK
// PERNAH di-drain (hub tak punya sync client), tetap version 0 tanpa baris feed, dan tak terlihat
// oleh client sampai reboot hub berikutnya menjalankan backfillFeed (ADR-0067).
// Bukti lapangan di hub prod: 25 baris SyncOutbox yatim, 13 spec version-0 tanpa baris feed.

const app = buildApp({ requireAuth: false });
const brief = { context: "c", outcome: "o", constraints: "", priority: "sedang" as const };

// resetDb() tak menyentuh tabel sync; bersihkan eksplisit agar hitungan feed/outbox bermakna.
async function clean() {
  await prisma.syncLog.deleteMany();
  await prisma.syncOutbox.deleteMany();
  await prisma.sessionResult.deleteMany();
  await prisma.runtimeConfig.deleteMany();   // peran hub = SYNC_SERVER_URL kosong
  await resetDb();
}
beforeEach(async () => { await clean(); await makeProject({ id: "p1" }); });
afterAll(async () => { await clearConfig("SYNC_SERVER_URL"); await clean(); });

const feed = (entity: string, recordId: string) =>
  prisma.syncLog.count({ where: { entity, recordId } });

describe("write asal-HUB masuk change-feed, bukan outbox yatim (SPEC-330)", () => {
  it("POST /specs → baris feed + version > 0, SyncOutbox tetap kosong", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/specs",
      payload: { project: "p1", title: "dari hub", source: "brief", priority: "sedang", payload: brief },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().id as string;
    expect(await feed("spec", id)).toBe(1);
    expect((await prisma.spec.findUnique({ where: { id } }))!.version).toBeGreaterThan(0);
    expect(await prisma.syncOutbox.count()).toBe(0);
  });

  it("POST /specs/batch → tiap spec dapat baris feed", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/specs/batch",
      payload: {
        project: "p1",
        items: [
          { title: "a", context: "c", outcome: "o", priority: "sedang" },
          { title: "b", context: "c", outcome: "o", priority: "sedang" },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const ids = (res.json().created as { id: string }[]).map((s) => s.id);
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(await feed("spec", id)).toBe(1);
    expect(await prisma.syncOutbox.count()).toBe(0);
  });

  it("PATCH /specs/:id → perubahan konten masuk feed", async () => {
    await makeSpec({ id: "SPEC-901", projectId: "p1", stage: "brainstorming", source: "brief", payload: brief });
    const res = await app.inject({ method: "PATCH", url: "/api/specs/SPEC-901", payload: { title: "judul baru" } });
    expect(res.statusCode).toBe(200);
    expect(await feed("spec", "SPEC-901")).toBe(1);
    expect(await prisma.syncOutbox.count()).toBe(0);
  });

  it("POST /projects → project baru masuk feed", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/projects",
      payload: { name: "Hub Project", desc: "", kind: "existing" },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().id as string;
    expect(await feed("project", id)).toBe(1);
    expect(await prisma.syncOutbox.count()).toBe(0);
  });

  it("PATCH /projects/:id → perubahan project masuk feed", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/projects/p1", payload: { name: "ganti" } });
    expect(res.statusCode).toBe(200);
    expect(await feed("project", "p1")).toBe(1);
    expect(await prisma.syncOutbox.count()).toBe(0);
  });

  it("recordSessionResult → masuk feed", async () => {
    await makeSpec({ id: "SPEC-902", projectId: "p1" });
    const { id } = await recordSessionResult({
      projectId: "p1", specId: "SPEC-902", oldStage: "brainstorming", newStage: "spec", status: "done",
    });
    expect(await feed("sessionResult", id)).toBe(1);
    expect(await prisma.syncOutbox.count()).toBe(0);
  });

  it("peran CLIENT tak berubah: write yang sama antre di outbox, feed tetap kosong", async () => {
    await setConfig("SYNC_SERVER_URL", "http://hub.example");
    const res = await app.inject({
      method: "POST", url: "/api/specs",
      payload: { project: "p1", title: "dari client", source: "brief", priority: "sedang", payload: brief },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().id as string;
    expect(await prisma.syncOutbox.count()).toBe(1);
    expect(await feed("spec", id)).toBe(0);
  });
});
