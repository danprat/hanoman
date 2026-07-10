import { describe, it, expect, beforeEach } from "vitest";
import {
  emptyLayout, addRow, addColumn, setCell, placeFirstEmpty, reconcile, load, save,
} from "../src/screens/terminal-layout";

beforeEach(() => localStorage.clear());

describe("terminal-layout", () => {
  it("emptyLayout: 1×1 satu sel kosong", () => {
    expect(emptyLayout()).toEqual({ rows: 1, cols: 1, cells: [null] });
  });

  it("addRow meng-append cols sel & tak menggeser sel lama", () => {
    expect(addRow({ rows: 1, cols: 2, cells: ["a", "b"] }))
      .toEqual({ rows: 2, cols: 2, cells: ["a", "b", null, null] });
  });

  it("addColumn me-rebuild pemetaan baris-mayor (2×2 → 2×3)", () => {
    // baris0=[a,b], baris1=[c,d] → baris0=[a,b,null], baris1=[c,d,null]
    expect(addColumn({ rows: 2, cols: 2, cells: ["a", "b", "c", "d"] }))
      .toEqual({ rows: 2, cols: 3, cells: ["a", "b", null, "c", "d", null] });
  });

  it("setCell menegakkan satu sesi ≤ satu sel (pindah, bukan duplikat)", () => {
    expect(setCell({ rows: 1, cols: 2, cells: ["a", null] }, 1, "a").cells).toEqual([null, "a"]);
  });

  it("setCell idx di luar rentang → layout apa adanya", () => {
    const l = { rows: 1, cols: 1, cells: ["a"] };
    expect(setCell(l, -1, null)).toBe(l);
  });

  it("setCell dengan null hanya mengosongkan idx", () => {
    expect(setCell({ rows: 1, cols: 2, cells: ["a", "b"] }, 0, null).cells).toEqual([null, "b"]);
  });

  it("placeFirstEmpty menaruh di lubang pertama; penuh → no-op", () => {
    expect(placeFirstEmpty({ rows: 1, cols: 2, cells: ["a", null] }, "b").cells).toEqual(["a", "b"]);
    const full = { rows: 1, cols: 1, cells: ["a"] };
    expect(placeFirstEmpty(full, "b")).toBe(full);
  });

  it("reconcile mengosongkan sesi yang lenyap, mempertahankan yang hidup", () => {
    expect(reconcile({ rows: 1, cols: 2, cells: ["a", "b"] }, new Set(["a"])).cells).toEqual(["a", null]);
  });

  it("load/save round-trip lewat localStorage", () => {
    const l = { rows: 2, cols: 2, cells: ["a", null, null, "b"] };
    save(l);
    expect(load()).toEqual(l);
  });

  it("load tanpa data → null", () => {
    expect(load()).toBeNull();
  });
});
