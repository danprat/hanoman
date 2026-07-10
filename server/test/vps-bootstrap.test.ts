import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapKey } from "../src/services/vps-bootstrap";

const FAKE_SSH = fileURLToPath(new URL("./fixtures/fake-ssh.sh", import.meta.url));
const T = { host: "198.51.100.50", port: 22, user: "root" };
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hanoman-bs-"));
  process.env.HANOMAN_SSH_KEY_DIR = dir;
  process.env.HANOMAN_SSH_BIN = FAKE_SSH;
  delete process.env.FAKE_SSH_MODE;
});
afterEach(() => {
  delete process.env.HANOMAN_SSH_KEY_DIR; delete process.env.FAKE_SSH_MODE;
  rmSync(dir, { recursive: true, force: true });
});

describe("bootstrapKey (SPEC-165)", () => {
  it("sukses → keyPath menunjuk key privat hanoman", async () => {
    const r = await bootstrapKey(T, "s3cret");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.keyPath).toBe(join(dir, "id_ed25519"));
  });
  it("password ditolak → ok:false, alasannya diteruskan", async () => {
    process.env.FAKE_SSH_MODE = "bad-password";
    const r = await bootstrapKey(T, "salah");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.out).toContain("Permission denied");
  });
  it("login password sukses tapi verifikasi key gagal → ok:false (keyPath tak boleh dipakai)", async () => {
    process.env.FAKE_SSH_MODE = "bootstrap-verify-fail";
    const r = await bootstrapKey(T, "s3cret");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.out).toContain("Permission denied");
  });
});
