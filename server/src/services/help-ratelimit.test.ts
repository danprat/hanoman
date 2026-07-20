import { describe, it, expect, beforeEach } from "vitest";
import { helpRateOk, __resetHelpBuckets } from "./help-ratelimit";

describe("helpRateOk", () => {
  beforeEach(() => __resetHelpBuckets());
  it("membatasi per IP (bucket habis di menit yang sama)", () => {
    const t = 1_000_000;
    let ok = 0;
    for (let i = 0; i < 20; i++) if (helpRateOk("p1", "1.1.1.1", t)) ok++;
    expect(ok).toBeLessThan(20);
    expect(ok).toBeGreaterThan(0);
  });
  it("project berbeda + IP berbeda tak saling pengaruh", () => {
    const t = 1_000_000;
    for (let i = 0; i < 100; i++) helpRateOk("p1", "9.9.9.9", t);
    expect(helpRateOk("p2", "8.8.8.8", t)).toBe(true);
  });
  it("refill seiring waktu", () => {
    const t0 = 1_000_000;
    while (helpRateOk("p3", "2.2.2.2", t0)) { /* kuras bucket */ }
    expect(helpRateOk("p3", "2.2.2.2", t0)).toBe(false);
    // satu menit kemudian → terisi lagi
    expect(helpRateOk("p3", "2.2.2.2", t0 + 60_000)).toBe(true);
  });
});
