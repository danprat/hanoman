# SPEC-447 — Backlog yang saling dependency

**Tanggal:** 2026-07-31 · **Sumber:** brief · **Prioritas:** tinggi · **Flow:** feature

> Objective: ketika backlog yang saling dependency jangan sampai running jika backlog sebelumnya
> belum selesai. Tunggu sampai backlog-nya selesai **dan di-merge**, baru backlog yang punya
> dependency ke backlog lain boleh dijalankan.

---

## 1. Masalah

Backlog hanoman hari ini **tak punya konsep urutan wajib**. Tiga jalur peluncuran memperlakukan
setiap item sebagai independen:

| Jalur | Predikat sekarang | Akibat |
|---|---|---|
| `sources/backlog.ts` (checker scheduler) | `UNSTARTED_SPEC_WHERE` = `baseSha:null ∧ stage≠done` | seluruh backlog siap-kerja masuk antrean sekaligus |
| `governor.drain()` | urut prioritas → FIFO, sampai `maxConcurrent` | N item jalan **paralel**; urutan antrean bukan gerbang |
| `POST /terminal/sessions` (Start manual) | tak ada gerbang urutan sama sekali | operator bisa memulai item yang basisnya belum ada |

`lead/pulse.ts::orderProject` memang menata **urutan** antrean, tapi urutan ≠ gerbang: governor
menguras sampai cap, jadi item ke-2 dan ke-3 tetap lahir sebelum item ke-1 selesai. Preseden
SPEC-273 (`POST /specs/batch`) menegaskan asumsi lama: "backlog hasil breakdown **by-construction
independen** → jalan paralel". Yang tak pernah ada adalah cara menyatakan bahwa dua item **tidak**
independen.

Konsekuensi nyatanya bukan sekadar urutan yang berantakan: worktree sesi lahir `--detach` dari
`branchFrom` (ADR-0002). Kalau item B bergantung ke A dan A belum ter-merge ke `branchFrom`,
worktree B **secara fisik tak memuat pekerjaan A** — agen B akan membangun di atas basis yang
salah, dan konflik integrasi baru muncul berjam-jam kemudian.

## 2. Keputusan yang diambil (dikonfirmasi operator)

1. **Penyimpanan:** kolom `Spec.dependsOn Json?` (array id spec) — bukan tabel join, bukan
   selipan di `payload`.
2. **Predikat siap:** dependency siap bila `stage = "done"` **dan** commit-nya sudah ada di branch
   basis si dependent — merged **diturunkan dari git**, bukan disimpan (ADR-0019).
3. **Start manual:** ditolak `409` dengan daftar pemblokir, **bisa dipaksa** lewat `force: true`
   (konfirmasi eksplisit di UI). Otomasi (scheduler + lead) **tak punya jalan paksa**.

## 3. Data model

```prisma
model Spec {
  …
  // SPEC-447 · id spec lain yang harus SELESAI & TER-MERGE sebelum item ini boleh diluncurkan.
  // Array JSON of string; null / [] = tak bergantung apa pun. Sengaja kolom, bukan tabel join:
  // SQLite melarang scalar list, tapi Json sudah dipakai `payload` dan ikut FIELDS.spec sync
  // apa adanya. Integritas ditegakkan di boundary (route) + pembersihan saat spec dihapus.
  dependsOn Json?
}
```

Migration **aditif** (`20260731210000_spec_depends_on`): `ALTER TABLE "Spec" ADD COLUMN
"dependsOn" JSONB;`. Nullable tanpa default → tak perlu redefinisi tabel (beda dari SPEC-408, yang
butuh redefinisi hanya karena `DEFAULT CURRENT_TIMESTAMP` terlarang di `ADD COLUMN`).

**Sync:** `"dependsOn"` masuk `FIELDS.spec` (`services/sync.ts`). Ia **bukan** `DATE_FIELDS`.
Tanpa ini, spec asal-hub kehilangan dependency-nya di tiap client — dan client akan meluncurkan
pekerjaan yang di hub terblokir. Tidak ada model baru → `PG_ORDER` (`cli/src/commands/migrate-pg.ts`)
tak berubah.

**Aturan integritas** (ditegakkan `POST /specs` & `PATCH /specs/:id`, 400/409):

- setiap id harus **ada** dan berada di **project yang sama** (dependency lintas project menuntut
  merge lintas repo — di luar scope, ditolak tegas, bukan didiamkan);
