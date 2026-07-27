import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureCodexTrust, codexConfigPath } from "../src/services/codex-trust";

let home = "";
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "hanoman-cxhome-")); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

describe("ensureCodexTrust", () => {
  it("membuat config + entri trust saat belum ada", () => {
    ensureCodexTrust("/repo/app", home);
    const t = readFileSync(codexConfigPath(home), "utf8");
    expect(t).toContain('[projects."/repo/app"]');
    expect(t).toContain('trust_level = "trusted"');
  });

  it("idempoten — dipanggil dua kali tetap satu entri", () => {
    ensureCodexTrust("/repo/app", home);
    ensureCodexTrust("/repo/app", home);
    const t = readFileSync(codexConfigPath(home), "utf8");
    expect(t.split('[projects."/repo/app"]').length - 1).toBe(1);
  });

  it("tak merusak konfigurasi yang sudah ada", () => {
    mkdirSync(home, { recursive: true });
    writeFileSync(codexConfigPath(home), 'model = "gpt-5.5"\n\n[mcp_servers.x]\nurl = "http://x"\n');
    ensureCodexTrust("/repo/app", home);
    const t = readFileSync(codexConfigPath(home), "utf8");
    expect(t).toContain('model = "gpt-5.5"');
    expect(t).toContain("[mcp_servers.x]");
    expect(t).toContain('[projects."/repo/app"]');
  });

  it("project berbeda mendapat entri sendiri", () => {
    ensureCodexTrust("/repo/a", home);
    ensureCodexTrust("/repo/b", home);
    const t = readFileSync(codexConfigPath(home), "utf8");
    expect(t).toContain('[projects."/repo/a"]');
    expect(t).toContain('[projects."/repo/b"]');
  });

  it("gagal-diam saat home tak bisa ditulis — sesi tetap boleh lahir", () => {
    expect(() => ensureCodexTrust("/repo/app", "/proc/tidak-ada/xyz")).not.toThrow();
    expect(existsSync("/proc/tidak-ada/xyz")).toBe(false);
  });
});
