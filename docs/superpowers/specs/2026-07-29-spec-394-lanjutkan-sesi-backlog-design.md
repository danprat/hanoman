# SPEC-394 — Melanjutkan sesi backlog, bukan mengulangnya dari nol

**Tanggal:** 2026-07-29 · **Sumber:** qa · **Prioritas:** tinggi · **Severity:** major
**Audit:** [`internal/docs/research/audit-spec-394-lanjutkan-sesi-backlog.md`](../../../internal/docs/research/audit-spec-394-lanjutkan-sesi-backlog.md)
**Status:** design — semua percabangan dijawab dari doc SoT & bukti terukur, tak ada yang menunggu operator

## Masalah

Tombol **"Lanjutkan"** di Backlog (`SpecActions`, muncul untuk setiap spec ber-stage ≠
`brainstorming` yang tak punya sesi hidup) tidak melanjutkan apa pun. `startSpecSession()` hanya
mengenal dua keadaan:

| Keadaan yang dikenali | Perilaku |
| --- | --- |
| `getSession(id)` mengembalikan sesuatu | re-attach, `reused: true` |
| tidak | **kelahiran pertama**: worktree dihapus & dibangun ulang dari `branchFrom`, `baseSha` ditimpa, `startPrompt` dari fase pertama |

Keadaan ketiga — **melanjutkan** — tidak ada, padahal artefaknya hampir selalu masih ada: worktree
di `.worktrees/<id>`, commit di `hanoman/<id>`, dan berkas fase `.worktrees/.phases/<id>` yang hidup
di luar worktree dan bersifat append-only.

Empat akibat, semuanya terukur di audit:

1. Pane **mati** juga lolos gerbang re-attach (`remain-on-exit on`), jadi "Lanjutkan" mengembalikan
   id pane mati — **tombolnya diam**.
2. Jalan keluar satu-satunya (Tutup) menghapus worktree-nya.
3. Peluncuran berikutnya menghapus kerja belum-commit dan mengirim prompt yang **byte-identik**
   dengan start pertama.
4. Karena basisnya `branchFrom` dan bukan tip `hanoman/<id>`, sesi ulangan itu **ditolak
   non-fast-forward** saat mem-push di akhir.

## Sudah pernah diputuskan

[ADR-0017](../../../internal/docs/adr/0017-run-terputus-melanjutkan-sesinya.md) memutuskan persis
paket ini untuk arsitektur run lama: pakai ulang worktree, lewati fase yang sudah selesai, dan
bangun basis dari tip yang pernah di-push (dengan alasan non-fast-forward yang sama). Ia
di-*superseded* ADR-0024 atas premis "sesi tmux tak pernah terputus" — premis yang benar untuk
restart API tapi **salah** untuk mesin restart, agen yang keluar, dan operator yang menutup sesi.

SPEC-394 memulihkan substansi ADR-0017 di arsitektur sesi interaktif. Yang **tidak** dipulihkan:
`claude --resume <sessionId>` (menyambung percakapan) — di sesi interaktif percakapan hidup di TUI
agen, bukan di kontrak hanoman, dan ADR-0074 menuntut perilaku netral-agen (codex tak punya
padanan terverifikasi). Kontinuitas di sini murni dari **artefak di disk**, persis syarat yang
ditulis ADR-0017: *"Melewati fase hanya sah bila artefaknya masih ada."*

## Rancangan

### Konsep: tiga keadaan peluncuran

`startSpecSession()` mengklasifikasi setiap peluncuran jadi salah satu dari tiga, urut:

| Keadaan | Syarat | Perilaku |
| --- | --- | --- |
| **live** | pane ada **dan** `!exited` | re-attach (`reused: true`) — tak menyentuh apa pun |
| **resume** | `spec.stage !== "done"`, `spec.baseSha` ada, **dan** ada artefak (worktree hidup ATAU tip branch sesi) | lanjutkan (`resumed: true`) |
| **fresh** | selain itu | persis perilaku hari ini |

Pane **mati** bukan `live`. Ia dibunuh lebih dulu (`killSession` → SPEC-362 menutup baris
`SessionHistory` + menyimpan transkrip pane) lalu sesi dilahirkan ulang.

