import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sshExec, consoleArgv } from "../src/services/vps-ssh";

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

describe("sshExec mode password (SPEC-165)", () => {
  let log: string;
  beforeEach(() => { log = join(mkdtempSync(join(tmpdir(), "hanoman-ssh-")), "log"); process.env.FAKE_SSH_LOG = log; });
  afterEach(() => { delete process.env.FAKE_SSH_LOG; rmSync(log, { force: true }); });

  it("password: askpass dipasang, BatchMode TIDAK dipakai", async () => {
    const r = await sshExec(T, "true", { password: "s3cret" });
    expect(r.code).toBe(0);
    const rec = readFileSync(log, "utf8");
    expect(rec).toContain("ASKPASS_REQUIRE force");
    expect(rec).toContain("HAS_PASSWORD yes");
    expect(rec).toContain("PreferredAuthentications=password,keyboard-interactive");
    expect(rec).toContain("PubkeyAuthentication=no");
    expect(rec).toContain("NumberOfPasswordPrompts=1");
    expect(rec).not.toContain("BatchMode=yes");   // BatchMode melarang askpass
  });

  it("tanpa password: BatchMode=yes, tak ada askpass — jalur SPEC-164 tak berubah", async () => {
    await sshExec(T, "true");
    const rec = readFileSync(log, "utf8");
    expect(rec).toContain("BatchMode=yes");
    expect(rec).toContain("ASKPASS none");
    expect(rec).toContain("HAS_PASSWORD no");
  });

  it("script askpass dihapus setelah proses selesai", async () => {
    await sshExec(T, "true", { password: "s3cret" });
    const askpassPath = readFileSync(log, "utf8").match(/^ASKPASS (.+)$/m)![1]!;
    expect(existsSync(askpassPath)).toBe(false);
  });

  it("password tak pernah muncul di argv", async () => {
    await sshExec(T, "true", { password: "s3cret" });
    expect(readFileSync(log, "utf8")).not.toContain("s3cret");
  });
});

describe("consoleArgv (SPEC-211)", () => {
  it("argv ssh interaktif dengan -t, port, dan user@host", () => {
    const a = consoleArgv({ host: "203.0.113.9", port: 2222, user: "deploy", keyPath: null });
    expect(a).toContain("-t");
    expect(a).toEqual(expect.arrayContaining(["-p", "2222", "deploy@203.0.113.9"]));
    expect(a).not.toContain("-i");
  });
  it("menyisipkan -i keyPath saat ada", () => {
    const a = consoleArgv({ host: "h", port: 22, user: "root", keyPath: "/k/id_ed25519" });
    expect(a).toEqual(expect.arrayContaining(["-i", "/k/id_ed25519"]));
  });
});
