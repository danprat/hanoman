# Audit SPEC-451 — backlog yang sudah selesai tak pernah diputuskan, sesinya menahan slot selamanya

- **Sumber**: QA finding SPEC-451 · severity **critical**
- **Tanggal**: 2026-08-01
- **Status**: temuan berconfidence tinggi, akar tunggal, diff kecil → **Spec & Plan `skipped`**, dokumen ini
  menjadi doc-of-record perbaikannya (ADR-0020/0040). Tanpa ADR baru, tanpa skema, tanpa migration,
  tanpa endpoint, tanpa knob — **ADR-0091 ditegakkan, bukan diamandemen**; ADR-0037 & ADR-0072 utuh.

## Keluhan

> saat ini ketika backlog di terminal sudah selesai lead seharusnya memutuskan untuk merge/rebase atau
> close terminalnya untuk memberikan ruang untuk backlog lain untuk running antrian via scheduler jika
> di aktifkan.

## Ringkas

hanoman-lead punya **tiga pintu** (kontrak eksplisit · deteksi otomatis · denyut proaktif) dan sebuah
permukaan tindakan berisi sebelas aksi. Dua di antaranya — `integrate-main` dan `stop-session` — sudah
**terimplementasi penuh** di `services/lead/apply.ts`, lengkap dengan gerbang bukti objektif
(`requireGreenBeforeIntegrate`) dan jaminan worktree-tak-dihapus (AC-32a).

Yang tak pernah ada adalah **yang menanyakannya**. Dari lima call site `decide()` di seluruh server
(`detect.ts` ×1, `pulse.ts` ×3, `routes/lead.ts` ×1), **tak satu pun** pernah menawarkan
`integrate-main` maupun `stop-session` sebagai opsi. Pintu denyut yang paling dekat —
`followUpFinished` — bertanya **hanya tentang kegagalan**, dan gerbangnya menuntut pane sudah **mati**.

Karena SPEC-433 sudah membuktikan bahwa **pane sesi sukses tak pernah mati** (agen adalah TUI
interaktif yang kembali ke `❯` sesudah fase terakhir + push), keberhasilan adalah keadaan yang
**secara struktural tak punya pintu sama sekali**: bukan "jarang diputuskan", melainkan tak bisa
diputuskan. Sesinya hidup terus, dan `liveCount()` scheduler menghitungnya sebagai slot terpakai —
selamanya.

## Bukti

### B1 · keadaan hidup: satu backlog selesai, panenya masih memegang slot 4 jam 24 menit

Diukur 2026-08-01 05:47 WIB dari mesin operator, bukan repro sintetis:

| Fakta | Nilai | Sumber |
|---|---|---|
| `Spec.stage` SPEC-450 | `done` | `~/.hanoman/hanoman.db` |
| Berkas fase `spec-450` | `Brainstorm done` · `Objective done` · `Spec done` · `Plan done` · `Execute done` (5/5 terminal) | `.worktrees/.phases/spec-450` |
| Kotak `- [ ]` tersisa di plan-nya | **0** (`docs/superpowers/plans/2026-08-01-custom-agent-spec-450.md`) | `grep -c` |
| ⇒ `sessionComplete(phases, cwd, specId)` | **true** | `services/session-phases.ts:119` |
| `#{pane_dead}` pane `hanoman-spec-450` | **0** — HIDUP | `tmux -L hanoman list-panes -a` |
| Isi pane | TUI menganggur di `❯`, `✻ Cooked for 59m 23s` | `capture-pane` |
| Pane lahir | 00:24:14 WIB · fase terakhir ditulis 01:23 · masih hidup 05:47 | `#{session_created}` + mtime |

Jadi: pekerjaannya tuntas jam 01:23, dan **4 jam 24 menit** kemudian panenya masih berdiri, masih
terhitung slot, dan tak satu baris keputusan lead pun menyentuhnya.

Jejak keputusan lead di DB yang sama berisi **7 baris, semuanya `gagal`** (`pulse/order` ×6,
`detected/answer` ×1) — nol baris ber-`kind: quality`, nol yang menyebut SPEC-450. (Enam kegagalan
`order` itu adalah SPEC-432 dan sudah diperbaiki; yang penting di sini adalah **ketiadaan** baris
untuk sesi yang selesai, bukan kegagalannya.)

