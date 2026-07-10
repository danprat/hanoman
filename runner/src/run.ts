import { existsSync, rmSync } from "node:fs";
import type { Ask, OpenSession, RunEvent, RunInput, RunResult, GitOps, CliMessage } from "./types";
import { PIPELINES, phasePrompt, stepFor, readDecision, readAsk, DECISION_FILE, ASK_FILE, QA_PLANNING } from "./phases";
import { DENY, runPhase, type StepState } from "./phase";
import { takeTurn } from "./turns";
import { SteerQueue } from "./steer-queue";

export interface RunDeps {
  openSession: OpenSession; git: GitOps;
  verify: (cwd: string) => { blocked: boolean; reason?: string; error?: string };
}

// ponytail: 5 pertanyaan per fase. Agen bingung bisa bertanya tanpa henti, dan tiap pertanyaan
// membakar satu giliran. Ini satu-satunya loop tak berhingga di jalur ini. Naikkan kalau ada
// alur sah yang melewatinya.
export const MAX_ASKS_PER_PHASE = 5;
const DEFAULT_ASK_TIMEOUT_MS = 30 * 60_000;

type Answer = { value: string; byHuman: boolean };
const optionOf = (ask: Ask, value: string) => ask.options.find((o) => o.value === value);
const labelOf = (ask: Ask, value: string) => optionOf(ask, value)?.label ?? value;

// `null` = run di-abort saat menunggu. Berhenti atas permintaan bukan kegagalan.
// Buffer `SteerQueue` menutup balapan "jawaban ter-publish sebelum next() dipanggil".
function awaitAnswer(ask: Ask, answers: SteerQueue, timeoutMs: number, signal: AbortSignal): Promise<Answer | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: Answer | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(v);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish({ value: ask.default, byHuman: false }), timeoutMs);
    signal.addEventListener("abort", onAbort);
    // ponytail: `next()` yang kalah balapan tetap menggantung sampai proses keluar. Satu run =
    // satu proses, dan run yang di-abort sedang menuju penutupan sesi — tak ada yang bocor.
    void answers.next().then((value) => finish({ value, byHuman: true }));
  });
}

// Agen tidak boleh mengira tebakannya sendiri sudah dikonfirmasi manusia.
function answerText(ask: Ask, a: Answer, timeoutMs: number): string {
  const o = optionOf(ask, a.value);
  const tail = `${o?.label ?? a.value} (${a.value})${o?.detail ? ` — ${o.detail}` : ""}`;
  if (a.byHuman) return `Jawaban manusia atas pertanyaanmu: ${tail}`;
  return timeoutMs > 0
    ? `Tidak ada jawaban dalam ${Math.round(timeoutMs / 60_000)}m — memakai pilihanmu sendiri: ${tail}`
    : `Run berjalan tanpa penunggu — memakai pilihanmu sendiri: ${tail}`;
}

