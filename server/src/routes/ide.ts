import type { FastifyInstance } from "fastify";
import { prisma } from "../db";
import { resolveRepoDir } from "../services/local-binding";
import { listSessions } from "../services/pty";
import {
  listRepoTree, readRepoFile, writeRepoFile, listGraph, commitDetail, runGitOp, validateGitOp, type GitOp,
} from "../services/git-ide";

// undefined = project tak ada (→404); null = ada tapi tanpa checkout lokal; string = repoDir.
// SPEC-213 · binding lokal per-device menang atas Project.repoDir (AC-6).
async function repoOf(id: string): Promise<string | null | undefined> {
  const p = await prisma.project.findUnique({ where: { id } });
  if (!p) return undefined;
  return (await resolveRepoDir(id)) ?? null;
}
const activeSessions = (id: string) => listSessions().filter((s) => s.projectId === id && !s.exited).length;

export default async function (app: FastifyInstance) {
  app.get("/projects/:id/tree", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const ref = (req.query as { ref?: string }).ref ?? "";
    return { ref, files: await listRepoTree(repoDir, ref) };
  });

  app.get("/projects/:id/file", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const { path, ref } = req.query as { path?: string; ref?: string };
    if (!path) return reply.code(400).send({ error: "path wajib" });
    try {
      const f = await readRepoFile(repoDir, path, ref ?? "");
      return f === null ? reply.code(404).send({ error: "not found" }) : f;
    } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  // PUT /file SENGAJA tak digerbang sesi: menulis file bukan operasi git & tak memindah HEAD.
  app.put("/projects/:id/file", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const b = req.body as { path?: string; content?: string };
    if (!b?.path || typeof b.content !== "string") return reply.code(400).send({ error: "path & content wajib" });
    try { await writeRepoFile(repoDir, b.path, b.content); return { path: b.path, content: b.content }; }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  app.get("/projects/:id/graph", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const limit = Number((req.query as { limit?: string }).limit) || 200;
    return listGraph(repoDir, limit);
  });

  app.get("/projects/:id/commit/:sha", async (req, reply) => {
    const { id, sha } = req.params as { id: string; sha: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const d = await commitDetail(repoDir, sha);
    return d === null ? reply.code(404).send({ error: "not found" }) : d;
  });

  // Mutasi git. Gerbang sesi aktif (persis DELETE /projects); force melewatinya + menambah -f/-D.
  app.post("/projects/:id/git", async (req, reply) => {
    const { id } = req.params as { id: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const op = req.body as GitOp & { force?: boolean };
    const err = validateGitOp(op);
    if (err) return reply.code(400).send({ error: err });
    if (!op.force) {
      const n = activeSessions(id);
      if (n) return reply.code(409).send({ error: `project "${id}" punya ${n} sesi aktif; commit/stash atau paksa` });
    }
    const r = await runGitOp(repoDir, op);
    return r.ok ? r : reply.code(409).send({ error: r.stderr || "operasi git gagal", ...r });
  });
}