- **bukan diri sendiri**; duplikat dinormalisasi (dedup, urutan dipertahankan);
- **tidak membentuk siklus** — DFS atas peta `id → dependsOn` project itu **sesudah** perubahan
  diterapkan secara in-memory. Siklus = deadlock permanen yang tak bisa dilihat operator, jadi ia
  ditolak di boundary, bukan ditambal saat baca.

`DELETE /specs/:id` **mencabut id itu dari `dependsOn` semua dependent-nya** (+ `notifySynced`
per baris yang berubah). Tanpa itu, menghapus satu item mengunci dependent-nya selamanya dengan
alasan yang tak bisa diperbaiki dari UI.

## 4. Resolver — `server/src/services/spec-deps.ts` (baru)

```ts
export type BlockReason = "missing" | "unfinished" | "unmerged";
export type SpecBlocker = { id: string; reason: BlockReason };
```

`dependsOnOf(spec): string[]` — pembacaan **defensif** kolom Json (bukan array / elemen non-string
→ `[]`). Kolom Json bisa berisi apa saja: ia menyeberang lewat sync dari client versi lain.

`blockersFor(spec, deps, isMerged): SpecBlocker[]` — **murni**, tanpa DB/git, jadi seluruh matriks
keputusannya teruji tanpa harness:

| Keadaan dependency | Verdict |
|---|---|
| id tak ada di `deps` | `missing` — blokir |
| `stage ≠ "done"` | `unfinished` — blokir |
| `stage = "done"` ∧ `headSha = null` | **siap** — hanoman tak pernah membuatkan worktree untuknya, jadi tak ada commit yang bisa di-merge (pelajaran SPEC-431: `headSha`/`baseSha` null ≠ belum dikerjakan) |
| `stage = "done"` ∧ `headSha` ada ∧ `isMerged(headSha, base)` | **siap** |
| `stage = "done"` ∧ `headSha` ada ∧ tidak | `unmerged` — blokir |

`base` = basis efektif si dependent, yaitu `spec.branchFrom ?? "HEAD"` — **ref yang sama persis**
yang akan dipakai `realGit.addWorktree` saat sesinya lahir. Pertanyaannya memang itu: "apakah
worktree yang akan saya buat memuat pekerjaan dependency ini?"

`isMerged` diturunkan `realGit.isAncestor(repoDir, headSha, baseRef)` (baru di `runner/src/git.ts`
+ `GitOps`): `git merge-base --is-ancestor --end-of-options <sha> <ref>` → exit 0 = ya, 1 = tidak.
**Exit ≠ 0/1, ref tak resolve, atau repo tak bisa dibaca → dianggap BELUM merged** (fail-closed):
"tak bisa dipastikan" tak boleh terbaca sebagai "aman". Alasannya ikut ke UI lewat reason
`unmerged`, jadi keadaan itu terlihat, bukan senyap.

**Cache**: `isAncestor` dimemoisasi per `(repoDir, sha, ref)` dengan TTL pendek (15 s) di modul ini
— merged-ness hanya berubah saat ada integrate/push, sementara pembacanya adalah loop siar 1 detik.
Diekspor `__clearMergeCache()` untuk test.

**Biaya nol saat fitur tak dipakai:** resolver keluar lebih awal untuk spec ber-`dependsOn` kosong,
jadi backlog yang tak memakai dependency **tak pernah memanggil git**.

## 5. Titik penegakan

### 5.1 `startSpecSession` — titik cekik peluncuran

Gerbang dipasang **sesudah** `resolveRepoDir` dan **sebelum** re-attach/worktree apa pun:

```ts
if (!opts.force) {
  const blockers = await blockersForSpec(spec, repoDir);
  if (blockers.length) throw new LaunchError(<pesan>, "blocked", blockers);
}
```

Titik yang sama sudah menjaga `baseSha`/`startedAt`/agen (SPEC-394/408) — semua jalur peluncuran
sesi backlog melewatinya. `LaunchError` bertambah `kind: "blocked"` + field `blockers`.

