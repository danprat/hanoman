import { paths, type ProjectView, type Spec, type Setting, type VpsView, type VpsCheck } from "@hanoman/shared";
export class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }
export type Flow = "feature" | "qa" | "scaffold" | "reverse";
export type Phase = { name: string; state: "done" | "skipped" | "active" | "pending" };
export type TerminalSession = {
  id: string; projectId: string; specId?: string; flow?: Flow; cwd: string; exited: boolean;
};
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
  listBranches: (id: string) => j<{ branches: string[] }>(paths.branches(id)),
  patchSpec: (id: string, b: { branchFrom: string | null }) =>
    j<Spec>(paths.spec(id), { method: "PATCH", ...body(b) }),
  getSettings: () => j<Setting>(paths.settings),
  putSettings: (b: unknown) => j<Setting>(paths.settings, { method: "PUT", ...body(b) }),
  getDocs: (id: string) => j<{ coverage: number; tree: any[] }>(paths.docs(id)),
  getDoc: (id: string, path: string) => j<{ path: string; content: string }>(paths.docFile(id, path)),
  putDoc: (id: string, path: string, content: string) =>
    j<{ path: string; content: string }>(paths.docFile(id, path), { method: "PUT", ...body({ content }) }),
  deleteDoc: (id: string, path: string) => j<void>(paths.docFile(id, path), { method: "DELETE" }),
  browseFs: (path?: string) =>
    j<{ path: string; parent: string | null; entries: { name: string; path: string }[] }>(paths.fsBrowse(path)),
  listTerminals: () => j<TerminalSession[]>(paths.terminalSessions),
  createTerminal: (project: string) => j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body({ project }) }),
  // SPEC-162 · sesi claude interaktif untuk sebuah backlog item, di worktree-nya sendiri.
  startSession: (b: { spec: string; flow: Flow }) =>
    j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body(b) }),
  deleteTerminal: (id: string) => j<void>(paths.terminalSession(id), { method: "DELETE" }),
  // SPEC-164 · modul VPS
  listVps: () => j<VpsView[]>(paths.vps),
  createVps: (b: { name: string; host: string; user: string; port?: number; keyPath?: string }) =>
    j<VpsView>(paths.vps, { method: "POST", ...body(b) }),
  deleteVps: (id: string) => j<void>(paths.vpsOne(id), { method: "DELETE" }),
  auditVps: (id: string) => j<{ audit: VpsCheck[]; hardened: boolean }>(paths.vpsAudit(id), { method: "POST" }),
  hardenVps: (id: string) => j<{ transcript: string; audit: VpsCheck[] | null; hardened: boolean }>(
    paths.vpsHarden(id), { method: "POST" }),
  vpsSession: (id: string) => j<{ id: string }>(paths.vpsSession(id), { method: "POST" }),
};

