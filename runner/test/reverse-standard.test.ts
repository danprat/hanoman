import { describe, it, expect } from "vitest";
import { REVERSE_STANDARD } from "../src/reverse-standard";

// Prompt sesi reverse berdiri di atas konstanta ini: yang diuji adalah kelengkapan
// unsur standarnya, bukan redaksinya.
describe("REVERSE_STANDARD", () => {
  it("memuat semua unsur standar: struktur, format, EARS, index, konvensi, hook", () => {
    for (const t of [
      "internal/docs/", "entrypoints/", "architecture/", "requirements/", "adr/",
      "product/", "business/", "brand/", "research/", "operations/", "security/", "qa/",
      "ADR-NNNN", "Status:", "Date:",
      "Ubiquitous", "Event-driven", "State-driven", "Optional", "Unwanted",
      "README.md", "Reading Order", "Naming Standard",
      "CLAUDE.md", "AGENTS.md", "Definition of Done",
      "ensure-docs-updated.py", "IMPLEMENTATION_PREFIXES",
      "reverse-engineered",
    ]) expect(REVERSE_STANDARD, t).toContain(t);
  });

  it("tanpa backtick dan tanpa interpolasi liar — aman di dalam prompt & argv tmux", () => {
    expect(REVERSE_STANDARD).not.toContain("`");
  });
});
