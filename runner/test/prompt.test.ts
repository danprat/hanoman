import { describe, it, expect } from "vitest";
import { PIPELINES, startPrompt, startProjectPrompt, continuePrompt } from "../src/prompt";

const spec = { id: "SPEC-162", title: "Sesi interaktif", source: "brief",
  priority: "high", objective: "Ganti runOne dengan tmux" };

describe("startPrompt", () => {
  it("memuat identitas backlog item dan objective-nya", () => {
    const p = startPrompt("feature", spec, "hanoman/spec-162");
    expect(p).toContain("SPEC-162");
    expect(p).toContain("Ganti runOne dengan tmux");
    expect(p).toContain("Sesi interaktif");
  });

  it("menyebut setiap fase pipeline flow-nya, berurutan", () => {
    const p = startPrompt("feature", spec, "hanoman/spec-162");
    for (const phase of PIPELINES.feature) expect(p).toContain(phase);
    expect(p.indexOf("Brainstorm")).toBeLessThan(p.indexOf("Execute"));
  });

  it("flow qa memakai pipeline-nya sendiri, bukan feature", () => {
    const p = startPrompt("qa", spec, "hanoman/spec-162");
    expect(p).toContain("Audit");
    expect(p).not.toContain("Brainstorm");
  });

  it("menginstruksikan append ke $HANOMAN_PHASE_FILE, bukan tulis-timpa", () => {
    const p = startPrompt("feature", spec, "hanoman/spec-162");
    expect(p).toContain("$HANOMAN_PHASE_FILE");
    expect(p).toContain(">>");
  });

  it("menyuruh agen push ke branchTo-nya sendiri", () => {
    const p = startPrompt("feature", spec, "hanoman/spec-162");
    expect(p).toContain("hanoman/spec-162");
    expect(p).toContain("git push");
  });

  it("feature: menyuruh invoke skill superpowers per fase lewat Skill tool", () => {
    const p = startPrompt("feature", spec, "b");
    for (const s of ["superpowers:brainstorming", "superpowers:writing-plans",
      "superpowers:executing-plans", "superpowers:test-driven-development",
      "superpowers:verification-before-completion"]) expect(p).toContain(s);
    expect(p).toContain("Skill tool");
  });

  it("qa: Audit memakai systematic-debugging, tanpa brainstorming", () => {
    const p = startPrompt("qa", spec, "b");
    expect(p).toContain("superpowers:systematic-debugging");
    expect(p).not.toContain("superpowers:brainstorming");
  });

  it("payload ikut saat ada, dan tak menghasilkan 'undefined' saat tak ada", () => {
    expect(startPrompt("qa", { ...spec, payload: { severity: "major" } }, "b")).toContain("severity");
    expect(startPrompt("qa", spec, "b")).not.toContain("undefined");
  });

  // SPEC-173: Execute belum selesai selama plan masih punya kotak `- [ ]`.
  it("feature/qa: melarang Execute done sebelum semua kotak plan - [x]", () => {
    for (const flow of ["feature", "qa"] as const) {
      const p = startPrompt(flow, spec, "b");
      expect(p).toContain("Execute BELUM selesai");
      expect(p).toContain("- [x]");
    }
  });
});

// SPEC-172 · reopen: lanjut di Execute untuk spec yang keburu `done`, tanpa mengulang pipeline.
describe("continuePrompt", () => {
  const branch = "hanoman/spec-162";

  it("identitas & objective backlog item ikut", () => {
    const p = continuePrompt("feature", spec, branch);
    expect(p).toContain("SPEC-162");
    expect(p).toContain("Ganti runOne dengan tmux");
  });

  it("lanjut di Execute, tak mengulang pipeline dari awal", () => {
    const p = continuePrompt("feature", spec, branch);
    expect(p).toContain("Execute");
    expect(p).toContain("docs/superpowers/plans");
    expect(p).not.toContain("Brainstorm");
    expect(p).not.toContain("Kerjakan fase berurutan"); // phaseInstruction absen
    expect(p).not.toContain("$HANOMAN_PHASE_FILE");
  });

  it("hanya skill fase Execute yang di-invoke", () => {
    const p = continuePrompt("feature", spec, branch);
    for (const s of ["superpowers:executing-plans", "superpowers:test-driven-development",
      "superpowers:verification-before-completion"]) expect(p).toContain(s);
    expect(p).not.toContain("superpowers:brainstorming");
    expect(p).not.toContain("superpowers:writing-plans");
  });

  it("tetap menyuruh commit + push ke branch-nya", () => {
    const p = continuePrompt("feature", spec, branch);
    expect(p).toContain("git push");
    expect(p).toContain("hanoman/spec-162");
  });

  it("memuat marker MELANJUTKAN di awal (dipakai server untuk verifikasi pilihan prompt)", () => {
    expect(continuePrompt("feature", spec, branch)).toContain("MELANJUTKAN");
  });

  it("payload ikut saat ada, tanpa 'undefined' saat tidak", () => {
    expect(continuePrompt("qa", { ...spec, payload: { severity: "major" } }, "b")).toContain("severity");
    expect(continuePrompt("feature", spec, "b")).not.toContain("undefined");
  });
});

// SPEC-166 · sesi reverse project-level: prompt-nya membawa standar docs lengkap.
describe("startProjectPrompt", () => {
  const project = { id: "termilo", name: "termilo", desc: "booking SaaS", stack: "cloudflare" };

  it("reverse: kelima fase berurutan, dengan instruksi phase file", () => {
    const p = startProjectPrompt("reverse", project, "reverse-docs");
    const phases = ["Scan", "Docs teknis", "Wawancara", "Konvensi & index", "Serah terima"];
    expect(PIPELINES.reverse).toEqual(phases);
    for (const ph of phases) expect(p).toContain(ph);
    expect(p.indexOf("Scan")).toBeLessThan(p.indexOf("Serah terima"));
    expect(p).toContain("$HANOMAN_PHASE_FILE");
  });

  it("memuat standar docs: kategori, ADR, EARS, index, hook", () => {
    const p = startProjectPrompt("reverse", project, "reverse-docs");
    for (const t of ["STANDAR DOCS", "internal/docs/", "ADR-NNNN", "Event-driven",
      "ensure-docs-updated.py", "Reading Order"]) expect(p).toContain(t);
  });

  it("wawancara: satu pertanyaan per giliran, dilarang mengarang", () => {
    const p = startProjectPrompt("reverse", project, "reverse-docs");
    expect(p).toContain("SATU pertanyaan");
    expect(p).toContain("menunggu input");
    expect(p).toContain("Jangan mengarang");
  });

  it("commit+push per fase ke branch-nya, dengan fallback tanpa origin", () => {
    const p = startProjectPrompt("reverse", project, "reverse-docs");
    expect(p).toContain("refs/heads/reverse-docs");
    expect(p).toContain("origin tidak ada");
  });

  it("identitas project ikut, tanpa 'undefined'", () => {
    const p = startProjectPrompt("reverse", project, "reverse-docs");
    expect(p).toContain("termilo");
    expect(p).toContain("booking SaaS");
    expect(p).not.toContain("undefined");
  });

  // SPEC-173: klausa plan hanya untuk flow ber-fase Plan+Execute; reverse tak punya.
  it("reverse: tanpa klausa penyelesaian plan (tak ada fase Plan+Execute)", () => {
    expect(startProjectPrompt("reverse", project, "reverse-docs")).not.toContain("Execute BELUM selesai");
  });
});
