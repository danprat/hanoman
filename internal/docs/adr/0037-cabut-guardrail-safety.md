# ADR-0037 — Cabut guardrail deny perintah (PreToolUse) sepenuhnya

**Status:** aktif (SPEC-197). Memperbarui ADR-0010, ADR-0009; melanjutkan arah ADR-0023 (guardrail SoT dicabut).

## Konteks

Di bawah `--dangerously-skip-permissions`, hook `PreToolUse` `hanoman hook pretooluse`
(`deniesDangerous`, runner/src/safety.ts) adalah satu-satunya gerbang yang tersisa (ADR-0010).
Audit SPEC-197 menunjukkan gerbang ini bocor untuk varian trivial: `rm -fr`, `rm -r -f`,
`rm --recursive --force`, `rm -rfv` semuanya lolos regex `/\brm\s+-rf\b/`; guard push-main
sekaligus false-negative (newline) dan false-positive (memblok branch bernama `…main…`).
Sebuah regex-di-atas-string-perintah tak bisa menutup shell (`eval`, `sh -c $var`, alias) —
ia memberi rasa aman yang keliru sambil sesekali memblok kerja sah.

## Keputusan

**Cabut guardrail deny sepenuhnya.** Hapus `runner/src/safety.ts`, perintah CLI
`hook pretooluse`, dan hook `PreToolUse` di `guardSettings`. Agen dipercaya penuh — sama
seperti developer yang menjalankan `claude --dangerously-skip-permissions` di mesinnya
sendiri. Ketiga guard lama ikut dicabut, termasuk `git worktree add` (yang menjaga invarian
1-backlog-1-worktree).

Yang TETAP: hook `Notification`/`UserPromptSubmit` (marker keputusan SPEC-184) di
`guardSettings` — tak berhubungan dengan deny. Guardrail deny perintah berbahaya di
`runner/src/safety.ts` yang disebut CLAUDE.md "tetap" kini resmi dicabut oleh ADR ini.

## Konsekuensi

- **Isolasi kini murni worktree + trust**: run tetap jalan di `.worktrees/<id>` terpisah dari
  working tree utama (ADR-0002). Itu batas kerusakan yang tersisa — bukan lagi deny list.
- **Agen bisa spawn worktree sendiri** yang tak dibersihkan server, dan commit dari path yang
  tak pernah di-push (persis yang dulu dicegah guard worktree). Bila ini jadi masalah nyata,
  tanganinya lewat pembersihan `.worktrees` periodik, bukan menghidupkan kembali deny hook.
- **`rm -rf` / `git push` destruktif tak lagi diblokir.** Diterima: konteks single-user,
  localhost, repo milik user sendiri; risiko setara menjalankan agen coding mana pun.
- Menghidupkan kembali guardrail deny butuh ADR baru (mencabut yang ini).

## Alternatif yang ditolak

- **Perbaiki regex `rm`/push** (normalisasi flag): menambal satu kelas, tak menutup `eval`/alias/
  skrip; tetap memblok kerja sah sesekali. Kompleksitas untuk keamanan semu.
- **Sandbox sungguhan (container/seccomp)**: di luar scope; worktree + trust cukup untuk
  konteks single-user saat ini.
