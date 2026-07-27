import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parseCodexVersion, cmpVersion, codexVersionInfo, _resetCodexVersionCache, CODEX_MIN_CLIENT,
} from "../src/services/codex-version";
import { buildApp } from "../src/app";

beforeEach(() => { _resetCodexVersionCache(); });
afterEach(() => { delete process.env.HANOMAN_CODEX_BIN; });

describe("SPEC-339 · deteksi versi codex", () => {
  it("memparse keluaran `codex --version`", () => {
    expect(parseCodexVersion("codex-cli 0.145.0\n")).toBe("0.145.0");
    expect(parseCodexVersion("codex-cli 0.142.5")).toBe("0.142.5");
    expect(parseCodexVersion("bukan versi apa pun")).toBeNull();
  });

  // localeCompare akan bilang "0.9.0" > "0.144.0" — perbandingan WAJIB numerik per segmen.
  it("membandingkan versi secara numerik per segmen", () => {
    expect(cmpVersion("0.142.5", "0.144.0")).toBeLessThan(0);
    expect(cmpVersion("0.145.0", "0.144.0")).toBeGreaterThan(0);
    expect(cmpVersion("0.144.0", "0.144.0")).toBe(0);
    expect(cmpVersion("0.9.0", "0.144.0")).toBeLessThan(0);
  });

  it("keluaran tanpa angka versi → null, dan null TIDAK dianggap gagal", async () => {
    process.env.HANOMAN_CODEX_BIN = "/bin/echo";   // mencetak argumennya: "--version"
    const info = await codexVersionInfo();
    expect(info.minRequired).toBe(CODEX_MIN_CLIENT);
    expect(info.version).toBeNull();
    expect(info.ok).toBe(true);
  });

  it("biner tak ada → version null, ok true (ketiadaan bukti bukan bukti ketiadaan)", async () => {
    process.env.HANOMAN_CODEX_BIN = "/tak/ada/codex-339";
    const info = await codexVersionInfo();
    expect(info.version).toBeNull();
    expect(info.ok).toBe(true);
  });

  it("GET /api/codex/version mengembalikan bentuk kontraknya", async () => {
    process.env.HANOMAN_CODEX_BIN = "/tak/ada/codex-339";
    const app = buildApp({ requireAuth: false });
    const res = await app.inject({ method: "GET", url: "/api/codex/version" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ version: null, minRequired: "0.144.0", ok: true });
    await app.close();
  });
});
