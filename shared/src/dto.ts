import { z } from "zod";
import { zProject, zBriefPayload, zQaPayload } from "./entities";
import { zProjectKind, zSpecSource, zPriority, zTriggerType, zTriggerTarget } from "./enums";

export const zCreateProject = z.object({
  name: z.string().min(1), kind: zProjectKind, repoDir: z.string().optional(),
  desc: z.string().default("") });
export const zCreateSpec = z.object({
  project: z.string(), source: zSpecSource, title: z.string().min(1),
  priority: zPriority, payload: z.union([zBriefPayload, zQaPayload]) });
export const zCreateTrigger = z.object({
  project: z.string(), type: zTriggerType, detail: z.string(), target: zTriggerTarget });

export const zRunSummary = z.object({
  status: z.string(), phase: z.string().nullable(), kind: z.string().nullable() });
export const zProjectView = zProject.extend({
  backlog: z.number().int(), topStage: z.string(), run: zRunSummary,
  activity: z.string(), commit: z.string() });
export type ProjectView = z.infer<typeof zProjectView>;

export const zStartRun = z.object({
  project: z.string(),
  flow: z.enum(["feature", "qa", "scaffold", "reverse"]),
  specId: z.string().optional(),
  branchFrom: z.string().default("main"),
  branchTo: z.string().optional(),
});
export const zControlAction = z.enum(["pause", "resume", "stop", "retry"]);
export const zControl = z.object({ action: zControlAction });
export const zSteer = z.object({ message: z.string().min(1) });
export const zWorktreePatch = z.object({ branchFrom: z.string().optional(), branchTo: z.string().optional() });
export const zCommand = z.object({ text: z.string().min(1) });

// Sesi terminal dibuka untuk sebuah project (repoDir-nya) atau untuk sebuah run —
// yang terakhir me-resume sesi claude milik run itu di dalam worktree-nya (SPEC-013).
export const zTerminalSession = z.union([
  z.object({ project: z.string() }),
  z.object({ run: z.string() }),
]);

export const zDocFileContent = z.object({ content: z.string() });
export const zDocIndexCat = z.object({
  cat: z.string(), files: z.array(z.string()), linked: z.boolean(),
  scored: z.boolean(), root: z.boolean().optional() });
export const zDocIndex = z.object({ coverage: z.number(), tree: z.array(zDocIndexCat) });
