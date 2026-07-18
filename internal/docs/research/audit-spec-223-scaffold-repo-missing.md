# Audit SPEC-223 — Scaffold project baru gagal (repo hilang + prompt kepanjangan) di disk

Status: audit · SPEC-223 · sumber qa · prioritas tinggi · severity critical · 2026-07-18
Metode: `superpowers:systematic-debugging` (root cause dulu, baru fix).

## Keluhan (verbatim)
> `POST http://127.0.0.1:8788/api/terminal/sessions`
> `{ "error": "gagal membuat worktree: git rev-parse --verify --end-of-options HEAD^{commit} failed: spawnSync git ENOENT" }`
>
> Expected: "kan namanya project baru ya pasti kosongan, pastikan ketika project baru dan
> saya mau buat scaffold dari ide jangan sampai gagal."

## Temuan inti (root cause)
Pesan `spawnSync git ENOENT` **bukan** "biner git tak ada" — `git` ada di `/usr/bin/git`
(v2.50.1) dan berjalan normal. Di Node, `spawnSync` melempar `ENOENT` dengan pesan
`spawnSync <cmd> ENOENT` **juga ketika opsi `cwd` menunjuk direktori yang tidak eksis**.
Dibuktikan (probe):

| cwd | status | error |
|---|---|---|
| direktori hilang | `null` | `spawnSync git ENOENT` ← **persis keluhan** |
| dir ada, bukan repo git | `128` | `fatal: not a git repository …` |

Jadi akar masalahnya: **pada saat scaffold, `repoDir` efektif project itu tidak ada di disk.**

`git()` di `runner/src/git.ts:5` menyalin `r.error?.message` ke pesan lempar; `resolveCommit`
(`git.ts:18`) memanggilnya dengan `cwd: repo`. Cabang route `flow:scaffold`
(`server/src/routes/terminal.ts:142-162`) memanggil `realGit.addWorktree(repoDir, …)`
→ `resolveCommit(repoDir, "HEAD")` → ENOENT bila `repoDir` tidak ada.

### Kenapa repo bisa tidak ada padahal "project baru"?
ADR-0052 memutuskan `git init` dilakukan **saat create** (`POST /projects`,
`routes/projects.ts:44` → `realGit.initRepo`) dan **sengaja bukan lazy saat scaffold**
("git-init saat create (bukan lazy saat scaffold)", ADR-0052 §Rationale). Konsekuensinya
cabang scaffold **tak punya jaring pengaman**: ia mengandalkan sepenuhnya bahwa init-saat-create
sudah jalan. Repo bisa absen saat scaffold pada banyak kondisi nyata:

- Project di-**sync dari device lain** (hub/teammate) — `Project.repoDir` = path mesin lain, tak
  ada di mesin ini (memory: "repoDir/keyPath are local mac paths → NULL/re-set on VPS").
- Folder di-**pindah/hapus** setelah create.
- Project **dibuat oleh server versi lama** (pra-SPEC-222) yang belum punya `initRepo`, atau saat
  create-time init gagal diam-diam.
- **Retry scaffold** pada project yang `repoDir`-nya belum benar-benar disiapkan.

Pada semua kondisi ini, scaffold mati dengan `ENOENT` yang opaque — bertentangan dengan
harapan user bahwa "project baru pasti kosongan, scaffold dari ide jangan sampai gagal".

## Reproduksi
Probe (`node`, tanpa server/DB): meniru `initRepo` + `addWorktree` dari `runner/src/git.ts`.
- **A** — dir baru → `initRepo` → `addWorktree("HEAD")`: **OK** (base commit ter-resolve).
- **B** — `addWorktree("HEAD")` pada `repoDir` yang **tak pernah dibuat**: **GAGAL** dengan
  `git rev-parse --verify --end-of-options HEAD^{commit} failed: spawnSync git ENOENT`
  — identik dengan keluhan.

## Keputusan pasca-audit
Temuan **berconfidence tinggi**, akar masalah **jelas**, perbaikan **diff kecil & terlokalisasi**:
cabang `flow:scaffold` cukup memanggil `realGit.initRepo(repoDir)` (idempoten) **sebelum**
`addWorktree`, di dalam `try/catch` yang sudah ada. Karena itu **Spec & Plan di-`skipped`**
(ADR-0020/0040) dan langsung Execute; dokumen ini jadi doc-of-record perbaikannya.

