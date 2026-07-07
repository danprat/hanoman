# ADR 0004 — Foundation schema deltas

**Status:** accepted

## Konteks
Prototype `Project` menampilkan field UI (`stack`, `activity`, `commit`, `backlog`,
`topStage`, `run`) yang tidak ada di `data-model.md`. Foundation butuh skema konkret.

## Keputusan
- Kolom **tersimpan** mengikuti `data-model.md` + satu tambahan: `Project.stack` (text)
  — metadata teknologi yang ditampilkan kartu project.
- `activity`, `commit`, `backlog`, `topStage`, `run` **tidak disimpan** — dihitung
  sebagai `ProjectView` DTO dari tabel Run/Spec.
- Payload Spec (brief/qa) disimpan sebagai kolom `payload` jsonb.

## Konsekuensi
- (+) UI prototype ter-port tanpa mengarang skema.
- (−) `ProjectView` menambah join; di-cache bila perlu nanti.
