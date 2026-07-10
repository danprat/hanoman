import { describe, it, expect, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { sshExec } from "../src/services/vps-ssh";

const FAKE_SSH = fileURLToPath(new URL("./fixtures/fake-ssh.sh", import.meta.url));
const T = { host: "203.0.113.10", port: 22, user: "deploy" };
beforeEach(() => { process.env.HANOMAN_SSH_BIN = FAKE_SSH; delete process.env.FAKE_SSH_MODE; });

describe("sshExec (SPEC-164)", () => {
  it("meneruskan stdin dan mengembalikan stdout", async () => {
    const r = await sshExec(T, "sudo -n bash -s", { stdin: "# hanoman-audit\n" });
    expect(r.code).toBe(0);
    expect(r.out).toContain("CHECK sudo_ok pass");
  });
  it("koneksi gagal → code != 0, stderr ikut di out", async () => {
    process.env.FAKE_SSH_MODE = "unreachable";
    const r = await sshExec(T, "sudo -n bash -s", { stdin: "# hanoman-audit\n" });
    expect(r.code).toBe(255);
    expect(r.out).toContain("Connection refused");
  });
  it("binari ssh hilang → code 127, bukan exception", async () => {
    process.env.HANOMAN_SSH_BIN = "/nonexistent/ssh";
    const r = await sshExec(T, "true");
    expect(r.code).toBe(127);
  });
});
