import { prisma } from "../db";
import { realGit } from "@hanoman/runner";
import { resolveRepoDir } from "./local-binding";
import { sessionIdForSpec } from "./session-id";

// SPEC-447 · ADR-0093 · satu-satunya sumber kebenaran "apa yang memblokir backlog item ini".
// Dipakai TIGA pembaca: gerbang peluncuran (session-launch), gerbang otomasi (governor + denyut
// lead), dan permukaan baca (liveSpecs). Menyalin predikatnya ke pemakai adalah kelas bug yang
// sudah pernah terjadi di repo ini (SPEC-431: `baseSha IS NULL` disalin ke dua tempat lalu salah
// dengan cara yang sama persis di keduanya).

export type BlockReason = "missing" | "unfinished" | "unmerged";
export type SpecBlocker = { id: string; reason: BlockReason };

export type DepRow = { id: string; stage: string; headSha: string | null };
type SpecLike = { branchFrom: string | null; dependsOn?: unknown };

const REASON_LABEL: Record<BlockReason, string> = {
  missing: "tak ditemukan", unfinished: "belum selesai", unmerged: "belum ter-merge",
};

/** Kolom `Json` bisa berisi apa saja — ia menyeberang lewat sync dari client versi lain. Baca
 *  defensif: bukan array / elemen bukan string → dibuang, duplikat dibuang, urutan dipertahankan. */
export function dependsOnOf(spec: { dependsOn?: unknown }): string[] {
  const v = spec.dependsOn;
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) if (typeof x === "string" && x !== "" && !out.includes(x)) out.push(x);
  return out;
}

/** MURNI: seluruh matriks keputusan tanpa DB/git, jadi ia teruji tanpa harness.
 *  `tipOf(dep)` = "commit mana hasil kerja dependency itu", null bila tak ada jejak sama sekali.
 *  `isMerged(sha, baseRef)` = "apakah commit itu sudah ada di basis si dependent". */
export function blockersFor(
  spec: SpecLike, deps: Map<string, DepRow>,
  tipOf: (dep: DepRow) => string | null,
  isMerged: (sha: string, baseRef: string) => boolean,
): SpecBlocker[] {
  const ids = dependsOnOf(spec);
  if (ids.length === 0) return [];
  // Basis = ref yang akan dipakai `realGit.addWorktree` saat sesi ini lahir (session-launch.ts).
  // Pertanyaannya memang itu: "apakah worktree yang akan saya buat memuat pekerjaan dependency?"
  const base = spec.branchFrom ?? "HEAD";
  const out: SpecBlocker[] = [];
  for (const id of ids) {
    const d = deps.get(id);
    if (!d) { out.push({ id, reason: "missing" }); continue; }
    if (d.stage !== "done") { out.push({ id, reason: "unfinished" }); continue; }
    // SPEC-475 · yang berarti "siap" adalah TAK ADA JEJAK KERJA sama sekali — hanoman tak pernah
    // membuatkan worktree untuk item itu (selesai manual / pra-ADR-0030 / dikerjakan di checkout
    // lain, SPEC-431), atau branch sesinya sudah dihapus karena ter-merge (SPEC-360). Kolom
    // `headSha` sendirian BUKAN jawaban itu: ia kosong pada ~76 % item `done` ber-worktree karena
    // hanya jalur DELETE sesi yang pernah menulisnya, dan membacanya sebagai "siap" membuat
    // separuh gerbang ADR-0093 tak pernah menyala sekali pun.
    const tip = tipOf(d);
    if (tip && !isMerged(tip, base)) out.push({ id, reason: "unmerged" });
  }
  return out;
}

/** Kalimat yang dibaca operator (note antrean scheduler + pesan 409). */
export function blockedNote(bl: SpecBlocker[]): string {
  return `menunggu ${bl.map((b) => `${b.id} (${REASON_LABEL[b.reason]})`).join(", ")}`;
}

/** MURNI: apakah `target` terjangkau dari salah satu simpul `from`? Dipakai deteksi siklus —
 *  menambahkan `from` sebagai dependency `target` membentuk siklus persis saat ini true.
 *  Tahan graf yang SUDAH bersiklus (`seen`), karena data lama bisa saja tak konsisten. */
export function reaches(edges: Map<string, string[]>, from: string[], target: string): boolean {
  const seen = new Set<string>();
  const stack = [...from];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === target) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const n of edges.get(cur) ?? []) stack.push(n);
  }
  return false;
}

// Merged-ness hanya berubah saat ada integrate/push, sementara pembacanya adalah loop siar 1 detik
// (events.ts). Memo pendek menahan biaya subprocess tanpa membuat jawabannya terasa basi.
const TTL_MS = 15_000;
const mergeCache = new Map<string, { at: number; v: boolean }>();
const tipCache = new Map<string, { at: number; v: string | null }>();
export function __clearGitCaches(): void { mergeCache.clear(); tipCache.clear(); }

export function mergedInto(repoDir: string, sha: string, baseRef: string): boolean {
  const key = `${repoDir} ${sha} ${baseRef}`;
  const hit = mergeCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < TTL_MS) return hit.v;
  let v = false;
  try { v = realGit.isAncestor(repoDir, sha, baseRef); } catch { v = false; }
  mergeCache.set(key, { at: now, v });
  return v;
}

