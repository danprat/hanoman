# Audit SPEC-394 — "Lanjutkan" sesi backlog justru memulai dari nol

**Sumber:** qa · **Prioritas:** tinggi · **Severity:** major · **Tanggal:** 2026-07-29
**Metode:** `superpowers:systematic-debugging`

## Keluhan

> "saat ini ketika mau melanjutkan session yang baru setengah jalan malah membuat session baru."
> Ekspektasi: "harusnya setiap session backlog bisa melanjutkan sessionnya tanpa mengulangi nya
> lagi jika workflow dan sessionnya masih ada."

## Ringkasan temuan

`startSpecSession()` hanya mengenal **dua** keadaan: "pane tmux ada" (→ re-attach) dan "pane tmux
tidak ada" (→ sesi baru dari nol). Tidak ada keadaan ketiga — **melanjutkan** — padahal artefak
pekerjaan setengah jalan (worktree, commit di branch sesi, berkas fase) hampir selalu masih ada.
Akibatnya menekan **"Lanjutkan"** di Backlog:

1. **menghapus** worktree beserta seluruh kerja yang belum di-commit, lalu
2. membangunnya ulang dari `branchFrom` (mis. `main`) sehingga commit sesi sebelumnya tak ikut, lalu
3. mengirim `startPrompt` — pipeline **dari fase pertama**, walau berkas fase mencatat sebagian
   fase sudah selesai.

Ini bukan hanya "terasa seperti sesi baru": ini **kehilangan data** untuk pekerjaan yang belum
di-push. Karena itu severity major-nya tepat.

## Akar masalah

Semua di `server/src/services/session-launch.ts` (jalur peluncuran tunggal SPEC-294 — dipakai
`POST /terminal/sessions` **dan** governor scheduler).

### (1) Gerbang re-attach memakai "pane ada", bukan "pane hidup"

```ts
const id = sessionIdForSpec(spec.id);
const live = getSession(id);
if (live) return { id: live.id, reused: true };      // ← `live` bisa pane MATI
```

`getSession()` mengembalikan pane **mati** juga: tmux dijalankan dengan `remain-on-exit on`
(`services/pty.ts:308`) supaya layar terakhir tetap terbaca. `createSession()` punya gerbang kembar
dengan cacat yang sama (`pty.ts:233`).

Sementara itu UI menghitung "sedang berjalan" dengan benar — `sessions.filter(s => s.specId &&
!s.exited)` (`App.tsx:569`) — jadi kartu backlog menawarkan tombol **"Lanjutkan"** persis saat
pane-nya mati. Menekannya mengembalikan id pane mati itu; terminal terbuka, tak ada apa pun yang
jalan. Dari sisi pengguna: **tombolnya tak berfungsi.**

### (2) Jalan keluar satu-satunya justru menghancurkan pekerjaannya

Karena "Lanjutkan" tak berbuat apa-apa, jalan keluar yang tersedia adalah **Tutup** sesi mati itu.
`DELETE /terminal/sessions/:id` menghapus worktree-nya (`routes/terminal.ts:388`, digerbangi
`ownsWorktree`). Sesudah itu "Lanjutkan" memang melahirkan sesi — tapi di worktree kosong yang baru.

### (3) Peluncuran berikutnya selalu diperlakukan sebagai kelahiran pertama

```ts
const baseSha = realGit.addWorktree(repoDir, `${repoDir}/.worktrees/${id}`, spec.branchFrom ?? "HEAD");
await prisma.spec.update({ where: { id: spec.id }, data: { baseSha, headSha: null } });
```

`realGit.addWorktree` (`runner/src/git.ts:36`) **selalu** merebut ulang path-nya lebih dulu —
`worktree remove --force` + `prune` + `rmSync(recursive, force)` — sebelum `worktree add`. Itu benar
sebagai *reclaim* untuk id yang dipakai ulang, tapi di jalur "Lanjutkan" ia menghapus worktree yang
justru berisi pekerjaan yang mau dilanjutkan. `baseSha` ikut ditimpa dan `headSha` di-null-kan,
sehingga rentang review (ADR-0030) juga di-reset.

