import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Prisma } from "@prisma/client";
import type { VpsCheck, VpsHealth } from "@hanoman/shared";
import { prisma } from "../db";
import { repoRoot } from "../runner/deps";
import { sshExec, type SshTarget } from "./vps-ssh";
import { enqueueOutbox } from "./outbox";
import { byId } from "../vps/catalog/catalog";
import { scoreCompliance, type ProbeStatus } from "../vps/scoring";
import { computeDrift, type DriftItem } from "../vps/drift";
import { recordDrift } from "./notifications";

// Check kritis (SPEC-164 §3): semuanya pass → hardened. warn tak menghalangi.
export const CRITICAL = [
  "sudo_ok", "os_supported", "ssh_root_login", "ssh_password_auth",
  "firewall", "fail2ban", "auto_updates",
] as const;

// Baris di luar format (motd, banner, warning ssh) diabaikan diam-diam.
export function parseAudit(out: string): VpsCheck[] {
  return out.split("\n").flatMap((line) => {
    const m = line.match(/^CHECK (\S+) (pass|fail|warn|na)(?: (.*))?$/);
    return m ? [{ check: m[1]!, status: m[2] as VpsCheck["status"], detail: (m[3] ?? "").trim() }] : [];
  });
}

// SPEC-221 · deteksi stack app-layer (advisory): baris `STACK <section> <present|absent> <detail>`.
export function parseStack(out: string): Record<string, { present: boolean; detail: string }> {
  const d: Record<string, { present: boolean; detail: string }> = {};
  for (const line of out.split("\n")) {
    const m = line.match(/^STACK (\S+) (present|absent)(?: (.*))?$/);
    if (m) d[m[1]!] = { present: m[2] === "present", detail: (m[3] ?? "").trim() };
  }
  return d;
}

// SPEC-220 · petakan baris CHECK → status per itemId katalog untuk scoring.
// itemId di luar katalog (nama legacy spt sudo_ok, atau typo) diabaikan aman (AC-3).
// probe `na` → `unknown` (bukan pass, AC-7): applicability sebenarnya ditandai human, bukan probe (v1).
export function mapToCatalog(checks: VpsCheck[]): Record<string, ProbeStatus> {
  const out: Record<string, ProbeStatus> = {};
  for (const c of checks) {
    if (!byId(c.check)) continue;
    out[c.check] = c.status === "na" ? "unknown" : c.status;
  }
  return out;
}

export const isHardened = (checks: VpsCheck[]): boolean =>
  CRITICAL.every((c) => checks.find((x) => x.check === c)?.status === "pass");

// Healthcheck: satu perintah remote tanpa sudo, output berlabel — parser yang sama polanya.
export const HEALTH_CMD =
  'echo HEALTH uptime $(uptime -p 2>/dev/null || uptime); ' +
  "echo HEALTH disk $(df -P / | awk 'NR==2{print $5}'); " +
  "echo HEALTH mem $(free -m 2>/dev/null | awk 'NR==2{printf \"%d/%dMB\", $3, $2}'); " +
  'echo HEALTH load $(cut -d" " -f1-3 /proc/loadavg)';

export function parseHealth(out: string): VpsHealth | null {
  const h: Record<string, string> = {};
  for (const line of out.split("\n")) {
    const m = line.match(/^HEALTH (\S+) ?(.*)$/);
    if (m) h[m[1]!] = m[2]!.trim();
  }
  if (!h.uptime && !h.disk) return null;
  return { uptime: h.uptime ?? "", disk: h.disk ?? "", mem: h.mem ?? "", load: h.load ?? "" };
}

export type VpsRow = { id: string; host: string; port: number; user: string; keyPath: string | null };
const target = (v: VpsRow): SshTarget => ({ host: v.host, port: v.port, user: v.user, keyPath: v.keyPath });
// Dijangkar ke root workspace (pola deps.ts) — benar dari tsx (cwd server/) maupun dist.
export const scriptPath = (f: string): string => join(repoRoot(), "server", "scripts", "vps", f);

