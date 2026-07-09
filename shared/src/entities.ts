import { z } from "zod";
import { zStage, zSpecSource, zRunStatus, zRunKind, zTriggerType, zTriggerTarget,
  zDocStatus, zPriority, zProjectKind } from "./enums";

export type Stage = z.infer<typeof zStage>;

export const zProject = z.object({
  id: z.string(), name: z.string(), desc: z.string(), kind: zProjectKind,
  repoDir: z.string().nullable().optional(), repoUrl: z.string().nullable().optional(),
  stack: z.string().default(""),                       // ADR-0004
  docStatus: zDocStatus, coverage: z.number().int().min(0).max(100),
  createdAt: z.string(),
});
export type Project = z.infer<typeof zProject>;

export const zBriefPayload = z.object({
  context: z.string(), outcome: z.string(), constraints: z.string(), priority: zPriority });
export const zQaPayload = z.object({
  severity: z.enum(["critical","major","minor"]), steps: z.string(),
  expected: z.string(), actual: z.string(), env: z.string() });

export const zSpec = z.object({
  id: z.string(), projectId: z.string(), title: z.string(), source: zSpecSource,
  stage: zStage, priority: zPriority, author: z.string(), objective: z.string(),
  payload: z.union([zBriefPayload, zQaPayload]).nullable(),
  branchFrom: z.string().nullable(),                   // SPEC-143 · null = default project (main)
});
export type Spec = z.infer<typeof zSpec>;

const zPhase = z.object({ name: z.string(), state: z.enum(["done","active","failed","pending","skipped"]) });
export const zRun = z.object({
  id: z.string(), projectId: z.string(), specId: z.string().nullable(),
  kind: zRunKind, status: zRunStatus, trigger: zTriggerType, triggerDetail: z.string(),
  phases: z.array(zPhase), plan: z.array(z.object({ label: z.string(), state: z.string() })),
  log: z.array(z.object({ t: z.string(), s: z.string() })),
  worktree: z.string(), branchFrom: z.string(), branchTo: z.string(),
  baseSha: z.string().nullable(), headSha: z.string().nullable(),
  model: z.string(), tokensIn: z.string(), tokensOut: z.string(),
  cost: z.string(), progress: z.number(),
  createdAt: z.string(), finishedAt: z.string().nullable(),
});
export type Run = z.infer<typeof zRun>;

export const zTrigger = z.object({
  id: z.string(), projectId: z.string(), type: zTriggerType, detail: z.string(),
  target: zTriggerTarget, enabled: z.boolean() });
export type Trigger = z.infer<typeof zTrigger>;

export const zStepModel = z.object({ model: z.string(), effort: z.string() });
export const zSetting = z.object({
  steps: z.object({ brainstorm: zStepModel, spec: zStepModel, plan: zStepModel,
    execute: zStepModel, audit: zStepModel }),
  autoDefault: z.boolean(), blockStale: z.boolean(), requireLinks: z.boolean(),
  autoScaffold: z.boolean(), maxConcurrent: z.number().int(),
  notifyFail: z.boolean() });
export type Setting = z.infer<typeof zSetting>;

export const zDocFile = z.object({
  projectId: z.string(), path: z.string(), category: z.string(),
  content: z.string(), linked: z.boolean(), root: z.boolean() });
export type DocFile = z.infer<typeof zDocFile>;