Antrean scheduler saat yang sama: **32 baris `queued`**, `maxConcurrent: 6`.

### B2 · gerbang yang mengunci: `s.exited`, lalu `bad || unfinished`

`server/src/services/lead/pulse.ts:131-176` — satu-satunya pintu denyut yang melihat "sesi yang
sudah berakhir":

```ts
for (const s of deps.sessions()) {
  if (!s.exited || !s.specId || !opt.has(s.projectId)) continue;   // (1)
  const bad = (s.exitCode ?? 0) !== 0;
  const unfinished = !deps.planDone(s.cwd, s.specId);
  if (!bad && !unfinished) continue;                                // (2)
```

Dua gerbang berurutan, dan **keduanya sendirian sudah cukup** untuk membuang kasus sukses:

1. `!s.exited` → `continue`. Per SPEC-433, di jalur sukses `#{pane_dead}` **tak pernah** jadi `1`.
   Sesi SPEC-450 di B1 tersaring persis di sini.
2. Andai (1) lolos (mis. operator mengetik `/exit`, pane mati exit 0), `!bad && !unfinished` →
   `continue`. Opsi yang ditawarkan pun hanya `resume-session` / `restart-session` / `none` —
   kosakata **pemulihan kegagalan**. Tak ada kata "integrasikan", tak ada "hentikan".

Test lama `lead-pulse.test.ts:121` **mengunci keadaan ini sebagai kontrak**:
`it("leaves a clean, finished session alone")`. Bentuk kesalahan yang sama persis dengan SPEC-433,
yang test lamanya berbunyi "sesi yang masih hidup tak menampilkan badge Selesai" — sebuah bug yang
sudah naik pangkat jadi spesifikasi.

### B3 · `integrate-main` & `stop-session` = mesin tanpa pengemudi

`apply.ts` mengimplementasikan keduanya sepenuhnya:

- `integrateMain` (`apply.ts:116`) — memanggil `integrate(repoDir, specId, "merge", "local:main")`,
  didahului gerbang bukti objektif `requireGreenBeforeIntegrate` (plan tak menyisakan `- [ ]`),
  menempelkan bukti ke baris jejaknya, dan menotifikasi operator bila hasilnya tak bersih.
- `stopSession` (`apply.ts:81`) — `killSession()` LANGSUNG, bukan `DELETE /terminal/sessions/:id`,
  supaya worktree-nya selamat (AC-32a).

Enumerasi seluruh `decide({…})` di server:

| Call site | `kind` | Opsi yang ditawarkan |
|---|---|---|
| `detect.ts:104` | `answer` | jawaban bebas ke pane yang menunggu keputusan |
| `pulse.ts:155` (`followUpFinished`) | `quality` | `resume-session` · `restart-session` · `none` |
| `pulse.ts:198` (`detectCollisions`) | `collision` | `hold-work` · `none` |
| `pulse.ts:282` (`orderReadyWork`) | `order` | urutan id backlog |
| `routes/lead.ts:89` (kontrak eksplisit) | `answer` | apa pun yang dikirim peminta |

`integrate-main` dan `stop-session` **tak muncul di satu kolom pun**. Satu-satunya jalan masuknya
adalah agen eksternal yang kebetulan mengirim `POST /api/lead/decisions` dengan pertanyaan yang tepat
— yaitu tak pernah, karena tak ada yang tahu harus bertanya.

### B4 · slot yang bocor

`server/src/services/scheduler/engine.ts:49`:

```ts
liveCount: () => listSessions().filter((s) => !s.exited).length,
```

Cap concurrency dihitung dari **pane tmux hidup**, dan pane sesi yang selesai memang hidup. Rantainya:

1. `reconcile()` (`scheduler/reconcile.ts:44`) melihat `stage === "done"` → `markDone(item.id)`.
   **Baris antreannya ditutup dengan benar.**
2. Tapi `liveCount()` tak membaca baris antrean; ia membaca tmux. Panenya masih di sana.
3. `drain()` (`governor.ts:29`): `slots = cfg.maxConcurrent - deps.liveCount()`. Enam sesi yang
   sudah selesai tapi panenya belum ditutup → `slots = 0` → `return` sebelum satu baris antrean pun
   dilihat.

