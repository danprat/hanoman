import type { LeadDecision } from "@prisma/client";
import {
  isWeightyDecision, leadActionAllowed, leadRefusalReason,
  type Agent, type LeadAction, type LeadGate, type LeadKind,
} from "@hanoman/shared";
import { prisma } from "../../db";
import { resolveRepoDir } from "../local-binding";
import { listSessions } from "../pty";
import { recordLeadDecision } from "../notifications";
import { getLead, leadActive, leadAgentDefaults } from "./config";
import { leadPrompt, type LeadContext } from "./prompt";
import { parseLeadVerdict, keepExistingRefs } from "./verdict";
import { recordDecision } from "./trail";
import { think as thinkProd } from "./brain";
import { markDeciding, clearDeciding } from "./deciding";

// SPEC-409 · ADR-0091 · SATU otak, dua pintu (G6). Baik kontrak eksplisit (pintu #1) maupun deteksi
// otomatis (pintu #2) maupun denyut proaktif (pintu #3) lewat `decide()` — jadi hanya ada satu
// tempat yang tahu urutan wajib: bukti → putusan → saring rujukan → gerbang tindakan → TULIS JEJAK
// → notifikasi. AC-2 menuntut jejak ditulis SEBELUM jawaban sampai ke peminta, dan satu-satunya
// cara memastikannya adalah tak punya jalur kedua.

export type DecideRequest = {
  projectId: string;
  specId?: string | null;
  sessionId?: string | null;
  gate: LeadGate;
  kind: LeadKind;
  question: string;
  options?: string[];
  /** Konteks tambahan dari peminta (mis. isi layar pane, daftar berkas bertabrakan). */
  notes?: string[];
};

export type DecideDeps = {
  think: (prompt: string, o: { agent: Agent; model: string; effort: string; cwd?: string; timeoutMs: number }) => Promise<string>;
  defaults: () => Promise<{ agent: Agent; model: string; effort: string }>;
  repoDir: (projectId: string) => Promise<string | null>;
  liveSessions: () => { id: string; projectId: string; specId?: string; flow?: string; branch?: string; exited: boolean }[];
  notify: (decisionId: string, title: string, projectId: string, specId: string | null, sessionId: string | null) => Promise<void>;
};

export const prodDecideDeps: DecideDeps = {
  think: thinkProd,
  defaults: leadAgentDefaults,
  repoDir: resolveRepoDir,
  liveSessions: () => {
    // SPEC-402 · bacaan tmux yang gagal MELEMPAR. Konteks "sesi tetangga" itu pelengkap, bukan
    // syarat memutuskan — kegagalannya tak boleh menggagalkan keputusan.
    try { return listSessions(); } catch { return []; }
  },
  notify: recordLeadDecision,
};

/** Judul notifikasi yang terbaca sekilas di panel — pertanyaan dipangkas, keputusan dipertahankan. */
const notifTitle = (kind: LeadKind, question: string, answer: string, confidence: string): string => {
  const q = question.replace(/\s+/g, " ").trim().slice(0, 70);
  const a = answer.replace(/\s+/g, " ").trim().slice(0, 90);
  const tag = confidence === "ragu" ? "Lead (ragu)" : "Lead";
  return `${tag} · ${kind}: ${q ? `"${q}" → ` : ""}${a}`;
};

/**
 * Susun satu keputusan. Mengembalikan baris jejak — SELALU, termasuk saat lead gagal (status
 * `gagal`, AC-4) — atau `null` bila lead memang tak aktif untuk project itu (AC-15/30). `null`
 * berarti "tak ada yang terjadi", dan pemanggil harus memperlakukan sesi seperti sebelum PRD ini:
 * menunggu manusia.
 */
