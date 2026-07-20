import { describe, it, expect } from "vitest";
import { PIPELINES, startPrompt, startProjectPrompt, continuePrompt, startPrdPrompt, startScaffoldPrompt, resolvePhaseModels } from "../src/prompt";

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

  // SPEC-237 · flow audit-only: Audit → Laporan, dokumen saja, tanpa Execute.
  it("pipeline audit = Audit → Laporan, tanpa Plan/Execute", () => {
    expect(PIPELINES.audit).toEqual(["Audit", "Laporan"]);
  });
  it("startPrompt audit menginstruksikan dokumen audit tanpa perbaikan kode", () => {
    const p = startPrompt("audit", spec, "hanoman/spec-237");
    expect(p).toContain("Audit");
    expect(p).toContain("Laporan");
    expect(p).not.toContain("Execute");
    expect(p.toLowerCase()).toContain("jangan");
    expect(p.toLowerCase()).toContain("dokumen audit");
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

  // SPEC-204 · ADR-0040: pasca-Audit, temuan berconfidence tinggi & langsung → lewati Spec+Plan.
  it("qa: menginstruksikan jalur cepat — lewati Spec & Plan bila temuan langsung dikerjakan", () => {
    const p = startPrompt("qa", spec, "b");
    expect(p).toContain("confidence");
    expect(p).toContain("Spec skipped");
    expect(p).toContain("Plan skipped");
    // keputusan berpangkal pada hasil Audit
    expect(p.indexOf("Audit")).toBeLessThan(p.indexOf("Spec skipped"));
  });

  it("feature: TIDAK membawa klausa jalur cepat Audit (khusus qa)", () => {
    const p = startPrompt("feature", spec, "b");
    expect(p).not.toContain("Spec skipped");
    expect(p).not.toContain("Plan skipped");
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

  // SPEC-187 · ADR-0035: lanjut antar-fase tanpa berhenti; berhenti hanya untuk keputusan manusia.
  it("feature/qa: menyuruh terus lanjut antar-fase, berhenti hanya untuk keputusan manusia", () => {
    for (const flow of ["feature", "qa"] as const) {
      const p = startPrompt(flow, spec, "b");
      expect(p).toContain("tanpa berhenti di batas antar-fase");
      expect(p).toContain("keputusan manusia");
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

  // SPEC-187 · ADR-0035: reopen Execute pun lanjut tanpa berhenti antar-checkpoint.
  it("membawa klausa otonomi (berhenti hanya untuk keputusan manusia)", () => {
    expect(continuePrompt("feature", spec, branch)).toContain("tanpa berhenti di batas antar-fase");
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

  // SPEC-187 · ADR-0035: reverse dikecualikan — Wawancara memang interaktif, satu tanya per giliran.
  it("reverse: TIDAK membawa klausa otonomi", () => {
    expect(startProjectPrompt("reverse", project, "reverse-docs")).not.toContain("tanpa berhenti di batas antar-fase");
  });
});

// SPEC-210 · sesi prd project-level: PM menyusun dokumen PRD dari brief + brainstorm interaktif.
describe("startPrdPrompt", () => {
  const project = { id: "acme", name: "Acme", desc: "d", stack: "ts" };
  const brief = { title: "Jadwal Invoice Berulang", context: "PM butuh penjadwalan", outcome: "invoice terjadwal" };

  it("memuat fase Brainstorm lalu PRD, berurutan, dengan instruksi phase file", () => {
    const p = startPrdPrompt(project, brief, "prd/jadwal-invoice-berulang");
    expect(PIPELINES.prd).toEqual(["Brainstorm", "PRD"]);
    expect(p).toContain("Brainstorm → PRD"); // urutan fase di phaseInstruction
    expect(p).toContain("$HANOMAN_PHASE_FILE");
  });

  it("menyuruh tulis dokumen ke docs/prd/<slug>.md", () => {
    const p = startPrdPrompt(project, brief, "prd/jadwal-invoice-berulang");
    expect(p).toContain("docs/prd/jadwal-invoice-berulang.md");
  });

  it("menyisipkan brief + identitas project, tanpa 'undefined'", () => {
    const p = startPrdPrompt(project, brief, "prd/x");
    expect(p).toContain("Jadwal Invoice Berulang");
    expect(p).toContain("PM butuh penjadwalan");
    expect(p).toContain("acme");
    expect(p).not.toContain("undefined");
  });

  it("invoke skill brainstorming + push ke branchTo, keluaran HANYA dokumen PRD", () => {
    const p = startPrdPrompt(project, brief, "prd/x");
    expect(p).toContain("superpowers:brainstorming");
    expect(p).toContain("refs/heads/prd/x");
    expect(p).toContain("git push");
    expect(p).toContain("HANYA dokumen PRD");
  });

  it("brainstorm interaktif satu pertanyaan per giliran (PM menonton terminal)", () => {
    const p = startPrdPrompt(project, brief, "prd/x");
    expect(p).toContain("SATU pertanyaan");
  });

  it("tanpa klausa penyelesaian plan (tak ada fase Plan+Execute)", () => {
    expect(startPrdPrompt(project, brief, "prd/x")).not.toContain("Execute BELUM selesai");
  });
});

// SPEC-222 · sesi scaffold project-level: dari ide → seluruh doc index. Reverse tanpa Scan.
describe("startScaffoldPrompt", () => {
  const project = { id: "kirana", name: "Kirana", desc: "marketplace jasa lokal", stack: "" };

  it("memuat fase Brainstorm → Objective → Doc index berurutan + instruksi phase file", () => {
    const p = startScaffoldPrompt(project, "scaffold-docs");
    expect(PIPELINES.scaffold).toEqual(["Brainstorm", "Objective", "Doc index"]);
    for (const ph of PIPELINES.scaffold) expect(p).toContain(ph);
    expect(p.indexOf("Brainstorm")).toBeLessThan(p.indexOf("Doc index"));
    expect(p).toContain("$HANOMAN_PHASE_FILE");
  });

  it("membawa STANDAR DOCS lengkap (kategori, ADR, EARS, index, hook)", () => {
    const p = startScaffoldPrompt(project, "scaffold-docs");
    for (const t of ["STANDAR DOCS", "internal/docs/", "ADR-NNNN", "Event-driven",
      "ensure-docs-updated.py", "Reading Order"]) expect(p).toContain(t);
  });

  it("brainstorm interaktif satu pertanyaan per giliran, diseed dari ide, dilarang mengarang", () => {
    const p = startScaffoldPrompt(project, "scaffold-docs");
    expect(p).toContain("SATU pertanyaan");
    expect(p).toContain("Jangan mengarang");
    expect(p).toContain("marketplace jasa lokal"); // ide (desc) ikut menyeed
  });

  it("pipeline TANPA fase Scan (bukan reverse) dan prompt TANPA klausa otonomi", () => {
    // Scan tak boleh jadi fase scaffold; kata "Scan" boleh muncul di STANDAR DOCS bawaan
    // (petunjuk Stop hook), jadi asersi pada pipeline & baris fase, bukan seluruh string.
    expect(PIPELINES.scaffold).not.toContain("Scan");
    const p = startScaffoldPrompt(project, "scaffold-docs");
    expect(p).toContain("Kerjakan fase berurutan: Brainstorm → Objective → Doc index");
    expect(p).not.toContain("tanpa berhenti di batas antar-fase");
  });

  it("commit+push per fase ke branch scaffold-docs dengan fallback tanpa origin, tanpa 'undefined'", () => {
    const p = startScaffoldPrompt(project, "scaffold-docs");
    expect(p).toContain("refs/heads/scaffold-docs");
    expect(p).toContain("origin tidak ada");
    expect(p).toContain("Kirana");
    expect(p).not.toContain("undefined");
  });

  it("tanpa klausa penyelesaian plan (tak ada fase Plan+Execute)", () => {
    expect(startScaffoldPrompt(project, "scaffold-docs")).not.toContain("Execute BELUM selesai");
  });
});

// SPEC-238 · ADR-0057 — model & effort per fase
describe("resolvePhaseModels + prompt per-fase", () => {
  const fb = { model: "claude-opus-4-8", effort: "xhigh" };
  it("launch = fallback bila fase pertama tak punya override; sel kosong fallback", () => {
    const r = resolvePhaseModels("feature", { Spec: { model: "claude-sonnet-5" } }, fb);
    expect(r.launch).toEqual({ model: "claude-opus-4-8", effort: "xhigh" });
    const specRow = r.perPhase.find((p) => p.phase === "Spec")!;
    expect(specRow.model).toBe("claude-sonnet-5");
    expect(specRow.effort).toBe("xhigh"); // effort kosong → fallback
  });
  it("launch memakai override fase pertama bila ada", () => {
    const r = resolvePhaseModels("feature", { Brainstorm: { model: "claude-sonnet-5", effort: "high" } }, fb);
    expect(r.launch).toEqual({ model: "claude-sonnet-5", effort: "high" });
  });
  it("prompt seragam (tanpa override) TAK memuat blok per-fase", () => {
    const { perPhase } = resolvePhaseModels("feature", {}, fb);
    const p = startPrompt("feature", spec, "b", perPhase);
    expect(p).not.toContain("Model & effort per fase");
    expect(p).not.toContain("/model claude");
  });
  it("prompt dengan variasi memuat baris /model + /effort tiap fase", () => {
    const { perPhase } = resolvePhaseModels("feature", { Execute: { effort: "max" } }, fb);
    const p = startPrompt("feature", spec, "b", perPhase);
    expect(p).toContain("Model & effort per fase");
    expect(p).toContain("/effort max");
    expect(p).toContain("/model claude-opus-4-8");
  });
  it("startPrompt tanpa arg perPhase tak berubah (backward-compatible)", () => {
    const p = startPrompt("feature", spec, "b");
    expect(p).not.toContain("Model & effort per fase");
  });
});
