# SPEC-193 — Merge optional fast-forward

## Objective
Merge dari **Terminal / IDE git graph** boleh memilih perilaku fast-forward-nya. Sekarang
klik-kanan commit → "Merge ke branch ini" selalu memakai default git (fast-forward bila bisa,
else merge commit) tanpa pilihan. User minta fast-forward-nya **optional dan ada pilihannya**.

Prioritas: tinggi. Sumber: qa. Severity: major.

## Konteks / akar masalah
Menu graf (`src/src/screens/GitGraph.tsx:139`) mengirim satu op `{ op: "merge", ref }` ke
`POST /projects/:id/git`. `gitArgs()` (`server/src/services/git-ide.ts:160`) meng-hardcode
`["merge", "--no-edit", op.ref]`. Karena tak ada flag ff, git memakai default-nya: fast-forward
kalau branch bisa di-ff, kalau tidak baru buat merge commit. Tak ada jalan untuk:

- **memaksa merge commit** meski bisa ff (`--no-ff`), atau
- **menuntut fast-forward saja** dan gagal kalau tak bisa (`--ff-only`).

Tipe `GitOp` varian merge (`git-ide.ts:133`, `src/src/api/client.ts:27`) hanya membawa `ref`, jadi
tak ada parameter untuk dilewatkan end-to-end.

## Keputusan
Tambah field opsional `ff` ke op merge, dialirkan menu → client → route → `gitArgs`:

```
{ op: "merge"; ref: string; ff?: "no-ff" | "ff-only" }
```

Pemetaan di `gitArgs`:

| `ff`        | perintah git                          | arti                                      |
|-------------|---------------------------------------|-------------------------------------------|
| _absen_     | `git merge --no-edit <ref>`           | **default git** — ff bila bisa (tak berubah) |
| `"no-ff"`   | `git merge --no-edit --no-ff <ref>`   | selalu buat merge commit                  |
| `"ff-only"` | `git merge --no-edit --ff-only <ref>` | ff saja; gagal (409) bila tak bisa di-ff  |

`ff` absen = perilaku sekarang → **backward compatible**, tak ada caller/test lama yang berubah.

Menu graf mengganti satu item "Merge ke branch ini" jadi tiga pilihan eksplisit:

- **Merge (fast-forward bila bisa)** → `{ op:"merge", ref }`
- **Merge tanpa fast-forward** → `{ op:"merge", ref, ff:"no-ff" }`
- **Merge fast-forward saja** → `{ op:"merge", ref, ff:"ff-only" }`

## Perubahan
1. **`server/src/services/git-ide.ts`** — tipe `GitOp` merge + `ff`; `gitArgs` menyisipkan
   `--no-ff`/`--ff-only`; `validateGitOp` menolak `ff` selain kedua nilai itu (kalau ada).
2. **`src/src/api/client.ts`** — tipe `GitOp` merge + `ff` (cermin server).
3. **`src/src/screens/GitGraph.tsx`** — tiga item menu.
4. **`internal/docs/architecture/api-contract.md`** — dokumentasikan opsi `ff` di `POST
   /projects/:id/git`.

## Tambahan: merge lalu hapus branch (local + origin)
Aksi menu terpisah **"Merge `<b>` lalu hapus (local + origin)"** untuk tiap branch lokal di commit
yang bukan branch aktif. Op merge menerima field opsional `deleteBranch`:

```
{ op: "merge"; ref: string; ff?: ...; deleteBranch?: string }
```

Setelah merge **sukses**, `runGitOp` menghapus `deleteBranch`:
1. lokal — `git branch -D <b>` (aman: branch baru saja ter-merge),
2. origin — `git push origin --delete <b>` **hanya** bila `refs/remotes/origin/<b>` ada.

Gagal di salah satu langkah → `ok:false` (route 409), tapi merge-nya sudah terjadi; graph reload
menunjukkan keadaan sebenarnya. Merge yang gagal (mis. konflik) **tak** menghapus apa pun.

Keputusan sadar:
- **Aksi eksplisit, bukan otomatis di tiap merge** — menghapus branch origin itu destruktif &
  outward-facing; tak boleh jadi efek samping diam-diam dari merge biasa.
- **Satu request** (bukan chain client) → gerbang sesi/`force` sekali, tak ada state setengah jadi.
- Label menu menampilkan "+ origin" hanya bila `origin/<b>` memang ada.
- Ini satu-satunya mutasi IDE yang menyentuh remote — dicatat di ADR-0034 (tanpa ADR baru: tak ada
  skema/konvensi baru, digerbang sama).

## Yang TIDAK berubah
- Route `POST /projects/:id/git` melewatkan op apa adanya — nol perubahan handler.
- Gerbang sesi-aktif + `force` (ADR-0034) tetap; `ff` ortogonal terhadap `force`.
- `POST /specs/:id/integrate` (rebase/merge backlog, SPEC-175) — jalur berbeda, di luar scope.
- Skema Prisma, migration, DTO shared. Nol.

## Di luar scope (YAGNI)
- **Merge `--squash`, custom message, strategy option.** Tak diminta; tambah bila kelak perlu.
- **Submenu bersarang di komponen `Menu`.** Tiga item datar cukup; komponen `Menu` flat, tak
  perlu dukungan submenu.

## Konsekuensi
- User punya kontrol penuh atas fast-forward di merge Terminal, tanpa ADR/skema baru
  (field additif ke kontrak yang sudah ada, digerbang sama seperti op merge lama).
