export interface Ctx {
  cwd: string; env: Record<string, string | undefined>;
  stdout(s: string): void; stderr(s: string): void; readStdin?(): Promise<string>;
}
const VERSION = "0.2.0";
const HELP = `hanoman <command>

  execute <spec> [--only p] [--dir d]       run the feature pipeline (worktree)
  spec <spec>                               feature flow · spec phase only
  plan <spec>                               feature flow · plan phase only
  qa <spec>                                 audit → spec → plan → execute
  scaffold --from objective                 scaffold internal/docs
  reverse --dir <path>                      reverse-engineer docs from code
  docs scan [--json]                        coverage + per-category report
  docs index --check | --fix                index integrity
  docs link <path> [--category c]           add a doc to the index
  hook pretooluse                           Claude Code PreToolUse-hook adapter (guardrail)
  --version | --help`;
export async function run(argv: string[], ctx: Ctx): Promise<number> {
  if (argv.includes("--version")) { ctx.stdout(VERSION + "\n"); return 0; }
  if (argv.length === 0 || argv.includes("--help")) { ctx.stdout(HELP + "\n"); return 0; }
  const [group, sub, ...rest] = argv;
  if (group === "execute")  return (await import("./commands/execute")).default(argv.slice(1), ctx);
  if (group === "spec")     return (await import("./commands/spec")).default(argv.slice(1), ctx);
  if (group === "plan")     return (await import("./commands/plan")).default(argv.slice(1), ctx);
  if (group === "qa")       return (await import("./commands/qa")).default(argv.slice(1), ctx);
  if (group === "scaffold") return (await import("./commands/scaffold")).default(argv.slice(1), ctx);
  if (group === "reverse")  return (await import("./commands/reverse")).default(argv.slice(1), ctx);
  if (group === "docs" && sub === "scan")   return (await import("./commands/docs-scan")).default(rest, ctx);
  if (group === "docs" && sub === "index")  return (await import("./commands/docs-index")).default(rest, ctx);
  if (group === "docs" && sub === "link")   return (await import("./commands/docs-link")).default(rest, ctx);
  if (group === "hook" && sub === "pretooluse") return (await import("./commands/hook-pretooluse")).default(rest, ctx);
  ctx.stderr(`unknown command: ${argv.join(" ")}\n\n${HELP}\n`);
  return 1;
}
