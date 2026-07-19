# Audit SPEC-229 — Merge via git graph selalu gagal (buntu tanpa sesi claude)

Status: audit · SPEC-229 · sumber qa · prioritas tinggi · severity major · 2026-07-19
Metode: `superpowers:systematic-debugging` (root cause dulu, baru fix).

## Keluhan (verbatim)
> Judul: **Merge selalu gagal**
> Objective: saat ini merge dari branch origin selalu gagal.
> Expected: *"lakukan merge via git graph jika ada issue atau 409 maka buka session claude
> untuk memperbaiki, prioritas tetap deterministic. harus bisa merge local branch dan remote branch"*.

## Dua jalur "merge" yang ada hari ini
1. **Integrate backlog (ADR-0031, `POST /specs/:id/integrate`)** — merge/rebase branch sebuah
   backlog item `done` ke target `local:<b>`/`origin:<b>`, di **worktree isolasi**
   `.worktrees/merge-<id>`. **Deterministik dulu, konflik → spawn sesi claude** di worktree itu.
   Sudah persis pola yang diminta keluhan — tapi dipicu dari Backlog/Terminal, **bukan git graph**,
   dan source-nya terkunci ke branch spec.
2. **Git graph IDE (SPEC-182, `POST /projects/:id/git`, `runGitOp`)** — `git merge` sembarang
   commit/branch ke **HEAD working tree utama**. Inilah "merge via git graph" yang dimaksud keluhan.
   Jalur inilah yang buntu.

## Temuan inti (root cause)
Jalur git graph **tak pernah mewarisi pelajaran ADR-0031**: tak ada fallback sesi claude, dan
kegagalannya merusak working tree utama alih-alih mengisolasinya. Dua mode gagal, keduanya
reproducible, keduanya berujung buntu:

### Mode A — konflik meninggalkan working tree utama rusak, "Force" gagal senyap
`runGitOp` (`server/src/services/git-ide.ts:213`) menjalankan `git merge --no-edit
--end-of-options <ref>` di `repoDir` (**working tree utama**, diizinkan ADR-0034). Bila konflik:
1. Working tree utama ditinggal **mid-merge** — `UU <file>`, `.git/MERGE_HEAD` ada.
2. `runGitOp` → `{ ok:false, stderr }` → route (`server/src/routes/ide.ts:76`) balas **409**.
3. Frontend `runGit` (`src/src/screens/IdeScreen.tsx:76`) menangkap 409 → buka **ForceDialog**.
4. Operator klik Force → `confirmForce` (`IdeScreen.tsx:87`) menjalankan **merge yang sama** dengan
   `force:true`. Tapi `force` hanya melewati gerbang sesi; `gitArgs` **tak** menambah apa pun untuk
   merge — git menolak: *"Merging is not possible because you have unmerged files"* → `ok:false` →
   409 → **`confirmForce` menelannya diam-diam** (`.catch(() => {})`, `IdeScreen.tsx:91`).
5. Operator tak melihat apa-apa. "Merge gagal" — dan working tree utama **rusak mid-merge tanpa
   jalan keluar dari UI**. Tak ada sesi claude untuk membereskan (padahal itu yang diminta).

### Mode B — gerbang sesi aktif: 409 di setiap merge
Route menggerbangi mutasi git: `if (!op.force) { const n = activeSessions(id); if (n) return 409 }`
(`ide.ts:71-74`, diuji di `ide.route.test.ts:58`). Dalam pemakaian nyata hanoman operator hampir
selalu punya sesi terminal aktif untuk project yang sedang dilihat → **setiap** merge balas 409.
Satu-satunya jalan keluar (Force) berujung buntu Mode A begitu ada konflik. Inilah "409" yang
disebut eksplisit di keluhan.

