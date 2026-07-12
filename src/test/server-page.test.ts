import { describe, it, expect } from "vitest";
import { serverPage } from "../src/ds/kit";

// SPEC-198 · metadata Pager dari total server (bukan slice client).
describe("serverPage", () => {
  it("kosong → satu halaman, from/to 0", () => {
    expect(serverPage(0, 1, 20)).toEqual({ page: 1, pageCount: 1, from: 0, to: 0 });
  });
  it("halaman terakhir parsial", () => {
    expect(serverPage(45, 3, 20)).toEqual({ page: 3, pageCount: 3, from: 41, to: 45 });
  });
  it("page di luar rentang di-clamp ke pageCount", () => {
    expect(serverPage(45, 9, 20)).toEqual({ page: 3, pageCount: 3, from: 41, to: 45 });
  });
});
