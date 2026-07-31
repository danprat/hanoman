import { prisma } from "../../db";
import type { Lead } from "@hanoman/shared";
import { listSessions } from "../pty";
import { planComplete } from "../session-phases";
import { resolveRepoDir } from "../local-binding";
import { specReview } from "../spec-review";
import { enqueue, UNSTARTED_SPEC_WHERE } from "../scheduler/queue";
import { recordLeadDecision } from "../notifications";
import { getLead, leadActive, leadProjects } from "./config";
import { decide, prodDecideDeps, type DecideDeps } from "./decide";
import { applyAction } from "./apply";
import { recordDecision } from "./trail";

// SPEC-409 · ADR-0091 · PINTU #3 — denyut proaktif. Tiga pekerjaan yang tak dipicu siapa-siapa:
// menata urutan kerja, mendeteksi tabrakan area kerja, dan menindaklanjuti sesi yang baru selesai.
//
// AC-12 · denyut hidup di dalam proses server (setInterval, engine.ts) — TANPA message queue,
// worker terpisah, atau cron eksternal (ADR-0024). AC-13 · urutan yang ia putuskan diserahkan ke
// antrean & governor yang sudah ada (ADR-0072); tak ada antrean kedua.

// ── Area kerja (OQ-9) ────────────────────────────────────────────────────────────────────────
// "Area kerja" diturunkan dari BERKAS YANG SUDAH BERUBAH di worktree sesi, bukan dari plan atau
// isi backlog: plan menyatakan niat (dan sering meleset), diff menyatakan kenyataan. Sumbernya
// `specReview` yang sudah dipakai layar Review — satu definisi "apa yang disentuh sesi ini".

export type WorkArea = { specId: string; sessionId: string; projectId: string; paths: string[] };
export type Collision = { a: WorkArea; b: WorkArea; shared: string[]; nearby: string[] };

/** Dua segmen pertama sebuah path = "modul". `server/src/services/x.ts` → `server/src`. */
const moduleOf = (p: string): string => p.split("/").slice(0, 2).join("/");

/**
 * AC-14 · dua pekerjaan yang menyentuh area sama. Murni, supaya definisinya bisa diuji tanpa git.
 * `shared` = berkas yang SAMA persis (tabrakan hampir pasti). `nearby` = modul yang sama tanpa
 * berkas yang sama (sinyal lebih lemah, tetap dilaporkan — konflik integrasi lahir di sana juga).
 * Pasangan tanpa keduanya bukan tabrakan dan tak menghabiskan satu giliran lead pun.
 */
export function findCollisions(areas: WorkArea[]): Collision[] {
  const out: Collision[] = [];
  for (let i = 0; i < areas.length; i++) {
    for (let j = i + 1; j < areas.length; j++) {
      const a = areas[i]!, b = areas[j]!;
      if (a.projectId !== b.projectId) continue;
      const bp = new Set(b.paths);
      const shared = a.paths.filter((p) => bp.has(p));
      const bm = new Set(b.paths.map(moduleOf));
      const nearby = [...new Set(a.paths.map(moduleOf))].filter((m) => bm.has(m) && !shared.some((s) => moduleOf(s) === m));
      if (shared.length || nearby.length) out.push({ a, b, shared, nearby });
    }
  }
  return out;
}

// ── Deps ─────────────────────────────────────────────────────────────────────────────────────
export type PulseDeps = {
  sessions: () => { id: string; projectId: string; specId?: string; cwd: string; exited: boolean; exitCode?: number }[];
  areas: (s: { id: string; projectId: string; specId: string }) => Promise<string[]>;
  planDone: (cwd: string, specId: string) => boolean;
  decide: typeof decide;
  decideDeps: DecideDeps;
  apply: typeof applyAction;
  enqueue: typeof enqueue;
  notify: (id: string, title: string, projectId: string, specId: string | null, sessionId: string | null) => Promise<void>;
  optIn: () => Promise<string[]>;
  cfg: () => Promise<Lead>;
};

export const prodPulseDeps: PulseDeps = {
  sessions: () => { try { return listSessions(); } catch { return []; } },
  areas: async (s) => {
    const repoDir = await resolveRepoDir(s.projectId);
    if (!repoDir) return [];
    const spec = await prisma.spec.findUnique({ where: { id: s.specId }, select: { baseSha: true, branchFrom: true } });
    if (!spec) return [];
    try {
      const r = await specReview(repoDir, s.specId, spec.baseSha, spec.branchFrom);
      return r.changed.map((c) => c.path);
    } catch { return []; }   // worktree sudah lenyap / basis tak resolve → bukan area kerja
  },
  planDone: planComplete,
  decide,
  decideDeps: prodDecideDeps,
  apply: applyAction,
  enqueue,
  notify: recordLeadDecision,
  optIn: leadProjects,
  cfg: getLead,
};

export type PulseResult = { ordered: number; collisions: number; quality: number };

