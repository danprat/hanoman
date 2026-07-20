# SPEC-238 — Setting model & effort per fase

> Design doc (output fase Brainstorm). Sumber: brief SPEC-238, prioritas tinggi.

## Masalah

Saat ini hanoman hanya punya **satu** `model` + **satu** `effort` global (`zSetting`, default
`claude-opus-4-8` / `xhigh`), dipakai apa adanya sebagai `--model`/`--effort` saat SETIAP sesi lahir
(`services/settings.ts` → `sessionModel()` → `createSession`). Operator tak bisa memilih model/effort
berbeda untuk konteks berbeda — mis. Brainstorm/Plan pakai model murah, Execute pakai Opus xhigh.

## Objective (MVP)

Operator dapat mengonfigurasi **model dan effort per fase** (Brainstorm, Objective, Audit, Spec, Plan,
Execute, dan fase reverse/prd/scaffold) untuk **semua flow**, sehingga tiap fase bisa berjalan dengan
model & effort pilihannya. Default tetap **opus / xhigh** (fallback bila sel kosong).

## Kendala arsitektur (fakta yang membentuk desain)

hanoman menjalankan **satu sesi = satu proses `claude`** (ADR-0015/0024). Fase adalah *giliran* di
dalam proses itu, digerakkan agen lewat phase-file — bukan proses terpisah. Konteks sengaja nyambung
antar-fase. Konsekuensi:

- **Model per-fase** hanya bisa lewat agen mengetik `/model <id>` di batas fase. **Terbukti aman
  terhadap konteks**: dokumen Claude Code menyatakan saat ganti model "the next response re-reads the
  full history" — riwayat tidak dihapus/dipangkas oleh `/model`.
- **Effort per-fase** lewat `/effort` **diabaikan di Opus 4.8/4.7 & Fable** ("Not applied",
  model-default effort holds force). Andal penuh hanya di Sonnet/Haiku. `max`/`ultracode` bersifat
  session-only (paling andal di-set saat lahir).

## Keputusan desain (disetujui operator)

1. **Mekanisme: agen-driven `/model` + `/effort`** di batas fase (single proses, ADR tetap utuh).
   *Bukan* proses-per-fase (opsi itu ditolak: perombakan arsitektur besar, membalik ADR-0024/0015).
2. **Sesi lahir dengan (model, effort) fase PERTAMA** pipeline → effort fase-1 dijamin akurat. Fase
   berikutnya di-switch agen; effort di Opus/Fale bersifat **best-effort** (ditandai di UI).
3. **Cakupan: semua flow.** Matrix keyed by `flow → phase → {model?, effort?}`. Sel kosong → fallback
   ke default global `{model, effort}`.
4. **Tambah pilihan:** model `claude-fable-5` (Fable 5); effort `max` dan `ultracode`.

## Bentuk perubahan

### Data (`shared/src/entities.ts` — `zSetting`)

Pertahankan `model`/`effort` global (default opus/xhigh) sebagai **fallback**. Tambah:

```ts
// override per fase; field kosong → fallback ke {model, effort} global
export const zPhaseOverride = z.object({
  model: z.string().optional(),
  effort: z.string().optional(),
});
// keyed by flow name → phase name → override
export const zPhaseModels = z.record(z.string(), z.record(z.string(), zPhaseOverride));
// zSetting += phaseModels: zPhaseModels.default({})
```

Tetap `z.string()` (bukan enum ketat) supaya baris lama & nilai baru tak pernah bikin Settings gagal
parse (sejalan filosofi `getSetting` yang sekarang). Daftar pilihan valid diekspor untuk UI:

```ts
export const MODELS = [
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
  { id: "claude-fable-5",  label: "Fable 5" },   // SPEC-238
];
export const EFFORTS = ["xhigh", "high", "medium", "low", "max", "ultracode"]; // +max +ultracode
```

### Runner (`runner/src/prompt.ts`)

`resolvePhaseModels(flow, overrides, fallback)` → `{ launch: {model, effort}, perPhase: [{phase,
model, effort}] }`. Pure, pakai `PIPELINES[flow]`. `launch` = config fase pertama.

Prompt builder (`startPrompt`/`continuePrompt`/`startProjectPrompt`/`startPrdPrompt`/
`startScaffoldPrompt`) terima param opsional `perPhase`. **Hanya bila ada variasi** (≥1 fase beda dari
fallback) emit blok instruksi per fase — kalau seragam, prompt TAK berubah (backward-compatible dgn
test prompt yang ada). Instruksi menyuruh agen `/model <id>` lalu `/effort <level>` di AWAL tiap fase,
menegaskan konteks nyambung, dan bahwa "Not applied" di Opus/Fable wajar (lanjutkan).

### Server routes (terminal.ts, specs.ts)

Ganti `const { model, effort } = await sessionModel()` di jalur ber-flow (feature/qa/reverse/prd/
scaffold) dengan: baca `setting.phaseModels?.[flow]`, panggil `resolvePhaseModels`, spawn dgn
`launch.{model,effort}` dan lewatkan `perPhase` ke prompt builder. Jalur tanpa fase (plain terminal,
integrate merge, vps) tetap pakai default global.

### Frontend (`src/src/screens/SettingsScreen.tsx`)

Tab "Model sesi": pertahankan default global (Model + Effort), tambah **matrix per fase** —
per flow (feature/qa/reverse/prd/scaffold) grup collapsible berisi tiap fase dgn `Select` Model +
`Select` Effort. Opsi "(default)" = kosong → fallback. Sel effort pada model Opus/Fable diberi hint
"best-effort di tengah sesi". `S_MODELS` += Fable; `S_EFFORT` += max, ultracode.

## SoT yang tersentuh (commit yang sama)

- `internal/docs/architecture/data-model.md` — Setting: field `phaseModels`.
- `internal/docs/architecture/api-contract.md` — bentuk `/settings`.
- `internal/docs/frontend/frontend-implementation.md` — matrix per-fase di Settings.
- `internal/docs/adr/0057-model-effort-per-fase.md` — ADR baru (menghidupkan kembali per-fase via
  `/model`+`/effort` in-session; mengamandemen sikap "satu model per sesi" ADR-0024, terkait ADR-0003).
- `internal/docs/README.md` — link ADR-0057.
- `internal/skills/hanoman/SKILL.md` — perbarui baris "Satu --model/--effort per sesi".

## Testing (TDD)

- **shared:** `zSetting` menerima `phaseModels`; baris lama tanpa `phaseModels` tetap parse; MODELS/
  EFFORTS memuat fable/max/ultracode.
- **runner:** `resolvePhaseModels` (launch = fase-1, fallback benar); prompt TAK berubah bila seragam;
  prompt memuat baris `/model`+`/effort` per fase bila ada override.
- **server:** `/settings` round-trip `phaseModels`; sesi feature dgn override Brainstorm lahir dgn
  `--model/--effort` fase-1 (argv pty); default global tetap untuk plain terminal.
- **frontend:** matrix per-fase render; simpan meng-PUT `phaseModels`.

## Non-goals (YAGNI)

- Override per-instance-sesi saat Start (matrix global sudah "berlaku di setiap sesi").
- Proses-per-fase / respawn `--resume` (ditolak — arsitektur).
- Enum ketat model/effort di server (tetap `z.string()` forward-compatible).
