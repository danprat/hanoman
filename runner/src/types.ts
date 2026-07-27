export type Flow = "feature" | "qa" | "scaffold" | "reverse" | "prd" | "audit" | "breakdown" | "cross-audit";

// SPEC-298 · mode autonomy sesi scheduler (Setting.scheduler.autonomy). full-control = putuskan
// sendiri & tembus sampai done tanpa berhenti bertanya; butuh-keputusan = berhenti di titik
// keputusan (klausa lama). Dipilih saat governor meluncurkan sesi; sesi manual tak memakainya.
export type Autonomy = "full-control" | "butuh-keputusan";

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

// SPEC-273 · PRD yang dipecah sesi breakdown. content = isi PRD tersemat langsung ke prompt,
// jadi breakdown lepas dari status merge PRD (tak perlu PRD sudah ada di default branch).
export type BreakdownPrd = { title: string; path: string; content: string };

// SPEC-337 · ADR-0075 · satu project di dalam scope sesi audit lintas. repoDir null = belum
// di-bind di mesin ini (tetap masuk scope log; prompt menandainya, bukan menyembunyikannya).
export type CrossAuditProject = {
  id: string; name: string; stack: string; repoDir: string | null;
  relation?: string;  // kalimat arah relasi terhadap project utama; kosong untuk project utama
  note?: string;      // catatan bentuk integrasi dari operator (ProjectLink.note)
};

// Konteks sesi audit lintas project. `spec`/`branchTo` hanya terisi di mode backlog.
export type CrossAuditCtx = {
  primary: CrossAuditProject;
  neighbors: CrossAuditProject[];
  apiUrl: string;          // nilai $HANOMAN_AUDIT_URL sesi ini
  // Worktree tempat sesi ini berjalan — SATU-SATUNYA tempat yang boleh ditulis (ADR-0002).
  // Sengaja bukan repoDir project utama: checkout utama pun read-only bagi sesi.
  worktree?: string;
  spec?: SpecBrief;
  branchTo?: string;
};

export interface GitOps {
  /** Mengembalikan baseSha — commit tempat worktree ini lahir. */
  addWorktree(repo: string, path: string, branchFrom: string): string;
  removeWorktree(repo: string, path: string): void;
  /** HEAD worktree sekarang — dibaca sebelum removeWorktree untuk simpan headSha (SPEC-176). */
  headSha(worktree: string): string;
  /** Menyiapkan repo siap-worktree untuk project from-scratch: git init + satu commit
   *  bila belum ada HEAD. Idempoten; membuat direktori bila belum ada (SPEC-222). */
  initRepo(dir: string): void;
}
