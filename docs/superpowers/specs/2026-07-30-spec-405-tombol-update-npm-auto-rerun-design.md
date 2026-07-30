# SPEC-405 — Tombol update langsung dari npm, lalu jalan lagi sendiri

- Tanggal: 2026-07-30
- Sumber: brief, prioritas tinggi
- ADR yang lahir: **ADR-0088** (mengamandemen [ADR-0048](../../../internal/docs/adr/0048-auto-update-deteksi-read-only.md) & [ADR-0087](../../../internal/docs/adr/0087-distribusi-npm-global-satu-perintah.md))

## Masalah

Update hanoman hari ini adalah tiga langkah manual: baca badge di dashboard → salin
`npm i -g hanoman@latest` → tempel di terminal → **restart instance sendiri**. Panel update sengaja
read-only: ADR-0048 memutuskan server tak pernah memasang apa pun, dan ADR-0087 mengulangi larangan
itu sambil menolak `POST /api/update/apply` secara eksplisit sebagai "alternatif yang ditolak".

Objective brief: satu tombol memasang versi terbaru dari npm lalu menjalankan hanoman lagi, tanpa
langkah manual.

## Kenapa larangan itu boleh dicabut sekarang

ADR-0048 menutup pintunya dengan syarat, bukan selamanya: *"Menghidupkan self-pull/self-build/
self-restart butuh **ADR baru** + supervisor (systemd/pm2/wrapper)."* Dua premis penolakan itu sudah
berubah, dan keduanya terverifikasi di kode saat ini:

1. **Supervisor-nya sudah ada, dibawa ADR-0087 sendiri.** `hanoman start`
   (`cli/src/commands/start.ts:226`) men-`spawn` `node dist/server.js` sebagai proses **anak** lalu
   `await` exit-nya. Itu persis wrapper yang ADR-0048 syaratkan — hanya saja hari ini ia meneruskan
   exit code lalu ikut mati, bukan mengambil keputusan atasnya.
2. **Alasan "akan memutus sesi tmux" tidak akurat.** ADR-0087 menulis bahwa server yang me-restart
   dirinya "akan memutus sesi tmux yang sedang berjalan". `pty.ts:356` memakai
   `tmux new-session -d` di socket `hanoman`: tmux adalah **daemon**, bukan anak proses server —
   itulah janji ADR-0016 ("tmux menahan sesi hidup lintas restart API"), dan `start.ts` sendiri sudah
   mengklaimnya di komentar barisnya. Yang benar-benar putus saat restart hanyalah jembatan
   `tmux attach` di atas node-pty dan WebSocket-nya; `src/src/api/events.ts:25` sudah menyambung
   ulang dengan backoff, dan pane beserta agen di dalamnya tak tersentuh.

Yang **tidak** berubah: server tetap tak boleh memasang apa pun saat tak ada yang akan
menghidupkannya kembali. Karena itu keputusannya **supervised-only**.

## Keputusan

**`POST /api/update/apply` sah — tapi hanya bila proses server ini anak dari `hanoman start`.**
Server tak pernah memanggil `npm` sendiri; ia hanya **keluar dengan kode sentinel**. Yang memasang
dan menjalankan ulang adalah CLI parent.

```
dashboard ──POST /api/update/apply {confirm:true}──▶ server
                                                      │ 202 accepted
                                                      │ (jeda flush)
                                                      ▼
                                              process.exit(75)
                                                      │
                          cli/start.ts (parent) ◀──── exit 75
                                                      │
                          npm i -g hanoman@latest ────┤  gagal → respawn versi LAMA
                          prisma generate + migrate ──┤
                          spawn server (dist tertimpa)┘
                                                      ▼
                                          dashboard reconnect sendiri
```

Pembagian tugas ini menjaga ADR-0048 pada intinya: **server tetap tak memasang perangkat lunak
apa pun.** Ia hanya menyatakan "aku minta diganti". Pemasangnya proses lain, yang memang hidup
justru untuk itu.

### 1 · Sentinel & penanda supervisi

- `UPDATE_RESTART_EXIT = 75` — satu konstanta di `@hanoman/shared`, dipakai server (yang keluar)
  dan CLI (yang membacanya). Angka 75 = `EX_TEMPFAIL`; non-zero, jadi `Restart=on-failure` di unit
  systemd yang sudah didokumentasikan tetap masuk akal sebagai jaring pengaman.
- `HANOMAN_SUPERVISOR=1` disuntikkan `start.ts` ke env proses anak. **Hanya** dari sana. Server
  membacanya lewat `effectiveBool` dan mengekspornya sebagai `UpdateStatus.canApply`.
- Konsekuensi yang disengaja: `pnpm dev`, `node server/dist/server.js` telanjang, dan supervisor
  pihak ketiga yang memanggil bundle server langsung **tidak** melihat tombol ini. Panel mereka
  tetap persis seperti hari ini (salin perintah).

### 2 · Endpoint: satu pintu, dua langkah

