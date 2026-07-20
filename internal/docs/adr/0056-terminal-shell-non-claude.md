# ADR-0056 — Terminal biasa = shell mentah di repoDir project (bukan claude)

Status: diterima · SPEC-236 · 2026-07-20 · mengikuti pola ADR-0042

## Konteks
Operator kadang hanya ingin menjalankan command di sebuah project (mis. `pnpm install`,
`git status`, build) tanpa menyalakan sesi `claude`. "Sesi baru" di Terminal men-spawn
`claude --dangerously-skip-permissions` di repoDir; tak ada opsi shell polos untuk project lokal.
Console VPS (ADR-0042) sudah membuktikan pola shell mentah lewat `createSession({ command })`.

## Keputusan
`POST /terminal/sessions { project, shell: true }` men-spawn `shellBin()`
(`HANOMAN_SHELL ?? $SHELL ?? /bin/bash`) lewat `createSession(project.id, repoDir, { command: [shellBin()] })`
— cabang argv mentah `pty.ts` yang melewati `claude`/`--dangerously-skip-permissions`/`--settings`.
- **cwd = repoDir project (working tree utama), bukan worktree isolasi.** Tujuannya menjalankan
  command di project sungguhan; worktree ephemeral justru salah. Konsisten dengan "Sesi baru"
  (claude di repoDir), IDE Visual (ADR-0034), dan Console VPS (ADR-0042).
- **Tanpa `flow`.** Shell bukan pipeline claude: tak punya fase, tak menggerakkan `Spec.stage`,
  tak punya Spec. `flow` tetap `feature|qa|scaffold|reverse|prd`. Varian wire `{project,shell:true}`
  terpisah dari `flow` dan didahulukan di `zTerminalSession` (union non-strict membuang key asing,
  jadi bila varian longgar `{project,flow?}` lebih dulu, `{project,shell:true}` akan lolos sebagai
  plain dan shell terbuang).
- **Id acak → banyak shell per project diizinkan** (cermin "Sesi baru"), bukan deterministik.

## Alasan
- Nyaris nol kode baru: reuse penuh attach/scrollback/WS/resize/kill/persistensi tmux (ADR-0016).
- Tak ada perubahan skema — sesi terminal tmux-only, tak ada baris DB.
- DELETE aman: cleanup worktree hanya untuk sesi ber-`flow` atau ber-cwd `.worktrees/`; shell
  ber-cwd repoDir → hanya kill pane, working tree utama tak tersentuh.

## Konsekuensi
- RCE by design, sama seperti seluruh endpoint terminal — server bind `127.0.0.1` (ADR-0014).
  Shell justru lebih sempit dari `claude --dangerously-skip-permissions`.
- Aturan "jangan jalankan sesi di working tree utama" (AGENTS.md) tetap berlaku untuk **sesi
  kerja pipeline** (feature/qa) yang membangun ke branch. Sesi ad-hoc yang dikemudikan manusia
  (shell / "Sesi baru") di repoDir bukan sasaran aturan itu — ditegaskan di sini.

## Ditolak
- **`flow: "shell"`**: mencemari mesin stage & tipe `Flow` runner dengan konsep tanpa fase.
- **Worktree isolasi untuk shell**: operator tak akan melihat state project sungguhan.
- **Id deterministik (satu shell/project)**: operator sering butuh >1 shell (server + git).
