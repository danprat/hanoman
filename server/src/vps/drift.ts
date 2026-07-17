// SPEC-221 · deteksi drift (AC-19): item yang tadinya pass kini regresi ke fail/warn. Fungsi murni
// atas dua peta hasil audit (dari VpsAuditSnapshot.results). pass→unknown SENGAJA bukan drift —
// unknown = audit tak terbaca (mis. sshd -T gagal sesaat), sering transien → alarm palsu.
export type DriftItem = { itemId: string; from: string; to: string };

const REGRESS = new Set(["fail", "warn"]);

export function computeDrift(
  prev: Record<string, { status: string }>,
  curr: Record<string, { status: string }>,
): DriftItem[] {
  const out: DriftItem[] = [];
  for (const [id, c] of Object.entries(curr)) {
    const p = prev[id];
    if (p && p.status === "pass" && REGRESS.has(c.status)) {
      out.push({ itemId: id, from: p.status, to: c.status });
    }
  }
  return out;
}
