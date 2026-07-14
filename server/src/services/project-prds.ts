import type { PrdDoc } from "@hanoman/shared";
import { prisma } from "../db";
import { listRepoDocs, readDocFile } from "./scan";
import { listSessions } from "./pty";

// SPEC-210 · PRD adalah dokumen docs/prd/<slug>.md (bukan entitas DB, ADR-0011/0041). List/baca
// freshest-wins: worktree sesi prd hidup untuk project ini > repoDir (pola spec-docs.ts).
export type { PrdDoc };

const PRD_DIR = "docs/prd/";
const isPrd = (rel: string) => rel.startsWith(PRD_DIR) && rel.endsWith(".md");
const slugOf = (rel: string) => rel.slice(PRD_DIR.length, -3);
// Judul = heading `# ...` pertama; fallback slug.
const titleOf = (content: string | null, slug: string) => {
  const m = content?.match(/^#\s+(.+)$/m);
  return m ? m[1]!.trim() : slug;
};

// cwd sesi prd HIDUP untuk project ini (worktree, memuat draft belum di-merge) > repoDir.
// ponytail: PRD yang sesinya sudah ditutup TAPI branch belum di-merge tak muncul (hanya ada di
// origin/branch). Upgrade path bila perlu: list juga branch prd/*. Alur nyata (create→preview→
// take dalam satu sesi hidup, lalu merge) menutupinya.
async function resolveDir(
  projectId: string, sessions: ReturnType<typeof listSessions> = listSessions(),
): Promise<{ dir: string | null; live: boolean }> {
  const live = sessions.find((s) => s.projectId === projectId && s.flow === "prd" && !s.exited && s.cwd);
  if (live) return { dir: live.cwd, live: true };
  const project = await prisma.project.findUnique({
    where: { id: projectId }, select: { repoDir: true },
  });
  return { dir: project?.repoDir ?? null, live: false };
}

export async function listPrds(
  projectId: string, sessions: ReturnType<typeof listSessions> = listSessions(),
): Promise<PrdDoc[]> {
  const { dir, live } = await resolveDir(projectId, sessions);
  if (!dir) return [];
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
  const projectName = project?.name ?? projectId;
  return (await listRepoDocs(dir))
    .filter(isPrd)
    .map((rel) => {
      const slug = slugOf(rel);
      return {
        slug, name: rel.slice(rel.lastIndexOf("/") + 1), path: rel,
        title: titleOf(readDocFile(dir, rel), slug), live, projectId, projectName,
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

// perbaikan SPEC-210 · daftar PRD LINTAS-project (filter "Semua project"): iterasi tiap project
// (pola projects.ts) lalu concat listPrds-nya. Project tanpa repoDir → [] (tak menyumbang).
export async function listAllPrds(
  sessions: ReturnType<typeof listSessions> = listSessions(),
): Promise<PrdDoc[]> {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" }, select: { id: true },
  });
  const nested = await Promise.all(projects.map((p) => listPrds(p.id, sessions)));
  return nested.flat();
}

export async function readPrd(
  projectId: string, path: string, sessions: ReturnType<typeof listSessions> = listSessions(),
): Promise<string | null> {
  if (!isPrd(path)) return null; // gerbang: hanya docs/prd/*.md
  const { dir } = await resolveDir(projectId, sessions);
  return dir ? readDocFile(dir, path) : null; // readDocFile menolak non-.md / path keluar repo
}
