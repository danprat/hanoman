import { prisma } from "../db";
import { runAudit, runHealth } from "./vps-audit";

const HEALTH_MS = 5 * 60_000;
const AUDIT_MS = 24 * 3_600_000;

// Sapuan serial — puluhan VPS pun rampung jauh sebelum tick berikutnya, tanpa badai
// ssh paralel. Gagal satu VPS tak menghentikan sisanya.
export async function healthSweep(): Promise<void> {
  // findMany di-guard: DB kedip / pool habis tak boleh jadi unhandled rejection (dipanggil
  // lewat `void` di setInterval) yang menjatuhkan orchestrator (SPEC-197).
  try { for (const v of await prisma.vps.findMany()) await runHealth(v).catch(() => {}); }
  catch { /* skip sweep ini */ }
}

export async function auditSweep(now: () => number = Date.now): Promise<void> {
  try {
    for (const v of await prisma.vps.findMany()) {
      if (v.lastAuditAt && now() - v.lastAuditAt.getTime() < AUDIT_MS) continue;
      await runAudit(v).catch(() => {});
    }
  } catch { /* skip sweep ini */ }
}

// Dipanggil server.ts saja — buildApp() bebas timer, test tak pernah menyentuh loop ini.
// Harden TIDAK pernah di sini (SPEC-164 §5): hanya audit & health yang terjadwal.
let timers: NodeJS.Timeout[] = [];
export function startVpsMonitor(): void {
  if (timers.length) return;
  const h = setInterval(() => void healthSweep(), HEALTH_MS);
  const a = setInterval(() => void auditSweep(), AUDIT_MS);
  h.unref(); a.unref(); timers = [h, a];
  // Pass pertama saat boot: dashboard segar tanpa menunggu tick; auditSweep sendiri
  // melewati yang lastAuditAt-nya < 24 jam.
  void healthSweep(); void auditSweep();
}
export function stopVpsMonitor(): void { for (const t of timers) clearInterval(t); timers = []; }
