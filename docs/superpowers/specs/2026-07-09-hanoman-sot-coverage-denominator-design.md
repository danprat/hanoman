# Design — SoT Coverage: denominator dipersempit ke `docsDir`

**Tanggal:** 2026-07-09
**Jenis:** koreksi metrik — bukan fitur baru, tidak ada nomor SPEC baru
**Source of Truth:** `internal/docs/**` — dokumen ini subordinat terhadapnya.
**Mengamandemen:** satu kriteria sukses di [`internal/docs/operations/spec-011-realtime-sot-scan-objective.md`](../../../internal/docs/operations/spec-011-realtime-sot-scan-objective.md), didasari ADR-0013.

## Masalah

SPEC-011 mengunci korpus SoT sebagai **setiap `**/*.md` di repo**. `scanRepoDocs` lalu menghitung
coverage sebagai persentase kategori (direktori) yang seluruh Markdown-nya reachable dari root index.
Akibatnya metrik itu **menuntut setiap direktori markdown di repo ter-index** — tuntutan yang tidak
pernah benar.

Diukur di repo ini hari ini: **coverage 75%**, dengan 4 kategori "gagal" yang tak satu pun merupakan
Source of Truth.

| Kategori unlinked | Isi | Wajar di-index? |
|---|---|---|
| `.` | `README.md`, `CLAUDE.md`, `AGENTS.md` | tidak — entrypoint, bukan daun |
| `docs/superpowers/plans` | 12 file | tidak — artefak proses |
| `docs/superpowers/specs` | 11 file | tidak — artefak proses |
| `.prototype/_ds/hanoman-design-system-…` | 1 readme | tidak — vendored |

`internal/docs/**` sendiri **100% bersih** (41/41 file ter-link). Angka 75% murni pajak dari
denominator yang kelewat lebar. Konfigurasi untuk memperbaikinya sudah ada dan tidak dipakai server:
`zHanomanConfig.docsDir` (default `internal/docs`), dengan `coverageThreshold` default `100` — yakni
guardrail CLI memang sudah menegakkan "semua kategori SoT wajib ter-index", atas `internal/docs` saja.

Masalah kedua, laten: **dua metrik bernama sama**. `cli/src/verify.ts` menghitung atas `docsDir`,
kategori = segmen path pertama, link **flat** (`parseIndex`, hanya link langsung dari index root).
`server/src/services/scan.ts` menghitung atas seluruh repo, kategori = path direktori penuh, link
**transitif** (`linkedSetFrom`). Hari ini keduanya kebetulan sepakat pada 100% karena 41/41 file
ter-link langsung. Begitu ada satu doc yang di-link lewat sub-index, dashboard hijau sementara Stop
hook memblokir.

## Keputusan

**Satu, pisahkan dua korpus yang selama ini dicampur.**

- **Korpus browse** — setiap `**/*.md` lewat `git ls-files`. Tidak berubah. Objective SPEC-011 soal
  membrowse, meng-edit, dan menghapus file nyata dari dashboard tetap berlaku penuh, termasuk untuk
  `README.md`, `AGENTS.md`, plan, dan spec.
- **Korpus skor** — hanya file di bawah `docsDir`, dikurangi index root `docsDir/README.md`. Hanya ini
  yang masuk denominator coverage.

`DocCat` bertambah `scored: boolean`. Kategori di luar `docsDir` berstatus `scored: false` dan **tidak
punya status linked/unlinked sama sekali** — bukan "gagal", melainkan tidak dinilai. Coverage repo ini
menjadi **100%**, dan itu jujur.

**Dua, satu metrik penentu linked.** `linkedSetFrom` (BFS transitif, murni, di `@hanoman/shared`)
menjadi satu-satunya penentu linked/unlinked — di server maupun di `collectViolations` dan
`docs index`. Dashboard tidak bisa lagi berbohong soal apa yang akan diblokir Stop hook.

`parseIndex` **tetap ada**, perannya dipersempit menjadi "ekstrak link langsung dari sebuah file".
`docs index` masih membutuhkannya untuk dua hal yang tak bisa diberikan himpunan transitif: mendeteksi
**dangling link** (target di index yang filenya tak ada) dan `--fix`/`addLink` yang menulis ke index
root. Penentuan `unlinked`-nya sendiri pindah ke `linkedSetFrom`; kalau tidak, `--fix` akan menambahkan
ulang file yang sudah reachable lewat sub-index.

