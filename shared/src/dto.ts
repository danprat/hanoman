import { z } from "zod";
import { zProject, zBriefPayload, zQaPayload } from "./entities";
import { zProjectKind, zSpecSource, zPriority, zTriggerType, zTriggerTarget } from "./enums";

export const zCreateProject = z.object({
  name: z.string().min(1), kind: zProjectKind, repoDir: z.string().optional(),
  desc: z.string().default("") });
// SPEC-146: hanya label tampilan. `id` memikul kunci asing Spec/Run/Trigger; `kind`,
// `repoDir`, `repoUrl`, dan `stack` menentukan tempat run/scan/terminal hidup. Body
// kosong `{}` sah dan berarti no-op — refinement "minimal satu field" tak menjaga apa pun.
export const zUpdateProject = z.object({
  name: z.string().min(1).optional(),
  desc: z.string().optional(),
});
export const zCreateSpec = z.object({
  project: z.string(), source: zSpecSource, title: z.string().min(1),
  priority: zPriority, payload: z.union([zBriefPayload, zQaPayload]),
  branchFrom: z.string().min(1).optional() });
// nullable, bukan optional: `null` berarti "kosongkan, kembali ke default project",
// dan itu harus terbedakan dari "jangan sentuh".
export const zPatchSpec = z.object({ branchFrom: z.string().min(1).nullable() });
export const zCreateTrigger = z.object({
  project: z.string(), type: zTriggerType, detail: z.string(), target: zTriggerTarget });

// SPEC-162 · yang berjalan adalah sesi tmux, bukan baris Run. `flow` menggantikan `kind`.
export const zSessionSummary = z.object({
  status: z.enum(["running", "idle"]),
  phase: z.string().nullable(),
  flow: z.string().nullable(),
});
export const zProjectView = zProject.extend({
  backlog: z.number().int(), topStage: z.string(), session: zSessionSummary,
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
// Jawaban atas `Run.pendingAsk` (SPEC-157). `value` divalidasi terhadap `options` di route —
// batas kepercayaan: klien tak boleh menyuntik teks sembarang ke stdin agen lewat sini.
export const zAnswer = z.object({ value: z.string().min(1) });

export const zFlow = z.enum(["feature", "qa", "scaffold", "reverse"]);
// Sesi terminal dibuka untuk sebuah project (repoDir-nya, terminal biasa) atau untuk sebuah
// backlog item — yang terakhir lahir di worktree-nya sendiri, dengan prompt awal (SPEC-162).
export const zTerminalSession = z.union([
  z.object({ project: z.string() }),
  z.object({ spec: z.string(), flow: zFlow }),
]);

export const zDocFileContent = z.object({ content: z.string() });
export const zDocIndexCat = z.object({
  cat: z.string(), files: z.array(z.string()), linked: z.boolean(),
  scored: z.boolean(), root: z.boolean().optional() });
export const zDocIndex = z.object({ coverage: z.number(), tree: z.array(zDocIndexCat) });
