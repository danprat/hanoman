import { describe, it, expect } from "vitest";
import { zFlow, zBreakdownItem, zBatchCreateSpec, paths } from "../src";

describe("SPEC-273 breakdown schemas", () => {
  it("zFlow menerima 'breakdown'", () => {
    expect(zFlow.safeParse("breakdown").success).toBe(true);
  });
  it("zBreakdownItem: default context/outcome/priority", () => {
    const p = zBreakdownItem.parse({ title: "Endpoint upload" });
    expect(p).toEqual({ title: "Endpoint upload", context: "", outcome: "", priority: "sedang" });
  });
  it("zBreakdownItem menolak title kosong", () => {
    expect(zBreakdownItem.safeParse({ title: "" }).success).toBe(false);
  });
  it("zBatchCreateSpec butuh minimal 1 item", () => {
    expect(zBatchCreateSpec.safeParse({ project: "p1", items: [] }).success).toBe(false);
    const ok = zBatchCreateSpec.safeParse({ project: "p1", items: [{ title: "A" }] });
    expect(ok.success).toBe(true);
  });
  it("paths: breakdown meng-encode prd, specsBatch statis", () => {
    expect(paths.breakdown("p1", "docs/prd/x.md")).toBe("/api/projects/p1/breakdown?prd=docs%2Fprd%2Fx.md");
    expect(paths.specsBatch).toBe("/api/specs/batch");
  });
});
