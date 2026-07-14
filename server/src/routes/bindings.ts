import type { FastifyInstance } from "fastify";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import { prisma } from "../db";
import { getBinding, setBinding } from "../services/local-binding";

// SPEC-213 · ADR-0043 · bind/clone project server ke checkout lokal (per-device, LOCAL-only).
const zBind = z.object({ repoDir: z.string().min(1) });
const zClone = z.object({ dir: z.string().min(1) });

export default async function (app: FastifyInstance) {
  app.get("/projects/:id/binding", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await prisma.project.findUnique({ where: { id } }))) return reply.code(404).send({ error: "not found" });
    return { repoDir: await getBinding(id) };
  });

  app.put("/projects/:id/binding", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = zBind.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    if (!(await prisma.project.findUnique({ where: { id } }))) return reply.code(404).send({ error: "not found" });
    await setBinding(id, p.data.repoDir);
    return { repoDir: p.data.repoDir };
  });

  app.post("/projects/:id/clone", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = zClone.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) return reply.code(404).send({ error: "not found" });
    if (!project.gitRemote) return reply.code(409).send({ error: "project tidak punya gitRemote untuk clone" });
    const res = spawnSync("git", ["clone", project.gitRemote, p.data.dir], { encoding: "utf8" });
    if (res.status !== 0) return reply.code(409).send({ error: "git clone gagal", detail: res.stderr });
    await setBinding(id, p.data.dir);
    return reply.code(201).send({ repoDir: p.data.dir });
  });
}