Basis worktree barunya `spec.branchFrom ?? "HEAD"` — **bukan** branch sesi `hanoman/<id>` tempat
sesi sebelumnya mem-push commit-nya, jadi commit yang sudah selamat pun tak ikut ter-checkout.

### (4) Pemilihan prompt buta terhadap kemajuan

```ts
const isContinue = spec.stage === "done";
let prompt = isContinue ? continuePrompt(...) : startPrompt(...);
```

`continuePrompt` (SPEC-172) adalah satu-satunya bentuk "lanjutkan" yang ada, dan ia dikhususkan
untuk kasus sempit *"spec keburu ditandai `done` padahal belum tuntas"* — ia melompat langsung ke
fase Execute. Spec di stage `objective` / `spec-ready` / `planned` / `executing` — yaitu **definisi
"setengah jalan"** — jatuh ke `startPrompt`: pipeline lengkap dari fase pertama.

Berkas fase `<repoDir>/.worktrees/.phases/<id>` hidup **di luar** worktree (`session-phases.ts:11`)
dan bersifat append-only, jadi ia **selamat** dari semua penghapusan di atas. Isinya adalah catatan
persis fase mana yang sudah beres — dan tak ada satu pun jalur peluncuran yang membacanya.

### (5) Akibat lanjutan: sesi hasil "Lanjutkan" tak bisa mem-push

Setiap prompt sesi backlog berakhir dengan `git push origin HEAD:refs/heads/hanoman/<id>`. Bila
sesi sebelumnya sempat mem-push, ref itu sudah ada di origin — dan worktree yang dibangun ulang
dari `branchFrom` **bukan keturunannya**. Diuji langsung terhadap git:

```
sesi 1 push OK; origin tip = 1e2a5abb
--- push sesi 2 (worktree dibangun ulang dari main) ---
 ! [rejected]        HEAD -> hanoman/spec-x (non-fast-forward)
```

Jadi sesi yang "mengulangi lagi" itu bahkan tak bisa menyimpan hasil ulangannya: ia mengerjakan
semuanya dari nol lalu ditolak di langkah terakhir.

## Sudah pernah diputuskan — lalu ikut tercabut

