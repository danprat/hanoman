# ADR-0035 — Sesi menembus batas fase tanpa berhenti kecuali butuh keputusan manusia

**Status:** accepted · **Date:** 2026-07-11 · **Spec:** SPEC-187

**Bersandar pada:** ADR-0024 · **Melanjutkan tema:** ADR-0020, ADR-0022

## Konteks

Sejak ADR-0024 sebuah backlog item dikerjakan Claude Code **interaktif** di satu sesi tmux.
Fase (`Brainstorm → Objective → Spec → Plan → Execute`, atau `Audit → Spec → Plan → Execute`
untuk qa) menjadi **giliran** di dalam sesi yang sama — dan agen sendirilah penggeraknya.
Server tak pernah mengetik ke pane (`writeTo` hanya terpicu input WebSocket dari manusia).

Prompt awal (`runner/src/prompt.ts`) mewajibkan skill superpowers per fase. Skill-skill itu
manusia-in-the-loop menurut rancangannya: `brainstorming` menutup dengan menyodorkan desain
untuk dikonfirmasi, `writing-plans` menghasilkan plan yang dimaksudkan untuk direview,
`executing-plans` secara harfiah "execute … with **review checkpoints**". Karena prompt tak
mengatakan apa pun soal kontrak otonomi antar-fase, agen mematuhi default skill: ia **mengakhiri
giliran** di tiap batas fase untuk menunggu review — brainstorm→spec, spec→plan, plan→execute.

Di model headless lama (`runOne`) berhentinya agen tak jadi soal: runner menyuntik prompt baru
per fase, jadi giliran berikutnya tetap datang. ADR-0024 mencabut penggerak itu. Yang tersisa:
sesi yang mandek di tiap batas fase, menunggu review dari manusia yang — dalam sesi otonom —
tak akan pernah datang. Itulah gejala SPEC-187: "claude tiap fase stop meskipun ga ada decision".

## Keputusan

Prompt awal sesi spec-flow membawa **kontrak otonomi** eksplisit:

1. Jalankan seluruh pipeline sampai tuntas **tanpa berhenti** di batas antar-fase.
2. Checkpoint "review/approval/need review" milik skill **bukan** titik berhenti di sini —
   lanjut saja ke fase berikutnya.
3. Berhenti **hanya** saat butuh keputusan manusia sejati (percabangan yang mengubah bentuk
   kerja — data model, kontrak API, scope). Saat itu tanyakan di terminal dan tunggu jawaban
   manusia di sana (ADR-0024: "agen bertanya di terminalnya, manusia menjawab di sana").

Kontrak ini hidup di satu tempat — pembangun prompt (`autonomyClause`) yang di-share
`startPrompt` dan `continuePrompt` — karena skill superpowers adalah plugin eksternal yang tak
kita miliki; prompt adalah tuas hanoman satu-satunya atas perilaku agen dalam sesi.

## Konsekuensi

- Sesi spec-flow berjalan dari fase pertama sampai `Execute done` dalam satu rangkaian giliran,
  tanpa mandek diam menunggu review yang tak berpenunggu.
- "Berhenti untuk keputusan" menyusut ke maknanya yang benar: percabangan yang mengubah bentuk
  kerja, disurfacekan agen sebagai pertanyaan di terminal — bukan jeda review rutin.
- **`startProjectPrompt` (reverse) sengaja dikecualikan.** Fase Wawancara-nya memang interaktif:
  satu pertanyaan per giliran ke manusia di terminal. Kontrak "jangan berhenti antar-fase" akan
  menabraknya, jadi tak dipasang di situ.
- Gerbang manusia-wajib sesudah Audit tetap ditolak (ADR-0020, ADR-0022): yang ditambah bukan
  gerbang, melainkan penegasan bahwa satu-satunya alasan sah untuk berhenti adalah keputusan.
