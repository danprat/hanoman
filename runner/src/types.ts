export type Flow = "feature" | "qa" | "scaffold" | "reverse" | "prd";

// Backlog item yang dikerjakan sebuah sesi. Id-nya saja tak berarti apa-apa di dalam
// worktree yang masih segar (spec hidup di Postgres, bukan di repo), jadi ia harus
// dieja lengkap di dalam prompt awal.
export type SpecBrief = {
  id: string; title: string; source: string; priority: string;
  objective: string; payload?: unknown;
};

// Identitas project untuk sesi project-level (reverse): tak ada backlog item, jadi
// konteksnya diambil dari baris Project (SPEC-166).
export type ProjectBrief = { id: string; name: string; desc: string; stack: string };

// SPEC-210 · brief awal PRD (sesi prd project-level). Disisipkan ke prompt sesi.
export type PrdBrief = { title: string; context: string; outcome: string; constraints?: string };

export interface GitOps {
  /** Mengembalikan baseSha — commit tempat worktree ini lahir. */
  addWorktree(repo: string, path: string, branchFrom: string): string;
  removeWorktree(repo: string, path: string): void;
  /** HEAD worktree sekarang — dibaca sebelum removeWorktree untuk simpan headSha (SPEC-176). */
  headSha(worktree: string): string;
}