Jadi **32 baris `queued` tak akan pernah diluncurkan**, dan tak ada satu pun mekanisme di dalam
hanoman yang menutup panenya: reconcile tak menutupnya (sengaja — auto-close terminal bukan
keputusannya), lead tak melihatnya (B2), dan operator adalah satu-satunya yang bisa. Itulah kalimat
terakhir keluhan — "memberikan ruang untuk backlog lain" — dalam bentuk terukur.

Yang **bukan** bug: pane yang benar-benar MATI (`exited: true`) sudah tersaring `!s.exited` dan
tidak menahan slot. Kebocorannya khusus untuk keadaan "selesai tapi hidup", yaitu justru jalur sukses.

## Akar masalah

> Konflasi yang sama untuk **ketiga kalinya**, kini di permukaan keputusan lead: **`exited` (proses
> mati) dipakai sebagai proksi "pekerjaan selesai"**.

- SPEC-402 menutup belahan pertama: *pane mati ≠ pekerjaan selesai* (`exitCode` sampai ke UI).
- SPEC-433 menutup belahan kedua **di UI**: *pekerjaan selesai ≠ pane mati* (`sessionComplete()`
  menyeberang ke Terminal lewat frame `phase`).
- SPEC-451 adalah belahan kedua **di permukaan keputusan**: server sudah tahu jawabannya sejak
  SPEC-433, tapi yang memakai verdict itu hanya jembatan WebSocket. `pulse.ts` masih membaca
  `exited`, jadi lead masih hidup di dunia sebelum SPEC-433.

Cacat turunannya satu lagi, independen dan lebih tua: pintu denyut yang ada dibangun sebagai pintu
**pemulihan kegagalan** (AC-16/17: exit ≠ 0, plan bersisa kotak). Tak pernah ada pintu untuk
**keberhasilan** — padahal keberhasilanlah yang meninggalkan dua keputusan menganggur (integrasikan?
tutup?) dan satu slot tertahan.

## Perbaikan

Tiga sentuhan, semuanya di dalam mekanisme yang sudah ada.

### F1 · satu definisi "selesai", diekspor dari `pty.ts`

`pollPhases` dan `attach` sudah menghitung verdict SPEC-433 dari sebuah `Pane`. Perhitungan itu
diangkat jadi `paneComplete(p)` dan diekspos sebagai **`sessionFinished(id)`** — pembaca di luar
jembatan WS memakai fungsi yang sama, tidak menyalinnya. Menyalin predikat adalah kelas bug SPEC-431
(`baseSha IS NULL` yang tersalin ke dua pemakai) dan SPEC-448 (`rootBypassEnv` yang tak menyeberang
ke titik spawn kedua).

Biaya I/O-nya tetap di ekor sesi: `sessionComplete` baru menyentuh disk (`planComplete`) **sesudah**
cek fase murni lolos. `SessionInfo` sengaja **tidak** ditambahi field `complete` — `listSessions()`
dipanggil governor tiap 10 detik dan oleh siaran events, dan verdict itu akan membayar `readdir` +
`readFile` sepanjang hidup setiap sesi, bukan di ekornya.

### F2 · pintu keempat di denyut: `followUpComplete`

Fungsi baru di `pulse.ts`, bersebelahan dengan `followUpFinished`, **saling eksklusif** dengannya
secara konstruksi:

| Pintu | Gerbang | Opsi |
|---|---|---|
| `followUpFinished` (lama) | `exited && (bad ‖ unfinished)` | resume · restart · none |
| `followUpComplete` (baru) | `finished(s) && !bad` | **integrate-main** · **stop-session** · none |

`finished` ⇒ `planComplete` ⇒ `!unfinished`, jadi tak ada sesi yang bisa memicu keduanya dan
menerima dua pertanyaan dalam satu denyut. Gerbangnya **tidak** menyebut `exited` sama sekali:
sesi selesai yang panenya hidup (kasus B1) maupun yang sudah mati (operator `/exit`) sama-sama
layak diputuskan — yang pertama menahan slot, yang kedua tetap meninggalkan branch belum terintegrasi.

