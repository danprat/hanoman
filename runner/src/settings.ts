// canUseTool dulu sebuah callback JS dan tak bisa melintasi batas proses. Sebuah hook
// PreToolUse bisa: ia mengalahkan `--permission-mode` (deny menang bahkan di bawah
// acceptEdits), dan hook dari `--settings` BERGABUNG dengan milik pengguna, bukan
// menggantikannya.
//
// Di bawah `--dangerously-skip-permissions` inilah satu-satunya gerbang yang tersisa
// (ADR-0010) — karena itu `deniesDangerous` diverifikasi terhadap biner sungguhan, bukan
// sekadar diuji unit.
export const guardSettings = (guardCommand: string) => ({
  hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: guardCommand }] }] },
});