export async function decide(req: DecideRequest, deps: DecideDeps = prodDecideDeps): Promise<LeadDecision | null> {
  const cfg = await getLead();
  if (!leadActive(cfg, req.projectId)) return null;

  const project = await prisma.project.findUnique({ where: { id: req.projectId }, select: { name: true } });
  const spec = req.specId
    ? await prisma.spec.findUnique({
        where: { id: req.specId },
        select: { id: true, title: true, objective: true, stage: true, priority: true },
      })
    : null;
  const repoDir = await deps.repoDir(req.projectId).catch(() => null);
  const prior = await prisma.leadDecision.findMany({
    where: { projectId: req.projectId, status: "berlaku" },
    orderBy: { createdAt: "desc" }, take: 10,
  });

  const ctx: LeadContext = {
    projectId: req.projectId,
    projectName: project?.name ?? req.projectId,
    repoDir,
    spec,
    liveSessions: deps.liveSessions()
      .filter((s) => !s.exited && s.projectId === req.projectId && s.id !== req.sessionId)
      .map((s) => ({ id: s.id, specId: s.specId, flow: s.flow, branch: s.branch })),
    priorDecisions: prior.map((d) => ({
      question: d.question, answer: d.answer, reason: d.reason, createdAt: d.createdAt.toISOString(),
    })),
    notes: req.notes,
  };

  const { agent, model, effort } = await deps.defaults();
  const prompt = leadPrompt({ kind: req.kind, question: req.question, options: req.options }, ctx);

  if (req.sessionId) markDeciding(req.sessionId);
  let raw: string;
  try {
    raw = await deps.think(prompt, { agent, model, effort, cwd: repoDir ?? undefined, timeoutMs: cfg.timeoutSec * 1000 });
  } catch (e) {
    return fail(req, deps, `lead tak menghasilkan keputusan: ${(e as Error).message}`);
  } finally {
    if (req.sessionId) clearDeciding(req.sessionId);
  }

  const verdict = parseLeadVerdict(raw);
  // AC-22 melarang keraguan berakhir tanpa keputusan; ini kasus LAIN — agen tak mengembalikan
  // bentuk yang bisa dibaca sama sekali. Menebak isinya lebih berbahaya daripada jatuh ke manusia.
  if (!verdict) return fail(req, deps, "keluaran lead tak memuat blok json keputusan yang sah");

  const refs = keepExistingRefs(verdict.refs, repoDir);
  const allowed = leadActionAllowed(verdict.action);
  const action: LeadAction = allowed ? (verdict.action as LeadAction) : "none";
  const kind: LeadKind = allowed ? req.kind : "refusal";
  const reason = allowed
    ? verdict.reason
    : `${verdict.reason}\n\nDITOLAK: ${leadRefusalReason(verdict.action)} berada di luar permukaan tindakan lead (ADR-0091 · AC-31/32).`;
  const weighty = isWeightyDecision({ kind, action, confidence: verdict.confidence });

  const row = await recordDecision({
    projectId: req.projectId, specId: req.specId, sessionId: req.sessionId,
    gate: req.gate, kind, question: req.question, answer: verdict.decision, reason,
    refs, confidence: verdict.confidence, action, weighty,
  });
  if (weighty) {
    await deps.notify(row.id, notifTitle(kind, req.question, verdict.decision, verdict.confidence),
      req.projectId, req.specId ?? null, req.sessionId ?? null);
  }
  // `reply` tak disimpan di kolom sendiri: yang perlu bertahan adalah KEPUTUSAN-nya, sementara
  // teks yang diketik ke pane hanya berumur satu ketikan. Pemanggil membacanya dari verdict.
  lastReply.set(row.id, verdict.reply || verdict.decision);
  return row;
}

// Teks balasan untuk pane, berumur pendek: dipakai detect.ts sesaat setelah decide() kembali.
// Map (bukan kolom DB) karena isinya turunan dari `answer` dan tak punya nilai historis.
const lastReply = new Map<string, string>();
export function takeReply(decisionId: string): string {
  const v = lastReply.get(decisionId) ?? "";
  lastReply.delete(decisionId);
  return v;
}

/**
 * AC-4 · permintaan yang tak terjawab dalam batas waktu (atau keluarannya tak terbaca) dicatat
 * sebagai baris `gagal` + notifikasi, dan peminta kembali ke perilaku hari ini: menunggu manusia.
 */
async function fail(req: DecideRequest, deps: DecideDeps, reason: string): Promise<LeadDecision> {
  const row = await recordDecision({
    projectId: req.projectId, specId: req.specId, sessionId: req.sessionId,
    gate: req.gate, kind: req.kind, question: req.question,
    answer: "", reason, refs: [], confidence: "ragu", action: "none",
    status: "gagal", weighty: true,
  });
  await deps.notify(row.id, `Lead gagal memutuskan: ${req.question.replace(/\s+/g, " ").slice(0, 90)}`,
    req.projectId, req.specId ?? null, req.sessionId ?? null);
  return row;
}
