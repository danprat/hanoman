import { prisma } from "../../db";
import type { LeadDecision } from "@prisma/client";
import type {
  LeadAction, LeadConfidence, LeadGate, LeadKind, LeadStatus, LeadDecisionView,
} from "@hanoman/shared";

// SPEC-409 · ADR-0091 · jejak keputusan (AC-23/24). Append-mostly: baris hanya berubah status
// (berlaku → ditimpa/dibatalkan). TIDAK ADA fungsi hapus di modul ini, dan tak ada endpoint yang
// memanggilnya — AC-32 melarang lead menghapus barisnya sendiri, dan cara paling murah
// menegakkannya adalah tidak pernah menulis kodenya (OQ-6: pemangkasan, bila kelak ada, jadi
// wewenang manusia lewat jalur terpisah).

export type TrailInput = {
  projectId: string;
  specId?: string | null;
  sessionId?: string | null;
  gate: LeadGate;
  kind: LeadKind;
  question: string;
  answer: string;
  reason: string;
  refs: string[];
  confidence: LeadConfidence;
  action: LeadAction;
  /** SPEC-480 · pilihan yang terselesaikan terhadap `options`; null bila tak ada / ditolak. */
  choice?: string | null;
  choiceIndex?: number | null;
  /** Daftar opsi yang dikirim peminta — disimpan supaya jejak bisa dibaca ulang tanpa peminta. */
  options?: string[] | null;
  /** Apa yang kurang bila lead menyatakan konteksnya tak cukup untuk memutuskan. */
  missing?: string[] | null;
  status?: LeadStatus;
  weighty?: boolean;
  actor?: "lead" | "operator";
};

export async function recordDecision(i: TrailInput): Promise<LeadDecision> {
  return prisma.leadDecision.create({
    data: {
      projectId: i.projectId, specId: i.specId ?? null, sessionId: i.sessionId ?? null,
      gate: i.gate, kind: i.kind, question: i.question, answer: i.answer, reason: i.reason,
      refs: i.refs, confidence: i.confidence, action: i.action,
      // SPEC-480 · daftar kosong disimpan sebagai NULL: "peminta tak menyodorkan menu" dan
      // "menunya kosong" adalah keadaan yang sama, dan kolom nullable menyatakannya sekali.
      choice: i.choice ?? null,
      choiceIndex: i.choiceIndex ?? null,
      options: i.options?.length ? i.options : null,
      missing: i.missing?.length ? i.missing : null,
      status: i.status ?? "berlaku", weighty: i.weighty ?? false, actor: i.actor ?? "lead",
    },
  });
}

export type TrailFilter = {
  projectId?: string; specId?: string; sessionId?: string;
  status?: string; take?: number; skip?: number;
};

/** AC-24 · urut waktu (terbaru dulu), disaring per project & per backlog. */
export async function listDecisions(f: TrailFilter = {}): Promise<LeadDecision[]> {
  return prisma.leadDecision.findMany({
    where: {
      ...(f.projectId ? { projectId: f.projectId } : {}),
      ...(f.specId ? { specId: f.specId } : {}),
      ...(f.sessionId ? { sessionId: f.sessionId } : {}),
      ...(f.status ? { status: f.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(f.take ?? 50, 200),
    skip: f.skip ?? 0,
  });
}

/**
 * AC-28 · operator menimpa. Keputusan lama ditandai `ditimpa` (BUKAN dihapus — jejaknya justru
 * intinya), jawaban operator disimpan sebagai baris BARU yang berlaku, dan keduanya saling
 * menunjuk. Pemanggil (route) yang menyampaikan jawaban baru ke sesi bila panenya masih hidup.
 *
 * Menimpa baris yang sudah ditimpa/dibatalkan ditolak: rantai override berantai membuat
 * "mana yang berlaku" jadi tebakan.
 */
export async function overrideDecision(
  id: string, answer: string, reason: string,
): Promise<{ old: LeadDecision; next: LeadDecision } | null> {
  const old = await prisma.leadDecision.findUnique({ where: { id } });
  if (!old || old.status !== "berlaku") return null;
  const next = await recordDecision({
    projectId: old.projectId, specId: old.specId, sessionId: old.sessionId,
    gate: old.gate as LeadGate, kind: old.kind as LeadKind,
    question: old.question, answer, reason: reason || "ditimpa operator",
    refs: [], confidence: "tinggi", action: "none", actor: "operator",
  });
  const updated = await prisma.leadDecision.update({
    where: { id }, data: { status: "ditimpa", supersededById: next.id },
  });
  return { old: updated, next };
}

/** US-3 · batalkan keputusan tanpa menggantinya. Baris tetap ada, statusnya saja yang berubah. */
export async function cancelDecision(id: string): Promise<LeadDecision | null> {
  const row = await prisma.leadDecision.findUnique({ where: { id } });
  if (!row || row.status !== "berlaku") return null;
  return prisma.leadDecision.update({ where: { id }, data: { status: "dibatalkan" } });
}

/** Baris Prisma → wire DTO. `refs` disimpan sebagai Json; bentuk tak terduga jatuh ke []. */
export function toDecisionView(r: LeadDecision): LeadDecisionView {
  return {
    id: r.id, projectId: r.projectId, specId: r.specId, sessionId: r.sessionId,
    gate: r.gate as LeadDecisionView["gate"], kind: r.kind as LeadDecisionView["kind"],
    question: r.question, answer: r.answer, reason: r.reason,
    refs: Array.isArray(r.refs) ? (r.refs as unknown[]).map(String) : [],
    confidence: r.confidence as LeadDecisionView["confidence"],
    action: r.action as LeadDecisionView["action"],
    status: r.status as LeadDecisionView["status"],
    weighty: r.weighty, supersededById: r.supersededById,
    createdAt: r.createdAt.toISOString(),
  };
}
