import type { Flow } from "./types";
import { PIPELINES } from "./prompt";

// SPEC-332 · ADR-0073 — mode goal. Claude Code memasang `/goal` sebagai Stop hook bertipe `prompt`
// dan menolak kondisi > 4000 karakter; angka ini menyalin batas itu.
export const GOAL_MAX = 4000;

export type GoalArgs = { flow: Flow; specId: string; branchTo: string };

// Evaluator hook `prompt` berjalan dengan instruksi "Answer based on transcript evidence only" —
// ia TIDAK punya tool, dan transkrip Stop yang panjang DIPOTONG (bukti di prefix yang dibuang
// dianggap tak cukup). Karena itu kondisi ini menuntut BUKTI SEGAR: output perintah verifikasi di
// transkrip terbaru, bukan klaim agen bahwa pekerjaannya sudah selesai.
export function defaultGoalCondition({ flow, specId, branchTo }: GoalArgs): string {
  const phases = PIPELINES[flow];
  // Gate plan hanya berlaku untuk flow ber-fase Plan+Execute (cermin phaseInstruction & ADR-0029).
  const planGate = phases.includes("Plan") && phases.includes("Execute");
  const clauses = [
    `1. output \`cat "$HANOMAN_PHASE_FILE"\` yang memuat satu baris untuk SETIAP fase `
      + `${phases.join(" → ")}, masing-masing berakhiran \`done\` atau \`skipped\`;`,
  ];
  if (planGate) {
    clauses.push(
      `2. output \`grep -rn -- "- \\[ \\]" docs/superpowers/plans/\` yang KOSONG untuk plan backlog `
      + `ini — tak ada task yang masih \`- [ ]\` (atau bukti bahwa backlog ini memang tak berplan);`,
    );
  }
  clauses.push(
    `${planGate ? 3 : 2}. output \`git push origin HEAD:refs/heads/${branchTo}\` yang SUKSES `
    + `sesudah commit terakhir.`,
  );
  return [
    `Sesi backlog hanoman ${specId} (flow ${flow}) hanya boleh berhenti bila transkrip TERBARU `
      + `memuat bukti langsung semua hal berikut:`,
    ...clauses,
    `Bila salah satu bukti tak ada di transkrip terbaru, kondisi BELUM terpenuhi: jalankan perintah `
      + `verifikasinya, tuntaskan yang masih kurang, lalu lanjutkan — jangan berhenti.`,
  ].join("\n");
}

// Presedens: override per sesi → template global → default bawaan. String kosong/hanya-spasi
// dianggap tak ada. Dipangkas ke GOAL_MAX supaya Claude Code tak menolak kondisinya.
export function resolveGoalCondition(
  a: GoalArgs, override?: string | null, template?: string | null,
): string {
  const picked = [override, template].find((c) => typeof c === "string" && c.trim() !== "");
  return (picked ? picked.trim() : defaultGoalCondition(a)).slice(0, GOAL_MAX);
}

// tmux `send-keys`: satu Enter = submit. Kondisi multi-baris harus diratakan sebelum diketik ke
// TUI, kalau tidak ia terkirim separuh dan sisanya jadi pesan liar.
export const goalOneLine = (cond: string): string => cond.replace(/\s+/g, " ").trim();
