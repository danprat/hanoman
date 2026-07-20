# SPEC-236 — Terminal tmux non-Claude (shell biasa di project)

**Sumber:** brief · prioritas tinggi
**Tanggal:** 2026-07-20
**ADR terkait:** ADR-0056 (baru), mengikuti pola ADR-0042 (Console VPS = shell mentah di tmux)

## Objective (MVP)

Operator bisa membuka **terminal tmux biasa — sebuah shell, tanpa sesi `claude`** — di
direktori project yang dipilih, untuk sesederhana menjalankan command (mis. `pnpm install`,
`git status`, `ls`, `npm run build`) di project itu. Sesi shell hidup di infrastruktur tmux
yang sama (persisten lintas restart API, reattach, scrollback, resize) dan muncul di grid
Terminal sama seperti sesi lain.

Selesai bila: dari layar **Terminal**, memilih project + menekan satu tombol membuka pane
berisi shell interaktif di `repoDir` project itu — bukan TUI Claude Code.

## Konteks & temuan kode

- **Mekanismenya sudah ada, belum di-wire untuk project lokal.** `createSession(projectId, cwd,
  opts)` (`server/src/services/pty.ts:134`) punya cabang biner di baris 165–175: bila
  `opts.command` ada, ia men-spawn argv itu apa adanya (shell mentah); bila tidak, selalu
  `claude --dangerously-skip-permissions --settings …`. Satu-satunya pemakai `command` hari ini
  adalah **Console VPS** (`POST /vps/:id/console`, `createSession(..., { command: ssh… })`,
  ADR-0042).
- **"Terminal biasa" yang ada bukan shell — ia claude.** `POST /terminal/sessions {project}`
  (fallback `terminal.ts:203`) memanggil `createSession(project.id, repoDir)` **tanpa** `command`
  → menjalankan `claude` interaktif di `repoDir`. Empty-state Terminal pun menuliskannya:
  "hanoman menjalankan claude --dangerously-skip-permissions di direktori project itu."
- **Sesi tmux-only, tak ada baris DB.** `SessionInfo` (`pty.ts:41`) hanya punya
  `id/projectId/specId?/flow?/cwd/exited/branch?/decision`. Tak ada kolom `kind`/`type`.
  Metadata disimpan sebagai tmux user-option (`@hanoman_project`, `@hanoman_cwd`, …). **Tak ada
  perubahan skema Prisma.**
- **Id sesi tanpa spec = acak.** `idFor(undefined)` = `randomUUID().slice(0,8)` (`pty.ts:84`),
  jadi "Sesi baru" (claude) sudah membolehkan banyak sesi per project. Shell mengikuti pola yang
  sama — banyak shell per project diizinkan.
- **Wire protocol belum punya cara minta shell.** `zTerminalSession` (`shared/src/dto.ts:104`)
  hanya membedakan lewat `flow`. `flow` adalah konsep **pipeline claude** (fase → Stage), tak
  cocok untuk shell yang tak punya fase.
- **Cleanup DELETE sudah benar untuk shell.** `DELETE /terminal/sessions/:id` (`terminal.ts:280`)
  hanya `removeWorktree` bila sesi punya `flow` **atau** `cwd` di bawah `.worktrees/`. Shell
  ber-cwd `repoDir` (bukan `.worktrees/`) dan tanpa `flow` → kill pane saja, **tak menyentuh
  working tree utama**. Tepat.

## Keputusan desain

### 1. Representasi: `shell:true`, bukan `flow` baru
Tambah varian union `{ project, shell: true }` ke `zTerminalSession`, **terpisah dari `flow`**.
Alasan: `flow` (`feature|qa|scaffold|reverse|prd`) menandai pipeline claude yang menggerakkan
`Spec.stage` lewat phase-file; shell tak punya fase, tak punya Spec, tak menggerakkan stage.
Menaruh "shell" ke dalam `zFlow`/`Flow` akan mencemari mesin stage dan `runner`. Shell = sesi
**tanpa flow**, cermin persis Console VPS yang juga bukan flow.

**Urutan union penting.** `z.union` memakai varian pertama yang lolos, dan `z.object` non-strict
membuang key asing. `{project, shell:true}` akan lolos varian longgar `{project, flow?:reverse}`
(shell dibuang) bila varian itu didahulukan. Karena itu varian shell **ditaruh paling depan**:

```ts
export const zTerminalSession = z.union([
  z.object({ project: z.string(), shell: z.literal(true) }),   // SPEC-236 · shell biasa, non-claude
  z.object({ project: z.string(), flow: z.literal("reverse").optional() }),
  z.object({ project: z.string(), flow: z.literal("prd"), brief: zPrdBrief }),
  z.object({ project: z.string(), flow: z.literal("scaffold") }),
  z.object({ spec: z.string(), flow: zFlow }),
]);
```
Verifikasi: `{project,shell:true}`→shell; `{project}`→plain(claude); `{project,flow:"reverse"}`→
reverse; `{project,flow:"prd",brief}`→prd; `{spec,flow}`→spec. (Diuji di `shared/test/dto.test.ts`.)

### 2. cwd = `repoDir` project (working tree utama), bukan worktree isolasi
Tujuannya "jalankan command **di project yang dipilih**" — operator ingin melihat state project
sungguhan (install dependency, cek git, build). Worktree ephemeral akan salah untuk maksud ini.
Ini **konsisten dengan perilaku yang sudah ada**: "Sesi baru" (claude) juga jalan di `repoDir`;
IDE Visual memutasi working tree utama (ADR-0034); Console VPS shell mentah (ADR-0042). Aturan
"jangan jalankan **sesi** di working tree utama" (AGENTS.md) menyasar **sesi kerja pipeline**
(feature/qa) yang membangun ke branch dan bisa clobber — bukan sesi ad-hoc yang dikemudikan
manusia. ADR-0056 mencatat batas ini eksplisit.