[ADR-0017](../adr/0017-run-terputus-melanjutkan-sesinya.md) ("Run yang terputus melanjutkan
sesinya, bukan mengulang dari awal") memutuskan **persis** paket ini di arsitektur run lama:
memakai ulang worktree alih-alih menghapusnya paksa, melewati fase yang sudah `done`, dan
membangun basis dari tip yang pernah di-push — dengan alasan non-fast-forward yang baru saja
terukur ulang di atas. Ia bahkan menuliskan syaratnya: *"Melewati fase hanya sah bila artefaknya
masih ada — dan artefak fase Plan hidup di worktree, bukan di percakapan."*

ADR-0017 di-**superseded** oleh ADR-0024 (SPEC-162) dengan alasan yang tertulis di kepalanya:

> "sebuah sesi tmux tak pernah 'terputus': ia hidup melewati restart API"

Premis itu **terlalu kuat**. Sesi tmux memang selamat dari restart API — tapi tidak dari mesin yang
di-restart, dari agen yang keluar sendiri (pane jadi `dead`), maupun dari operator yang menutup
sesinya. SPEC-394 adalah lubang yang ditinggalkan pencabutan itu: perilaku "melanjutkan" hilang,
sementara keadaan yang membuatnya perlu tidak pernah hilang.

## Reproduksi (terukur)

Dua skrip repro dijalankan terhadap kode apa adanya (agen dipalsukan `HANOMAN_CLAUDE_BIN=/bin/echo`,
DB `hanoman394_test`).

**A. Pane hilang (mis. mesin restart), worktree masih ada.** Sesi dijalankan, lalu ditulis ke
worktree-nya: plan `spec-r1-plan.md` berisi `- [x] task 1` / `- [ ] task 2`, satu berkas
belum-commit, dan berkas fase `Audit done / Spec skipped / Plan skipped`. Pane dibunuh, worktree
dibiarkan. Lalu `startSpecSession` dipanggil lagi:

```
=== worktree masih ada sesudah pane mati: true
=== plan masih ada:                        true
--- sesudah "Lanjutkan" ---
=== id sama:                               true  (spec-r1 → spec-r1)
=== reused:                                undefined
=== kerja belum-commit selamat:            false     ← terhapus
=== plan selamat:                          false     ← terhapus
=== prompt2 MELANJUTKAN?:                  false
=== prompt2 == prompt1 (mulai dari nol)?:  true      ← byte-identik dengan start pertama
=== phase file sesudah restart:            [ 'Audit done', 'Spec skipped', 'Plan skipped' ]
```

Baris terakhir adalah intinya: server **memegang** bukti bahwa sesi itu sudah melewati Audit, Spec,
dan Plan, lalu tetap mengirim prompt yang menyuruh agen mengerjakan Audit → Spec → Plan → Execute
dari awal.

**B. Pane mati tapi belum dibersihkan.** Sesi dijalankan dengan agen yang langsung exit:

```
=== pane exited: true
=== startSpecSession lagi → {"id":"spec-r2","reused":true}   pane exited: true
```

Peluncuran kedua "berhasil" mengembalikan sesi yang **mati**. Tak ada proses baru; tombolnya diam.

Rangkaian A + B persis menjelaskan keluhannya: tombol "Lanjutkan" diam (B), operator menutup sesi
untuk membereskannya (yang menghapus worktree), lalu "Lanjutkan" berikutnya melahirkan sesi dari
nol (A) — *"malah membuat session baru"*.

## Bukan penyebab (sudah dibantah)

- **Bukan id sesi yang tak deterministik.** `sessionIdForSpec(spec.id)` terbukti menghasilkan id
  yang sama di peluncuran kedua (`spec-r1 → spec-r1`); ADR-0015 utuh.
- **Bukan berkas fase yang hilang.** Ia selamat dari penghapusan worktree; masalahnya tak dibaca.
- **Bukan UI yang salah label.** `activeSpecs` sudah benar mengecualikan sesi `exited`; label
  "Lanjutkan" justru menjanjikan perilaku yang belum ada di server.

## Keputusan pasca-Audit

**Spec dan Plan dijalankan penuh** (ADR-0020/0040) — bukan jalur cepat. Alasannya:

- Perbaikannya menyentuh **siklus hidup worktree**, satu-satunya batas keamanan yang tersisa
  (ADR-0037) dan tempat kerusakan data pernah benar-benar terjadi (SPEC-362).
- Ia memperkenalkan **kontrak prompt baru** (prompt lanjutan yang sadar-fase), bukan sekadar
  menukar pemanggilan helper.
- Ada percabangan desain nyata yang layak ditulis: basis worktree saat harus dibangun ulang,
  nasib `baseSha`/`headSha`, dan kapan sebuah peluncuran boleh disebut "lanjutan".

Dokumen desainnya: `docs/superpowers/specs/2026-07-29-spec-394-lanjutkan-sesi-backlog-design.md`.
Keputusan arsitekturnya: [ADR-0084](../adr/0084-melanjutkan-sesi-backlog.md).

## Di luar skop (tercatat, sengaja tak diperbaiki)

- **Berkas fase basi saat sesi benar-benar dimulai ulang dari nol.** Bila worktree *dan* branch sesi
  sama-sama tak ada, peluncuran memang harus mulai dari awal, tapi berkas fase lama tetap tertinggal
  dan membuat UI menampilkan fase yang "sudah selesai". Sudah ada sebelum SPEC-394 dan tak menyentuh
  keluhan ini.
- **Menutup sesi tetap menghapus worktree.** Itu perilaku yang disengaja (SPEC-362); yang diperbaiki
  di sini adalah peluncuran, bukan penutupan.
