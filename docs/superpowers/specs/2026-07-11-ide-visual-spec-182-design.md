# SPEC-182 — IDE Visual (file explorer + branch switch + git graph)

**Tanggal:** 2026-07-11 · **Prioritas:** tinggi · **Sumber:** brief

## Objective

Tambahkan satu bagian **IDE Visual** ala VS Code ke dashboard hanoman:

1. **Explorer** — pohon file seluruh project (bisa difilter per-project) + pane isi file
   dengan **syntax highlighting** dan **edit + simpan**.
2. **Switch branch** — dropdown branch **local & origin**; memilih branch menjalankan
   **`git checkout` sungguhan** di `repoDir` project.
3. **Git graph** — DAG commit ala [vscode-git-graph](https://github.com/mhutchie/vscode-git-graph):
   lane berwarna, label ref, klik commit → detail + file berubah, dan **aksi interaktif**
   (checkout / merge / cherry-pick / revert / buat branch / hapus branch).

## Konteks & keputusan yang membentuk desain

Empat pilihan produk sudah dikonfirmasi dengan user (mode penuh, bukan MVP minimal):

| Aspek | Keputusan |
|---|---|
| File | **Bisa edit & simpan** (bukan read-only) |
| Branch switch | **Checkout sungguhan** (memindahkan HEAD working tree) |
| Git graph | **Interaktif** (aksi mutasi dari context-menu) |
| Highlight | **highlight.js** ditambahkan sekarang |
| Guard mutasi | **Tolak by default** (409 + pesan git), tapi ada **opsi `force`** eksplisit |

### Tegangan inti: working tree utama dipakai bersama

`repoDir` sebuah project adalah checkout yang **dibagi dengan sesi Claude Code lain** yang
mungkin sedang jalan (CLAUDE.md & AGENTS.md: "jangan jalankan run di working tree utama").
`git checkout`/`merge`/`revert` di sana bisa:

- membuang perubahan tak ter-commit milik sesi yang sedang bekerja, dan
- memindahkan HEAD di bawah kaki proses `claude` yang hidup.

Desain ini **tidak** melarang mutasi (user memintanya secara eksplisit). Ia membuatnya **aman
secara default** dan **memaksa sadar** saat di-`force`:

- **Guard sesi aktif** — setiap operasi mutasi menolak (409) bila ada sesi terminal/run
  yang terikat ke project itu. Memakai **guard yang persis sama** dengan `DELETE /projects`
  hari ini (`listSessions().filter(projectId===id && !exited)`).
- **Guard tree bersih** — git sendiri menolak checkout/merge yang menimpa perubahan lokal;
  kita meneruskan pesannya apa adanya (bukan `--force`).
- **`force: true`** — bila user memilih paksa, jalankan varian `--force` (checkout) / lewati
  guard sesi. Ini **opt-in per aksi** dengan peringatan jelas di UI, tak pernah default.

Ini butuh **ADR baru (0034)** karena secara sadar men-*sanction* mutasi working tree utama —
sesuatu yang selama ini konvensinya dihindari.

## Yang sudah ada & dipakai ulang (jangan tulis ulang)

- `server/src/services/branches.ts` — `listRepoBranches` (refs/heads) + `listRepoRemoteBranches`
  (refs/remotes/origin). **Sudah** memberi local + origin. Endpoint `GET /projects/:id/branches`
  sudah mengeksposnya; klien `api.listBranches` sudah ada.
- `server/src/services/spec-review.ts` — pola `execFile` di-`promisify` + `maxBuffer 1<<24`,
  `splitZ`, parse `--numstat`/`--name-status`, `ls-tree`, `git show <ref>:<path>`. Helper
  git graph & file-at-ref meniru pola ini.
- `server/src/services/scan.ts` — `docAbsPath()` (path-guard: resolve, cegah keluar repo,
  cegah `.git`). Digeneralisasi lepas dari kunci `.md`.
- `src/src/screens/DocsWorkspace.tsx` — layout **288px tree │ 1fr pane** + mode preview/edit +
  textarea simpan. Template langsung untuk Explorer.
- `Shell`/`HN_NAV` (`src/src/ds/shell.tsx`) — tambah satu entri nav + satu cabang `section`.
- Design system: editorial, bone paper, brass accent (`internal/docs/design-system/**`).

## Arsitektur

### Backend — `server/src/services/git-ide.ts` (baru) + `server/src/routes/ide.ts` (baru)

Semua operasi bekerja pada `project.repoDir` (bukan worktree spec). `repoDir` null / bukan repo
git → `[]`/404, tak pernah melempar (cermin `branches.ts`, `scan.ts`).

**Read (aman, tanpa mutasi):**

| Endpoint | Balasan | Catatan |
|---|---|---|
| `GET /projects/:id/tree?ref=` | `{ ref, files: string[] }` | `ref` kosong = working tree (`ls-files` cached∪others, honor .gitignore); `ref` isi = `ls-tree -r --name-only <ref>` |
| `GET /projects/:id/file?path=&ref=` | `{ path, content, binary, truncated }` | path lewat guard; `ref` kosong = baca disk, isi = `git show <ref>:<path>`; binary → `content:null` |
| `GET /projects/:id/graph?limit=200` | `{ commits: Commit[], head, current }` | `git log --all --date-order`, `%H %P %an %aI %s` + `%D` (refs). `current` = branch HEAD saat ini |
| `GET /projects/:id/commit/:sha` | `{ sha, parents, author, at, subject, body, changed: ChangedFile[] }` | detail + `diff --numstat` `sha^..sha` |

`Commit = { sha, parents: string[], author, at, subject, refs: string[] }`.
`ChangedFile` dipakai ulang dari `spec-review.ts` (`{path,add,del,status,binary}`).

**Write (mutasi — bergerbang):**

| Endpoint | Body | Op git |
|---|---|---|
| `PUT /projects/:id/file` | `{ path, content }` | tulis disk lewat path-guard |
| `POST /projects/:id/git` | `{ op, ...args, force? }` | lihat tabel op |

`POST /projects/:id/git` ops:

| `op` | args | perintah |
|---|---|---|
| `checkout` | `{ ref }` | `git checkout <ref>` (+ `-f` bila `force`) |
| `branch` | `{ name, at? }` | `git branch <name> [<at>]` lalu opsional checkout |
| `merge` | `{ ref }` | `git merge --no-edit <ref>` |
| `cherry-pick` | `{ sha }` | `git cherry-pick <sha>` |
| `revert` | `{ sha }` | `git revert --no-edit <sha>` |
| `delete-branch` | `{ name }` | `git branch -d <name>` (+ `-D` bila `force`) |

**Gerbang mutasi** (berlaku untuk `checkout` dan seluruh `POST /git`; **`PUT /file` TIDAK**
digerbang — menulis file bukan operasi git dan tak memindahkan HEAD):

1. Project tak ada → **404**.
2. `repoDir` null / bukan repo → **400**.
3. **Sesi aktif** terikat project & `force !== true` → **409** `{ error: "project punya N sesi
   aktif; commit/stash atau paksa" }`. Guard identik `DELETE /projects`.
4. Jalankan git. **Exit ≠ 0** → **409** dengan **stderr git apa adanya** (mis. "Your local
   changes would be overwritten", "branch is checked out at …", konflik merge/cherry-pick).
5. Sukses → **200** `{ ok: true, stdout, current }` (`current` = branch HEAD setelah op).

`force: true` melewati guard #3 dan menambah `-f`/`-D` pada perintah yang mendukungnya. Konflik
merge/cherry-pick/revert **tidak** di-`force` — mereka mengembalikan 409 dengan pesan konflik
dan meninggalkan tree di keadaan konflik (user menyelesaikannya lewat Terminal, konsisten dengan
cara `POST /specs/:id/integrate` menyerahkan konflik ke sesi).

### Frontend — `src/src/screens/IdeScreen.tsx` (baru)

Satu screen, dua tab berbagi toolbar (project `Select` + branch switcher):

- **Toolbar**: `Select` project (kalau dibuka global) · `Select` branch (local grup + origin grup,
  dari `api.listBranches`) · tombol **Checkout** · badge branch aktif.
- **Tab Explorer**: grid `288px 1fr`.
  - Kiri: pohon file dari `GET /tree`. Bangun-pohon meniru `buildTree`/`collapse`/`DocTreeCat`
    dari `DocsWorkspace` (digeneralisasi ke semua ekstensi, ikon per-tipe seadanya).
  - Kanan: pane isi file. **Preview** = `<pre>` ber-highlight (highlight.js, bahasa dari ekstensi).
    **Edit** = `<textarea>` mono + tombol Simpan → `PUT /file` (cermin mode edit `DocsWorkspace`).
    Binary → placeholder "file biner".
- **Tab Git Graph**: SVG inline.
  - Lane dihitung **client-side** dari `parents` (algoritma lane klasik: telusuri commit
    terurut topo, tiap commit menempati lane parent pertamanya, cabang buka lane baru). ~120 baris,
    **nol dependency graph**.
  - Baris commit: bulatan berwarna lane · garis edge ke parent · label ref (chip brass) · subject ·
    author · tanggal relatif.
  - **Klik** commit → panel detail (`GET /commit/:sha`): pesan penuh + daftar file berubah
    (klik file → buka di Explorer pada ref itu).
  - **Klik-kanan** commit → context-menu: Checkout · Merge ke branch ini · Cherry-pick · Revert ·
    Buat branch di sini… · (pada ref branch) Hapus branch. Tiap aksi → `POST /git`.
  - **Dialog force**: bila `POST /git` balas 409 karena sesi/tree, tampilkan pesan git + tombol
    **"Paksa"** yang mengulang request dengan `force:true`. Teks peringatan: "Bisa membuang
    perubahan tak ter-commit & mengganggu sesi Claude yang jalan."

Nav: tambah `{ key:"ide", label:"IDE", icon:"code-2" }` ke `HN_NAV`, dan cabang `section==="ide"`
di `App.tsx` (bungkus `Shell active="ide"` + `Select` project di `actions`, cermin bagian `docs`).

### Dependency baru

- `highlight.js` (frontend) — satu-satunya dep baru. Render read-view berwarna. Editor tetap
  textarea polos (highlight-saat-ketik butuh overlay; di luar scope, editing sungguhan lewat Claude).

### Data flow

```
IdeScreen ─ GET /tree?ref ──────────► git ls-files / ls-tree
          ─ GET /file?path&ref ─────► disk read / git show
          ─ PUT /file ──────────────► tulis disk (path-guard, TAK digerbang sesi)
          ─ GET /branches ──────────► listRepoBranches + listRepoRemoteBranches (sudah ada)
          ─ GET /graph ─────────────► git log --all  → lane dihitung di klien
          ─ GET /commit/:sha ───────► git show --numstat
          ─ POST /git {op,force} ───► [guard sesi] → git checkout/merge/… → 200 | 409+stderr
```

## Error handling

- Read: repoDir null / bukan git → hasil kosong, bukan 500 (cermin `scanRepoDocs`).
- Path guard: reuse `docAbsPath` yang digeneralisasi — tolak keluar-repo & `.git` → 400.
- Mutasi: guard sesi (409) → git exec → non-zero diteruskan sebagai 409 + stderr. Tak ada 500
  untuk kegagalan git yang diharapkan.
- `force` tak pernah default; hanya saat body `{force:true}`.
- Konflik merge/cherry-pick/revert: 409 + pesan; tree ditinggal konflik untuk diselesaikan di Terminal.

## Testing

Server (vitest, repo git sementara via `mkdtemp` + `git init`, cermin gaya test spec-review):

- `GET /tree` working-tree vs `?ref=<branch>` beda isi; repoDir null → `{files:[]}`.
- `GET /file` disk vs `git show`; path keluar-repo → 400; `.git/...` → 400; binary → `content:null`.
- `GET /graph` — DAG dengan merge menghasilkan `parents.length===2`; refs terisi; `current` benar.
- `PUT /file` menulis & bisa dibaca balik; **tidak** digerbang sesi aktif.
- `POST /git checkout` memindah HEAD; **dengan sesi aktif → 409**; `force:true` → 200.
- `POST /git merge` konflik → 409 + stderr berisi "conflict"; sukses → 200.
- Path-guard unit: reuse test `docAbsPath` yang diperluas.

Frontend (vitest + testing-library):

- Lane builder: fungsi murni `computeLanes(commits)` → snapshot lane index untuk graf linear,
  bercabang, dan merge. **Ini logika non-trivial → wajib ada test.**
- IdeScreen render tree dari fetch mock; klik file memuat isi; toolbar checkout memanggil `POST /git`;
  409 memunculkan dialog "Paksa".

## Dokumen SoT yang disentuh (commit yang sama)

- **`internal/docs/adr/0034-ide-mutasi-working-tree-utama.md`** (baru) — men-*sanction* mutasi
  working tree `repoDir` dari IDE, digerbang sesi-aktif + tree-bersih, dengan escape `force`.
- **`internal/docs/architecture/api-contract.md`** — endpoint `tree`/`file`/`graph`/`commit`/`git`.
- **`internal/docs/frontend/frontend-implementation.md`** — screen IDE (Explorer + Git Graph).
- **`internal/docs/README.md`** — link ADR-0034 di index.
- **Tanpa migration** — tak ada perubahan skema Prisma. `repoDir` sudah ada di `Project`.

## Sengaja dilewati (YAGNI — tambah saat perlu)

- Highlight-saat-mengetik di editor (overlay); read-view berhighlight cukup.
- Full-text search / grep lintas file, buka banyak tab, drag-drop, rename/hapus file dari UI.
- Aksi graf di luar enam op (rebase-interaktif, stash, tag, push/pull) — Terminal menutupinya.
- Rename/copy detection di diff (`--no-renames`, ikut spec-review).
- Cache graph/tree — full re-scan tiap request (cermin `scanRepoDocs`); tambah bila > ~200ms.
