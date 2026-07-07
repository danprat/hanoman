# hanoman — blueprint

> **Source of Truth.** Tidak ada plan yang boleh execute melewati doc yang stale.

**hanoman** adalah orchestrator workflow docs-driven untuk nafanesia.id. Ia menyuruh **Claude Code** membangun project terhadap dokumentasi sebagai kebenaran, dan memantau semua run dalam satu dashboard.

## Ringkasan satu paragraf
Manusia menuang ide / menulis brief / memfilekan QA finding. hanoman brainstorm sampai **MVP objective** terkunci, lalu **scaffold** seluruh doc index (from-scratch) atau **reverse-engineer** docs dari codebase (existing). Brief & finding menjadi **spec** di backlog; spec di-**plan** lalu di-**execute** oleh Claude Code di **git worktree terisolasi**, dipicu oleh trigger (schedule / commit / manual / interval). Setiap langkah menjaga docs tetap sinkron; Stop hook memblokir plan bila docs stale.

## Objektif MVP
Satu operator bisa menjalankan & memantau Claude Code di banyak project sekaligus, dengan docs sebagai Source of Truth yang ditegakkan, tanpa kehilangan kendali atas run yang berjalan.

## Doc inti
| Doc | Isi |
|---|---|
| `requirements/prd.md` | Kebutuhan produk detail |
| `architecture/data-model.md` | Skema project/spec/run/trigger |
| `architecture/stack.md` | Pilihan teknologi |
| `operations/agent-documentation-workflow.md` | Kontrak agent |

## Empat lakon (temperamen produk)
- **Anoman Duta** — kepercayaan dibuktikan: spec & docs adalah bukti sebuah plan boleh jalan.
- **Anoman Obong** — run menyelesaikan tugas dan lapor balik.
- **Gunung Dronagiri** — ragu? dokumentasikan semuanya.
- **Chiranjivi** — docs (Source of Truth) abadi melampaui commit.
