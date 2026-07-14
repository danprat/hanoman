import { describe, it, expect } from "vitest";
import { zTerminalSession, zFlow, zPrdBrief } from "../src/dto";

// SPEC-210 · sesi prd project-level membawa brief; flow enum memuat "prd".
describe("zTerminalSession — varian prd", () => {
  it("menerima sesi prd project-level dengan brief", () => {
    const r = zTerminalSession.safeParse({
      project: "p1", flow: "prd",
      brief: { title: "Jadwal invoice", context: "c", outcome: "o" },
    });
    expect(r.success).toBe(true);
  });
  it("menolak prd tanpa brief", () => {
    expect(zTerminalSession.safeParse({ project: "p1", flow: "prd" }).success).toBe(false);
  });
  it("menolak brief tanpa judul", () => {
    expect(zPrdBrief.safeParse({ title: "", context: "c", outcome: "o" }).success).toBe(false);
  });
  it("varian reverse & spec tetap valid", () => {
    expect(zTerminalSession.safeParse({ project: "p1", flow: "reverse" }).success).toBe(true);
    expect(zTerminalSession.safeParse({ spec: "SPEC-1", flow: "feature" }).success).toBe(true);
  });
  it("zFlow memuat prd", () => expect(zFlow.safeParse("prd").success).toBe(true));
});
