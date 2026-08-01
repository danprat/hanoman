import { describe, it, expect } from "vitest";
import {
  WEBHOOK_ENTITIES, WEBHOOK_EVENTS, WEBHOOK_PING_TYPE, WEBHOOK_MAX_BYTES,
  WEBHOOK_BACKOFF_SEC, WEBHOOK_MAX_ATTEMPTS,
  entityDefForModel, projectRow, diffFields, eventTypeFor, matchesEvent,
  clampEnvelope, sampleEnvelope, zCreateWebhookEndpoint,
} from "./webhook";
import type { WebhookEnvelope } from "./webhook";

describe("katalog", () => {
  it("tiap jenis peristiwa unik dan punya penjelasan kapan terpicu", () => {
    const types = WEBHOOK_EVENTS.map((e) => e.type);
    expect(new Set(types).size).toBe(types.length);
    for (const e of WEBHOOK_EVENTS) {
      expect(e.when.length).toBeGreaterThan(10);
      expect(e.label.length).toBeGreaterThan(2);
    }
  });

  it("memuat webhook.ping dan peristiwa inti yang dijanjikan brief", () => {
    const types = WEBHOOK_EVENTS.map((e) => e.type);
    for (const t of [
      WEBHOOK_PING_TYPE, "spec.created", "spec.updated", "spec.stage_changed", "spec.deleted",
      "session.started", "session.ended", "lead.decision", "ticket.created",
      "notification.created", "project.created",
    ]) expect(types).toContain(t);
  });

  it("tiap entitas menyebut model Prisma dan allowlist field yang tak kosong", () => {
    for (const d of WEBHOOK_ENTITIES) {
      expect(d.model[0]).toBe(d.model[0]?.toUpperCase());
      expect(d.fields.length).toBeGreaterThan(0);
      expect(d.fields).toContain("id");
    }
  });

  it("entityDefForModel memetakan nama model Prisma", () => {
    expect(entityDefForModel("Spec")?.entity).toBe("spec");
    expect(entityDefForModel("SessionHistory")?.entity).toBe("session");
    expect(entityDefForModel("SyncLog")).toBeUndefined();
  });
});

describe("projectRow", () => {
  it("hanya meloloskan field allowlist dan menormalkan Date jadi ISO", () => {
    const def = entityDefForModel("Spec")!;
    const row = { id: "SPEC-1", title: "t", stage: "planned", createdAt: new Date(0), rahasia: "x" };
    const out = projectRow(def, row);
    expect(out.id).toBe("SPEC-1");
    expect(out.createdAt).toBe("1970-01-01T00:00:00.000Z");
    expect(out).not.toHaveProperty("rahasia");
  });
});

describe("diffFields", () => {
  const def = entityDefForModel("Spec")!;
  it("mengabaikan version & updatedAt", () => {
    const a = { id: "S", stage: "planned", version: 1, updatedAt: new Date(0) };
    const b = { id: "S", stage: "planned", version: 2, updatedAt: new Date(1) };
    expect(diffFields(def, a, b)).toEqual([]);
  });
  it("melaporkan field yang benar-benar berubah", () => {
    expect(diffFields(def, { id: "S", stage: "planned" }, { id: "S", stage: "executing" }))
      .toEqual(["stage"]);
  });
});

describe("eventTypeFor", () => {
  const spec = entityDefForModel("Spec")!;
  const session = entityDefForModel("SessionHistory")!;
  it("peristiwa turunan MENGGANTIKAN updated", () => {
    expect(eventTypeFor(spec, "updated", ["stage"])).toBe("spec.stage_changed");
    expect(eventTypeFor(spec, "updated", ["title"])).toBe("spec.updated");
  });
  it("session tak punya updated polos", () => {
    expect(eventTypeFor(session, "created", [])).toBe("session.started");
    expect(eventTypeFor(session, "updated", ["endedAt"])).toBe("session.ended");
    expect(eventTypeFor(session, "updated", ["transcriptBytes"])).toBeNull();
  });
});

describe("matchesEvent", () => {
  it("mendukung bintang total dan wildcard per-keluarga", () => {
    expect(matchesEvent(["*"], "spec.created")).toBe(true);
    expect(matchesEvent(["spec.*"], "spec.stage_changed")).toBe(true);
    expect(matchesEvent(["spec.*"], "ticket.created")).toBe(false);
    expect(matchesEvent(["ticket.created"], "ticket.created")).toBe(true);
    expect(matchesEvent([], "ticket.created")).toBe(false);
  });
});

describe("clampEnvelope", () => {
  const base = (): WebhookEnvelope => sampleEnvelope("spec.updated");
  it("membiarkan amplop kecil apa adanya", () => {
    const e = clampEnvelope(base());
    expect(e.truncated).toBe(false);
    expect(e.truncatedFields).toEqual([]);
  });
  it("membiarkan amplop yang MASIH muat walau satu fieldnya panjang", () => {
    const env = base();
    env.data.after = { ...env.data.after, objective: "x".repeat(50_000) };
    // 50 KB < 64 KiB: pemangkasan adalah kerugian data, jadi hanya dilakukan saat benar-benar perlu.
    expect(clampEnvelope(env).truncated).toBe(false);
  });
  it("memotong field string raksasa dan menandainya", () => {
    const env = base();
    env.data.after = { ...env.data.after, objective: "x".repeat(100_000) };
    const out = clampEnvelope(env);
    expect(out.truncated).toBe(true);
    expect(out.truncatedFields).toContain("after.objective");
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(WEBHOOK_MAX_BYTES);
  });
  it("membuang before seluruhnya bila masih kelewat besar", () => {
    const env = base();
    const big: Record<string, string> = {};
    for (let i = 0; i < 200; i++) big[`f${i}`] = "y".repeat(1_500);
    env.data.before = big; env.data.after = { ...big };
    const out = clampEnvelope(env);
    expect(out.data.before).toBeNull();
    expect(out.truncatedFields).toContain("before");
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(WEBHOOK_MAX_BYTES);
  });
});

describe("sampleEnvelope", () => {
  it("ada untuk SETIAP jenis peristiwa (halaman docs membacanya)", () => {
    for (const e of WEBHOOK_EVENTS) {
      const s = sampleEnvelope(e.type);
      expect(s.type).toBe(e.type);
      expect(s.specVersion).toBe("hanoman.webhook/1");
    }
  });
});

describe("backoff", () => {
  it("tabel eksplisit sepanjang maxAttempts, naik monoton", () => {
    expect(WEBHOOK_BACKOFF_SEC.length).toBe(WEBHOOK_MAX_ATTEMPTS);
    expect(WEBHOOK_BACKOFF_SEC[0]).toBe(0);
    for (let i = 1; i < WEBHOOK_BACKOFF_SEC.length; i++)
      expect(WEBHOOK_BACKOFF_SEC[i]!).toBeGreaterThan(WEBHOOK_BACKOFF_SEC[i - 1]!);
  });
});

describe("zCreateWebhookEndpoint", () => {
  it("menolak events kosong", () => {
    expect(zCreateWebhookEndpoint.safeParse({ name: "n", url: "https://a.b", events: [] }).success)
      .toBe(false);
  });
  it("menerima bentuk minimal", () => {
    expect(zCreateWebhookEndpoint.safeParse({ name: "n", url: "https://a.b", events: ["*"] }).success)
      .toBe(true);
  });
});
