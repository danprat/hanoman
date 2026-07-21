// SPEC-255 · ADR-0064 · rename Project.id secara transaksional. FK Spec/ErrorGroup/Ticket sudah
// ON UPDATE CASCADE (bawaan Prisma) → ikut otomatis saat UPDATE Project.id. Referensi longgar
// (tanpa FK) + LocalBinding (@id, LOCAL-only) di-update manual. `renameProjectCore` = helper murni:
// TANPA validasi slug / cek konflik / cek sesi (itu di `renameProject` & applyPush) dan TANPA
// menaikkan version (pemanggil yang atur).
import type { Prisma } from "@prisma/client";

export type RenameAffected = {
  spec: number; errorGroup: number; ticket: number;
  notification: number; sessionResult: number; errorEvent: number;
  ticketAttachment: number; localBinding: number;
};

export async function renameProjectCore(
  tx: Prisma.TransactionClient, oldId: string, newId: string,
): Promise<RenameAffected> {
  // Cascade FK menangani Spec/ErrorGroup/Ticket saat id berubah. updatedAt disegarkan.
  await tx.project.update({ where: { id: oldId }, data: { id: newId, updatedAt: new Date() } });
  const spec = await tx.spec.count({ where: { projectId: newId } });
  const errorGroup = await tx.errorGroup.count({ where: { projectId: newId } });
  const ticket = await tx.ticket.count({ where: { projectId: newId } });
  // Referensi longgar tanpa FK — cascade tak berlaku, update manual.
  const notification = (await tx.notification.updateMany({ where: { projectId: oldId }, data: { projectId: newId } })).count;
  const sessionResult = (await tx.sessionResult.updateMany({ where: { projectId: oldId }, data: { projectId: newId } })).count;
  const errorEvent = (await tx.errorEvent.updateMany({ where: { projectId: oldId }, data: { projectId: newId } })).count;
  const ticketAttachment = (await tx.ticketAttachment.updateMany({ where: { projectId: oldId }, data: { projectId: newId } })).count;
  // LocalBinding.projectId = @id → tak bisa di-update ke PK baru; pindah eksplisit (delete + create).
  const binding = await tx.localBinding.findUnique({ where: { projectId: oldId } });
  let localBinding = 0;
  if (binding) {
    await tx.localBinding.delete({ where: { projectId: oldId } });
    await tx.localBinding.create({ data: { projectId: newId, repoDir: binding.repoDir, createdAt: binding.createdAt } });
    localBinding = 1;
  }
  return { spec, errorGroup, ticket, notification, sessionResult, errorEvent, ticketAttachment, localBinding };
}
