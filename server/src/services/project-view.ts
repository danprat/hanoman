import { prisma } from "../db";
import { STAGES } from "./stage-machine";
import { scanRepoDocs } from "./scan";
import { docStatusFor } from "./coverage";
import type { ProjectView } from "@hanoman/shared";
const IDLE = { status: "idle", phase: null as string | null, kind: null as string | null };
export async function toProjectView(projectId: string): Promise<ProjectView> {
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const specs = await prisma.spec.findMany({ where: { projectId } });
  const runs = await prisma.run.findMany({ where: { projectId } });
  // Coverage adalah nilai turunan, bukan state tersimpan (ADR-0018). `p` sudah di-fetch,
  // jadi tak ada query tambahan. repoDir null / bukan git repo -> 0 -> "broken", persis
  // nilai yang dulu di-hardcode saat create.
  const { coverage } = await scanRepoDocs(p.repoDir);
  const open = specs.filter((s) => s.stage !== "done");
  const latest = runs[runs.length - 1];
  const activePhase = latest ? (latest.phases as { name: string; state: string }[]).find((f) => f.state === "active")?.name ?? null : null;
  const topStage = open.length
    ? open.map((s) => s.stage).sort((a, b) => STAGES.indexOf(b as any) - STAGES.indexOf(a as any))[0]!
    : "spec";
  return {
    id: p.id, name: p.name, desc: p.desc, kind: p.kind as any, repoDir: p.repoDir, repoUrl: p.repoUrl,
    stack: p.stack, docStatus: docStatusFor(coverage), coverage, createdAt: p.createdAt.toISOString(),
    backlog: open.length, topStage,
    run: latest ? { status: latest.status, phase: activePhase, kind: latest.kind } : IDLE,
    activity: latest ? `${latest.status} · ${latest.kind}` : "idle",
    commit: latest ? `→ ${latest.branchTo}` : "belum ada commit",
  };
}
