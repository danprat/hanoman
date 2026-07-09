# SPEC-142 — Spec: status run auto-update dari `queued`

**Fase:** Spec (dikunci) · 2026-07-09
**Jenis:** QA — alur audit → **spec** → plan → execute
**Source of Truth:** `internal/docs/**` — dokumen ini subordinat terhadapnya.
**Hulu:** [audit SPEC-142](spec-142-runs-status-auto-update-audit.md).
**Turunan:** plan → [`docs/superpowers/plans/2026-07-09-hanoman-runs-status-auto-update-spec-142.md`](../../../docs/superpowers/plans/2026-07-09-hanoman-runs-status-auto-update-spec-142.md).

## Masalah

Daftar run membeku di `queued` sampai operator me-refresh. Poll 3 detik yang menjadi
satu-satunya mekanisme refresh daftar dijaga oleh predikat yang lupa menghitung `queued`:

```js
// src/src/App.tsx:303
const anyRunActive = runs.some((r) => r.status === "running" || r.status === "paused");
```

Run baru selalu lahir `queued` (`server/src/queue.ts:43,46`), jadi gate ini `false`, poll tak
pernah menyala, dan baris tak pernah refetch. Setelah status terbaca `running` — lewat refresh
manual, atau karena ada run lain yang sudah aktif — poll menyala dan semuanya berjalan. Akar
lengkapnya, termasuk mengapa SSE tidak menutupi lubang ini, ada di dokumen audit.

Akar yang sama melahirkan tiga definisi berbeda untuk satu pertanyaan, "apakah run ini sedang
berjalan?":

| Lokasi | Predikat sekarang | |
| --- | --- | --- |
| `src/src/screens/RunsScreen.tsx:127` `busy` | `queued \| running \| paused` | benar |
| `src/src/screens/ProjectsScreen.tsx:71` `running` | `queued \| running` | kehilangan `paused` |
| `src/src/App.tsx:297` `activeRunSpecs` | `running \| paused` | kehilangan `queued` |
| `src/src/App.tsx:303` `anyRunActive` | `running \| paused` | kehilangan `queued` |

## Objective (dikunci)

**Daftar run mencerminkan transisi `queued → running` tanpa refresh manual**, dan seluruh
frontend menentukan "run sedang berjalan" dari **satu predikat bersama** — tanpa menambah
transport realtime baru, tanpa menyentuh server, dan tanpa mengubah skema.

## Kriteria penerimaan (EARS)

- THE SYSTEM SHALL menyediakan satu predikat `isRunActive(status)` di `@hanoman/shared` yang
  benar untuk `queued`, `running`, dan `paused`, dan salah untuk `stopped`, `failed`, `done`.
- WHEN operator menekan **Mulai** pada kartu backlog, THE SYSTEM SHALL menampilkan baris run
  `queued` dan menyalakan poll daftar tanpa interaksi lain.
- WHEN worker mengangkat run dari `queued` ke `running`, THE SYSTEM SHALL memperbarui status
  baris run dalam ≤ 3 dtk tanpa refresh manual.
- WHILE terdapat run berstatus `queued`, `running`, atau `paused`, THE SYSTEM SHALL me-refetch
  daftar run dan backlog tiap 3 dtk.
- IF tidak ada run berstatus `queued`, `running`, maupun `paused`, THEN THE SYSTEM SHALL
  menghentikan poll.
- WHILE sebuah spec memiliki run berstatus `queued`, `running`, atau `paused`, THE SYSTEM SHALL
  menampilkan tombol **Buka run** pada kartu backlog-nya, bukan **Mulai**.
- WHILE sebuah run berstatus `queued`, `running`, atau `paused`, THE SYSTEM SHALL menyembunyikan
  aksi hapus pada baris run itu.
- WHILE run terbaru sebuah project berstatus `queued`, `running`, atau `paused`, THE SYSTEM SHALL
  menampilkan label fase pada `StatusPill` baris project itu.

## Perubahan yang diminta

1. `isRunActive(status)` — fungsi murni di `shared/src/enums.ts`, bersebelahan dengan
   `zRunStatus` yang mendefinisikan kosakata statusnya. Barrel `@hanoman/shared` sudah
   meng-export `./enums`; tak ada `node:*` yang masuk ke bundle web.
2. Pakai di empat lokasi tabel di atas — `App.tsx:297`, `App.tsx:303`,
   `ProjectsScreen.tsx:71`, `RunsScreen.tsx:127`.

