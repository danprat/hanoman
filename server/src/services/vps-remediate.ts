// SPEC-220 · remediasi selektif item AUTO via skrip deterministik (remediate.sh). Dry-run =
// pratinjau tanpa menyentuh VPS; apply idempoten & anti-lockout. Bukan sesi Claude (AC-21).
import { readFileSync } from "node:fs";
import type { RemediateStep } from "@hanoman/shared";
import { sshExec } from "./vps-ssh";
import { scriptPath, type VpsRow } from "./vps-audit";

// Baris di luar format diabaikan diam-diam (pola parseAudit).
export function parseSteps(out: string): RemediateStep[] {
  return out.split("\n").flatMap((line) => {
    const m = line.match(/^STEP (\S+) (would|ok|fail)(?: (.*))?$/);
    return m ? [{ item: m[1]!, status: m[2] as RemediateStep["status"], detail: (m[3] ?? "").trim() }] : [];
  });
}

export async function remediate(v: VpsRow, items: string[], dryRun: boolean):
  Promise<{ ok: boolean; steps: RemediateStep[]; out: string }> {
  // items sudah divalidasi = remediable oleh route (katalog). Rangkai aman ke env.
  const r = await sshExec(v, `sudo -n env ITEMS=${items.join(",")} SSH_PORT=${v.port} DRY_RUN=${dryRun ? "1" : ""} bash -s`,
    { stdin: readFileSync(scriptPath("remediate.sh"), "utf8"), timeoutMs: 300_000 });
  return { ok: r.code === 0, steps: parseSteps(r.out), out: r.out };
}
