// SPEC-407 · ADR-0089 — pembaca payload backlog goal.
//
// Modul TERPISAH dengan sengaja: `goal.ts` sudah mengimpor `prompt.ts` (untuk `PIPELINES`), jadi
// menaruh reader ini di salah satu dari keduanya melahirkan siklus impor. Ia murni & defensif —
// payload datang dari kolom `Json`, jadi bentuk apa pun bisa mendarat di sana dan tak satu pun
// boleh membuat peluncuran sesi melempar.
export type GoalBrief = { goal: string; done: string; constraints: string };

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** `null` bila payload bukan objek ber-`goal` string non-kosong (mis. payload brief/qa). */
export function readGoalPayload(payload: unknown): GoalBrief | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  const goal = str(p.goal);
  if (!goal) return null;
  return { goal, done: str(p.done), constraints: str(p.constraints) };
}
