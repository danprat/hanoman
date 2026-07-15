import { prisma } from "../db";
import { STAGES } from "./stage-machine";
import { scanRepoDocs } from "./scan";
import { resolveRepoDir } from "./local-binding";
import { docStatusFor } from "./coverage";
import { sessionPhases, type SessionInfo } from "./pty";
import type { Project } from "@prisma/client";
import type { ProjectView } from "@hanoman/shared";

const IDLE = { status: "idle" as const, phase: null as string | null, flow: null as string | null };

// Sesi tmux adalah satu-satunya sumber kebenaran soal pekerjaan yang sedang berjalan
// (ADR-0016). Tak ada baris DB yang bisa basi saat prosesnya mati. Sesi project biasa
// (tanpa specId) tidak dihitung: itu terminal, bukan pekerjaan atas backlog item.
// SPEC-197 · snapshot `sessions` dioper dari pemanggil (satu listSessions per request),
// bukan re-scan tmux per project.
function sessionOf(projectId: string, sessions: SessionInfo[]) {
  const s = sessions.find((x) => x.projectId === projectId && x.specId && !x.exited);
  if (!s) return { session: IDLE, commit: "belum ada commit" };
  const phase = sessionPhases(s.id)?.find((p) => p.state === "active")?.name ?? null;
  return {
    session: { status: "running" as const, phase, flow: s.flow ?? null },
    commit: `→ hanoman/${s.id}`,
  };
}

// SPEC-197 · terima baris project + snapshot sesi dari pemanggil: buang N+1 findUniqueOrThrow
// (baris sudah ada di GET /projects) dan re-scan tmux per project.
export async function toProjectView(p: Project, sessions: SessionInfo[]): Promise<ProjectView> {
  const specs = await prisma.spec.findMany({ where: { projectId: p.id } });
  // Coverage adalah nilai turunan, bukan state tersimpan (ADR-0018). SPEC-217 · pindai path
  // EFEKTIF (binding lokal per-mesin ?? Project.repoDir), bukan repoDir mentah — agar dashboard
  // menghormati checkout lokal. null / bukan git repo -> 0 -> "broken".
  const { coverage } = await scanRepoDocs(await resolveRepoDir(p.id));
  const open = specs.filter((s) => s.stage !== "done");
  const { session, commit } = sessionOf(p.id, sessions);
  const topStage = open.length
    ? open.map((s) => s.stage).sort((a, b) => STAGES.indexOf(b as any) - STAGES.indexOf(a as any))[0]!
    : "spec";
  return {
    id: p.id, name: p.name, desc: p.desc, kind: p.kind as any, repoDir: p.repoDir,
    gitRemote: p.gitRemote ?? null,
    stack: p.stack, docStatus: docStatusFor(coverage), coverage, createdAt: p.createdAt.toISOString(),
    backlog: open.length, topStage,
    session,
    activity: session.status === "running" ? `running · ${session.flow ?? "sesi"}` : "idle",
    commit,
  };
}
