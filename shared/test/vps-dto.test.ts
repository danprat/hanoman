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

describe("password bootstrap (SPEC-165)", () => {
  it("create menerima password opsional", () => {
    const v = zCreateVps.parse({ name: "w", host: "203.0.113.10", user: "root", password: "s3cret" });
    expect(v.password).toBe("s3cret");
    expect(zCreateVps.parse({ name: "w", host: "203.0.113.10", user: "root" }).password).toBeUndefined();
  });
  it("password kosong ditolak — bukan diam-diam dianggap 'tanpa password'", () => {
    expect(zCreateVps.safeParse({ name: "w", host: "203.0.113.10", user: "root", password: "" }).success).toBe(false);
  });
  it("patch menerima password tanpa memaksa field lain", () => {
    const p = zPatchVps.parse({ password: "s3cret" });
    expect(p.password).toBe("s3cret");
    expect(p.name).toBeUndefined();
  });
});