### 3. Shell binary: `HANOMAN_SHELL ?? SHELL ?? /bin/bash`
Helper `shellBin()` di `pty.ts` bersebelahan dengan `claudeBin()`, memakai `effectiveStr`
(`config`) — env `HANOMAN_SHELL` (untuk test bisa disetel mis. ke `cat`/`sh`), fallback
`process.env.SHELL`, lalu `/bin/bash`. Argv = `[shellBin()]`; tmux memberi pane sebuah TTY, jadi
shell lahir interaktif (baca ~/.bashrc/.zshrc) — persis window tmux biasa.

### 4. Idempotensi: id acak → banyak shell diizinkan
Route memanggil `createSession(project.id, repoDir, { command: [shellBin()] })` **tanpa** `id`
→ `idFor(undefined)` = id acak. Menekan tombol dua kali membuka dua shell, sesuai "Sesi baru".
(Console VPS memilih id deterministik karena "satu console per VPS"; di sini banyak shell per
project justru diinginkan.)

## Perubahan (ringkas)

**Server**
- `server/src/services/pty.ts`: tambah `export const shellBin = () => effectiveStr("HANOMAN_SHELL") ?? process.env.SHELL ?? "/bin/bash";`
- `shared/src/dto.ts`: tambah varian `{ project, shell: z.literal(true) }` **paling depan** di `zTerminalSession`.
- `server/src/routes/terminal.ts`: **tepat setelah guard `project` 404** (baris ~109), sebelum
  guard `repoDir` yang mereferensi `parsed.data.flow`, sisipkan:
  ```ts
  // SPEC-236 · terminal biasa non-claude: shell mentah di repoDir project (reuse cabang
  // createSession({command}) yang dipakai Console VPS, ADR-0042/0056). Tanpa flow → tak
  // menggerakkan stage; cwd=repoDir (bukan .worktrees) → DELETE tak menyentuh working tree.
  if ("shell" in parsed.data && parsed.data.shell) {
    const repoDir = await resolveRepoDir(project.id);
    if (!repoDir) return reply.code(400)
      .send({ error: `project "${project.id}" belum di-bind ke checkout lokal`, needsBind: true });
    const s = createSession(project.id, repoDir, { command: [shellBin()] });
    return reply.code(201).send({ id: s.id });
  }
  ```
  (import `shellBin` dari `../services/pty`). **Kenapa sebelum guard `repoDir` lama:** varian
  shell tak punya key `flow`, jadi ekspresi `parsed.data.flow ? 422 : 400` (baris ~114) akan jadi
  type-error bila shell masih ada di union di titik itu. Menaruh cabang shell + `return` lebih
  dulu membuat TS **menyempitkan** shell keluar dari `parsed.data` untuk sisa handler, sehingga
  `parsed.data.flow` valid lagi. Shell membalas **400** (bukan 422) saat repoDir kosong — parity
  dengan terminal biasa non-flow.

**Frontend**
- `src/src/api/client.ts`: tambah `createShell: (project) => POST { project, shell: true }`.
- `src/src/screens/TerminalScreen.tsx`: tombol baru **"Terminal biasa"** (icon `terminal`,
  title "Buka shell tmux tanpa Claude di project terpilih") di sebelah "Sesi baru", memanggil
  `openShell()` (cermin `openNew()` tapi `api.createShell`). Perbarui hint empty-state agar
  menjelaskan dua opsi (Sesi baru = claude; Terminal biasa = shell).

**Docs (commit sama)**
- ADR-0056 baru — keputusan di atas, link di `internal/docs/README.md`.
- `internal/docs/architecture/api-contract.md` (Terminal) — dokumentasikan varian `{project, shell:true}`.
- `internal/docs/architecture/stack.md` + `internal/skills/hanoman/SKILL.md` — perjelas "plain
  terminal" = shell non-claude (bukan claude-di-repoDir).
- `internal/docs/frontend/frontend-implementation.md` (Terminal) — tombol "Terminal biasa".
- `internal/docs/architecture/data-model.md` — catatan: sesi shell **tanpa flow** (set flow tetap
  `feature|qa|scaffold|reverse|prd`).

## Testing
- `shared/test/dto.test.ts`: `{project,shell:true}` → varian shell; `{project}` tetap plain;
  `{project,flow:"reverse"}` tetap reverse (urutan union tak regresi).
- `server/test/terminal.route.test.ts`: `POST {project,shell:true}` → 201 `{id}`, sesi hidup
  ber-cwd `repoDir`, **tanpa** `flow`; pane menjalankan `shellBin` (set `HANOMAN_SHELL` ke stub),
  bukan claude. `POST {project,shell:true}` untuk project tanpa repoDir → 400 `needsBind`.
  `DELETE` sesi shell → tidak menghapus/mengganggu working tree utama.
- `src/test/terminal-screen.test.tsx`: tombol "Terminal biasa" memanggil `api.createShell` dan
  menempatkan sesi ke grid aktif.

## Non-goals (YAGNI)
- Tak menandai "kind: shell" di `SessionInfo`/`listSessions` — sesi shell & "Sesi baru" (claude)
  sama-sama tampil sebagai sesi tanpa flow; membedakan visual tak dibutuhkan objektif.
- Tak menambah pintu shell di halaman detail project (cukup di layar Terminal, sesuai objektif).
- Tak ada worktree isolasi, tak ada perubahan skema, tak menghidupkan guardrail apa pun.
