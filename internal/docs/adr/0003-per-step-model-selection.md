# ADR 0003 — Pemilihan model per step

**Status:** accepted

## Konteks
Langkah berbeda punya kebutuhan berbeda: brainstorm/plan menuntut penalaran tinggi; langkah mekanis bisa model lebih murah. Biaya harus terkendali.

## Keputusan
Model + effort dikonfigurasi **per step** (brainstorm/spec/plan/execute/audit) di Settings. Default: **claude-opus-4, effort x-high** untuk semua step; operator bisa menurunkan per step. Runner memakai model step aktif.

## Konsekuensi
- (+) Kualitas vs biaya bisa diseimbangkan halus.
- (−) Lebih banyak konfigurasi; perlu default aman (opus/x-high).