### Mengapa "dari branch origin"
Git graph tak punya afordans kelas-satu untuk "merge branch origin": menu `menuItems`
(`GitGraph.tsx:61`) hanya menawarkan "Merge `<branch>` lalu hapus" untuk **branch lokal**
(`locals.filter`). Branch origin cuma bisa di-merge lewat "Merge (fast-forward bila bisa)" yang
memakai `c.sha` ke working tree utama — lalu kena Mode A/B yang sama. Merge origin yang divergen
hampir selalu bikin merge-commit/konflik → buntu.

## Reproduksi (git murni, tanpa server/DB)
Origin + working repo, main maju, `origin/feature` divergen menyentuh file sama:
```
git merge --no-edit --end-of-options <origin/feature-sha>
  → CONFLICT (content) in shared.txt; exit 1
  → git status: "UU shared.txt"; .git/MERGE_HEAD ADA        ← working tree utama rusak mid-merge
git merge --no-edit --end-of-options <sha>   (ulang = "Force")
  → "error: Merging is not possible because you have unmerged files"  ← Force tak menolong
```
Kasus bersih (main clean, origin non-konflik) `exit 0` — jadi ini **bukan** bug git murni; buntunya
ada di penanganan konflik/409 + tiadanya fallback sesi claude di jalur git graph.

## Root cause (satu kalimat)
Merge git graph berhenti deterministik-saja: **tak ada fallback sesi claude untuk konflik/409**
(yang sudah dimiliki integrate ADR-0031), dan konfliknya **merusak working tree utama** alih-alih
mengisolasi di worktree — sehingga "issue atau 409" selalu jadi buntu.

## Keputusan pasca-audit — Spec → Plan → Execute penuh (BUKAN fast-track)
Temuan **berconfidence tinggi & reproducible**, tapi perbaikannya **luas & mengubah bentuk kerja**,
jadi Spec & Plan **tidak** di-skip:
- Kapabilitas baru: memicu **sesi claude dari git graph** saat merge bermasalah — sebelumnya git
  graph tak pernah spawn sesi.
- Kontrak API berubah: `POST /projects/:id/git` (atau endpoint baru) harus bisa membalas
  `{ status:"conflict", sessionId }` layaknya integrate, bukan sekadar 409.
- Menyentuh prinsip arsitektur: konflik **tak boleh** dibereskan di working tree utama (ADR-0002);
  harus isolasi worktree + sesi claude (pola ADR-0031). Kemungkinan butuh **ADR baru** yang
  menautkan git graph ke mesin integrate.

Karena percabangan ini mengubah kontrak API & scope, **titik keputusan manusia** (pendekatan) diangkat
ke operator sebelum menulis spec. Operator memilih **"selalu via worktree isolasi"** (pola integrate
ADR-0031): merge git graph selalu jalan di `.worktrees/merge-*`, bersih → ff branch current di working
tree utama, konflik/error → spawn sesi claude di worktree itu. Working tree utama tak pernah rusak.
Keputusan direkam di [ADR-0053](../adr/0053-git-graph-merge-worktree-isolasi-sesi-claude.md); rencana
implementasi di `docs/superpowers/plans/2026-07-19-merge-git-graph-worktree-isolasi-spec-229.md`.

## Referensi
- `server/src/services/git-ide.ts:213` (`runGitOp`, `gitArgs` — merge di working tree utama)
- `server/src/routes/ide.ts:63-77` (gerbang sesi + 409, tanpa fallback sesi)
- `src/src/screens/IdeScreen.tsx:76-92` (`runGit`/`confirmForce` — Force menelan error senyap)
- `src/src/screens/GitGraph.tsx:61-88` (`menuItems` — origin tak punya afordans merge kelas-satu)
- `server/src/services/integrate.ts` + [ADR-0031](../adr/0031-rebase-merge-backlog.md) — pola target:
  deterministik dulu, konflik → sesi claude di worktree isolasi (yang harus ditiru)
- [ADR-0002 — isolasi worktree](../adr/0002-git-worktree-isolation.md) · [ADR-0034 — IDE boleh mutasi working tree](../adr/0034-ide-mutasi-working-tree-utama.md)
