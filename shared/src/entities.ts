import { z } from "zod";
import { zStage, zSpecSource, zDocStatus, zPriority, zProjectKind, zAgent } from "./enums";

export type Stage = z.infer<typeof zStage>;
// SPEC-338 · ADR-0074 · mesin sesi. Di-re-ekspor dari sini supaya konsumen setelan cukup
// mengimpor satu modul (pola yang sama dipakai Stage di atas).
export { zAgent };
export type Agent = z.infer<typeof zAgent>;

export const zProject = z.object({
  id: z.string(), name: z.string(), desc: z.string(), kind: zProjectKind,
  repoDir: z.string().nullable().optional(),
  gitRemote: z.string().nullable().optional(),         // SPEC-213 · git remote resmi (clone di client)
  stack: z.string().default(""),                       // ADR-0004
  docStatus: zDocStatus, coverage: z.number().int().min(0).max(100),
  createdAt: z.string(),
});
export type Project = z.infer<typeof zProject>;

export const zBriefPayload = z.object({
  context: z.string(), outcome: z.string(), constraints: z.string(), priority: zPriority });
export const zQaPayload = z.object({
  severity: z.enum(["critical","major","minor"]), steps: z.string(),
  expected: z.string(), actual: z.string(), env: z.string(),
  fromAudit: z.string().optional(),      // SPEC-244 · qa dinaikkan dari audit → sinyal skip fase Audit (ADR-0059)
  fromErrorGroup: z.string().optional() });   // SPEC-249 · qa dari eskalasi error → tautan grup (ADR-0060)

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
// SPEC-238 · daftar pilihan valid untuk UI (server tetap lenient z.string()). +Fable, +max, +ultracode.
// SPEC-252 · ADR-0061 — dipakai picker "Mulai sesi" (model/effort per sesi) + kartu default global Settings.
export const MODELS = [
  { id: "claude-opus-5", label: "Opus 5" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
  { id: "claude-fable-5", label: "Fable 5" },
] as const;
export const EFFORTS = ["xhigh", "high", "medium", "low", "max", "ultracode"] as const;

// SPEC-338 · ADR-0074 · katalog codex. Slug diteruskan apa adanya ke `codex -m`; effort ke
// `-c model_reasoning_effort="<v>"` (codex tak punya flag --effort).
// SPEC-339 · effort adalah properti MODEL, bukan properti CLI. GPT-5.6 menambah `max` (kedalaman
// nalar maksimum) dan `ultra` (nalar maksimum + delegasi tugas ke subagent), TAPI Luna tak
// mendukung `ultra` dan seluruh model 5.5 ke bawah tak mendukung keduanya. Dua daftar sejajar
// karena itu tak lagi cukup — tiap model membawa daftar effort-nya sendiri.
// Nilai diverifikasi terhadap `codex debug models` (codex-cli 0.145.0) dan
// codex-rs/models-manager/models.json upstream.
export type CodexModel = {
  id: string; label: string;
  /** Effort yang didukung model ini, urut kuat → ringan. */
  efforts: readonly string[];
  /** Dipakai bila effort tersimpan tak didukung model ini. Wajib ada di `efforts`. */
  fallback: string;
  /** `minimal_client_version` dari manifest codex — dasar peringatan versi lunak (SPEC-339). */
  minClient: string;
};

const E_5_6 = ["ultra", "max", "xhigh", "high", "medium", "low"] as const;
const E_LUNA = ["max", "xhigh", "high", "medium", "low"] as const;
// Irisan yang didukung SETIAP model codex — juga jawaban untuk model yang belum kita daftar.
const E_BASE = ["xhigh", "high", "medium", "low"] as const;

export const CODEX_MODELS: readonly CodexModel[] = [
  { id: "gpt-5.6-sol",   label: "GPT-5.6 Sol",   efforts: E_5_6,  fallback: "xhigh", minClient: "0.144.0" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", efforts: E_5_6,  fallback: "xhigh", minClient: "0.144.0" },
  { id: "gpt-5.6-luna",  label: "GPT-5.6 Luna",  efforts: E_LUNA, fallback: "xhigh", minClient: "0.144.0" },
  { id: "gpt-5.5",       label: "GPT-5.5",       efforts: E_BASE, fallback: "xhigh", minClient: "0.124.0" },
];

// Gabungan semua effort codex. Dipertahankan demi pemanggil lama, TAPI bukan lagi sumber pilihan
// UI — picker wajib memakai `codexEfforts(model)` supaya kombinasi tolak tak pernah tampil.
export const CODEX_EFFORTS = E_5_6;

export function codexModel(id: string): CodexModel | undefined {
  return CODEX_MODELS.find((m) => m.id === id);
}

/** Effort yang boleh dipilih untuk sebuah model. Model tak dikenal → irisan aman, bukan kosong. */
export function codexEfforts(modelId: string): readonly string[] {
  return codexModel(modelId)?.efforts ?? E_BASE;
}

/**
 * Turunkan `effort` ke nilai yang benar-benar didukung `modelId`. Model tak dikenal meneruskan
 * effort apa adanya: katalog ini kurasi UI, bukan gerbang validasi — server sengaja lenient
 * (`z.string()`), dan model baru yang belum sempat didaftar tak boleh jadi mustahil dijalankan.
 */
export function coerceCodexEffort(modelId: string, effort: string): string {
  const m = codexModel(modelId);
  if (!m) return effort;
  return m.efforts.includes(effort) ? effort : m.fallback;
}

/**
 * SPEC-339 · perbandingan versi numerik per segmen. String compare salah: "0.9.0" akan dianggap
 * LEBIH BARU dari "0.144.0". Dipakai server (endpoint versi) dan web (catatan lunak) — satu
 * implementasi, bukan tiga salinan yang lambat laun berbeda.
 */
export function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * SPEC-339 · apakah codex CLI terpasang terlalu tua untuk `modelId`. Seluruh aturan peringatan
 * ada di sini, jadi Settings dan picker Start tak bisa berbeda pendapat:
 * versi tak terdeteksi (`null`) → false (ketiadaan bukti bukan bukti ketiadaan);
 * model tak dikenal → false (tak ada tuntutan versi yang bisa kita klaim).
 */
export function codexClientTooOld(modelId: string, version: string | null): boolean {
  const need = codexModel(modelId)?.minClient;
  if (!need || !version) return false;
  return cmpVersion(version, need) < 0;
}

/**
 * Model yang tak lagi ada di picker → penggantinya saat dibaca (cermin RETIRED_MODELS milik claude).
 * Semua dipetakan ke `gpt-5.5`, SENGAJA bukan ke 5.6: gpt-5.5 hanya butuh klien 0.124.0, sedangkan
 * trio 5.6 butuh 0.144.0. Pensiun tak boleh memindahkan setelan orang ke model yang CLI-nya belum
 * sanggup menjalankannya.
 */
export const RETIRED_CODEX_MODELS: Record<string, string> = {
  "gpt-5.4": "gpt-5.5",
  "gpt-5.4-mini": "gpt-5.5",
  "gpt-5.3-codex-spark": "gpt-5.5",
};

// Default model/effort codex. Model/effort claude sengaja TETAP di `Setting.model`/`Setting.effort`
// (kontrak GET /settings + baris Setting lama), jadi blok ini hanya untuk codex.
export const zCodex = z.object({
  model: z.string().default("gpt-5.6-sol"),
  effort: z.string().default("xhigh"),
});
export type Codex = z.infer<typeof zCodex>;
export const CODEX_DEFAULTS: Codex = zCodex.parse({});

// SPEC-294 · ADR-0072 · knob scheduler otonom. Semua default MATI. Ditambahkan ke zSetting sebagai
// .default(SCHEDULER_DEFAULTS) → baris Setting lama tanpa blok ini tetap parse (key hilang diisi default).
const zSourceCommon = { enabled: z.boolean().default(false) };
export const zScheduler = z.object({
  enabled: z.boolean().default(false),      // master subsystem switch
  paused: z.boolean().default(false),       // rem darurat (Pause): blokir drain ≤1 tick
  maxConcurrent: z.number().int().min(1).default(2),   // cap sesi hidup
  autonomy: z.enum(["full-control", "butuh-keputusan"]).default("butuh-keputusan"), // dikonsumsi daun #5
  sources: z.object({
    backlog: z.object({ ...zSourceCommon, everyMin: z.number().int().min(1).default(15) }).default({}),
    errors:  z.object({ ...zSourceCommon, everyMin: z.number().int().min(1).default(15), minCount: z.number().int().min(1).default(5) }).default({}),
    triase:  z.object({ ...zSourceCommon, everyMin: z.number().int().min(1).default(30) }).default({}),
  }).default({}),
});
export type Scheduler = z.infer<typeof zScheduler>;
export const SCHEDULER_DEFAULTS: Scheduler = zScheduler.parse({});

// SPEC-332 · ADR-0073 · mode goal untuk sesi backlog: Claude Code menolak berhenti sampai kondisi
// terbukti. Default MATI; `condition` kosong = pakai template DoD bawaan runner
// (defaultGoalCondition). Batas 4000 = batas kondisi `/goal` di Claude Code. Dipasang ke zSetting
// lewat .default() seperti `scheduler` (SPEC-294) → baris Setting lama tetap parse, tanpa migration.
export const zGoal = z.object({
  enabled: z.boolean().default(false),
  condition: z.string().max(4000).default(""),
});
export type Goal = z.infer<typeof zGoal>;
export const GOAL_DEFAULTS: Goal = zGoal.parse({});

export const zSetting = z.object({
  model: z.string().default("claude-opus-5"),
  effort: z.string().default("xhigh"),
  autoDefault: z.boolean(),
  autoScaffold: z.boolean(),
  notifyFail: z.boolean(),
  notifyDone: z.boolean().default(true),                                   // SPEC-180
  notifySound: z.enum(NOTIFY_SOUNDS).default("short"),                     // SPEC-180
  notifyDecision: z.boolean().default(true),                              // SPEC-184
  notifyDecisionSound: z.enum(NOTIFY_SOUNDS).default("alert"),            // SPEC-184
  agentAccessEnabled: z.boolean().default(false),                        // SPEC-257 · master switch akses AI agent
  scheduler: zScheduler.default(SCHEDULER_DEFAULTS),                      // SPEC-294 · ADR-0072 · knob scheduler (default mati)
  goal: zGoal.default(GOAL_DEFAULTS),                                     // SPEC-332 · ADR-0073 · mode goal (default mati)
  agent: zAgent.default("claude"),                                        // SPEC-338 · ADR-0074 · mesin sesi default
  codex: zCodex.default(CODEX_DEFAULTS),                                  // SPEC-338 · ADR-0074 · model/effort codex
});
export type Setting = z.infer<typeof zSetting>;

// SPEC-180/184 · notifikasi. type done|decision; specId null untuk sesi reverse; sessionId
// = target redirect terminal. Tanggal = string ISO (JSON). readAt null = unread.
export const zNotification = z.object({
  id: z.string(),
  type: z.enum(["done", "decision", "error", "ticket", "fail"]).default("done"),   // SPEC-249 · +error; SPEC-253 · +ticket; SPEC-298 · +fail (sesi scheduler gagal/limit)
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
