import type { ProjectView, Run, Spec, Trigger } from "@hanoman/shared";

// View models: API entities enriched in App with the derived fields the
// prototype screens expect (per-project trigger types; run title/project/phase).
export type ProjectVM = ProjectView & { triggers: string[] };
export type RunVM = Run & { project: string; spec: string | null; title: string; phase: string | null; duration: string };
export type { Spec, Trigger };
