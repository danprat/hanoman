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

// SPEC-236 · terminal biasa NON-claude: shell mentah di repoDir project. Varian `{project, shell:true}`
// terpisah dari `flow` dan didahulukan di union (z.object non-strict membuang key asing).
describe("zTerminalSession — varian shell (SPEC-236)", () => {
  it("menerima { project, shell: true } sebagai varian shell", () => {
    const r = zTerminalSession.safeParse({ project: "p1", shell: true });
    expect(r.success).toBe(true);
    expect(r.success && "shell" in r.data && r.data.shell).toBe(true);
  });
  it("{ project } tanpa shell tetap terminal biasa (bukan shell)", () => {
    const r = zTerminalSession.safeParse({ project: "p1" });
    expect(r.success).toBe(true);
    expect(r.success && "shell" in r.data).toBe(false);
  });
  it("{ project, flow: reverse } tak tertelan varian shell", () => {
    const r = zTerminalSession.safeParse({ project: "p1", flow: "reverse" });
    expect(r.success && "flow" in r.data && r.data.flow).toBe("reverse");
  });
  it("shell wajib literal true → { shell:false } bukan varian shell", () => {
    const r = zTerminalSession.safeParse({ project: "p1", shell: false });
    expect(r.success).toBe(true);
    expect(r.success && "shell" in r.data).toBe(false);
  });
});

// SPEC-222 · sesi scaffold project-level (from-scratch), tanpa brief — diseed dari Project.desc.
describe("zTerminalSession — varian scaffold", () => {
  it("menerima sesi scaffold project-level", () => {
    expect(zTerminalSession.safeParse({ project: "p1", flow: "scaffold" }).success).toBe(true);
  });
  it("zFlow memuat scaffold", () => expect(zFlow.safeParse("scaffold").success).toBe(true));
  it("varian reverse & prd tetap valid", () => {
    expect(zTerminalSession.safeParse({ project: "p1", flow: "reverse" }).success).toBe(true);
    expect(zTerminalSession.safeParse({ project: "p1", flow: "prd",
      brief: { title: "x", context: "c", outcome: "o" } }).success).toBe(true);
  });
});
