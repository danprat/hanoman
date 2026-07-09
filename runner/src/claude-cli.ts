import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Writable } from "node:stream";
import type {
  ClaudeSession, CliOptions, OpenSession, QueryArgs, QueryFn, SdkMessage, SdkUserMessage,
} from "./types";

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

async function pump(prompt: string | AsyncIterable<SdkUserMessage>, stdin: Writable) {
  const write = (m: SdkUserMessage) => stdin.write(JSON.stringify(m) + "\n");
  if (typeof prompt === "string") write({ type: "user", message: { role: "user", content: prompt } });
  else for await (const m of prompt) write(m);
  stdin.end(); // closing stdin is what ends the session
}

export function makeClaudeCliQuery(cfg: { bin?: string; guardCommand: string }): QueryFn {
  return (args: QueryArgs) => (async function* (): AsyncGenerator<SdkMessage> {
    const o = args.options as CliOptions;
    const bin = cfg.bin ?? process.env.HANOMAN_CLAUDE_BIN ?? "claude";
    const child = spawn(bin, buildArgs(o, cfg.guardCommand), { cwd: o.cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c) => { stderr += c; });
    child.stdin.on("error", () => { /* killed mid-write; the close code below is the real signal */ });
    // A ChildProcess 'error' (spawn ENOENT: claude not on PATH) with no listener is an
    // *uncaught* exception — it would kill the worker instead of failing the run. Capture it
    // and let the close path below turn it into a legible failure.
    let spawnError: Error | undefined;
    child.on("error", (e) => { spawnError = e; });
    const closed = new Promise<number | null>((res) => child.on("close", res));
    const onAbort = () => child.kill("SIGTERM");
    o.abortController?.signal.addEventListener("abort", onAbort);
    void pump(args.prompt, child.stdin);

    let sawResult = false;
    try {
      for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
        if (!line.trim()) continue;
        let m: SdkMessage;
        // ponytail: non-JSON on stdout is a stray warning; real failures arrive on stderr
        // and are reported via the exit code below.
        try { m = JSON.parse(line) as SdkMessage; } catch { continue; }
        if (m.type === "result") sawResult = true;
        yield m;
      }
      const code = await closed;
      if (spawnError) throw new Error(`gagal menjalankan "${bin}" (cek PATH / HANOMAN_CLAUDE_BIN): ${spawnError.message}`);
      // A run that reported a `result` already carries its own verdict (error_max_budget_usd,
      // and friends) — runOne reads subtype. Only a death with no result is opaque, so only
      // that one is worth throwing over.
      if (code !== 0 && !sawResult && !o.abortController?.signal.aborted) {
        throw new Error(`claude exited ${code}: ${(stderr || "no stderr").slice(0, 500)}`);
      }
    } finally {
      o.abortController?.signal.removeEventListener("abort", onAbort);
      child.kill("SIGTERM");
    }
  })();
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
        child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: text } } satisfies SdkUserMessage) + "\n");
      },
      async next(): Promise<SdkMessage | null> {
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
          try { return JSON.parse(line) as SdkMessage; } catch { continue; }
        }
      },
      close() { child.stdin.end(); },
      kill() { child.kill("SIGTERM"); },
    };
  };
}
