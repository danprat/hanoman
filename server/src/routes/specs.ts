import type { FastifyInstance } from "fastify";
import { zCreateSpec, zPatchSpec, type Stage } from "@hanoman/shared";
import { prisma } from "../db";
import { nextSpecId } from "../services/id";
import { listRepoBranches } from "../services/branches";
import { STAGES } from "../services/stage-machine";
import { artifactsToRemove } from "../services/stage-artifacts";
import { deleteDoc } from "../services/docs";

// SPEC-143: daftar yang mengisi dropdown adalah daftar yang menjaga gerbang — tak ada validator
// terpisah yang bisa ikut basi. Branch karangan ditolak di sini, bukan beberapa menit kemudian
// saat worktree gagal di dalam run.
const branchUnknown = (repoDir: string | null, branch: string) => !listRepoBranches(repoDir).includes(branch);

export default async function (app: FastifyInstance) {
  app.get("/specs", async (req) => {
    const { project, source } = req.query as { project?: string; source?: string };
    return prisma.spec.findMany({ where: { projectId: project, source }, orderBy: { id: "desc" } });
  });
  app.post("/specs", async (req, reply) => {
    const parsed = zCreateSpec.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    // Validasi branch menuntut baris Project-nya dimuat. Efek sampingnya diinginkan:
    // project tak dikenal kini 404 jujur, bukan pelanggaran foreign-key.
    const project = await prisma.project.findUnique({ where: { id: b.project } });
    if (!project) return reply.code(404).send({ error: `project "${b.project}" tidak ada` });
    if (b.branchFrom && branchUnknown(project.repoDir, b.branchFrom))
      return reply.code(400).send({ error: `branch "${b.branchFrom}" tidak ada di repo project` });
    const id = await nextSpecId(project.repoDir);
    const isQa = b.source === "qa";
    const priority = isQa && "severity" in b.payload
      ? (b.payload.severity === "minor" ? "sedang" : "tinggi") : b.priority;
    const objective = isQa && "actual" in b.payload
      ? (b.payload.actual || b.payload.steps || "— audit untuk menelusuri akar masalah.")
      : ("outcome" in b.payload ? (b.payload.outcome || b.payload.context || "— brainstorm untuk memperjelas objective.") : "");
    const spec = await prisma.spec.create({ data: {
      id, projectId: b.project, title: b.title, source: b.source, stage: "brainstorming",
      priority, author: isQa ? "QA · Rangga" : "Rangga", objective, payload: b.payload,
      branchFrom: b.branchFrom ?? null } });
    return reply.code(201).send(spec);
  });
  // branchFrom (SPEC-143): basis run BERIKUTNYA; `null` = kembali ke default project.
  // stage (SPEC-167): revert backward-only, cermin terbalik dari guard forward-only
  // advanceStage() di terminal.ts. Saat mundur, artefak docs fase di atas target dibersihkan
  // lewat dry-run + confirmDelete (daftar berkas dikonfirmasi human di UI).
  app.patch("/specs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zPatchSpec.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const spec = await prisma.spec.findUnique({ where: { id } });
    if (!spec) return reply.code(404).send({ error: "not found" });
    const { branchFrom, stage, confirmDelete } = parsed.data;
    if (branchFrom) {
      const project = await prisma.project.findUnique({ where: { id: spec.projectId } });
      if (branchUnknown(project?.repoDir ?? null, branchFrom))
        return reply.code(400).send({ error: `branch "${branchFrom}" tidak ada di repo project` });
    }
    if (stage !== undefined) {
      if (STAGES.indexOf(stage) >= STAGES.indexOf(spec.stage as Stage))
        return reply.code(422).send({ error: "stage hanya boleh dikembalikan mundur" });
      const wouldDelete = await artifactsToRemove(spec.projectId, spec.id, stage, spec.stage as Stage);
      if (wouldDelete.length && confirmDelete !== true)
        return reply.send({ pending: true, stage, wouldDelete });
      for (const rel of wouldDelete) await deleteDoc(spec.projectId, rel).catch(() => {});
    }
    const data: { branchFrom?: string | null; stage?: string } = {};
    if (branchFrom !== undefined) data.branchFrom = branchFrom;
    if (stage !== undefined) data.stage = stage;
    return prisma.spec.update({ where: { id }, data });
  });
  app.delete("/specs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.spec.delete({ where: { id } }).catch(() => {});
    return reply.code(204).send();
  });
}
