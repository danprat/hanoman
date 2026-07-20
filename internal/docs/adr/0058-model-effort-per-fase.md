# ADR-0058 — Model & effort per fase, lewat `/model`+`/effort` in-session

**Status:** accepted · **Date:** 2026-07-20 · **Spec:** SPEC-238
**Terkait:** [ADR-0024](0024-sesi-interaktif-menggantikan-run.md) (sesi = satu proses; men-drop
`steps` model-per-fase), [ADR-0003](0003-per-step-model-selection.md) (pemilihan model per step —
*de-facto obsolete per 0024*, sebagian dihidupkan kembali di sini dengan mekanisme berbeda),
[ADR-0015](0015-one-session-per-backlog.md) (satu backlog satu sesi), [ADR-0035](0035-sesi-lanjut-fase-tanpa-berhenti-kecuali-keputusan.md)
(sesi menembus batas fase), [ADR-0012](0012-cost-is-an-estimate-not-a-guardrail.md) (biaya = estimasi)

## Context
Sejak ADR-0024 hanoman punya **satu** `model` + **satu** `effort` global (`zSetting`, default
`claude-opus-4-8`/`xhigh`), dipakai sebagai `--model`/`--effort` saat SETIAP sesi lahir. `steps`
(model per fase, ADR-0003) di-drop karena sesi kini **satu proses `claude`** dan fase adalah *giliran*
di dalamnya (bukan proses terpisah) — jadi tak ada titik alami untuk menyuntik model berbeda per fase.

SPEC-238: operator ingin memilih **model dan effort per fase** (Brainstorm, Objective, Audit, Spec,
Plan, Execute, plus fase reverse/prd/scaffold) untuk semua flow — mis. Brainstorm/Plan pakai model
murah, Execute pakai Opus xhigh.

Dua fakta CLI membentuk keputusan:
- **`/model` di tengah sesi aman terhadap konteks.** Dokumen Claude Code: saat ganti model, *"the next
  response re-reads the full history"* — riwayat tak dihapus/dipangkas. Jadi kontinuitas fase (alasan
  ADR-0015/0024 memakai satu-proses) tetap terjaga meski model berganti.
- **`/effort` diabaikan di Opus 4.8/4.7 & Fable** ("Not applied", model-default effort holds force).
  Andal penuh hanya di Sonnet/Haiku. `max`/`ultracode` bersifat session-only.

## Decision
Hidupkan kembali **model & effort per fase** — bukan lewat `steps` headless lama (ADR-0003), tapi lewat
**agen mengetik `/model` + `/effort` di batas fase** dalam satu proses sesi (ADR-0015/0024 tetap utuh).

1. **Konfigurasi di `zSetting.phaseModels`** — map `flow → phase → { model?, effort? }`. Field kosong
   → fallback ke `{ model, effort }` global. `model`/`effort` tetap `z.string()` (bukan enum ketat)
   agar baris lama & nilai baru tak pernah bikin Settings gagal parse. Baris Setting lama tanpa
   `phaseModels` tetap valid (`.default({})`).

2. **Sesi lahir dengan (model, effort) fase PERTAMA** pipeline (`resolvePhaseModels(flow, overrides,
   fallback).launch`). Maka effort fase-1 **dijamin akurat** — termasuk di Opus. Fase berikutnya
   di-switch agen.

3. **Prompt menyuntik instruksi per-fase** (`runner/src/prompt.ts`) — HANYA bila ada variasi (≥1 fase
   beda dari fallback); bila seragam, prompt tak berubah (regresi nol pada prompt yang seragam). Agen
   disuruh `/model <id>` lalu `/effort <level>` di AWAL tiap fase, diberi tahu konteks tetap nyambung,
   dan bahwa "Not applied" di Opus/Fable itu wajar (lanjutkan).

4. **Effort per-fase bersifat best-effort di Opus/Fable** (butir 2 menjamin fase-1; fase Opus
   berikutnya mengikuti effort saat lahir). UI menandai sel effort model Opus/Fable. Sonnet/Haiku
   penuh andal. Ini diterima sebagai batas CLI, bukan cacat hanoman.

5. **Cakupan semua flow** (feature/qa/reverse/prd/scaffold). Jalur tanpa fase (plain terminal,
   integrate merge, vps) tetap pakai default global.

6. **Pilihan baru:** model `claude-fable-5`; effort `max` dan `ultracode`. Diekspor sebagai `MODELS`/
   `EFFORTS` di `@hanoman/shared` untuk dipakai UI (server tetap lenient `z.string()`).

## Alternatif ditolak
- **Proses-per-fase (respawn `claude --resume` dengan `--model/--effort` tepat tiap fase).** Memberi
  effort per-fase 100% akurat termasuk Opus, TAPI membalik ADR-0024/0015 (satu sesi=satu proses, live
  tmux attach), butuh server mengorkestrasi respawn + deteksi transisi fase — persis orkestrasi yang
  dicabut ADR-0024. Jauh lebih berisiko & kompleks. Ditolak.
- **Hidupkan kembali `steps` headless (ADR-0003 apa adanya).** Tak berlaku: tak ada lagi runner
  headless yang men-spawn per step. Ditolak.
- **Enum ketat model/effort di server.** Rapuh terhadap model/effort baru; melanggar filosofi
  `getSetting` yang forward-compatible. Ditolak — daftar valid hidup di UI, server lenient.
- **Override per-instance saat Start (picker di modal Start).** Matrix global "berlaku di setiap sesi"
  sudah memenuhi objective; picker per-instance = scope tambahan tanpa permintaan. Ditunda (YAGNI).

## Consequences
- Operator dapat model & effort per fase untuk semua flow; default tetap opus/xhigh (fallback).
- Tanpa perubahan skema Prisma — `phaseModels` hidup di dalam `Setting.data` (Json). Aditif & wire-
  compatible; baris lama tetap parse.
- Prompt sesi bertambah blok instruksi per-fase **hanya saat ada variasi** — sesi tanpa override tak
  berubah perilaku.
- Effort per-fase di Opus/Fable best-effort (fase-1 akurat); operator diberi tahu lewat UI.
- Sikap "satu `--model`/`--effort` per sesi" (ADR-0024, SKILL.md) diamandemen: masih satu proses, tapi
  model/effort boleh berganti antar-fase dari konfigurasi, bukan hanya ketikan `/model` manual.

## Acceptance (EARS)
- **AC-1** — WHERE operator menyetel `phaseModels[flow][phase]`, THE server SHALL menyimpannya di
  `Setting.data` dan mengembalikannya utuh via `GET /settings`.
- **AC-2** — WHEN sesi ber-flow lahir dan fase pertamanya punya override, THE sesi SHALL di-spawn
  dengan `--model`/`--effort` fase pertama itu.
- **AC-3** — WHEN sebuah flow punya ≥1 override berbeda dari default, THE prompt sesi SHALL memuat
  instruksi per-fase `/model`+`/effort` untuk tiap fase pipeline itu.
- **AC-4** — WHERE seluruh fase sebuah flow resolve ke model+effort yang sama (tanpa override), THE
  prompt SHALL tak memuat blok instruksi per-fase (regresi nol).
- **AC-5** — WHERE sel `phaseModels` kosong, THE resolusi SHALL jatuh ke `{ model, effort }` global.
- **AC-6** — THE daftar model SHALL memuat `claude-fable-5` dan daftar effort SHALL memuat `max` &
  `ultracode`, di samping pilihan yang sudah ada.
- **AC-7** — THE baris `Setting` lama tanpa `phaseModels` SHALL tetap parse (default `{}`), tanpa
  membuat layar Settings kosong.
