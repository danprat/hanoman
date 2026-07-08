# ADR 0003 — Pemilihan model per step

**Status:** accepted

## Konteks
Langkah berbeda punya kebutuhan berbeda: brainstorm/plan menuntut penalaran tinggi; langkah mekanis bisa model lebih murah. Biaya harus terkendali.

## Keputusan
Model + effort dikonfigurasi **per step** (brainstorm/spec/plan/execute/audit) di Settings. Default: **claude-opus-4-8, effort x-high** untuk semua step; operator bisa menurunkan per step. Runner memakai model step aktif. ID model terkini: `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5-20251001`.

## Konsekuensi
- (+) Kualitas vs biaya bisa diseimbangkan halus.
- (−) Lebih banyak konfigurasi; perlu default aman (opus/x-high).

## Catatan implementasi (SPEC-003)
Runner memetakan effort → `maxThinkingTokens` (`xhigh`→32k, `high`→16k, `medium`→8k, `low`→2k) dan meneruskan `model` step ke Agent SDK per fase. Settings menyimpan effort sebagai `xhigh` (bukan `x-high`).
