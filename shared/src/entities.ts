import { z } from "zod";
import { zStage, zSpecSource, zDocStatus, zPriority, zProjectKind } from "./enums";

export type Stage = z.infer<typeof zStage>;

export const zProject = z.object({
  id: z.string(), name: z.string(), desc: z.string(), kind: zProjectKind,
  repoDir: z.string().nullable().optional(),
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
  baseSha: z.string().nullable(),                      // SPEC-186 · null = belum pernah ada sesi (belum dimulai)
});
export type Spec = z.infer<typeof zSpec>;

// SPEC-180/184 · nada notifikasi (aset .wav di src/public/sounds). "off" = senyap.
const NOTIFY_SOUNDS = ["off", "short", "medium", "long",
  "blip", "pop", "ping", "coin", "alert", "chime", "success", "bell", "marimba", "fanfare"] as const;

// SPEC-162 · satu model per sesi interaktif, dipakai sebagai argv saat sesi lahir. Manusia
// tetap bebas mengetik `/model` di dalam terminal. `steps` (model per fase), `maxConcurrent`,
// dan `askTimeoutMin` hilang bersama runner headless.
export const zSetting = z.object({
  model: z.string().default("claude-opus-4-8"),
  effort: z.string().default("xhigh"),
  autoDefault: z.boolean(),
  autoScaffold: z.boolean(),
  notifyFail: z.boolean(),
  notifyDone: z.boolean().default(true),                                   // SPEC-180
  notifySound: z.enum(NOTIFY_SOUNDS).default("short"),                     // SPEC-180
  notifyDecision: z.boolean().default(true),                              // SPEC-184
  notifyDecisionSound: z.enum(NOTIFY_SOUNDS).default("alert"),            // SPEC-184
});
export type Setting = z.infer<typeof zSetting>;

// SPEC-180/184 · notifikasi. type done|decision; specId null untuk sesi reverse; sessionId
// = target redirect terminal. Tanggal = string ISO (JSON). readAt null = unread.
export const zNotification = z.object({
  id: z.string(),
  type: z.enum(["done", "decision"]).default("done"),
  specId: z.string().nullable(),
  sessionId: z.string().nullable(),
  title: z.string(),
  projectId: z.string().nullable(),
  createdAt: z.string(), readAt: z.string().nullable(),
});
export type Notification = z.infer<typeof zNotification>;

export const zDocFile = z.object({
  projectId: z.string(), path: z.string(), category: z.string(),
  content: z.string(), linked: z.boolean(), root: z.boolean() });
export type DocFile = z.infer<typeof zDocFile>;

// SPEC-213 · ADR-0044 · view device token (tanpa tokenHash / plaintext). Tanggal = string ISO.
export const zDeviceTokenView = z.object({
  id: z.string(), name: z.string(), createdAt: z.string(),
  lastSeenAt: z.string().nullable(), revokedAt: z.string().nullable(),
});
export type DeviceTokenView = z.infer<typeof zDeviceTokenView>;