**Tiga, `walkDocs` berhenti mengecualikan `README.md`.** Ini prasyarat agar penyatuan di atas benar-benar
bekerja, bukan kosmetik. `linkedSetFrom` hanya menelusuri link yang targetnya ada di korpus
(`if (rel && inCorpus.has(rel) && ...) queue.push(rel)`). `walkDocs` membuang **setiap** file bernama
`README.md` di kedalaman mana pun, sehingga `adr/README.md` tak pernah masuk korpus, BFS berhenti di
situ, dan sub-index diam-diam tidak pernah berfungsi — persis kemampuan yang menjadi alasan memilih
transitif. Karena itu: README ikut masuk korpus BFS, dan yang dikecualikan dari **denominator** hanya
satu file, yaitu index root.

Efek di repo ini: korpus CLI 41 → 42 file, denominator tetap 41, hasil tetap 100%. Tidak ada yang
bergeser hari ini; yang berubah adalah sub-index menjadi sah untuk besok.

## Konsekuensi yang disengaja

Guardrail **melonggar**. Sebelumnya tiap doc wajib di-link langsung dari `docsDir/README.md`. Sekarang
cukup terjangkau secara transitif, sehingga 12 ADR tidak perlu dilistkan satu per satu di index root
selamanya — cukup `adr/README.md`. Pelonggaran ini dicatat di ADR-0013.

Tidak berubah: `coverageOf` dan `docStatusFor` dipakai **apa adanya** (unit tetap kategori, ambang tetap
90/60), `coverageThreshold` tetap 100, metrik guardrail run dan isolasi worktree tidak tersentuh, tidak
ada dependency runtime baru, tidak ada opsi config baru.

## Perubahan per file

| File | Perubahan |
|---|---|
| `shared/src/dto.ts` | `zDocIndexCat` + `scored: z.boolean()` |
| `shared/src/coverage.ts` | **tidak berubah** |
| `server/src/services/scan.ts` | baca `docsDir`; scoping denominator; `scored`; index tanpa fallback |
| `cli/src/docs-model.ts` | `walkDocs` memuat README; `parseIndex` dipersempit perannya; `catStatus` tetap |
| `cli/src/verify.ts` | `linked` dari `linkedSetFrom`; index dikecualikan dari `files` yang diskor |
| `cli/src/commands/docs-index.ts` | `unlinked` dari `linkedSetFrom`; `dangling` tetap `parseIndex`; index tak pernah jadi kandidat `addLink` |
| `src/src/screens/DocsWorkspace.tsx` | grup "Lainnya (tidak dinilai)" untuk kategori `scored: false` |

### `docsDir` di server

`zHanomanConfig` sudah diekspor dari barrel `@hanoman/shared` (zod murni, tanpa `node:*`), jadi
`scan.ts` membaca `hanoman.config.json` dari `repoDir` sendiri:

```ts
// ponytail: 3 baris; angkat ke adapter node bersama kalau muncul consumer ketiga.
function docsDirOf(repoDir: string): string {
  try { return zHanomanConfig.parse(JSON.parse(readFileSync(resolve(repoDir, "hanoman.config.json"), "utf8"))).docsDir; }
  catch { return zHanomanConfig.parse({}).docsDir; }
}
```

Duplikasi ~3 baris dengan `cli/src/config.ts` dibiarkan. Menaikkannya ke shared menuntut subpath export
ber-`node:fs`, yang melanggar prinsip "barrel bebas node" dari SPEC-011 (web mem-bundle barrel lewat Vite).

`resolveIndex` kehilangan fallback ke `README.md` repo. Index adalah `docsDir/README.md`, titik — sejalan
dengan `resolveRepo` di CLI. Root `README.md` bukan index SoT, ia entrypoint.

### Aliran data

`GET /projects/:id/docs` → `docIndex` → `scanRepoDocs(repoDir)`:

