// SPEC-249 · ADR-0060 · area Error: daftar grup + detail. Query selalu ber-scope projectId
// (isolasi antar-project). Escalate + patch ditambah SPEC-249 Task 6.
import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { zErrorStatus } from "@hanoman/shared";
import { prisma } from "../db";
import { paginate } from "../services/paginate";
import { nextSpecId } from "../services/id";
import { resolveRepoDir } from "../services/local-binding";
import { notifySynced } from "../services/sync-notify";
import { repoRoot } from "../runner/deps";
import type { ErrorGroup, ErrorEvent } from "@prisma/client";

const groupView = (g: ErrorGroup) => ({
  id: g.id, projectId: g.projectId, type: g.type, message: g.message, environment: g.environment,
  status: g.status, count: g.count, firstSeenAt: g.firstSeenAt, lastSeenAt: g.lastSeenAt, specId: g.specId,
});
const eventView = (e: ErrorEvent) => ({
  id: e.id, type: e.type, message: e.message, stack: e.stack, environment: e.environment,
  release: e.release, receivedAt: e.receivedAt,
});

export default async function (app: FastifyInstance) {
  // SPEC-249 · panduan integrasi SDK (isi `sdk/README.md`) disajikan apa adanya agar bisa
  // dibaca di web (modal di area Errors + kartu DSN). Sumber tunggal tetap file di repo.
  app.get("/errors/integration-guide", async (_req, reply) => {
    try {
      const text = await readFile(join(repoRoot(), "sdk", "README.md"), "utf8");
      return { text };
    } catch {
      return reply.code(404).send({ error: "panduan integrasi tidak ditemukan" });
    }
  });

  app.get("/errors", async (req) => {
    const { project, environment, status, q, page, limit } = req.query as Record<string, string | undefined>;
    const where: { projectId?: string; environment?: string; status?: string } = {};
    if (project) where.projectId = project;
    if (environment) where.environment = environment;
    if (status) where.status = status;
    let groups = await prisma.errorGroup.findMany({ where, orderBy: { lastSeenAt: "desc" } });
    if (q) {
      const n = q.toLowerCase();
      groups = groups.filter((g) => `${g.type} ${g.message}`.toLowerCase().includes(n));
    }
    return paginate(groups.map(groupView), page, limit);
  });

  app.get("/errors/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const g = await prisma.errorGroup.findUnique({ where: { id } });
    if (!g) return reply.code(404).send({ error: "not found" });
    const events = await prisma.errorEvent.findMany({
      where: { groupId: id }, orderBy: { receivedAt: "desc" }, take: 50,
    });
    return { ...groupView(g), sampleStack: g.sampleStack, events: events.map(eventView) };
  });

  // SPEC-249 · ADR-0060 · eskalasi grup → Spec qa prefilled + tautan dua arah. Idempoten.
  app.post("/errors/:id/escalate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const g = await prisma.errorGroup.findUnique({ where: { id } });
    if (!g) return reply.code(404).send({ error: "not found" });
    if (g.specId) {
      const spec = await prisma.spec.findUnique({ where: { id: g.specId } });
      return reply.code(200).send({ alreadyEscalated: true, spec });
    }
    const short = g.message.length > 80 ? g.message.slice(0, 77) + "…" : g.message;
    const topStack = (g.sampleStack ?? "").split("\n").slice(0, 12).join("\n");
    const backlink = `Dari Error monitoring: grup ${g.id} (${g.count}×, ${g.environment}).`;
    const payload = {
      severity: "major" as const,
      steps: "Otomatis dari Error monitoring — reproduksi dari stack sampel.",
      expected: "Tidak ada error.",
      actual: `${g.type}: ${g.message}\n\n${topStack}\n\n${backlink}`,
      env: g.environment,
      fromErrorGroup: g.id,
    };
    const author = req.user?.email ?? "system";
    const repoDir = await resolveRepoDir(g.projectId);
    // SPEC-197 · nextSpecId TOCTOU → retry P2002 (≤3), bukan 500. Cermin routes/specs.
    let spec: Awaited<ReturnType<typeof prisma.spec.create>> | null = null;
    for (let attempt = 0; attempt < 3 && !spec; attempt++) {
      const sid = await nextSpecId(repoDir);
      try {
        spec = await prisma.spec.create({
          data: {
            id: sid, projectId: g.projectId, title: `${g.type}: ${short}`, source: "qa",
            stage: "brainstorming", priority: "tinggi", author: `QA · ${author}`,
            objective: `${g.type}: ${g.message}. ${backlink}`, payload,
          },
        });
      } catch (e) {
        if ((e as { code?: string }).code === "P2002" && attempt < 2) continue;
        throw e;
      }
    }
    await prisma.errorGroup.update({ where: { id }, data: { status: "escalated", specId: spec!.id } });
    await notifySynced("spec", spec!.id);   // SPEC-213/268 · spec ke feed (hub publish / client push)
    await notifySynced("errorGroup", id);    // SPEC-268 · status grup ke feed
    return reply.code(201).send({ spec });
  });

  // SPEC-271 · lepas tautan grup dari backlog (kebalikan escalate). Non-destruktif: Spec
  // dibiarkan (bisa dihapus manual). Reset status→"new" agar grup bisa dieskalasi lagi. Idempoten.
  app.post("/errors/:id/unlink", async (req, reply) => {
    const { id } = req.params as { id: string };
    const g = await prisma.errorGroup.findUnique({ where: { id } });
    if (!g) return reply.code(404).send({ error: "not found" });
    const updated = await prisma.errorGroup.update({ where: { id }, data: { status: "new", specId: null } });
    await notifySynced("errorGroup", id); // SPEC-268 · perubahan status grup ke feed
    return { id: updated.id, status: updated.status, specId: updated.specId };
  });

  // SPEC-249 · transisi status grup (mis. tandai resolved).
  app.patch("/errors/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zErrorStatus.safeParse((req.body as { status?: string } | undefined)?.status);
    if (!parsed.success) return reply.code(400).send({ error: "status invalid" });
    const g = await prisma.errorGroup.findUnique({ where: { id } });
    if (!g) return reply.code(404).send({ error: "not found" });
    const updated = await prisma.errorGroup.update({ where: { id }, data: { status: parsed.data } });
    await notifySynced("errorGroup", id); // SPEC-268 · perubahan status grup ke feed
    return { id: updated.id, status: updated.status };
  });

  // SPEC-269 · hapus grup error (events cascade via onDelete: Cascade).
  app.delete("/errors/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const g = await prisma.errorGroup.findUnique({ where: { id } });
    if (!g) return reply.code(404).send({ error: "not found" });
    await prisma.errorGroup.delete({ where: { id } });
    return { ok: true };
  });
}