Idempotensi lewat **jejak**, bukan `Set` memori (pelajaran ADR-0091), dengan awalan pertanyaan yang
deterministik per sesi dan **tak dimiliki pintu lain**: `Backlog <spec> sudah selesai di sesi <id>`.
Kuncinya sengaja bukan `kind` — `decide()` menulis ulang `kind` jadi `"refusal"` untuk tindakan di
luar allowlist, dan kunci ber-`kind` meleset persis pada baris yang sudah ditulis (SPEC-432).

Pintu ini **tak digerbangi `Setting.scheduler`**: mengintegrasikan pekerjaan yang sudah selesai
berharga baik antreannya dikuras maupun tidak. Berbeda dari `orderReadyWork`, yang penataannya
memang tak punya pembaca saat scheduler mati.

### F3 · integrasi bersih melepas panenya

`integrateMain` di `apply.ts` menutup pane sesi spec-nya **setelah** integrasi `clean`, digerbangi
`planDone` — bukan `requireGreenBeforeIntegrate`, karena knob itu boleh dimatikan operator sementara
gerbang ini menjawab pertanyaan yang berbeda: *bolehkah panenya dilepas?* Tanpa ini, jawaban
`integrate-main` menyelesaikan separuh keluhan (hasilnya masuk main) dan meninggalkan separuh lainnya
(slotnya masih tertahan) — sementara keluhan aslinya menyebut keduanya dalam satu tarikan napas.

Yang dipakai `killSession()` LANGSUNG, jadi **worktree tetap utuh** (AC-32a): rentang review ADR-0030
selamat, tombol "Lanjutkan" ADR-0084 tetap bermakna, dan pekerjaan yang belum di-commit tak hilang.

`rebase` sengaja **tidak** ditambahkan ke `LEAD_ACTIONS`. Daftar itu konstanta modul, bukan
konfigurasi (AC-31), dan menambah entri ke allowlist adalah keputusan permukaan-serangan yang butuh
alasannya sendiri. `merge` sudah memenuhi "hasilnya masuk main", dan ia yang **paling mudah
dibatalkan** dari keduanya — persis kriteria yang prompt lead sendiri perintahkan (`rebase` menulis
ulang riwayat). Rebase tetap tindakan operator lewat `POST /specs/:id/integrate`.

## Yang sengaja TIDAK diubah

**`liveCount()` tetap menghitung pane hidup apa adanya.** Menyaring pane yang "selesai tapi hidup"
dari cap memang akan membebaskan antrean tanpa bergantung pada lead — tapi ia menukar antrean yang
mandek dengan **pane yang menumpuk tanpa batas**: tak ada lagi yang memberi tekanan untuk menutupnya,
dan setiap sesi selesai meninggalkan satu proses agen hidup selamanya. Cap itu memang menghitung
pane, dan yang benar adalah **menutup panenya**, bukan berpura-pura ia tak ada. Menutup pane tanpa
keputusan siapa pun juga melanggar "manusia terakhir yang memutuskan" bagi workspace yang tak
memakai lead — auto-close terminal adalah keputusan produk yang layak ADR sendiri, bukan efek
samping perbaikan QA.

Konsekuensi yang diterima sadar: selama `Setting.lead.enabled` mati (default, dan itulah keadaan
mesin operator saat audit ini), perilakunya **tak berubah** — operator yang menutup sesinya, persis
seperti hari ini. Yang diperbaiki spec ini adalah janji ADR-0091 yang belum ditepati, bukan
menghidupkan lead untuk orang yang belum memintanya.

## Verifikasi

- `server/test/lead-pulse.test.ts` — pintu baru: sesi selesai **yang panenya masih hidup** ditanyakan
  (kasus B1, yang di kode lama tersaring `!s.exited`); sesi yang masih bekerja tidak; idempoten lewat
  jejak lintas restart; tak pernah menghasilkan dua pertanyaan untuk satu sesi; tindakan yang dipilih
  lead benar-benar dijalankan. Test lama `"leaves a clean, finished session alone"` **dibalik** —
  ia mengunci bug ini sebagai kontrak.
- `server/test/lead-apply.test.ts` — integrasi bersih melepas panenya; integrasi tak bersih tidak;
  plan bersisa kotak tidak.
- `server/test/pty*.test.ts` — `sessionFinished` sepakat dengan verdict yang dikirim frame `phase`.
