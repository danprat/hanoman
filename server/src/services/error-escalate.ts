import { prisma } from "../db";
import { nextSpecId } from "./id";
import { resolveRepoDir } from "./local-binding";
import { notifySynced } from "./sync-notify";
import type { ErrorGroup, Spec } from "@prisma/client";

// SPEC-296 · inti eskalasi grup error → Spec qa, dipisah dari routes/errors.ts agar dipakai ulang
// oleh scheduler source-checker errors (JALUR yang sama, bukan duplikat). Kontrak HTTP route tak
// berubah. Idempoten via group.specId (grup sudah tertaut → kembalikan Spec tanpa membuat kedua).
export async function escalateErrorGroup(
  group: ErrorGroup, opts: { author: string },
): Promise<{ spec: Spec; created: boolean }> {
  if (group.specId) {
    const spec = await prisma.spec.findUnique({ where: { id: group.specId } });
    return { spec: spec!, created: false };
  }
  const short = group.message.length > 80 ? group.message.slice(0, 77) + "…" : group.message;
  const topStack = (group.sampleStack ?? "").split("\n").slice(0, 12).join("\n");
  const backlink = `Dari Error monitoring: grup ${group.id} (${group.count}×, ${group.environment}).`;
  const payload = {
    severity: "major" as const,
    steps: "Otomatis dari Error monitoring — reproduksi dari stack sampel.",
    expected: "Tidak ada error.",
    actual: `${group.type}: ${group.message}\n\n${topStack}\n\n${backlink}`,
    env: group.environment,
    fromErrorGroup: group.id,
  };
  const repoDir = await resolveRepoDir(group.projectId);
  // SPEC-197 · nextSpecId TOCTOU → retry P2002 (≤3), bukan 500. Cermin routes/specs.
  let spec: Spec | null = null;
  for (let attempt = 0; attempt < 3 && !spec; attempt++) {
    const sid = await nextSpecId(repoDir);
    try {
      spec = await prisma.spec.create({
        data: {
          id: sid, projectId: group.projectId, title: `${group.type}: ${short}`, source: "qa",
          stage: "brainstorming", priority: "tinggi", author: `QA · ${opts.author}`,
          objective: `${group.type}: ${group.message}. ${backlink}`, payload,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002" && attempt < 2) continue;
      throw e;
    }
  }
  await prisma.errorGroup.update({ where: { id: group.id }, data: { status: "escalated", specId: spec!.id } });
  await notifySynced("spec", spec!.id);   // SPEC-213/268 · spec ke feed
  await notifySynced("errorGroup", group.id); // SPEC-268 · status grup ke feed
  return { spec: spec!, created: true };
}
