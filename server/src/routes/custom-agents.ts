import type { FastifyInstance } from "fastify";
import {
  zCreateCustomAgent, zUpdateCustomAgent, customAgentId, mentionsOf, toolsOf,
} from "@hanoman/shared";
import { prisma } from "../db";
import { notifySynced } from "../services/sync-notify";
import {
  loadCustomAgents, validateGraph, unknownMentions, type CustomAgentRow,
} from "../services/custom-agents";

// SPEC-450 · ADR-0094 · CRUD katalog custom agent. Integritas ditegakkan DI BOUNDARY (rujukan,
// siklus, duplikat) karena kolom `mentions` adalah `Json` tanpa FK — pola `dependsOn` (ADR-0093).

const rowsOf = async (): Promise<CustomAgentRow[]> =>
  (await prisma.customAgent.findMany()) as unknown as CustomAgentRow[];

/** Satu tempat yang tahu bentuk respons; `inherited` hanya bermakna saat diminta per-project. */
const view = (r: CustomAgentRow, projectId?: string) => ({
  id: r.id, projectId: r.projectId, name: r.name,
  description: r.description, instructions: r.instructions,
  tools: toolsOf(r.tools), model: r.model, mentions: mentionsOf(r.mentions),
  enabled: r.enabled,
  ...(projectId ? { inherited: r.projectId === null } : {}),
});

export default async function (app: FastifyInstance) {
  app.get("/custom-agents", async (req) => {
    const projectId = (req.query as { projectId?: string }).projectId;
    const rows = await prisma.customAgent.findMany({
      where: projectId ? { OR: [{ projectId: null }, { projectId }] } : { projectId: null },
      orderBy: { name: "asc" },
    }) as unknown as CustomAgentRow[];
    // Nama yang ditimpa project hanya boleh muncul SEKALI — versi project yang menang, cermin
    // `effectiveAgents`. Dua baris bernama sama di UI adalah pertanyaan "lalu yang mana yang jalan".
    const byName = new Map<string, CustomAgentRow>();
    for (const r of rows) if (r.projectId === null) byName.set(r.name, r);
    for (const r of rows) if (r.projectId !== null) byName.set(r.name, r);
    return [...byName.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => view(r, projectId));
  });

  app.post("/custom-agents", async (req, reply) => {
    const parsed = zCreateCustomAgent.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const p = parsed.data;
    const projectId = p.projectId ?? null;

    if (projectId && !(await prisma.project.findUnique({ where: { id: projectId } })))
      return reply.code(400).send({ error: "project tak ditemukan", projectId });

    const id = customAgentId(projectId, p.name);
    if (await prisma.customAgent.findUnique({ where: { id } }))
      return reply.code(409).send({ error: "nama sudah dipakai di scope ini", id });

    const candidate: CustomAgentRow = {
      id, projectId, name: p.name, description: p.description, instructions: p.instructions,
      tools: p.tools ?? null, model: p.model ?? null, mentions: p.mentions ?? [],
      enabled: p.enabled ?? true,
    };
    const all = [...(await rowsOf()), candidate];
    const unknown = unknownMentions(candidate, all);
    if (unknown.length) return reply.code(400).send({ error: "mention tak dikenal", unknown });
    const cycle = validateGraph(all);
    if (cycle) return reply.code(409).send({ error: "mention membentuk siklus", ...cycle });

    const row = await prisma.customAgent.create({ data: {
      id, projectId, name: p.name, description: p.description, instructions: p.instructions,
      tools: candidate.tools as never, model: candidate.model,
      mentions: candidate.mentions as never, enabled: candidate.enabled,
    } });
    // Cache WAJIB di-refresh tiap mutasi: tanpa itu sesi yang lahir sesudahnya memakai katalog
    // basi, dan gejalanya senyap (agen lama tetap muncul, agen baru tak pernah).
    await loadCustomAgents();
    await notifySynced("customAgent", id);
    return reply.code(201).send(view(row as unknown as CustomAgentRow));
  });

  app.patch("/custom-agents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    // `name`/`projectId` sengaja DI LUAR skema update: id diturunkan dari keduanya, dan changefeed
    // tak punya operasi hapus (ADR-0094 keputusan 2). Ditolak eksplisit, bukan diabaikan senyap —
    // "ganti nama diterima lalu tak terjadi apa-apa" adalah bug yang tak terlihat operator.
    const body = (req.body ?? {}) as Record<string, unknown>;
    if ("name" in body || "projectId" in body)
      return reply.code(400).send({ error: "name & projectId tak bisa diubah — hapus lalu buat baru" });

    const parsed = zUpdateCustomAgent.safeParse(body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const existing = await prisma.customAgent.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "not found" });
    const before = existing as unknown as CustomAgentRow;

    const candidate: CustomAgentRow = {
      ...before,
      ...parsed.data,
      mentions: parsed.data.mentions ?? mentionsOf(before.mentions),
      tools: parsed.data.tools !== undefined ? parsed.data.tools : toolsOf(before.tools),
    };
    const all = (await rowsOf()).map((r) => (r.id === id ? candidate : r));
    const unknown = unknownMentions(candidate, all);
    if (unknown.length) return reply.code(400).send({ error: "mention tak dikenal", unknown });
    const cycle = validateGraph(all);
    if (cycle) return reply.code(409).send({ error: "mention membentuk siklus", ...cycle });

    const row = await prisma.customAgent.update({ where: { id }, data: {
      description: candidate.description, instructions: candidate.instructions,
      tools: candidate.tools as never, model: candidate.model,
      mentions: candidate.mentions as never, enabled: candidate.enabled,
    } });
    await loadCustomAgents();
    await notifySynced("customAgent", id);
    return view(row as unknown as CustomAgentRow);
  });

  app.delete("/custom-agents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.customAgent.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "not found" });

    await prisma.customAgent.delete({ where: { id } });
    // Cabut namanya dari mentions agen lain — tanpa ini rujukan yatim mengunci UI dan setiap
    // penyuntingan berikutnya ditolak "mention tak dikenal" (cermin DELETE /specs/:id, ADR-0093).
    const name = (existing as unknown as CustomAgentRow).name;
    for (const r of await rowsOf()) {
      const m = mentionsOf(r.mentions);
      if (!m.includes(name)) continue;
      await prisma.customAgent.update({
        where: { id: r.id }, data: { mentions: m.filter((x) => x !== name) as never },
      });
      await notifySynced("customAgent", r.id);
    }
    await loadCustomAgents();
    return reply.code(204).send();
  });
}
