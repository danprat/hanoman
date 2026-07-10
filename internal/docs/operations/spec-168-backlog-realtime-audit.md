# SPEC-168 — audit: backlog tidak update saat terminal berganti state

Fase **Audit** dari alur QA (audit → spec → plan → execute). Dokumen ini menetapkan akar
masalah dan batas perbaikannya. **Tidak ada perubahan kode di fase ini.**

- Sumber: backlog qa · prioritas tinggi · severity `major`
- Hilir: [spec SPEC-168](spec-168-backlog-realtime-spec.md)
- Gejala: sesi terminal sebuah backlog item sudah berganti fase (Brainstorm → Objective →
  Spec → …), terlihat di strip fase terminalnya, tapi kartu backlog tetap diam di stage
  lamanya. Diharapkan: board backlog ikut maju saat terminal berpindah state, real time.

## Akar masalah

`Spec.stage` **hanya ditulis ke DB saat sesi ditutup.** Satu-satunya yang memajukan stage
adalah `advanceStage()` (`server/src/routes/terminal.ts:20-26`), dan pemanggilnya **tunggal**:
handler `DELETE /terminal/sessions/:id` (`terminal.ts:121`).

```ts
// terminal.ts:121 — satu-satunya pemanggil advanceStage
if (s.specId) await advanceStage(s.specId, project.repoDir, id, s.flow);
```

Selama sesi hidup, kemajuan nyata memang terjadi — agen meng-append transisi ke
`$HANOMAN_PHASE_FILE`, dan `pollPhases()` (`server/src/services/pty.ts:203-210`) membacanya
tiap 500ms lalu menyiarkan frame `{t:"phase"}`. Tapi siaran itu **hanya ke WebSocket
terminal sesi itu**; ia tak pernah menyentuh `Spec.stage` di DB.

Sisi backlog membaca `Spec.stage` lewat `GET /specs` (`server/src/routes/specs.ts:13-16`,
`prisma.spec.findMany`). Frontend memanggilnya via `api.listSpecs()` dan me-render
`spec.stage` di `StageBar` (`src/src/screens/BacklogScreen.tsx:23`). App bahkan **sudah**
punya poll 3 detik selama ada sesi hidup (`src/src/App.tsx:304-312`) — tapi poll itu
membaca nilai DB yang sama-sama beku, jadi tak ada yang berubah. Kode mendokumentasikan
keadaan ini sebagai disengaja: `App.tsx:301-302` ("Stage bergerak saat sesi ditutup"),
`terminal.ts:18-19`.

Jadi ini **bukan** arsitektur realtime yang hilang dan **bukan** poll frontend yang mati.
Poll sudah jalan dan sudah 3 detik. Yang hilang adalah **sumber datanya tak pernah bergerak
sampai sesi mati**: `GET /specs` mengembalikan nilai persist, sementara kebenaran hidup di
berkas fase sesi.

## Pola di codebase: simpan seminimalnya, turunkan saat dibaca

hanoman berulang kali memilih **menurunkan nilai dari disk saat dibaca**, bukan mempersist
tiap transisi:

- `docStatus`/`coverage` **bukan kolom** — diturunkan dari disk tiap `toProjectView`
  (ADR-0018, `data-model.md:11,49`).
- SHA disimpan, diff/daftar-file diturunkan dari git saat `GET /runs/:id/changes` dibaca,
  tak pernah dipersist (ADR-0019, `data-model.md:33-34`).
- Fase aktif sendiri "diturunkan, tidak disimpan" (ADR-0024, `session-phases.ts:32`).

Stage sebuah sesi hidup persis kategori itu: kebenarannya ada di `$HANOMAN_PHASE_FILE`, dan
`stageFor(readPhases(...))` (`session-phases.ts:47-60`) sudah bisa memetakannya. Yang perlu
ditambahkan cuma: **`GET /specs` menurunkan stage live dari berkas fase untuk spec yang
punya sesi**, forward-only (ADR-0008), sebelum mengembalikannya.

## Kenapa bukan "persist tiap transisi" (alternatif yang ditolak)

Wiring `pollPhases()` → `advanceStage()` (menulis DB tiap fase berubah) juga menutup tiket,
tapi lebih mahal dan melawan lapisan yang ada:

