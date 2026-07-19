import { z } from "zod";
import { zProject, zBriefPayload, zQaPayload } from "./entities";
import type { Spec, Notification } from "./entities";
import { zProjectKind, zSpecSource, zPriority, zStage } from "./enums";

// SPEC-198 · amplop daftar via API: search/filter/paginasi dilakukan server-side.
export type Paginated<T> = { items: T[]; total: number; page: number; pageSize: number };

// SPEC-213 · terbitkan device token (nama device untuk pengenal manusia).
export const zIssueDeviceToken = z.object({ name: z.string().min(1) });

// SPEC-213 · ADR-0047 · ringkasan hasil sesi (activity log). Whitelist field — tanpa transkrip/kredensial.
export const zSessionResult = z.object({
  id: z.string(), projectId: z.string(), specId: z.string().nullable(),
  oldStage: z.string().nullable(), newStage: z.string().nullable(),
  commitSha: z.string().nullable(), branch: z.string().nullable(), prUrl: z.string().nullable(),
  status: z.string(), deviceId: z.string().nullable(), author: z.string().nullable(),
  createdAt: z.string(),
});
export type SessionResultView = z.infer<typeof zSessionResult>;

export const zCreateProject = z.object({
  name: z.string().min(1), kind: zProjectKind, repoDir: z.string().optional(),
  gitRemote: z.string().optional(),
  desc: z.string().default("") });
// SPEC-146: hanya label tampilan. `id` memikul kunci asing Spec; `kind`,
// `repoDir` dan `stack` menentukan tempat sesi/scan/terminal hidup. Body
// kosong `{}` sah dan berarti no-op — refinement "minimal satu field" tak menjaga apa pun.
export const zUpdateProject = z.object({
  name: z.string().min(1).optional(),
  desc: z.string().optional(),
  gitRemote: z.string().optional(),   // SPEC-213 · set git remote resmi project
  repoDir: z.string().nullable().optional(),   // SPEC-217 · path default/server editable (null = kosongkan)
});
export const zCreateSpec = z.object({
  project: z.string(), source: zSpecSource, title: z.string().min(1),
  priority: zPriority, payload: z.union([zBriefPayload, zQaPayload]),
  branchFrom: z.string().min(1).optional() })
  // SPEC-197 · ikat source ke bentuk payload: `qa` → QaPayload (punya `severity`), selain itu →
  // BriefPayload. Union saja tak menjaganya (objek non-strict), jadi `deriveSpecFields` bisa
  // menurunkan objective/priority dari bentuk yang salah. superRefine menegakkannya di boundary.
  .superRefine((o, ctx) => {
    const isQa = "severity" in o.payload;
    if ((o.source === "qa") !== isQa)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["payload"], message: "bentuk payload tak cocok dengan source" });
  });
// nullable, bukan optional: `null` berarti "kosongkan, kembali ke default project",
// dan itu harus terbedakan dari "jangan sentuh".
// branchFrom: nullable+optional — `null` mengosongkan (kembali ke default project),
// `undefined` berarti jangan sentuh. stage: revert backward-only (SPEC-167); confirmDelete
// mengizinkan penghapusan artefak setelah dry-run.
export const zPatchSpec = z.object({
  branchFrom: z.string().min(1).nullable().optional(),
  stage: zStage.optional(),
  confirmDelete: z.boolean().optional(),
  // SPEC-186 · edit konten selagi item belum dimulai. Ditolak server bila sudah mulai.
  title: z.string().min(1).optional(),
  priority: zPriority.optional(),
  payload: z.union([zBriefPayload, zQaPayload]).optional(),
});
// SPEC-175 · rebase/merge branch hasil done spec. target = "local:<b>" | "origin:<b>".
export const zIntegrate = z.object({
  op: z.enum(["merge", "rebase"]),
  target: z.string().regex(/^(local|origin):.+/),
});
// SPEC-162 · yang berjalan adalah sesi tmux, bukan baris Run. `flow` menggantikan `kind`.
export const zSessionSummary = z.object({
  status: z.enum(["running", "idle"]),
  phase: z.string().nullable(),
  flow: z.string().nullable(),
});
export const zProjectView = zProject.extend({
  binding: z.string().nullable(),   // SPEC-217 · override repoDir per-mesin (null = pakai Project.repoDir)
  backlog: z.number().int(), topStage: z.string(), session: zSessionSummary,
  activity: z.string(), commit: z.string() });