export type AuditOk = {
  ok: true; audit: VpsCheck[]; hardened: boolean;
  scoreTotal: number; scoreBySection: Record<string, number>;
  drift: DriftItem[]; // SPEC-221 · item yang regresi sejak audit sebelumnya (AC-19)
};

// SPEC-220 · kumpulkan keputusan human (N/A, attest) per item untuk scoring.
async function itemStatesOf(vpsId: string): Promise<Record<string, { na?: boolean; attested?: boolean }>> {
  const rows = await prisma.vpsItemState.findMany({ where: { vpsId } });
  return Object.fromEntries(rows.map((s) => [s.itemId, { na: s.na, attested: s.attested }]));
}

export async function runAudit(v: VpsRow): Promise<AuditOk | { ok: false; out: string }> {
  const r = await sshExec(target(v), "sudo -n bash -s",
    { stdin: readFileSync(scriptPath("audit.sh"), "utf8"), timeoutMs: 60_000 });
  const audit = parseAudit(r.out);
  // ssh gagal ATAU output tanpa satu pun CHECK (sudo minta password, shell asing) = audit gagal.
  if (r.code !== 0 || audit.length === 0) return { ok: false, out: r.out };
  const hardened = isHardened(audit);

  // SPEC-220 · petakan ke katalog, hitung skor pakai keputusan human terkini, simpan snapshot.
  const probe = mapToCatalog(audit);
  const states = await itemStatesOf(v.id);
  const scored = scoreCompliance(probe, states);
  const results: Record<string, { status: string; detail: string }> = {};
  for (const c of audit) if (byId(c.check)) results[c.check] = { status: c.status, detail: c.detail };
  const detected = parseStack(r.out); // SPEC-221 · deteksi stack app-layer (advisory)

  // SPEC-221 · snapshot SEBELUMNYA (untuk diff drift) diambil sebelum snapshot baru dibuat.
  const prevSnap = await prisma.vpsAuditSnapshot.findFirst({
    where: { vpsId: v.id }, orderBy: { createdAt: "desc" } });

  await prisma.vps.update({ where: { id: v.id }, data: {
    audit: audit as unknown as Prisma.InputJsonValue, lastAuditAt: new Date(), hardened } });
  const snap = await prisma.vpsAuditSnapshot.create({ data: {
    vpsId: v.id,
    results: results as unknown as Prisma.InputJsonValue,
    scoreTotal: scored.total,
    scoreBySection: scored.bySection as unknown as Prisma.InputJsonValue,
    detected: detected as unknown as Prisma.InputJsonValue,
  } });

  // SPEC-221 · drift = item yang tadinya pass kini fail/warn → Notification agregat (AC-19).
  const prevResults = (prevSnap?.results ?? {}) as Record<string, { status: string }>;
  const drift = computeDrift(prevResults, results);
  if (drift.length) {
    const row = await prisma.vps.findUnique({ where: { id: v.id }, select: { name: true } });
    await recordDrift(v.id, row?.name ?? v.id, drift, snap.id);
  }

  await enqueueOutbox("vps", v.id); // SPEC-213 · hasil audit ikut disync
  return { ok: true, audit, hardened, scoreTotal: scored.total, scoreBySection: scored.bySection, drift };
}

export async function runHealth(v: VpsRow): Promise<boolean> {
  const r = await sshExec(target(v), HEALTH_CMD, { timeoutMs: 60_000 });
  const health = parseHealth(r.out);
  if (r.code !== 0 || !health) return false;
  await prisma.vps.update({ where: { id: v.id }, data: {
    health: health as unknown as Prisma.InputJsonValue, lastSeenAt: new Date() } });
  await enqueueOutbox("vps", v.id); // SPEC-213 · health ikut disync
  return true;
}
