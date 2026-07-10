import { describe, it, expect } from "vitest";
import { zRunStatus, isRunActive, zAsk, zAnswer, zSetting, paths } from "../src/index";

describe("SPEC-157 · kontrak awaiting", () => {
  it("awaiting adalah status run yang sah", () =>
    expect(zRunStatus.safeParse("awaiting").success).toBe(true));

  // `awaiting` = proses claude hidup. Gate poll harus terus menariknya, dan daftar run
  // tidak boleh membeku sampai operator refresh manual.
  it("awaiting terhitung aktif", () => expect(isRunActive("awaiting")).toBe(true));
  it("status terminal tetap tidak aktif", () => {
    for (const s of ["done", "failed", "stopped"]) expect(isRunActive(s)).toBe(false);
  });

  it("zAsk menolak opsi kurang dari dua", () =>
    expect(zAsk.safeParse({ question: "q", options: [{ value: "a", label: "A" }], default: "a" }).success).toBe(false));

  it("zAsk menerima ask yang sah", () =>
    expect(zAsk.safeParse({ question: "q", options: [{ value: "a", label: "A" }, { value: "b", label: "B", detail: "d" }], default: "a" }).success).toBe(true));

  it("zAnswer menolak value kosong", () => expect(zAnswer.safeParse({ value: "" }).success).toBe(false));

  it("askTimeoutMin default 30 menit dan menerima 0", () => {
    const step = { model: "m", effort: "e" };
    const base = { steps: { brainstorm: step, spec: step, plan: step, execute: step, audit: step },
      autoDefault: true, blockStale: true, requireLinks: true, autoScaffold: true, maxConcurrent: 3, notifyFail: true };
    expect(zSetting.parse(base).askTimeoutMin).toBe(30);
    expect(zSetting.parse({ ...base, askTimeoutMin: 0 }).askTimeoutMin).toBe(0);
    expect(zSetting.safeParse({ ...base, askTimeoutMin: -1 }).success).toBe(false);
  });

  it("paths.runAnswer", () => expect(paths.runAnswer("RUN-1")).toBe("/api/runs/RUN-1/answer"));
});
