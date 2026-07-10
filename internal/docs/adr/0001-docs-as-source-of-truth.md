# ADR 0001 — Docs sebagai Source of Truth

**Status:** superseded oleh [ADR-0023](0023-guardrail-sot-dicabut.md) (SPEC-160) · guardrail SoT dicabut; docs kini konvensi, bukan gate

## Konteks
Agent yang membangun di atas asumsi menghasilkan drift. Kita butuh satu kebenaran yang ditegakkan secara mekanis.

## Keputusan
`internal/docs/**` adalah Source of Truth. **Stop hook** (`hanoman docs verify --block-if-stale`) memblokir transisi plan→execute bila doc acuan stale atau belum ter-link di index. Coverage dihitung dari kategori yang ter-link.

## Konsekuensi
- (+) Output agent konsisten dengan niat; drift ketahuan cepat.
- (−) Butuh disiplin menjaga index; menambah langkah verify tiap run.
