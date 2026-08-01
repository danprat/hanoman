import { prisma } from "../db";
import { realGit } from "@hanoman/runner";

// SPEC-475 · SATU penulis `Spec.headSha`, TIGA jalur persist `stage = "done"`.
//
// Sampai audit SPEC-475, kolom ini hanya ditulis `DELETE /terminal/sessions/:id` — operator
// menutup sesi dengan tangan. Dua jalur lain yang mempersist `done` (`scheduler/reconcile.ts` &
// `live-specs.ts`) tidak, dan justru merekalah yang melayani penyelesaian OTONOM: pane sesi sukses
// tak pernah mati sendiri (SPEC-433) dan `integrate-main` lead melepasnya lewat `killSession`
// langsung demi worktree yang utuh (SPEC-451) — keduanya melewati DELETE. Hasilnya keadaan mantap
// `stage = done ∧ headSha = NULL` pada 159 dari 210 item `done` ber-worktree di DB hidup, dan
// gerbang dependency ADR-0093 kehilangan satu-satunya bukti yang ia baca.
//
// Menyalin bookkeeping ini ke tiap pemakai adalah kelas bug yang sudah menggigit repo ini dua kali
// (SPEC-431 `baseSha IS NULL`, SPEC-448 `rootBypassEnv`). Bedanya di sini yang berbeda-beda bukan
// PREDIKAT melainkan EFEK SAMPING — dan efek samping tak punya tipe yang memaksanya konsisten,
// jadi satu-satunya pengaman adalah satu definisi bersama.
export type HeadShaReader = (worktree: string) => string | null;

const readHead: HeadShaReader = (wt) => {
  try { return realGit.headSha(wt); } catch { return null; }
};

/** Stempel ujung kerja sesi ke `Spec.headSha`. Mengembalikan sha yang tercatat, atau null bila
 *  HEAD tak terbaca. Gagal-diam di kedua sisi: ini bookkeeping akhir sesi dan tak boleh memblok
 *  penutupan/rekonsiliasi. `null` TIDAK ditulis — worktree yang lenyap atau repo yang tak terbaca
 *  tak boleh MENGHAPUS ujung yang sudah tercatat, karena itu menukar "belum ter-merge" jadi
 *  "siap" tepat di titik paling berbahaya. */
export async function recordHeadSha(
  specId: string, worktree: string, read: HeadShaReader = readHead,
): Promise<string | null> {
  const sha = read(worktree);
  if (!sha) return null;
  await prisma.spec.update({ where: { id: specId }, data: { headSha: sha } })
    .catch(() => { /* spec bisa saja sudah dihapus operator */ });
  return sha;
}
