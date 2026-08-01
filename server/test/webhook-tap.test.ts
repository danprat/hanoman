import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { refreshWebhookCache } from "../src/services/webhooks/endpoints";
import { installWebhooks } from "../src/services/webhooks/install";
import { __resetWebhookTap } from "../src/services/webhooks/tap";
import { encryptSecret } from "../src/services/secret-box";

const clean = async () => {
  await prisma.webhookDelivery.deleteMany();
  await prisma.webhookEndpoint.deleteMany();
  await prisma.sessionHistory.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};

const listen = async (events: string[] = ["*"]) => {
  await prisma.webhookEndpoint.create({
    data: {
      name: "e", url: "https://contoh.id/hook", secret: encryptSecret("s".repeat(32)),
      events: events as never,
    } as never,
  });
  await refreshWebhookCache();
  await prisma.webhookDelivery.deleteMany();
};

// Tap fire-and-forget: beri satu putaran event loop supaya barisnya sempat ditulis.
const settle = () => new Promise((r) => setTimeout(r, 60));
const kinds = async () =>
  (await prisma.webhookDelivery.findMany({ orderBy: { createdAt: "asc" } })).map((d) => d.eventType);

beforeEach(async () => {
  // Endapkan emit fire-and-forget milik test SEBELUMNYA dulu: menghapus endpoint selagi baris
  // pengiriman masih dalam perjalanan memancing P2003 yang terbaca seperti bug produk, padahal
  // `emitWebhook` memang menelannya (dan itu justru perilaku yang benar).
  await settle();
  await clean();
  await installWebhooks();
  await prisma.project.create({ data: { id: "hanoman", name: "hanoman", desc: "", kind: "web" } });
  await settle();
  await prisma.webhookDelivery.deleteMany();   // buang project.created dari seed
});
afterAll(async () => { await clean(); __resetWebhookTap(); await refreshWebhookCache(); });

const mkSpec = (over: Record<string, unknown> = {}) => prisma.spec.create({
  data: {
    id: "SPEC-1", projectId: "hanoman", title: "t", source: "brief", stage: "backlog",
    priority: "sedang", author: "a", objective: "o", ...over,
  } as never,
});

describe("gerbang", () => {
  it("tanpa endpoint aktif tak ada satu pun baris pengiriman", async () => {
    await mkSpec(); await settle();
    expect(await prisma.webhookDelivery.count()).toBe(0);
  });
});

