import { describe, it, expect } from "vitest";
import { zAuditEscalation, zBriefPayload } from "../src";

describe("zAuditEscalation (SPEC-340 · ADR-0076)", () => {
  it("menerima manifest lengkap", () => {
    const r = zAuditEscalation.safeParse({
      target: "prd", reason: "kebutuhan produk baru", alternatives: ["brief"],
      prefill: { title: "Kuota tenant", context: "c", outcome: "o" },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.target).toBe("prd");
      expect(r.data.alternatives).toEqual(["brief"]);
      expect(r.data.prefill.constraints).toBe("");   // default terisi
      expect(r.data.prefill.severity).toBe("");
    }
  });
  it("mengisi default saat hanya target yang ada", () => {
    const r = zAuditEscalation.safeParse({ target: "none" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.reason).toBe("");
      expect(r.data.alternatives).toEqual([]);
      expect(r.data.prefill.title).toBe("");
    }
  });
  it("menolak target di luar katalog", () => {
    expect(zAuditEscalation.safeParse({ target: "epic" }).success).toBe(false);
  });
  it("menolak alternatives ber-target asing", () => {
    expect(zAuditEscalation.safeParse({ target: "qa", alternatives: ["epic"] }).success).toBe(false);
  });
});

describe("zBriefPayload menerima fromAudit (SPEC-340)", () => {
  it("mempertahankan fromAudit alih-alih membuangnya", () => {
    const r = zBriefPayload.safeParse({
      context: "c", outcome: "o", constraints: "", priority: "tinggi", fromAudit: "SPEC-300" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.fromAudit).toBe("SPEC-300");
  });
  it("tetap sah tanpa fromAudit", () => {
    const r = zBriefPayload.safeParse({ context: "c", outcome: "o", constraints: "", priority: "sedang" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.fromAudit).toBeUndefined();
  });
});
