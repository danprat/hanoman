import type { LeadDecision } from "@prisma/client";
import {
  isWeightyDecision, leadActionAllowed, leadRefusalReason,
  resolveChoice, clampProse, optionActionHint, LEAD_DECISION_MAX, LEAD_REASON_MAX,
  type Agent, type LeadAction, type LeadDelivery, type LeadGate, type LeadKind,
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
import { markDeciding, clearDeciding, markQueued, clearQueued } from "./deciding";
import { runGated, LeadBusyError } from "./gate";

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
    // SPEC-432 · anggaran yang disebut prompt WAJIB berasal dari cfg yang sama yang dipakai
    // `think()` di bawah. Dua sumber angka akan berselisih diam-diam begitu operator menggeser
    // knob-nya, dan agen yang dianggarkan salah gagal persis seperti agen yang tak dianggarkan.
    timeoutSec: cfg.timeoutSec,
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

  // SPEC-479 (QA) · GERBANG KONKURENSI. Ia duduk di sini dan hanya di sini: `decide()` sudah jadi
  // choke point tunggal ketiga pintu (ADR-0091 G6), jadi satu gerbang di atasnya menggantikan tiga
  // batas yang tak pernah dinyatakan. Menyalinnya ke tiap pintu adalah kelas bug SPEC-431/448/475.
  //
  // Yang dibungkus HANYA panggilan agennya, bukan pengumpulan buktinya di atas: bukti itu beberapa
  // query SQLite, sementara slot yang mahal adalah proses `claude -p`. Mengunci slot selama query
  // berjalan hanya memperkecil kapasitas tanpa menghemat apa pun.
  if (req.sessionId) markQueued(req.sessionId);
  let raw: string;
  try {
    raw = await runGated({ capacity: cfg.maxConcurrent, waitMs: cfg.queueWaitSec * 1000 }, async () => {
      if (req.sessionId) { clearQueued(req.sessionId); markDeciding(req.sessionId); }
      try {
        return await deps.think(prompt, { agent, model, effort, cwd: repoDir ?? undefined, timeoutMs: cfg.timeoutSec * 1000 });
      } finally {
        if (req.sessionId) clearDeciding(req.sessionId);
      }
    });
  } catch (e) {
    // `LeadBusyError` DILEWATKAN apa adanya — ia bukan kegagalan lead melainkan backpressure, dan
    // menuliskannya sebagai baris `gagal` justru membangun kembali cacat C: pagar SPEC-472 akan
    // membacanya sebagai sebab permanen lalu menutup sesi itu selamanya lewat `failCapped`. Enam
    // call site menanganinya sendiri-sendiri; lihat komentar masing-masing.
    if (e instanceof LeadBusyError) throw e;
    return fail(req, deps, `lead tak menghasilkan keputusan: ${(e as Error).message}`);
  } finally {
    if (req.sessionId) clearQueued(req.sessionId);
  }

  const verdict = parseLeadVerdict(raw);
  // AC-22 melarang keraguan berakhir tanpa keputusan; ini kasus LAIN — agen tak mengembalikan
  // bentuk yang bisa dibaca sama sekali. Menebak isinya lebih berbahaya daripada jatuh ke manusia.
  if (!verdict) return fail(req, deps, "keluaran lead tak memuat blok json keputusan yang sah");

  const refs = keepExistingRefs(verdict.refs, repoDir);
  const allowed = leadActionAllowed(verdict.action);
  const kind: LeadKind = allowed ? req.kind : "refusal";

  // SPEC-480 · pilihan sebagai DATA. `options` kosong = peminta memang tak menyodorkan menu; di
  // situ `choice` tak punya arti dan tak pernah ditolak.
  const options = req.options ?? [];
  const choice = resolveChoice(verdict.choice, options);
  const choiceRejected = options.length > 0 && verdict.choice.trim() !== "" && !choice;
  const missing = verdict.missing.map((m) => m.trim()).filter(Boolean);

  // SPEC-480 · tindakan boleh DITURUNKAN dari opsi terpilih, tapi hanya saat lead diam. Label opsi
  // dirakit PEMINTA ("integrate-main — …"), jadi hint-nya bukan tebakan atas maksud agen; yang tak
  // pernah ditebak adalah pertentangan — di sana tindakan dibatalkan dan operator diberi tahu.
  let action: LeadAction = allowed ? (verdict.action as LeadAction) : "none";
  let actionNote = "";
  let conflict = false;
  if (allowed && choice) {
    const hint = optionActionHint(choice.option);
    if (hint && action === "none" && hint !== "none") {
      action = hint;
      actionNote = `Tindakan diturunkan dari opsi terpilih ("${hint}") karena lead tak menyebutnya sendiri (SPEC-480).`;
    } else if (hint && action !== "none" && action !== hint) {
      conflict = true;
      actionNote = `KONFLIK: lead memilih opsi "${choice.option}" tetapi menyetel action "${action}" — tindakan dibatalkan (SPEC-480).`;
      action = "none";
    }
  }

  // `missing` terisi ⇒ ragu, apa pun yang ditulis lead. Menyatakan konteksnya kurang DAN mengaku
  // yakin adalah dua hal yang tak bisa benar bersamaan.
  const confidence = missing.length ? "ragu" : verdict.confidence;

  const notes: string[] = [];
  if (!allowed) notes.push(`DITOLAK: ${leadRefusalReason(verdict.action)} berada di luar permukaan tindakan lead (ADR-0091 · AC-31/32).`);
  if (choiceRejected) notes.push(`DITOLAK: pilihan "${verdict.choice.trim().slice(0, 120)}" tidak ada di daftar opsi yang dikirim peminta (SPEC-480 · ADR-0098).`);
  if (actionNote) notes.push(actionNote);
  if (missing.length) notes.push(`KONTEKS KURANG: ${missing.join("; ")}`);
  const tail = notes.length ? `\n\n${notes.join("\n\n")}` : "";

  const weighty = isWeightyDecision({ kind, action, confidence }) || choiceRejected || conflict;

  const row = await recordDecision({
    projectId: req.projectId, specId: req.specId, sessionId: req.sessionId,
    // Jejak menyimpan prosa lead UTUH: yang dipangkas hanya yang DIKIRIM (SPEC-480). Jejak adalah
    // tempat orang mencari kenapa sebuah putusan diambil; memangkasnya di sini menukar putusan
    // yang bertele-tele dengan putusan yang tak bisa diaudit.
    gate: req.gate, kind, question: req.question, answer: verdict.decision,
    reason: `${verdict.reason}${tail}`,
    refs, confidence, action, weighty,
    choice: choice?.option ?? null, choiceIndex: choice?.index ?? null,
    options, missing,
  });
  if (weighty) {
    await deps.notify(row.id, notifTitle(kind, req.question, verdict.decision, confidence),
      req.projectId, req.specId ?? null, req.sessionId ?? null);
  }
  // Putusan "sebagaimana dikirim": terpangkas di batas kalimat, catatan penolakan ditempelkan
  // SESUDAH pemangkasan supaya justru bagian yang paling perlu dibaca tak ikut terpotong.
  lastDelivery.set(row.id, {
    decision: clampProse(verdict.decision, LEAD_DECISION_MAX),
    reason: `${clampProse(verdict.reason, LEAD_REASON_MAX)}${tail}`,
    reply: verdict.reply,
    choices: choice ? [choice] : [], choice, missing,
  });
  return row;
}