**Re-attach dikecualikan secara sadar?** Tidak: gerbang berdiri di depan, jadi bahkan re-attach
ditolak. Alasannya, sesi yang sudah hidup mustahil terblokir tanpa `force` (ia lahir lewat gerbang
yang sama), kecuali dependency-nya ditambahkan **setelah** sesi hidup — dan di situ menolak
membuka pane yang sedang berjalan justru menyembunyikan pekerjaan yang perlu dilihat operator.
Karena itu gerbang berdiri **sesudah** cek pane hidup: **pane hidup → re-attach seperti biasa**;
yang dijaga adalah kelahiran/kelanjutan sesi.

### 5.2 Governor — gerbang kedua (pola SPEC-431)

`GovernorDeps` bertambah `blockers: (specId) => Promise<SpecBlocker[]>`. Di `drain()`, tepat
setelah gerbang `isDone`:

```ts
const bl = await deps.blockers(item.specId);
if (bl.length) { await noteQueued(item.id, blockedNote(bl)); continue; }
```

Baris tetap `queued` (**bukan** `failed`): pemblokirnya akan selesai, dan `enqueue` yang
`upsert(update:{})` tak bisa menghidupkan kembali baris yang sudah ditutup. Slot **tidak** terpakai,
dan `drain` lanjut ke item berikutnya — item terblokir tak menyumbat antrean.

`noteQueued(id, note)` (baru di `queue.ts`) menulis `note` **hanya bila berubah** — tick governor
10 detik tak boleh jadi 8 640 write/hari. Operator membaca alasannya di panel Scheduler
("menunggu SPEC-441 selesai & ter-merge"); baris `queued` tanpa penjelasan persis kelas bug yang
dikeluhkan SPEC-431/432.

Checker `sources/backlog.ts` **tidak diubah**: antrean adalah daftar tunggu yang sah, dan gerbang
ada di governor. Menyaring di checker akan menyembunyikan item terblokir dari panel.

### 5.3 hanoman-lead — gerbang aktionabilitas

`orderProject` (SPEC-432) hanya boleh membeli giliran agen untuk penataan yang **bisa berdampak**.
Item terblokir tak bisa diluncurkan governor, jadi ia disaring dari himpunan `ready` **sebelum**
hitungan `pending ≥ 2` dan sebelum tanda tangan dihitung. Tanpa ini, backlog berdependency
membuat lead memanggil agen berulang untuk mengurutkan pekerjaan yang tak satupun bisa jalan.

### 5.4 Route — kontrak HTTP

`POST /terminal/sessions` varian `{spec}` menerima `force: z.boolean().optional()`.
`LaunchError.kind === "blocked"` → **409** `{ error, blocked: true, blockers: SpecBlocker[] }`.
(`needs-bind` → 400, `worktree` → 422 tetap.)

## 6. Permukaan baca

`liveSpecs()` (`services/live-specs.ts`) menghias tiap baris dengan `blockedBy: SpecBlocker[]`.
Ia dipakai **GET `/specs` dan grup siar WS `specs`** — menghias hanya salah satunya akan membuat
badge berkedip tiap frame WS tiba (persis alasan SPEC-199 menyatukan keduanya).

Dependency yang dirujuk bisa berada di luar filter `project`/`source`, jadi barisnya diambil
terpisah (`findMany({ where: { id: { in: […] } } })`) — satu query untuk seluruh halaman.
`repoDir` diselesaikan per project (`resolveRepoDir`, dimemoisasi dalam satu panggilan).

`shared/src/entities.ts`:

```ts
export const zSpecBlocker = z.object({ id: z.string(), reason: z.enum(["missing","unfinished","unmerged"]) });
zSpec = zSpec.extend({
  dependsOn: z.array(z.string()).default([]),
  blockedBy: z.array(zSpecBlocker).default([]),   // turunan; tak pernah dikirim klien
});
```

`dependsOn` dinormalisasi ke array di layer baca (kolom Json bisa `null`), jadi klien tak pernah
melihat `null`.

## 7. UI

- **`NewSpecModal`** — field "Bergantung pada" di bawah Branch: daftar bergulir berisi backlog
  project terpilih (kecuali diri sendiri) dengan checkbox; kosong = tak bergantung. Berlaku untuk
  **keempat** tab (brief/qa/audit/goal): dependency adalah properti item, bukan properti bentuk
  payload.
- **`SpecDetail`** — baris "Bergantung pada" berisi id + status tiap dependency
  (`selesai & ter-merge` / `belum selesai` / `belum ter-merge` / `tak ditemukan`), dan **editable**
  (lihat §8).
