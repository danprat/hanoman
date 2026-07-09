# SPEC-145 — Design: QA after audit (keputusan sebelum spec)

**Fase:** Spec · 2026-07-09
**Hulu:** [objective](../../../internal/docs/operations/spec-145-qa-after-audit-objective.md) ·
[brainstorm](2026-07-09-hanoman-qa-after-audit-spec-145-brainstorm.md)
**Status:** design — belum ada perubahan kode.

Objective mengunci *apa*. Dokumen ini mengunci *di baris mana*, dan mencatat dua temuan yang
menggeser rinciannya.

## Temuan fase Spec

### 1. Artefak yang tertinggal akan ter-commit ke repo project

Objective menulis: runner "membacanya sesudah Audit `done`, lalu **menghapusnya**". Baca harfiah,
unlink terjadi tepat setelah baca — dan itu meninggalkan satu jendela. `commitAndPush`
(`runner/src/git.ts:46`) menjalankan `git add -A`. Diverifikasi di repo sementara:

```
$ echo '{"path":"execute"}' > .hanoman-decision.json && git add -A
$ git diff --cached --name-only
.hanoman-decision.json
```

Berkas ber-titik di root **ikut ter-stage**. Jadi setiap jalur yang melewatkan unlink akan
mendaratkan artefak internal hanoman ke `branchTo` milik repo orang lain. Jalur itu ada:

- run mati **antara** Audit menulis berkas dan runner membacanya. Event `phase done` sudah
  ter-persist, sehingga pada resume `Audit ∈ donePhases` → fase Audit tak dijalankan → pembacaan
  (dan unlink-nya) tak pernah terjadi → `git add -A` menelan artefaknya.

**Keputusan:** unlink **bukan** di sebelah baca, melainkan **tepat sebelum `commitAndPush`**, tanpa
syarat, `rmSync(..., { force: true })`. Satu titik, meliputi setiap jalur keluar yang commit —
termasuk resume, termasuk jalur `spec`, termasuk run yang artefaknya memang tak pernah ada.

Ini **memperkuat**, bukan membatalkan, kriteria objective. Amandemen dicatat di dokumen objective.

### 2. Commit kosong benar-benar gagal

Perangkap `path: "none"` yang dicatat objective diverifikasi, bukan diasumsikan:

```
$ git commit -m empty   # tanpa apa pun ter-stage
exit=1
```

`commitAndPush` tidak memakai `--allow-empty`. Menahan `path: "none"` di luar scope terbukti benar.

## Bentuk keputusan

`runner/src/phases.ts` — pemilik pipeline dan prompt — juga memiliki keputusan. Tanpa berkas baru.

```ts
export const DECISION_FILE = ".hanoman-decision.json";
// Fase perencanaan alur qa. Dinamai, bukan `PIPELINES.qa.slice(1, -1)`: yang dilewati adalah
// "merencanakan", bukan "apa pun yang kebetulan berada di antara Audit dan Execute".
export const QA_PLANNING = ["Spec", "Plan"] as const;

export type Decision = { path: "execute" | "spec"; reason?: string };

// HANYA "execute" yang memilih jalur cepat. Berkas hilang, JSON rusak, `path` tak dikenal
// (termasuk "none" di masa depan) → jalur penuh. Fail-safe secara konstruksi, bukan lewat
// daftar kasus gagal yang harus dijaga tetap lengkap.
export function readDecision(worktree: string): Decision {
  try {
    const j = JSON.parse(readFileSync(`${worktree}/${DECISION_FILE}`, "utf8")) as Record<string, unknown>;
    if (j.path !== "execute") return { path: "spec" };
    return { path: "execute", reason: typeof j.reason === "string" ? j.reason : undefined };
  } catch { return { path: "spec" }; }
}
```

Perhatikan arah default-nya: fungsi ini tidak pernah menanyakan "apakah ini rusak?". Ia menanyakan
"apakah ini secara eksplisit `execute`?". Setiap masukan lain jatuh ke jalur penuh tanpa cabang baru.

## Instruksi prompt

`phasePrompt` mendapat satu sufiks, hanya untuk `flow === "qa" && phase === "Audit"`:

> Sebelum menutup fase ini, tulis keputusan jalur ke `.hanoman-decision.json` di root worktree:
> `{"path":"execute"|"spec","reason":"<satu kalimat>"}`.
> Pilih `"execute"` **hanya bila seluruhnya benar**: perbaikannya terlokalisasi (satu–dua berkas),
> tidak menuntut keputusan desain, tidak menyentuh skema database maupun kontrak API, dan kamu yakin
> dapat menyelesaikannya tanpa spec dan plan. **Saat ragu, pilih `"spec"`.**

Tak ada cabang untuk `input.only` — keputusan objective butir 5. `hanoman qa --only Audit` menulis
artefaknya; tanpa fase hilir, pemangkasannya no-op, dan unlink pra-commit tetap membersihkannya.