`POST /api/update/apply`, body `{ confirm?: boolean }`.

| Keadaan | Balasan |
| --- | --- |
| `canApply` false | `409 { error: "unsupervised" }` |
| `updateAvailable` false | `409 { error: "up-to-date", current }` |
| belum `confirm` | `409 { error: "confirm-required", liveSessions, from, to }` |
| `confirm: true` | `202 { accepted: true, from, to, liveSessions }` → exit 75 |

Langkah "belum confirm" adalah **dry-run yang menghitung sesi hidup saat itu juga**
(`listSessions().filter(s => !s.exited).length`). Itu sebabnya jumlah sesi **tidak** ditaruh di
`UpdateStatus`: grup siar `update` di `services/events.ts:39` hanya di-recompute tiap 300 tick, jadi
angka di sana akan basi sampai 5 menit — persis angka yang tak boleh basi ketika dipakai untuk
menakar risiko. `canApply` sebaliknya konstan seumur proses, jadi ia aman di frame siar.

Sesi hidup **tidak memblokir** apa pun di server (aturan produk: manusia terakhir yang memutuskan).
Yang dilakukan server hanyalah menyatakan berapa banyak; gerbangnya klik kedua di UI.

### 3 · Lubang capability yang wajib ditutup bersamaan

`services/agent-capabilities.ts:21` memetakan `top === "update"` ke `GLOBAL_READ` **tanpa melihat
method**, dan `checkAgentCapability` meloloskan `GLOBAL_READ` tanpa syarat. Menambahkan
`POST /update/apply` di bawah prefix itu berarti **setiap agent token — capability apa pun —
bisa me-restart instance operator.** Itu perluasan permukaan yang tak pernah diminta ADR-0065.

Perbaikannya sempit: `update` (dan `limits`) menghasilkan `GLOBAL_READ` **hanya** untuk method
baca; selain itu `COOKIE_ONLY` → 403. Cookie = akses penuh, seperti sebelumnya.

### 4 · Loop supervisor di CLI

`start()` berubah dari "siapkan → spawn → kembalikan exit code" menjadi "siapkan → spawn → putuskan"
di dalam loop. Keputusannya fungsi **murni**:

```ts
export const UPDATE_RESTART_EXIT = 75;
export type SupervisorStep = { action: "exit"; code: number } | { action: "update" };
export function planSupervisorStep(code: number, restartsUsed: number): SupervisorStep;
```

- Kode ≠ 75 → `exit` (perilaku hari ini, byte-identik).
- Kode 75 dan `restartsUsed < MAX_UPDATE_RESTARTS (5)` → `update`.
- Kode 75 tapi jatah habis → `exit`, dengan alasan **dicetak** (jangan pernah membatasi diam-diam).

Sesudah `update`, parent mengerjakan urutan ini — dan urutannya mengikat:

1. `npm i -g hanoman@latest`. **Gagal → tidak fatal**: cetak alasan, lewati langkah 2–3, langsung
   respawn versi lama. Instance tak pernah mati permanen gara-gara registry down atau izin `sudo`.
2. `prisma generate` **tanpa cek dulu**. `ensurePrismaClient` memeriksa dengan
   `await import("@prisma/client")`, dan modul itu sudah ter-cache di proses parent sejak boot —
   pemeriksaan kedua akan menjawab "siap" memakai modul lama sekalipun paket di disk baru saja
   diganti. Ini kelas jebakan yang sama dengan `existsSync` di ADR-0087: cek yang tak bisa
   membedakan berhasil dari gagal. Kegagalan generate di sini dicetak tapi tak membatalkan respawn —
   biar server anak yang gagal keras dan terlihat.
3. `prisma migrate deploy` (paket baru bisa membawa migrasi baru), lalu spawn lagi.

Yang di-respawn adalah `layout.server` — **path yang sama**, karena `npm i -g` menimpa isi direktori
paket global di tempat. Jadi anak berikutnya menjalankan bundle server baru, membaca
`build-info.json` baru, dan menyajikan `web/` baru.

**Batasan yang diterima sadar:** proses CLI parent sendiri tetap kode versi lama sampai `hanoman`
benar-benar dijalankan ulang oleh manusia. Semua fitur produk hidup di server/web/migrasi, jadi ini
tak berpengaruh dalam pemakaian normal; yang tidak ikut ter-update hanyalah supervisor itu sendiri
(parse argumen, `resolveLayout`, loop ini). Bila rilis baru memindahkan tata letak paket, parent lama
akan gagal menemukan `layout.server` dan mengatakannya — bukan gagal senyap. Alternatif "parent
me-`spawn` `hanoman` baru lewat PATH lalu memproksikan sinyal" ditolak: ia menumpuk satu proses node
per update dan menggandakan jalur penanganan sinyal.

### 5 · UI

`UpdateBadge` (`src/src/screens/UpdateIndicator.tsx`) memakai mesin keadaan tiga langkah di dalam
popover yang sudah ada. Perintah salin **tetap ada di ketiganya** — ia satu-satunya jalan saat
`canApply` false.

