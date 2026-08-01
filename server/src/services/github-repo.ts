import { prisma } from "../db";
import { listRemotes } from "./git-remotes";
import { resolveRepoDir } from "./local-binding";

// SPEC-471 · ADR-0095 · dari mana hanoman tahu repo GitHub sebuah project.
// Sweep 8 project (audit B5) mengukur tiga keadaan yang semuanya nyata: `Project.gitRemote`
// terisi tanpa `repoDir` (inkara), `gitRemote` kosong sementara `origin` di repoDir justru
// GitHub (crm-tumbuh-ai, videos — separuh project GitHub akan terlewat kalau hanya kolom
// yang dibaca), dan host non-GitHub (erp-tumbuh-ai di GitLab) yang harus DITOLAK BERSUARA.
export type GithubRepo = { owner: string; repo: string; slug: string };
export type RepoResolution =
  | { ok: true; repo: GithubRepo }
  | { ok: false; kind: "no-project" | "no-remote" | "not-github"; error: string };

// Ekstrak host + owner/repo. Sengaja tidak memakai parseRemote() milik git-remotes.ts karena
// yang di sana memancarkan `slug` mentah (bisa memuat sub-path); di sini owner & repo harus
// terpisah untuk membangun path REST.
function parse(url: string): { host: string; owner: string; repo: string } | null {
  const u = url.trim();
  let m = /^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/.exec(u);
  if (!m) m = /^https?:\/\/(?:[^@/]+@)?([^/]+)\/([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(u);
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  return { host: m[1], owner: m[2], repo: m[3] };
}

export function githubSlugFromUrl(url: string): GithubRepo | null {
  const p = parse(url);
  if (!p || !p.host.includes("github.")) return null;
  return { owner: p.owner, repo: p.repo, slug: `${p.owner}/${p.repo}` };
}

export async function resolveGithubRepo(projectId: string): Promise<RepoResolution> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return { ok: false, kind: "no-project", error: `project "${projectId}" tidak ada` };

  // Kandidat berurut: kolom resmi dulu (disync, berlaku di semua mesin), lalu origin lokal.
  const candidates: string[] = [];
  if (project.gitRemote) candidates.push(project.gitRemote);
  const repoDir = await resolveRepoDir(projectId).catch(() => null);
  if (repoDir) {
    const origin = (await listRemotes(repoDir)).find((r) => r.name === "origin");
    if (origin?.fetch) candidates.push(origin.fetch);
  }
  if (candidates.length === 0)
    return { ok: false, kind: "no-remote",
      error: "project belum punya remote GitHub (isi gitRemote atau tambahkan origin di repo lokalnya)" };

  for (const url of candidates) {
    const gh = githubSlugFromUrl(url);
    if (gh) return { ok: true, repo: gh };
  }
  const host = parse(candidates[0]!)?.host ?? candidates[0]!;
  return { ok: false, kind: "not-github",
    error: `remote project ber-host "${host}", bukan GitHub — tarik issue hanya mendukung GitHub` };
}