export async function runOne(
  input: RunInput, deps: RunDeps, onEvent: (e: RunEvent) => void,
  ctl: { abortController?: AbortController; steer?: SteerQueue; answers?: SteerQueue; askTimeoutMs?: number } = {},
): Promise<RunResult> {
  const abortController = ctl.abortController ?? new AbortController();
  const askTimeoutMs = ctl.askTimeoutMs ?? DEFAULT_ASK_TIMEOUT_MS;
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
  // Fase yang dipangkas keputusan audit (SPEC-145). Namanya BUKAN `skipped`: `skipped` di
  // atas sudah dipakai untuk fase yang selesai di percobaan sebelumnya (resume).
  const pruned = new Set<string>();

  onEvent({ kind: "status", status: "running" });
  const baseSha = deps.git.addWorktree(input.repoDir, worktree, input.branchFrom, resuming);
  if (baseSha) onEvent({ kind: "commit", base: baseSha });
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
        if (pruned.has(phase)) { onEvent({ kind: "phase", name: phase, state: "skipped" }); continue; }
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
        // Matching only one of them would silently report the rest as `done`. `subtype` alone is
        // not enough either: an API error mid-turn (502, 401) arrives as `success` + `is_error`,
        // and reading only the subtype marked the phase `done` on a turn that never ran.
        if (r.subtype.startsWith("error") || r.isError) {
          const why = r.apiErrorStatus ? `API ${r.apiErrorStatus}` : r.subtype;
          onEvent({ kind: "log", line: { t: "✗", s: `fase ${phase} gagal · ${why}` } });
          onEvent({ kind: "phase", name: phase, state: "failed" });
          onEvent({ kind: "status", status: "failed" });
          return failed();
        }

        // Agen boleh berhenti dan bertanya (SPEC-157). Fase belum `done` selama masih ada yang
        // ditanyakan: jawabannya menjadi giliran lanjutan dari pekerjaan fase ini, bukan fase baru.
        // `readAsk` mengonsumsi berkasnya, jadi loop ini berhenti sendiri saat agen tak bertanya lagi.
        for (;;) {
          const ask = readAsk(worktree);
          if (!ask) break;
          if (!ctl.answers) break; // tak ada kanal jawaban (mis. `hanoman run` lokal) → jalan terus

          onEvent({ kind: "ask", ask });
          onEvent({ kind: "status", status: "awaiting" });
          const a = await awaitAnswer(ask, ctl.answers, askTimeoutMs, abortController.signal);
          onEvent({ kind: "ask", ask: null });
          if (a === null) { onEvent({ kind: "status", status: "stopped" }); return stopped(); }
          onEvent({ kind: "status", status: "running" });
          onEvent({ kind: "log", line: { t: "»", s: `jawaban: ${labelOf(ask, a.value)}` } });

          const t = await takeTurn(session, answerText(ask, a, askTimeoutMs), onLog);
          costUsd = t.costUsd; tokensIn += t.tokensIn; tokensOut += t.tokensOut;
          if (t.subtype.startsWith("error") || t.isError) {
            const why = t.apiErrorStatus ? `API ${t.apiErrorStatus}` : t.subtype;
            onEvent({ kind: "log", line: { t: "✗", s: `fase ${phase} gagal saat menjawab · ${why}` } });
            onEvent({ kind: "phase", name: phase, state: "failed" });
            onEvent({ kind: "status", status: "failed" });
            return failed();
          }
        }
        onEvent({ kind: "phase", name: phase, state: "done" });

        // Alur qa memilih jalur hilirnya sendiri. Hanya `path: "execute"` yang memangkas;
        // apa pun selainnya (berkas absen, rusak, "spec") membiarkan pipeline utuh.
        if (input.flow === "qa" && phase === "Audit") {
          const d = readDecision(worktree);
          if (d.path === "execute") {
            for (const p of QA_PLANNING) pruned.add(p);
            const why = d.reason ? ` · ${d.reason}` : "";
            onEvent({ kind: "log", line: { t: "›", s: `audit: perbaikan kecil — Spec & Plan dilewati${why}` } });
          }
        }

        // Pesan steer yang tiba selama fase berjalan menjadi giliran tambahan, dikuras sampai
        // habis sebelum fase berikutnya dimulai. Tiap pesan menghasilkan tepat satu `result`,
        // jadi hitungannya tetap cocok.
        for (const msg of ctl.steer?.drain() ?? []) {
          if (abortController.signal.aborted) break;
          const t = await takeTurn(session, msg, onLog);
          costUsd = t.costUsd; tokensIn += t.tokensIn; tokensOut += t.tokensOut;
        }
      }
    } catch (e) {
      // pause/stop mem-abort di tengah giliran: `claude` mati, `next()` mengembalikan null,
      // dan `takeTurn` melempar. Dulu lemparan itu keluar dari runOne → job BullMQ gagal →
      // markFailed menulis `failed` + finishedAt, balapan dengan `paused`/`stopped` milik
      // route. Berhenti atas permintaan bukan kegagalan. Guard di puncak loop hanya menangkap
      // abort yang mendarat di antara fase, dan fase itu panjang. Error lain tetap dilempar.
      if (!abortController.signal.aborted) throw e;
      onEvent({ kind: "status", status: "stopped" });
      return stopped();
    } finally {
      // Menutup stdin adalah satu-satunya cara `claude` keluar. Tanpa ini prosesnya menggantung
      // sampai worker mati — persis deadlock yang dulu menahan fase Execute selamanya.
      session.close();
    }
  }

  if (abortController.signal.aborted) { onEvent({ kind: "status", status: "stopped" }); return stopped(); }
  // Artefak keputusan DAN pertanyaan. `git add -A` men-stage berkas ber-titik di root. Unlink
  // berdiri sendiri di sini, tanpa syarat, karena ada jalur yang tak pernah membaca artefaknya:
  // run yang mati antara fase Audit menulis berkas dan runner membacanya sudah mem-persist
  // `phase done`, sehingga resume melewati Audit sama sekali. `force`: absen bukan error.
  // Mendahului commit — kalau tidak, `add -A` justru men-stage berkas yang mau dibuang ini.
  rmSync(`${worktree}/${DECISION_FILE}`, { force: true });
  rmSync(`${worktree}/${ASK_FILE}`, { force: true });
  const headSha = deps.git.commitAndPush(worktree, `hanoman ${input.flow} ${input.specId ?? ""}`.trim(), input.branchTo, input.remoteUrl);
  onEvent({ kind: "commit", head: headSha });
  deps.git.removeWorktree(input.repoDir, worktree);
  onEvent({ kind: "status", status: "done" });
  return { status: "done", costUsd, tokensIn, tokensOut };
}
