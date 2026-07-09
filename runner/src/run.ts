import { existsSync } from "node:fs";
import type { OpenSession, RunEvent, RunInput, RunResult, GitOps, CliMessage } from "./types";
import { PIPELINES, phasePrompt, stepFor } from "./phases";
import { DENY, runPhase, type StepState } from "./phase";
import { takeTurn } from "./turns";
import { SteerQueue } from "./steer-queue";

export interface RunDeps {
  openSession: OpenSession; git: GitOps;
  verify: (cwd: string) => { blocked: boolean; reason?: string; error?: string };
}

export async function runOne(
  input: RunInput, deps: RunDeps, onEvent: (e: RunEvent) => void,
  ctl: { abortController?: AbortController; steer?: SteerQueue } = {},
): Promise<RunResult> {
  const abortController = ctl.abortController ?? new AbortController();
  const worktree = `${input.repoDir}/.worktrees/${input.runId.toLowerCase()}`;
  // spec/plan run a single phase; otherwise the whole pipeline is walked.
  const all = PIPELINES[input.flow].filter((p) => !input.only || p === input.only);

  // Melanjutkan hanya sah selama artefak fase yang sudah selesai masih ada. Worktree yang
  // hilang — dipangkas, atau dihapus run yang sukses — memaksa mulai dari nol: sesi yang
  // ingat "plan sudah kutulis" di atas worktree kosong jauh lebih buruk daripada mengulang.
  const resuming = Boolean(input.resume) && existsSync(worktree);
  const skipped = resuming ? all.filter((p) => (input.donePhases ?? []).includes(p)) : [];
  const phases = all.filter((p) => !skipped.includes(p));

  let costUsd = 0, tokensIn = 0, tokensOut = 0;
  let sessionId: string | undefined = resuming ? input.resume : undefined;
  const stopped = (): RunResult => ({ status: "stopped", costUsd, tokensIn, tokensOut });
  const failed = (): RunResult => ({ status: "failed", costUsd, tokensIn, tokensOut });

  onEvent({ kind: "status", status: "running" });
  deps.git.addWorktree(input.repoDir, worktree, input.branchFrom, resuming);
  if (skipped.length) {
    onEvent({ kind: "log", line: { t: "›", s: `melanjutkan sesi ${input.resume} — fase selesai dilewati: ${skipped.join(", ")}` } });
  }

  const onLog = (m: CliMessage) => {
    if (m.type !== "assistant") return;
    for (const b of m.message.content) {
      if (b.type === "text" && b.text) onEvent({ kind: "log", line: { t: "›", s: b.text } });
    }
  };

  // Seluruh fase sudah selesai di percobaan sebelumnya — yang tersisa hanya commit+push.
  // Membuka sesi claude di sini hanya membakar token untuk tidak mengerjakan apa pun.
  if (phases.length) {
    // Satu proses `claude` untuk seluruh backlog. Model/effort fase pertama masuk lewat argv;
    // fase berikutnya menggesernya lewat `/model` + `/effort` di dalam sesi yang sama.
    const first = input.steps[stepFor(phases[0]!)];
    const current: StepState = { model: first.model, effort: first.effort };
    const session = deps.openSession({
      cwd: worktree, model: first.model, effort: first.effort,
      abortController, disallowedTools: DENY, settingSources: ["user", "project", "local"],
      resume: resuming ? input.resume : undefined,
    });

    try {
      for (const phase of phases) {
        if (abortController.signal.aborted) { onEvent({ kind: "status", status: "stopped" }); return stopped(); }
        onEvent({ kind: "phase", name: phase, state: "active" });

        if (phase === "Execute") {
          const v = deps.verify(worktree);
          if (v.error !== undefined || v.blocked) {
            const why = v.error !== undefined
              ? `guardrail tool error · ${v.error}`
              : `plan diblok · ${v.reason ?? "docs stale (Source of Truth)"}`;
            onEvent({ kind: "log", line: { t: "✗", s: why } });
            onEvent({ kind: "phase", name: phase, state: "failed" });
            onEvent({ kind: "status", status: "failed" });
            return failed();
          }
        }

        const r = await runPhase({ session, step: input.steps[stepFor(phase)], current,
          prompt: phasePrompt(input.flow, phase, input), onEvent });
        // total_cost_usd kumulatif per sesi; usage.*_tokens per giliran (claude v2.1.205).
        costUsd = r.costUsd; tokensIn += r.tokensIn; tokensOut += r.tokensOut;
        if (!sessionId && r.sessionId) { sessionId = r.sessionId; onEvent({ kind: "session", sessionId }); }

        // Any error_* subtype (error_during_execution, error_max_turns, …) is a failed phase.
        // Matching only one of them would silently report the rest as `done`.
        if (r.subtype.startsWith("error")) {
          onEvent({ kind: "log", line: { t: "✗", s: `fase ${phase} gagal · ${r.subtype}` } });
          onEvent({ kind: "phase", name: phase, state: "failed" });
          onEvent({ kind: "status", status: "failed" });
          return failed();
        }
        onEvent({ kind: "phase", name: phase, state: "done" });

        // Pesan steer yang tiba selama fase berjalan menjadi giliran tambahan, dikuras sampai
        // habis sebelum fase berikutnya dimulai. Tiap pesan menghasilkan tepat satu `result`,
        // jadi hitungannya tetap cocok.
        for (const msg of ctl.steer?.drain() ?? []) {
          if (abortController.signal.aborted) break;
          const t = await takeTurn(session, msg, onLog);
          costUsd = t.costUsd; tokensIn += t.tokensIn; tokensOut += t.tokensOut;
        }
      }
    } finally {
      // Menutup stdin adalah satu-satunya cara `claude` keluar. Tanpa ini prosesnya menggantung
      // sampai worker mati — persis deadlock yang dulu menahan fase Execute selamanya.
      session.close();
    }
  }

  if (abortController.signal.aborted) { onEvent({ kind: "status", status: "stopped" }); return stopped(); }
  deps.git.commitAndPush(worktree, `hanoman ${input.flow} ${input.specId ?? ""}`.trim(), input.branchTo, input.remoteUrl);
  deps.git.removeWorktree(input.repoDir, worktree);
  onEvent({ kind: "status", status: "done" });
  return { status: "done", costUsd, tokensIn, tokensOut };
}
