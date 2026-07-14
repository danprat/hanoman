import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { zCreateSpec, zPatchSpec, zIntegrate, type Stage } from "@hanoman/shared";
import { integrate, sourceBranch } from "../services/integrate";
import { createSession } from "../services/pty";
import { sessionModel } from "../services/settings";
import { prisma } from "../db";
import { specReview, reviewFile, worktreeDir, specCommitRange, specReviewRange, reviewFileRange, shaResolvable } from "../services/spec-review";
import { nextSpecId } from "../services/id";
import { enqueueOutbox } from "../services/outbox";
import { listRepoBranches } from "../services/branches";
import { STAGES } from "../services/stage-machine";
import { artifactsToRemove } from "../services/stage-artifacts";
import { deleteDoc } from "../services/docs";
import { listSpecDocs, resolveDir } from "../services/spec-docs";
import { readDocFile } from "../services/scan";
import { paginate } from "../services/paginate";
// SPEC-199 · overlay stage-live + write-through + notifikasi kini di liveSpecs (dipakai juga hub
// siar WS) supaya push & pull tak drift. Rute tinggal filter+paginasi (SPEC-198) di atasnya.
import { liveSpecs } from "../services/live-specs";

// SPEC-143: daftar yang mengisi dropdown adalah daftar yang menjaga gerbang — tak ada validator
// terpisah yang bisa ikut basi. Branch karangan ditolak di sini, bukan beberapa menit kemudian
// saat worktree gagal di dalam run.
const branchUnknown = async (repoDir: string | null, branch: string) =>
  !(await listRepoBranches(repoDir)).includes(branch);

// SPEC-186 · derivasi priority + objective dari source+payload. Satu sumber untuk POST & PATCH:
// qa → priority dari severity, objective dari actual/steps; brief → priority manual, objective dari outcome/context.
function deriveSpecFields(source: string, payload: any, manualPriority: string) {
  const isQa = source === "qa";
  const priority = isQa && payload && "severity" in payload
    ? (payload.severity === "minor" ? "sedang" : "tinggi") : manualPriority;
  const objective = isQa && payload && "actual" in payload
    ? (payload.actual || payload.steps || "— audit untuk menelusuri akar masalah.")
    : (payload && "outcome" in payload ? (payload.outcome || payload.context || "— brainstorm untuk memperjelas objective.") : "");
  return { priority, objective };
}

// SPEC-198 · search/filter di layer response, DITERAPKAN SETELAH overlay stage-live —
// jadi filter `stage`/`startable` mencocokkan stage live, bukan stage DB yang basi.
function filterSpecs<T extends { id: string; title: string; objective: string; stage: string; priority: string }>(
  specs: T[], f: { q?: string; stage?: string; priority?: string; startable?: string },
): T[] {
  const needle = (f.q ?? "").trim().toLowerCase();
  return specs.filter((s) =>
    (!f.stage || s.stage === f.stage) &&
    (!f.priority || s.priority === f.priority) &&
    (f.startable !== "true" || s.stage !== "done") &&
    (needle === "" || `${s.id} ${s.title} ${s.objective}`.toLowerCase().includes(needle)));
}

