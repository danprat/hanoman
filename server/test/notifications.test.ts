import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { resetDb } from "./factory";
import { zNotification } from "@hanoman/shared";

describe("Notification model", () => {
  beforeEach(async () => { await resetDb(); });

  it("membuat & membaca satu notifikasi; bentuknya lolos zNotification", async () => {
    await prisma.notification.create({ data: { specId: "SPEC-1", title: "judul", projectId: "p1" } });
    const row = await prisma.notification.findUniqueOrThrow({ where: { specId: "SPEC-1" } });
    // Fastify menserialisasi Date → ISO string; tiru untuk memvalidasi kontrak shared.
    const wire = { ...row, createdAt: row.createdAt.toISOString(), readAt: row.readAt?.toISOString() ?? null };
    expect(zNotification.safeParse(wire).success).toBe(true);
  });

  it("specId unik: create kedua untuk spec yang sama melempar P2002", async () => {
    await prisma.notification.create({ data: { specId: "SPEC-2", title: "a", projectId: null } });
    await expect(prisma.notification.create({ data: { specId: "SPEC-2", title: "b", projectId: null } }))
      .rejects.toMatchObject({ code: "P2002" });
  });
});
