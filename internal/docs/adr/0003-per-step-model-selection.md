# ADR 0003 — Pemilihan model per step

**Status:** de-facto obsolete — [ADR-0024](0024-sesi-interaktif-menggantikan-run.md) (SPEC-162) mengganti model-per-fase dengan **satu** `model`/`effort` per sesi interaktif (`Setting.model`/`effort`); `steps` per fase dihapus. Manusia bisa `/model` di dalam terminal.

## Konteks
Langkah berbeda punya kebutuhan berbeda: brainstorm/plan menuntut penalaran tinggi; langkah mekanis bisa model lebih murah. Biaya harus terkendali.

## Keputusan
Model + effort dikonfigurasi **per step** (brainstorm/spec/plan/execute/audit) di Settings. Default: **claude-opus-4-8, effort x-high** untuk semua step; operator bisa menurunkan per step. Runner memakai model step aktif. ID model terkini: `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5-20251001`.

## Konsekuensi
- (+) Kualitas vs biaya bisa diseimbangkan halus.
- (−) Lebih banyak konfigurasi; perlu default aman (opus/x-high).

## Catatan implementasi (SPEC-003)
Runner memetakan effort → `maxThinkingTokens` (`xhigh`→32k, `high`→16k, `medium`→8k, `low`→2k) dan meneruskan `model` step ke Agent SDK per fase. Settings menyimpan effort sebagai `xhigh` (bukan `x-high`).