Tidak ada perubahan kontrak API (endpoint/format sama; kini sukses di tempat yang dulu 422/500),
tidak ada perubahan data-model, tidak ada migration. Bukan titik keputusan manusia.

## Perbaikan
Ubah cabang scaffold agar **memiliki lifecycle repo kosong** — bukan mengasumsikannya:

```
if (parsed.data.flow === "scaffold") {
  …
  try {
    realGit.initRepo(repoDir);   // ← jaring pengaman: dir hilang / bukan repo / tanpa HEAD → siap
    realGit.addWorktree(repoDir, `${repoDir}/.worktrees/${id}`, "HEAD");
  } catch (e) { return reply.code(422)… }
}
```

`initRepo` (`runner/src/git.ts:53`) sudah idempoten: `mkdirSync -r` (dir hilang) → `git init`
(bukan repo) → commit `--allow-empty` (tanpa HEAD); repo yang sudah punya commit dibiarkan.
Init-saat-create tetap dipertahankan sebagai jalur cepat; scaffold kini **tak lagi bergantung**
padanya. Cabang `reverse`/`prd` **tidak** disentuh — keduanya beroperasi pada repo existing dan
auto-init di sana justru menutupi kesalahan path.

## Temuan #2 — `tmux set-option gagal: command too long` (severity critical)
Setelah repo di-init, scaffold lolos worktree tapi **mati di pembuatan sesi**:
```
POST /api/terminal/sessions → 500 { "message": "tmux set-option gagal: command too long" }
```

### Root cause
`createSession` (`server/src/services/pty.ts`) merangkai SATU invokasi tmux gabungan: 6
`set-option -g` + `new-session -d -s <name> -c <cwd> <cmd>` + 2 `set-option`, di mana `<cmd>`
memuat **seluruh argv claude — termasuk prompt awal**. tmux menyatukan argv jadi satu command
dan membatasi panjangnya. Ambang terukur (probe): **command ≤16KB OK, ≥20KB → `command too
long`** (status 1). Pesan menyebut `set-option` semata karena itu args[0] invokasi gabungan
(`tmux ${args[0]} gagal` di `pty.ts:69`).

Prompt scaffold/reverse memuat STANDAR DOCS (`REVERSE_STANDARD`, ~7KB) — dengan ide singkat
prompt ≈7KB (aman), tetapi **ide/objective panjang mendorongnya menembus ~16KB**. Diukur:
`startScaffoldPrompt` = 6997B (ide pendek); dengan ide ~50KB → prompt ~58KB ≫ ambang.

### Reproduksi
Test unit `pty.test.ts` "prompt sangat besar…" (prompt 60KB) → `createSession` melempar
`tmux set-option gagal: command too long` (persis keluhan). Setelah fix → tak melempar +
prompt penuh tertulis di berkas.

### Perbaikan
Prompt tak lagi inline di command tmux. Ditulis ke berkas (`promptFilePath(id)` di tmpdir) dan
diserahkan lewat `"$(cat <file>)"`; `sh -c` yang menjalankan sesi meng-expand-nya saat lahir —
command tmux tetap pendek, claude menerima prompt penuh via ARG_MAX (≫16KB). Berlaku untuk
SEMUA flow ber-prompt (spec/reverse/prd/scaffold/vps). `opts.command` (VPS console) tak
tersentuh. tmpdir (bukan turunan `cwd`) karena sesi VPS ber-`cwd` = homedir yang parent-nya tak
writable. Detail di ADR-0016 (Konsekuensi). Isi berkas aman dari injeksi (command-substitution
dikutip ganda, tak dipindai ulang).

## Referensi
- [ADR-0052 — Scaffold flow: project from-scratch dari ide → SoT penuh](../adr/0052-scaffold-flow-from-ide.md)
- [ADR-0016 — Sesi terminal hidup di tmux](../adr/0016-sesi-terminal-hidup-di-tmux.md) (Konsekuensi: prompt lewat berkas)
- `server/src/routes/terminal.ts:142-162` (cabang scaffold) · `runner/src/git.ts:18,26,53`
  (`resolveCommit`/`addWorktree`/`initRepo`) · `server/src/services/pty.ts` (`createSession`,
  `promptFilePath`)
