import type { FastifyInstance } from "fastify";
import { zCreateProject, zUpdateProject } from "@hanoman/shared";
import { prisma } from "../db";
import { toProjectView } from "../services/project-view";
import { listRepoBranches } from "../services/branches";
import { listSessions } from "../services/pty";

export default async function (app: FastifyInstance) {
  app.get("/projects", async () => {
    const ps = await prisma.project.findMany({ orderBy: { createdAt: "desc" } });
    return Promise.all(ps.map((p) => toProjectView(p.id)));
  });
  app.get("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await prisma.project.findUnique({ where: { id } }))) return reply.code(404).send({ error: "not found" });
    return toProjectView(id);
  });
  app.post("/projects", async (req, reply) => {
    const parsed = zCreateProject.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const id = (b.name || b.repoDir?.split("/").pop() || "repo").trim().toLowerCase().replace(/\s+/g, "-");
    if (await prisma.project.findUnique({ where: { id } }))
      return reply.code(409).send({ error: `project "${id}" sudah ada` });
    await prisma.project.create({
      data: {
        id, name: id, desc: b.desc || "project baru", kind: b.kind, repoDir: b.repoDir ?? null,
        stack: ""
      }
    });
    return reply.code(201).send(await toProjectView(id));
  });
  // Rename tak menyentuh `id`, jadi tak ada gate run aktif seperti DELETE. Cermin
  // app.patch("/specs/:id") (server/src/routes/specs.ts:42).
  app.patch("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zUpdateProject.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (!(await prisma.project.findUnique({ where: { id } }))) return reply.code(404).send({ error: "not found" });
    await prisma.project.update({ where: { id }, data: parsed.data });
    return toProjectView(id);
  });
  app.delete("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await prisma.project.findUnique({ where: { id } }))) return reply.code(404).send({ error: "not found" });
    // Pekerjaan yang berjalan adalah sesi tmux, bukan baris DB (SPEC-162). Sesi terminal biasa
    // ikut menahan: menghapus project-nya akan meninggalkan sesi yang menunjuk repoDir yatim.
    const active = listSessions().filter((s) => s.projectId === id && !s.exited).length;
    if (active) return reply.code(409).send({ error: `project "${id}" masih punya ${active} sesi aktif` });
    // ponytail: worktree di .worktrees/ tidak ikut dibersihkan; tambahkan kalau disknya penuh.
    await prisma.project.delete({ where: { id } }); // specs ikut lewat onDelete: Cascade
    return reply.code(204).send();
  });
  // SPEC-143: memasok dropdown branch di backlog. Server duduk di mesin yang sama dengan
  // repo — preseden GET /fs/browse. repoDir null / bukan repo git → [], bukan error.
  app.get("/projects/:id/branches", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await prisma.project.findUnique({ where: { id } });
    if (!p) return reply.code(404).send({ error: "not found" });
    return { branches: listRepoBranches(p.repoDir) };
  });
}
