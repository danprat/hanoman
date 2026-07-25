import type { FastifyInstance } from "fastify";
import { zCreateProject, zUpdateProject, zRenameProject } from "@hanoman/shared";
import { prisma } from "../db";
import { renameProject } from "../services/rename-project";
import { toProjectView } from "../services/project-view";
import { notifySynced } from "../services/sync-notify";
import { listRepoBranches, listRepoRemoteBranches } from "../services/branches";
import { resolveRepoDir } from "../services/local-binding";
import { listSessions } from "../services/pty";
import { paginate } from "../services/paginate";
import { generateIngestKey, dsnUrl } from "../services/ingest-key";
import { realGit } from "@hanoman/runner";

export default async function (app: FastifyInstance) {
  // SPEC-198 · envelope + filter q + paginasi via API. project-view dihitung penuh
  // (coverage/docStatus live per project), lalu filter q (name+desc+stack) + potong di memori.
  app.get("/projects", async (req) => {
    const { q, page, limit } = req.query as { q?: string; page?: string; limit?: string };
    // SPEC-197 · satu listSessions untuk seluruh request (bukan re-scan tmux per project),
    // dan oper baris `p` yang sudah ada (bukan findUniqueOrThrow lagi = N+1).
    const ps = await prisma.project.findMany({ orderBy: { createdAt: "desc" } });
    const sessions = listSessions();
    const views = await Promise.all(ps.map((p) => toProjectView(p, sessions)));
    const needle = (q ?? "").trim().toLowerCase();
    const filtered = needle
      ? views.filter((v) => `${v.name} ${v.desc} ${v.stack}`.toLowerCase().includes(needle))
      : views;
    return paginate(filtered, page, limit);
  });
  app.get("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await prisma.project.findUnique({ where: { id } });
    if (!p) return reply.code(404).send({ error: "not found" });
    return toProjectView(p, listSessions());
  });
  app.post("/projects", async (req, reply) => {
    const parsed = zCreateProject.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const id = (b.name || b.repoDir?.split("/").pop() || "repo").trim().toLowerCase().replace(/\s+/g, "-");
    if (await prisma.project.findUnique({ where: { id } }))
      return reply.code(409).send({ error: `project "${id}" sudah ada` });
    // SPEC-222 · project from-scratch butuh repo on-disk agar sesi scaffold bisa lahir (worktree
    // berbasis HEAD). git-init di sini membuatnya langsung runnable. Gagal init → 400, jangan
    // tinggalkan baris project setengah jadi. kind existing / tanpa repoDir tak tersentuh.
    if (b.kind === "from-scratch" && b.repoDir) {
      try { realGit.initRepo(b.repoDir); }
      catch (e) { return reply.code(400).send({ error: `gagal git-init "${b.repoDir}": ${(e as Error).message}` }); }
    }
    const created = await prisma.project.create({
      data: {
        id, name: id, desc: b.desc || "project baru", kind: b.kind, repoDir: b.repoDir ?? null,
        gitRemote: b.gitRemote ?? null, stack: ""
      }
    });
    await notifySynced("project", created.id); // SPEC-213/330 · sadar-peran: client antre push, hub publish ke feed
    return reply.code(201).send(await toProjectView(created, listSessions()));
  });
  // Rename tak menyentuh `id`, jadi tak ada gate run aktif seperti DELETE. Cermin
  // app.patch("/specs/:id") (server/src/routes/specs.ts:42).
  app.patch("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zUpdateProject.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (!(await prisma.project.findUnique({ where: { id } }))) return reply.code(404).send({ error: "not found" });
    const updated = await prisma.project.update({ where: { id }, data: parsed.data });
    await notifySynced("project", id); // SPEC-213/330 · sadar-peran: client antre push, hub publish ke feed
    return toProjectView(updated, listSessions());
  });
  // SPEC-255 · ADR-0064 · rename slug project. Terpisah dari PATCH: efek samping besar (cascade FK +
  // ref longgar + LocalBinding + rambat sync) & guard sendiri (id baru bebas, tak ada sesi aktif).
  // DSN (/api/ingest/<id>) & Help URL (/help/<id>) derived → path baru dikembalikan sebagai hint.
  app.post("/projects/:id/rename", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zRenameProject.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const r = await renameProject(id, parsed.data.newId);
    if (!r.ok) return reply.code(r.code).send({ error: r.error });
    const newId = parsed.data.newId;
    const p = await prisma.project.findUnique({ where: { id: newId } });
    const base = `${req.protocol}://${req.headers.host ?? "localhost"}`;
    return {
      id: newId,
      // Plaintext key DSN tak tersimpan; kembalikan path DSN baru (tanpa key) sbg hint bila monitoring aktif.
      dsnUrl: p?.ingestKeyHash ? `${base.replace(/\/$/, "")}/api/ingest/${encodeURIComponent(newId)}` : undefined,
      helpUrl: p?.helpEnabled ? `${base}/help/${encodeURIComponent(newId)}` : undefined,
      affected: r.affected,
    };
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
    // SPEC-217 · path efektif (binding lokal per-mesin ?? Project.repoDir).
    const repoDir = await resolveRepoDir(id);
    return { branches: await listRepoBranches(repoDir), remotes: await listRepoRemoteBranches(repoDir) };
  });

  // SPEC-249 · ADR-0060 · DSN ingest key per project. Hash-at-rest; plaintext hanya di POST (sekali).
  app.get("/projects/:id/ingest-key", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await prisma.project.findUnique({ where: { id } });
    if (!p) return reply.code(404).send({ error: "not found" });
    return { enabled: !!p.ingestKeyHash, prefix: p.ingestKeyPrefix ?? null };
  });
  app.post("/projects/:id/ingest-key", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await prisma.project.findUnique({ where: { id } });
    if (!p) return reply.code(404).send({ error: "not found" });
    const { key, hash, prefix } = generateIngestKey();
    await prisma.project.update({ where: { id }, data: { ingestKeyHash: hash, ingestKeyPrefix: prefix } });
    await notifySynced("project", id); // SPEC-213/330 · sadar-peran: client antre push, hub publish ke feed
    const base = `${req.protocol}://${req.headers.host ?? "localhost"}`;
    return reply.code(201).send({ enabled: true, prefix, key, dsnUrl: dsnUrl(id, key, base) });
  });
  app.delete("/projects/:id/ingest-key", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await prisma.project.findUnique({ where: { id } });
    if (!p) return reply.code(404).send({ error: "not found" });
    await prisma.project.update({ where: { id }, data: { ingestKeyHash: null, ingestKeyPrefix: null } });
    await notifySynced("project", id); // SPEC-213/330 · sadar-peran: client antre push, hub publish ke feed
    return reply.code(204).send();
  });

  // SPEC-253 · ADR-0062 · Help Center publik per project (opt-in). Link publik terikat Project.id (slug).
  app.get("/projects/:id/help-center", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await prisma.project.findUnique({ where: { id } });
    if (!p) return reply.code(404).send({ error: "not found" });
    const base = `${req.protocol}://${req.headers.host ?? "localhost"}`;
    return { enabled: p.helpEnabled, publicUrl: `${base}/help/${encodeURIComponent(id)}` };
  });
  app.post("/projects/:id/help-center", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await prisma.project.findUnique({ where: { id } });
    if (!p) return reply.code(404).send({ error: "not found" });
    await prisma.project.update({ where: { id }, data: { helpEnabled: true } });
    await notifySynced("project", id); // SPEC-213/330 · sadar-peran: client antre push, hub publish ke feed
    const base = `${req.protocol}://${req.headers.host ?? "localhost"}`;
    return { enabled: true, publicUrl: `${base}/help/${encodeURIComponent(id)}` };
  });
  app.delete("/projects/:id/help-center", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await prisma.project.findUnique({ where: { id } });
    if (!p) return reply.code(404).send({ error: "not found" });
    // Nonaktifkan tanpa menghapus tiket yang sudah ada (AC PRD).
    await prisma.project.update({ where: { id }, data: { helpEnabled: false } });
    await notifySynced("project", id); // SPEC-213/330 · sadar-peran: client antre push, hub publish ke feed
    return reply.code(204).send();
  });
}
