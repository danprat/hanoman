import { z } from "zod";
import { zProject, zBriefPayload, zQaPayload } from "./entities";
import { zProjectKind, zSpecSource, zPriority, zStage } from "./enums";

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
// branchFrom: nullable+optional — `null` mengosongkan (kembali ke default project),
// `undefined` berarti jangan sentuh. stage: revert backward-only (SPEC-167); confirmDelete
// mengizinkan penghapusan artefak setelah dry-run.
export const zPatchSpec = z.object({
  branchFrom: z.string().min(1).nullable().optional(),
  stage: zStage.optional(),
  confirmDelete: z.boolean().optional(),
});
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
  // flow opsional (SPEC-166): "reverse" = sesi project-level di worktree-nya sendiri,
  // menyusun Source of Truth dari kode. Tanpa flow = terminal biasa di repoDir.
  z.object({ project: z.string(), flow: z.literal("reverse").optional() }),
  z.object({ spec: z.string(), flow: zFlow }),
]);

export const zDocFileContent = z.object({ content: z.string() });
export const zDocIndexCat = z.object({
  cat: z.string(), files: z.array(z.string()), linked: z.boolean(),
  scored: z.boolean(), root: z.boolean().optional() });
export const zDocIndex = z.object({ coverage: z.number(), tree: z.array(zDocIndexCat) });

// SPEC-164 · modul VPS. host/user masuk ke argv ssh dan (user) ke string perintah
// `sudo -n env SSH_USER=…` — regex ini trust boundary, bukan kosmetik.
const HOST_RE = /^[A-Za-z0-9._-]+$/;
const USER_RE = /^[a-z_][a-z0-9_-]*$/i;
export const zCreateVps = z.object({
  name: z.string().min(1), host: z.string().min(1).regex(HOST_RE),
  user: z.string().min(1).regex(USER_RE),
  port: z.number().int().min(1).max(65535).default(22),
  keyPath: z.string().min(1).optional(),
  // SPEC-165 · transien: dipakai sekali untuk memasang key hanoman, lalu dibuang.
  // TIDAK PERNAH disimpan, di-log, atau dikembalikan. Bila diisi, `keyPath` diabaikan.
  password: z.string().min(1).optional(),
});
// Tanpa default: PATCH {name} tak boleh diam-diam mengembalikan port ke 22.
export const zPatchVps = z.object({
  name: z.string().min(1), host: z.string().min(1).regex(HOST_RE),
  user: z.string().min(1).regex(USER_RE),
  port: z.number().int().min(1).max(65535),
  keyPath: z.string().min(1).nullable(), // null = kembali ke key default server
  password: z.string().min(1),           // SPEC-165 · diisi = bootstrap ulang
}).partial();
export const zVpsCheck = z.object({
  check: z.string(), status: z.enum(["pass", "fail", "warn"]), detail: z.string() });
export type VpsCheck = z.infer<typeof zVpsCheck>;
export type VpsHealth = { uptime: string; disk: string; mem: string; load: string };
export type VpsView = {
  id: string; name: string; host: string; port: number; user: string; keyPath: string | null;
  createdAt: string; lastSeenAt: string | null; health: VpsHealth | null;
  lastAuditAt: string | null; audit: VpsCheck[] | null; hardened: boolean;
};
