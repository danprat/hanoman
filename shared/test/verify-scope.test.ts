import { describe, it, expect } from "vitest";
import { zVerifyScope, VERIFY_SCOPES, zSetting, zTerminalSession } from "../src";

// Baris Setting yang lengkap menurut zSetting (autoDefault/autoScaffold/notifyFail tak punya
// .default(), jadi objek parsial gagal parse dan bukan itu yang sedang diuji di sini).
const base = {
  model: "claude-opus-5", effort: "xhigh",
  autoDefault: true, autoScaffold: true, notifyFail: true,
};

describe("verifyScope", () => {
  it("kosakatanya persis changed|full", () => {
    expect(VERIFY_SCOPES).toEqual(["changed", "full"]);
    expect(zVerifyScope.safeParse("changed").success).toBe(true);
    expect(zVerifyScope.safeParse("full").success).toBe(true);
    expect(zVerifyScope.safeParse("sebagian").success).toBe(false);
  });

  // SPEC-376 · baris Setting yang ditulis SEBELUM spec ini tak punya kunci ini sama sekali.
  // Tanpa .default() ia gagal parse dan getSetting diam-diam jatuh ke DEFAULT_SETTING.
  it("baris Setting lama tanpa verifyScope tetap parse dan default ke changed", () => {
    const parsed = zSetting.parse(base);
    expect(parsed.verifyScope).toBe("changed");
  });

  it("nilai eksplisit di Setting dipertahankan", () => {
    expect(zSetting.parse({ ...base, verifyScope: "full" }).verifyScope).toBe("full");
    expect(zSetting.safeParse({ ...base, verifyScope: "sebagian" }).success).toBe(false);
  });

  it("body sesi backlog menerima verifyScope opsional dan menolak nilai asing", () => {
    const ok = zTerminalSession.safeParse({ spec: "SPEC-376", flow: "feature", verifyScope: "full" });
    expect(ok.success).toBe(true);
    const tanpa = zTerminalSession.safeParse({ spec: "SPEC-376", flow: "feature" });
    expect(tanpa.success).toBe(true);
    const salah = zTerminalSession.safeParse({ spec: "SPEC-376", flow: "feature", verifyScope: "semua" });
    expect(salah.success).toBe(false);
  });
});
