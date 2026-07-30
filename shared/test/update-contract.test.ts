import { describe, it, expect } from "vitest";
import { UPDATE_RESTART_EXIT, zUpdateApplyBody } from "../src/dto";

describe("kontrak update apply (SPEC-405 · ADR-0088)", () => {
  it("kode keluar sentinel = 75 (EX_TEMPFAIL), non-zero", () => {
    expect(UPDATE_RESTART_EXIT).toBe(75);
    expect(UPDATE_RESTART_EXIT).not.toBe(0);
  });
  it("body kosong sah — confirm opsional", () => {
    expect(zUpdateApplyBody.parse({})).toEqual({});
  });
  it("confirm boolean diterima", () => {
    expect(zUpdateApplyBody.parse({ confirm: true })).toEqual({ confirm: true });
  });
  it("confirm bukan boolean ditolak — 'ya' tak boleh dibaca sebagai persetujuan", () => {
    expect(zUpdateApplyBody.safeParse({ confirm: "ya" }).success).toBe(false);
  });
  it("field tak dikenal dibuang, bukan menggagalkan (konvensi payload repo)", () => {
    expect(zUpdateApplyBody.parse({ confirm: false, wat: 1 })).toEqual({ confirm: false });
  });
});
