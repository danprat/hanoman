import { describe, expect, it } from "vitest";
import { CONFIG_REGISTRY } from "../src/config-registry";

// SPEC-490 · entri config baru wajib membawa contoh nilainya. `bootstrap` read-only (tak
// ada kolom yang diketik) dan `bool` dirender sebagai Switch — keduanya tak punya placeholder.
const needsExample = CONFIG_REGISTRY.filter((e) => e.category !== "bootstrap" && e.kind !== "bool");

describe("CONFIG_REGISTRY.example", () => {
  it("ada untuk setiap entri yang punya kolom ketik", () => {
    expect(needsExample.filter((e) => !e.example?.trim()).map((e) => e.key)).toEqual([]);
  });

  it("bukan pengulangan labelnya", () => {
    const echo = needsExample.filter((e) =>
      e.example!.trim().toLowerCase() === e.label.trim().toLowerCase());
    expect(echo.map((e) => e.key)).toEqual([]);
  });

  it("memindai entri, bukan daftar kosong", () => {
    expect(needsExample.length).toBeGreaterThan(15);
  });
});