// OQ-2 · jangan membakar kuota saat tak ada yang berubah: satu putusan penataan hanya lahir saat
// himpunan backlog siap-kerja BERBEDA dari yang terakhir ditata. In-memory & sengaja begitu —
// setelah restart satu penataan ulang jauh lebih murah daripada kolom DB untuk nilai turunan.
// PER PROJECT, bukan global: satu lead melayani satu project (NG1), jadi backlog project A yang
// berubah tak boleh menghabiskan giliran lead untuk project B — dan sebaliknya, project B yang diam
// tak boleh menahan penataan project A hanya karena tanda tangan gabungannya tak berubah.
const lastReadySig = new Map<string, string>();
export function __resetPulse(): void { lastReadySig.clear(); }

/** Satu denyut. Tak pernah melempar: satu bagian gagal tak boleh menghentikan dua yang lain. */
export async function pulse(deps: PulseDeps = prodPulseDeps): Promise<PulseResult> {
  const res: PulseResult = { ordered: 0, collisions: 0, quality: 0 };
  const cfg = await deps.cfg();
  if (!cfg.enabled || cfg.paused) return res;
  const optIn = (await deps.optIn()).filter((p) => leadActive(cfg, p));
  if (!optIn.length) return res;

  try { res.quality = await followUpFinished(cfg, optIn, deps); } catch { /* satu bagian gagal tak menghentikan sisanya */ }
  try { res.collisions = await detectCollisions(optIn, deps); } catch { /* idem */ }
  try { res.ordered = await orderReadyWork(optIn, deps); } catch { /* idem */ }
  return res;
}

// ── D · mutu: sesi yang baru selesai ─────────────────────────────────────────────────────────
/**
 * AC-16 · sesi berakhir dengan kode keluar ≠ 0 → lead memutuskan tindak lanjutnya.
 * AC-17 · sesi berakhir sementara plan-nya masih menyisakan `- [ ]` → pekerjaan belum tuntas.
 * AC-18 · bila putusannya "lanjutkan", jalur yang dipakai adalah jalur lanjutkan-sesi yang sudah
 *         ada (ADR-0084) — dan basis review (`baseSha`) tak pernah ditulis ulang. Route yang
 *         mengeksekusi tindakan itu memanggil `startSpecSession` apa adanya.
 *
 * OQ-13 · sesi DOKUMEN (prd/audit/reverse/scaffold/breakdown) tak punya plan berkotak; ia hanya
 * dinilai lewat kode keluar. Sesi tanpa specId dilewati seluruhnya di versi ini.
 */
async function followUpFinished(cfg: Lead, optIn: string[], deps: PulseDeps): Promise<number> {
  let n = 0;
  const opt = new Set(optIn);
  for (const s of deps.sessions()) {
    if (!s.exited || !s.specId || !opt.has(s.projectId)) continue;
    const bad = (s.exitCode ?? 0) !== 0;
    const unfinished = !deps.planDone(s.cwd, s.specId);
    if (!bad && !unfinished) continue;
    // Idempoten lewat JEJAK, bukan Set memori: sesi mati bertahan di tmux (`remain-on-exit on`)
    // berhari-hari, dan denyut tiap 5 menit akan memutuskan hal yang sama berulang kali —
    // termasuk sesudah server restart, yang justru saat Set memori kosong.
    const seen = await prisma.leadDecision.findFirst({ where: { sessionId: s.id, kind: "quality", gate: "pulse" } });
    if (seen) continue;
    const why = [bad ? `berakhir dengan kode keluar ${s.exitCode}` : null,
      unfinished ? "plan-nya masih menyisakan kotak `- [ ]`" : null].filter(Boolean).join(" dan ");
    const row = await deps.decide({
      projectId: s.projectId, specId: s.specId, sessionId: s.id,
      gate: "pulse", kind: "quality",
      question: `Sesi ${s.id} untuk backlog ${s.specId} ${why}. Tindak lanjutnya apa: lanjutkan pekerjaan yang terputus, ulangi dari awal, atau hentikan?`,
      options: [
        "resume-session — lanjutkan dari keadaan worktree sekarang (ADR-0084)",
        "restart-session — ulangi dari awal",
        "none — terima apa adanya, sertakan alasannya",
      ],
      notes: [`Worktree sesi: ${s.cwd}`],
    }, deps.decideDeps);
    if (!row) continue;
    n++;
    // Lead memutuskan LALU melapor — tindak lanjutnya dijalankan di sini, bukan menunggu operator
    // menekan sesuatu. Kegagalan tindakan tak menghentikan denyut: barisnya sudah tercatat, dan
    // sesi tetap berada di keadaan yang sama seperti sebelum lead menyentuhnya.
    if (row.status === "berlaku" && row.action !== "none") {
      try { await deps.apply(row); } catch { /* tindakan gagal; jejaknya tetap ada */ }
    }
  }
  return n;
}