// Putusan sebagaimana DIKIRIM, berumur pendek: dipakai route (pintu #1) & detect.ts (pintu #2)
// sesaat setelah decide() kembali. Map (bukan kolom DB) karena isinya turunan dari baris yang
// sudah tersimpan dan tak punya nilai historis — yang bertahan adalah jejaknya, yang utuh.
const lastDelivery = new Map<string, LeadDelivery>();
export function takeDelivery(decisionId: string): LeadDelivery | null {
  const v = lastDelivery.get(decisionId) ?? null;
  lastDelivery.delete(decisionId);
  return v;
}

/**
 * AC-4 · permintaan yang tak terjawab dalam batas waktu (atau keluarannya tak terbaca) dicatat
 * sebagai baris `gagal` + notifikasi, dan peminta kembali ke perilaku hari ini: menunggu manusia.
 *
 * SPEC-432 · barisnya SELALU ditulis — "tak ada baris" tak bisa dibedakan dari "tak pernah
 * diminta", dan itulah seluruh alasan status `gagal` ada. Yang dijaga adalah notifikasinya:
 * kegagalan yang beruntun di pintu & jenis yang sama bukan kabar baru, ia hanya mengubur
 * notifikasi lain. Di panel operator, KETUJUH notifikasi lead yang pernah terbit berbunyi
 * "Lead gagal memutuskan" — satu keadaan rusak dilaporkan tujuh kali. Begitu satu keputusan
 * berhasil di antaranya, lead terbukti pulih dan kegagalan berikutnya jadi kabar lagi.
 */
async function fail(req: DecideRequest, deps: DecideDeps, reason: string): Promise<LeadDecision> {
  const prev = await prisma.leadDecision.findFirst({
    where: { projectId: req.projectId, gate: req.gate, kind: req.kind },
    orderBy: { createdAt: "desc" }, select: { status: true },
  });
  const row = await recordDecision({
    projectId: req.projectId, specId: req.specId, sessionId: req.sessionId,
    gate: req.gate, kind: req.kind, question: req.question,
    answer: "", reason, refs: [], confidence: "ragu", action: "none",
    status: "gagal", weighty: true,
  });
  if (prev?.status !== "gagal") {
    await deps.notify(row.id, `Lead gagal memutuskan: ${req.question.replace(/\s+/g, " ").slice(0, 90)}`,
      req.projectId, req.specId ?? null, req.sessionId ?? null);
  }
  return row;
}