export default async function (app: FastifyInstance) {
  app.get("/specs", async (req) => {
    const { project, source, q, stage, priority, startable, page, limit } =
      req.query as { project?: string; source?: string; q?: string; stage?: string;
        priority?: string; startable?: string; page?: string; limit?: string };
    // Overlay stage-live + write-through + notifikasi atas SET PENUH (scope project/source) —
    // sekarang di liveSpecs, dibagi dengan hub siar WS (SPEC-199) supaya push & pull tak drift.
    // Filter/paginasi DITERAPKAN SETELAH overlay (SPEC-198): filter `stage`/`startable` mencocokkan
    // stage live, bukan DB basi; spec off-page tetap maju stage & bernotif karena overlay lebih dulu.
    const overlaid = await liveSpecs({ project, source });
    return paginate(filterSpecs(overlaid, { q, stage, priority, startable }), page, limit);
  });
  app.post("/specs", async (req, reply) => {
    const parsed = zCreateSpec.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    // Validasi branch menuntut baris Project-nya dimuat. Efek sampingnya diinginkan:
    // project tak dikenal kini 404 jujur, bukan pelanggaran foreign-key.
    const project = await prisma.project.findUnique({ where: { id: b.project } });
    if (!project) return reply.code(404).send({ error: `project "${b.project}" tidak ada` });
    if (b.branchFrom && await branchUnknown(project.repoDir, b.branchFrom))
      return reply.code(400).send({ error: `branch "${b.branchFrom}" tidak ada di repo project` });
    const isQa = b.source === "qa";
    const { priority, objective } = deriveSpecFields(b.source, b.payload, b.priority);
    // Author = user yang login (req.user diisi gate auth; dijamin ada di prod, fallback hanya
    // untuk test requireAuth:false). Prefix `QA ·` tetap menandai spec dari alur QA.
    const author = req.user?.email ?? "system";
    const repoDir = project.repoDir;
    // SPEC-197 · nextSpecId menurunkan id dari max saat ini (TOCTOU): dua POST /specs konkuren bisa
    // menghitung id yang sama → unique violation P2002. Retry hitung ulang id (maks 3x) — bukan 500.
    let spec: Awaited<ReturnType<typeof prisma.spec.create>> | null = null;
    for (let attempt = 0; attempt < 3 && !spec; attempt++) {
      const id = await nextSpecId(repoDir);
      try {
        spec = await prisma.spec.create({
          data: {
            id, projectId: b.project, title: b.title, source: b.source, stage: "brainstorming",
            priority, author: isQa ? `QA · ${author}` : author, objective, payload: b.payload,
            branchFrom: b.branchFrom ?? null
          }
        });
      } catch (e) {
        if ((e as { code?: string }).code === "P2002" && attempt < 2) continue;
        throw e;
      }
    }
    if (spec) await enqueueOutbox("spec", spec.id); // SPEC-213 · antre push sync
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
    const { branchFrom, stage, confirmDelete, title, priority: newPriority, payload } = parsed.data;
    const editingContent = title !== undefined || newPriority !== undefined || payload !== undefined;
    // SPEC-186 · konten hanya boleh diubah selagi item masih di backlog & belum dimulai.
    if (editingContent && (spec.stage !== "brainstorming" || spec.baseSha !== null))
      return reply.code(409).send({ error: "backlog item sudah dimulai — tak bisa diedit" });
    if (branchFrom) {
      const project = await prisma.project.findUnique({ where: { id: spec.projectId } });
      if (await branchUnknown(project?.repoDir ?? null, branchFrom))
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
    const data: { branchFrom?: string | null; stage?: string; title?: string; priority?: string; objective?: string; payload?: any } = {};
    if (branchFrom !== undefined) data.branchFrom = branchFrom;
    if (stage !== undefined) data.stage = stage;
    if (editingContent) {
      const effPayload = payload ?? spec.payload;
      const { priority, objective } = deriveSpecFields(spec.source, effPayload, newPriority ?? spec.priority);
      if (title !== undefined) data.title = title;
      if (payload !== undefined) data.payload = payload;
      data.priority = priority;
      data.objective = objective;
    }
    const updated = await prisma.spec.update({ where: { id }, data });
    await enqueueOutbox("spec", id); // SPEC-213 · antre push sync
    return updated;
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

  // SPEC-175 · rebase/merge branch hasil sebuah done spec. Hanya untuk stage `done`. Server jalankan
  // git di worktree isolasi (never touch main working tree); conflict di-serahkan ke sesi claude (Task 4).
  app.post("/specs/:id/integrate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zIntegrate.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "op/target invalid" });
    const spec = await prisma.spec.findUnique({ where: { id }, include: { project: true } });
    if (!spec) return reply.code(404).send({ error: "not found" });
    if (spec.stage !== "done") return reply.code(409).send({ error: "hanya backlog item yang sudah done bisa di-rebase/merge" });
    if (!spec.project.repoDir) return reply.code(409).send({ error: "project belum punya repoDir" });
    const r = await integrate(spec.project.repoDir, spec.id, parsed.data.op, parsed.data.target);
    if (r.status === "error") return reply.code(r.code).send({ error: r.error });
    if (r.status === "clean") return { status: "clean", detail: r.detail };
    // conflict → sesi claude interaktif di worktree yang tertinggal (never touch main working tree).
    // Tanpa flow: tak menggerakkan stage; worktree-nya dibersihkan saat sesi ditutup (terminal.ts DELETE).
    const { model, effort } = await sessionModel();
    const prompt = [
      `hanoman · selesaikan konflik ${r.op} branch \`${sourceBranch(spec.id)}\` ${r.op === "merge" ? "ke" : "di atas"} \`${r.target}\`.`,
      `Kamu berada di worktree yang tertinggal di tengah operasi ${r.op} dengan konflik. Resolve konflik pada file bertanda, jaga kedua sisi perubahan sesuai maksudnya.`,
      r.finalize,
      `Backlog item ${spec.id} — ${spec.title}.`,
    ].join("\n\n");
    const s = createSession(spec.projectId, r.worktree, {
      id: `merge-${spec.id.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`,
      specId: spec.id, model, effort, prompt,
    });
    return { status: "conflict", sessionId: s.id };
  });

  // SPEC-171 · review backlog item: all files + file changed, diturunkan dari git.
  // Worktree hidup <repoDir>/.worktrees/<specid> → diff atas working tree. Worktree lenyap
  // (item selesai) → diff `baseSha..headSha` tersimpan (SPEC-176, ADR-0030), atau fallback
  // range commit `oldest(spec-N)^..newest` di history untuk spec lama tanpa SHA. Tak ada
  // sumber apa pun → 409. Gerbang path ada di reviewFile*.
  const specWithProject = (id: string) =>
    prisma.spec.findUnique({ where: { id }, include: { project: true } });
  // wt hidup > SHA tersimpan (bila objeknya masih terjangkau) > grep pesan commit. Null = 409.
  const resolveReview = async (
    repoDir: string, spec: { id: string; baseSha: string | null; headSha: string | null },
  ) => {
    if (existsSync(worktreeDir(repoDir, spec.id))) return { wt: true as const };
    if (spec.baseSha && spec.headSha
        && await shaResolvable(repoDir, spec.baseSha) && await shaResolvable(repoDir, spec.headSha))
      return { wt: false as const, base: spec.baseSha, head: spec.headSha };
    const r = await specCommitRange(repoDir, spec.id);
    return r ? { wt: false as const, ...r } : null;
  };
  app.get("/specs/:id/review", async (req, reply) => {
    const { id } = req.params as { id: string };
    const spec = await specWithProject(id);
    if (!spec) return reply.code(404).send({ error: "not found" });
    if (!spec.project.repoDir) return reply.code(409).send({ error: "project belum punya repoDir" });
    const r = await resolveReview(spec.project.repoDir, spec);
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
    const r = await resolveReview(spec.project.repoDir, spec);
    if (!r) return reply.code(409).send({ error: "belum ada worktree atau commit" });
    const rf = r.wt ? await reviewFile(spec.project.repoDir, id, spec.branchFrom, path)
      : await reviewFileRange(spec.project.repoDir, r.base, r.head, path);
    return rf === null ? reply.code(404).send({ error: "not found" }) : rf;
  });
}
