export type Flow = "feature" | "qa" | "scaffold" | "reverse";

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

export interface GitOps {
  /** Mengembalikan baseSha — commit tempat worktree ini lahir. */
  addWorktree(repo: string, path: string, branchFrom: string): string;
  removeWorktree(repo: string, path: string): void;
  /** HEAD worktree sekarang — dibaca sebelum removeWorktree untuk simpan headSha (SPEC-176). */
  headSha(worktree: string): string;
}
