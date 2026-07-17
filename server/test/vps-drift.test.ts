import { describe, it, expect } from "vitest";
import { computeDrift } from "../src/vps/drift";

const S = (m: Record<string, string>) =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { status: v }]));

describe("computeDrift (SPEC-221 AC-19)", () => {
  it("pass→fail = drift", () => {
    expect(computeDrift(S({ a: "pass" }), S({ a: "fail" }))).toEqual([{ itemId: "a", from: "pass", to: "fail" }]);
  });
  it("pass→warn = drift", () => {
    expect(computeDrift(S({ a: "pass" }), S({ a: "warn" }))).toEqual([{ itemId: "a", from: "pass", to: "warn" }]);
  });
  it("pass→unknown BUKAN drift (transien)", () => {
    expect(computeDrift(S({ a: "pass" }), S({ a: "unknown" }))).toEqual([]);
  });
  it("fail→fail, pass→pass, item baru, item hilang: bukan drift", () => {
    expect(computeDrift(S({ a: "fail" }), S({ a: "fail" }))).toEqual([]);
    expect(computeDrift(S({ a: "pass" }), S({ a: "pass" }))).toEqual([]);
    expect(computeDrift(S({}), S({ a: "fail" }))).toEqual([]);        // tak ada di prev
    expect(computeDrift(S({ a: "pass" }), S({}))).toEqual([]);         // hilang di curr
  });
  it("banyak item: hanya yang regresi yang dikembalikan", () => {
    const d = computeDrift(S({ a: "pass", b: "pass", c: "fail" }), S({ a: "fail", b: "pass", c: "fail" }));
    expect(d).toEqual([{ itemId: "a", from: "pass", to: "fail" }]);
  });
});
