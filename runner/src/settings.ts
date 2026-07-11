// canUseTool dulu sebuah callback JS dan tak bisa melintasi batas proses. Sebuah hook
// PreToolUse bisa: ia mengalahkan `--permission-mode` (deny menang bahkan di bawah
// acceptEdits), dan hook dari `--settings` BERGABUNG dengan milik pengguna, bukan
// menggantikannya.
//
// Di bawah `--dangerously-skip-permissions` inilah satu-satunya gerbang yang tersisa
// (ADR-0010) — karena itu `deniesDangerous` diverifikasi terhadap biner sungguhan, bukan
// sekadar diuji unit.
export const guardSettings = (guardCommand: string, decisionFile?: string) => {
  const hooks: Record<string, unknown[]> = {
    PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: guardCommand }] }],
  };
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
