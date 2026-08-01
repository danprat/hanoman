import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { entityDefForModel, WEBHOOK_QUEUE_CAP } from "@hanoman/shared";
import { prisma } from "../src/db";
import { refreshWebhookCache } from "../src/services/webhooks/endpoints";
import { buildEnvelope, emitWebhook } from "../src/services/webhooks/emit";
import { encryptSecret } from "../src/services/secret-box";
import { withActor } from "../src/services/webhooks/actor";

const spec = entityDefForModel("Spec")!;
const notif = entityDefForModel("Notification")!;

const clean = async () => {
  await prisma.webhookDelivery.deleteMany();
  await prisma.webhookEndpoint.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "hanoman", name: "hanoman", desc: "", kind: "web" } });
  await prisma.webhookDelivery.deleteMany();
  await refreshWebhookCache();
});
afterAll(async () => { await clean(); await refreshWebhookCache(); });

const endpoint = async (over: Record<string, unknown> = {}) => {
  const r = await prisma.webhookEndpoint.create({
    data: {
      name: "e", url: "https://contoh.id/hook", secret: encryptSecret("s".repeat(32)),
      events: ["*"] as never, ...over,
    } as never,
  });
  await refreshWebhookCache();
  return r;
};

describe("buildEnvelope", () => {
  it("membentuk amplop v1 lengkap dengan aktor & project", () => {
    const env = buildEnvelope(
      {
        def: spec, action: "updated", before: { id: "SPEC-1", stage: "planned" },
        after: { id: "SPEC-1", stage: "executing", projectId: "hanoman" }, changed: ["stage"],
      },
      "hanoman", "2026-08-01T00:00:00.000Z", "evt_x");
    expect(env).not.toBeNull();
    expect(env!.type).toBe("spec.stage_changed");
    expect(env!.specVersion).toBe("hanoman.webhook/1");
    expect(env!.project).toEqual({ id: "hanoman", name: "hanoman" });
    expect(env!.actor.kind).toBe("system");
    expect(env!.data.changed).toEqual(["stage"]);
  });

  it("null saat kombinasi aksi/perubahan tak punya jenis peristiwa", () => {
    const sess = entityDefForModel("SessionHistory")!;
    expect(buildEnvelope(
      {
        def: sess, action: "updated", before: { id: "1" }, after: { id: "1" },
        changed: ["transcriptBytes"],
      }, null, "2026-08-01T00:00:00.000Z", "e")).toBeNull();
  });

  it("null untuk baris yang cocok skipWhen (notifikasi bertipe webhook)", () => {
    expect(buildEnvelope(
      {
        def: notif, action: "created", before: null,
        after: { id: "n1", type: "webhook", title: "…" }, changed: [],
      },
      null, "2026-08-01T00:00:00.000Z", "e")).toBeNull();
  });

  it("memakai aktor dari konteks", async () => {
    const env = await withActor({ kind: "lead", id: null, label: "hanoman-lead" }, async () =>
      buildEnvelope({ def: spec, action: "created", before: null, after: { id: "S" }, changed: [] },
        null, "2026-08-01T00:00:00.000Z", "e"));
    expect(env!.actor.label).toBe("hanoman-lead");
  });
});

describe("emitWebhook", () => {
  it("tak menulis apa pun bila tak ada endpoint", async () => {
    await emitWebhook({
      def: spec, action: "created", before: null,
      after: { id: "SPEC-1", projectId: "hanoman" }, changed: [],
    });
    expect(await prisma.webhookDelivery.count()).toBe(0);
  });

  it("satu baris pengiriman per endpoint yang cocok, eventId SAMA", async () => {
    await endpoint({ name: "a" });
    await endpoint({ name: "b" });
    await emitWebhook({
      def: spec, action: "created", before: null,
      after: { id: "SPEC-1", projectId: "hanoman" }, changed: [],
    });
    const rows = await prisma.webhookDelivery.findMany();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.eventId)).size).toBe(1);
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.eventType).toBe("spec.created");
  });

  it("melewati endpoint yang tak berlangganan jenisnya", async () => {
    await endpoint({ name: "a", events: ["ticket.created"] as never });
    await emitWebhook({
      def: spec, action: "created", before: null,
      after: { id: "SPEC-1", projectId: "hanoman" }, changed: [],
    });
    expect(await prisma.webhookDelivery.count()).toBe(0);
  });

  it("payload memuat nama project, bukan hanya id", async () => {
    await endpoint();
    await emitWebhook({
      def: spec, action: "created", before: null,
      after: { id: "SPEC-1", projectId: "hanoman" }, changed: [],
    });
    const r = await prisma.webhookDelivery.findFirst();
    expect((r!.payload as { project: { name: string } }).project.name).toBe("hanoman");
  });

  it("payload hanya memuat field allowlist", async () => {
    await endpoint();
    await emitWebhook({
      def: spec, action: "created", before: null,
      after: { id: "SPEC-1", projectId: "hanoman", payload: { rahasia: 1 } }, changed: [],
    });
    const r = await prisma.webhookDelivery.findFirst();
    expect(JSON.stringify(r!.payload)).not.toContain("rahasia");
  });

  it("menjatuhkan peristiwa saat antrean endpoint penuh — TERLIHAT sebagai baris dropped", async () => {
    const e = await endpoint();
    await prisma.webhookDelivery.createMany({
      data: Array.from({ length: WEBHOOK_QUEUE_CAP }, (_, i) => ({
        endpointId: e.id, eventId: `old${i}`, eventType: "spec.created", payload: {} as never,
      })) as never,
    });
    await emitWebhook({
      def: spec, action: "created", before: null,
      after: { id: "SPEC-9", projectId: "hanoman" }, changed: [],
    });
    const dropped = await prisma.webhookDelivery.findMany({ where: { status: "dropped" } });
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.error).toContain("antrean penuh");
  });

  it("kegagalan fan-out TIDAK melempar ke pemanggil (jalur tulis tak boleh ikut gagal)", async () => {
    await endpoint();
    await expect(emitWebhook({
      def: spec, action: "created", before: null, after: null as never, changed: [],
    })).resolves.toBeUndefined();
  });
});
