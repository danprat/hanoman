import { describe, it, expect } from "vitest";
import { PIPELINES, startPrompt } from "../src/prompt";

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
});