### Dua bentuk resume

| Bentuk | Syarat | Worktree | `baseSha` |
| --- | --- | --- | --- |
| **worktree utuh** | `.worktrees/<id>` masih worktree git yang sah | **dipakai apa adanya**, tak disentuh sama sekali | tetap |
| **worktree hilang** | tidak, tapi tip branch sesi resolve | dibangun ulang `--detach` di **tip branch sesi** | tetap |

Prioritas basis saat harus dibangun ulang: `origin/hanoman/<id>` → `hanoman/<id>` → `spec.headSha`.
`origin/…` didahulukan karena itulah ref yang `git push` berikutnya harus fast-forward — alasan
yang sama yang ditulis ADR-0017, dan yang diukur ulang di audit. `spec.headSha` (ADR-0019/SPEC-176,
ditulis saat sesi ditutup) jadi jaring terakhir untuk commit yang tak sempat di-push; ia
di-`rev-parse` **lunak** karena objeknya bisa sudah tak terjangkau.

`spec.baseSha` **tidak pernah ditulis ulang saat resume**, dan `headSha` tidak di-null-kan: rentang
review (ADR-0030) harus tetap mengukur basis asli → HEAD sekarang, yaitu seluruh pekerjaan yang
terakumulasi lintas sesi. `baseSha` yang null berarti spec ini belum pernah punya worktree → bukan
resume, apa pun isi disk.

### Prompt lanjutan yang sadar fase

`runner/src/prompt.ts` mendapat `resumePrompt()`. Kerangkanya **sama** dengan `startPrompt` —
protokol fase, klausa otonomi, klausa scope verifikasi (ADR-0080), peta skill, instruksi push, blok
backlog item — dengan satu blok RESUME di depan yang memuat, apa adanya:

- baris yang **sudah tercatat** di `$HANOMAN_PHASE_FILE` (mis. `Audit done`, `Spec skipped`);
- **fase berikutnya** = fase pertama yang belum tercatat;
- keadaan worktree: *utuh dari sesi sebelumnya* (ada kerja belum-commit) vs *dibangun ulang dari
  branch sesi* (hanya commit yang selamat);
- perintah memeriksa `git log`/`git status`/plan sebelum menulis apa pun.

Server **tidak pernah menulis ke berkas fase** — ia hanya membacanya. Berkas itu tetap milik agen
(append-only), jadi tak ada state ganda yang bisa berselisih.

`continuePrompt` (SPEC-172) **tidak disentuh**: ia melayani kasus lain — spec yang keburu ditandai
`done` padahal belum tuntas, kerjanya umumnya sudah ter-merge ke `branchFrom`, dan karena itu ia
memang melompat ke Execute di worktree baru. Karena `stage === "done"` masuk keadaan **fresh**,
jalur SPEC-172 berjalan persis seperti sebelumnya.

### Kontrak API

`POST /terminal/sessions {spec,…}` tetap `201 { id }`, ditambah field opsional:

```
201 { id, resumed?: true }
```

`resumed` hanya ada saat peluncuran benar-benar melanjutkan artefak. Aditif — klien lama yang hanya
membaca `id` tak terpengaruh. UI memakainya untuk membedakan toast "sesi dimulai" vs "dilanjutkan":
keluhan aslinya adalah soal **persepsi** ("malah membuat session baru"), jadi umpan baliknya harus
menyebut yang sebenarnya terjadi.

Tak ada endpoint baru, tak ada perubahan skema, tak ada migration.

### Permukaan git

`GitOps` bertambah dua operasi murni-baca:

```ts
worktreeAlive(path: string): boolean;          // path itu worktree git yang sah & bisa dipakai
revParse(repo: string, rev: string): string | null;   // resolve lunak (null, tidak melempar)
```

`addWorktree` **tidak diubah**: semantik "rebut path lalu buat" tetap benar untuk jalur fresh dan
untuk semua flow lain. Yang berubah adalah *kapan* ia dipanggil — jalur resume tak memanggilnya.
Ini beda sadar dari ADR-0017 yang menambahkan parameter `reuse` ke `addWorktree`: di sini pemanggil
sudah tahu path-nya, dan menaruh keputusan di pemanggil membuat satu-satunya jalur yang bisa
menghapus worktree tetap satu baris yang mudah diaudit.

