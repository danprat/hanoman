import type { FastifyInstance } from "fastify";
import { prisma } from "../db";
import { zTerminalSession, type Stage } from "@hanoman/shared";
import { realGit, startPrompt, continuePrompt, startProjectPrompt, type Flow } from "@hanoman/runner";
import { phaseFilePath, readPhases, stageForRun } from "../services/session-phases";
import { sessionModel } from "../services/settings";
import { recordCompletion } from "../services/notifications";
import { STAGES } from "../services/stage-machine";
import {
  createSession, getSession, listSessions, killSession, sessionPhases,
  attach, detach, writeTo, resize, type Client,
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
  await prisma.spec.update({ where: { id: specId }, data: { stage: next } });
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
      const { repoDir } = spec.project;
      if (!repoDir) return reply.code(400).send({ error: `project "${spec.projectId}" belum punya repoDir` });

      const id = spec.id.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
      // Sesi yang sudah hidup: JANGAN bangun ulang worktree-nya — di dalamnya ada pekerjaan
      // yang belum di-commit (ADR-0015).
      const live = getSession(id);
      if (live) return reply.code(201).send({ id: live.id });

      const { model, effort } = await sessionModel();
      // Worktree lahir `--detach` di commit branchFrom: sesi tak pernah berjalan di working
      // tree utama, dan `main` boleh tetap ter-checkout di sana (ADR-0002).
      realGit.addWorktree(repoDir, `${repoDir}/.worktrees/${id}`, spec.branchFrom ?? "main");
      // SPEC-172 · spec yang keburu `done` di-reopen untuk melanjutkan (lanjut di Execute,
      // tak mengulang pipeline). Deteksi dari stage — satu-satunya jalur yang men-start spec
      // `done` adalah tombol "Buka sesi lagi" di detail; list/grid/board menyembunyikan start.
      const mkPrompt = spec.stage === "done" ? continuePrompt : startPrompt;
      const s = createSession(spec.projectId, `${repoDir}/.worktrees/${id}`, {
        specId: spec.id, flow: parsed.data.flow, model, effort,
        phaseFile: phaseFilePath(repoDir, id),
        prompt: mkPrompt(parsed.data.flow, {
          id: spec.id, title: spec.title, source: spec.source,
          priority: spec.priority, objective: spec.objective, payload: spec.payload ?? undefined,
        }, `hanoman/${id}`),
      });
      return reply.code(201).send({ id: s.id });
    }

    const project = await prisma.project.findUnique({ where: { id: parsed.data.project } });
    if (!project) return reply.code(404).send({ error: "project not found" });
    if (!project.repoDir) {
      // 422 saat ber-flow (SPEC-166): body-nya sah, keadaan project-nya yang belum siap.
      return reply.code(parsed.data.flow ? 422 : 400)
        .send({ error: `project "${project.id}" belum punya repoDir` });
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
        realGit.addWorktree(project.repoDir, `${project.repoDir}/.worktrees/${id}`, "HEAD");
      } catch (e) {
        return reply.code(422).send({ error: `gagal membuat worktree: ${(e as Error).message}` });
      }
      const s = createSession(project.id, `${project.repoDir}/.worktrees/${id}`, {
        id, flow: "reverse", model, effort,
        phaseFile: phaseFilePath(project.repoDir, id),
        prompt: startProjectPrompt("reverse", {
          id: project.id, name: project.name, desc: project.desc, stack: project.stack,
        }, "reverse-docs"),
      });
      return reply.code(201).send({ id: s.id });
    }

    const s = createSession(project.id, project.repoDir);
    return reply.code(201).send({ id: s.id });
  });

  app.get("/terminal/sessions/:id/phases", async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = getSession(id);
    const phases = sessionPhases(id);
    if (!s?.flow || !phases) return reply.code(404).send({ error: "not found" });
    return { flow: s.flow, phases };
  });

  app.delete("/terminal/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = getSession(id);
    if (!s) return reply.code(404).send({ error: "not found" });

    // Sesi ber-flow apa pun hidup di worktree-nya sendiri — spec-bound maupun project-level
    // (reverse, SPEC-166). Hanya yang ber-spec menggerakkan stage.
    if (s.flow) {
      const project = await prisma.project.findUnique({ where: { id: s.projectId } });
      if (project?.repoDir) {
        // Bacaan terakhir sebelum worktree-nya lenyap: sesudah ini berkas fasenya tak berarti lagi.
        if (s.specId) await advanceStage(s.specId, project.repoDir, id, s.flow, s.cwd);
        killSession(id);
        realGit.removeWorktree(project.repoDir, s.cwd);
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