- `pty.ts` sengaja tak tahu soal DB (tak ada import prisma; `pty.ts:29`). Menulis stage dari
  situ menuntut callback/hook menembus lapisan itu.
- `pollPhases` hanya jalan selama **ada WebSocket terminal yang menempel** (`startPoll`
  dijaga `attached.size > 0`, `pty.ts:216-229`). Kalau tak ada yang menonton terminalnya,
  poll mati dan DB tak pernah diperbarui — board tetap basi. Menurunkan saat dibaca tidak
  bergantung pada WS: `GET /specs` membaca pane + berkas fase langsung.
- Menulis Postgres tiap 500ms transisi adalah write-amplification untuk nilai yang toh
  sudah ada di disk.

`advanceStage` di DELETE **tetap** — ia mempersist keadaan final sesudah worktree dibuang,
jadi stage durabel setelah sesi hilang. Turunan-saat-baca melengkapinya selama sesi hidup.

## Rekomendasi untuk fase Spec

1. Di `pty.ts` tambah satu helper batch — satu `list-panes`, kembalikan `Map<specId,
   Phase[]>` untuk tiap pane ber-`specId`+`flow`+`phaseFile`. Batch supaya `GET /specs`
   tidak memicu satu `tmux list-panes` per spec.
2. Di `GET /specs`, untuk tiap spec yang punya entri di map itu, hitung `stageFor(phases)`
   dan pakai bila **lebih maju** dari `spec.stage` (forward-only, ADR-0008). Kalau tak ada
   sesi sama sekali, kembalikan hasil prisma apa adanya.
3. Frontend **tidak berubah**: poll 3 detik yang sudah ada (`App.tsx:304-312`) akan
   memunculkan stage turunan dalam ≤3 detik.
4. Satu tes route: spec + berkas fase palsu → `GET /specs` melaporkan stage turunan; tanpa
   sesi → stage persist apa adanya; berkas fase yang lebih mundur dari persist → tak menyeret
   stage mundur.

## Catatan laten (di luar cakupan SPEC-168)

- Sesi yang mati di luar hanoman (pane `dead`, belum di-DELETE) tak pernah men-trigger
  `advanceStage`; stage persist-nya membeku sampai ada yang menutupnya. Turunan-saat-baca
  ikut menutup ini selama pane-nya masih ada di tmux (berkas fasenya masih terbaca), tapi
  finalisasi durabel tetap milik DELETE. Dicatat, bukan diperbaiki khusus di sini.
- `createSession`/`POST /terminal/sessions` mengembalikan sesi `existing` tanpa mengecek
  `exited` (`pty.ts:112-113`, `terminal.ts:48-49`): pane mati bisa menghalangi start ulang.
  Terpisah dari tiket ini.

## Verifikasi

Akar masalah dipastikan lewat pembacaan kode statis, bukan reproduksi runtime. Reproduksi
menuntut `POST /terminal/sessions` yang men-spawn `claude` + tmux sungguhan — efek samping
yang tidak boleh diambil fase Audit. Seluruh klaim berjangkar pada `file:baris` yang dikutip
dan dapat diperiksa ulang secara statis. Perilaku "stage hanya bergerak saat ditutup"
dikonfirmasi oleh dua komentar in-code yang menyatakannya sebagai desain (`App.tsx:301-302`,
`terminal.ts:18-19`) dan oleh grep: satu-satunya penulis `Spec.stage` selain seed `create`
adalah `advanceStage` di jalur DELETE.

## Rujukan

- ADR-0024 — [sesi interaktif menggantikan run](../adr/0024-sesi-interaktif-menggantikan-run.md): asal berkas fase & stage yang "hanya bergerak sejauh agen melaporkannya".
- ADR-0018 — branch/derive-from-disk: preseden `docStatus`/`coverage` diturunkan, bukan dipersist.
- ADR-0019 — [SHA disimpan, diff diturunkan](../adr/0019-sha-disimpan-diff-diturunkan.md): preseden turunan-saat-baca.
- ADR-0008 — stage hanya maju (cermin fase).
- [agent-documentation-workflow](agent-documentation-workflow.md): alur QA audit → spec → plan → execute.
