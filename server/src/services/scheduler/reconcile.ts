import { prisma } from "../../db";
import type { Stage } from "@hanoman/shared";
import { realGit, type Flow } from "@hanoman/runner";
import { listQueue, markDone, markFailed } from "./queue";
import { recordCompletion, recordFailure } from "../notifications";
import { recordSessionResult } from "../session-result";
import { STAGES } from "../stage-machine";
import { notifySynced } from "../sync-notify";
import { getSession } from "../pty";
import { readPhases, stageForRun } from "../session-phases";

// SPEC-298 · ADR-0072 (daun #5) · rekonsiliasi akhir sesi scheduler. Dipanggil engine.tick
// (loop selalu-hidup) — satu-satunya jalur andal untuk sesi tak-berpengawas: advanceStage butuh
// terminal attach, liveSpecs butuh klien events. Deps di-inject (teruji tanpa tmux/git/fs), pola
// GovernorDeps. TANPA auto-merge (branch dibiarkan untuk merge manual, ADR-0031) & TANPA retry
// (PRD non-goal — cegah pembakaran usage).
export type ReconcilePane = { exited: boolean; flow?: Flow; phaseFile?: string; cwd: string } | undefined;
export type ReconcileDeps = {
  pane: (sessionId: string) => ReconcilePane;                                   // getSession projeksi
  deriveStage: (phaseFile: string, flow: Flow, cwd: string, specId: string) => Stage | null; // stageForRun(readPhases…)
  headSha: (worktree: string) => string | null;                                // realGit.headSha best-effort
};

const FAIL_REASON = "sesi berakhir sebelum mencapai done (gagal/limit)";

export async function reconcile(deps: ReconcileDeps): Promise<void> {
  for (const item of await listQueue("launched")) {
    try {
      const spec = await prisma.spec.findUnique({ where: { id: item.specId } });
      if (!spec) { await markFailed(item.id, "spec hilang"); continue; }
      const p = deps.pane(item.sessionId ?? "");

      // Stage LIVE diturunkan langsung dari berkas fase (independen pengawas). Persist maju via CAS.
      let stage = spec.stage as Stage;
      if (p?.flow && p.phaseFile) {
        const d = deps.deriveStage(p.phaseFile, p.flow, p.cwd, item.specId);
        if (d && STAGES.indexOf(d) > STAGES.indexOf(stage)) {
          const { count } = await prisma.spec.updateMany({ where: { id: item.specId, stage }, data: { stage: d } });
          if (count > 0) await notifySynced("spec", item.specId).catch(() => {});
          stage = d;
        }
      }

      if (stage === "done") {
        await recordCompletion(item.specId, spec.title, spec.projectId);        // notif done (idempoten key)
        // Ringkasan/diff review: SessionResult (diff turunan baseSha..headSha). Dedup vs advanceStage.
        const existing = await prisma.sessionResult.findFirst({ where: { specId: item.specId, newStage: "done" } });
        if (!existing) {
          await recordSessionResult({
            projectId: spec.projectId, specId: item.specId, newStage: "done",
            commitSha: p?.cwd ? deps.headSha(p.cwd) : null,
            branch: `hanoman/${item.sessionId}`, status: "done",
          }).catch(() => {});
        }
        await markDone(item.id);                                                 // TAK auto-merge: branch dibiarkan
      } else if (!p || p.exited) {
        // Pane mati/gone sebelum done = gagal/limit. Tandai + notif fail. TANPA retry.
        await recordFailure(item.specId, spec.title, spec.projectId, FAIL_REASON);
        await markFailed(item.id, FAIL_REASON);
      }
      // else: pane hidup & stage < done → masih kerja / menunggu keputusan → biarkan launched (tahan slot).
    } catch { /* satu item gagal rekonsil tak menghentikan sisanya */ }
  }
}

// Deps produksi: pane dari tmux (getSession), stage dari berkas fase, headSha dari git (best-effort).
export const reconcileProdDeps: ReconcileDeps = {
  pane: (sessionId) => {
    const s = getSession(sessionId);
    return s ? { exited: s.exited, flow: s.flow, phaseFile: s.phaseFile, cwd: s.cwd } : undefined;
  },
  deriveStage: (phaseFile, flow, cwd, specId) => stageForRun(readPhases(phaseFile, flow), cwd, specId),
  headSha: (wt) => { try { return realGit.headSha(wt); } catch { return null; } },
};