/** SPEC-475 · ujung kerja sebuah dependency. Kolom `headSha` menang bila terisi — ia commit yang
 *  benar-benar tercatat hanoman. Bila kosong, jawabannya dicari dari branch sesinya, yang namanya
 *  deterministik dari id spec (ADR-0032, `hanoman/<sessionIdForSpec(id)>`) dan hidup lebih lama
 *  daripada kolom mana pun: ia bertahan meski sesi tak pernah ditutup lewat DELETE, meski
 *  peluncuran ulang me-null-kan `headSha`, dan ia LENYAP persis saat pembersihan branch ter-merge
 *  (SPEC-360) — sehingga "tak ada branch" adalah jawaban yang benar untuk "sudah ter-merge".
 *  Null = tak ada jejak kerja apa pun → tak ada yang bisa memblokir dependent-nya. */
export function workTip(repoDir: string, dep: DepRow): string | null {
  if (dep.headSha) return dep.headSha;
  const branch = `hanoman/${sessionIdForSpec(dep.id)}`;
  const key = `${repoDir} ${branch}`;
  const hit = tipCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < TTL_MS) return hit.v;
  let v: string | null = null;
  try { v = realGit.revParse(repoDir, branch); } catch { v = null; }
  tipCache.set(key, { at: now, v });
  return v;
}

// repoDir null (project belum di-bind) → tak ada yang bisa ditanya → fail-closed.
const merger = (repoDir: string | null) =>
  (sha: string, base: string) => (repoDir ? mergedInto(repoDir, sha, base) : false);
// Tanpa repoDir tak ada branch yang bisa dilihat; yang tersisa cuma kolomnya.
const tipper = (repoDir: string | null) =>
  (d: DepRow) => (repoDir ? workTip(repoDir, d) : d.headSha);

const depRows = (ids: string[]) => prisma.spec.findMany({
  where: { id: { in: ids } }, select: { id: true, stage: true, headSha: true },
});

/** Blocker satu spec. Keluar lebih awal (nol query, nol git) saat item tak punya dependency —
 *  itulah yang membuat fitur ini berbiaya NOL untuk backlog yang tak memakainya. */
export async function blockersForSpec(
  spec: SpecLike & { projectId: string }, repoDir: string | null,
): Promise<SpecBlocker[]> {
  const ids = dependsOnOf(spec);
  if (ids.length === 0) return [];
  const rows = await depRows(ids);
  return blockersFor(spec, new Map(rows.map((r) => [r.id, r])), tipper(repoDir), merger(repoDir));
}

/** Versi batch untuk permukaan baca: satu query dependency untuk seluruh halaman, satu
 *  `resolveRepoDir` per project. Menormalkan `dependsOn` ke array supaya klien tak pernah
 *  melihat `null`. */
export async function decorateBlocked<T extends SpecLike & { projectId: string }>(
  specs: T[],
): Promise<(T & { dependsOn: string[]; blockedBy: SpecBlocker[] })[]> {
  const ids = [...new Set(specs.flatMap(dependsOnOf))];
  if (ids.length === 0) return specs.map((s) => ({ ...s, dependsOn: [], blockedBy: [] }));
  const rows = await depRows(ids);
  const deps = new Map(rows.map((r) => [r.id, r]));
  const repos = new Map<string, string | null>();
  const out: (T & { dependsOn: string[]; blockedBy: SpecBlocker[] })[] = [];
  for (const s of specs) {
    const own = dependsOnOf(s);
    if (own.length === 0) { out.push({ ...s, dependsOn: [], blockedBy: [] }); continue; }
    if (!repos.has(s.projectId)) repos.set(s.projectId, await resolveRepoDir(s.projectId));
    const repo = repos.get(s.projectId)!;
    out.push({ ...s, dependsOn: own, blockedBy: blockersFor(s, deps, tipper(repo), merger(repo)) });
  }
  return out;
}

export type DepValidation = { ok: true; ids: string[] } | { ok: false; error: string };

/** Gerbang tulis. `specId` null = spec baru (belum punya in-edge, jadi mustahil bersiklus). */
export async function validateDependsOn(
  specId: string | null, projectId: string, raw: string[],
): Promise<DepValidation> {
  const ids = dependsOnOf({ dependsOn: raw });
  if (ids.length === 0) return { ok: true, ids: [] };
  if (specId && ids.includes(specId))
    return { ok: false, error: "backlog tak bisa bergantung pada dirinya sendiri" };
  const rows = await prisma.spec.findMany({
    where: { id: { in: ids } }, select: { id: true, projectId: true },
  });
  const found = new Map(rows.map((r) => [r.id, r.projectId]));
  const missing = ids.filter((i) => !found.has(i));
  if (missing.length) return { ok: false, error: `backlog tak ditemukan: ${missing.join(", ")}` };
  // Lintas project menuntut merge lintas repo — ditolak tegas, bukan didiamkan (non-goal ADR-0093).
  const foreign = ids.filter((i) => found.get(i) !== projectId);
  if (foreign.length)
    return { ok: false, error: `dependency harus di project yang sama: ${foreign.join(", ")}` };
  if (specId) {
    const all = await prisma.spec.findMany({
      where: { projectId }, select: { id: true, dependsOn: true },
    });
    const edges = new Map(all.map((r) => [r.id, dependsOnOf(r)]));
    edges.set(specId, ids);   // graf SESUDAH perubahan
    if (reaches(edges, ids, specId))
      return { ok: false, error: "dependency membentuk siklus" };
  }
  return { ok: true, ids };
}
