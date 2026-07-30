// SPEC-398 · ADR-0087 · identitas versi hanoman pindah dari SHA git ke semver npm, jadi
// perbandingannya harus numerik per-komponen ("1.10.0" > "1.2.0") dan tahu prerelease.
// Ditulis tangan agar `shared` tetap tanpa dependency runtime (ia ikut dibundel ke browser).
// Versi tak terbaca → 0: fail-safe, panel update tak boleh mengarang "ada update".
const RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/;

function parse(v: string): { nums: [number, number, number]; pre: string | null } | null {
  const m = RE.exec(v.trim());
  return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null } : null;
}

// Identifier prerelease numerik dibandingkan sebagai angka (rc.2 < rc.10), jadi di-pad dulu —
// perbandingan leksikal telanjang akan menempatkan "10" sebelum "2".
function preKey(pre: string): string {
  return pre.split(".").map((s) => (/^\d+$/.test(s) ? s.padStart(12, "0") : s)).join(".");
}

export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parse(a), pb = parse(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    const d = pa.nums[i]! - pb.nums[i]!;
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;   // 1.0.0 > 1.0.0-rc.1
  if (pb.pre === null) return -1;
  const ka = preKey(pa.pre), kb = preKey(pb.pre);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}
