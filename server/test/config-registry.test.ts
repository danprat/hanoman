import { describe, it, expect } from "vitest";
import { CONFIG_REGISTRY, configEntry, parseConfigValue, maskSecret } from "@hanoman/shared";

describe("config-registry", () => {
  it("key unik", () => {
    const keys = CONFIG_REGISTRY.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("parse int honor min", () => {
    const e = configEntry("SYNC_TICK_MS")!;
    expect(parseConfigValue(e, "500")).toEqual({ ok: false, error: "min 1000" });
    expect(parseConfigValue(e, "2000")).toEqual({ ok: true, value: "2000" });
    expect(parseConfigValue(e, "abc")).toEqual({ ok: false, error: "harus bilangan bulat" });
  });
  it("parse url http(s)", () => {
    const e = configEntry("SYNC_SERVER_URL")!;
    expect(parseConfigValue(e, "https://h.co").ok).toBe(true);
    expect(parseConfigValue(e, "ftp://h.co").ok).toBe(false);
    expect(parseConfigValue(e, "bukan url").ok).toBe(false);
  });
  it("parse bool normalisasi", () => {
    const e = configEntry("HANOMAN_UPDATE_FETCH")!;
    expect(parseConfigValue(e, "true")).toEqual({ ok: true, value: "1" });
    expect(parseConfigValue(e, "0")).toEqual({ ok: true, value: "0" });
  });
  it("mask last-4", () => {
    expect(maskSecret("abcdefgh")).toBe("••••efgh");
    expect(maskSecret("ab")).toBe("••••");
  });
  it("gitGraph namespace terdaftar + parse valid (SPEC-233)", () => {
    const style = configEntry("gitGraph.style");
    expect(style?.group).toBe("gitGraph");
    expect(style?.default).toBe("rounded");
    expect(parseConfigValue(style!, "angular")).toEqual({ ok: true, value: "angular" });
    const avatars = configEntry("gitGraph.fetchAvatars")!;
    expect(avatars.default).toBe("0");
    expect(parseConfigValue(avatars, "1")).toEqual({ ok: true, value: "1" });
    const load = configEntry("gitGraph.commitsInitialLoad")!;
    expect(parseConfigValue(load, "0")).toEqual({ ok: false, error: "min 1" });
    expect(CONFIG_REGISTRY.filter((e) => e.group === "gitGraph").length).toBeGreaterThanOrEqual(14);
  });
  // SPEC-471 · ADR-0095 · dua knob untuk tarik issue. Token BUKAN knob biasa: ia kredensial,
  // jadi kind `secret` (UI tak pernah menampilkan nilainya kembali).
  it("SPEC-471 · GITHUB_TOKEN & HANOMAN_GH_BIN terdaftar dengan kind yang benar", () => {
    const tok = CONFIG_REGISTRY.find((e) => e.key === "GITHUB_TOKEN");
    expect(tok).toBeDefined();
    expect(tok!.kind).toBe("secret");
    expect(tok!.category).toBe("credential");
    const bin = CONFIG_REGISTRY.find((e) => e.key === "HANOMAN_GH_BIN");
    expect(bin).toBeDefined();
    expect(bin!.kind).toBe("path");
    expect(bin!.default).toBe("gh");
  });
});
