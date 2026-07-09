import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { collectViolations } from "../src/verify";
import { makeRepo } from "./_fixture";
describe("collectViolations", () => {
  it("clean repo -> no violations", async () => {
    const { root } = await makeRepo({
      index: "- [stack](architecture/stack.md)\n", docs: { "architecture/stack.md": "x" } });
    expect(collectViolations(root).violations).toEqual([]);
  });
  it("unlinked doc -> unlinked violation", async () => {
    const { root } = await makeRepo({
      index: "- [stack](architecture/stack.md)\n",
      docs: { "architecture/stack.md": "x", "architecture/nfr.md": "y" } });
    const v = collectViolations(root).violations;
    expect(v.some((x) => x.kind === "unlinked" && x.reason.includes("architecture/nfr.md"))).toBe(true);
  });
  it("src change without docs -> freshness violation", async () => {
    const { root } = await makeRepo({
      index: "- [stack](architecture/stack.md)\n", docs: { "architecture/stack.md": "x" } });
    mkdirSync(join(root, "src"), { recursive: true }); writeFileSync(join(root, "src/a.ts"), "z");
    expect(collectViolations(root).violations.some((x) => x.kind === "freshness")).toBe(true);
  });
  // Stop hook menerima cwd sesi, yang bisa sudah pindah ke subdir (mis. `cd src`).
  it("runs from a subdirectory, not just the repo root", async () => {
    const { root } = await makeRepo({
      index: "- [stack](architecture/stack.md)\n", docs: { "architecture/stack.md": "x" } });
    mkdirSync(join(root, "src"), { recursive: true });
    expect(collectViolations(join(root, "src")).violations).toEqual([]);
  });
  // Index root menunjuk sub-index; sub-index menunjuk doc. Reachability transitif.
  it("counts a doc reachable only through a sub-index", async () => {
    const { root } = await makeRepo({
      index: "- [adr](adr/README.md)\n",
      docs: { "adr/README.md": "- [0001](0001-x.md)\n", "adr/0001-x.md": "x" } });
    const r = collectViolations(root);
    expect(r.violations).toEqual([]);
    expect(r.coverage).toBe(100);
  });
  // `linkedSetFrom` menelan error baca, jadi tanpa guard eksplisit index yang hilang
  // akan diam-diam terbaca "semua doc unlinked" alih-alih crash (ADR-0009).
  it("throws when the index is missing instead of reporting everything unlinked", async () => {
    const { root } = await makeRepo({ docs: { "architecture/stack.md": "x" } });
    rmSync(join(root, "internal/docs/README.md"));
    expect(() => collectViolations(root)).toThrow(/index Source of Truth tidak ada/);
  });
  // RUN-90004: run di repo target tanpa `internal/docs` (kirimchat-multi) → walkDocs ENOENT,
  // guardrail crash, run failed. Tidak ada docs bukan pelanggaran.
  it("repo without a docs dir at all -> clean, not a crash", async () => {
    const { root } = await makeRepo({
      files: { "hanoman.config.json": JSON.stringify({ coverageThreshold: 80 }) } });
    rmSync(join(root, "internal/docs"), { recursive: true });
    mkdirSync(join(root, "src"), { recursive: true }); writeFileSync(join(root, "src/a.ts"), "z");
    expect(collectViolations(root).violations).toEqual([]);
  });
  it("coverage below threshold -> coverage violation", async () => {
    const { root } = await makeRepo({
      files: { "hanoman.config.json": JSON.stringify({ requireLinks: false, coverageThreshold: 100 }) },
      index: "- [stack](architecture/stack.md)\n",
      docs: { "architecture/stack.md": "x", "product/blueprint.md": "y" } }); // product unlinked -> 50%
    expect(collectViolations(root).violations.some((x) => x.kind === "coverage")).toBe(true);
  });
});
