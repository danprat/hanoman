import { describe, it, expect } from "vitest";
import { startPrompt, startPrdPrompt, ESCALATION_CONTRACT } from "../src/prompt";
import type { SpecBrief } from "../src/types";

const spec: SpecBrief = {
  id: "SPEC-300", title: "Kenapa antrean menumpuk", source: "audit",
  priority: "tinggi", objective: "telusuri",
};

describe("kontrak escalation di prompt audit (SPEC-340 · ADR-0076)", () => {
  it("menyebut keempat target", () => {
    for (const t of ["none", "qa", "brief", "prd"]) expect(ESCALATION_CONTRACT).toContain(`"${t}"`);
  });
  it("mewajibkan blok json berkunci escalation", () => {
    expect(ESCALATION_CONTRACT).toContain("```json");
    expect(ESCALATION_CONTRACT).toContain("escalation");
    expect(ESCALATION_CONTRACT).toContain("prefill");
  });
  it("prompt flow audit memuat kontrak itu", () => {
    expect(startPrompt("audit", spec, "hanoman/spec-300")).toContain(ESCALATION_CONTRACT);
  });
  it("prompt flow feature TIDAK memuat kontrak itu", () => {
    const p = startPrompt("feature", { ...spec, source: "brief" }, "hanoman/spec-300");
    expect(p).not.toContain("```json");
  });
});

describe("kontinuitas brief lanjutan audit (SPEC-340 · ADR-0076)", () => {
  const briefSpec: SpecBrief = {
    id: "SPEC-320", title: "Ekspor CSV", source: "brief", priority: "sedang", objective: "bisa unduh",
    payload: { context: "c", outcome: "o", constraints: "", priority: "sedang", fromAudit: "SPEC-300" },
  };

  it("feature + fromAudit menyebut dokumen auditnya", () => {
    const p = startPrompt("feature", briefSpec, "hanoman/spec-320");
    expect(p).toContain("SPEC-300");
    expect(p).toContain("audit-spec-300");
  });
  // `phaseInstruction` selalu menyebut `skipped` sebagai opsi umum di SEMUA prompt, jadi yang
  // dijaga di sini adalah klausa kontinuitasnya: tak ada satu fase pun yang disuruh dilewati.
  it("feature + fromAudit TIDAK menyuruh menandai fase mana pun skipped", () => {
    const p = startPrompt("feature", briefSpec, "hanoman/spec-320");
    for (const fase of ["Brainstorm", "Objective", "Spec", "Plan", "Execute", "Audit"])
      expect(p).not.toContain(`${fase} skipped`);
  });
  it("feature TANPA fromAudit tak menyebut audit sama sekali", () => {
    const p = startPrompt("feature",
      { ...briefSpec, payload: { context: "c", outcome: "o", constraints: "", priority: "sedang" } },
      "hanoman/spec-320");
    expect(p).not.toContain("audit-spec-");
  });
  it("qa + fromAudit tetap menyuruh menandai Audit skipped (ADR-0059 utuh)", () => {
    const qaSpec: SpecBrief = { ...briefSpec, source: "qa",
      payload: { severity: "major", steps: "s", expected: "e", actual: "a", env: "", fromAudit: "SPEC-300" } };
    expect(startPrompt("qa", qaSpec, "hanoman/spec-320")).toContain("Audit skipped");
  });
});

describe("startPrdPrompt dengan dokumen audit tersemat (SPEC-340 · ADR-0076)", () => {
  const project = { id: "p1", name: "P1", desc: "", stack: "" };
  const brief = { title: "Kuota tenant", context: "c", outcome: "o" };

  it("menyematkan isi dokumen audit + id-nya", () => {
    const p = startPrdPrompt(project, brief, "prd/kuota-tenant",
      { id: "SPEC-300", path: "internal/docs/research/audit-spec-300-x.md", content: "TEMUAN PENTING" });
    expect(p).toContain("DOKUMEN AUDIT SPEC-300");
    expect(p).toContain("internal/docs/research/audit-spec-300-x.md");
    expect(p).toContain("TEMUAN PENTING");
  });
  it("tanpa audit, prompt persis seperti sebelumnya (tanpa blok audit)", () => {
    expect(startPrdPrompt(project, brief, "prd/kuota-tenant")).not.toContain("DOKUMEN AUDIT");
  });
});
