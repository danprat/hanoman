import { prisma } from "../db";
import { resolveGithubRepo } from "./github-repo";
import { fetchIssues, type FetchDeps } from "./github-fetch";
import { notifySynced } from "./sync-notify";

// SPEC-471 · ADR-0095 · menarik issue → baris GithubIssue. Idempotensi hidup di DUA tempat:
// (1) id deterministik — issue yang sama selalu baris yang sama, di mesin mana pun;
// (2) `update` yang TAK PERNAH menyentuh `status`/`specId` — tanpa itu issue yang sudah
//     diterima kembali `new` dan accept berikutnya melahirkan Spec kedua.
export const issueRowId = (projectId: string, slug: string, number: number): string =>
  `${projectId}:${slug}#${number}`;

export type PullResult =
  | { ok: true; repo: string; pulled: number; created: number; updated: number;
      via: "gh" | "rest"; skippedPullRequests: number }
  | { ok: false; kind: string; error: string };

export async function pullIssues(
  projectId: string,
  opts: { state?: "open" | "all"; limit?: number } = {},
  deps: FetchDeps = {},
): Promise<PullResult> {
  const resolved = await resolveGithubRepo(projectId);
  if (!resolved.ok) return { ok: false, kind: resolved.kind, error: resolved.error };

  const state = opts.state ?? "open";
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  const got = await fetchIssues(resolved.repo, { state, limit }, deps);
  if (!got.ok) return { ok: false, kind: got.kind, error: got.error };

  const slug = resolved.repo.slug;
  const now = new Date();
  let created = 0, updated = 0;
  for (const i of got.issues) {
    const id = issueRowId(projectId, slug, i.number);
    const exists = await prisma.githubIssue.findUnique({ where: { id }, select: { id: true } });
    // `status` & `specId` SENGAJA absen dari `update` — keputusan triase milik operator,
    // bukan milik GitHub. Lihat komentar di kepala berkas.
    const fresh = {
      title: i.title, body: i.body, authorLogin: i.authorLogin, labels: i.labels, url: i.url,
      issueState: i.issueState,
      issueCreatedAt: new Date(i.issueCreatedAt), issueUpdatedAt: new Date(i.issueUpdatedAt),
      pulledAt: now,
    };
    await prisma.githubIssue.upsert({
      where: { id },
      create: { id, projectId, repoSlug: slug, number: i.number, status: "new", specId: null, ...fresh },
      update: fresh,
    });
    if (exists) updated++; else created++;
    await notifySynced("githubIssue", id);
  }
  return { ok: true, repo: slug, pulled: got.issues.length, created, updated,
    via: got.via, skippedPullRequests: got.skippedPullRequests };
}
