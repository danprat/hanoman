import { prisma } from "../db";
import { listRepoDocs } from "./scan";
const maxNum = (ids: string[], floor: number) =>
  Math.max(floor, ...ids.map((i) => parseInt(i.match(/\d+/)?.[0] ?? "0", 10)));

// Nomor SPEC diklaim oleh dua tempat, bukan satu: baris Postgres DAN nama berkas docs
// (`internal/docs/operations/spec-141-*.md`, plan `*-spec-145.md`). Agen membaca docs
// sebagai Source of Truth, jadi id yang sudah dipakai sebuah dokumen sudah terpakai —
// meski database yang mencetaknya bukan database ini. Max per-database hanya unik
// per-database: instance kedua dengan DB kosong mencetak ulang SPEC-141, dan fase Audit
// menemukan spec lama bertopik lain lalu mengabaikan backlog item di prompt.
// Karena itu docs ikut jadi lantai. repoDir absen (project from-scratch) → perilaku lama.
export function specFloorFrom(files: string[], floor = 140): number {
  for (const f of files) {
    const m = f.match(/spec-0*(\d+)/i);
    if (m) floor = Math.max(floor, Number(m[1]));
  }
  return floor;
}
export async function nextSpecId(repoDir?: string | null) {
  const ids = (await prisma.spec.findMany({ select: { id: true } })).map((s) => s.id);
  const floor = repoDir ? specFloorFrom(await listRepoDocs(repoDir)) : 140;
  return `SPEC-${maxNum(ids, floor) + 1}`;
}
// Floor-nya per-database, dan run id menentukan path worktree (`.worktrees/<id>`).
// Dua instance yang berbagi repoDir tapi punya DB sendiri sama-sama mulai dari floor
// yang sama, mengalokasikan id yang sama, lalu addWorktree yang satu force-remove
// worktree milik yang lain di tengah run. Instance prod menyetel RUN_ID_FLOOR ke
// namespace terpisah supaya id-nya tak pernah bertemu id dev.
export async function nextRunId() {
  const ids = (await prisma.run.findMany({ select: { id: true } })).map((r) => r.id);
  return `RUN-${maxNum(ids, Number(process.env.RUN_ID_FLOOR) || 8800) + 1}`;
}