// ── D · tabrakan area kerja ──────────────────────────────────────────────────────────────────
async function detectCollisions(optIn: string[], deps: PulseDeps): Promise<number> {
  const opt = new Set(optIn);
  const live = deps.sessions().filter((s) => !s.exited && s.specId && opt.has(s.projectId));
  if (live.length < 2) return 0;
  const areas: WorkArea[] = [];
  for (const s of live) {
    const paths = await deps.areas({ id: s.id, projectId: s.projectId, specId: s.specId! });
    if (paths.length) areas.push({ specId: s.specId!, sessionId: s.id, projectId: s.projectId, paths });
  }
  let n = 0;
  for (const c of findCollisions(areas)) {
    const key = [c.a.sessionId, c.b.sessionId].sort().join("|");
    const seen = await prisma.leadDecision.findFirst({
      where: { kind: "collision", gate: "pulse", question: { contains: key } },
    });
    if (seen) continue;
    const row = await deps.decide({
      projectId: c.a.projectId, specId: c.a.specId, sessionId: c.a.sessionId,
      gate: "pulse", kind: "collision",
      question: `Dua pekerjaan menyentuh area yang sama [${key}]: ${c.a.specId} dan ${c.b.specId}. Tunda salah satu, gabungkan, atau biarkan?`,
      options: [
        `hold-work — tunda salah satu sampai yang lain terintegrasi`,
        `none — biarkan berjalan, sertakan alasan kenapa tabrakan ini aman`,
      ],
      notes: [
        c.shared.length ? `Berkas yang sama: ${c.shared.slice(0, 20).join(", ")}` : "",
        c.nearby.length ? `Modul yang sama: ${c.nearby.slice(0, 20).join(", ")}` : "",
      ].filter(Boolean),
    }, deps.decideDeps);
    if (row) n++;
  }
  return n;
}

// ── D · urutan kerja ─────────────────────────────────────────────────────────────────────────
/**
 * AC-13 · lead menata, antrean & governor yang mengeksekusi. Urutan diwujudkan sebagai URUTAN
 * ENQUEUE, bukan dengan menulis ulang `Spec.priority`: prioritas adalah pernyataan operator, dan
 * `queued()` mengurutkan prioritas dulu baru FIFO — jadi lead menata DI DALAM setiap pita
 * prioritas. Itu batas yang diterima sadar di versi ini (lihat ADR-0091 §Konsekuensi).
 */
async function orderReadyWork(optIn: string[], deps: PulseDeps): Promise<number> {
  let total = 0;
  for (const projectId of optIn) total += await orderProject(projectId, deps);
  return total;
}

async function orderProject(projectId: string, deps: PulseDeps): Promise<number> {
  // SPEC-431 · "siap dikerjakan" memakai predikat BERSAMA dengan checker backlog. Sebelumnya
  // `baseSha: null` telanjang, jadi lead ikut mengurutkan — dan mengantrekan — pekerjaan yang
  // sudah `done`; item yang selesai sebelum ADR-0030 tak pernah punya `baseSha`.
  const ready = await prisma.spec.findMany({
    where: { ...UNSTARTED_SPEC_WHERE, projectId },
    select: { id: true, projectId: true, title: true, priority: true, objective: true },
    orderBy: { id: "asc" },
  });
  if (ready.length < 2) return 0;
  const sig = ready.map((r) => r.id).join(",");
  if (sig === lastReadySig.get(projectId)) return 0;   // tak berubah → tak ada giliran lead terpakai
  lastReadySig.set(projectId, sig);

  const row = await deps.decide({
    projectId,
    gate: "pulse", kind: "order",
    question: `Ada ${ready.length} backlog siap dikerjakan. Urutkan mana yang lebih dulu berdasarkan isi pekerjaannya, lalu tuliskan urutan id-nya (dipisah koma) di \`decision\`.`,
    options: ready.map((r) => `${r.id} · [${r.priority}] ${r.title}`),
    notes: ready.map((r) => `${r.id}: ${r.objective.slice(0, 200)}`),
  }, deps.decideDeps);
  if (!row || row.status !== "berlaku") return 0;

  // Urutan dibaca dari jawabannya; id yang tak dikenal diabaikan, dan sisa yang tak disebut lead
  // tetap masuk antrean di belakang — lead yang lupa satu item tak boleh membuatnya hilang.
  const byId = new Map(ready.map((r) => [r.id.toLowerCase(), r]));
  const named: typeof ready = [];
  for (const tok of row.answer.split(/[,\s]+/).map((t) => t.trim().toLowerCase()).filter(Boolean)) {
    const hit = byId.get(tok);
    if (hit && !named.includes(hit)) named.push(hit);
  }
  const ordered = [...named, ...ready.filter((r) => !named.includes(r))];
  for (const r of ordered) {
    await deps.enqueue({ specId: r.id, projectId: r.projectId, source: "lead", priority: r.priority });
  }
  await deps.notify(row.id, `Lead menata ${ordered.length} backlog siap kerja`, projectId, null, null);
  return ordered.length;
}

/** Baris jejak untuk denyut yang dilewati karena lead dijeda — dipakai test & observabilitas. */
export async function recordPaused(projectId: string, why: string): Promise<void> {
  await recordDecision({
    projectId, gate: "pulse", kind: "answer",
    question: "denyut", answer: "dilewati", reason: why,
    refs: [], confidence: "tinggi", action: "none",
  });
}
