import { prisma } from "../db";
import { listRepoDocs } from "./scan";
import { listSessions } from "./pty";

export type DocKind = "audit" | "spec" | "plan" | "objective" | "brainstorm" | "other";
export type SpecDoc = { kind: DocKind; path: string; name: string };

// Urutan tampil: pimpin dengan tiga yang disebut backlog item, lalu pendukung.
const ORDER: DocKind[] = ["audit", "spec", "plan", "objective", "brainstorm", "other"];

// Klasifikasi berbasis suffix + dir: "spec" hidup di dua tempat
// (operations/*-spec.md dan superpowers/specs/*-design.md). Cek brainstorm & objective
// SEBELUM aturan dir specs, supaya keduanya tak tertelan jadi "spec".
export function kindOf(path: string): DocKind {
  const p = path.toLowerCase();
  if (p.endsWith("-audit.md")) return "audit";
  if (p.endsWith("-objective.md")) return "objective";
  if (p.endsWith("-brainstorm.md")) return "brainstorm";
  if (p.endsWith("-design.md") || p.endsWith("-spec.md") || p.startsWith("docs/superpowers/specs/")) return "spec";
  if (p.startsWith("docs/superpowers/plans/") || p.endsWith("-plan.md")) return "plan";
  return "other";
}

// cwd sesi HIDUP untuk spec ini kalau ada; kalau tidak, repoDir project. Sesi hidup =
// worktree run: memuat dokumen in-progress yang belum di-merge (freshest-wins, SPEC-170).
export async function resolveDir(
  specId: string, sessions: ReturnType<typeof listSessions> = listSessions(),
): Promise<string | null> {
  const live = sessions.find((s) => s.specId === specId && !s.exited && s.cwd);
  if (live) return live.cwd;
  const spec = await prisma.spec.findUnique({
    where: { id: specId }, select: { project: { select: { repoDir: true } } },
  });
  return spec?.project.repoDir ?? null;
}

export async function listSpecDocs(
  specId: string, sessions: ReturnType<typeof listSessions> = listSessions(),
): Promise<SpecDoc[]> {
  const dir = await resolveDir(specId, sessions);
  if (!dir) return [];
  const id = specId.toLowerCase();
  const re = new RegExp(`(^|[^a-z0-9])${id}([^0-9]|$)`);
  const docs = (await listRepoDocs(dir))
    .filter((f) => re.test(f.toLowerCase()))
    .map((f) => ({ kind: kindOf(f), path: f, name: f.slice(f.lastIndexOf("/") + 1) }));
  return docs.sort((a, b) =>
    ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.path.localeCompare(b.path));
}