## Perubahan di `runOne` (`runner/src/run.ts`)

**Bentrokan nama.** Baris 26 sudah memakai `skipped` untuk "fase yang sudah selesai di percobaan
sebelumnya". Himpunan baru bernama **`pruned`** — pemangkasan karena keputusan, bukan karena resume.

```ts
const pruned = new Set<string>();                    // diisi sesudah Audit

for (const phase of phases) {
  if (pruned.has(phase)) { onEvent({ kind: "phase", name: phase, state: "skipped" }); continue; }
  ...                                                 // gate Execute + runPhase, tak berubah
  onEvent({ kind: "phase", name: phase, state: "done" });

  if (input.flow === "qa" && phase === "Audit") {
    const d = readDecision(worktree);
    if (d.path === "execute") {
      QA_PLANNING.forEach((p) => pruned.add(p));
      onEvent({ kind: "log", line: { t: "›", s: `audit: perbaikan kecil — Spec & Plan dilewati${d.reason ? ` · ${d.reason}` : ""}` } });
    }
  }
  ... // steer drain, tak berubah
}
```

Lalu, sebelum `deps.git.commitAndPush(...)` di baris 111:

```ts
rmSync(`${worktree}/${DECISION_FILE}`, { force: true });   // force: absen bukan error
```

Empat sifat yang dijaga bentuk ini:

- **`pruned` diperiksa sebelum gate Execute**, sehingga fase yang dilewati tak pernah memanggil
  `deps.verify` maupun membuka giliran claude.
- **Fase Execute tetap melewati gate.** Yang dipangkas hanya `QA_PLANNING`.
- **`only` aman.** `all` menyusut jadi satu fase; Audit sendirian tak punya hilir untuk dipangkas.
- **Abort aman.** `continue` mendahului cek `abortController`, tetapi fase yang dipangkas tidak
  melakukan pekerjaan — iterasi berikutnya tetap memeriksanya sebelum menjalankan apa pun.

## Bertahan melewati resume

`server/src/worker.ts:62` hari ini menyusun daftar "jangan jalankan lagi" dari satu state:

```ts
const done = (row.phases as ...).filter((p) => p.state === "done").map((p) => p.name);
```

menjadi `p.state === "done" || p.state === "skipped"`. Itu saja. Keputusan tersimpan di `run.phases`
— kolom `Json` yang sudah ada — jadi tidak ada kolom, migration, maupun payload job baru.

**Yang sengaja tidak dilakukan:** membaca ulang artefak saat resume ketika `Audit ∈ donePhases`
tapi Spec/Plan masih `pending` (run mati di jendela antara `phase done` dan pembacaan). Run itu
jatuh ke jalur penuh — mahal, benar, dan artefak yatimnya tetap dibersihkan unlink pra-commit.
Menambah cabang untuk menghemat dua giliran pada kasus yang menuntut crash berjendela milidetik
adalah kompleksitas yang tidak dibayar.

## `skipped` di kedua definisi enum

State fase punya dua definisi independen; keduanya bergerak bersama:

| Berkas | Baris | Hari ini | Menjadi |
|---|---|---|---|
| `runner/src/types.ts` | 31 | `"pending" \| "active" \| "done" \| "failed"` | `… \| "skipped"` |
| `shared/src/entities.ts` | 30 | `z.enum(["done","active","failed","pending"])` | `… ,"skipped"` |

`zRun` di-*infer* menjadi tipe `Run` dan tak pernah di-`parse` pada request mana pun (diperiksa:
tidak ada `zRun.parse` di `server/`, `src/`, `cli/`). Karena itu melewatkan `zPhase` gagal saat
**kompilasi**, bukan runtime — dan `Run["phases"][n].state` tak akan menerima nilai yang runner
benar-benar pancarkan.

## `computeProgress` (`server/src/runner/events-io.ts:20-23`)

`skipped` keluar dari **penyebut**, bukan dari pembilang:

```ts
export function computeProgress(phases: { state: string }[]): number {
  const counted = phases.filter((p) => p.state !== "skipped");
  if (!counted.length) return 0;                       // menggantikan guard `!phases.length`
  return Math.round((counted.filter((p) => p.state === "done").length / counted.length) * 100);
}
```

Lintasan jalur cepat, monoton dan berakhir jujur:

| Peristiwa | `run.phases` | progress |
|---|---|---|
| enqueue | pending ×4 | 0% |
| Audit done | done, pending, pending, pending | 25% |
| Spec+Plan skipped | done, **skipped**, **skipped**, pending | 50% |
| Execute done | done, skipped, skipped, done | **100%** |

Tanpa perubahan ini baris terakhir berbunyi 50%: mekanismenya bekerja, dashboard-nya berbohong.
Execute yang gagal berbunyi 50%, konsisten dengan komentar "80%" yang sudah ada di fungsi itu.

## `PhasePipeline` (`src/src/screens/RunsScreen.tsx:21-46`)

