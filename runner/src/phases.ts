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
export function phasePrompt(flow: Flow, phase: string, input: RunInput): string {
  const ref = input.specId ? ` ${input.specId}` : "";
  return `hanoman ${flow} — fase ${phase}${ref}. Ikuti internal/docs sebagai Source of Truth. Kerjakan hanya langkah fase ${phase}; perbarui docs yang tersentuh dan link di index.`;
}
