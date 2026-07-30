// SPEC-398 · ADR-0087 · `hanoman doctor` melaporkan prasyarat yang TIDAK bisa dibawa npm: git,
// tmux, dan CLI agen. Menyembunyikannya akan membuat kegagalan muncul jauh nanti, di dalam pane
// tmux yang tak dibaca siapa pun. Keputusannya murni (probes → laporan) supaya bisa dites.
import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { dirname } from "node:path";
import { resolveHome, resolveDbUrl, dbFilePath, dbUrlNotice } from "@hanoman/runner";
import type { Ctx } from "../router";
import { resolveLayout } from "../layout";
import { distDir } from "./start";

export type Probes = {
  node: string; git: string | null; tmux: string | null;
  claude: string | null; codex: string | null;
  homeWritable: boolean; web: boolean; db: string;
};

export function doctorReport(p: Probes): { lines: string[]; ok: boolean } {
  const major = Number(/^v?(\d+)/.exec(p.node)?.[1] ?? 0);
  const rows: Array<{ mark: string; text: string; fatal: boolean }> = [
    { mark: major >= 20 ? "✓" : "✗", text: `node ${p.node} (butuh ≥ 20)`, fatal: major < 20 },
    { mark: p.git ? "✓" : "✗", text: p.git ?? "git — TAK ADA (wajib: worktree per sesi)", fatal: !p.git },
    { mark: p.tmux ? "✓" : "✗", text: p.tmux ?? "tmux — TAK ADA (wajib: sesi agen hidup di tmux)", fatal: !p.tmux },
    { mark: p.claude ? "✓" : "·", text: p.claude ? `claude ${p.claude}` : "claude — tak ada", fatal: false },
    { mark: p.codex ? "✓" : "·", text: p.codex ? `codex ${p.codex}` : "codex — tak ada", fatal: false },
    { mark: p.homeWritable ? "✓" : "✗", text: `data dir ${p.homeWritable ? "bisa ditulis" : "TAK bisa ditulis"}`, fatal: !p.homeWritable },
    { mark: p.web ? "✓" : "!", text: p.web ? "aset dashboard ada" : "aset dashboard tak ada — API jalan, dashboard tidak", fatal: false },
    { mark: "·", text: `db ${p.db}`, fatal: false },
  ];
  if (!p.claude && !p.codex) {
    rows.push({ mark: "✗", text: "tak ada CLI agen (claude ATAU codex wajib ada)", fatal: true });
  }
  return { lines: rows.map((r) => `  ${r.mark} ${r.text}`), ok: !rows.some((r) => r.fatal) };
}

function version(bin: string, args: string[]): string | null {
  try { return execFileSync(bin, args, { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n")[0] ?? null; }
  catch { return null; }
}

export default async function doctor(_argv: string[], ctx: Ctx): Promise<number> {
  let layout: ReturnType<typeof resolveLayout>;
  let db: string;
  try {
    layout = resolveLayout(distDir(), existsSync);
    db = dbFilePath(resolveDbUrl(ctx.env, dirname(layout.schema)));
  } catch (e) { ctx.stderr(`${(e as Error).message}\n`); return 1; }

  const home = resolveHome(ctx.env);
  let homeWritable = false;
  try { accessSync(existsSync(home) ? home : dirname(home), constants.W_OK); homeWritable = true; }
  catch { /* tetap false */ }

  const r = doctorReport({
    node: process.version,
    git: version("git", ["--version"]),
    tmux: version("tmux", ["-V"]),
    claude: version(ctx.env.HANOMAN_CLAUDE_BIN ?? "claude", ["--version"]),
    codex: version(ctx.env.HANOMAN_CODEX_BIN ?? "codex", ["--version"]),
    homeWritable, web: layout.web !== null, db,
  });
  ctx.stdout(`hanoman doctor\n${r.lines.join("\n")}\n`);
  // Justru di doctor ini paling berguna: ia menjelaskan kenapa `db …` menunjuk berkas default
  // padahal env punya DATABASE_URL yang lain.
  const notice = dbUrlNotice(ctx.env);
  if (notice) ctx.stdout(`\n${notice}\n`);
  if (!r.ok) ctx.stderr("\nada prasyarat yang belum terpenuhi — hanoman tak akan bisa menjalankan sesi\n");
  return r.ok ? 0 : 1;
}
