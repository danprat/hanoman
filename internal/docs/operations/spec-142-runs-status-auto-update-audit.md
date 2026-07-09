# SPEC-142 — audit: status run tidak auto-update dari `queued` ke `running`

Fase **Audit** dari alur QA (audit → spec → plan → execute). Dokumen ini menetapkan akar
masalah dan batas perbaikannya. **Tidak ada perubahan kode di fase ini.**

- Sumber: backlog qa · prioritas tinggi · severity `major`
- Hilir: [spec SPEC-142](spec-142-runs-status-auto-update-spec.md)
- Gejala: setelah backlog dijalankan ("Mulai"), baris run bertahan di `queued`. Butuh
  refresh manual agar berubah ke `running`. Setelah `running`, SSE masuk dan UI auto-update.

## Akar masalah

`queued` adalah lubang di **dua predikat** di `src/src/App.tsx`. Sisa aplikasi sudah
menangani `queued`; dua tempat ini tidak.

Satu-satunya mekanisme yang me-refresh **daftar** run adalah poll 3 detik di
`App.tsx:304-312`. Poll itu dijaga oleh:

```js
// src/src/App.tsx:303
const anyRunActive = runs.some((r) => r.status === "running" || r.status === "paused");
```

Run yang baru dibuat berstatus `queued` (`server/src/queue.ts:43,46`). Maka
`anyRunActive === false` → poll **tidak pernah start** → daftar tidak pernah refetch →
baris membeku di `queued`. Begitu sesuatu memaksa refetch (refresh manual, atau ada run
lain yang sudah `running` sehingga poll menyala), status terbaca `running`, poll menyala,
dan semuanya berjalan — persis seperti yang dilaporkan.

Jadi ini bukan arsitektur realtime yang hilang, melainkan **satu status yang terlupakan
di satu predikat**.

### Kenapa SSE tidak menutupinya

SSE per-run (`GET /api/runs/:id/log`, `server/src/routes/runs.ts:123-141`) tidak pernah
menyentuh daftar:

- Gate langganan di `src/src/screens/RunsScreen.tsx:286` juga melewati `queued`.
- Bahkan jika langganan terbuka, `reduceRunEvent` (`src/src/screens/run-reduce.ts:9`)
  hanya menulis ke overlay `live` milik panel detail. Array `runs` di `App.tsx` tidak
  pernah disentuh SSE — `setRuns` hanya dipanggil saat mount (`:269`), sesudah
  `startRun` (`:379`), poll (`:308`), dan delete (`:350`, `:364`).
- Transisi `queued` sendiri **tidak pernah dipublikasikan**. `enqueueRun`
  (`server/src/queue.ts:41-52`) menulis langsung ke Postgres; `publishEvent` hanya
  dipanggil dari `server/src/worker.ts:68`. Event `running` (`runner/src/run.ts:34`)
  memang terbit ke `run:<id>:events`, tapi tidak ada klien yang mendengarkan kanal itu
  saat run masih `queued`.

## Definisi "in flight" tidak tunggal

Akar yang sama muncul sebagai empat definisi berbeda untuk pertanyaan yang sama —
"apakah run ini sedang berjalan?":

| Lokasi | Predikat | Status |
| --- | --- | --- |
| `RunsScreen.tsx:127` `busy` | `queued \| running \| paused` | benar |
| `ProjectsScreen.tsx:71` `running` | `queued \| running` | kehilangan `paused` |
| `App.tsx:297` `activeRunSpecs` | `running \| paused` | kehilangan `queued` |
| `App.tsx:303` `anyRunActive` | `running \| paused` | kehilangan `queued` |

Efek samping dari baris `:297`: kartu backlog tidak menandai run `queued` sebagai
berjalan, sehingga tombol "Mulai" tetap aktif. Klik kedua ditolak `enqueueRun`
(`server/src/queue.ts:39`) dengan `409` dan berakhir sebagai toast error. Akar sama,
gejala berbeda.

Perlu dibedakan dari pertanyaan lain yang memang bukan "in flight":

- `RunsScreen.tsx:176,205,271` — "apakah ada proses hidup untuk di-steer/pause?"
  (`running | paused`). Benar apa adanya; `queued` tidak punya proses.
- `server/src/queue.ts:39` — dedupe enqueue (`queued | running`). Benar apa adanya.

## Rekomendasi untuk fase Spec

1. Satu predikat bersama `isRunActive(status) = queued | running | paused`, letakkan di
   `shared/src/enums.ts` bersebelahan dengan `zRunStatus`. Pakai di keempat lokasi tabel
   di atas. Ini memperbaiki tiket ini (`:303`), cacat double-start (`:297`), dan
   `paused` yang hilang (`ProjectsScreen.tsx:71`) dalam satu diff kecil.
2. Jangan bangun SSE global untuk daftar run. Poll 3 detik sudah menjadi mekanisme yang
   dirancang untuk daftar (lihat komentar `App.tsx:301-302`); memperbaiki gate-nya
   membuat `queued → running` terlihat dalam ≤3 detik dan memenuhi "runs status auto
   update". Stream global adalah arsitektur baru untuk latensi yang belum terbukti jadi
   masalah.
3. Beri satu tes untuk predikat itu. Predikat murni, jadi cukup satu unit test — bukan
   harness realtime.

## Catatan laten (di luar cakupan SPEC-142)

Snapshot SSE saat connect (`server/src/routes/runs.ts:129`) hanya memutar ulang
`run.log`, tidak pernah frame `status`. Redis pub/sub tidak punya replay. Maka pelanggan
yang connect **setelah** `running` terbit akan menampilkan status basi sampai event
berikutnya tiba. Hari ini poll 3 detik menutupinya. Kalau suatu saat panel detail berdiri
sendiri tanpa poll, snapshot itu perlu memuat status run saat ini — `persistEvent` sudah
menuliskannya ke DB (`server/src/runner/events-io.ts:51-53`), tinggal dibacakan.

Dicatat, bukan diperbaiki di sini: bukan penyebab tiket ini.

## Verifikasi

Akar masalah dipastikan lewat pembacaan kode, bukan reproduksi runtime. Reproduksi
menuntut `POST /runs`, dan dengan worker dev yang hidup itu mengeksekusi run nyata di
latar belakang — efek samping yang tidak boleh diambil oleh fase Audit. Seluruh klaim di
atas berjangkar pada `file:baris` yang dikutip dan dapat diperiksa ulang secara statis.

## Rujukan

- ADR-0005 — [durable queue + worker](../adr/0005-durable-queue-and-worker.md): asal status `queued`.
- ADR-0015 — [satu backlog, satu sesi Claude](../adr/0015-one-session-per-backlog.md): asal event `running`.
- [agent-documentation-workflow](agent-documentation-workflow.md): alur QA audit → spec → plan → execute.
