import { readFileSync } from "node:fs";
import type { Flow, RunInput, StepModels } from "./types";
export const PIPELINES: Record<Flow, readonly string[]> = {
  feature: ["Brainstorm", "Objective", "Spec", "Plan", "Execute"],
  qa: ["Audit", "Spec", "Plan", "Execute"],
  scaffold: ["Brainstorm", "Objective", "Doc index"],
  reverse: ["Scan", "Doc index"],
};

// Artefak keputusan pasca-Audit (SPEC-145). Ditulis agen di root worktree, dibaca `runOne`,
// dan dihapus TANPA SYARAT sebelum commit — `git add -A` men-stage berkas ber-titik di root,
// jadi artefak yang tertinggal akan mendarat di `branchTo` milik repo project.
export const DECISION_FILE = ".hanoman-decision.json";

// Fase perencanaan alur qa. Dinamai, bukan `PIPELINES.qa.slice(1, -1)`: yang dilewati adalah
// "merencanakan", bukan "apa pun yang kebetulan berada di antara Audit dan Execute".
export const QA_PLANNING = ["Spec", "Plan"] as const;

export type Decision = { path: "execute" | "spec"; reason?: string };

// HANYA `path === "execute"` yang memilih jalur cepat. Berkas hilang, JSON rusak, bukan objek,
// `path` tak dikenal (termasuk "none" di masa depan) → jalur penuh. Fail-safe secara konstruksi.
// Tidak pernah melempar: yang gagal di sini sebuah optimasi, bukan guardrail (bandingkan ADR-0009).
export function readDecision(worktree: string): Decision {
  try {
    const j = JSON.parse(readFileSync(`${worktree}/${DECISION_FILE}`, "utf8")) as Record<string, unknown>;
    if (j?.path !== "execute") return { path: "spec" };
    return typeof j.reason === "string" ? { path: "execute", reason: j.reason } : { path: "execute" };
  } catch { return { path: "spec" }; }
}
const STEP: Record<string, keyof StepModels> = {
  Brainstorm: "brainstorm", Objective: "brainstorm", Spec: "spec", Plan: "plan",
  Execute: "execute", Audit: "audit", "Doc index": "spec", Scan: "audit",
};
export const stepFor = (phase: string): keyof StepModels => STEP[phase] ?? "execute";
// The spec block is what ties a run to the backlog item that spawned it: the id
// alone is not resolvable from inside the worktree (specs live in Postgres, not
// in the repo), so it has to be spelled out in the prompt.
function specBlock(input: RunInput): string {
  const s = input.spec;
  if (!s) return input.specId ? `\n\nBacklog item: ${input.specId} (detail tidak termuat).` : "";
  const detail = s.payload ? `\nDetail: ${JSON.stringify(s.payload)}` : "";
  return `\n\nBacklog item ${s.id} · sumber ${s.source} · prioritas ${s.priority}\nJudul: ${s.title}\nObjective: ${s.objective}${detail}`;
}
// Fase Audit alur qa memilih jalur hilirnya sendiri. Instruksinya dipancarkan tanpa syarat —
// `hanoman qa --only Audit` menuliskan artefaknya, tak punya fase hilir untuk dipangkas, dan
// unlink pra-commit tetap membersihkannya. Satu cabang lebih sedikit.
const DECIDE = `\n\nSebelum menutup fase ini, tulis keputusan jalur ke \`${DECISION_FILE}\` di root worktree: `
  + `{"path":"execute"|"spec","reason":"<satu kalimat>"}. `
  + `Pilih "execute" HANYA bila seluruhnya benar: perbaikannya terlokalisasi (satu–dua berkas), `
  + `tidak menuntut keputusan desain, tidak menyentuh skema database maupun kontrak API, dan kamu `
  + `yakin dapat menyelesaikannya tanpa spec dan plan. Saat ragu, pilih "spec".`;

export function phasePrompt(flow: Flow, phase: string, input: RunInput): string {
  const scope = input.specId
    ? `Kerjakan hanya langkah fase ${phase} untuk backlog item di bawah — jangan kerjakan pekerjaan lain.`
    : `Kerjakan hanya langkah fase ${phase}.`;
  const decide = flow === "qa" && phase === "Audit" ? DECIDE : "";
  return `hanoman ${flow} — fase ${phase}. Ikuti internal/docs sebagai Source of Truth. ${scope} Perbarui docs yang tersentuh dan link di index.${specBlock(input)}${decide}`;
}
