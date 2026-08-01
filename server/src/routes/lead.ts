import type { FastifyInstance } from "fastify";
import { zLead, zLeadAsk, zLeadOverride, type LeadAnswer, type LeadStatusView } from "@hanoman/shared";
import { prisma } from "../db";
import { listSessions, liveDecisions, markerFilled, sendToPane } from "../services/pty";
import { listQueue } from "../services/scheduler/queue";
import { getLead, setLead, leadActive } from "../services/lead/config";
import { decide, takeDelivery } from "../services/lead/decide";
import { applyAction } from "../services/lead/apply";
import { listDecisions, overrideDecision, cancelDecision, toDecisionView } from "../services/lead/trail";
import { decidingIds } from "../services/lead/deciding";
import { resetSession } from "../services/lead/detect";
import { lastPulse } from "../services/lead/engine";

// SPEC-409 · ADR-0091 · permukaan HTTP hanoman-lead. Semuanya polling (AC-26) — tak ada kanal
// WebSocket baru; ADR-0039 tetap utuh.
//
// Peta capability ada di services/agent-capabilities.ts: prefix `lead` → `lead:read`/`lead:write`
// MENURUT METHOD. Itu bukan detail: SPEC-405 membuktikan apa yang terjadi saat sebuah prefix
// dipetakan ke izin baca tanpa melihat method — setiap agent token mendapat endpoint tulis di
// bawahnya. `POST /lead/decisions` adalah endpoint TULIS (ia melahirkan baris jejak dan bisa
// menggerakkan sesi), dan capability baca tak pernah cukup untuk memanggilnya (AC-5).
export default async function (app: FastifyInstance) {
  app.get("/lead/config", async () => getLead());

  app.put("/lead/config", async (req, reply) => {
    const parsed = zLead.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return setLead(parsed.data);   // ganti blok penuh (pola PUT /scheduler/config). Pause = { paused:true }.
  });

  app.get("/lead/status", async (): Promise<LeadStatusView> => {
    const cfg = await getLead();
    const projects = await prisma.project.findMany({
      where: { leadOptIn: true }, select: { id: true, name: true }, orderBy: { id: "asc" },
    });
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    // SPEC-402 · bacaan tmux yang gagal MELEMPAR; layar status tak boleh ikut 500 karenanya.
    let live: ReturnType<typeof listSessions> = [];
    try { live = listSessions().filter((s) => !s.exited); } catch { /* tmux tak terbaca */ }
    let waiting: string[] = [];
    try { waiting = liveDecisions().filter((d) => markerFilled(d.decisionFile)).map((d) => d.id); }
    catch { /* idem */ }
    const rows = await Promise.all(projects.map(async (p) => ({
      projectId: p.id, name: p.name,
      optIn: true,
      paused: !leadActive(cfg, p.id),
      decisions24h: await prisma.leadDecision.count({ where: { projectId: p.id, createdAt: { gte: since } } }),
      openSessions: live.filter((s) => s.projectId === p.id).length,
    })));
    const last = lastPulse();
    return {
      config: cfg, projects: rows,
      queue: (await listQueue()).map((q) => ({
        id: q.id, specId: q.specId, projectId: q.projectId, source: q.source,
        priority: q.priority, status: q.status, sessionId: q.sessionId, note: q.note,
        enqueuedAt: q.enqueuedAt.toISOString(),
        launchedAt: q.launchedAt ? q.launchedAt.toISOString() : null,
      })),
      deciding: decidingIds(), waiting,
      lastPulseAt: last ? new Date(last).toISOString() : null,
    };
  });

  // AC-24 · jejak urut waktu, disaring per project & per backlog.
  app.get("/lead/decisions", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const rows = await listDecisions({
      projectId: q.projectId, specId: q.specId, sessionId: q.sessionId, status: q.status,
      take: q.take ? Number(q.take) : undefined,
      skip: q.skip ? Number(q.skip) : undefined,
    });
    return { items: rows.map(toDecisionView) };
  });

  // AC-1/AC-5 · PINTU #1 — kontrak eksplisit "minta putusan". Dipakai sesi internal maupun agen
  // eksternal ber-AgentToken. Balasannya TERSTRUKTUR (bisa dibaca mesin), bukan prosa bebas.
  app.post("/lead/decisions", async (req, reply) => {
    const parsed = zLeadAsk.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const ask = parsed.data;
    const project = await prisma.project.findUnique({ where: { id: ask.projectId }, select: { leadOptIn: true } });
    if (!project) return reply.code(404).send({ error: "project not found" });
    const cfg = await getLead();
    // AC-15/30 · lead mati / dijeda / project tak opt-in → peminta kembali ke perilaku hari ini
    // (menunggu manusia). 409, bukan 500: tak ada yang rusak, hanya tak ada yang menjawab.
    if (!project.leadOptIn || !leadActive(cfg, ask.projectId))
      return reply.code(409).send({ error: "lead tidak aktif untuk project ini" });

    const row = await decide({
      projectId: ask.projectId, specId: ask.specId ?? null, sessionId: ask.sessionId ?? null,
      gate: "contract", kind: "answer", question: ask.question, options: ask.options,
      notes: ask.context ? [ask.context] : undefined,
    });
    if (!row) return reply.code(409).send({ error: "lead tidak aktif untuk project ini" });
    // SPEC-480 · kontrak eksplisit tak mengetik ke pane, tapi ia tetap mengambil putusan
    // "sebagaimana dikirim": salinan TERPANGKAS-nya. Jejak DB tetap memegang prosa lead yang utuh.
    const sent = takeDelivery(row.id);
    if (row.status === "gagal") return reply.code(504).send({ error: row.reason, id: row.id });
    // Lead memutuskan LALU melapor: tindakan yang menyusul dijalankan sebelum balasan dikirim,
    // supaya peminta tak menerima keputusan yang belum berlaku di dunia nyata.
    if (row.action !== "none") { try { await applyAction(row); } catch { /* jejak tetap ada */ } }
    const answer: LeadAnswer = {
      id: row.id,
      decision: sent?.decision ?? row.answer,
      reason: sent?.reason ?? row.reason,
      refs: Array.isArray(row.refs) ? (row.refs as unknown[]).map(String) : [],
      confidence: row.confidence as LeadAnswer["confidence"],
      action: row.action as LeadAnswer["action"],
      // Saluran pengiriman bisa meleset (baris lahir dari jalur lain); kolomnya yang selalu ada.
      choice: sent?.choice ?? (row.choice ? { index: row.choiceIndex ?? 1, option: row.choice } : null),
      missing: sent?.missing ?? (Array.isArray(row.missing) ? (row.missing as unknown[]).map(String) : []),
    };
    return reply.code(201).send(answer);
  });

  // AC-28 · operator menimpa. Keputusan lama → `ditimpa`, jawaban operator jadi yang berlaku, dan
  // bila panenya masih hidup jawaban baru itu DIKETIK ke sesi yang bersangkutan.
  app.post("/lead/decisions/:id/override", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zLeadOverride.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const r = await overrideDecision(id, parsed.data.answer, parsed.data.reason);
    if (!r) return reply.code(409).send({ error: "keputusan tak ada atau sudah tak berlaku" });
    let delivered = false;
    if (r.next.sessionId) {
      // OQ-8 · manusia menang. Penghitung jawaban otomatis sesi ini di-reset: campur tangan
      // operator memutus rantai "berturut-turut" yang dijaga AC-11.
      resetSession(r.next.sessionId);
      delivered = await sendToPane(r.next.sessionId, parsed.data.answer).catch(() => false);
    }
    return { old: toDecisionView(r.old), next: toDecisionView(r.next), delivered };
  });

  app.post("/lead/decisions/:id/cancel", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await cancelDecision(id);
    if (!row) return reply.code(409).send({ error: "keputusan tak ada atau sudah tak berlaku" });
    if (row.sessionId) resetSession(row.sessionId);
    return toDecisionView(row);
  });
}
