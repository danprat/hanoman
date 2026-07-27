import { prisma } from "../db";
import type { ProjectLink } from "@prisma/client";

// SPEC-337 · ADR-0074 · relasi integrasi antar project. Berarah (from BERGANTUNG PADA to), tapi
// "tetangga" sebuah project selalu union KEDUA arah — issue integrasi tak peduli siapa pemanggil.
// Satu hop, bukan closure transitif: batasnya harus bisa diterangkan dalam satu kalimat.
export type LinkDirection = "keluar" | "masuk";
export type LinkView = {
  id: string; fromProjectId: string; toProjectId: string; kind: string; note: string;
  direction: LinkDirection; other: { id: string; name: string };
};

export const linksOf = (projectId: string): Promise<ProjectLink[]> =>
  prisma.projectLink.findMany({
    where: { OR: [{ fromProjectId: projectId }, { toProjectId: projectId }] },
    orderBy: { createdAt: "asc" },
  });

export function neighborIds(projectId: string, links: ProjectLink[]): string[] {
  const out = new Set<string>();
  for (const l of links) {
    const other = l.fromProjectId === projectId ? l.toProjectId : l.fromProjectId;
    if (other !== projectId) out.add(other);   // self-link ditolak di boundary, tapi jangan pernah jadi tetangga
  }
  return [...out];
}

export async function linkViews(projectId: string, links: ProjectLink[]): Promise<LinkView[]> {
  const ids = neighborIds(projectId, links);
  const rows = await prisma.project.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const names = new Map(rows.map((p) => [p.id, p.name]));
  return links.map((l) => {
    const direction: LinkDirection = l.fromProjectId === projectId ? "keluar" : "masuk";
    const otherId = direction === "keluar" ? l.toProjectId : l.fromProjectId;
    return {
      id: l.id, fromProjectId: l.fromProjectId, toProjectId: l.toProjectId,
      kind: l.kind, note: l.note, direction,
      other: { id: otherId, name: names.get(otherId) ?? otherId },
    };
  });
}

// Scope sesi audit lintas: project utama DULU (urutan dipakai prompt), lalu tetangganya.
export async function auditScopeOf(projectId: string): Promise<string[]> {
  return [projectId, ...neighborIds(projectId, await linksOf(projectId))];
}
