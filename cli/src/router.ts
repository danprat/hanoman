export interface Ctx {
  cwd: string; env: Record<string, string | undefined>;
  stdout(s: string): void; stderr(s: string): void; readStdin?(): Promise<string>;
}
const VERSION = "0.2.0";
// Perintah alur (execute/spec/plan/qa/scaffold/reverse) menjalankan runner headless dan
// hilang bersamanya (SPEC-162). Pekerjaan kini dimulai dari dashboard, sebagai sesi claude
// interaktif. `hook pretooluse` TETAP: ia guardrail yang dipasang tiap sesi (ADR-0010).
const HELP = `hanoman <command>

  docs scan [--json]                        coverage + per-category report
  docs index --check | --fix                index integrity
  docs link <path> [--category c]           add a doc to the index
  hook pretooluse                           Claude Code PreToolUse-hook adapter (guardrail)
  --version | --help`;
export async function run(argv: string[], ctx: Ctx): Promise<number> {
  if (argv.includes("--version")) { ctx.stdout(VERSION + "\n"); return 0; }
  if (argv.length === 0 || argv.includes("--help")) { ctx.stdout(HELP + "\n"); return 0; }
  const [group, sub, ...rest] = argv;
  if (group === "docs" && sub === "scan")   return (await import("./commands/docs-scan")).default(rest, ctx);
  if (group === "docs" && sub === "index")  return (await import("./commands/docs-index")).default(rest, ctx);
  if (group === "docs" && sub === "link")   return (await import("./commands/docs-link")).default(rest, ctx);
  if (group === "hook" && sub === "pretooluse") return (await import("./commands/hook-pretooluse")).default(rest, ctx);
  ctx.stderr(`unknown command: ${argv.join(" ")}\n\n${HELP}\n`);
  return 1;
}
