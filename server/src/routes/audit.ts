// SPEC-337 · ADR-0075 · permukaan baca log untuk SESI cross-audit milik hanoman sendiri.
// Read-only & ber-scope: hanya ErrorGroup/ErrorEvent project di scope sesi (utama + tetangga
// ProjectLink satu hop). Gate /api meloloskan prefix ini bila X-Hanoman-Audit-Key cocok dengan
// pane tmux HIDUP (app.ts) — cermin pengecualian DSN ingest (ADR-0060).
import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../db";
import { auditScopeFromReq } from "../services/audit-scope";
import { symbolicateFrames, type FrameLike } from "../services/symbolicate";
import { findSourceMap } from "../services/sourcemap-store";
import type { ErrorGroup, ErrorEvent } from "@prisma/client";

const REL = /^(\d+)([mhd])$/;
const MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };

// "24h" | "7d" | "30m" | ISO-8601. Kosong → fallback. null = tak terparse (route menjawab 400).
export function parseWhen(v: string | undefined, fallback: Date, now: Date): Date | null {
  if (!v) return fallback;
  const m = REL.exec(v.trim());
  if (m) return new Date(now.getTime() - Number(m[1]) * MS[m[2]!]!);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

const groupView = (g: ErrorGroup) => ({
  id: g.id, projectId: g.projectId, type: g.type, message: g.message, environment: g.environment,
  release: g.release, status: g.status, count: g.count, firstSeenAt: g.firstSeenAt,
  lastSeenAt: g.lastSeenAt, specId: g.specId,
});
const timelineView = (e: ErrorEvent) => ({
  at: e.receivedAt, projectId: e.projectId, groupId: e.groupId,
  type: e.type, message: e.message, environment: e.environment, release: e.release,
});

// Kunci sesi → scope sesi. Tanpa kunci, satu-satunya pemanggil yang lolos gate adalah cookie
// sesi (akses penuh, tanpa RBAC) → seluruh project.
async function scopeFor(req: FastifyRequest): Promise<string[]> {
  const s = auditScopeFromReq(req as unknown as { headers: Record<string, unknown> });
  if (s) return s;
  return (await prisma.project.findMany({ select: { id: true } })).map((p) => p.id);
}

export default async function (app: FastifyInstance) {
  app.get("/audit/logs", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const now = new Date();
    const since = parseWhen(q.since, new Date(now.getTime() - MS.d!), now);
    const until = parseWhen(q.until, now, now);
    if (!since || !until) return reply.code(400).send({ error: "since/until tak terparse — pakai 24h, 7d, atau ISO-8601" });

    const scope = await scopeFor(req);
    let projects = scope;
    if (q.projects) {
      const want = q.projects.split(",").map((s) => s.trim()).filter(Boolean);
      const outside = want.filter((p) => !scope.includes(p));
      if (outside.length) return reply.code(403).send({ error: `di luar scope sesi: ${outside.join(", ")}` });
      if (want.length) projects = want;
    }

    const limit = Math.min(Number(q.limit) || 200, 1000);
    const needle = (q.q ?? "").trim().toLowerCase();
    const envWhere = q.environment ? { environment: q.environment } : {};

    // Timeline = event SEMUA project ter-scope, tercampur & terurut waktu — bukti korelasi lintas
    // project. Filter q dijalankan di memori (pola /errors), jadi ambil lebih banyak dulu lalu potong.
    const raw = await prisma.errorEvent.findMany({
      where: { projectId: { in: projects }, receivedAt: { gte: since, lte: until }, ...envWhere },
      orderBy: { receivedAt: "desc" }, take: needle ? 2000 : limit,
    });
    const events = (needle
      ? raw.filter((e) => `${e.type} ${e.message}`.toLowerCase().includes(needle))
      : raw).slice(0, limit);

    const rawGroups = await prisma.errorGroup.findMany({
      where: { projectId: { in: projects }, lastSeenAt: { gte: since }, ...envWhere },
      orderBy: { lastSeenAt: "desc" }, take: 200,
    });
    const groups = needle
      ? rawGroups.filter((g) => `${g.type} ${g.message}`.toLowerCase().includes(needle))
      : rawGroups;

    const names = await prisma.project.findMany({ where: { id: { in: projects } }, select: { id: true, name: true } });
    return {
      window: { since, until },
      scope: names,
      groups: groups.map(groupView),
      timeline: events.map(timelineView),
    };
  });

  app.get("/audit/logs/:groupId", async (req, reply) => {
    const { groupId } = req.params as { groupId: string };
    const scope = await scopeFor(req);
    const g = await prisma.errorGroup.findUnique({ where: { id: groupId } });
    // Grup di luar scope = 404, bukan 403: keberadaannya pun tak perlu bocor.
    if (!g || !scope.includes(g.projectId)) return reply.code(404).send({ error: "not found" });
    const events = await prisma.errorEvent.findMany({
      where: { groupId }, orderBy: { receivedAt: "desc" }, take: 50,
    });
    // SPEC-276 · symbolication lazy dengan map yang tersedia saat ini; map absen → frame apa adanya.
    const sampleFrames = Array.isArray(g.sampleFrames)
      ? await symbolicateFrames(g.sampleFrames as unknown as FrameLike[],
          (fn) => findSourceMap(g.projectId, g.release ?? "", fn))
      : null;
    return {
      ...groupView(g), sampleStack: g.sampleStack, sampleFrames,
      events: events.map((e) => ({
        id: e.id, at: e.receivedAt, type: e.type, message: e.message, stack: e.stack,
        environment: e.environment, release: e.release, context: e.context,
      })),
    };
  });
}
