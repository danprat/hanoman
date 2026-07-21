import { z } from "zod";

// SPEC-257 · ADR-0065 · capability scope untuk agent token. "<domain>:<access>", write⊇read.
// Satu sumber untuk gate server (map route→cap) dan UI Settings (checkbox).
export const CAPABILITY_IDS = [
  "projects:read", "projects:write",
  "backlog:read", "backlog:write",
  "sessions:read", "sessions:write",
  "docs:read", "docs:write",
  "ide:read", "ide:write",
  "vps:read", "vps:write",
  "settings:read", "settings:write",
  "support:read", "support:write",
  "notifications:read", "notifications:write",
] as const;
export const zCapability = z.enum(CAPABILITY_IDS);
export type Capability = z.infer<typeof zCapability>;

export const zCapabilityInfo = z.object({
  id: zCapability, domain: z.string(), access: z.enum(["read", "write"]),
  label: z.string(), desc: z.string(), risk: z.enum(["rce", "exec"]).optional(),
});
export type CapabilityInfo = z.infer<typeof zCapabilityInfo>;

// Metadata untuk UI (label Indonesia). risk = high-risk badge.
export const CAPABILITIES: CapabilityInfo[] = [
  { id: "projects:read", domain: "projects", access: "read", label: "Projects — baca", desc: "Lihat daftar & detail project, branch, binding." },
  { id: "projects:write", domain: "projects", access: "write", label: "Projects — tulis", desc: "Buat/ubah/hapus project, rename, clone, DSN, Help Center." },
  { id: "backlog:read", domain: "backlog", access: "read", label: "Backlog — baca", desc: "Lihat spec/backlog, dokumen, review diff." },
  { id: "backlog:write", domain: "backlog", access: "write", label: "Backlog — tulis", desc: "Buat/ubah/hapus spec, integrate branch." },
  { id: "sessions:read", domain: "sessions", access: "read", label: "Sesi — baca", desc: "Lihat sesi terminal, fase, review." },
  { id: "sessions:write", domain: "sessions", access: "write", label: "Sesi — tulis", desc: "Jalankan sesi claude/shell, kirim input, tutup, integrate.", risk: "rce" },
  { id: "docs:read", domain: "docs", access: "read", label: "Docs — baca", desc: "Baca dokumen SoT project & PRD." },
  { id: "docs:write", domain: "docs", access: "write", label: "Docs — tulis", desc: "Tulis/hapus file .md project." },
  { id: "ide:read", domain: "ide", access: "read", label: "IDE/Git — baca", desc: "Lihat tree, file, status git, graph, commit, diff." },
  { id: "ide:write", domain: "ide", access: "write", label: "IDE/Git — tulis", desc: "Tulis file working tree, operasi git, kelola remote." },
  { id: "vps:read", domain: "vps", access: "read", label: "VPS — baca", desc: "Lihat VPS & checklist kepatuhan." },
  { id: "vps:write", domain: "vps", access: "write", label: "VPS — tulis", desc: "Kelola VPS, audit, harden, remediasi, konsol (remote exec).", risk: "exec" },
  { id: "settings:read", domain: "settings", access: "read", label: "Settings — baca", desc: "Baca setelan & config runtime." },
  { id: "settings:write", domain: "settings", access: "write", label: "Settings — tulis", desc: "Ubah setelan & config runtime." },
  { id: "support:read", domain: "support", access: "read", label: "Errors & Tiket — baca", desc: "Lihat error monitoring & tiket Help Center." },
  { id: "support:write", domain: "support", access: "write", label: "Errors & Tiket — tulis", desc: "Eskalasi error, ubah status, terima/tolak tiket." },
  { id: "notifications:read", domain: "notifications", access: "read", label: "Notifikasi — baca", desc: "Lihat notifikasi." },
  { id: "notifications:write", domain: "notifications", access: "write", label: "Notifikasi — tulis", desc: "Tandai terbaca / bersihkan notifikasi." },
];

// write meng-implikasikan read pada domain yang sama.
export function grantsCapability(granted: string[], need: Capability): boolean {
  if (granted.includes(need)) return true;
  if (need.endsWith(":read")) return granted.includes(need.replace(/:read$/, ":write"));
  return false;
}

export const zAgentTokenView = z.object({
  id: z.string(), name: z.string(), tokenPrefix: z.string(),
  capabilities: z.array(zCapability), enabled: z.boolean(),
  createdBy: z.string().nullable(), createdAt: z.string(),
  lastUsedAt: z.string().nullable(), revokedAt: z.string().nullable(),
});
export type AgentTokenView = z.infer<typeof zAgentTokenView>;

export const zAgentTokenCreate = z.object({
  name: z.string().min(1),
  capabilities: z.array(zCapability),
});
export const zAgentTokenPatch = z.object({
  name: z.string().min(1).optional(),
  capabilities: z.array(zCapability).optional(),
  enabled: z.boolean().optional(),
});
