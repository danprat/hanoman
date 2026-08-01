import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { PG_ORDER } from "../../cli/src/commands/migrate-pg";

const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
const cols = (m: string) => new Set(models.get(m)!.fields.map((f) => f.name));

// SPEC-485 · ADR-0102 · gotcha 6: model baru yang tak masuk PG_ORDER hilang SENYAP saat migrasi
// dari Postgres (kelas bug ADR-0094 gotcha 7), dan kolom `version` akan menyeretnya ke mesin sync
// padahal jejak lead LOCAL-only.
describe("skema LeadFlow", () => {
  it("modelnya ada dengan kolom daur hidup yang lengkap", () => {
    expect(models.has("LeadFlow")).toBe(true);
    for (const c of ["id", "projectId", "specId", "sessionId", "gate", "status", "title",
      "steps", "closeReason", "openedAt", "closedAt", "expiresAt"])
      expect(cols("LeadFlow").has(c), c).toBe(true);
  });

  it("LOCAL-only: tanpa kolom `version`", () => {
    expect(cols("LeadFlow").has("version")).toBe(false);
  });

  it("LeadDecision menunjuk alur & menyimpan pilihan sebagai daftar", () => {
    for (const c of ["flowId", "step", "choices", "select"])
      expect(cols("LeadDecision").has(c), c).toBe(true);
  });

  it("masuk PG_ORDER, sebelum LeadDecision yang menunjuknya", () => {
    expect(PG_ORDER).toContain("LeadFlow");
    expect(PG_ORDER.indexOf("LeadFlow")).toBeLessThan(PG_ORDER.indexOf("LeadDecision"));
  });
});
