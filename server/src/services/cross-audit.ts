// SPEC-337 · ADR-0075 · menyiapkan sesi audit lintas project: peta project ter-scope (utama +
// tetangga ProjectLink satu hop, kedua arah) + kunci baca log seumur sesi.
import { prisma } from "../db";
import type { CrossAuditCtx, CrossAuditProject } from "@hanoman/runner";
import { resolveRepoDir } from "./local-binding";
import { linksOf, linkViews } from "./project-links";
import { newAuditKey, auditApiUrl } from "./audit-scope";

export type CrossAuditBuild = { ctx: CrossAuditCtx; scope: string[] };

export async function buildCrossAuditCtx(primaryId: string): Promise<CrossAuditBuild | null> {
  const primary = await prisma.project.findUnique({ where: { id: primaryId } });
  if (!primary) return null;

  const views = await linkViews(primaryId, await linksOf(primaryId));
  const rows = await prisma.project.findMany({ where: { id: { in: views.map((v) => v.other.id) } } });
  const byId = new Map(rows.map((p) => [p.id, p]));

  const neighbors: CrossAuditProject[] = [];
  for (const v of views) {
    const p = byId.get(v.other.id);
    if (!p) continue;
    // Kalimat arah, bukan panah mentah: prompt dibaca agen, dan "A bergantung pada B" tak ambigu.
    const relation = v.direction === "keluar"
      ? `${primary.name} bergantung pada ${p.name} (${v.kind})`
      : `${p.name} bergantung pada ${primary.name} (${v.kind})`;
    neighbors.push({
      id: p.id, name: p.name, stack: p.stack,
      repoDir: await resolveRepoDir(p.id),   // null = belum di-bind di mesin ini; prompt menandainya
      relation, note: v.note,
    });
  }

  return {
    ctx: {
      primary: {
        id: primary.id, name: primary.name, stack: primary.stack,
        repoDir: await resolveRepoDir(primary.id),
      },
      neighbors,
      apiUrl: auditApiUrl(),
    },
    scope: [primary.id, ...neighbors.map((n) => n.id)],
  };
}

// Opsi createSession untuk sesi cross-audit: kunci di tmux option + env yang dibaca agen.
export function crossAuditSessionOpts(scope: string[]): {
  audit: { key: string; projects: string[] }; env: Record<string, string>;
} {
  const key = newAuditKey();
  return {
    audit: { key, projects: scope },
    env: { HANOMAN_AUDIT_KEY: key, HANOMAN_AUDIT_URL: auditApiUrl() },
  };
}
