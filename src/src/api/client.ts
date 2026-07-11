import { paths, type ProjectView, type Spec, type Setting, type Notification, type VpsView, type VpsCheck, type AuthStatus, type UserView, type LimitsDTO } from "@hanoman/shared";
export class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }
export type Flow = "feature" | "qa" | "scaffold" | "reverse";
export type Phase = { name: string; state: "done" | "skipped" | "active" | "pending" };
export type TerminalSession = {
  id: string; projectId: string; specId?: string; flow?: Flow; cwd: string; exited: boolean;
};
// SPEC-167 · respons dry-run PATCH /specs/:id saat revert akan menghapus artefak.
export type RevertPending = { pending: true; stage: string; wouldDelete: string[] };
// SPEC-170 · dokumen backlog item
export type DocKind = "audit" | "spec" | "plan" | "objective" | "brainstorm" | "other";
export type SpecDoc = { kind: DocKind; path: string; name: string };
// SPEC-171 · review worktree backlog item.
export type ChangedFile = { path: string; add: number; del: number; status: "A" | "M" | "D"; binary: boolean };
export type SpecReview = { base: string; files: string[]; changed: ChangedFile[] };
export type ReviewFile = {
  path: string; status: "A" | "M" | "D" | null; binary: boolean;
  truncated: boolean; diff: string | null; content: string | null;
};
// SPEC-182 · IDE Visual
export type RepoFile = { path: string; content: string | null; binary: boolean; truncated: boolean };
export type GraphCommit = { sha: string; parents: string[]; author: string; at: string; subject: string; refs: string[] };
export type CommitDetail = { sha: string; parents: string[]; author: string; at: string; subject: string; body: string; changed: ChangedFile[] };
export type GitOp =
  | { op: "checkout"; ref: string; force?: boolean }
  | { op: "branch"; name: string; at?: string; checkout?: boolean }
  | { op: "merge"; ref: string; ff?: "no-ff" | "ff-only"; force?: boolean }
  | { op: "cherry-pick"; sha: string; force?: boolean }
  | { op: "revert"; sha: string; force?: boolean }
  | { op: "delete-branch"; name: string; force?: boolean };
