import type { Stage } from "@hanoman/shared";
import { prisma } from "../db";
import { listRepoDocs } from "./scan";
import { STAGES } from "./stage-machine";

// Konvensi penamaan superpowers docs by spec-id adalah satu-satunya pemetaan fase→berkas
// yang andal di repo ini. Stage yang tak tercantum tak punya artefak berkas: `objective`
// hidup sebagai kolom DB, dan artefak Execute = kode/commit yang TAK PERNAH dihapus otomatis.
const ARTIFACT_DIR: Partial<Record<Stage, string>> = {
  "spec-ready": "docs/superpowers/specs/",
  planned: "docs/superpowers/plans/",
};

// Berkas yang dihapus saat revert `current`→`target`: artefak tiap stage S dengan
// target < S <= current. Cocok bila path di bawah dir stage itu DAN memuat segmen spec-id
// dengan batas kiri non-alnum & kanan non-digit — `spec-16` tak menyerempet `spec-167`.
export async function artifactsToRemove(
  projectId: string, specId: string, target: Stage, current: Stage,
): Promise<string[]> {
  const ti = STAGES.indexOf(target), ci = STAGES.indexOf(current);
  const dirs = STAGES
    .filter((_, i) => i > ti && i <= ci)
    .map((s) => ARTIFACT_DIR[s])
    .filter((d): d is string => !!d);
  if (!dirs.length) return [];
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { repoDir: true } });
  if (!project?.repoDir) return [];
  const id = specId.toLowerCase();
  const re = new RegExp(`(^|[^a-z0-9])${id}([^0-9]|$)`);
  const files = await listRepoDocs(project.repoDir);
  return files.filter((f) => dirs.some((d) => f.startsWith(d)) && re.test(f.toLowerCase()));
}
