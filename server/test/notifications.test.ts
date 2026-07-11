import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { resetDb } from "./factory";
import { zNotification } from "@hanoman/shared";
import { recordCompletion } from "../src/services/notifications";

describe("Notification model", () => {
  beforeEach(async () => { await resetDb(); });

  it("membuat & membaca satu notifikasi; bentuknya lolos zNotification", async () => {
    await prisma.notification.create({ data: { key: "done:SPEC-1", specId: "SPEC-1", sessionId: "spec_1", title: "judul", projectId: "p1" } });
    const row = await prisma.notification.findFirstOrThrow({ where: { specId: "SPEC-1" } });
    // Fastify menserialisasi Date → ISO string; tiru untuk memvalidasi kontrak shared.
    const wire = { ...row, createdAt: row.createdAt.toISOString(), readAt: row.readAt?.toISOString() ?? null };
    expect(zNotification.safeParse(wire).success).toBe(true);
  });

  it("key unik: create kedua dengan key sama melempar P2002", async () => {
    await prisma.notification.create({ data: { key: "done:SPEC-2", specId: "SPEC-2", title: "a", projectId: null } });
    await expect(prisma.notification.create({ data: { key: "done:SPEC-2", specId: "SPEC-2", title: "b", projectId: null } }))
      .rejects.toMatchObject({ code: "P2002" });
  });

  it("dua baris decision (key null) tidak saling tabrakan", async () => {
    await prisma.notification.create({ data: { type: "decision", sessionId: "s1", title: "a", projectId: null } });
    await prisma.notification.create({ data: { type: "decision", sessionId: "s2", title: "b", projectId: null } });
    expect(await prisma.notification.count({ where: { type: "decision" } })).toBe(2);
  });
});

describe("recordCompletion", () => {
  beforeEach(async () => { await resetDb(); });

  it("idempoten via key: dua panggilan spec sama → satu baris", async () => {
    await recordCompletion("SPEC-3", "judul", "p1");
    await recordCompletion("SPEC-3", "judul", "p1");
    expect(await prisma.notification.count({ where: { specId: "SPEC-3" } })).toBe(1);
  });

  it("menyimpan sessionId turunan untuk aksi 'Buka'", async () => {
    await recordCompletion("SPEC-4", "judul", "p1");
    const row = await prisma.notification.findFirstOrThrow({ where: { specId: "SPEC-4" } });
    expect(row.sessionId).toBe("spec-4");
    expect(row.type).toBe("done");
  });
});
