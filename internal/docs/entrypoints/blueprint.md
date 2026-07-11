# hanoman — blueprint

> **Source of Truth.** `internal/docs/**` adalah kebenaran secara konvensi — diperbarui tiap commit yang menyentuhnya. Tidak lagi ditegakkan mesin (guardrail dicabut, SPEC-160/ADR-0023).

**hanoman** adalah orchestrator workflow docs-driven untuk nafanesia.id. Ia menyuruh **Claude Code** membangun project terhadap dokumentasi sebagai kebenaran, dan memantau semua sesi dalam satu dashboard.

## Ringkasan satu paragraf
Manusia menuang ide / menulis brief / memfilekan QA finding. hanoman brainstorm sampai **MVP objective** terkunci, lalu **scaffold** seluruh doc index (from-scratch) atau **reverse-engineer** docs dari codebase (existing). Brief & finding menjadi **spec** di backlog; spec di-**plan** lalu di-**execute** oleh Claude Code sebagai **sesi interaktif** di **git worktree terisolasi** per backlog. Setiap langkah menjaga docs tetap sinkron secara konvensi, bukan lewat gerbang mekanis.

## Objektif MVP
Satu operator bisa menjalankan & memantau Claude Code di banyak project sekaligus, dengan docs sebagai Source of Truth, tanpa kehilangan kendali atas sesi yang berjalan.

## Doc inti
| Doc | Isi |
|---|---|
| `requirements/prd.md` | Kebutuhan produk detail |
| `architecture/data-model.md` | Tujuh model (project/spec/setting/notification/user/session/vps) |
| `architecture/stack.md` | Pilihan teknologi |
| `operations/agent-documentation-workflow.md` | Kontrak agent |

## Empat lakon (temperamen produk)
- **Anoman Duta** — kepercayaan dibuktikan: spec & docs adalah bukti sebuah plan boleh jalan.
- **Anoman Obong** — sesi menyelesaikan tugas dan lapor balik.
- **Gunung Dronagiri** — ragu? dokumentasikan semuanya.
- **Chiranjivi** — docs (Source of Truth) abadi melampaui commit.
