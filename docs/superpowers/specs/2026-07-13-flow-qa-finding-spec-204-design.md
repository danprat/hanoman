# SPEC-204 — Flow QA Finding (jalur cepat pasca-Audit)

**Tanggal:** 2026-07-13 · **Prioritas:** sedang · **Sumber:** brief

## Objective

Bila hasil fase **Audit** berconfidence tinggi dan perbaikannya bisa dikerjakan langsung,
sesi QA **melewati Spec dan Plan** dan langsung ke Execute. Saat ini setiap temuan QA
membayar full flow (Spec → Plan) meski perbaikannya satu diff kecil.

## Konteks & temuan

Pipeline `qa` = `Audit → Spec → Plan → Execute` (`runner/src/prompt.ts`).

Seluruh **mesin jalur cepat sudah ada dan teruji** — yang hilang hanya instruksi di prompt:

- `server/src/services/session-phases.ts` sudah memetakan `Spec skipped`/`Plan skipped` →
  state `skipped`, mengeluarkannya dari penyebut progress, dan memajukan stage ke `planned`.
- `planComplete()` mengembalikan `true` saat jalur cepat tak meninggalkan file plan; `stageForRun()`
  tetap menggerbang Execute pada kelengkapan plan (aman).
- `server/test/session-phases.test.ts` sudah menegaskan
  `Audit done, Spec skipped, Plan skipped → Execute active`, stage `planned`.
- **ADR-0020** sudah **memutuskan** kebijakan ini; `internal/docs/operations/agent-documentation-workflow.md`
  dan `internal/docs/frontend/frontend-implementation.md` sudah **mendokumentasikannya**.

Yang **hilang**: prompt flow `qa` (`startPrompt`) menyuruh agen mengerjakan fase berurutan dan
hanya menyebut `skipped` sebagai mekanik pelaporan generik. Ia tak pernah menyuruh agen
**mengambil keputusan audit** — sehingga agen menjalankan full flow tiap kali. Ini persis
konteks brief: "pada saat qa finding masih full flow spec, plans".

Mekanisme lama ADR-0020 (`runOne` membaca artefak `.hanoman-decision.json`) **sudah tidak ada**
di kode — digantikan model agen-menggerakkan-diri (ADR-0035). Tak ada lagi yang membaca artefak.

## Keputusan desain

Perubahan **hanya di prompt**. Tambahkan klausa khusus `qa` ke `startPrompt` lewat helper kecil
`auditDecisionInstruction(flow)` (mengembalikan `""` untuk flow non-`qa`, meniru pola
`skillInstruction`). Isi klausa:

> Fase Audit qa memutuskan jalur. Bila temuan berconfidence tinggi dan perbaikannya langsung
> (diff kecil, akar masalah jelas), **LEWATI Spec dan Plan** — tandai keduanya `skipped`
> (`echo "Spec skipped" >> "$HANOMAN_PHASE_FILE"`, `echo "Plan skipped" >> …`) lalu langsung
> Execute; dokumen audit menjadi doc-of-record perbaikan itu. Bila temuan luas / berisiko /
> ambigu, jalankan Spec → Plan → Execute penuh. Keputusan ini milikmu berdasarkan hasil Audit.

Confidence tetap **penilaian tingkat-prompt satu-bit** (ADR-0020: "Confidence hidup di instruksi
prompt"), disurface sebagai `skipped` + `reason` audit di log run. Tak ada gerbang runner baru,
tak ada perubahan skema/API, tak ada dependensi baru.

## Komponen tersentuh

- `runner/src/prompt.ts` — helper `auditDecisionInstruction(flow)` + sisipkan ke array `startPrompt`.
- `runner/test/prompt.test.ts` — prompt `qa` memuat instruksi jalur cepat; prompt `feature` tidak.
- `internal/docs/adr/0040-*.md` — ADR baru: keputusan jalur cepat dielicit lewat prompt, diputuskan
  agen via phase file (menggantikan mekanisme artefak-runner ADR-0020).
- `internal/docs/adr/0020-*.md` — catatan status: mekanismenya disuperseded ADR-0040.
- `internal/docs/operations/agent-documentation-workflow.md` — segarkan referensi ADR (+ SPEC-204/ADR-0040).
- `internal/docs/README.md` — daftarkan ADR-0040 di index.

## Di luar scope (ponytail)

- Tak ada perubahan data model / kontrak API / gerbang runner.
- Tak ada skor confidence numerik terpisah — keputusan tetap satu-bit lewat `skipped`.
- Hanya `qa`; `feature` tak punya niat "lewati planning".
- Anti-injeksi lebih berat ditambah hanya bila muncul kasus nyata (phase file sudah di luar
  worktree → agen `git add -A` tak bisa menyentuhnya, sudah aman by design).

## Testing

- Unit: `runner/test/prompt.test.ts` (di atas).
- Nyata: boot server + spawn tak diperlukan untuk memverifikasi teks prompt; verifikasi prompt
  `qa` vs `feature` cukup lewat unit test. Jalur cepat state-machine sudah dijamin
  `session-phases.test.ts` yang ada.
