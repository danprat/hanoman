import type { Stage } from "@hanoman/shared";
export const STAGES = ["brainstorming","objective","spec-ready","planned","executing","done"] as const;
const TOAST: Record<string, string> = {
  objective: "objective terkunci", "spec-ready": "spec ditulis", planned: "plan dibuat",
  executing: "execute dimulai", done: "selesai — docs tersinkron",
};
export function nextStage(current: Stage): Stage | null {
  const i = STAGES.indexOf(current);
  return i < 0 || i >= STAGES.length - 1 ? null : STAGES[i + 1]!;
}
export function advance(current: Stage) {
  const stage = nextStage(current);
  return stage ? { stage, toastEvent: TOAST[stage] ?? stage } : null;
}
