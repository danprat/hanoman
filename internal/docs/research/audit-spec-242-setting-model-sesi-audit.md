# audit SPEC-242 — Setting model & effort untuk sesi audit tidak ada di UI

**Spec:** SPEC-242 · **Sumber:** qa · **Prioritas:** tinggi · **Tanggal:** 2026-07-20
**Terkait:** [ADR-0058](../adr/0058-model-effort-per-fase.md) (model & effort per fase),
[ADR-0057](../adr/0057-audit-only-source-flow.md) (audit-only source + flow `Audit → Laporan`)

## Temuan

Backlog: *"pada sesi audit juga diperlukan setup model dan effort"* — di layar **Settings → Model
sesi** tidak ada baris untuk flow `audit`, sehingga operator tak bisa menyetel model/effort per
fase (`Audit`, `Laporan`) untuk sesi audit.

## Akar masalah

SPEC-238/ADR-0058 memperkenalkan matrix `phaseModels` (flow → phase → {model, effort}). UI-nya di
`src/src/screens/SettingsScreen.tsx` memakai konstanta lokal `FLOW_PHASES` yang **mencerminkan**
runner `PIPELINES` (`runner/src/prompt.ts`) dengan komentar *"cerminan runner PIPELINES (keep in
sync)"*.

SPEC-237/ADR-0057 kemudian menambah flow baru `audit: ["Audit", "Laporan"]` ke `PIPELINES` — tetapi
`FLOW_PHASES` di UI **tak ikut diperbarui**. Jadi cerminan itu tertinggal (drift):

- `runner/src/prompt.ts` `PIPELINES` → punya `audit`, `qa`, `feature`, `reverse`, `prd`, `scaffold`.
- `src/src/screens/SettingsScreen.tsx` `FLOW_PHASES` → hanya `feature`, `qa`, `reverse`, `prd`,
  `scaffold`. **`audit` hilang.**

Sisi server/runner sudah lengkap: `zFlow` (`shared/src/dto.ts`) memuat `audit`, dan
`phaseModelsForFlow("audit")` (`server/src/services/settings.ts` → `resolvePhaseModels`) me-resolve
fase `Audit`/`Laporan` dengan benar saat sesi audit lahir (`server/src/routes/terminal.ts:80`).
Satu-satunya celah adalah **UI Settings tidak mengekspos baris audit**, jadi override tak pernah bisa
diisi operator (nilai selalu jatuh ke fallback global).

## Perbaikan (confidence tinggi, diff kecil)

Tambahkan baris `audit` ke `FLOW_PHASES` agar cerminan kembali sinkron dengan `PIPELINES.audit`:

```ts
{ flow: "audit", label: "Audit-only", phases: ["Audit", "Laporan"] },
```

Karena akar masalah jelas dan perbaikannya satu baris, fase **Spec** dan **Plan** di-`skipped`;
dokumen ini menjadi doc-of-record perbaikan (jalur cepat qa, ADR-0040).

## Verifikasi

- Test UI (`src/test/phase-models.test.tsx`) diperluas: tab "Model sesi" menampilkan fase `Laporan`
  (unik ke flow audit) + label "Audit-only".
- Boot server + GET/PUT `/settings` dengan `phaseModels.audit.Audit` untuk memastikan round-trip utuh
  (AC-1 ADR-0058 berlaku untuk semua flow).
