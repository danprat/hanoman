import { paths, type ProjectView, type Spec, type Trigger, type Setting, type Run } from "@hanoman/shared";
export class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }
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
  scanProject: (id: string) => j<ProjectView>(paths.scan(id), { method: "POST" }),
  listSpecs: (q = "") => j<Spec[]>(paths.specs + q),
  createSpec: (b: unknown) => j<Spec>(paths.specs, { method: "POST", ...body(b) }),
  advanceSpec: (id: string) => j<{ id: string; stage: string }>(paths.advance(id), { method: "POST" }),
  deleteSpec: (id: string) => j<void>(paths.spec(id), { method: "DELETE" }),
  listTriggers: () => j<Trigger[]>(paths.triggers),
  createTrigger: (b: unknown) => j<Trigger>(paths.triggers, { method: "POST", ...body(b) }),
  toggleTrigger: (id: string) => j<Trigger>(paths.toggle(id), { method: "POST" }),
  getSettings: () => j<Setting>(paths.settings),
  putSettings: (b: unknown) => j<Setting>(paths.settings, { method: "PUT", ...body(b) }),
  listRuns: () => j<Run[]>(paths.runs),
  getRun: (id: string) => j<Run>(paths.run(id)),
  runCommand: (id: string, text: string) =>
    j<{ lines: { t: string; s: string }[] }>(paths.runCommand(id), { method: "POST", ...body({ text }) }),
  runControl: (id: string, action: "pause" | "resume" | "stop" | "retry") =>
    j<{ accepted: boolean }>(paths.runControl(id), { method: "POST", ...body({ action }) }),
  runSteer: (id: string, message: string) =>
    j<{ accepted: boolean }>(paths.runSteer(id), { method: "POST", ...body({ message }) }),
  getDocs: (id: string) => j<{ coverage: number; tree: any[] }>(paths.docs(id)),
  getDoc: (id: string, path: string) => j<{ path: string; content: string }>(paths.docFile(id, path)),
  putDoc: (id: string, path: string, content: string) =>
    j<{ path: string; content: string }>(paths.docFile(id, path), { method: "PUT", ...body({ content }) }),
  browseFs: (path?: string) =>
    j<{ path: string; parent: string | null; entries: { name: string; path: string }[] }>(paths.fsBrowse(path)),
};

export type RunLiveEvent =
  | { kind: "log"; line: { t: string; s: string } }
  | { kind: "status"; status: string }
  | { kind: "phase"; name: string; state: string }
  | { kind: "cost"; tokensIn: number; tokensOut: number; costUsd: number }
  | { kind: "file"; path: string; add: number; del: number; status: string };

// Live run stream over SSE (backend: GET /runs/:id/log). Returns an unsubscribe.
export function subscribeRun(id: string, onEvent: (e: RunLiveEvent) => void): () => void {
  const es = new EventSource(paths.runLog(id));
  es.onmessage = (ev) => { try { onEvent(JSON.parse(ev.data)); } catch { /* skip malformed frame */ } };
  return () => es.close();
}
