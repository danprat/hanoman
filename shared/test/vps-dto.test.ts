import { describe, it, expect } from "vitest";
import { zCreateVps, zPatchVps } from "../src/dto";

describe("vps dto (SPEC-164)", () => {
  it("create: port default 22, keyPath opsional", () => {
    const v = zCreateVps.parse({ name: "web-1", host: "203.0.113.10", user: "deploy" });
    expect(v.port).toBe(22);
    expect(v.keyPath).toBeUndefined();
  });
  it("host/user dengan metakarakter shell ditolak — argv ssh adalah trust boundary", () => {
    expect(zCreateVps.safeParse({ name: "x", host: "h; rm -rf /", user: "deploy" }).success).toBe(false);
    expect(zCreateVps.safeParse({ name: "x", host: "203.0.113.10", user: "de ploy" }).success).toBe(false);
  });
  it("patch parsial tidak menyuntik port default", () => {
    const p = zPatchVps.parse({ name: "baru" });
    expect("port" in p && p.port !== undefined).toBe(false);
  });
});
