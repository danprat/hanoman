import { prisma } from "../db";
const maxNum = (ids: string[], floor: number) =>
  Math.max(floor, ...ids.map((i) => parseInt(i.match(/\d+/)?.[0] ?? "0", 10)));
export async function nextSpecId() {
  const ids = (await prisma.spec.findMany({ select: { id: true } })).map((s) => s.id);
  return `SPEC-${maxNum(ids, 140) + 1}`;
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
