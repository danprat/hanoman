import { prisma } from "../db";

// SPEC-213 · ADR-0043 · map projectId → repoDir LOCAL per-device. TAK PERNAH disync (AC-7).
// Binding lokal menang atas Project.repoDir agar hub bisa punya checkout sendiri sementara
// tiap client memetakan project ke folder lokalnya masing-masing.
export async function getBinding(projectId: string): Promise<string | null> {
  const b = await prisma.localBinding.findUnique({ where: { projectId } });
  return b?.repoDir ?? null;
}

export async function setBinding(projectId: string, repoDir: string): Promise<void> {
  await prisma.localBinding.upsert({
    where: { projectId },
    create: { projectId, repoDir },
    update: { repoDir },
  });
}

// Sumber repoDir efektif untuk spawn/scan/ide: binding lokal dulu, lalu Project.repoDir.
export async function resolveRepoDir(projectId: string): Promise<string | null> {
  const bound = await getBinding(projectId);
  if (bound) return bound;
  const p = await prisma.project.findUnique({ where: { id: projectId } });
  return p?.repoDir ?? null;
}
