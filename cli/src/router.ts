import { createRequire } from "node:module";

export interface Ctx {
  cwd: string; env: Record<string, string | undefined>;
  stdout(s: string): void; stderr(s: string): void; readStdin?(): Promise<string>;
}

// SPEC-398 · ADR-0087 · versi = versi paket npm (sumber tunggal: package.json paket ini), bukan
// konstanta yang mudah basi. Dari bundle `dist/hanoman.js`, `../package.json` benar di paket npm
// maupun di checkout (cli/package.json).
export function currentVersion(): string {
  try { return (createRequire(import.meta.url)("../package.json") as { version?: string }).version ?? "0.0.0"; }
  catch { return "0.0.0"; }
}

// Perintah alur (execute/spec/plan/qa/scaffold/reverse) menjalankan runner headless dan
// hilang bersamanya (SPEC-162). Pekerjaan kini dimulai dari dashboard, sebagai sesi claude
// interaktif. Guardrail hook pretooluse dicabut (SPEC-197, ADR-0037).
const HELP = `hanoman <command>

  (tanpa argumen) | start                   jalankan hanoman (migrasi + server + dashboard)
    --port <n> --host <h> --db <file> --no-migrate
  doctor                                    periksa prasyarat: node, git, tmux, CLI agen, data dir
  update [--check]                          bandingkan versi dengan registry npm; pasang yang terbaru
  docs scan [--json]                        coverage + laporan per-kategori
  docs index --check | --fix                integritas index
  docs link <path> [--category c]           tambahkan doc ke index
  --version | --help`;

/**
 * Keputusan routing, dipisah dari eksekusinya supaya bisa dites tanpa mem-boot server.
 *
 * SPEC-398 · `hanoman` MENJALANKAN hanoman (dulu argv kosong mencetak help) — itu inti objective
 * SPEC-398. Termasuk bentuk telanjang-ber-flag `hanoman --port 8899`: tanpa aturan itu ia jatuh ke
 * "unknown command", dan itulah cara paling wajar orang memanggilnya (terukur saat smoke boot).
 */
export function route(argv: string[]): { cmd: string; args: string[] } {
  if (argv.includes("--version")) return { cmd: "version", args: [] };
  if (argv.includes("--help")) return { cmd: "help", args: [] };
  const [group, sub, ...rest] = argv;
  if (group === undefined || group.startsWith("--")) return { cmd: "start", args: argv };
  if (group === "start" || group === "doctor" || group === "update") return { cmd: group, args: argv.slice(1) };
  if (group === "docs" && (sub === "scan" || sub === "index" || sub === "link")) {
    return { cmd: `docs:${sub}`, args: rest };
  }
  return { cmd: "unknown", args: argv };
}

export async function run(argv: string[], ctx: Ctx): Promise<number> {
  const { cmd, args } = route(argv);
  if (cmd === "version") { ctx.stdout(currentVersion() + "\n"); return 0; }
  if (cmd === "help") { ctx.stdout(HELP + "\n"); return 0; }
  if (cmd === "start")  return (await import("./commands/start")).default(args, ctx);
  if (cmd === "doctor") return (await import("./commands/doctor")).default(args, ctx);
  if (cmd === "update") return (await import("./commands/update")).default(args, ctx);
  if (cmd === "docs:scan")  return (await import("./commands/docs-scan")).default(args, ctx);
  if (cmd === "docs:index") return (await import("./commands/docs-index")).default(args, ctx);
  if (cmd === "docs:link")  return (await import("./commands/docs-link")).default(args, ctx);
  ctx.stderr(`unknown command: ${argv.join(" ")}\n\n${HELP}\n`);
  return 1;
}
