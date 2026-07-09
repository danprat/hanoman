import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { prisma } from "../db";
import { zTerminalSession } from "@hanoman/shared";
import {
  createSession, getSession, listSessions, killSession,
  attach, detach, writeTo, resize, type Client,
} from "../services/pty";

// Sebuah PTY di atas WebSocket adalah remote code execution secara desain — identik
// dengan menyerahkan shell. hanoman tidak punya autentikasi; satu-satunya yang berdiri
// di antara endpoint ini dan jaringan adalah server.ts yang bind ke 127.0.0.1.
// Bila HOST pernah diubah ke 0.0.0.0, endpoint inilah yang pertama harus digembok.
export default async function (app: FastifyInstance) {
  app.get("/terminal/sessions", async () => listSessions());

  app.post("/terminal/sessions", async (req, reply) => {
    const parsed = zTerminalSession.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });

    // Sesi run: `claude --resume` di dalam worktree run — sesi run itu sendiri, dengan
    // seluruh riwayat fasenya, bukan sesi baru yang menyerupainya (SPEC-013).
    if ("run" in parsed.data) {
      const run = await prisma.run.findUnique({ where: { id: parsed.data.run } });
      if (!run) return reply.code(404).send({ error: "run not found" });
      if (run.status === "done") return reply.code(400).send({ error: `run "${run.id}" sudah selesai — worktree-nya dihapus` });
      if (!run.sessionId) return reply.code(400).send({ error: `run "${run.id}" belum punya sesi claude` });
      // Jangan diam-diam jatuh ke repoDir: itu membuka sesi di working tree utama (ADR-0002).
      if (!existsSync(run.worktree)) return reply.code(400).send({ error: `worktree hilang: ${run.worktree}` });
      const s = createSession(run.projectId, run.worktree, { runId: run.id, resume: run.sessionId });
      return reply.code(201).send({ id: s.id });
    }

    const project = await prisma.project.findUnique({ where: { id: parsed.data.project } });
    if (!project) return reply.code(404).send({ error: "project not found" });
    if (!project.repoDir) return reply.code(400).send({ error: `project "${project.id}" belum punya repoDir` });
    const s = createSession(project.id, project.repoDir);
    return reply.code(201).send({ id: s.id });
  });

  app.delete("/terminal/sessions/:id", async (req, reply) => {
    const ok = killSession((req.params as { id: string }).id);
    return ok ? reply.code(204).send() : reply.code(404).send({ error: "not found" });
  });

  app.get("/terminal/sessions/:id/ws", { websocket: true }, (socket, req) => {
    const s = getSession((req.params as { id: string }).id);
    if (!s) return socket.close(4004, "not found");
    const client: Client = { send: (m) => socket.send(m), close: () => socket.close() };
    attach(s, client);
    socket.on("message", (raw: Buffer) => {
      let m: { t?: string; d?: string; cols?: number; rows?: number };
      // ponytail: frame rusak dibuang diam-diam — pengirimnya UI kita sendiri.
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === "in" && typeof m.d === "string") writeTo(s, m.d);
      else if (m.t === "resize" && m.cols && m.rows) resize(s, m.cols, m.rows);
    });
    socket.on("close", () => detach(s, client));
  });
}