| State | Isi |
| --- | --- |
| `idle` | headline + perintah salin + (bila `canApply`) tombol **"Pasang & mulai ulang"** |
| `confirming` | kalimat risiko yang menyebut jumlah sesi hidup + **"Ya, pasang"** / **"Batal"** |
| `applying` | "Memasang… dashboard tersambung lagi sendiri" |
| `failed` | alasan dari server + tombol coba lagi |

Kalimat risiko lahir dari fungsi murni `applyConfirmMessage(liveSessions)` supaya bisa diuji unit,
dan ia menyebut fakta yang menenangkan sekaligus benar: **pane tmux dan agen di dalamnya tetap
hidup**; yang terputus hanya jembatan terminalnya, beberapa detik.

Badge menghilang sendiri saat sudah terkini — dan itulah sinyal sukses alaminya: setelah server baru
naik, frame siar `update` berikutnya membawa `updateAvailable: false`. Tak perlu polling khusus.

## Yang berubah

| Berkas | Perubahan |
| --- | --- |
| `shared/src/dto.ts` | `UpdateStatus.canApply`; `UPDATE_RESTART_EXIT`; `zUpdateApplyBody` |
| `server/src/services/update.ts` | `canApply` di `composeUpdate`; `supervised()`; `requestRestartForUpdate()` + exiter yang bisa di-inject |
| `server/src/routes/update.ts` | `POST /update/apply` |
| `server/src/services/agent-capabilities.ts` | `update`/`limits` → `GLOBAL_READ` hanya untuk method baca |
| `cli/src/commands/start.ts` | `planSupervisorStep`, `installLatest`, loop supervisor, `HANOMAN_SUPERVISOR=1` |
| `src/src/api/update.ts` | `applyUpdate()`, `applyConfirmMessage()` |
| `src/src/screens/UpdateIndicator.tsx` | mesin keadaan popover |

Docs yang tersentuh (commit yang sama): ADR-0088 baru, `internal/docs/README.md`,
`internal/docs/adr/README.md`, `internal/docs/architecture/api-contract.md` (entri `/update`
**masih berbentuk SHA milik SPEC-214** — diperbaiki sekalian ke bentuk semver ADR-0087 + endpoint
baru), `internal/docs/operations/npm-readme.md`, `internal/docs/operations/deploy-vps.md`,
`internal/skills/hanoman/SKILL.md`.

**Tanpa perubahan skema, tanpa migration, tanpa knob `Setting` baru.**

## Pengujian

Semua keputusan dipisah ke fungsi murni supaya ada yang menjaganya tanpa proses/jaringan nyata:

- `cli/test/start-args.test.ts` — `planSupervisorStep`: 0 → exit 0; 1 → exit 1; 75 → update;
  75 dengan jatah habis → exit + alasan tercetak.
- `server/test/update.test.ts` — `composeUpdate` mewariskan `canApply` apa adanya dan **tak pernah**
  menyalakannya sendiri saat `updateAvailable` false.
- `server/test/update.route.test.ts` — empat balasan tabel §2, exiter di-inject (jangan pernah
  `process.exit` sungguhan), dan **exiter tak dipanggil** untuk ketiga jalur 409.
- `server/test/agent-capabilities.test.ts` — `POST /api/update/apply` ber-agent-token → 403;
  `GET /api/update` tetap lolos.
- `src/test/update.test.ts` — `applyConfirmMessage(0|1|3)`.
- `src/test/update-indicator.test.tsx` — tombol absen saat `canApply` false; klik pertama tak pernah
  langsung mengirim `confirm`; klik kedua mengirimnya.

Verifikasi akhir sekali: boot server + `curl` keempat balasan `POST /api/update/apply`.

**Catatan scope verifikasi (ADR-0080):** `shared/src/dto.ts` diimpor luas, jadi
`vitest --changed` di sini mendekati suite penuh (terukur di SPEC-376: 217 berkas). Itu blast radius
yang sebenarnya dan diterima — dijalankan **serial** (`--no-file-parallelism`), sekali di akhir.

## Alternatif yang ditolak

- **Server memanggil `npm i -g` sendiri lalu keluar.** Menjadikan server pemasang perangkat lunak
  (persis yang ADR-0048 tolak) dan membuat kegagalan install terjadi di proses yang justru sedang
  bunuh diri — tak ada yang tersisa untuk melaporkannya.
- **Tombol selalu ada, tanpa syarat supervisi.** Di `pnpm dev` atau bundle telanjang ia mematikan
  instance yang tak akan pernah hidup lagi.
- **Blokir tombol selama ada sesi hidup.** Aman, tapi di mesin yang menjalankan beberapa sesi
  sekaligus artinya tombolnya nyaris tak pernah bisa dipakai — dan premisnya salah: sesi memang
  selamat.
- **`liveSessions` di `UpdateStatus`.** Frame siarnya 300 detik sekali; angka basi pada dialog risiko
  lebih buruk daripada tak ada angka.
