import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { prisma } from "../db";
import { zTerminalSession, zIntegrate, type Stage } from "@hanoman/shared";
import { realGit, startPrompt, continuePrompt, startProjectPrompt, startPrdPrompt, startScaffoldPrompt, type Flow } from "@hanoman/runner";
import { phaseFilePath, decisionFilePath, readPhases, stageForRun } from "../services/session-phases";
import { specReview, reviewFile } from "../services/spec-review";
import { integrateBranch } from "../services/integrate";
import { sessionModel } from "../services/settings";
import { resolveRepoDir } from "../services/local-binding";
import { recordSessionResult } from "../services/session-result";
import { recordCompletion } from "../services/notifications";
import { STAGES } from "../services/stage-machine";
import {
  createSession, getSession, listSessions, killSession, sessionPhases,
  attach, detach, writeTo, resize, shellBin, type Client,
} from "../services/pty";

// Sebuah PTY di atas WebSocket adalah remote code execution secara desain — identik
// dengan menyerahkan shell. hanoman tidak punya autentikasi; satu-satunya yang berdiri
// di antara endpoint ini dan jaringan adalah server.ts yang bind ke 127.0.0.1.
// Bila HOST pernah diubah ke 0.0.0.0, endpoint inilah yang pertama harus digembok.

// Stage hanya maju (ADR-0008). Agen bisa saja tak pernah menulis berkas fasenya; itu tak
// boleh menyeret backlog item mundur ke `brainstorming`.
async function advanceStage(
  specId: string, repoDir: string, sessionId: string, flow: Flow, worktree: string,
): Promise<void> {
  // stageForRun (bukan stageFor): `Execute done` tak boleh mencapai `done` selama plan
  // spec-nya di worktree masih punya `- [ ]` — tahan di `executing` (SPEC-173, ADR-0029).
  const next = stageForRun(readPhases(phaseFilePath(repoDir, sessionId), flow), worktree, specId);
  if (!next) return;
  const spec = await prisma.spec.findUnique({ where: { id: specId }, select: { stage: true, title: true, projectId: true } });
  if (!spec || STAGES.indexOf(next) <= STAGES.indexOf(spec.stage as Stage)) return;
  // CAS (SPEC-197): hanya maju bila stage DB belum berubah sejak dibaca. Revert konkuren
  // (PATCH /specs mundur + hapus artefak docs) tak boleh ter-overwrite maju lagi.
  const { count } = await prisma.spec.updateMany({ where: { id: specId, stage: spec.stage }, data: { stage: next } });
  if (count === 0) return; // stage berubah di bawah kita → jangan lanjut ke recordCompletion
  // SPEC-213 · ADR-0047 · catat ringkasan hasil (activity log) untuk transisi stage ini —
  // whitelist field saja, tanpa transkrip/kredensial (AC-20/21). Best-effort: jangan blok sesi.
  let commitSha: string | null = null;
  try { commitSha = realGit.headSha(worktree); } catch { /* worktree lenyap */ }
  await recordSessionResult({
    projectId: spec.projectId, specId, oldStage: spec.stage, newStage: next,
    commitSha, branch: `hanoman/${sessionId}`, status: next === "done" ? "done" : "progress",
  }).catch(() => { /* activity log opsional */ });
  // SPEC-180 · transisi masuk `done` (guard di atas menjamin stage lama < done).
  if (next === "done") await recordCompletion(specId, spec.title, spec.projectId);
}

