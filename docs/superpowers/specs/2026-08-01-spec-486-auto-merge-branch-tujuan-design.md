# SPEC-486 — Auto-merge ke branch tujuan saat sesi selesai

**Tanggal:** 2026-08-01 · **Sumber:** brief · **Prioritas:** sedang
**ADR yang lahir:** ADR-0103 (memperluas ADR-0031, menegakkan ADR-0002/0030/0033)

## Masalah

Backlog item yang selesai berhenti di branch kerja `hanoman/<spec>`. Penggabungan ke branch utama
selalu manual — lewat dialog Rebase/Merge di dashboard (ADR-0031) atau di luar hanoman. Tidak ada
tempat di Settings project untuk menyatakan "kalau selesai, langsung gabungkan ke sana", dan
tidak ada satu pun jalur otomatis yang melakukannya.

`integrate()` (ADR-0031) sudah punya seluruh mesin yang dibutuhkan: merge deterministik di worktree
isolasi `.worktrees/merge-<id>`, target lokal (`local:<b>`, `git branch -f` / fast-forward di
worktree pemiliknya) atau origin (`origin:<b>`, `git push`), tanpa pernah menyentuh working tree
utama. Yang tak ada hanyalah **kebijakan** (kapan & ke mana) dan **pemicunya**.

## Objective

Setting baru level project (default bisa dioverride per-spec) yang mengatur apa yang terjadi
sesudah sesi selesai:

1. auto-merge ke **default branch repo**,
2. auto-merge ke **branch tujuan tertentu** dari daftar branch yang ada di repo,
3. **tanpa auto-merge** (perilaku sekarang, default).

Tampil di Settings project, tersimpan lewat API, dieksekusi orchestrator saat spec mencapai
`stage = done`. Merge gagal (konflik) tidak boleh senyap: ada notifikasi berisi alasan dan branch
kerja tetap utuh.

## Batasan yang mengikat

- **Default = tanpa auto-merge.** Project lama tak berubah perilaku, dan menyalakan setting
  tidak boleh menyeret backlog yang sudah lama `done` ikut ter-merge.
- **Tanpa force-push.** Operasi terkunci ke `merge`; `rebase` (yang selalu force-push branch
  sumber, ADR-0031) tak pernah dipilih auto-merge.
- **Branch kerja tak dihapus sebelum merge sukses.** Penghapusan sesudah merge bersih adalah knob
  terpisah yang default mati (keputusan operator, dikonfirmasi saat brainstorm).
- Project tanpa repoDir efektif (binding lokal ?? `Project.repoDir`) → opsi auto-merge tak bisa
  dinyalakan; UI menonaktifkannya dengan penjelasan, server menolak dengan 409.

## Keputusan operator (brainstorm)

1. **Tujuan merge:** operator memilih lokal atau origin. Setting menyimpan target dalam bentuk
   yang persis sama dengan kontrak `POST /specs/:id/integrate` (`local:<b>` / `origin:<b>`) —
   satu kosakata untuk dua permukaan, dan dropdown branch memakai `GET /projects/:id/branches`
   yang sudah memasok keduanya.
2. **Branch kerja sesudah merge sukses:** ada knob. `deleteBranch` (default `false`) menghapus
   `hanoman/<spec>` lokal + origin **hanya** sesudah merge terbukti bersih.

## Bentuk data

Satu blok kebijakan, dua tempat, satu skema.

```ts
// shared/src/auto-merge.ts
zAutoMerge = {
  mode: "off" | "default-branch" | "branch",   // default "off"
  dest: "local" | "origin",                    // default "local"
  branch: string | null,                       // wajib & hanya dipakai saat mode = "branch"
  deleteBranch: boolean,                       // default false
}
```

- `Project.autoMerge Json?` — `null` = `off` (project lama, nol backfill).
- `Spec.autoMerge Json?` — `null` = **warisi project**. Override per-spec, termasuk untuk
  mematikan auto-merge di satu item saja (`{mode:"off"}`).

