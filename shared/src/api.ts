export const API = "/api";
export const paths = {
  projects: `${API}/projects`,
  project: (id: string) => `${API}/projects/${id}`,
  // SPEC-255 · ADR-0064 · rename slug project (efek: DSN, Help Center, sync).
  projectRename: (id: string) => `${API}/projects/${encodeURIComponent(id)}/rename`,
  branches: (id: string) => `${API}/projects/${id}/branches`,
  // SPEC-217 · path per-mesin (LocalBinding, tak disync) + clone dari gitRemote
  binding: (id: string) => `${API}/projects/${id}/binding`,
  clone: (id: string) => `${API}/projects/${id}/clone`,
  specs: `${API}/specs`,
  spec: (id: string) => `${API}/specs/${id}`,
  specDocs: (id: string) => `${API}/specs/${id}/docs`,
  specDocFile: (id: string, path: string) => `${API}/specs/${id}/docs/${path}`,
  specIntegrate: (id: string) => `${API}/specs/${id}/integrate`,
  specReview: (id: string) => `${API}/specs/${id}/review`,
  specReviewFile: (id: string, path: string) => `${API}/specs/${id}/review/${path}`,
  settings: `${API}/settings`,
  notifications: `${API}/notifications`,
  limits: `${API}/limits`,
  docs: (id: string) => `${API}/projects/${id}/docs`,
  docFile: (id: string, path: string) => `${API}/projects/${id}/docs/${path}`,
  // SPEC-210 · dokumen PRD project (freshest-wins: worktree sesi prd hidup > repoDir)
  prds: (id: string) => `${API}/projects/${id}/prds`,
  allPrds: `${API}/prds`, // perbaikan SPEC-210 · daftar PRD lintas-project (filter "Semua project")
  prdFile: (id: string, path: string) => `${API}/projects/${id}/prds/${path}`,
  // SPEC-182 · IDE Visual
  ideTree: (id: string, ref = "") => `${API}/projects/${id}/tree${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`,
  ideFile: (id: string, path?: string, ref = "") =>
    `${API}/projects/${id}/file${path ? `?path=${encodeURIComponent(path)}${ref ? `&ref=${encodeURIComponent(ref)}` : ""}` : ""}`,
  ideGraph: (id: string, limit = 200, opts?: { branches?: string[]; showRemote?: boolean; showTags?: boolean }) => {
    const p = new URLSearchParams({ limit: String(limit) });
    if (opts?.branches?.length) p.set("branches", opts.branches.join(","));
    if (opts?.showRemote === false) p.set("showRemote", "false");
    if (opts?.showTags === false) p.set("showTags", "false");
    return `${API}/projects/${id}/graph?${p.toString()}`;
  },
  ideStatus: (id: string) => `${API}/projects/${id}/status`, // SPEC-233 · status working tree
  ideSearch: (id: string, q: string, by = "all") => `${API}/projects/${id}/graph/search?q=${encodeURIComponent(q)}&by=${by}`, // SPEC-233
  ideStashes: (id: string) => `${API}/projects/${id}/stashes`, // SPEC-233 · daftar stash
  // SPEC-233 · remote mgmt + pr-url + archive
  ideRemotes: (id: string) => `${API}/projects/${id}/remotes`,
  ideRemote: (id: string, name: string) => `${API}/projects/${id}/remotes/${encodeURIComponent(name)}`,
  idePrUrl: (id: string, branch: string, base?: string) =>
    `${API}/projects/${id}/pr-url?branch=${encodeURIComponent(branch)}${base ? `&base=${encodeURIComponent(base)}` : ""}`,
  ideArchive: (id: string, ref: string, format = "zip") => `${API}/projects/${id}/archive?ref=${encodeURIComponent(ref)}&format=${format}`,

  ideCommit: (id: string, sha: string) => `${API}/projects/${id}/commit/${sha}`,
  // SPEC-233 · diff satu file di commit (vs parent)
  ideCommitFile: (id: string, sha: string, path: string) => `${API}/projects/${id}/commit/${sha}/file?path=${encodeURIComponent(path)}`,
  // SPEC-233 · compare dua commit
  ideCompare: (id: string, from: string, to: string) => `${API}/projects/${id}/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  ideCompareFile: (id: string, from: string, to: string, path: string) =>
    `${API}/projects/${id}/compare/file?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&path=${encodeURIComponent(path)}`,
  ideGit: (id: string) => `${API}/projects/${id}/git`,
  ideGitMerge: (id: string) => `${API}/projects/${id}/git/merge`, // SPEC-229 · merge git graph isolasi
  // SPEC-234 · status working tree (staged/unstaged) + diff satu file working tree
  // catat: /working-status dibedakan dari /status milik SPEC-233 (repoStatus graph) — beda bentuk respons.
  ideWorkingStatus: (id: string) => `${API}/projects/${id}/working-status`,
  ideFileDiff: (id: string, path: string, staged: boolean) =>
    `${API}/projects/${id}/file-diff?path=${encodeURIComponent(path)}${staged ? "&staged=1" : ""}`,
  ideGitRebase: (id: string) => `${API}/projects/${id}/git/rebase`, // SPEC-233 · rebase isolasi
  ideGitPull: (id: string) => `${API}/projects/${id}/git/pull`,     // SPEC-233 · pull isolasi
  ideGitDrop: (id: string) => `${API}/projects/${id}/git/drop`,     // SPEC-233 · drop commit isolasi
  fsBrowse: (path?: string) => `${API}/fs/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`,
  terminalSessions: `${API}/terminal/sessions`,
  terminalSession: (id: string) => `${API}/terminal/sessions/${id}`,
  terminalPhases: (id: string) => `${API}/terminal/sessions/${id}/phases`,
  // SPEC-230 · review + integrate ber-skop sesi (sesi project-level PRD, tanpa Spec).
  sessionReview: (id: string) => `${API}/terminal/sessions/${id}/review`,
  sessionReviewFile: (id: string, path: string) => `${API}/terminal/sessions/${id}/review/${path}`,
  sessionIntegrate: (id: string) => `${API}/terminal/sessions/${id}/integrate`,
  terminalWs: (id: string) => `${API}/terminal/sessions/${id}/ws`,
  eventsWs: `${API}/events/ws`,   // SPEC-199 · WebSocket siar dashboard (global, bukan per-sesi)
  vps: `${API}/vps`,
  vpsOne: (id: string) => `${API}/vps/${id}`,
  vpsAudit: (id: string) => `${API}/vps/${id}/audit`,
  vpsHarden: (id: string) => `${API}/vps/${id}/harden`,
  vpsSession: (id: string) => `${API}/vps/${id}/session`,
  vpsTest: (id: string) => `${API}/vps/${id}/test`,
  vpsConsole: (id: string) => `${API}/vps/${id}/console`,
  // SPEC-220 · kepatuhan checklist
  vpsChecklist: (id: string) => `${API}/vps/${id}/checklist`,
  vpsItemNa: (id: string, itemId: string) => `${API}/vps/${id}/items/${itemId}/na`,
  vpsItemNaBulk: (id: string) => `${API}/vps/${id}/items/na-bulk`,
  vpsItemAttest: (id: string, itemId: string) => `${API}/vps/${id}/items/${itemId}/attest`,
  vpsRemediatePreview: (id: string) => `${API}/vps/${id}/remediate/preview`,
  vpsRemediate: (id: string) => `${API}/vps/${id}/remediate`,
  // SPEC-169 · auth
  authStatus: `${API}/auth/status`,
  authSetup: `${API}/auth/setup`,
  authLogin: `${API}/auth/login`,
  authLogout: `${API}/auth/logout`,
  authUsers: `${API}/auth/users`,
  authUser: (id: string) => `${API}/auth/users/${id}`,
  authChangePassword: `${API}/auth/change-password`,
  // SPEC-213 · device token + activity log
  deviceTokens: `${API}/device-tokens`,
  deviceToken: (id: string) => `${API}/device-tokens/${id}`,
  sessionResults: (projectId?: string) =>
    `${API}/session-results${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`,
  // SPEC-215 · config runtime
  config: `${API}/config`,
  configKey: (key: string) => `${API}/config/${encodeURIComponent(key)}`,
  // SPEC-249 · error monitoring. ingest publik ber-DSN (bypass gate cookie, ADR-0060).
  ingest: (slug: string) => `${API}/ingest/${encodeURIComponent(slug)}`,
  errors: `${API}/errors`,
  errorsGuide: `${API}/errors/integration-guide`,
  error: (id: string) => `${API}/errors/${id}`,
  errorEscalate: (id: string) => `${API}/errors/${id}/escalate`,
  projectIngestKey: (id: string) => `${API}/projects/${encodeURIComponent(id)}/ingest-key`,
  // SPEC-253 · Help Center publik (bypass gate cookie; otorisasi helpEnabled + kunci opaque tiket).
  help: (slug: string) => `${API}/help/${encodeURIComponent(slug)}`,
  helpTickets: (slug: string) => `${API}/help/${encodeURIComponent(slug)}/tickets`,
  helpStatus: (slug: string, key: string) =>
    `${API}/help/${encodeURIComponent(slug)}/tickets/${encodeURIComponent(key)}`,
  // SPEC-253 · triase (di belakang gate cookie)
  projectHelpCenter: (id: string) => `${API}/projects/${encodeURIComponent(id)}/help-center`,
  tickets: `${API}/tickets`,
  ticket: (id: string) => `${API}/tickets/${id}`,
  ticketAttachment: (id: string, attId: string) => `${API}/tickets/${id}/attachments/${attId}`,
  ticketAccept: (id: string) => `${API}/tickets/${id}/accept`,
  ticketReject: (id: string) => `${API}/tickets/${id}/reject`,
} as const;

// SPEC-215 · view config untuk UI. Secret: tanpa `value`, pakai `masked` + `hasValue`.
export type ConfigEntryView = {
  key: string; group: string; label: string; help?: string;
  kind: import("./config-registry").ConfigKind;
  apply: import("./config-registry").ApplyMode;
  category: import("./config-registry").ConfigCategory;
  min?: number; max?: number;
  editable: boolean; source: "db" | "env" | "default";
  value?: string | null;        // non-secret
  masked?: string | null;       // secret & bootstrap secret
  hasValue?: boolean;           // secret: apakah ada nilai efektif
};
export type ConfigResponse = { entries: ConfigEntryView[]; sync: { running: boolean; connected: boolean } };
