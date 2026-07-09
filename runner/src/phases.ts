import type { Flow, RunInput, StepModels } from "./types";
export const PIPELINES: Record<Flow, readonly string[]> = {
  feature: ["Brainstorm", "Objective", "Spec", "Plan", "Execute"],
  qa: ["Audit", "Spec", "Plan", "Execute"],
  scaffold: ["Brainstorm", "Objective", "Doc index"],
  reverse: ["Scan", "Doc index"],
};
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
export function phasePrompt(flow: Flow, phase: string, input: RunInput): string {
  const scope = input.specId
    ? `Kerjakan hanya langkah fase ${phase} untuk backlog item di bawah — jangan kerjakan pekerjaan lain.`
    : `Kerjakan hanya langkah fase ${phase}.`;
  return `hanoman ${flow} — fase ${phase}. Ikuti internal/docs sebagai Source of Truth. ${scope} Perbarui docs yang tersentuh dan link di index.${specBlock(input)}`;
}