**Kenapa `Json?`, bukan empat kolom skalar:** ini blok kebijakan opt-in yang dibaca sebagai satu
kesatuan dan tak pernah difilter/di-`orderBy`. Preseden langsungnya `Setting.conflict` (ADR-0081)
dan `Spec.dependsOn` (ADR-0093). Satu migration, satu skema zod, satu resolver — bukan empat kolom
yang bisa saling tak konsisten (`mode:"off"` dengan `branch` terisi).

**LOCAL-only, tidak disync.** Tidak masuk `FIELDS.project` maupun `FIELDS.spec`, mengikuti
`repoDir` / `schedulerOptIn` / `leadOptIn`: nama branch tujuan adalah properti checkout di mesin
ini, dan mesin yang menjalankan sesi adalah mesin yang mendaratkan hasilnya. Kolom nullable tanpa
default → spec asal-hub mendarat sebagai `null` = warisi project, bukan default palsu (jebakan
ADR-0090 tak berlaku di sini justru karena nullable). Keduanya **masuk** allowlist
`WEBHOOK_ENTITIES` (bukan data sensitif, dan perubahan kebijakan layak terlihat penerima webhook).

### Resolver

```ts
// shared/src/auto-merge.ts — murni, tanpa I/O
resolveAutoMerge(projectPolicy, specPolicy): AutoMerge   // spec menang bila ada, else project, else OFF
```

