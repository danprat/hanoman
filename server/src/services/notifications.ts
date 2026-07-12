import { prisma } from "../db";
import { liveDecisions, markerFilled } from "./pty";

// SPEC-180 · dipanggil tepat saat stage backlog masuk `done`. specId @unique membuat ini
// idempoten: poll write-through 3s dan advanceStage yang balapan hanya menyisakan satu baris —
// insert kedua kena P2002 dan diabaikan.
// ponytail: reopen backlog (SPEC-167/172) lalu selesai lagi TIDAK menotifikasi ulang karena
// barisnya sudah ada. Upgrade bila perlu: drop @unique + guard transisi via updateMany count.
export async function recordCompletion(specId: string, title: string, projectId: string | null): Promise<void> {
  // SPEC-184 · dedup pindah ke `key` (specId tak lagi @unique — kini menampung juga notif decision).
  // sessionId turunan = idFor(specId) (pty.ts): id sesi tmux backlog dapat ditebak dari spec-nya,
  // jadi aksi "Buka" pada notif bisa mengecek apakah sesinya masih hidup.
  const sessionId = specId.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  await prisma.notification.create({
    data: { type: "done", key: `done:${specId}`, specId, sessionId, title, projectId },
  }).catch(() => { /* P2002: sudah ada */ });
}

type DecisionSession = { id: string; specId?: string; projectId: string; decisionFile: string };

// SPEC-184 · episode per-sesi. Di-rebuild tiap scan dari kondisi marker: sesi mati hilang dari
// liveDecisions() → otomatis ter-prune. Transisi kosong→terisi = satu notif; idle Claude yang
// berulang menambah baris tapi id sudah di set → tak dobel. Restart server: paling banter satu
// notif ulang untuk keputusan yang masih terbuka. ponytail: single-process; pindahkan dedup ke
// kolom DB bila server jadi multi-worker.
let awaiting = new Set<string>();
export function __resetAwaiting(): void { awaiting = new Set(); } // test-only

export async function scanDecisions(read: () => DecisionSession[] = liveDecisions): Promise<void> {
  const next = new Set<string>();
  const fresh: DecisionSession[] = [];
  for (const s of read()) {
    if (!markerFilled(s.decisionFile)) continue;
    next.add(s.id);
    if (!awaiting.has(s.id)) fresh.push(s);
  }
  awaiting = next;
  for (const s of fresh) {
    const title = s.specId
      ? (await prisma.spec.findUnique({ where: { id: s.specId }, select: { title: true } }))?.title ?? s.specId
      : s.id;
    await prisma.notification.create({
      data: { type: "decision", specId: s.specId ?? null, sessionId: s.id, projectId: s.projectId || null, title },
    });
  }
}
