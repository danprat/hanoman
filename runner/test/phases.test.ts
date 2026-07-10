import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDecision, readAsk, phasePrompt, DECISION_FILE, ASK_FILE, QA_PLANNING } from "../src/phases";
import type { RunInput } from "../src/types";

const wt = (content?: string) => {
  const dir = mkdtempSync(join(tmpdir(), "hanoman-dec-"));
  if (content !== undefined) writeFileSync(join(dir, DECISION_FILE), content);
  return dir;
};
const input = (): RunInput => ({ runId: "RUN-1", repoDir: "/repo", branchFrom: "main",
  branchTo: "feat/x", flow: "qa", steps: {} as any });

describe("readDecision (SPEC-145, fail-safe)", () => {
  it("takes the fast path only on an explicit execute", () =>
    expect(readDecision(wt('{"path":"execute","reason":"satu predikat"}')))
      .toEqual({ path: "execute", reason: "satu predikat" }));

  it("carries no reason when reason is absent or not a string", () =>
    expect(readDecision(wt('{"path":"execute","reason":42}'))).toEqual({ path: "execute" }));

  it("falls back to the full path when the file is absent", () =>
    expect(readDecision(wt())).toEqual({ path: "spec" }));

  it("falls back to the full path on malformed JSON", () =>
    expect(readDecision(wt("{not json"))).toEqual({ path: "spec" }));

  it("falls back to the full path on an explicit spec", () =>
    expect(readDecision(wt('{"path":"spec"}'))).toEqual({ path: "spec" }));

  // `none` belum ada. Kalau suatu saat ditambahkan, ia TIDAK boleh diam-diam mengeksekusi.
  it("falls back to the full path on an unknown path value", () =>
    expect(readDecision(wt('{"path":"none"}'))).toEqual({ path: "spec" }));

  it("falls back to the full path when the json is not an object", () =>
    expect(readDecision(wt('"execute"'))).toEqual({ path: "spec" }));
});

const askTree = (content?: string) => {
  const dir = mkdtempSync(join(tmpdir(), "hanoman-ask-"));
  if (content !== undefined) writeFileSync(join(dir, ASK_FILE), content);
  return dir;
};
const VALID = JSON.stringify({
  question: '"Orang" di sini siapa?',
  options: [
    { value: "pasien", label: "Pasien", detail: "Satu item katalog dibeli untuk >1 pasien." },
    { value: "pembayar", label: "Pembayar" },
  ],
  default: "pasien",
});

describe("readAsk (SPEC-157, fail-safe)", () => {
  it("membaca ask yang sah, lengkap dengan detail opsional", () => {
    expect(readAsk(askTree(VALID))).toEqual({
      question: '"Orang" di sini siapa?',
      options: [
        { value: "pasien", label: "Pasien", detail: "Satu item katalog dibeli untuk >1 pasien." },
        { value: "pembayar", label: "Pembayar" },
      ],
      default: "pasien",
    });
  });

  // Satu tulis = satu pertanyaan. Tanpa ini, fase berikutnya membaca ask yang sama lagi.
  it("mengonsumsi berkasnya, bahkan saat isinya rusak", () => {
    const ok = askTree(VALID);
    readAsk(ok);
    expect(existsSync(join(ok, ASK_FILE))).toBe(false);

    const bad = askTree("{not json");
    readAsk(bad);
    expect(existsSync(join(bad, ASK_FILE))).toBe(false);
  });

  it("null saat berkas absen", () => expect(readAsk(askTree())).toBeNull());
  it("null saat JSON rusak", () => expect(readAsk(askTree("{not json"))).toBeNull());
  it("null saat json bukan objek", () => expect(readAsk(askTree('"pasien"'))).toBeNull());

  it("null saat question kosong", () =>
    expect(readAsk(askTree(JSON.stringify({ question: "  ", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], default: "a" })))).toBeNull());

  it("null saat opsi kurang dari dua — pertanyaan satu pilihan bukan pertanyaan", () =>
    expect(readAsk(askTree(JSON.stringify({ question: "q", options: [{ value: "a", label: "A" }], default: "a" })))).toBeNull());

  it("null saat sebuah opsi tak punya value/label string", () =>
    expect(readAsk(askTree(JSON.stringify({ question: "q", options: [{ value: "a", label: "A" }, { value: 2, label: "B" }], default: "a" })))).toBeNull());

  // `default` adalah jawaban saat tak ada manusia. Kalau ia menunjuk ke luar menu,
  // tak ada yang bisa diterapkan saat timeout — jadi ask-nya batal seluruhnya.
  it("null saat default bukan salah satu option value", () =>
    expect(readAsk(askTree(JSON.stringify({ question: "q", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], default: "z" })))).toBeNull());

  it("null saat default bukan string", () =>
    expect(readAsk(askTree(JSON.stringify({ question: "q", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], default: 0 })))).toBeNull());

  it("membuang detail yang bukan string alih-alih menolak ask-nya", () => {
    const r = readAsk(askTree(JSON.stringify({ question: "q", options: [{ value: "a", label: "A", detail: 42 }, { value: "b", label: "B" }], default: "a" })));
    expect(r?.options[0]).toEqual({ value: "a", label: "A" });
  });
});

describe("phasePrompt · instruksi keputusan", () => {
  it("asks the qa Audit phase to write the decision file", () => {
    const p = phasePrompt("qa", "Audit", input());
    expect(p).toContain(DECISION_FILE);
    expect(p).toContain('"path":"execute"|"spec"');
  });

  it("asks no other qa phase for a decision", () => {
    for (const phase of [...QA_PLANNING, "Execute"])
      expect(phasePrompt("qa", phase, input())).not.toContain(DECISION_FILE);
  });

  it("asks no feature phase for a decision", () => {
    for (const phase of ["Brainstorm", "Objective", "Spec", "Plan", "Execute"])
      expect(phasePrompt("feature", phase, { ...input(), flow: "feature" })).not.toContain(DECISION_FILE);
  });

  it("meminta setiap fase menulis ask saat ragu, di semua flow", () => {
    for (const [flow, phases] of [
      ["feature", ["Brainstorm", "Objective", "Spec", "Plan", "Execute"]],
      ["qa", ["Audit", "Spec", "Plan", "Execute"]],
    ] as const)
      for (const phase of phases) {
        const p = phasePrompt(flow, phase, { ...input(), flow });
        expect(p).toContain(ASK_FILE);
        expect(p).toContain("JANGAN menebak");
      }
  });

  // Dua artefak, dua nama. Test di atas memastikan hanya qa/Audit yang diminta menulis DECISION_FILE.
  it("instruksi ask tidak mencemari instruksi decision", () => {
    expect(phasePrompt("feature", "Execute", input())).not.toContain(DECISION_FILE);
  });
});
