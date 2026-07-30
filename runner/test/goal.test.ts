import { describe, it, expect } from "vitest";
import {
  GOAL_MAX, GOAL_CHUNK, GOAL_TUI_PASTE_LIMIT,
  defaultGoalCondition, resolveGoalCondition, goalOneLine, goalChunks,
} from "../src/goal";

const args = { flow: "feature" as const, specId: "SPEC-332", branchTo: "hanoman/spec-332" };

describe("goal condition", () => {
  it("default memuat identitas backlog, seluruh fase, gate plan, dan push", () => {
    const c = defaultGoalCondition(args);
    expect(c).toContain("SPEC-332");
    expect(c).toContain("Brainstorm → Objective → Spec → Plan → Execute");
    expect(c).toContain('cat "$HANOMAN_PHASE_FILE"');
    expect(c).toContain("docs/superpowers/plans/");
    expect(c).toContain("git push origin HEAD:refs/heads/hanoman/spec-332");
    expect(c.length).toBeLessThanOrEqual(GOAL_MAX);
  });

  it("flow tanpa Plan+Execute tak membawa gate plan", () => {
    const c = defaultGoalCondition({ ...args, flow: "audit" });
    expect(c).toContain("Audit → Laporan");
    expect(c).not.toContain("docs/superpowers/plans/");
    expect(c).toContain("git push");
  });

  it("resolve: override menang atas template, template menang atas default", () => {
    expect(resolveGoalCondition(args, "pakai ini", "template")).toBe("pakai ini");
    expect(resolveGoalCondition(args, "  ", "template")).toBe("template");
    expect(resolveGoalCondition(args, undefined, "")).toBe(defaultGoalCondition(args));
    expect(resolveGoalCondition(args, null, null)).toBe(defaultGoalCondition(args));
  });

  it("resolve memangkas kondisi di atas batas Claude Code", () => {
    expect(resolveGoalCondition(args, "x".repeat(GOAL_MAX + 500)).length).toBe(GOAL_MAX);
  });

  it("goalOneLine meratakan baris (Enter di tmux = submit)", () => {
    expect(goalOneLine("baris satu\n  baris dua\n\nbaris tiga ")).toBe("baris satu baris dua baris tiga");
  });
});

// SPEC-397 · ADR-0085 — TUI codex mengubah masukan yang datang dalam SATU burst ≥ 1024 karakter
// menjadi lampiran `[Pasted Content N chars]`, dan begitu itu terjadi slash-dispatch tak jalan:
// `/goal` terkirim sebagai pesan chat biasa, tanpa error dan tanpa goal.
describe("goalChunks", () => {
  it("merekonstruksi kondisi utuh tanpa kehilangan atau menambah karakter", () => {
    const line = goalOneLine(defaultGoalCondition(args));
    expect(goalChunks(line).join("")).toBe(line);
  });

  it("tak ada potongan yang mencapai batas paste, bahkan untuk kondisi GOAL_MAX", () => {
    const chunks = goalChunks("x".repeat(GOAL_MAX));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThan(GOAL_TUI_PASTE_LIMIT);
  });

  it("dua potongan bersebelahan yang menyatu pun masih di bawah batas (margin sengaja)", () => {
    // Ditulis dengan kursor `prev`, bukan indeks: `chunks[i - 1]` bertipe `string | undefined` di
    // bawah TS strict, dan menutupinya dengan `?? ""` justru akan menyembunyikan potongan kosong.
    let prev: string | undefined;
    for (const cur of goalChunks("y".repeat(GOAL_MAX))) {
      if (prev !== undefined) {
        expect(prev.length + cur.length).toBeLessThan(GOAL_TUI_PASTE_LIMIT);
      }
      prev = cur;
    }
  });

  it("kondisi pendek tetap satu potongan (tak ada invokasi send-keys sia-sia)", () => {
    expect(goalChunks("kondisi pendek")).toEqual(["kondisi pendek"]);
  });

  it("string kosong tak menghasilkan potongan", () => {
    expect(goalChunks("")).toEqual([]);
  });

  it("GOAL_CHUNK punya margin terhadap batas paste", () => {
    expect(GOAL_CHUNK * 2).toBeLessThan(GOAL_TUI_PASTE_LIMIT);
  });
});
