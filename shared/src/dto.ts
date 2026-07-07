import { z } from "zod";
import { zProject, zBriefPayload, zQaPayload } from "./entities";
import { zProjectKind, zSpecSource, zPriority, zStage, zTriggerType, zTriggerTarget } from "./enums";

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

export const zAdvanceResult = z.object({ id: z.string(), stage: zStage });
export const zDocFileContent = z.object({ content: z.string() });
export const zDocIndexCat = z.object({
  cat: z.string(), files: z.array(z.string()), linked: z.boolean(), root: z.boolean().optional() });
export const zDocIndex = z.object({ coverage: z.number(), tree: z.array(zDocIndexCat) });
