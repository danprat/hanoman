// Bentuk kawat `stream-json` milik binary `claude`. Namanya pernah `Sdk*` sewaktu runner
// memakai @anthropic-ai/claude-agent-sdk; SDK itu dicabut ADR-0010 dan tidak ada lagi di
// repo ini. Nama lamanya membuat pembaca menyimpulkan dependency yang sudah tidak ada.
export type CliUserMessage = { type: "user"; message: { role: "user"; content: string } };
export type CliMessage =
  | { type: "assistant"; session_id?: string; message: { content: Array<{ type: string; text?: string; name?: string }> } }
  // Kegagalan API di tengah giliran TIDAK memakai subtype `error_*`: claude v2.1.205 memancarkan
  // `subtype: "success"` dengan `is_error: true` dan `api_error_status` berisi kode HTTP-nya.
  // Karena itu `subtype` saja bukan sinyal gagal yang cukup — lihat ADR-0012.
  | { type: "result"; subtype: string; is_error?: boolean; api_error_status?: number; session_id: string; total_cost_usd: number; usage: { input_tokens: number; output_tokens: number } }
  | { type: "system"; session_id?: string };

export type CliOptions = {
  cwd: string; model: string; effort?: string;
  abortController?: AbortController; disallowedTools?: string[];
  settingSources?: string[];
  /** Sambung percakapan yang sudah ada alih-alih memulai yang baru (`claude --resume`). */
  resume?: string;
};

// Satu proses `claude` melayani seluruh backlog: tiap pesan pengguna menghasilkan tepat
// satu `result`, dan prosesnya hidup selama stdin terbuka (diverifikasi terhadap v2.1.205).
export interface ClaudeSession {
  /** Tulis satu pesan pengguna. Tepat satu `result` akan menyusul. */
  send(text: string): void;
  /** Pesan berikutnya dari stdout, atau null saat stream berakhir. Satu pembaca saja. */
  next(): Promise<CliMessage | null>;
  /** Tutup stdin — inilah satu-satunya cara `claude` keluar. */
  close(): void;
  kill(): void;
}
export type OpenSession = (o: CliOptions) => ClaudeSession;

// Pertanyaan yang diajukan agen ke manusia (SPEC-157). `default` WAJIB salah satu
// `options[].value`: ia yang diterapkan kalau tak ada yang menjawab sebelum timeout.
export type AskOption = { value: string; label: string; detail?: string };
export type Ask = { question: string; options: AskOption[]; default: string };

// `skipped`: run memutuskan untuk tidak menjalankan fase ini (SPEC-145) — berbeda dari
// `pending` ("belum jalan"). Ia keluar dari penyebut progress dan tidak diulang saat resume.
export type PhaseState = "pending" | "active" | "done" | "failed" | "skipped";
export type RunEvent =
  | { kind: "log"; line: { t: string; s: string } }
  | { kind: "phase"; name: string; state: PhaseState }
  | { kind: "cost"; tokensIn: number; tokensOut: number; costUsd: number }
  | { kind: "session"; sessionId: string }
  | { kind: "commit"; base?: string; head?: string }
  | { kind: "status"; status: "running" | "paused" | "stopped" | "failed" | "done" };
export type Flow = "feature" | "qa" | "scaffold" | "reverse";
export type StepModel = { model: string; effort: string };
export type StepModels = Record<"brainstorm" | "spec" | "plan" | "execute" | "audit", StepModel>;
// Backlog item the run must implement, loaded from the DB by the worker at run
// time. Without it the phase prompt carried only "SPEC-3" — an id that means
// nothing inside a fresh worktree — so the run had no way to match the backlog.
export type SpecBrief = { id: string; title: string; source: string; priority: string; objective: string; payload?: unknown };
export type RunInput = { runId: string; projectId?: string; repoDir: string; branchFrom: string; branchTo: string; flow: Flow; specId?: string; spec?: SpecBrief; steps: StepModels; only?: string;
  // Melanjutkan run yang terputus (ADR-0017), diisi worker dari baris Run: sesi claude
  // milik run ini, dan fase yang sudah `done` sehingga tidak dikerjakan dua kali.
  resume?: string; donePhases?: string[];
  // github-backed runs (SPEC-006): commit to report status on, "owner/repo",
  // installation to auth git ops, and a tokenized push remote (set at run time).
  commitSha?: string; reportRepo?: string; installationId?: number; remoteUrl?: string };
export type RunResult = { status: "done" | "failed" | "stopped"; costUsd: number; tokensIn: number; tokensOut: number };

export interface GitOps {
  /** `reuse`: pakai worktree yang sudah ada apa adanya. Mengembalikan baseSha, atau undefined saat reuse. */
  addWorktree(repo: string, path: string, branchFrom: string, reuse?: boolean): string | undefined;
  removeWorktree(repo: string, path: string): void;
  /** Mengembalikan headSha — commit tip milik run ini. */
  commitAndPush(worktreePath: string, message: string, branchTo: string, remoteUrl?: string): string;
  switchBase(worktreePath: string, branchFrom: string): void;
}
