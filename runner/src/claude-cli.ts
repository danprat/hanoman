import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { ClaudeSession, CliOptions, OpenSession, CliMessage, CliUserMessage } from "./types";

// The Agent SDK's query() only ever spawned this same binary with --output-format
// stream-json; talking to it directly removes the wrapper, not a layer of behaviour.
export type { CliOptions };

// canUseTool was a JS callback and cannot cross a process boundary. A PreToolUse hook
// can: it outranks --permission-mode (deny wins even under acceptEdits), and hooks from
// --settings merge with the user's own rather than replacing them.
export const guardSettings = (guardCommand: string) => ({
  hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: guardCommand }] }] },
});

export function buildArgs(o: CliOptions, guardCommand: string): string[] {
  const a = [
    "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
    "--model", o.model,
    // A run is unattended: there is nobody to answer a permission prompt. This makes the
    // PreToolUse hook below the ONLY gate left, which is why deniesDangerous is verified
    // against the real binary (runner/test/live-smoke.test.ts) and not merely unit-tested.
    "--dangerously-skip-permissions",
    // Explicit, not the CLI default: a run must load the same user+project+local config as a
    // daily terminal session, and that intent should survive a change to the CLI's default.
    "--setting-sources", (o.settingSources ?? ["user", "project", "local"]).join(","),
    "--settings", JSON.stringify(guardSettings(guardCommand)),
  ];
  if (o.effort) a.push("--effort", o.effort);
  // Second layer behind the hook: globs are coarser than deniesDangerous' regexes.
  // Variadic flag, so it stays last.
  if (o.disallowedTools?.length) a.push("--disallowed-tools", ...o.disallowedTools);
  return a;
}

// Satu proses per backlog, bukan per fase. Fase menjadi giliran: tiap `send` menghasilkan
// tepat satu `result`, dan prosesnya menganggur — hidup — di antara giliran selama stdin
// terbuka. Diverifikasi terhadap claude v2.1.205, bukan disimpulkan dari dokumen.
export function makeClaudeCliSession(cfg: { bin?: string; guardCommand: string }): OpenSession {
  return (o: CliOptions): ClaudeSession => {
    const bin = cfg.bin ?? process.env.HANOMAN_CLAUDE_BIN ?? "claude";
    const child = spawn(bin, buildArgs(o, cfg.guardCommand), { cwd: o.cwd, stdio: ["pipe", "pipe", "pipe"] });

    let stderr = "";
    child.stderr.on("data", (c) => { stderr += c; });
    // Dibunuh di tengah tulis; kode keluar di bawah yang jadi sinyal sebenarnya.
    child.stdin.on("error", () => { /* empty */ });
    // A ChildProcess 'error' (spawn ENOENT: claude not on PATH) with no listener is an
    // *uncaught* exception — it would kill the worker instead of failing the run.
    let spawnError: Error | undefined;
    child.on("error", (e) => { spawnError = e; });
    const closed = new Promise<number | null>((res) => child.on("close", res));

    const onAbort = () => child.kill("SIGTERM");
    o.abortController?.signal.addEventListener("abort", onAbort);

    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })[Symbol.asyncIterator]();

    return {
      send(text: string) {
        child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: text } } satisfies CliUserMessage) + "\n");
      },
      async next(): Promise<CliMessage | null> {
        for (;;) {
          const { value, done } = await lines.next();
          if (done) {
            const code = await closed;
            o.abortController?.signal.removeEventListener("abort", onAbort);
            if (spawnError) throw new Error(`gagal menjalankan "${bin}" (cek PATH / HANOMAN_CLAUDE_BIN): ${spawnError.message}`);
            if (code !== 0 && !o.abortController?.signal.aborted) {
              throw new Error(`claude exited ${code}: ${(stderr || "no stderr").slice(0, 500)}`);
            }
            return null;
          }
          const line = String(value).trim();
          if (!line) continue;
          // ponytail: non-JSON on stdout is a stray warning; real failures arrive on stderr
          // and are reported via the exit code above.
          try { return JSON.parse(line) as CliMessage; } catch { continue; }
        }
      },
      close() { child.stdin.end(); },
      kill() { child.kill("SIGTERM"); },
    };
  };
}
