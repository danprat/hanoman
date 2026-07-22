import { prisma } from "../db";
import type { Spec } from "@prisma/client";
import { realGit, startPrompt, continuePrompt, type Flow } from "@hanoman/runner";
import { resolveRepoDir } from "./local-binding";
import { sessionModel } from "./settings";
import { createSession, getSession, sessionIdForSpec } from "./pty";
import { phaseFilePath, decisionFilePath } from "./session-phases";

// Re-ekspor supaya pemanggil (governor, test) punya satu titik impor jalur peluncuran.
export { sessionIdForSpec } from "./pty";

// SPEC-294 · ADR-0072 · satu jalur peluncuran sesi backlog — dipakai POST /terminal/sessions (manual)
// & governor scheduler. Melempar LaunchError dengan `kind` agar pemanggil memetakan status HTTP
// (route) atau menandai antrean gagal (governor).
export class LaunchError extends Error {
  constructor(message: string, readonly kind: "needs-bind" | "worktree") { super(message); }
}
export type StartSpecResult = { id: string; reused?: boolean };

export async function startSpecSession(
  spec: Spec, opts: { flow: Flow; model?: string; effort?: string },
): Promise<StartSpecResult> {
  // SPEC-213 · binding lokal per-device menang atas Project.repoDir (AC-8). Tanpa checkout lokal →
  // minta bind/clone dulu (route: 400 needsBind; governor: markFailed).
  const repoDir = await resolveRepoDir(spec.projectId);
  if (!repoDir) throw new LaunchError(`project "${spec.projectId}" belum di-bind ke checkout lokal`, "needs-bind");

  const id = sessionIdForSpec(spec.id);
  // Sesi hidup: JANGAN bangun ulang worktree (ada kerja belum-commit) — re-attach (ADR-0015).
  const live = getSession(id);
  if (live) return { id: live.id, reused: true };

  // SPEC-252 · ADR-0061 · model/effort per SESI: default global, override per-instance opsional.
  const g = await sessionModel();
  const model = opts.model ?? g.model;
  const effort = opts.effort ?? g.effort;
  const isContinue = spec.stage === "done";

  // Worktree lahir `--detach` di commit branchFrom (fallback HEAD, SPEC-197): sesi tak pernah jalan
  // di working tree utama. baseSha disimpan agar review men-diff baseSha..headSha (SPEC-176/ADR-0030).
  let baseSha: string;
  try {
    baseSha = realGit.addWorktree(repoDir, `${repoDir}/.worktrees/${id}`, spec.branchFrom ?? "HEAD");
  } catch (e) {
    throw new LaunchError(`gagal membuat worktree: ${(e as Error).message}`, "worktree");
  }
  await prisma.spec.update({ where: { id: spec.id }, data: { baseSha, headSha: null } });

  const brief = {
    id: spec.id, title: spec.title, source: spec.source,
    priority: spec.priority, objective: spec.objective, payload: spec.payload ?? undefined,
  };
  const s = createSession(spec.projectId, `${repoDir}/.worktrees/${id}`, {
    specId: spec.id, flow: opts.flow, model, effort,
    phaseFile: phaseFilePath(repoDir, id),
    decisionFile: decisionFilePath(repoDir, id),
    prompt: isContinue
      ? continuePrompt(opts.flow, brief, `hanoman/${id}`)
      : startPrompt(opts.flow, brief, `hanoman/${id}`),
  });
  return { id: s.id };
}