Hari ini apa pun di luar `done`/`active`/`failed` jatuh ke gaya `pending`, sehingga fase yang
**dilewati** tak terbedakan dari fase yang **belum jalan**. Dua penyesuaian:

- Lingkaran: `skipped` → isi `var(--bone-400)` dengan ikon `minus` (Icon mem-proxy `lucide-react`,
  jadi nama apa pun yang ada di lucide sah — `src/src/ds/icon.tsx:8`), label `var(--text-subtle)`.
- Konektor (`:44-46`): garis sesudah fase `done` **atau** `skipped` berwarna `--leaf-500`. Alur
  memang lewat sana; hanya saja tak ada pekerjaan yang dilakukan.

`Phase` lokal di `:16` bertipe `state: string`, jadi tak ada perubahan tipe yang diperlukan di sini.

## Yang tidak tersentuh

- `PlanSteps` (`RunsScreen.tsx:65-71`) menghitung `run.plan`, bukan `run.phases`. Di luar scope
  (koreksi yang sudah dicatat objective).
- `phasesForFlow` (`server/src/queue.ts:16-19`) tetap menyemai empat baris `pending`. Keputusan
  belum ada saat enqueue; keempat baris itulah yang kemudian menerima `skipped` di tempat.
- `mirrorStage`, `PHASE_DONE_STAGE` — `skipped` bukan `phase done`, jadi tak memicu bump stage.
  `objective → executing` sudah sah karena `mirrorStage` maju-saja.
- Gate `deps.verify`, `deniesDangerous`, isolasi worktree, alur `feature`/`scaffold`/`reverse`.

## Rencana test

| Test | Berkas | Menangkap |
|---|---|---|
| `readDecision`: `execute` / `spec` / berkas absen / JSON rusak / `path` tak dikenal | `runner/test/phases.test.ts` (baru) | default fail-safe |
| qa + artefak `execute` → `done` = `[Audit, Execute]`, `skipped` = `[Spec, Plan]` | `runner/test/run.test.ts` | pemangkasan |
| qa + artefak absen → keempat fase `done` | `runner/test/run.test.ts` | regresi jalur penuh |
| qa jalur cepat → `openSession` tetap 1×, `verify` tetap dipanggil sekali | `runner/test/run.test.ts` | gate tak ikut dilewati |
| artefak tertinggal → tak ada lagi di disk saat `commitAndPush` dipanggil | `runner/test/run.test.ts` | temuan 1 |
| `computeProgress` dengan `skipped` → 100% saat 2 done + 2 skipped; 0% saat semua skipped | `server/test/events-io.test.ts` | penyebut |
| `donePhases` resume memuat fase `skipped` | `server/test/worker.test.ts` atau unit predikat | keputusan bertahan |

`fakeDeps` di `run.test.ts` sudah menyuntik `git` dan `verify`; test pemangkasan menulis artefak ke
worktree sementara (pola `withWorktree()` yang sudah ada di berkas itu, `:131-135`).

## ADR

Nomor **ADR-0019**. Dienumerasi ulang saat fase ini atas seluruh `refs/heads` + `refs/remotes` dan
ketiga worktree aktif: tertinggi terpakai `0018`, dan ia **sudah bertabrakan sendiri** —
`0018-coverage-nilai-turunan.md` dan `0018-branch-adalah-properti-backlog-item.md` hidup berdampingan.

**Peringatan tabrakan.** Worktree `.worktrees/run-8804` sedang mengerjakan SPEC-144 dan berada di
fase design (`cccfcb5`); ia belum menulis ADR, tetapi akan mengklaim nomor pada fase Execute-nya.
Enumerasi **wajib diulang** tepat sebelum berkas ADR ditulis. Judul: *Fase perencanaan alur QA
dipangkas oleh keputusan audit*. Berkasnya ditulis pada fase Execute (preseden SPEC-143), ter-link
di `internal/docs/README.md` dalam commit yang sama.

## Ringkasan permukaan

| Berkas | Perubahan |
|---|---|
| `runner/src/phases.ts` | `DECISION_FILE`, `QA_PLANNING`, `readDecision`, sufiks prompt Audit |
| `runner/src/run.ts` | himpunan `pruned`, `continue` + event `skipped`, `rmSync` pra-commit |
| `runner/src/types.ts` | `PhaseState` += `"skipped"` |
| `shared/src/entities.ts` | `zPhase` += `"skipped"` |
| `server/src/runner/events-io.ts` | penyebut `computeProgress` |
| `server/src/worker.ts` | `donePhases` memuat `skipped` |
| `src/src/screens/RunsScreen.tsx` | render `skipped` + konektor |
| `internal/docs/adr/0019-*.md` | ADR (fase Execute) |

Tujuh berkas sumber, tak satu pun berkas baru selain test dan ADR. Tanpa migration, tanpa kolom,
tanpa dependency runtime baru.
