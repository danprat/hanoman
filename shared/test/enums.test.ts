import { describe, it, expect } from "vitest";
import { zSetting, zTerminalSession, paths } from "../src/index";

// SPEC-157 (`awaiting`, zAsk, zAnswer) dicabut bersama runner headless: agen bertanya di
// terminalnya sendiri, dan manusia menjawab di sana (SPEC-162).
describe("SPEC-162 · kontrak sesi interaktif", () => {
  it("zSetting memberi model + effort default", () => {
    const s = zSetting.parse({ autoDefault: true, autoScaffold: true, notifyFail: true });
    expect(s.model).toBe("claude-opus-4-8");
    expect(s.effort).toBe("xhigh");
  });

  it("zTerminalSession menerima sesi project maupun sesi backlog", () => {
    expect(zTerminalSession.safeParse({ project: "p1" }).success).toBe(true);
    expect(zTerminalSession.safeParse({ spec: "SPEC-1", flow: "feature" }).success).toBe(true);
  });

  // `flow` wajib: prompt awal tak bisa disusun tanpanya, dan default diam-diam akan
  // menjalankan pipeline yang salah untuk backlog item qa.
  it("zTerminalSession menolak spec tanpa flow, dan flow yang tak dikenal", () => {
    expect(zTerminalSession.safeParse({ spec: "SPEC-1" }).success).toBe(false);
    expect(zTerminalSession.safeParse({ spec: "SPEC-1", flow: "hantu" }).success).toBe(false);
  });

  it("paths.terminalPhases", () =>
    expect(paths.terminalPhases("spec-1")).toBe("/api/terminal/sessions/spec-1/phases"));
});
