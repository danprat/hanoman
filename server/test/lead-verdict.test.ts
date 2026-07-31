import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractJsonBlock, parseLeadVerdict, keepExistingRefs, isNonFileRef } from "../src/services/lead/verdict";

// SPEC-409 · ADR-0091 · membaca keluaran lead + menyaring rujukan (AC-1/AC-6).

describe("extractJsonBlock", () => {
  it("takes the LAST fenced block — agen kerap menulis contoh bentuk lebih dulu", () => {
    const raw = [
      "Bentuknya begini:", "```json", '{"decision":"CONTOH"}', "```",
      "Keputusan saya:", "```json", '{"decision":"ASLI"}', "```",
    ].join("\n");
    expect(extractJsonBlock(raw)).toContain("ASLI");
    expect(extractJsonBlock(raw)).not.toContain("CONTOH");
  });
  it("accepts a bare JSON object (mode -p sering begitu)", () => {
    expect(extractJsonBlock('  {"decision":"x"}  ')).toBe('{"decision":"x"}');
  });
  it("returns null for prose without any block", () => {
    expect(extractJsonBlock("saya tidak yakin, tolong putuskan sendiri")).toBeNull();
  });
});

describe("parseLeadVerdict", () => {
  it("parses a well-formed verdict", () => {
    const v = parseLeadVerdict('```json\n{"decision":"opsi 1","reason":"ADR-0029","confidence":"ragu","action":"resume-session"}\n```');
    expect(v).toMatchObject({ decision: "opsi 1", confidence: "ragu", action: "resume-session" });
  });
  it("returns null (bukan melempar) untuk json rusak", () => {
    expect(parseLeadVerdict("```json\n{not json\n```")).toBeNull();
  });
  it("returns null when the block is valid JSON but the wrong shape", () => {
    expect(parseLeadVerdict('```json\n{"jawaban":"ya"}\n```')).toBeNull();
  });
});

describe("keepExistingRefs (AC-6)", () => {
  let repo: string;
  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "hanoman-refs-"));
    mkdirSync(join(repo, "internal", "docs"), { recursive: true });
    writeFileSync(join(repo, "internal", "docs", "README.md"), "# index");
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it("keeps a path that really exists and drops one that does not", () => {
    expect(keepExistingRefs(["internal/docs/README.md", "internal/docs/KARANGAN.md"], repo))
      .toEqual(["internal/docs/README.md"]);
  });
  it("keeps ADR numbers and commit shas without touching the filesystem", () => {
    expect(isNonFileRef("ADR-0091")).toBe(true);
    expect(isNonFileRef("d64573c")).toBe(true);
    expect(keepExistingRefs(["ADR-0091", "d64573c21c61d87748a1dc6e5a96ccf2fe3c828d"], null))
      .toEqual(["ADR-0091", "d64573c21c61d87748a1dc6e5a96ccf2fe3c828d"]);
  });
  // Rujukan adalah alamat DI DALAM repo. Membiarkan path absolut / `..` lolos berarti jejak
  // keputusan — yang dibaca operator sebagai bukti — bisa menunjuk berkas mana pun di mesinnya.
  it("refuses to escape the repo", () => {
    expect(keepExistingRefs(["/etc/passwd", "../../etc/passwd"], repo)).toEqual([]);
  });
  it("drops every file ref when the project has no checkout — nothing can be proven to exist", () => {
    expect(keepExistingRefs(["internal/docs/README.md"], null)).toEqual([]);
  });
  it("dedups while keeping order", () => {
    expect(keepExistingRefs(["ADR-0091", "internal/docs/README.md", "ADR-0091"], repo))
      .toEqual(["ADR-0091", "internal/docs/README.md"]);
  });
});
