import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Prisma } from "@prisma/client";
import type { VpsCheck, VpsHealth } from "@hanoman/shared";
import { prisma } from "../db";
import { repoRoot } from "../runner/deps";
import { sshExec, type SshTarget } from "./vps-ssh";
import { enqueueOutbox } from "./outbox";

// Check kritis (SPEC-164 §3): semuanya pass → hardened. warn tak menghalangi.
export const CRITICAL = [
  "sudo_ok", "os_supported", "ssh_root_login", "ssh_password_auth",
  "firewall", "fail2ban", "auto_updates",
] as const;

// Baris di luar format (motd, banner, warning ssh) diabaikan diam-diam.
export function parseAudit(out: string): VpsCheck[] {
  return out.split("\n").flatMap((line) => {
    const m = line.match(/^CHECK (\S+) (pass|fail|warn)(?: (.*))?$/);
    return m ? [{ check: m[1]!, status: m[2] as VpsCheck["status"], detail: (m[3] ?? "").trim() }] : [];
  });
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

export async function runAudit(v: VpsRow):
  Promise<{ ok: true; audit: VpsCheck[]; hardened: boolean } | { ok: false; out: string }> {
  const r = await sshExec(target(v), "sudo -n bash -s",
    { stdin: readFileSync(scriptPath("audit.sh"), "utf8"), timeoutMs: 60_000 });
  const audit = parseAudit(r.out);
  // ssh gagal ATAU output tanpa satu pun CHECK (sudo minta password, shell asing) = audit gagal.
  if (r.code !== 0 || audit.length === 0) return { ok: false, out: r.out };
  const hardened = isHardened(audit);
  await prisma.vps.update({ where: { id: v.id }, data: {
    audit: audit as unknown as Prisma.InputJsonValue, lastAuditAt: new Date(), hardened } });
  await enqueueOutbox("vps", v.id); // SPEC-213 · hasil audit ikut disync
  return { ok: true, audit, hardened };
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
