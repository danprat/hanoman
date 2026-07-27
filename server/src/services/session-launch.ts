import { prisma } from "../db";
import type { Spec } from "@prisma/client";
import { realGit, startPrompt, continuePrompt, resolveGoalCondition, type Flow, type Autonomy } from "@hanoman/runner";
import type { Agent } from "@hanoman/shared";
import { resolveRepoDir } from "./local-binding";
import { getSetting } from "./settings";
import { ensureCodexTrust } from "./codex-trust";
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
  spec: Spec,
  opts: {
    flow: Flow; model?: string; effort?: string; autonomy?: Autonomy;
    // SPEC-332 · ADR-0073 · mode goal per sesi. undefined → ikut Setting.goal.enabled;
    // false → mati walau global menyala. Governor scheduler tak memasoknya → ikut global.
    goal?: boolean; goalCondition?: string;
    // SPEC-338 · ADR-0074 · mesin sesi. undefined → ikut Setting.agent. Governor scheduler tak
    // memasoknya → ikut default global, seperti model/effort.
    agent?: Agent;
  },
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
  // Satu bacaan Setting dipakai bersama resolusi mode goal di bawah.
  const setting = await getSetting();
  // SPEC-338 · ADR-0074 · agen menentukan blok model/effort mana yang jadi default. Override per
  // sesi (opts.model/opts.effort) tetap menang, apa pun agennya.
  const agent: Agent = opts.agent ?? setting.agent;
  const agentDefaults = agent === "codex"
    ? { model: setting.codex.model, effort: setting.codex.effort }
    : { model: setting.model, effort: setting.effort };
  const model = opts.model ?? agentDefaults.model;
  const effort = opts.effort ?? agentDefaults.effort;
  const isContinue = spec.stage === "done";
  // SPEC-332 · ADR-0073 · kondisi goal: override sesi → template global → default DoD bawaan.
  const goal = (opts.goal ?? setting.goal.enabled)
    ? resolveGoalCondition(
        { flow: opts.flow, specId: spec.id, branchTo: `hanoman/${id}` },
        opts.goalCondition, setting.goal.condition)
    : undefined;

  // Worktree lahir `--detach` di commit branchFrom (fallback HEAD, SPEC-197): sesi tak pernah jalan
  // di working tree utama. baseSha disimpan agar review men-diff baseSha..headSha (SPEC-176/ADR-0030).
  // SPEC-338 · buka gerbang trust codex untuk ROOT REPO sebelum worktree lahir — worktree
  // mewarisi trust root, jadi cukup sekali per project. Gagal-diam di dalam.
  if (agent === "codex") ensureCodexTrust(repoDir);

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
    specId: spec.id, flow: opts.flow, model, effort, goal, agent,
    phaseFile: phaseFilePath(repoDir, id),
    decisionFile: decisionFilePath(repoDir, id),
    prompt: isContinue
      ? continuePrompt(opts.flow, brief, `hanoman/${id}`, opts.autonomy)
      : startPrompt(opts.flow, brief, `hanoman/${id}`, opts.autonomy),
  });
  return { id: s.id };
}
