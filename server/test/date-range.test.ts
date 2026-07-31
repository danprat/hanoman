import { describe, it, expect } from "vitest";
import { dayStart, dayEnd, inDayRange } from "../src/services/date-range";

// SPEC-408 · ADR-0090 · jebakan yang dijaga berkas ini: `new Date("2026-07-31")` adalah tengah
// malam UTC, bukan lokal. Dipakai apa adanya sebagai batas `to`, ia membuang hampir seluruh
// hari 31 Juli untuk operator di WIB (UTC+7). Karena itu parsing dilakukan komponen-per-komponen.
describe("date-range (SPEC-408)", () => {
  it("dayStart = tengah malam LOKAL, bukan UTC", () => {
    const d = dayStart("2026-07-31")!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(31);
    expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([0, 0, 0, 0]);
  });

  it("dayEnd = akhir hari LOKAL (inklusif sampai 23:59:59.999)", () => {
    const d = dayEnd("2026-07-31")!;
    expect(d.getDate()).toBe(31);
    expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([23, 59, 59, 999]);
  });

  it("string bukan tanggal → null (filter mati, bukan 400)", () => {
    for (const bad of [undefined, "", "kemarin", "2026-07", "31-07-2026", "2026-7-1"])
      expect(dayStart(bad)).toBeNull();
  });

  it("tanggal yang tak ada ditolak, bukan digulirkan diam-diam", () => {
    expect(dayStart("2026-13-01")).toBeNull();   // bulan 13
    expect(dayStart("2026-02-30")).toBeNull();   // 30 Februari
  });

  it("inDayRange inklusif di KEDUA ujung", () => {
    const from = dayStart("2026-07-01"), to = dayEnd("2026-07-31");
    expect(inDayRange(new Date(2026, 6, 1, 0, 0, 0, 0), from, to)).toBe(true);
    expect(inDayRange(new Date(2026, 6, 31, 23, 59, 59, 999), from, to)).toBe(true);
    expect(inDayRange(new Date(2026, 5, 30, 23, 59, 59, 999), from, to)).toBe(false);
    expect(inDayRange(new Date(2026, 7, 1, 0, 0, 0, 0), from, to)).toBe(false);
  });

  it("batas terbuka: hanya from, atau hanya to", () => {
    expect(inDayRange(new Date(2026, 6, 15), dayStart("2026-07-01"), null)).toBe(true);
    expect(inDayRange(new Date(2026, 5, 15), dayStart("2026-07-01"), null)).toBe(false);
    expect(inDayRange(new Date(2026, 6, 15), null, dayEnd("2026-07-31"))).toBe(true);
    expect(inDayRange(new Date(2026, 7, 15), null, dayEnd("2026-07-31"))).toBe(false);
  });

  it("tanggal null lolos hanya saat tak ada rentang aktif", () => {
    expect(inDayRange(null, null, null)).toBe(true);
    expect(inDayRange(null, dayStart("2026-07-01"), null)).toBe(false);
    expect(inDayRange(null, null, dayEnd("2026-07-31"))).toBe(false);
  });
});
