import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { zCreateSpec, zPatchSpec, type Stage } from "@hanoman/shared";
import { prisma } from "../db";
import { specReview, reviewFile, worktreeDir, specCommitRange, specReviewRange, reviewFileRange } from "../services/spec-review";
import { nextSpecId } from "../services/id";
import { listRepoBranches } from "../services/branches";
import { STAGES } from "../services/stage-machine";
import { artifactsToRemove } from "../services/stage-artifacts";
import { deleteDoc } from "../services/docs";
import { listSpecDocs, resolveDir } from "../services/spec-docs";
import { readDocFile } from "../services/scan";
import { sessionPhasesBySpec } from "../services/pty";
import { stageForRun } from "../services/session-phases";
import { recordCompletion } from "../services/notifications";

// SPEC-143: daftar yang mengisi dropdown adalah daftar yang menjaga gerbang — tak ada validator
// terpisah yang bisa ikut basi. Branch karangan ditolak di sini, bukan beberapa menit kemudian
// saat worktree gagal di dalam run.
const branchUnknown = (repoDir: string | null, branch: string) => !listRepoBranches(repoDir).includes(branch);

export default async function (app: FastifyInstance) {
  app.get("/specs", async (req) => {
    const { project, source } = req.query as { project?: string; source?: string };
    const specs = await prisma.spec.findMany({ where: { projectId: project, source }, orderBy: { id: "desc" } });
    // Stage live: selama sesi hidup, stage diturunkan dari berkas fase sesi (SPEC-168). Hanya
    // maju (ADR-0008).
    const live = sessionPhasesBySpec();
    if (live.size === 0) return specs;
    const advanced: { id: string; stage: Stage }[] = [];
    const doneNow: { specId: string; title: string; projectId: string | null }[] = [];
    const out = specs.map((s) => {
      const entry = live.get(s.id);
      if (!entry) return s;
      // stageForRun menahan `done` bila plan di worktree (entry.cwd) masih `- [ ]` (SPEC-173).
      const next = stageForRun(entry.phases, entry.cwd, s.id);
      if (!next || STAGES.indexOf(next) <= STAGES.indexOf(s.stage as Stage)) return s;
      advanced.push({ id: s.id, stage: next });
      if (next === "done") doneNow.push({ specId: s.id, title: s.title, projectId: s.projectId });
      return { ...s, stage: next };
    });
    // Write-through pada kemajuan: tulis balik supaya stage selamat kalau sesi mati tanpa DELETE
    // (reboot, tmux tewas, berkas fase terhapus). Forward-only sudah dijamin guard di atas.
    // ponytail: read bisa balapan dengan read lain yang lebih maju; nilai persist eventually-
    // consistent (poll berikutnya menyembuhkannya ≤3s) — respons ke klien selalu dari turunan.
    if (advanced.length)
      await Promise.all(advanced.map((a) =>
        prisma.spec.update({ where: { id: a.id }, data: { stage: a.stage } }).catch(() => { })));
    // SPEC-180 · notif dibuat sesudah persist stage; recordCompletion idempoten (specId unik).
    await Promise.all(doneNow.map((d) => recordCompletion(d.specId, d.title, d.projectId)));
    return out;
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
    // Author = user yang login (req.user diisi gate auth; dijamin ada di prod, fallback hanya
    // untuk test requireAuth:false). Prefix `QA ·` tetap menandai spec dari alur QA.
    const author = req.user?.email ?? "system";
    const spec = await prisma.spec.create({
      data: {
        id, projectId: b.project, title: b.title, source: b.source, stage: "brainstorming",
        priority, author: isQa ? `QA · ${author}` : author, objective, payload: b.payload,
        branchFrom: b.branchFrom ?? null
      }
    });
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
      for (const rel of wouldDelete) await deleteDoc(spec.projectId, rel).catch(() => { });
    }
    const data: { branchFrom?: string | null; stage?: string } = {};
    if (branchFrom !== undefined) data.branchFrom = branchFrom;
    if (stage !== undefined) data.stage = stage;
    return prisma.spec.update({ where: { id }, data });
  });
  // SPEC-170 · dokumen sebuah backlog item (audit/objective/spec/plan/brainstorm).
  // Sumber freshest-wins ada di resolveDir: worktree sesi hidup > repoDir.
  app.get("/specs/:id/docs", async (req) =>
    ({ files: await listSpecDocs((req.params as { id: string }).id) }));

  app.get("/specs/:id/docs/*", async (req, reply) => {
    const { id } = req.params as { id: string };
    const path = (req.params as Record<string, string>)["*"] ?? "";
    const dir = await resolveDir(id);
    const content = dir ? readDocFile(dir, path) : null; // readDocFile menolak non-.md -> null
    return content === null ? reply.code(404).send({ error: "not found" }) : { path, content };
  });

  app.delete("/specs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.spec.delete({ where: { id } }).catch(() => { });
    return reply.code(204).send();
  });

  // SPEC-171 · review backlog item: all files + file changed, diturunkan dari git.
  // Worktree hidup <repoDir>/.worktrees/<specid> → diff atas working tree. Worktree lenyap
  // (item selesai) → jatuh ke range commit `oldest(spec-N)^..newest` di history, jadi perubahan
  // tetap bisa di-review sesudah selesai. Tak ada keduanya → 409. Gerbang path ada di reviewFile*.
  const specWithProject = (id: string) =>
    prisma.spec.findUnique({ where: { id }, include: { project: true } });
  // wt hidup > commit history. Null = tak ada sumber apa pun (409).
  const resolveReview = async (repoDir: string, id: string) =>
    existsSync(worktreeDir(repoDir, id))
      ? { wt: true as const }
      : await specCommitRange(repoDir, id).then((r) => (r ? { wt: false as const, ...r } : null));
  app.get("/specs/:id/review", async (req, reply) => {
    const { id } = req.params as { id: string };
    const spec = await specWithProject(id);
    if (!spec) return reply.code(404).send({ error: "not found" });
    if (!spec.project.repoDir) return reply.code(409).send({ error: "project belum punya repoDir" });
    const r = await resolveReview(spec.project.repoDir, id);
    if (!r) return reply.code(409).send({ error: "belum ada worktree atau commit untuk di-review — jalankan/lanjutkan sesi backlog dulu" });
    return r.wt ? specReview(spec.project.repoDir, id, spec.branchFrom)
      : specReviewRange(spec.project.repoDir, r.base, r.head);
  });
  app.get("/specs/:id/review/*", async (req, reply) => {
    const { id } = req.params as { id: string };
    const path = (req.params as Record<string, string>)["*"] ?? "";
    const spec = await specWithProject(id);
    if (!spec) return reply.code(404).send({ error: "not found" });
    if (!spec.project.repoDir) return reply.code(409).send({ error: "project belum punya repoDir" });
    const r = await resolveReview(spec.project.repoDir, id);
    if (!r) return reply.code(409).send({ error: "belum ada worktree atau commit" });
    const rf = r.wt ? await reviewFile(spec.project.repoDir, id, spec.branchFrom, path)
      : await reviewFileRange(spec.project.repoDir, r.base, r.head, path);
    return rf === null ? reply.code(404).send({ error: "not found" }) : rf;
  });
}
