import { prisma } from "../db";
const maxNum = (ids: string[], floor: number) =>
  Math.max(floor, ...ids.map((i) => parseInt(i.match(/\d+/)?.[0] ?? "0", 10)));
export async function nextSpecId() {
  const ids = (await prisma.spec.findMany({ select: { id: true } })).map((s) => s.id);
  return `SPEC-${maxNum(ids, 140) + 1}`;
}
export async function nextRunId() {
  const ids = (await prisma.run.findMany({ select: { id: true } })).map((r) => r.id);
  return `RUN-${maxNum(ids, 8800) + 1}`;
}