1. `files` = seluruh `**/*.md` repo (`git ls-files --cached --others --exclude-standard`) — korpus browse.
2. `docsDir` = dari config; `index` = `docsDir/README.md` bila ada, else `""`.
3. `corpus` = `files` yang berprefiks `docsDir/` — termasuk README, agar BFS bisa menelusuri sub-index.
4. `linked` = `index ? linkedSetFrom(index, corpus, read) : ∅`.
5. `scored` = `corpus` minus `index`.
6. `coverage` = `coverageOf(scored.map((f) => ({ category: catOf(f), linked: linked.has(f) })))`.
7. `tree` = kategori dari **seluruh** `files`; kategori di dalam `docsDir` → `scored: true` dengan
   `linked` sebenarnya, sisanya → `scored: false, linked: false`.

`POST /projects/:id/scan` menyegarkan cache `Project.coverage`/`docStatus` dari angka yang sama. Bentuk
route tidak berubah.

## Error handling

- `repoDir` null / bukan direktori → `{ coverage: 0, tree: [] }`. Tidak berubah.
- `docsDir` tidak ada → index tidak ada → tak ada kategori scored, `coverage 0`, tapi tree tetap
  menampilkan markdown repo. Tanpa crash.
- `hanoman.config.json` rusak / tidak ada → default `internal/docs`.
- Di CLI, index hilang tetap melempar (fails loud, ADR-0009). Di server tidak boleh 500. Perbedaan
  failure mode ini disengaja: guardrail memblokir, dashboard hanya membaca.

Cacat lama yang **tidak** diperbaiki di sini: `docsDir` yang hanya berisi `README.md` menghasilkan
`coverageOf([]) = 0`, bukan 100 — sehingga proyek tanpa `internal/docs` tampil `coverage 0 → docStatus
broken`. Perilaku ini sudah ada di CLI hari ini dan tidak berhubungan dengan keluhan yang memicu
dokumen ini.

## Test

Satu test menanggung inti perubahan ini, dan **ia gagal pada kode hari ini**:

- `cli/test/verify.test.ts` — doc yang hanya di-link dari `adr/README.md` terhitung `linked`; tidak ada
  violation `unlinked`.

Selebihnya:

- `cli/test/docs-model.test.ts` — `walkDocs` memuat `README.md`, termasuk sub-index.
- `server/test/scan.test.ts` — temp git repo berisi `internal/docs/**` + `docs/plans/x.md` + root
  `README.md`: denominator mengabaikan yang di luar `docsDir`; `scored` terisi benar; tanpa `internal/docs`
  → `coverage 0` dengan tree tetap terisi.
- `cli/test/docs-index.test.ts` — `--fix` tidak menambahkan ulang doc yang reachable lewat sub-index, dan
  tidak pernah meng-`addLink` index root ke dirinya sendiri.

Cek nyata sesuai CLAUDE.md: boot server, `curl /projects/:id/docs` menunjuk repo ini → `coverage: 100`,
tree memuat kategori `scored: false`.

## Batas scope

- **Termasuk:** denominator coverage dipersempit ke `docsDir`; `scored` di API + web; `linkedSetFrom`
  sebagai satu-satunya penentu linked di server dan CLI; `walkDocs` memuat README; ADR-0013 + amandemen
  objective SPEC-011.
- **Tidak termasuk:** mengubah unit metrik dari kategori ke file; mengubah `coverageOf` atau ambang
  `docStatusFor`; menambah opsi config (`sotDirs`, frontmatter penanda SoT); memperbaiki `docsDir` kosong
  → 0%; watcher/SSE untuk docs; membuat dokumen baru dari UI.

## Pencatatan

Tidak ada perubahan skema, jadi tidak ada migration. Tetapi semantik guardrail berubah, dan ADR-0001
menulis eksplisit *"Coverage dihitung dari kategori yang ter-link"*. Karena itu:

- **ADR-0013** (`0012` sudah dipakai `cost-is-an-estimate-not-a-guardrail`) mencatat keputusan
  denominator + transitif, dengan konsekuensi melonggarnya guardrail.
- Blok amandemen di `spec-011-realtime-sot-scan-objective.md` menunjuk ke ADR-0013 — objective itu
  berstatus *dikunci*, jadi butir coverage-nya tidak boleh diam-diam diganti.
- `internal/docs/architecture/api-contract.md` (baris 51–53, plus `scored`) dan index
  `internal/docs/README.md` diperbarui **dalam commit yang sama**.
