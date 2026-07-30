import { describe, it, expect } from "vitest";
import { pickWebDir } from "../src/web-dir";

const has = (...ok: string[]) => (p: string) => ok.includes(p);

describe("pickWebDir", () => {
  it("HANOMAN_WEB_DIR menang bila ada", () => {
    expect(pickWebDir("/pkg/dist", { HANOMAN_WEB_DIR: "/custom" }, has("/custom"))).toBe("/custom");
  });
  it("HANOMAN_WEB_DIR di-set tapi tak ada → melempar (salah konfigurasi, jangan didiamkan)", () => {
    expect(() => pickWebDir("/pkg/dist", { HANOMAN_WEB_DIR: "/nope" }, has())).toThrow(/HANOMAN_WEB_DIR/);
  });
  it("layout paket npm: <pkg>/web", () => {
    expect(pickWebDir("/pkg/dist", {}, has("/pkg/web"))).toBe("/pkg/web");
  });
  it("layout checkout: <repo>/src/dist", () => {
    expect(pickWebDir("/repo/server/dist", {}, has("/repo/src/dist"))).toBe("/repo/src/dist");
  });
  it("paket npm menang atas checkout bila keduanya ada", () => {
    expect(pickWebDir("/pkg/dist", {}, has("/pkg/web", "/src/dist"))).toBe("/pkg/web");
  });
  it("tak ada aset → null (server tetap boleh jalan sebagai API saja)", () => {
    expect(pickWebDir("/pkg/dist", {}, has())).toBeNull();
  });
});
