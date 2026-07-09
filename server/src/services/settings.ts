import { prisma } from "../db";
import type { Setting } from "@hanoman/shared";
import type { StepModels } from "@hanoman/runner";

// Valid Claude model id + effort the runner passes straight to `claude --effort`.
const STEP = { model: "claude-opus-4-8", effort: "xhigh" };
// A fresh DB has no Setting row (it's created on the first PUT /settings). Fall
// back to these defaults so the worker/triggers/runs boot instead of throwing
// P2025. Mirrors the original prototype seed (commit ca20bf8).
export const DEFAULT_SETTING: Setting = {
  steps: { brainstorm: STEP, spec: STEP, plan: STEP, execute: STEP, audit: STEP },
  autoDefault: true, blockStale: true, requireLinks: true, autoScaffold: true,
  maxConcurrent: 3, notifyFail: true,
};
export async function getSetting(): Promise<Setting> {
  return ((await prisma.setting.findUnique({ where: { id: 1 } }))?.data as Setting | undefined) ?? DEFAULT_SETTING;
}
export async function stepModels(): Promise<StepModels> { return (await getSetting()).steps; }
export async function maxConcurrent(): Promise<number> { return (await getSetting()).maxConcurrent ?? 3; }
