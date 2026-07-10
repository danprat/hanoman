import type { VpsCheck, VpsHealth } from "@hanoman/shared";

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
