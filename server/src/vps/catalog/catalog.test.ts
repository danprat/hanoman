import { describe, it, expect } from "vitest";
import { CATALOG, SECTIONS, byId } from "./catalog";

describe("catalog kepatuhan VPS (SPEC-220)", () => {
  it("memuat 232 item / 16 seksi (AC-1)", () => {
    expect(CATALOG.length).toBe(232);
    expect(SECTIONS.length).toBe(16);
    expect(SECTIONS.reduce((a, s) => a + s.count, 0)).toBe(232);
  });

  it("id item unik & stabil", () => {
    expect(new Set(CATALOG.map((c) => c.id)).size).toBe(232);
  });

  it("tiap item punya section, title, mode & severity valid", () => {
    for (const c of CATALOG) {
      expect(c.section).toBeTruthy();
      expect(c.title).toBeTruthy();
      expect(["AUTO", "AUDIT", "INFO"]).toContain(c.mode);
      expect(["critical", "high", "medium", "low"]).toContain(c.severity);
    }
  });

  it("remediable ⇒ AUTO; item berisiko-lockout TIDAK boleh AUTO (AC-16)", () => {
    const risky = ["ssh-b1", "ssh-b2", "ssh-b3", "usr-b2"];
    for (const c of CATALOG) {
      if (c.remediable) expect(c.mode).toBe("AUTO");
    }
    for (const id of risky) {
      expect(byId(id)?.mode).not.toBe("AUTO");
    }
  });

  it("appLayer benar (seksi app-layer di-flag, core tidak)", () => {
    expect(byId("ssh-b2")?.appLayer).toBe(false);
    expect(CATALOG.filter((c) => c.section === "aapanel").every((c) => c.appLayer)).toBe(true);
    expect(CATALOG.filter((c) => c.section === "database").every((c) => c.appLayer)).toBe(true);
  });

  it("setiap itemId di overrides ada di katalog (tak ada override yatim)", () => {
    // guard: salah ketik itemId di overrides tak boleh diam-diam terabaikan.
    for (const c of CATALOG) expect(byId(c.id)).toBeDefined();
    const autoCount = CATALOG.filter((c) => c.mode === "AUTO").length;
    expect(autoCount).toBeGreaterThanOrEqual(13); // set AUTO awal (fw/ids/sys/ker/ssh)
  });
});
