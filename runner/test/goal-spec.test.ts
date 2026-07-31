import { describe, it, expect } from "vitest";
import { readGoalPayload } from "../src/goal-spec";

// SPEC-407 · payload backlog goal datang dari kolom `Json` — bentuk apa pun bisa mendarat di
// sana, dan tak satu pun boleh membuat peluncuran sesi melempar.
describe("readGoalPayload (SPEC-407)", () => {
  it("membaca goal/done/constraints dan memangkas spasi", () => {
    expect(readGoalPayload({
      goal: "  p95 < 200 ms ", done: " benchmark ", constraints: " tanpa cache ", priority: "tinggi",
    })).toEqual({ goal: "p95 < 200 ms", done: "benchmark", constraints: "tanpa cache" });
  });

  it("field opsional yang hilang jadi string kosong", () => {
    expect(readGoalPayload({ goal: "g" })).toEqual({ goal: "g", done: "", constraints: "" });
  });

  it("bentuk yang tak sah → null, tanpa melempar", () => {
    expect(readGoalPayload(null)).toBeNull();
    expect(readGoalPayload(undefined)).toBeNull();
    expect(readGoalPayload("goal")).toBeNull();
    expect(readGoalPayload(42)).toBeNull();
    expect(readGoalPayload([{ goal: "g" }])).toBeNull();
    expect(readGoalPayload({ goal: 42 })).toBeNull();
    expect(readGoalPayload({ goal: "   " })).toBeNull();
  });

  // Payload brief/qa TIDAK boleh terbaca sebagai goal: itulah yang membedakan prompt goal dari
  // prompt pipeline, dan salah baca di sini menghasilkan "Goal: undefined".
  it("payload brief & qa → null", () => {
    expect(readGoalPayload({ context: "c", outcome: "o", constraints: "", priority: "tinggi" })).toBeNull();
    expect(readGoalPayload({ severity: "major", steps: "", expected: "", actual: "", env: "" })).toBeNull();
  });
});
