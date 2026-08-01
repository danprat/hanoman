import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { WEBHOOK_ENTITIES } from "@hanoman/shared";
import { PG_ORDER } from "../../cli/src/commands/migrate-pg";

const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));

// SPEC-481 · katalog webhook menyebut nama model & kolom Prisma sebagai STRING. Tanpa test ini
// rename kolom mengosongkan payload tanpa satu pun error — persis kelas gagal-senyap ADR-0094.
describe("katalog webhook vs DMMF", () => {
  it("setiap model katalog ada di skema", () => {
    for (const d of WEBHOOK_ENTITIES) expect(models.has(d.model), d.model).toBe(true);
  });

  it("setiap field allowlist ada di modelnya", () => {
    for (const d of WEBHOOK_ENTITIES) {
      const cols = new Set(models.get(d.model)!.fields.map((f) => f.name));
      for (const f of d.fields) expect(cols.has(f), `${d.model}.${f}`).toBe(true);
    }
  });

  it("projectIdField & skipWhen & cascade menunjuk kolom/model yang nyata", () => {
    for (const d of WEBHOOK_ENTITIES) {
      const cols = new Set(models.get(d.model)!.fields.map((f) => f.name));
      if (d.projectIdField) expect(cols.has(d.projectIdField), `${d.model}.${d.projectIdField}`).toBe(true);
      if (d.skipWhen) expect(cols.has(d.skipWhen.field), `${d.model}.${d.skipWhen.field}`).toBe(true);
      for (const c of d.cascade ?? [])
        expect(models.has(c[0]!.toUpperCase() + c.slice(1)), c).toBe(true);
    }
  });
});

describe("PG_ORDER", () => {
  it("memuat model webhook yang baru (kelas bug ADR-0094 gotcha 7)", () => {
    expect(PG_ORDER).toContain("WebhookEndpoint");
    expect(PG_ORDER).toContain("WebhookDelivery");
    expect(PG_ORDER.indexOf("WebhookDelivery")).toBeGreaterThan(PG_ORDER.indexOf("WebhookEndpoint"));
  });
});

describe("model webhook", () => {
  it("WebhookEndpoint TAK punya kolom `version` — LOCAL-only, tak disync", () => {
    const cols = models.get("WebhookEndpoint")!.fields.map((f) => f.name);
    expect(cols).not.toContain("version");
  });
});
