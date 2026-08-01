import { z } from "zod";

// SPEC-486 · ADR-0103 · kebijakan "apa yang terjadi sesudah backlog item selesai".
//
// Satu blok, dua tempat: `Project.autoMerge` (default project) dan `Spec.autoMerge` (override
// per item; null = warisi project). Bentuknya `Json?` di DB — preseden `Setting.conflict`
// (ADR-0081) & `Spec.dependsOn` (ADR-0093) — karena ia dibaca sebagai SATU kesatuan dan tak
// pernah difilter/di-`orderBy`. Empat kolom skalar akan mengizinkan keadaan yang tak masuk akal
// (`mode:"off"` dengan `branch` terisi) tanpa satu pun tipe yang mencegahnya.
//
// `dest` + `branch` sengaja memakai kosakata yang SAMA dengan `POST /specs/:id/integrate`
// (`local:<b>` / `origin:<b>`, ADR-0031): satu perbendaharaan untuk dua permukaan, dan dropdown
// branch di UI memakai `GET /projects/:id/branches` yang sudah memasok keduanya.
export const AUTO_MERGE_MODES = ["off", "default-branch", "branch"] as const;
export type AutoMergeMode = (typeof AUTO_MERGE_MODES)[number];

export const zAutoMerge = z.object({
  mode: z.enum(AUTO_MERGE_MODES).default("off"),
  // Tujuan: `local` = perbarui ref/fast-forward di checkout ini; `origin` = push.
  dest: z.enum(["local", "origin"]).default("local"),
  // Hanya bermakna saat mode = "branch". Untuk "default-branch" ia diresolve SAAT EKSEKUSI.
  branch: z.string().min(1).nullable().default(null),
  // Hapus `hanoman/<spec>` (lokal + origin) — HANYA sesudah merge terbukti bersih.
  deleteBranch: z.boolean().default(false),
});
export type AutoMerge = z.infer<typeof zAutoMerge>;

export const AUTO_MERGE_OFF: AutoMerge = { mode: "off", dest: "local", branch: null, deleteBranch: false };

/** Kolom `Json` bisa berisi apa saja (ditulis versi lain, disunting tangan). Bentuk rusak → null
 *  = "tak ada kebijakan", bukan melempar: sweep tak boleh mati karena satu baris cacat. */
export function autoMergeOf(raw: unknown): AutoMerge | null {
  if (raw === null || raw === undefined) return null;
  const p = zAutoMerge.safeParse(raw);
  return p.success ? p.data : null;
}

/** Kebijakan yang BERLAKU untuk sebuah backlog item. Satu definisi, dipakai server (sweep +
 *  gerbang route) dan UI (badge "ikut project" vs "override item ini"). */
export function resolveAutoMerge(projectRaw: unknown, specRaw: unknown): AutoMerge {
  return autoMergeOf(specRaw) ?? autoMergeOf(projectRaw) ?? AUTO_MERGE_OFF;
}

/** Target untuk `integrate()`. `null` = tak ada tujuan yang bisa dipakai (jangan eksekusi). */
export function autoMergeTargetOf(p: AutoMerge, defaultBranch: string | null): string | null {
  if (p.mode === "off") return null;
  const name = p.mode === "branch" ? p.branch : defaultBranch;
  return name ? `${p.dest}:${name}` : null;
}

const DEST_LABEL: Record<AutoMerge["dest"], string> = { local: "lokal", origin: "origin" };

/** Ringkasan sebaris untuk UI — dipakai kartu project DAN baris "ikut project" di backlog. */
export function autoMergeSummary(p: AutoMerge): string {
  if (p.mode === "off") return "tanpa auto-merge";
  const where = p.mode === "default-branch"
    ? `default branch repo (${DEST_LABEL[p.dest]})`
    : `${p.branch ?? "—"} (${DEST_LABEL[p.dest]})`;
  return `auto-merge ke ${where}${p.deleteBranch ? " · hapus branch kerja" : ""}`;
}
