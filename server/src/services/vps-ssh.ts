import { spawn } from "node:child_process";

// Test menunjuk HANOMAN_SSH_BIN ke fixture — pola HANOMAN_CLAUDE_BIN di pty.ts.
const sshBin = () => process.env.HANOMAN_SSH_BIN ?? "ssh";

export type SshTarget = { host: string; port: number; user: string; keyPath?: string | null };
export type SshResult = { code: number; out: string };

// BatchMode: tak pernah ada prompt password — koneksi hanoman selalu key-based, dan
// itulah yang membuat mematikan PasswordAuthentication aman bagi hanoman sendiri.
// accept-new: koneksi pertama merekam host key; key yang BERUBAH tetap ditolak (MITM).
export function sshExec(t: SshTarget, remoteCmd: string,
  opts: { stdin?: string; timeoutMs?: number } = {}): Promise<SshResult> {
  const args = [
    "-p", String(t.port), "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=accept-new",
    ...(t.keyPath ? ["-i", t.keyPath] : []),
    `${t.user}@${t.host}`, remoteCmd,
  ];
  return new Promise((resolve) => {
    const p = spawn(sshBin(), args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    // ponytail: SIGKILL langsung — ssh yang menggantung melewati ConnectTimeout tak layak SIGTERM dulu.
    const timer = setTimeout(() => p.kill("SIGKILL"), opts.timeoutMs ?? 60_000);
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { out += d; });
    p.stdin.on("error", () => {});   // proses mati sebelum stdin tertulis (unreachable) — bukan crash
    p.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, out }); });
    p.on("error", (e) => { clearTimeout(timer); resolve({ code: 127, out: String(e) }); });
    if (opts.stdin) p.stdin.write(opts.stdin);
    p.stdin.end();
  });
}
