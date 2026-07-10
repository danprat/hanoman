import { describe, it, expect } from "vitest";
import {
  emptyLayout, addRow, addColumn, removeRow, removeColumn, setCell, placeFirstEmpty, reconcile,
} from "../src/screens/terminal-layout";

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

  it("removeRow memotong baris yang ditunjuk & tak menggeser sel lain", () => {
    // baris0=[a,b], baris1=[c,d] → buang baris 0
    expect(removeRow({ rows: 2, cols: 2, cells: ["a", "b", "c", "d"] }, 0))
      .toEqual({ rows: 1, cols: 2, cells: ["c", "d"] });
  });

  it("removeRow pada rows===1 → layout apa adanya (grid tak boleh nol baris)", () => {
    const l = { rows: 1, cols: 2, cells: ["a", "b"] };
    expect(removeRow(l, 0)).toBe(l);
  });

  it("removeRow index di luar rentang → layout apa adanya", () => {
    const l = { rows: 2, cols: 1, cells: ["a", "b"] };
    expect(removeRow(l, 2)).toBe(l);
    expect(removeRow(l, -1)).toBe(l);
  });

  it("removeColumn me-rebuild pemetaan baris-mayor (2×3 → 2×2, buang kolom tengah)", () => {
    // baris0=[a,b,c], baris1=[d,e,f] → buang kolom 1 → baris0=[a,c], baris1=[d,f]
    expect(removeColumn({ rows: 2, cols: 3, cells: ["a", "b", "c", "d", "e", "f"] }, 1))
      .toEqual({ rows: 2, cols: 2, cells: ["a", "c", "d", "f"] });
  });

  it("removeColumn pada cols===1 → layout apa adanya", () => {
    const l = { rows: 2, cols: 1, cells: ["a", "b"] };
    expect(removeColumn(l, 0)).toBe(l);
  });

  it("removeColumn index di luar rentang → layout apa adanya", () => {
    const l = { rows: 1, cols: 2, cells: ["a", "b"] };
    expect(removeColumn(l, 2)).toBe(l);
    expect(removeColumn(l, -1)).toBe(l);
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
});