## Skop

**Di dalam:** sesi backlog (`startSpecSession` — dipakai `POST /terminal/sessions` *dan* governor
scheduler, jadi peluncuran ulang otomatis ikut berhenti menghancurkan pekerjaan).

**Di luar (tercatat):**

- Gerbang pane-mati di `createSession()` sendiri dan di route sesi project-level
  (reverse/prd/scaffold/breakdown/cross-audit): punya cacat kembar, tapi keluhan menyebut "session
  backlog" dan resume untuk flow dokumen adalah pertanyaan berbeda (artefaknya dokumen, bukan plan
  berkotak).
- Berkas fase basi saat peluncuran **fresh** setelah artefak benar-benar hilang.
- Penutupan sesi tetap menghapus worktree (SPEC-362) — yang diperbaiki di sini peluncurannya.

## Acceptance criteria (EARS)

- **AC-1** — WHEN sesi backlog punya pane tmux **hidup**, THE SYSTEM SHALL me-re-attach dan tidak
  menyentuh worktree, `baseSha`, maupun berkas fase.
- **AC-2** — WHEN pane sesi backlog ada tapi **mati**, THE SYSTEM SHALL membunuhnya lalu melahirkan
  ulang sesi itu, bukan mengembalikan pane mati sebagai sesi.
- **AC-3** — WHEN worktree `.worktrees/<id>` masih sah DAN `spec.stage ≠ done` DAN `spec.baseSha`
  ada, THE SYSTEM SHALL memakai worktree itu apa adanya dan SHALL NOT menghapus isinya.
- **AC-4** — WHEN worktree hilang tetapi tip branch sesi (`origin/hanoman/<id>` → `hanoman/<id>` →
  `spec.headSha`) resolve, THE SYSTEM SHALL membangun worktree `--detach` di tip itu.
- **AC-5** — WHILE sebuah peluncuran adalah resume, THE SYSTEM SHALL NOT menulis ulang `baseSha`
  maupun meng-null-kan `headSha`.
- **AC-6** — WHEN peluncuran adalah resume, THE SYSTEM SHALL mengirim prompt yang memuat baris fase
  yang sudah tercatat dan menyebut fase berikutnya, dan SHALL NOT mengirim `startPrompt`.
- **AC-7** — WHEN tak ada worktree maupun tip branch sesi, THE SYSTEM SHALL berperilaku persis
  seperti sebelum SPEC-394 (bangun dari `branchFrom`, tulis `baseSha`, `startPrompt`).
- **AC-8** — WHEN `spec.stage = done`, THE SYSTEM SHALL tetap memakai jalur SPEC-172
  (`continuePrompt`, worktree dari `branchFrom`).
- **AC-9** — WHEN peluncuran adalah resume, THE SYSTEM SHALL membalas `201 { id, resumed: true }`.
- **AC-10** — THE SYSTEM SHALL NOT menulis ke `$HANOMAN_PHASE_FILE`; berkas itu tetap hanya ditulis
  agen.

## Risiko & mitigasi

| Risiko | Mitigasi |
| --- | --- |
| Worktree "hidup" tapi rusak (mis. `.git` menunjuk repo yang lenyap) → sesi lahir di direktori tak bisa dipakai | `worktreeAlive` bertanya ke git (`rev-parse --is-inside-work-tree` + `--git-dir` resolve), bukan `existsSync` |
| Tip branch sesi ternyata sudah ter-merge & main bergerak jauh | Hanya berlaku saat `stage ≠ done`; spec yang selesai & ter-merge masuk jalur SPEC-172 yang memang berbasis `branchFrom` |
| Agen menganggap fase tercatat = artefak ada, padahal worktree dibangun ulang dari branch (kerja belum-commit hilang) | Blok RESUME menyebut bentuk worktree-nya secara eksplisit dan menyuruh memeriksa `git log`/`git status`/plan lebih dulu |
| Resume dipakai governor scheduler tanpa manusia | Justru yang diinginkan: retry otomatis berhenti menghancurkan pekerjaan; tak ada perubahan kontrak governor |
