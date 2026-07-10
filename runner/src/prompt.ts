import type { Flow, SpecBrief } from "./types";

export const PIPELINES: Record<Flow, readonly string[]> = {
  feature: ["Brainstorm", "Objective", "Spec", "Plan", "Execute"],
  qa: ["Audit", "Spec", "Plan", "Execute"],
  scaffold: ["Brainstorm", "Objective", "Doc index"],
  reverse: ["Scan", "Doc index"],
};

// Agen yang melapor, server yang menonton: di PTY tak ada batas giliran yang terbaca mesin.
// Append, bukan tulis-timpa — keadaan penuh selalu ada di berkasnya, jadi tak ada transisi
// yang bisa terlewat kalau server sedang tidak menonton. Berkasnya di luar worktree, jadi
// `git add -A` milik agen tak mungkin men-stage-nya.
const phaseInstruction = (phases: readonly string[]) =>
  `Kerjakan fase berurutan: ${phases.join(" → ")}.\n`
  + `Setiap kali sebuah fase selesai (atau kamu putuskan dilewati), append satu baris ke berkas `
  + `di $HANOMAN_PHASE_FILE — persis: \`echo "<Nama Fase> done" >> "$HANOMAN_PHASE_FILE"\`, `
  + `atau \`skipped\` sebagai ganti \`done\`. Nama fase ditulis apa adanya seperti di atas.`;

// Peta fase → skill superpowers (SPEC-166). Objective dan Spec adalah keluaran skill
// brainstorming yang di-invoke di fase Brainstorm — sengaja tak punya entri sendiri.
// Fase reverse dipandu standar docs di prompt-nya, bukan skill.
const PHASE_SKILLS: Record<string, readonly string[]> = {
  Brainstorm: ["superpowers:brainstorming"],
  Audit: ["superpowers:systematic-debugging"],
  Plan: ["superpowers:writing-plans"],
  Execute: [
    "superpowers:executing-plans",
    "superpowers:test-driven-development",
    "superpowers:verification-before-completion",
  ],
};

const skillInstruction = (phases: readonly string[]) => {
  const lines = phases
    .filter((p) => PHASE_SKILLS[p])
    .map((p) => `- ${p}: ${PHASE_SKILLS[p]!.join(", ")}`);
  return lines.length
    ? "Skills superpowers WAJIB: sebelum mengerjakan fase di bawah, invoke skill-nya lewat "
      + `Skill tool — bila skill relevan tersedia, pakai.\n${lines.join("\n")}`
    : "";
};

export function startPrompt(flow: Flow, spec: SpecBrief, branchTo: string): string {
  const detail = spec.payload ? `\nDetail: ${JSON.stringify(spec.payload)}` : "";
  return [
    `hanoman ${flow}. Ikuti internal/docs sebagai Source of Truth; perbarui docs yang tersentuh `
      + `dan link-nya di index, dalam commit yang sama.`,
    phaseInstruction(PIPELINES[flow]),
    skillInstruction(PIPELINES[flow]),
    `Setelah fase terakhir: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. `
      + `Worktree ini detached HEAD — itu memang disengaja.`,
    `Backlog item ${spec.id} · sumber ${spec.source} · prioritas ${spec.priority}\n`
      + `Judul: ${spec.title}\nObjective: ${spec.objective}${detail}`,
  ].filter(Boolean).join("\n\n");
}
