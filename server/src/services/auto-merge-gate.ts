import { autoMergeOf, type AutoMerge } from "@hanoman/shared";
import { listRepoBranches, listRepoRemoteBranches, defaultBranch } from "./branches";

// SPEC-486 · ADR-0103 · gerbang tulis kebijakan auto-merge. SATU definisi untuk dua route
// (`PATCH /projects/:id` & `PATCH /specs/:id`) — dua salinan akan berbeda persis di kasus yang
// jarang diuji, kelas bug SPEC-431/475.
//
// Prinsip SPEC-143/ADR-0032 ditegakkan: daftar yang memasok dropdown adalah daftar yang menjaga
// gerbang. Branch karangan ditolak DI SINI, bukan berjam-jam kemudian saat sweep mencoba merge.
export type GateResult = { ok: true } | { ok: false; code: 400 | 409; error: string };

export async function checkAutoMerge(repoDir: string | null, raw: unknown): Promise<GateResult> {
  if (raw === null || raw === undefined) return { ok: true };   // mengosongkan selalu boleh
  const p = autoMergeOf(raw);
  if (!p) return { ok: false, code: 400, error: "bentuk kebijakan auto-merge tak sah" };
  // Mematikan auto-merge tak butuh repo sama sekali — jangan kunci pintu keluar.
  if (p.mode === "off") return { ok: true };
  if (!repoDir)
    return { ok: false, code: 409, error: "project belum di-bind ke checkout lokal — atur repoDir dulu sebelum menyalakan auto-merge" };
  if (p.mode === "default-branch") {
    return (await defaultBranch(repoDir))
      ? { ok: true }
      : { ok: false, code: 400, error: "default branch repo tak bisa diresolve (tak ada origin/HEAD, main, maupun master) — pilih branch tujuan secara eksplisit" };
  }
  if (!p.branch) return { ok: false, code: 400, error: "mode \"branch\" butuh branch tujuan" };
  const known = p.dest === "origin" ? await listRepoRemoteBranches(repoDir) : await listRepoBranches(repoDir);
  return known.includes(p.branch)
    ? { ok: true }
    : { ok: false, code: 400, error: `branch "${p.branch}" tidak ada di ${p.dest === "origin" ? "origin" : "repo lokal"} project` };
}

export type { AutoMerge };
