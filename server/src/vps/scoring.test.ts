import { describe, it, expect } from "vitest";
import { scoreCompliance } from "./scoring";
import type { CatalogItem } from "./catalog/catalog";

// Katalog kecil suntikan → matematika skor bisa diuji persis, lepas dari 232 item nyata.
const item = (id: string, section: string, mode: CatalogItem["mode"]): CatalogItem => ({
  id, section, sectionTitle: section, level: "Basic", title: id,
  mode, severity: "high", probe: mode !== "INFO", remediable: false, appLayer: false,
});
const MINI: CatalogItem[] = [
  item("a", "s1", "AUTO"),   // probed
  item("b", "s1", "AUDIT"),  // probed
  item("c", "s2", "INFO"),   // attestasi
  item("d", "s2", "INFO"),   // attestasi
];

describe("scoreCompliance (SPEC-220 AC-6)", () => {
  it("skor = (pass + attested) / applicable, per-seksi & total", () => {
    const s = scoreCompliance({ a: "pass", b: "fail" }, { c: { attested: true } }, MINI);
    // applicable = 4 (tak ada N/A); terpenuhi = a(pass) + c(attested) = 2 → 50%
    expect(s.total).toBe(50);
    expect(s.bySection.s1).toBe(50); // a pass, b fail
    expect(s.bySection.s2).toBe(50); // c attested, d belum
  });

  it("N/A keluar dari pembilang & penyebut (AC-10)", () => {
    // b di-N/A → applicable=3, terpenuhi a(pass)+c(attested)=2 → 67%
    const s = scoreCompliance({ a: "pass", b: "fail" }, { b: { na: true }, c: { attested: true } }, MINI);
    expect(s.status.b).toBe("na");
    expect(s.total).toBe(67);
  });

  it("INFO tanpa attest tak dihitung; attest menaikkan skor (AC-11)", () => {
    const before = scoreCompliance({}, {}, MINI).total;
    const after = scoreCompliance({}, { c: { attested: true }, d: { attested: true } }, MINI).total;
    expect(after).toBeGreaterThan(before);
    expect(scoreCompliance({}, { c: { attested: true } }, MINI).status.c).toBe("pass");
  });

  it("probe unknown ≠ pass (AC-7)", () => {
    const s = scoreCompliance({ a: "unknown" }, {}, MINI);
    expect(s.status.a).toBe("unknown");
    // a unknown, sisanya belum → 0%
    expect(s.total).toBe(0);
  });

  it("warn applicable tapi tak terpenuhi", () => {
    const s = scoreCompliance({ a: "warn" }, {}, MINI);
    expect(s.status.a).toBe("warn");
    expect(s.total).toBe(0);
  });

  it("bekerja atas katalog nyata 232 item tanpa error", () => {
    const s = scoreCompliance({ "fw-b1": "pass" }, {});
    expect(s.total).toBeGreaterThanOrEqual(0);
    expect(s.total).toBeLessThanOrEqual(100);
    expect(s.status["fw-b1"]).toBe("pass");
  });
});
