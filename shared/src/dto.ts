import { z } from "zod";
import { zProject, zBriefPayload, zQaPayload } from "./entities";
import { zProjectKind, zSpecSource, zPriority } from "./enums";

export const zCreateProject = z.object({
  name: z.string().min(1), kind: zProjectKind, repoDir: z.string().optional(),
  desc: z.string().default("") });
// SPEC-146: hanya label tampilan. `id` memikul kunci asing Spec; `kind`,
// `repoDir` dan `stack` menentukan tempat sesi/scan/terminal hidup. Body
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