export type GitOpResult = { ok: boolean; stdout: string; stderr: string; current: string; error?: string };
async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "content-type": "application/json" }, ...init });
  if (!res.ok) throw new ApiError(res.status, `${init?.method ?? "GET"} ${url} → ${res.status}`);
  return res.status === 204 ? (undefined as T) : res.json();
}
const body = (b: unknown) => ({ body: JSON.stringify(b) });
export const api = {
  listProjects: () => j<ProjectView[]>(paths.projects),
  getProject: (id: string) => j<ProjectView>(paths.project(id)),
  createProject: (b: unknown) => j<ProjectView>(paths.projects, { method: "POST", ...body(b) }),
  deleteProject: (id: string) => j<void>(paths.project(id), { method: "DELETE" }),
  // SPEC-146 · hanya label. `id` tak pernah berubah, jadi respons selalu punya `id` yang sama.
  updateProject: (id: string, b: { name?: string; desc?: string }) =>
    j<ProjectView>(paths.project(id), { method: "PATCH", ...body(b) }),
  listSpecs: (q = "") => j<Spec[]>(paths.specs + q),
  createSpec: (b: unknown) => j<Spec>(paths.specs, { method: "POST", ...body(b) }),
  deleteSpec: (id: string) => j<void>(paths.spec(id), { method: "DELETE" }),
  // SPEC-143 · branch sumber worktree milik backlog item. `null` = default project (main).
  // SPEC-175 · `remotes` = branch origin, target rebase/merge.
  listBranches: (id: string) => j<{ branches: string[]; remotes: string[] }>(paths.branches(id)),
  // SPEC-175 · rebase/merge branch hasil done spec.
  integrateSpec: (id: string, op: "merge" | "rebase", target: string) =>
    j<{ status: "clean"; detail: string } | { status: "conflict"; sessionId: string }>(
      paths.specIntegrate(id), { method: "POST", ...body({ op, target }) }),
  patchSpec: (id: string, b: { branchFrom?: string | null; stage?: string; confirmDelete?: boolean;
    title?: string; priority?: string; payload?: unknown }) =>
    j<Spec | RevertPending>(paths.spec(id), { method: "PATCH", ...body(b) }),
  // SPEC-171 · all files + file changed dari worktree backlog item.
  specReview: (id: string) => j<SpecReview>(paths.specReview(id)),
  specReviewFile: (id: string, path: string) => j<ReviewFile>(paths.specReviewFile(id, path)),
  getSettings: () => j<Setting>(paths.settings),
  putSettings: (b: unknown) => j<Setting>(paths.settings, { method: "PUT", ...body(b) }),
  // SPEC-180 · notifikasi backlog selesai
  listNotifications: () => j<{ items: Notification[]; unread: number }>(paths.notifications),
  markNotificationsRead: () => j<void>(paths.notifications + "/read", { method: "POST" }),
  clearNotifications: () => j<void>(paths.notifications, { method: "DELETE" }),
  getLimits: () => j<LimitsDTO>(paths.limits),
  getDocs: (id: string) => j<{ coverage: number; tree: any[] }>(paths.docs(id)),
  getDoc: (id: string, path: string) => j<{ path: string; content: string }>(paths.docFile(id, path)),
  getSpecDocs: (id: string) => j<{ files: SpecDoc[] }>(paths.specDocs(id)),
  getSpecDocFile: (id: string, path: string) => j<{ path: string; content: string }>(paths.specDocFile(id, path)),
  putDoc: (id: string, path: string, content: string) =>
    j<{ path: string; content: string }>(paths.docFile(id, path), { method: "PUT", ...body({ content }) }),
  deleteDoc: (id: string, path: string) => j<void>(paths.docFile(id, path), { method: "DELETE" }),
  ideTree: (id: string, ref = "") => j<{ ref: string; files: string[] }>(paths.ideTree(id, ref)),
  ideFile: (id: string, path: string, ref = "") => j<RepoFile>(paths.ideFile(id, path, ref)),
  putIdeFile: (id: string, path: string, content: string) =>
    j<{ path: string; content: string }>(paths.ideFile(id), { method: "PUT", ...body({ path, content }) }),
  ideGraph: (id: string, limit = 200) => j<{ commits: GraphCommit[]; current: string }>(paths.ideGraph(id, limit)),
  ideCommit: (id: string, sha: string) => j<CommitDetail>(paths.ideCommit(id, sha)),
  ideGit: (id: string, op: GitOp) => j<GitOpResult>(paths.ideGit(id), { method: "POST", ...body(op) }),
  browseFs: (path?: string) =>
    j<{ path: string; parent: string | null; entries: { name: string; path: string }[] }>(paths.fsBrowse(path)),
  listTerminals: () => j<TerminalSession[]>(paths.terminalSessions),
  createTerminal: (project: string) => j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body({ project }) }),
  // SPEC-162 · sesi claude interaktif untuk sebuah backlog item, di worktree-nya sendiri.
  startSession: (b: { spec: string; flow: Flow }) =>
    j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body(b) }),
  // SPEC-166 · reverse: sesi project-level menyusun Source of Truth dari kode, di worktree-nya.
  reverseDocs: (project: string) =>
    j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body({ project, flow: "reverse" }) }),
  deleteTerminal: (id: string) => j<void>(paths.terminalSession(id), { method: "DELETE" }),
  // SPEC-164 · modul VPS
  listVps: () => j<VpsView[]>(paths.vps),
  createVps: (b: { name: string; host: string; user: string; port?: number; keyPath?: string; password?: string }) =>
    j<VpsView>(paths.vps, { method: "POST", ...body(b) }),
  // SPEC-165 · `password` = bootstrap ulang key hanoman; tak pernah disimpan.
  updateVps: (id: string, b: {
    name?: string; host?: string; user?: string; port?: number;
    keyPath?: string | null; password?: string
  }) =>
    j<VpsView>(paths.vpsOne(id), { method: "PATCH", ...body(b) }),
  deleteVps: (id: string) => j<void>(paths.vpsOne(id), { method: "DELETE" }),
  auditVps: (id: string) => j<{ audit: VpsCheck[]; hardened: boolean }>(paths.vpsAudit(id), { method: "POST" }),
  hardenVps: (id: string) => j<{ transcript: string; audit: VpsCheck[] | null; hardened: boolean }>(
    paths.vpsHarden(id), { method: "POST" }),
  vpsSession: (id: string) => j<{ id: string }>(paths.vpsSession(id), { method: "POST" }),
  // SPEC-169 · auth. Cookie sesi ikut otomatis (same-origin). 401 dari mana pun → App balik ke Login.
  authStatus: () => j<AuthStatus>(paths.authStatus),
  setup: (b: { email: string; password: string }) => j<{ user: UserView }>(paths.authSetup, { method: "POST", ...body(b) }),
  login: (b: { email: string; password: string }) => j<{ user: UserView }>(paths.authLogin, { method: "POST", ...body(b) }),
  logout: () => j<void>(paths.authLogout, { method: "POST" }),
  listUsers: () => j<UserView[]>(paths.authUsers),
  inviteUser: (b: { email: string; password: string }) => j<UserView>(paths.authUsers, { method: "POST", ...body(b) }),
  deleteUser: (id: string) => j<void>(paths.authUser(id), { method: "DELETE" }),
  changePassword: (b: { currentPassword: string; newPassword: string }) =>
    j<{ user: UserView }>(paths.authChangePassword, { method: "POST", ...body(b) }),
};