- **`SpecCard` / `SpecRow` / `BoardCard`** — badge `Terblokir` (tone `warn`, ikon `lock`) saat
  `blockedBy.length > 0`, dengan `title` yang menyebut pemblokirnya.
- **`SpecActions`** — tombol tetap "Mulai"/"Lanjutkan" (tak di-`disabled`: tombol mati tanpa
  penjelasan adalah UX buruk, dan `force` memang sah) — badge yang membawa peringatannya.
- **`StartSessionModal`** — bila `spec.blockedBy` tak kosong: banner peringatan berisi daftar
  pemblokir, tombol berubah jadi **"Mulai tetap"** (variant danger) dan `api.startSession` dikirim
  dengan `force: true`. Tanpa banner, tak ada `force` yang bisa terkirim tak sengaja.

## 8. Aturan edit

`dependsOn` **boleh diubah kapan saja**, termasuk sesudah item dimulai — ia sengaja **tidak** ikut
gerbang `editingContent` (`stage = brainstorming ∧ baseSha = null`, SPEC-186). Alasannya: gerbang
itu melindungi konten yang sudah jadi dasar kerja sesi berjalan, sedangkan `dependsOn` hanya
menggerbangi **peluncuran berikutnya**. Mengunci dependency setelah item dimulai berarti operator
tak bisa membebaskan item yang terlanjur terblokir salah tulis — satu-satunya jalan keluarnya jadi
menghapus item.

## 9. Testing

**Murni (tanpa harness) — `server/test/spec-deps.test.ts`**
seluruh matriks §4 · pembacaan defensif Json (string, objek, elemen bukan string, null) ·
`base` = `branchFrom ?? "HEAD"` · fail-closed saat `isAncestor` melempar · cache TTL.

**Server**
`session-launch` — terblokir → `LaunchError kind blocked` **tanpa** memanggil `addWorktree`; `force`
melewati gerbang; pane hidup tetap re-attach · `governor` — item terblokir dilewati, tetap `queued`,
slot tak terpakai, item berikutnya tetap diluncurkan, `note` tak ditulis ulang bila sama ·
`routes/specs` — validasi (id asing / lintas project / diri sendiri / siklus) + cleanup saat DELETE ·
`routes/terminal` — 409 + `blockers`, 201 dengan `force` · `sync` — `dependsOn` ada di `FIELDS.spec`
(kontrak, bentuk yang sama dengan test `createdAt`/`startedAt` SPEC-408) · `live-specs` — `blockedBy`
terhias, dan spec tanpa dependency **tak memanggil git sama sekali** · `lead/pulse` — item terblokir
tak masuk `ready`.

**Web**
badge `Terblokir` muncul/absen · `StartSessionModal` mengirim `force: true` hanya saat terblokir ·
picker dependency di `NewSpecModal` mengirim `dependsOn`.

Scope verifikasi mengikuti ADR-0080 (`--changed` + `--no-file-parallelism`). `shared/src/entities.ts`
tersentuh → blast radius `--changed` memang lebar; itu diterima dan disebut alasannya.

## 10. Docs yang tersentuh (commit yang sama)

- `internal/docs/adr/0093-dependency-antar-backlog.md` (**baru**) + tautan di
  `internal/docs/README.md` **dan** `internal/docs/adr/README.md` (SPEC-386: ADR baru wajib di keduanya)
- `internal/docs/architecture/data-model.md` — kolom `dependsOn` + aturan integritas
- `internal/docs/architecture/api-contract.md` — `dependsOn`/`blockedBy` di `Spec`, `force` +
  409 di `POST /terminal/sessions`
- `internal/skills/hanoman/SKILL.md` — butir aturan sesi & eksekusi

## 11. Non-goal (sadar)

- **Dependency lintas project** — menuntut merge lintas repo; ditolak di boundary.
- **Auto-launch saat pemblokir selesai** — sudah tertangani: governor menguras tiap 10 detik dan
  barisnya tetap `queued`. Tak ada mekanisme notifikasi baru.
- **Blocking transitif eksplisit** — tak perlu: A→B→C, `B` tak mungkin `done` sebelum `C`, jadi
  satu tingkat sudah cukup dan resolver bebas rekursi.
- **Menampilkan graf dependency** — di luar scope.
- **Mengubah `POST /specs/batch`** — hasil breakdown tetap independen by construction (SPEC-273);
  operator bisa menambahkan dependency sesudahnya lewat PATCH.
