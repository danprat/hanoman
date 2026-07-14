import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Test menunjuk HANOMAN_SSH_BIN ke fixture — pola HANOMAN_CLAUDE_BIN di pty.ts.
export const sshBin = () => process.env.HANOMAN_SSH_BIN ?? "ssh";

export type SshTarget = { host: string; port: number; user: string; keyPath?: string | null };
export type SshResult = { code: number; out: string };

// SPEC-211 · argv `ssh` interaktif untuk Open Console. `-t` memaksa tty remote; koneksi
// dibungkus tmux hanoman (createSession) supaya reattach dari browser (ADR-0042). accept-new
// sama dengan sshExec. host/user/port sudah divalidasi zod; keyPath path milik server.
export function consoleArgv(t: SshTarget): string[] {
  return [
    sshBin(), "-t", "-p", String(t.port),
    "-o", "StrictHostKeyChecking=accept-new",
    ...(t.keyPath ? ["-i", t.keyPath] : []),
    `${t.user}@${t.host}`,
  ];
}

// Skrip yang dipanggil ssh untuk menanyakan password. Isinya tak memuat rahasia —
// password mengalir lewat environment, bukan lewat berkas maupun argv.
function askpassScript(): string {
  const dir = mkdtempSync(join(tmpdir(), "hanoman-askpass-"));
  const path = join(dir, "askpass.sh");
  writeFileSync(path, '#!/bin/sh\nprintf \'%s\' "$HANOMAN_SSH_PASSWORD"\n', { mode: 0o700 });
  return path;
}

// Tanpa password (jalur normal SPEC-164): BatchMode — tak pernah ada prompt, koneksi selalu
// key-based, dan itulah yang membuat mematikan PasswordAuthentication aman bagi hanoman.
//
// Dengan password (bootstrap SPEC-165): BatchMode justru HARUS absen — ia melarang segala
// prompt termasuk askpass. Password diserahkan lewat SSH_ASKPASS (OpenSSH >= 8.4), bukan
// argv: argv terlihat oleh semua pengguna mesin, environment hanya oleh pemilik proses.
// NumberOfPasswordPrompts=1 membuat password salah gagal seketika, bukan menggantung.
//
// accept-new: koneksi pertama merekam host key; key yang BERUBAH tetap ditolak (MITM).
export function sshExec(t: SshTarget, remoteCmd: string,
  opts: { stdin?: string; timeoutMs?: number; password?: string } = {}): Promise<SshResult> {
  const auth = opts.password
    ? ["-o", "PreferredAuthentications=password,keyboard-interactive",
       "-o", "PubkeyAuthentication=no", "-o", "NumberOfPasswordPrompts=1"]
    : ["-o", "BatchMode=yes"];
  const askpass = opts.password ? askpassScript() : null;
  const args = [
    "-p", String(t.port), ...auth, "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=accept-new",
    ...(!opts.password && t.keyPath ? ["-i", t.keyPath] : []),
    `${t.user}@${t.host}`, remoteCmd,
  ];
  const env = askpass
    ? { ...process.env, SSH_ASKPASS: askpass, SSH_ASKPASS_REQUIRE: "force",
        HANOMAN_SSH_PASSWORD: opts.password }
    : process.env;

  return new Promise((resolve) => {
    const p = spawn(sshBin(), args, { stdio: ["pipe", "pipe", "pipe"], env });
    let out = "";
    // ponytail: SIGKILL langsung — ssh yang menggantung melewati ConnectTimeout tak layak SIGTERM dulu.
    const timer = setTimeout(() => p.kill("SIGKILL"), opts.timeoutMs ?? 60_000);
    const done = (r: SshResult) => {
      clearTimeout(timer);
      // Rahasia hidup sesingkat mungkin: buang skripnya apa pun yang terjadi.
      if (askpass) rmSync(dirname(askpass), { recursive: true, force: true });
      resolve(r);
    };
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { out += d; });
    p.stdin.on("error", () => {});   // proses mati sebelum stdin tertulis (unreachable) — bukan crash
    p.on("close", (code) => done({ code: code ?? 1, out }));
    p.on("error", (e) => done({ code: 127, out: String(e) }));
    if (opts.stdin) p.stdin.write(opts.stdin);
    p.stdin.end();
  });
}
