import { describe, it, expect } from "vitest";
import { updateHeadline, updateBadgeLabel, updateVersionLine } from "../src/api/update";
import type { UpdateStatus } from "@hanoman/shared";

const mk = (o: Partial<UpdateStatus>): UpdateStatus => ({
  currentVersion: "0.1.0", latestVersion: "0.1.0",
  registry: { status: "ok", checkedAt: null }, updateAvailable: false, command: "", ...o,
});

describe("updateHeadline", () => {
  it("up-to-date", () => expect(updateHeadline(mk({}))).toMatch(/terbaru/));
  it("ada update → menyebut versi terbaru & restart", () =>
    expect(updateHeadline(mk({ updateAvailable: true, latestVersion: "0.4.2" }))).toMatch(/0\.4\.2.*restart/));
});

describe("updateBadgeLabel", () => {
  it("menyebut versi terbaru", () =>
    expect(updateBadgeLabel(mk({ updateAvailable: true, latestVersion: "0.4.2" }))).toBe("Update · 0.4.2"));
  it("versi terbaru tak terbaca → 'Update' saja", () =>
    expect(updateBadgeLabel(mk({ updateAvailable: true, latestVersion: null }))).toBe("Update"));
});

describe("updateVersionLine", () => {
  it("terpasang → tersedia", () =>
    expect(updateVersionLine(mk({ currentVersion: "0.1.0", latestVersion: "0.2.0" })))
      .toBe("terpasang 0.1.0 · tersedia 0.2.0"));
  it("versi kosong jadi '?', bukan string kosong yang membingungkan", () =>
    expect(updateVersionLine(mk({ currentVersion: "", latestVersion: null })))
      .toBe("terpasang ? · tersedia ?"));
});
