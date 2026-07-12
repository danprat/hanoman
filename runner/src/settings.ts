// Guardrail deny PreToolUse dicabut sepenuhnya (SPEC-197, ADR-0037): agen dipercaya penuh,
// isolasi murni lewat worktree. Yang tersisa di sini hanya marker keputusan (SPEC-184) —
// hook dari `--settings` tetap BERGABUNG dengan milik pengguna, bukan menggantikannya.
export const guardSettings = (decisionFile?: string) => {
  const hooks: Record<string, unknown[]> = {};
  // SPEC-184 · sinyal "menunggu keputusan manusia" dari Claude sendiri. Notification idle/izin/
  // agent_needs_input menandai marker; UserPromptSubmit (manusia menjawab) mengosongkannya.
  // Path dikutip-single agar aman terhadap spasi. ponytail: path dengan single-quote tak didukung
  // (bagian variabel hanya <sessionId> = [a-z0-9_-]); naikkan bila repoDir bisa memuat "'".
  if (decisionFile) {
    const f = `'${decisionFile.split("'").join("'\\''")}'`;
    hooks.Notification = [{ hooks: [{ type: "command",
      command: `grep -qiE 'idle|permission|waiting for|needs.?input' && echo waiting >> ${f} || true` }] }];
    hooks.UserPromptSubmit = [{ hooks: [{ type: "command", command: `: > ${f}` }] }];
  }
  return { hooks };
};
