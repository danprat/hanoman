import type { BreakdownItem } from "@hanoman/shared";
import { zBreakdownItem } from "@hanoman/shared";
import { resolveRepoDir } from "./local-binding";
import { readDocFile } from "./scan";
import { listSessions } from "./pty";

// SPEC-273 · manifest breakdown = sibling PRD: docs/prd/<slug>.md → docs/prd/<slug>.breakdown.md.
// PRD = dokumen (ADR-0041); breakdown menempel di sampingnya, dibaca freshest-wins seperti PRD.
const PRD_DIR = "docs/prd/";
const isPrd = (rel: string) => rel.startsWith(PRD_DIR) && rel.endsWith(".md");

export function breakdownPathFor(prdPath: string): string | null {
  if (!isPrd(prdPath) || prdPath.endsWith(".breakdown.md")) return null;
  return prdPath.slice(0, -3) + ".breakdown.md";
}

// Ambil blok ```json PERTAMA, JSON.parse, lalu zod tiap item. Toleran: tanpa blok / json rusak →
// []; item yang tak lolos zod dibuang (bukan gagal keras) — manifest ditulis agen, harus defensif.
export function parseBreakdown(md: string): BreakdownItem[] {
  const m = md.match(/```json\s*([\s\S]*?)```/);
  if (!m) return [];
  let data: unknown;
  try { data = JSON.parse(m[1]!); } catch { return []; }
  const arr = data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)
    ? (data as { items: unknown[] }).items : [];
  const out: BreakdownItem[] = [];
  for (const it of arr) {
    const p = zBreakdownItem.safeParse(it);
    if (p.success) out.push(p.data);
  }
  return out;
}

// cwd sesi breakdown HIDUP untuk project ini (worktree, memuat draft belum di-merge) > repoDir.
async function resolveDir(
  projectId: string, sessions: ReturnType<typeof listSessions>,
): Promise<{ dir: string | null; live: boolean }> {
  const live = sessions.find((s) => s.projectId === projectId && s.flow === "breakdown" && !s.exited && s.cwd);
  if (live) return { dir: live.cwd, live: true };
  return { dir: await resolveRepoDir(projectId), live: false };
}

export async function readBreakdown(
  projectId: string, prdPath: string, sessions: ReturnType<typeof listSessions> = listSessions(),
): Promise<{ items: BreakdownItem[]; live: boolean }> {
  const rel = breakdownPathFor(prdPath);
  if (!rel) return { items: [], live: false };
  const { dir, live } = await resolveDir(projectId, sessions);
  if (!dir) return { items: [], live };
  const md = readDocFile(dir, rel);
  return { items: md ? parseBreakdown(md) : [], live };
}