export type ProjectView = z.infer<typeof zProjectView>;

export const zFlow = z.enum(["feature", "qa", "scaffold", "reverse", "prd"]);

// SPEC-210 · brief awal PRD (sesi prd project-level, tanpa Spec). Disisipkan ke prompt sesi.
export const zPrdBrief = z.object({
  title: z.string().min(1),
  context: z.string(),
  outcome: z.string(),
  constraints: z.string().optional(),
});
export type PrdBrief = z.infer<typeof zPrdBrief>;

// SPEC-210 · item daftar PRD (dokumen docs/prd/*.md). projectId/projectName menyertai tiap item
// agar view lintas-project ("Semua project") bisa mengelompokkan & membuka PRD ke project asalnya.
export const zPrdDoc = z.object({
  slug: z.string(),
  name: z.string(),
  path: z.string(),
  title: z.string(),
  live: z.boolean(),
  projectId: z.string(),
  projectName: z.string(),
});
export type PrdDoc = z.infer<typeof zPrdDoc>;

// Sesi terminal dibuka untuk sebuah project (repoDir-nya, terminal biasa) atau untuk sebuah
// backlog item — yang terakhir lahir di worktree-nya sendiri, dengan prompt awal (SPEC-162).
export const zTerminalSession = z.union([
  // flow opsional (SPEC-166): "reverse" = sesi project-level di worktree-nya sendiri,
  // menyusun Source of Truth dari kode. Tanpa flow = terminal biasa di repoDir.
  z.object({ project: z.string(), flow: z.literal("reverse").optional() }),
  // SPEC-210 · sesi prd project-level di worktree sendiri; menghasilkan dokumen PRD dari brief.
  z.object({ project: z.string(), flow: z.literal("prd"), brief: zPrdBrief }),
  // SPEC-222 · scaffold: sesi project-level from-scratch, menyusun SoT dari ide. Tanpa brief
  // (diseed dari Project.desc), tanpa Spec — cermin reverse.
  z.object({ project: z.string(), flow: z.literal("scaffold") }),
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
// SPEC-169 · auth. Tanpa RBAC — semua user setara. Password min 8 saat dibuat/diubah;
// login menerima min 1 (validasi asli lewat verify hash, error selalu generic).
export const zLogin = z.object({ email: z.string().email(), password: z.string().min(1) });
export const zSignup = z.object({ email: z.string().email(), password: z.string().min(8) });
export const zChangePassword = z.object({
  currentPassword: z.string().min(1), newPassword: z.string().min(8) });
export type UserView = { id: string; email: string; createdAt: string };
export type AuthStatus = { needsSetup: boolean; user: UserView | null };

export const zVpsCheck = z.object({
  check: z.string(), status: z.enum(["pass", "fail", "warn", "na"]), detail: z.string() });
export type VpsCheck = z.infer<typeof zVpsCheck>;
export type VpsHealth = { uptime: string; disk: string; mem: string; load: string };
export type VpsView = {
  id: string; name: string; host: string; port: number; user: string; keyPath: string | null;
  createdAt: string; lastSeenAt: string | null; health: VpsHealth | null;
  lastAuditAt: string | null; audit: VpsCheck[] | null; hardened: boolean;
};

// SPEC-220 · checklist kepatuhan (katalog 232 item + status per VPS). Server menghidrasi penuh
// (frontend tak mengimpor katalog server). Lihat internal/docs/architecture/vps-compliance.md.
export type VpsItemStatus = "pass" | "fail" | "warn" | "na" | "unknown";
export type VpsMode = "AUTO" | "AUDIT" | "INFO";
export type VpsSeverity = "critical" | "high" | "medium" | "low";
export type ChecklistItem = {
  id: string; section: string; sectionTitle: string; level: string; title: string; code?: string;
  mode: VpsMode; severity: VpsSeverity; probe: boolean; remediable: boolean; appLayer: boolean;
  status: VpsItemStatus; na: boolean; attested: boolean;
  drifted: boolean; // SPEC-221 · regresi pass→fail/warn sejak snapshot sebelumnya (AC-19)
  actorEmail: string | null; naReason: string | null; attestNote: string | null;
};
// SPEC-221 · suggestion = saran applicability app-layer (advisory). applicable:false → sarankan N/A.
export type ChecklistSuggestion = { applicable: boolean; detail: string };
export type ChecklistSection = {
  id: string; title: string; icon: string; score: number;
  suggestion?: ChecklistSuggestion; items: ChecklistItem[] };
export type ChecklistView = {
  vpsId: string; scoreTotal: number; scoreBySection: Record<string, number>;
  lastAuditAt: string | null; sections: ChecklistSection[];
};

// SPEC-220 · body request untuk aksi item & remediasi
export const zMarkNa = z.object({ na: z.boolean(), reason: z.string().max(500).optional() });
// SPEC-221 · tandai N/A banyak item sekaligus (untuk "tandai seksi N/A" advisory app-layer)
export const zMarkNaBulk = z.object({
  itemIds: z.array(z.string()).min(1).max(64), na: z.boolean(), reason: z.string().max(500).optional() });
export const zAttest = z.object({ note: z.string().max(500).optional() });
export const zRemediate = z.object({ items: z.array(z.string()).min(1).max(64) });

// SPEC-220 · satu langkah remediasi. `would` = dry-run (tak menyentuh VPS), ok/fail = apply.
export type RemediateStep = { item: string; status: "would" | "ok" | "fail"; detail: string };

// SPEC-181 · limit langganan Claude realtime (dari GET /api/oauth/usage → limits[])
export type LimitSeverity = "normal" | "warning" | "critical";
export type LimitsStatus = "ok" | "stale" | "unavailable";
export type LimitWindow = {
  key: string;               // "session" | "weekly_all" | "weekly_scoped:Opus"
  label: string;             // "Sesi 5 jam" | "Mingguan" | "Mingguan Opus"
  usedPct: number;           // 0..100 (dibulatkan dari `percent`)
  resetsAt: string | null;   // ISO 8601 (`resets_at`) atau null
  severity: LimitSeverity;   // API `severity`; fallback dari usedPct bila hilang
  isActive: boolean;         // API `is_active` — window yang sedang mengikat
};
export type LimitsDTO = {
  status: LimitsStatus;
  windows: LimitWindow[];
  fetchedAt: string | null;  // ISO waktu fetch sukses terakhir; null bila belum pernah
};

// SPEC-214 · status auto-update. "version" hanoman = git commit SHA (tak ada field version).
export type UpdateReason = "local" | "remote" | "both" | null;
export type UpdateRemoteStatus = "ok" | "unavailable";  // unavailable = tanpa upstream / fetch gagal / bukan repo git
export type UpdateCommit = { sha: string; subject: string };
export type UpdateStatus = {
  currentSha: string;         // short SHA build yang jalan (fallback checkoutSha bila belum ter-stamp / dev)
  checkoutSha: string;        // short SHA HEAD working tree sekarang
  branch: string | null;      // branch aktif; null bila detached HEAD
  local: { stale: boolean };  // runningBuildSha ≠ checkoutSha → perlu rebuild/restart
  remote: { status: UpdateRemoteStatus; behind: number; fetchedAt: string | null };
  updateAvailable: boolean;   // local.stale || remote.behind > 0
  reason: UpdateReason;
  command: string;            // panduan operator; "" bila up-to-date
  newCommits: UpdateCommit[]; // commit origin-ahead (≤ 20)
};

// SPEC-199 · bentuk sesi di wire (cermin services/pty.ts SessionInfo & client TerminalSession).
export type SessionDTO = {
  id: string; projectId: string; specId?: string; flow?: string; cwd: string;
  branch?: string; exited: boolean; decision: boolean;   // SPEC-230 · branch integrasi sesi (PRD: prd/<slug>)
};

// SPEC-199 · frame siar dashboard (server → klien), lewat GET /events/ws (ADR-0039). Read-only
// feed: tak ada frame klien → server. Per-grup, bukan snapshot monolitik — perubahan satu grup
// tak mengirim ulang yang lain.
export type EventMsg =
  | { t: "specs"; specs: Spec[] }
  | { t: "sessions"; sessions: SessionDTO[] }
  | { t: "notifications"; items: Notification[]; unread: number }
  | { t: "limits"; limits: LimitsDTO }
  | { t: "vps"; vps: VpsView[] }
  | { t: "update"; update: UpdateStatus };
