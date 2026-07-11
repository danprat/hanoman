import { prisma } from "../db";

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
