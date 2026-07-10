// Dipakai adapter `hanoman hook pretooluse`, yang dipasang tiap sesi sebagai hook PreToolUse.
// Di bawah `--dangerously-skip-permissions` inilah satu-satunya gerbang yang tersisa (ADR-0010).
// Glob di --disallowed-tools lebih kasar daripada regex di sini.
export function deniesDangerous(tool: string, input: Record<string, unknown>): boolean {
  const cmd = String((input as { command?: unknown }).command ?? "");
  if (tool === "Bash" && /\brm\s+-rf\b/.test(cmd)) return true;
  if (tool === "Bash" && /git\s+push\b.*\bmain\b/.test(cmd)) return true;
  // Satu backlog item = satu worktree — yang dibuat server saat sesi lahir dan dibuangnya saat
  // sesi ditutup. Agen yang menyalakan worktree-nya sendiri (skill bergaya `using-git-worktrees`
  // yang termuat dari settings pengguna) meninggalkan pohon yang tak pernah dibersihkan siapa
  // pun, lalu commit dari path yang tak pernah di-push.
  if (tool === "Bash" && /git\s+worktree\s+add\b/.test(cmd)) return true;
  return false;
}
export const GUARD_DENY_REASON = "ditolak oleh guardrail hanoman";
