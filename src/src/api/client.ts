import { paths, type Paginated, type ProjectView, type Spec, type Setting, type Notification, type VpsView, type VpsCheck, type ChecklistView, type RemediateStep, type AuthStatus, type UserView, type LimitsDTO, type PrdDoc, type DeviceTokenView, type SessionResultView, type ConfigResponse, type ConfigEntryView, type IngestKeyView, type ErrorGroupView, type ErrorGroupDetail, type TicketView, type TicketDetail, type TicketEditInput, type AgentTokenView, type CapabilityInfo, type SyncConflictView, type BreakdownDoc, type BreakdownItem } from "@hanoman/shared";
export class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }
export type Flow = "feature" | "qa" | "scaffold" | "reverse" | "prd" | "audit" | "breakdown";
// SPEC-210 · dokumen PRD project (freshest-wins: worktree sesi prd hidup > repoDir). Tipe di @hanoman/shared.
export type { PrdDoc };
export type Phase = { name: string; state: "done" | "skipped" | "active" | "pending" };
export type TerminalSession = {
  id: string; projectId: string; specId?: string; flow?: Flow; cwd: string; exited: boolean;
  branch?: string; decision?: boolean;   // SPEC-230 · branch integrasi sesi (PRD: prd/<slug>)
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
// SPEC-234 · status working tree utama (staged/unstaged), diturunkan dari git.
export type WorkingStatus = { branch: string; staged: ChangedFile[]; unstaged: ChangedFile[] };
export type GraphCommit = { sha: string; parents: string[]; author: string; at: string; subject: string; refs: string[]; tags: string[] };
export type CommitDetail = { sha: string; parents: string[]; author: string; at: string; subject: string; body: string; changed: ChangedFile[]; signed: boolean; committer: string; committedAt: string; authorEmail: string };
export type GitOp =
  | { op: "checkout"; ref: string; force?: boolean }
  | { op: "branch"; name: string; at?: string; checkout?: boolean }
  | { op: "merge"; ref: string; ff?: "no-ff" | "ff-only"; deleteBranch?: string; force?: boolean }
  | { op: "cherry-pick"; sha: string; force?: boolean }
  | { op: "revert"; sha: string; force?: boolean }
  // SPEC-206 · local (default true) dan/atau origin (remote)
  | { op: "delete-branch"; name: string; force?: boolean; local?: boolean; remote?: boolean }
  // SPEC-233 · reset branch current ke commit (soft/mixed/hard)
  | { op: "reset"; sha: string; mode: "soft" | "mixed" | "hard"; force?: boolean }
  // SPEC-233 · tag: buat (annotated bila message, di `at` bila ada, push opsional), hapus, push
  | { op: "tag"; name: string; message?: string; at?: string; push?: boolean; force?: boolean }
  | { op: "delete-tag"; name: string; remote?: boolean; force?: boolean }
  | { op: "push-tag"; name: string; force?: boolean }
  // SPEC-233 · operasi baris uncommitted
  | { op: "reset-worktree"; mode: "mixed" | "hard"; force?: boolean }
  | { op: "clean"; directories?: boolean; ignored?: boolean; force?: boolean }
  // SPEC-233 · stash (server: PR4)
  | { op: "stash"; message?: string; includeUntracked?: boolean; force?: boolean }
  | { op: "stash-apply"; ref: string; index?: boolean; force?: boolean }
  | { op: "stash-pop"; ref: string; index?: boolean; force?: boolean }
  | { op: "stash-drop"; ref: string; force?: boolean }
  | { op: "stash-branch"; ref: string; name: string; force?: boolean }
  // SPEC-233 · branch ref-only ops
  | { op: "rename-branch"; from: string; to: string; force?: boolean }
  | { op: "push-branch"; name: string; setUpstream?: boolean; force?: boolean }
  | { op: "fetch"; prune?: boolean; pruneTags?: boolean; force?: boolean };
export type RepoStatus = { branch: string; ahead: number; behind: number; staged: string[]; unstaged: string[]; untracked: string[]; clean: boolean };
export type Stash = { ref: string; message: string; at: string };
export type Remote = { name: string; fetch: string; push: string };
export type GitOpResult = { ok: boolean; stdout: string; stderr: string; current: string; error?: string };
// SPEC-229 · hasil merge via git graph: bersih → detail; konflik → sesi claude (sessionId).
export type GraphMergeResult = { status: "clean"; detail: string } | { status: "conflict"; sessionId: string };
async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "content-type": "application/json" }, ...init });
  if (!res.ok) throw new ApiError(res.status, `${init?.method ?? "GET"} ${url} → ${res.status}`);
  return res.status === 204 ? (undefined as T) : res.json();
}
const body = (b: unknown) => ({ body: JSON.stringify(b) });
// SPEC-198 · bangun query-string; buang undefined/"" (caller memetakan sentinel "all" → undefined).
const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? "?" + s : "";
};
export type SpecListParams = {
  project?: string; source?: string; q?: string; stage?: string; priority?: string;
  startable?: boolean; page?: number; limit?: number;
};
export type ProjectListParams = { q?: string; page?: number; limit?: number };
export const api = {
  listProjects: (params: ProjectListParams = {}) => j<Paginated<ProjectView>>(paths.projects + qs(params)),
  getProject: (id: string) => j<ProjectView>(paths.project(id)),
  createProject: (b: unknown) => j<ProjectView>(paths.projects, { method: "POST", ...body(b) }),
  deleteProject: (id: string) => j<void>(paths.project(id), { method: "DELETE" }),
  // SPEC-146 · hanya label. `id` tak pernah berubah, jadi respons selalu punya `id` yang sama.
  // SPEC-217 · `repoDir` = path default/server editable (null = kosongkan).
  updateProject: (id: string, b: { name?: string; desc?: string; gitRemote?: string; repoDir?: string | null }) =>
    j<ProjectView>(paths.project(id), { method: "PATCH", ...body(b) }),
  // SPEC-255 · ADR-0064 · rename slug project. Balik: id baru + DSN/Help URL baru (bila aktif) + affected.
  renameProject: (id: string, newId: string) =>
    j<{ id: string; dsnUrl?: string; helpUrl?: string; affected: Record<string, number> }>(
      paths.projectRename(id), { method: "POST", ...body({ newId }) }),
  // SPEC-217 · path per-mesin (LocalBinding, tak disync). put/delete = set/kosongkan override.
  getBinding: (id: string) => j<{ repoDir: string | null }>(paths.binding(id)),
  putBinding: (id: string, repoDir: string) =>
    j<{ repoDir: string }>(paths.binding(id), { method: "PUT", ...body({ repoDir }) }),
  deleteBinding: (id: string) => j<void>(paths.binding(id), { method: "DELETE" }),
  cloneProject: (id: string, dir: string) =>
    j<{ repoDir: string }>(paths.clone(id), { method: "POST", ...body({ dir }) }),
  listSpecs: (params: SpecListParams = {}) => j<Paginated<Spec>>(paths.specs + qs(params)),
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
  // SPEC-215 · config runtime
  getConfig: () => j<ConfigResponse>(paths.config),
  putConfig: (key: string, value: string) => j<ConfigEntryView>(paths.config, { method: "PUT", ...body({ key, value }) }),
  deleteConfig: (key: string) => j<void>(paths.configKey(key), { method: "DELETE" }),
  // SPEC-268 · ADR-0066 · pemicu sync manual (tombol Backlog/Errors/Triase)
  syncNow: () => j<{ ok: boolean; reason?: string; pulled?: number; pushed?: number; conflicts?: number }>(paths.syncNow, { method: "POST" }),
  // SPEC-270 · ADR-0067 · rekonsil konflik
  listConflicts: () => j<{ conflicts: SyncConflictView[] }>(paths.syncConflicts),
  resolveConflict: (entity: string, recordId: string, choice: "local" | "server") =>
    j<{ ok: boolean; reason?: string }>(paths.syncConflictResolve(entity, recordId), { method: "POST", ...body({ choice }) }),
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
  ideGraph: (id: string, limit = 200, opts?: { branches?: string[]; showRemote?: boolean; showTags?: boolean }) =>
    j<{ commits: GraphCommit[]; current: string }>(paths.ideGraph(id, limit, opts)),
  // SPEC-233 · status working tree (baris uncommitted changes)
  ideStatus: (id: string) => j<RepoStatus>(paths.ideStatus(id)),
  ideSearch: (id: string, q: string, by = "all") => j<{ shas: string[] }>(paths.ideSearch(id, q, by)), // SPEC-233
  ideStashes: (id: string) => j<Stash[]>(paths.ideStashes(id)), // SPEC-233 · daftar stash
  // SPEC-233 · remote mgmt + pr-url + archive
  ideRemotes: (id: string) => j<Remote[]>(paths.ideRemotes(id)),
  ideAddRemote: (id: string, name: string, url: string) => j<Remote[]>(paths.ideRemotes(id), { method: "POST", ...body({ name, url }) }),
  idePatchRemote: (id: string, name: string, url: string) => j<Remote[]>(paths.ideRemote(id, name), { method: "PATCH", ...body({ url }) }),
  ideDeleteRemote: (id: string, name: string) => j<Remote[]>(paths.ideRemote(id, name), { method: "DELETE" }),
  idePrUrl: (id: string, branch: string, base?: string) => j<{ url: string | null }>(paths.idePrUrl(id, branch, base)),
  ideArchiveUrl: (id: string, ref: string, format = "zip") => paths.ideArchive(id, ref, format),
  ideCommit: (id: string, sha: string) => j<CommitDetail>(paths.ideCommit(id, sha)),
  ideCommitFile: (id: string, sha: string, path: string) => j<ReviewFile>(paths.ideCommitFile(id, sha, path)), // SPEC-233
  ideCompare: (id: string, from: string, to: string) => j<{ from: string; to: string; changed: ChangedFile[] }>(paths.ideCompare(id, from, to)),
  ideCompareFile: (id: string, from: string, to: string, path: string) => j<ReviewFile>(paths.ideCompareFile(id, from, to, path)),
  ideGit: (id: string, op: GitOp) => j<GitOpResult>(paths.ideGit(id), { method: "POST", ...body(op) }),
  // SPEC-229 · merge via git graph: deterministik di worktree isolasi; conflict → sesi claude.
  ideGitMerge: (id: string, b: { source: string; ff?: "no-ff" | "ff-only"; deleteBranch?: string }) =>
    j<GraphMergeResult>(paths.ideGitMerge(id), { method: "POST", ...body(b) }),
  // SPEC-234 · status working tree + diff satu file working tree (endpoint /working-status, beda dari ideStatus SPEC-233).
  ideWorkingStatus: (id: string) => j<WorkingStatus>(paths.ideWorkingStatus(id)),
  ideFileDiff: (id: string, path: string, staged: boolean) => j<ReviewFile>(paths.ideFileDiff(id, path, staged)),
  // SPEC-233 · rebase/pull/drop via git graph: isolasi + conflict → sesi claude (bentuk sama).
  ideGitRebase: (id: string, onto: string) => j<GraphMergeResult>(paths.ideGitRebase(id), { method: "POST", ...body({ onto }) }),
  ideGitPull: (id: string, b: { source: string; ff?: "no-ff" | "ff-only" }) => j<GraphMergeResult>(paths.ideGitPull(id), { method: "POST", ...body(b) }),
  ideGitDrop: (id: string, sha: string) => j<GraphMergeResult>(paths.ideGitDrop(id), { method: "POST", ...body({ sha }) }),
  browseFs: (path?: string) =>
    j<{ path: string; parent: string | null; entries: { name: string; path: string }[] }>(paths.fsBrowse(path)),
  listTerminals: () => j<TerminalSession[]>(paths.terminalSessions),
  createTerminal: (project: string) => j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body({ project }) }),
  // SPEC-236 · terminal biasa non-claude: shell mentah di repoDir project (tanpa flow).
  createShell: (project: string) => j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body({ project, shell: true }) }),
  // SPEC-162 · sesi claude interaktif untuk sebuah backlog item, di worktree-nya sendiri.
  // SPEC-252 · ADR-0061 · model/effort per sesi (opsional; kosong → default global di server).
  startSession: (b: { spec: string; flow: Flow; model?: string; effort?: string }) =>
    j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body(b) }),
  // SPEC-166 · reverse: sesi project-level menyusun Source of Truth dari kode, di worktree-nya.
  reverseDocs: (project: string) =>
    j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body({ project, flow: "reverse" }) }),
  // SPEC-222 · scaffold: sesi project-level menyusun Source of Truth dari ide (from-scratch).
  scaffoldDocs: (project: string) =>
    j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body({ project, flow: "scaffold" }) }),
  // SPEC-210 · dokumen PRD. listPrds/getPrd baca freshest-wins; startPrd buka sesi prd.
  listPrds: (project: string) => j<{ items: PrdDoc[] }>(paths.prds(project)),
  // perbaikan SPEC-210 · daftar PRD lintas-project (filter "Semua project").
  listAllPrds: () => j<{ items: PrdDoc[] }>(paths.allPrds),
  getPrd: (project: string, path: string) =>
    j<{ path: string; content: string }>(paths.prdFile(project, path)),
  startPrd: (project: string, brief: { title: string; context: string; outcome: string; constraints?: string }) =>
    j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body({ project, flow: "prd", brief }) }),
  // SPEC-273 · breakdown PRD → N backlog. startBreakdown buka sesi; getBreakdown baca manifest;
  // createSpecsBatch materialize usulan (review manusia) jadi N spec independen.
  startBreakdown: (project: string, prdPath: string) =>
    j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body({ project, flow: "breakdown", prdPath }) }),
  getBreakdown: (project: string, prdPath: string) =>
    j<BreakdownDoc>(paths.breakdown(project, prdPath)),
  createSpecsBatch: (b: { project: string; items: BreakdownItem[]; branchFrom?: string; prdPath?: string }) =>
    j<{ created: Spec[] }>(paths.specsBatch, { method: "POST", ...body(b) }),
  deleteTerminal: (id: string) => j<void>(paths.terminalSession(id), { method: "DELETE" }),
  // SPEC-230 · review + integrate ber-skop sesi (sesi project-level PRD, tanpa Spec).
  sessionReview: (id: string) => j<SpecReview>(paths.sessionReview(id)),
  sessionReviewFile: (id: string, path: string) => j<ReviewFile>(paths.sessionReviewFile(id, path)),
  sessionIntegrate: (id: string, op: "merge" | "rebase", target: string) =>
    j<{ status: "clean"; detail: string } | { status: "conflict"; sessionId: string }>(
      paths.sessionIntegrate(id), { method: "POST", ...body({ op, target }) }),
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
  auditVps: (id: string) => j<{ audit: VpsCheck[]; hardened: boolean; scoreTotal: number; scoreBySection: Record<string, number> }>(paths.vpsAudit(id), { method: "POST" }),
  // SPEC-220 · kepatuhan checklist
  vpsChecklist: (id: string) => j<ChecklistView>(paths.vpsChecklist(id)),
  markNa: (id: string, itemId: string, na: boolean, reason?: string) =>
    j<{ ok: boolean }>(paths.vpsItemNa(id, itemId), { method: "POST", ...body({ na, reason }) }),
  markNaBulk: (id: string, itemIds: string[], na: boolean, reason?: string) =>
    j<{ ok: boolean; count: number }>(paths.vpsItemNaBulk(id), { method: "POST", ...body({ itemIds, na, reason }) }),
  attestItem: (id: string, itemId: string, note?: string) =>
    j<{ ok: boolean }>(paths.vpsItemAttest(id, itemId), { method: "POST", ...body({ note }) }),
  remediatePreview: (id: string, items: string[]) =>
    j<{ steps: RemediateStep[] }>(paths.vpsRemediatePreview(id), { method: "POST", ...body({ items }) }),
  remediate: (id: string, items: string[]) =>
    j<{ steps: RemediateStep[]; audit: VpsCheck[] | null; scoreTotal: number; scoreBySection: Record<string, number> }>(
      paths.vpsRemediate(id), { method: "POST", ...body({ items }) }),
  hardenVps: (id: string) => j<{ transcript: string; audit: VpsCheck[] | null; hardened: boolean }>(
    paths.vpsHarden(id), { method: "POST" }),
  vpsSession: (id: string) => j<{ id: string }>(paths.vpsSession(id), { method: "POST" }),
  // SPEC-211 · test connection + open console
  testVps: (id: string) => j<{ ok: boolean; out: string }>(paths.vpsTest(id), { method: "POST" }),
  vpsConsole: (id: string) => j<{ id: string }>(paths.vpsConsole(id), { method: "POST" }),
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
  // SPEC-213 · device token (identitas mesin) — token plaintext hanya balik di create (sekali).
  listDeviceTokens: () => j<DeviceTokenView[]>(paths.deviceTokens),
  createDeviceToken: (b: { name: string }) =>
    j<{ id: string; name: string; token: string }>(paths.deviceTokens, { method: "POST", ...body(b) }),
  revokeDeviceToken: (id: string) => j<void>(paths.deviceToken(id), { method: "DELETE" }),
  // SPEC-257 · agent token (kelola cookie-only) — token plaintext hanya balik di create (sekali).
  getAgentCapabilities: () => j<{ capabilities: CapabilityInfo[] }>(paths.agentCapabilities),
  listAgentTokens: () => j<{ items: AgentTokenView[] }>(paths.agentTokens),
  createAgentToken: (b: { name: string; capabilities: string[] }) =>
    j<AgentTokenView & { token: string }>(paths.agentTokens, { method: "POST", ...body(b) }),
  patchAgentToken: (id: string, b: { name?: string; capabilities?: string[]; enabled?: boolean }) =>
    j<AgentTokenView>(paths.agentToken(id), { method: "PATCH", ...body(b) }),
  revokeAgentToken: (id: string) => j<void>(paths.agentToken(id), { method: "DELETE" }),
  // SPEC-213 · activity log (ringkasan hasil sesi)
  listSessionResults: (projectId?: string) => j<SessionResultView[]>(paths.sessionResults(projectId)),
  purgeSessionResults: (projectId: string, before?: string) =>
    j<{ purged: number }>(`${paths.sessionResults(projectId)}${before ? `&before=${encodeURIComponent(before)}` : ""}`, { method: "DELETE" }),
  // SPEC-249 · error monitoring — DSN ingest key (plaintext hanya balik di rotate, sekali).
  getIngestKey: (id: string) => j<IngestKeyView>(paths.projectIngestKey(id)),
  rotateIngestKey: (id: string) => j<IngestKeyView>(paths.projectIngestKey(id), { method: "POST" }),
  revokeIngestKey: (id: string) => j<void>(paths.projectIngestKey(id), { method: "DELETE" }),
  // SPEC-249 · error monitoring — grup + detail + eskalasi
  listErrors: (params: Record<string, string | undefined> = {}) =>
    j<Paginated<ErrorGroupView>>(paths.errors + qs(params)),
  getError: (id: string) => j<ErrorGroupDetail>(paths.error(id)),
  escalateError: (id: string) => j<{ spec: Spec; alreadyEscalated?: boolean }>(paths.errorEscalate(id), { method: "POST" }),
  patchError: (id: string, status: string) =>
    j<{ id: string; status: string }>(paths.error(id), { method: "PATCH", ...body({ status }) }),
  unlinkError: (id: string) => j<{ id: string; status: string; specId: string | null }>(paths.errorUnlink(id), { method: "POST", ...body({}) }),
  deleteError: (id: string) => j<{ ok: boolean }>(paths.error(id), { method: "DELETE" }),
  // SPEC-249 · panduan integrasi SDK (markdown) untuk ditampilkan di web
  getIntegrationGuide: () => j<{ text: string }>(paths.errorsGuide),
  // SPEC-253 · Help Center — manajemen per project + triase tiket.
  getHelpCenter: (id: string) => j<{ enabled: boolean; publicUrl: string }>(paths.projectHelpCenter(id)),
  enableHelpCenter: (id: string) => j<{ enabled: boolean; publicUrl: string }>(paths.projectHelpCenter(id), { method: "POST" }),
  disableHelpCenter: (id: string) => j<void>(paths.projectHelpCenter(id), { method: "DELETE" }),
  listTickets: (params: Record<string, string | undefined> = {}) =>
    j<Paginated<TicketView> & { unreviewed: number }>(paths.tickets + qs(params)),
  getTicket: (id: string) => j<TicketDetail & { spec: Spec | null }>(paths.ticket(id)),
  acceptTicket: (id: string, priority?: string) =>
    j<{ spec: Spec; alreadyPromoted?: boolean }>(paths.ticketAccept(id), { method: "POST", ...body({ priority }) }),
  rejectTicket: (id: string) =>
    j<{ id: string; status: string }>(paths.ticketReject(id), { method: "POST", ...body({}) }),
  unlinkTicket: (id: string) =>
    j<{ id: string; status: string; specId: string | null }>(paths.ticketUnlink(id), { method: "POST", ...body({}) }),
  editTicket: (id: string, input: TicketEditInput) =>
    j<TicketDetail & { spec: Spec | null }>(paths.ticket(id), { method: "PATCH", ...body(input) }),
  deleteTicket: (id: string) => j<{ ok: boolean }>(paths.ticket(id), { method: "DELETE" }),
};