Butir 2 memperbaiki tiket ini (`:303`), cacat double-start (`:297` — kartu backlog membiarkan
**Mulai** aktif untuk run `queued`, klik kedua ditolak `enqueueRun` dengan `409` dan berakhir
sebagai toast error), dan `paused` yang hilang (`ProjectsScreen.tsx:71`) dalam satu diff.

## Test

Tes regresi di berkas baru `src/test/run-poll.test.tsx`: dengan `listRuns` mengembalikan satu
run `queued` dan timer palsu, majukan 3 dtk lalu tuntut `listRuns` terpanggil ulang; dan kartu
backlog spec itu menampilkan **Buka run**, bukan **Mulai**. Keduanya **gagal pada kode hari ini**
dan lulus setelah perbaikan.

> **Amandemen (fase Plan):** semula tes ini hendak dititipkan ke `src/test/app-flows.test.tsx`.
> Tidak bisa — satu berkas hanya boleh punya satu `vi.mock` per modul, dan berkas itu sudah
> mengunci `listRuns` ke `[]` untuk tes lain. Berkas terpisah, bukan mock yang dibongkar.

> **Amandemen (fase Execute):** verifikasi di browser nyata memperlihatkan perbaikan poll saja
> **belum cukup**. Baris daftar berubah `Running`, tapi panel detail tetap `Queued`: overlay
> `live` di `RunsScreen.tsx:284` di-seed sekali per **id** run, jadi status baru dari poll tak
> pernah masuk. Lebih buruk pada run nyata — worker menerbitkan `status: running` sebelum
> langganan SSE terbuka, dan Redis pub/sub tak punya replay, sehingga pill detail bertahan
> `Queued` **sepanjang run** sampai event `done`/`failed`. Deps efek itu ditambah `picked?.status`,
> dan tes ketiga (`panel detail ikut jadi Running`) menjaganya. Ini bukan pelanggaran batas scope
> "frame `status` pada snapshot SSE" — server tidak disentuh; yang diperbaiki adalah overlay klien.

Tidak ada unit test terpisah untuk `isRunActive`: predikat satu baris yang benar lewat inspeksi,
sementara tes murni atasnya tetap hijau seandainya seseorang lupa memakainya di `:303` — persis
kegagalan yang sedang kita cegah. Tes perilaku di atas yang menjaga gate-nya.

## Batas scope

- **Termasuk:** `isRunActive` di shared, empat lokasi pemakaiannya, satu tes regresi. Hanya itu.
- **Tidak termasuk:**
  - **SSE global untuk daftar run.** Poll 3 dtk adalah mekanisme yang memang dirancang untuk
    daftar (komentar `App.tsx:301-302`); memperbaiki gate-nya sudah memenuhi objective. Stream
    global adalah arsitektur baru untuk latensi yang belum terbukti jadi masalah.
  - **Frame `status` pada snapshot SSE** (`server/src/routes/runs.ts:129`). Celah laten yang
    dicatat di audit; hari ini tertutup oleh poll, dan bukan penyebab tiket ini.
  - **Predikat "punya proses hidup"** di `RunsScreen.tsx:176,205,271` (`running | paused`) —
    pertanyaan berbeda: `queued` belum punya proses untuk di-steer/pause. Biarkan.
  - **Predikat dedupe enqueue** `server/src/queue.ts:39` (`queued | running`) — pertanyaan
    berbeda lagi. Biarkan.
  - **Perubahan server, skema, atau interval poll.** Tak ada migration, jadi tak ada ADR
    (AGENTS.md hanya menuntut ADR untuk perubahan skema). Menolak menambah arsitektur bukan
    keputusan yang perlu di-ADR-kan; alasannya tercatat di sini.

## Prinsip yang dipegang

- **Satu kosakata, satu predikat.** Status run didefinisikan di `shared/src/enums.ts`; predikat
  turunannya tinggal di sebelahnya, bukan disalin ke tiap layar.
- **Perbaiki di akar, bukan di pemanggil.** Satu predikat bersama menutup tiga gejala; menambal
  hanya `:303` akan meninggalkan `:297` dan `:71` tetap salah.
- **Bedakan pertanyaan yang memang berbeda.** "Sedang berjalan" bukan "punya proses hidup" dan
  bukan "boleh di-enqueue". Menyatukan ketiganya akan menukar satu bug dengan tiga.
- **Tes yang gagal kalau bug-nya kembali** — bukan tes yang hijau di kedua sisi perbaikan.

> Chiranjivi — spec bertahan lebih lama dari satu run. Plan turunannya tunduk pada pernyataan ini.