export default async function (app: FastifyInstance) {
  app.get("/terminal/sessions", async () => listSessions());

  app.post("/terminal/sessions", async (req, reply) => {
    const parsed = zTerminalSession.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });

    // Sesi backlog item: `claude` interaktif di worktree-nya sendiri, dengan prompt awal yang
    // memuat objective dan pipeline fase-nya (SPEC-162).
    if ("spec" in parsed.data) {
      const spec = await prisma.spec.findUnique({
        where: { id: parsed.data.spec }, include: { project: true },
      });
      if (!spec) return reply.code(404).send({ error: "spec not found" });
      // SPEC-213 · binding lokal per-device menang atas Project.repoDir (AC-8). Tanpa checkout
      // lokal → blokir + minta bind/clone dulu; kode status 400 dipertahankan (parity).
      const repoDir = await resolveRepoDir(spec.projectId);
      if (!repoDir) return reply.code(400).send({ error: `project "${spec.projectId}" belum di-bind ke checkout lokal`, needsBind: true });

      const id = spec.id.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
      // Sesi yang sudah hidup: JANGAN bangun ulang worktree-nya — di dalamnya ada pekerjaan
      // yang belum di-commit (ADR-0015).
      const live = getSession(id);
      if (live) return reply.code(201).send({ id: live.id });

      const { model, effort } = await sessionModel();
      // Worktree lahir `--detach` di commit branchFrom: sesi tak pernah berjalan di working
      // tree utama, dan `main` boleh tetap ter-checkout di sana (ADR-0002).
      // baseSha = commit detach worktree; disimpan agar review backlog done men-diff
      // baseSha..headSha, bukan grep pesan commit (SPEC-176, ADR-0030). Overwrite tiap sesi:
      // range review = perubahan sesi ini.
      // SPEC-197 · fallback "HEAD" (bukan "main"): repo target belum tentu punya branch bernama
      // main (default bisa master/develop). addWorktree throw bila revisi tak resolve / worktree
      // ter-lock → 422 jelas, bukan 500 stderr git mentah (cermin jalur reverse di bawah).
      let baseSha: string;
      try {
        baseSha = realGit.addWorktree(repoDir, `${repoDir}/.worktrees/${id}`, spec.branchFrom ?? "HEAD");
      } catch (e) {
        return reply.code(422).send({ error: `gagal membuat worktree: ${(e as Error).message}` });
      }
      await prisma.spec.update({ where: { id: spec.id }, data: { baseSha, headSha: null } });
      // SPEC-172 · spec yang keburu `done` di-reopen untuk melanjutkan (lanjut di Execute,
      // tak mengulang pipeline). Deteksi dari stage — satu-satunya jalur yang men-start spec
      // `done` adalah tombol "Buka sesi lagi" di detail; list/grid/board menyembunyikan start.
      const mkPrompt = spec.stage === "done" ? continuePrompt : startPrompt;
      const s = createSession(spec.projectId, `${repoDir}/.worktrees/${id}`, {
        specId: spec.id, flow: parsed.data.flow, model, effort,
        phaseFile: phaseFilePath(repoDir, id),
        decisionFile: decisionFilePath(repoDir, id),
        prompt: mkPrompt(parsed.data.flow, {
          id: spec.id, title: spec.title, source: spec.source,
          priority: spec.priority, objective: spec.objective, payload: spec.payload ?? undefined,
        }, `hanoman/${id}`),
      });
      return reply.code(201).send({ id: s.id });
    }

    const project = await prisma.project.findUnique({ where: { id: parsed.data.project } });
    if (!project) return reply.code(404).send({ error: "project not found" });

    // SPEC-236 · terminal biasa non-claude: shell mentah di repoDir project. Reuse cabang
    // createSession({command}) (ADR-0042/0056). Tanpa flow → tak menggerakkan stage; cwd=repoDir
    // (bukan .worktrees) → DELETE hanya kill pane, tak menyentuh working tree. Ditaruh sebelum
    // guard repoDir lama supaya TS menyempitkan varian shell keluar sebelum `parsed.data.flow`.
    if ("shell" in parsed.data && parsed.data.shell) {
      const repoDir = await resolveRepoDir(project.id);
      if (!repoDir) return reply.code(400)
        .send({ error: `project "${project.id}" belum di-bind ke checkout lokal`, needsBind: true });
      const s = createSession(project.id, repoDir, { command: [shellBin()] });
      return reply.code(201).send({ id: s.id });
    }

    // SPEC-213 · binding lokal per-device menang atas Project.repoDir (AC-8). Kode status
    // dipertahankan (flow → 422, non-flow → 400) untuk parity; `needsBind` memberi sinyal UI.
    const repoDir = await resolveRepoDir(project.id);
    if (!repoDir) {
      return reply.code(parsed.data.flow ? 422 : 400)
        .send({ error: `project "${project.id}" belum di-bind ke checkout lokal`, needsBind: true });
    }

    // SPEC-166 · sesi reverse: worktree + prompt standar docs, tanpa Spec. Id deterministik
    // dari project-nya supaya Start kedua menyambung ke sesi yang sama (ADR-0015).
    if (parsed.data.flow === "reverse") {
      const id = `reverse-${project.id.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
      const live = getSession(id);
      if (live) return reply.code(201).send({ id: live.id });

      const { model, effort } = await sessionModel();
      try {
        // HEAD, bukan "main": repo target bukan milik hanoman — default branch-nya bebas.
        realGit.addWorktree(repoDir, `${repoDir}/.worktrees/${id}`, "HEAD");
      } catch (e) {
        return reply.code(422).send({ error: `gagal membuat worktree: ${(e as Error).message}` });
      }
      const s = createSession(project.id, `${repoDir}/.worktrees/${id}`, {
        id, flow: "reverse", model, effort,
        phaseFile: phaseFilePath(repoDir, id),
        decisionFile: decisionFilePath(repoDir, id),
        prompt: startProjectPrompt("reverse", {
          id: project.id, name: project.name, desc: project.desc, stack: project.stack,
        }, "reverse-docs"),
      });
      return reply.code(201).send({ id: s.id });
    }

    // SPEC-222 · sesi scaffold project-level: dari ide → Source of Truth penuh. Id deterministik
    // dari project (Start kedua menyambung, ADR-0015). Cermin reverse; diseed dari project.desc.
    if (parsed.data.flow === "scaffold") {
      const id = `scaffold-${project.id.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
      const live = getSession(id);
      if (live) return reply.code(201).send({ id: live.id });

      const { model, effort } = await sessionModel();
      try {
        // SPEC-223 · "project baru pasti kosongan": repoDir bisa BELUM ada di disk saat scaffold
        // (project di-sync dari device lain, folder dipindah/hapus, atau init-saat-create tak jalan).
        // initRepo idempoten (mkdir + git init + commit seed bila belum ada HEAD) — jaring pengaman
        // agar scaffold dari ide tak pernah mati `spawnSync git ENOENT`. Scaffold ⟺ from-scratch,
        // jadi memiliki lifecycle repo kosong memang tugasnya (bukan mengasumsikannya, ADR-0052).
        realGit.initRepo(repoDir);
        realGit.addWorktree(repoDir, `${repoDir}/.worktrees/${id}`, "HEAD");
      } catch (e) {
        return reply.code(422).send({ error: `gagal membuat worktree: ${(e as Error).message}` });
      }
      const s = createSession(project.id, `${repoDir}/.worktrees/${id}`, {
        id, flow: "scaffold", model, effort,
        phaseFile: phaseFilePath(repoDir, id),
        decisionFile: decisionFilePath(repoDir, id),
        prompt: startScaffoldPrompt(
          { id: project.id, name: project.name, desc: project.desc, stack: project.stack },
          "scaffold-docs"),
      });
      return reply.code(201).send({ id: s.id });
    }

    // SPEC-210 · sesi prd project-level: PM menyusun dokumen PRD dari brief + brainstorm. Meniru
    // reverse (worktree isolasi, push ke branch prd/<slug>, manusia merge). Tanpa Spec: DELETE
    // session tak menggerakkan stage (dijaga `if (s.specId)`), worktree tetap dibersihkan.
    if (parsed.data.flow === "prd") {
      const { brief } = parsed.data;
      const slug = brief.title.toLowerCase().trim()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
      if (!slug) return reply.code(400).send({ error: "judul PRD kosong" });
      const id = `prd-${slug}`;
      const live = getSession(id);
      if (live) return reply.code(201).send({ id: live.id });

      const { model, effort } = await sessionModel();
      try {
        // HEAD, bukan "main": repo target bukan milik hanoman — default branch-nya bebas.
        realGit.addWorktree(repoDir, `${repoDir}/.worktrees/${id}`, "HEAD");
      } catch (e) {
        return reply.code(422).send({ error: `gagal membuat worktree: ${(e as Error).message}` });
      }
      const s = createSession(project.id, `${repoDir}/.worktrees/${id}`, {
        id, flow: "prd", branch: `prd/${slug}`, model, effort,
        phaseFile: phaseFilePath(repoDir, id),
        decisionFile: decisionFilePath(repoDir, id),
        prompt: startPrdPrompt(
          { id: project.id, name: project.name, desc: project.desc, stack: project.stack },
          brief, `prd/${slug}`),
      });
      return reply.code(201).send({ id: s.id });
    }

    const s = createSession(project.id, repoDir);
    return reply.code(201).send({ id: s.id });
  });

  app.get("/terminal/sessions/:id/phases", async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = getSession(id);
    const phases = sessionPhases(id);
    if (!s?.flow || !phases) return reply.code(404).send({ error: "not found" });
    return { flow: s.flow, phases };
  });

  // SPEC-230 · review diff worktree hidup sebuah sesi project-level (PRD). Kunci worktree = id
  // sesi (worktreeDir(repoDir, id) === s.cwd). Tanpa baseSha/branchFrom → mergeBase jatuh ke
  // default repo/HEAD (SPEC-227). Worktree lenyap (sesi ditutup) → 409, bukan 500.
  type WtOk = { ok: true; id: string; repoDir: string };
  type WtErr = { ok: false; code: number; msg: string };
  const sessionWorktree = async (id: string): Promise<WtOk | WtErr> => {
    const s = getSession(id);
    if (!s) return { ok: false, code: 404, msg: "not found" };
    const repoDir = await resolveRepoDir(s.projectId);
    if (!repoDir) return { ok: false, code: 409, msg: "project belum punya repoDir" };
    if (!s.cwd.includes("/.worktrees/") || !existsSync(s.cwd))
      return { ok: false, code: 409, msg: "belum ada worktree untuk di-review — jalankan/lanjutkan sesi dulu" };
    return { ok: true, id: s.id, repoDir };
  };
  app.get("/terminal/sessions/:id/review", async (req, reply) => {
    const r = await sessionWorktree((req.params as { id: string }).id);
    if (!r.ok) return reply.code(r.code).send({ error: r.msg });
    return specReview(r.repoDir, r.id, null, null);
  });
  app.get("/terminal/sessions/:id/review/*", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const path = (req.params as Record<string, string>)["*"] ?? "";
    const r = await sessionWorktree(id);
    if (!r.ok) return reply.code(r.code).send({ error: r.msg });
    const rf = await reviewFile(r.repoDir, r.id, null, null, path);
    return rf === null ? reply.code(404).send({ error: "not found" }) : rf;
  });

  // SPEC-230 · rebase/merge branch sesi project-level (PRD: prd/<slug>). Bersih → langsung;
  // konflik → spawn sesi claude di worktree merge-<id> (tanpa flow → tak menggerakkan stage, ADR-0031).
  app.post("/terminal/sessions/:id/integrate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zIntegrate.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "op/target invalid" });
    const s = getSession(id);
    if (!s) return reply.code(404).send({ error: "not found" });
    if (!s.branch) return reply.code(409).send({ error: "sesi ini tak punya branch untuk di-integrasi" });
    const repoDir = await resolveRepoDir(s.projectId);
    if (!repoDir) return reply.code(409).send({ error: "project belum punya repoDir" });
    const r = await integrateBranch(repoDir, { branch: s.branch, mergeId: s.id }, parsed.data.op, parsed.data.target);
    if (r.status === "error") return reply.code(r.code).send({ error: r.error });
    if (r.status === "clean") return { status: "clean", detail: r.detail };
    // conflict → sesi claude interaktif di worktree yang tertinggal (tanpa flow → tak menggerakkan stage).
    const { model, effort } = await sessionModel();
    const prompt = [
      `hanoman · selesaikan konflik ${r.op} branch \`${s.branch}\` ${r.op === "merge" ? "ke" : "di atas"} \`${r.target}\`.`,
      `Kamu berada di worktree yang tertinggal di tengah operasi ${r.op} dengan konflik. Resolve konflik pada file bertanda, jaga kedua sisi perubahan sesuai maksudnya.`,
      r.finalize,
      `Sesi PRD ${s.id}.`,
    ].join("\n\n");
    const cs = createSession(s.projectId, r.worktree, {
      id: `merge-${id.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`,
      model, effort, prompt,
    });
    return { status: "conflict", sessionId: cs.id };
  });

  app.delete("/terminal/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = getSession(id);
    if (!s) return reply.code(404).send({ error: "not found" });

    // Sesi ber-flow (run/reverse) DAN sesi integrasi (SPEC-175, tanpa flow) sama-sama hidup di
    // worktree-nya sendiri di `.worktrees/*` — keduanya harus dibersihkan. Hanya yang ber-spec-flow
    // menggerakkan stage. Terminal biasa (cwd = repoDir) tak tersentuh.
    if (s.flow || s.cwd.includes("/.worktrees/")) {
      // SPEC-213 · pakai binding lokal (menang atas Project.repoDir) agar worktree sesi ter-bind
      // pada project murni-metadata tetap dibersihkan.
      const repoDir = await resolveRepoDir(s.projectId);
      if (repoDir) {
        // Bacaan terakhir sebelum worktree-nya lenyap: sesudah ini berkas fasenya tak berarti lagi.
        if (s.specId) {
          if (s.flow) await advanceStage(s.specId, repoDir, id, s.flow, s.cwd);
          // HEAD worktree = ujung range review sesudah item selesai (SPEC-176, ADR-0030).
          // Dibaca sebelum removeWorktree; gagal-diam agar tak memblok penutupan sesi.
          try {
            const headSha = realGit.headSha(s.cwd);
            await prisma.spec.update({ where: { id: s.specId }, data: { headSha } });
          } catch { /* HEAD tak resolve — biarkan headSha apa adanya */ }
        }
        killSession(id);
        realGit.removeWorktree(repoDir, s.cwd);
        return reply.code(204).send();
      }
    }
    killSession(id);
    return reply.code(204).send();
  });

  app.get("/terminal/sessions/:id/ws", { websocket: true }, (socket, req) => {
    const { id } = req.params as { id: string };
    if (!getSession(id)) return socket.close(4004, "not found");
    const client: Client = { send: (m) => socket.send(m), close: () => socket.close() };
    attach(id, client);
    socket.on("message", (raw: Buffer) => {
      let m: { t?: string; d?: string; cols?: number; rows?: number };
      // ponytail: frame rusak dibuang diam-diam — pengirimnya UI kita sendiri.
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === "in" && typeof m.d === "string") writeTo(id, m.d);
      else if (m.t === "resize" && m.cols && m.rows) resize(id, m.cols, m.rows);
    });
    socket.on("close", () => detach(id, client));
  });
}