Menggabungkan dua sumber di satu fungsi murni yang dipakai server **dan** UI (badge "warisan
project" vs "override item ini"), jadi tak ada dua definisi "yang berlaku".

## Titik eksekusi: sweep, bukan call site

`stage = done` dipersist di **tiga** jalur (`live-specs.ts`, `scheduler/reconcile.ts`,
`DELETE /terminal/sessions/:id` → `advanceStage`). Menempelkan efek samping auto-merge di
ketiganya adalah kelas bug yang sudah digigit repo ini empat kali (SPEC-431/448/475/481) — efek
samping tak punya tipe yang memaksanya konsisten.

Lebih dari itu, ketiganya **tak satu pun aman sebagai pemicu**: prompt sesi menyuruh agen menulis
baris fase terakhir **lebih dulu**, baru `commit` + `git push`. `liveSpecs` bisa memindahkan stage
ke `done` beberapa detik sebelum `hanoman/<spec>` ada di origin — auto-merge di sana akan
menggabungkan tip yang basi atau gagal "branch belum ada".

**Keputusan: satu sweep periodik, nol call site** (pola tap webhook ADR-0100, worker antrean
ADR-0072/0096). `services/auto-merge.ts` → `sweepAutoMerge()`, di-`setInterval` dari `server.ts`
saja (`app.ts` bebas-timer).

### Gerbang kandidat

`t0` = `Notification(key = "done:<specId>").createdAt` — baris itu ditulis `recordCompletion` tepat
pada transisi ke `done` di **ketiga** jalur, jadi ia adalah satu-satunya stempel "kapan item ini
selesai" yang sudah ada dan konsisten. Tidak ada tabel baru.

Sebuah spec adalah kandidat bila **semua** benar:

1. kebijakan efektifnya `mode ≠ "off"`,
2. `stage = "done"`,
3. `t0` ada dan `now − t0 ≤ AUTO_MERGE_WINDOW` (24 jam) — **inilah pagar yang mencegah
   menyalakan setting menggabungkan seluruh sejarah project**,
4. belum ada `Notification(key = "automerge:<specId>")` — penanda idempotensi durable, selamat
   dari restart (pola `recordCompletion`, dan ADR-0091 sudah menetapkan idempotensi lead lewat
   jejak DB, bukan `Set` in-memory).

Sweep keluar lebih awal (nol query berat) bila tak ada satu pun project berkebijakan aktif —
cermin gerbang `webhooksActive()`.

### Kesiapan branch

Kandidat belum tentu siap. Sumber = `hanoman/<spec>` (resolve `origin/…` → lokal, persis
`resolveSource` yang sudah ada). Siap bila:

- ref sumber ada, **dan**
- `Spec.headSha` null **atau** `headSha` sudah menjadi leluhur tip sumber
  (`git merge-base --is-ancestor`) — bukti push sudah mendarat.

Belum siap:

- `now − t0 ≤ AUTO_MERGE_GRACE` (15 menit) → lewati, coba lagi tick berikutnya. Tak ada notifikasi,
  tak ada penanda.
- lewat grace → **menyerah dengan suara**: notifikasi `automerge:<specId>` berisi alasan
  ("branch kerja belum ada di origin"), penanda tertulis, tak dicoba lagi.

### Eksekusi

`integrate(repoDir, specId, "merge", target)` — jalur yang sudah teruji, tanpa perubahan.
Hasilnya:

- **`clean`** → bila `deleteBranch`, hapus `hanoman/<spec>` (lokal `-D`, lalu origin `--delete`
  bila ada) lewat helper yang sudah dipakai `mergeIntoCurrent`; best-effort, kegagalan hapus tak
  me-rollback merge. Notifikasi sukses.
- **`conflict`** → `integrate` meninggalkan worktree `.worktrees/merge-<spec>` karena kontrak
  ADR-0031 mengharapkan sesi agen dilahirkan di sana. Auto-merge **tidak** melahirkan sesi agen
  (membakar kuota tanpa diminta, dan objective hanya meminta notifikasi), jadi ia **membersihkan
  worktree itu** lalu memberi notifikasi berisi alasan. Branch kerja tak tersentuh; operator bisa
  menekan Merge di dashboard dan mendapat jalur konflik ADR-0031 yang lengkap.
- **`error`** → notifikasi berisi pesan galat apa adanya (mis. "push origin main ditolak — target
  maju di origin, fetch dulu").

Ketiganya menulis `Notification` bertipe `automerge` dengan key `automerge:<specId>`. Satu baris
per backlog selesai pada project yang **meng-opt-in** — volume yang diterima sadar: operator yang
menyalakan auto-merge justru ingin tahu hasilnya mendarat di mana. `notifTarget` sudah mengarahkan
tipe tak dikenal ber-`specId` ke Backlog; tak ada perubahan UI notifikasi.

**Konsekuensi diterima:** spec yang di-reopen lalu selesai lagi tak di-auto-merge ulang —
`recordCompletion` idempoten (key `done:<specId>`) sehingga `t0` tak lahir kedua kali, dan penanda
`automerge:` sudah ada. Cermin persis batasan ADR-0033. Jalur manual tetap terbuka.

## API

| Perubahan | Bentuk |
|---|---|
| `PATCH /projects/:id` | `zUpdateProject` + `autoMerge: zAutoMerge.nullable().optional()` |
| `GET /projects/:id` · `GET /projects` | `ProjectView.autoMerge` (nullable) |
| `GET /projects/:id/branches` | + `defaultBranch: string \| null` |
| `PATCH /specs/:id` | `zPatchSpec` + `autoMerge: zAutoMerge.nullable().optional()` |

Gerbang tulis (server, bukan hanya UI):

- `mode ≠ "off"` sementara repoDir efektif null → **409** "project belum di-bind ke checkout lokal".
- `mode = "branch"` tanpa `branch` → 400.
- `mode = "branch"` dengan branch yang tak ada di daftar `dest`-nya → 400. Daftar yang memasok
  dropdown adalah daftar yang menjaga gerbang (prinsip SPEC-143/ADR-0032) — `listRepoBranches`
  untuk `local`, `listRepoRemoteBranches` untuk `origin`.
- `mode = "default-branch"` sementara repo tak punya default branch yang bisa diresolve → 400.
- `autoMerge` pada spec **sengaja di luar gerbang `editingContent`** (SPEC-186), sama seperti
  `dependsOn`: ia menggerbangi apa yang terjadi *sesudah* kerja, bukan konten yang sedang
  dikerjakan sesi hidup.

### Default branch

`services/branches.ts` → `defaultBranch(repoDir)`: `git symbolic-ref --short refs/remotes/origin/HEAD`
(→ `origin/main`, lucuti prefix) → fallback `main` → `master` → `null`. **Jangan hardcode `main`**
(pelajaran SPEC-227/ADR-0077). Diresolve **saat eksekusi**, bukan dibekukan saat setting disimpan —
repo yang mengganti default branch tak boleh diam-diam merge ke branch lama.

## UI

**Project (Settings project = `ProjectDetailScreen`, tempat kartu Help Center & Custom agent
sudah duduk):** kartu "Auto-merge saat sesi selesai" — tiga pilihan mode, select tujuan
(lokal/origin), select branch (hanya saat mode `branch`), checkbox hapus branch kerja, tombol
Simpan. Tanpa repoDir efektif: seluruh kontrol disabled + kalimat penjelasan ("project ini belum
di-bind ke checkout lokal — atur repoDir dulu").

**Spec (Backlog):** baris "Auto-merge" di form/detail item dengan pilihan pertama **"Ikut project
(<ringkasan kebijakan project>)"** — supaya tak pernah ada pertanyaan "lalu ini pakai apa".

## Modul & batas

| Berkas | Tanggung jawab |
|---|---|
| `shared/src/auto-merge.ts` | skema `zAutoMerge`, `AUTO_MERGE_DEFAULTS`, `resolveAutoMerge()`, `autoMergeTargetOf()`, ringkasan teks — murni, tanpa I/O, dipakai server & UI |
| `server/src/services/branches.ts` | `defaultBranch(repoDir)` (baru) |
| `server/src/services/auto-merge.ts` | kandidat → kesiapan → `integrate` → notifikasi; `sweepAutoMerge()` + `startAutoMerge()`/`stopAutoMerge()` |
| `server/src/services/integrate.ts` | ekspor `deleteMergedBranch` (sudah ada, kini dipakai dua pemanggil) |
| `server/src/services/notifications.ts` | `recordAutoMerge(specId, …)` |
| `server/src/routes/{projects,specs}.ts` | gerbang tulis |
| `src/src/screens/{ProjectDetailScreen,BacklogScreen}.tsx` | permukaan |

Deps di-inject di `sweepAutoMerge` (pola `ReconcileDeps`) supaya bisa diuji tanpa git/tmux.

## Error handling

- Satu spec yang gagal disweep tak menghentikan sisanya (`try/catch` per item, pola `reconcile`).
- `integrate` sudah ber-timeout 60 dtk per perintah git dan tak pernah melempar (ia mengembalikan
  `{status:"error"}`).
- Sweep `busy`-guarded: satu putaran bisa memakan detik (fetch + merge), jangan menumpuk.
- Kegagalan hapus branch tak me-rollback merge — merge sudah mendarat.

## Test

| Lapis | Isi |
|---|---|
| `shared` | `resolveAutoMerge` (spec menang / null mewarisi / `{mode:"off"}` mematikan), `autoMergeTargetOf` (`local:` vs `origin:`, mode default-branch), parse default |
| `server` | gerbang route (409 tanpa repoDir, 400 branch karangan, 400 mode branch tanpa branch); `defaultBranch` (symbolic-ref → main → master → null); sweep: kandidat difilter window 24 j, penanda mencegah pengulangan, belum-siap dalam grace = diam & tak menandai, lewat grace = notifikasi + penanda, `clean` → notifikasi sukses (+ hapus branch bila knob nyala), `conflict` → worktree merge dibersihkan + notifikasi berisi alasan + branch kerja utuh, `mode:"off"` → nol panggilan `integrate` |
| `web` | kartu project (disabled + penjelasan tanpa repoDir; menyimpan mengirim bentuk yang benar), baris spec menampilkan warisan project saat override kosong |

Kontrol negatif yang wajib ada: project **tanpa** kebijakan tak pernah membuat sweep memanggil
`integrate` sama sekali (default lama utuh).

## Non-goal

- Rebase otomatis (force-push — dilarang batasan).
- Melahirkan sesi agen penyelesai konflik dari auto-merge.
- Retry berkala sesudah merge gagal/konflik (satu percobaan, lalu operator).
- Auto-merge untuk sesi project-level (PRD/reverse/scaffold) — kebijakan ini milik backlog item.
- Menyentuh `liveCount()` governor atau permukaan hapus-branch massal (SPEC-360/ADR-0077).
