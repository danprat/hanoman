import type { Stage } from "@hanoman/shared";
export const STAGES = ["brainstorming","objective","spec-ready","planned","executing","done"] as const;
export function nextStage(current: Stage): Stage | null {
  const i = STAGES.indexOf(current);
  return i < 0 || i >= STAGES.length - 1 ? null : STAGES[i + 1]!;
}
