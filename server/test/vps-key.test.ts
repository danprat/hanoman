import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureHanomanKey } from "../src/services/vps-key";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "hanoman-key-")); process.env.HANOMAN_SSH_KEY_DIR = dir; });
afterEach(() => { delete process.env.HANOMAN_SSH_KEY_DIR; rmSync(dir, { recursive: true, force: true }); });

describe("ensureHanomanKey (SPEC-165)", () => {
  it("membuat keypair ed25519 dengan mode 600, pub bertanda hanoman", () => {
    const k = ensureHanomanKey();
    expect(k.privPath).toBe(join(dir, "id_ed25519"));
    expect(k.pub).toMatch(/^ssh-ed25519 AAAA/);
    expect(k.pub).toContain("hanoman");
    expect(statSync(k.privPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(k.pubPath, "utf8").trim()).toBe(k.pub);
  });
  it("idempotent: panggilan kedua memakai key yang sama, tidak membuat ulang", () => {
    const a = ensureHanomanKey();
    const priv = readFileSync(a.privPath, "utf8");
    const b = ensureHanomanKey();
    expect(b.pub).toBe(a.pub);
    expect(readFileSync(b.privPath, "utf8")).toBe(priv);
  });
});
