import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import { notifySynced } from "./sync-notify";

// SPEC-213 · ADR-0047 · ringkasan hasil sesi (activity log). WHITELIST ketat: hanya field di
// bawah yang tersimpan. Transkrip PTY mentah, kredensial, blob bebas TIDAK pernah ikut (AC-21).
const WHITELIST = [
  "projectId", "specId", "oldStage", "newStage", "commitSha", "branch", "prUrl", "status", "deviceId", "author",
] as const;

export async function recordSessionResult(input: Record<string, unknown>): Promise<{ id: string }> {
  const id = randomUUID();
  const data: Record<string, unknown> = { id };
  for (const f of WHITELIST) if (input[f] !== undefined && input[f] !== null) data[f] = input[f];
  if (data.status === undefined) data.status = "done";
  if (data.projectId === undefined) throw new Error("session result butuh projectId");
  await prisma.sessionResult.create({ data: data as { id: string; projectId: string; status: string } });
  await notifySynced("sessionResult", id); // SPEC-213/330 · sadar-peran: client antre push, hub publish ke feed
  return { id };
}
