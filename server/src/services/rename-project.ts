// SPEC-255 · ADR-0064 · rename Project.id secara transaksional. FK Spec/ErrorGroup/Ticket sudah
// ON UPDATE CASCADE (bawaan Prisma) → ikut otomatis saat UPDATE Project.id. Referensi longgar
// (tanpa FK) + LocalBinding (@id, LOCAL-only) di-update manual. `renameProjectCore` = helper murni:
// TANPA validasi slug / cek konflik / cek sesi (itu di `renameProject` & applyPush) dan TANPA
// menaikkan version (pemanggil yang atur).
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { listSessions } from "./pty";
import { enqueueOutbox } from "./outbox";
import { zProjectId } from "@hanoman/shared";

// Pemisah oldId/newId dalam recordId outbox rename. Slug tak boleh memuat spasi (zProjectId),
// jadi aman sebagai delimiter.
export const RENAME_SEP = " ";

export type RenameAffected = {
  spec: number; ticket: number;
  notification: number; sessionResult: number;
  ticketAttachment: number; localBinding: number;
};

export async function renameProjectCore(
  tx: Prisma.TransactionClient, oldId: string, newId: string,
): Promise<RenameAffected> {
  // Cascade FK menangani Spec/Ticket saat id berubah. updatedAt disegarkan.
  await tx.project.update({ where: { id: oldId }, data: { id: newId, updatedAt: new Date() } });
  const spec = await tx.spec.count({ where: { projectId: newId } });
  const ticket = await tx.ticket.count({ where: { projectId: newId } });
  // Referensi longgar tanpa FK — cascade tak berlaku, update manual.
  const notification = (await tx.notification.updateMany({ where: { projectId: oldId }, data: { projectId: newId } })).count;
  const sessionResult = (await tx.sessionResult.updateMany({ where: { projectId: oldId }, data: { projectId: newId } })).count;
  const ticketAttachment = (await tx.ticketAttachment.updateMany({ where: { projectId: oldId }, data: { projectId: newId } })).count;
  // LocalBinding.projectId = @id → tak bisa di-update ke PK baru; pindah eksplisit (delete + create).
  const binding = await tx.localBinding.findUnique({ where: { projectId: oldId } });
  let localBinding = 0;
  if (binding) {
    await tx.localBinding.delete({ where: { projectId: oldId } });
    await tx.localBinding.create({ data: { projectId: newId, repoDir: binding.repoDir, createdAt: binding.createdAt } });
    localBinding = 1;
  }
  return { spec, ticket, notification, sessionResult, ticketAttachment, localBinding };
}

const ZERO_AFFECTED: RenameAffected = {
  spec: 0, ticket: 0, notification: 0, sessionResult: 0, ticketAttachment: 0, localBinding: 0,
};

export type RenameResult =
  | { ok: true; affected: RenameAffected }
  | { ok: false; code: 400 | 404 | 409; error: string };

// SPEC-255 · ADR-0064 · rename id project (dipanggil endpoint). Validasi slug + guard konflik/sesi
// aktif, lalu `renameProjectCore` dalam $transaction + naikkan version (version-stamp sync). Rename
// dicatat durable ke outbox `projectRename` agar sync mem-push operasi rename (bukan insert baru).
export async function renameProject(oldId: string, newId: string): Promise<RenameResult> {
  if (!zProjectId.safeParse(newId).success) return { ok: false, code: 400, error: "id baru tak sah (slug)" };
  if (oldId === newId) return { ok: true, affected: ZERO_AFFECTED };
  if (!(await prisma.project.findUnique({ where: { id: oldId } }))) return { ok: false, code: 404, error: "not found" };
  if (await prisma.project.findUnique({ where: { id: newId } })) return { ok: false, code: 409, error: `id "${newId}" sudah dipakai` };
  const active = listSessions().filter((s) => s.projectId === oldId && !s.exited).length;
  if (active) return { ok: false, code: 409, error: `project "${oldId}" masih punya ${active} sesi aktif` };

  const affected = await prisma.$transaction(async (tx) => {
    const a = await renameProjectCore(tx, oldId, newId);
    const cur = await tx.project.findUnique({ where: { id: newId }, select: { version: true } });
    await tx.project.update({ where: { id: newId }, data: { version: (cur?.version ?? 0) + 1 } });
    return a;
  });
  // Durable: catat rename agar sync mem-push operasi rename ke hub. Best-effort (tak menggagalkan).
  await enqueueOutbox("projectRename", `${oldId}${RENAME_SEP}${newId}`);
  return { ok: true, affected };
}