describe("tap · create/update/delete", () => {
  beforeEach(() => listen());

  it("create memancarkan spec.created", async () => {
    await mkSpec(); await settle();
    expect(await kinds()).toEqual(["spec.created"]);
  });

  it("update memancarkan spec.updated dengan before & after", async () => {
    await mkSpec(); await settle(); await prisma.webhookDelivery.deleteMany();
    await prisma.spec.update({ where: { id: "SPEC-1" }, data: { title: "baru" } });
    await settle();
    const d = await prisma.webhookDelivery.findFirst();
    const p = d!.payload as {
      data: { before: Record<string, unknown>; after: Record<string, unknown>; changed: string[] };
    };
    expect(d!.eventType).toBe("spec.updated");
    expect(p.data.before.title).toBe("t");
    expect(p.data.after.title).toBe("baru");
    expect(p.data.changed).toEqual(["title"]);
  });

  it("perubahan stage jadi spec.stage_changed, BUKAN spec.updated", async () => {
    await mkSpec(); await settle(); await prisma.webhookDelivery.deleteMany();
    await prisma.spec.update({ where: { id: "SPEC-1" }, data: { stage: "executing" } });
    await settle();
    expect(await kinds()).toEqual(["spec.stage_changed"]);
  });

  it("updateMany (CAS liveSpecs) juga memancarkan", async () => {
    await mkSpec(); await settle(); await prisma.webhookDelivery.deleteMany();
    await prisma.spec.updateMany({ where: { id: "SPEC-1", stage: "backlog" }, data: { stage: "planned" } });
    await settle();
    expect(await kinds()).toEqual(["spec.stage_changed"]);
  });

  it("tulisan yang tak mengubah apa pun TIDAK memancarkan", async () => {
    await mkSpec(); await settle(); await prisma.webhookDelivery.deleteMany();
    await prisma.spec.update({ where: { id: "SPEC-1" }, data: { title: "t" } });
    await settle();
    expect(await prisma.webhookDelivery.count()).toBe(0);
  });

  it("delete memancarkan spec.deleted dengan before terisi, after null", async () => {
    await mkSpec(); await settle(); await prisma.webhookDelivery.deleteMany();
    await prisma.spec.delete({ where: { id: "SPEC-1" } });
    await settle();
    const d = await prisma.webhookDelivery.findFirst();
    const p = d!.payload as { data: { before: unknown; after: unknown } };
    expect(d!.eventType).toBe("spec.deleted");
    expect(p.data.before).not.toBeNull();
    expect(p.data.after).toBeNull();
  });

  it("model yang TIDAK di katalog tak memancarkan apa pun", async () => {
    await prisma.syncOutbox.create({ data: { entity: "spec", recordId: "SPEC-1" } });
    await settle();
    expect(await prisma.webhookDelivery.count()).toBe(0);
  });

  it("menulis WebhookDelivery sendiri tidak memicu rekursi", async () => {
    await mkSpec(); await settle();
    const n = await prisma.webhookDelivery.count();
    await settle();
    expect(await prisma.webhookDelivery.count()).toBe(n);
    expect(n).toBe(1);
  });
});

describe("tap · sesi & notifikasi", () => {
  beforeEach(() => listen());

  it("SessionHistory create → session.started; endedAt terisi → session.ended", async () => {
    await prisma.sessionHistory.create({
      data: {
        id: "h1", sessionId: "spec_1", projectId: "hanoman", kind: "spec", agent: "claude", cwd: "/tmp",
      },
    });
    await settle();
    expect(await kinds()).toEqual(["session.started"]);
    await prisma.webhookDelivery.deleteMany();
    await prisma.sessionHistory.update({ where: { id: "h1" }, data: { endedAt: new Date(), exitCode: 0 } });
    await settle();
    expect(await kinds()).toEqual(["session.ended"]);
  });

  it("pembaruan SessionHistory tanpa endedAt tak memancarkan", async () => {
    await prisma.sessionHistory.create({
      data: {
        id: "h1", sessionId: "spec_1", projectId: "hanoman", kind: "spec", agent: "claude", cwd: "/tmp",
      },
    });
    await settle(); await prisma.webhookDelivery.deleteMany();
    await prisma.sessionHistory.update({ where: { id: "h1" }, data: { transcriptBytes: 10 } });
    await settle();
    expect(await prisma.webhookDelivery.count()).toBe(0);
  });

  it("notifikasi bertipe `webhook` TIDAK difan-out (anti-umpan-balik)", async () => {
    await prisma.notification.create({ data: { type: "webhook", title: "Endpoint dinonaktifkan" } });
    await settle();
    expect(await prisma.webhookDelivery.count()).toBe(0);
  });

  it("notifikasi biasa difan-out", async () => {
    await prisma.notification.create({ data: { type: "done", title: "Selesai", projectId: "hanoman" } });
    await settle();
    expect(await kinds()).toEqual(["notification.created"]);
  });
});

describe("tap · cascade project", () => {
  beforeEach(() => listen());
  it("project.deleted menyebut jumlah anak yang ikut terhapus", async () => {
    await mkSpec();
    await settle();
    await prisma.webhookDelivery.deleteMany();
    await prisma.project.delete({ where: { id: "hanoman" } });
    await settle();
    const d = await prisma.webhookDelivery.findFirst({ where: { eventType: "project.deleted" } });
    expect((d!.payload as { data: { cascade: Record<string, number> } }).data.cascade.spec).toBe(1);
  });
});
