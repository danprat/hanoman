# ADR-0032 — Branch adalah properti backlog item

**Status:** accepted · 2026-07-09
**Konteks:** SPEC-143 (objective backlog: pilih branch sumber worktree)

## Konteks

`branchFrom` adalah properti **Run**, bukan **Spec**. Nilainya lahir di empat produsen terpisah yang
semuanya jatuh ke `"main"`, dan tak satu pun bisa dipengaruhi backlog item:

| Produsen | Nilai sebelum SPEC-143 |
|---|---|
| `POST /runs` (`shared/src/dto.ts`) | `z.string().default("main")` |
| Trigger fan-out (`server/src/fire-trigger.ts`) | `ctx.branch ?? "main"` |
| CLI `runFlow` (`cli/src/commands/_run.ts`) | hardcoded `"main"` |
| Web `startRun()` (`src/src/App.tsx`) | tak pernah mengirim `branchFrom` |

Akibatnya setiap run mem-basis worktree-nya pada `main`, walau pekerjaannya ditujukan untuk branch
lain. Menambal hanya jalur `POST /runs` — satu-satunya yang disebut brief — akan membuat tombol
"Mulai" bekerja sementara run dari trigger diam-diam tetap di `main`.

## Keputusan

1. **Kolom `Spec.branchFrom String?`.** Nullable; `null` = default project (`main`). Tanpa backfill,
   sehingga setiap baris `Spec` lama tetap sah dan berperilaku persis seperti sebelumnya.

2. **Bukan titipan di `payload`.** `specBlock()` di `runner/src/phases.ts` men-`JSON.stringify`
   `payload` langsung ke dalam prompt **setiap fase**; nama branch akan jadi derau di kelima fase.
   `branchFrom` adalah konfigurasi run, bukan isi brief yang ditulis manusia.

3. **`GET /projects/:id/branches` memasok pilihan sekaligus whitelist validasi.** `POST /specs` dan
   `PATCH /specs/:id` menolak branch di luar `refs/heads` repo project. Satu daftar, satu gerbang —
   tak ada validator terpisah yang bisa ikut basi.

4. **`branchFrom` diresolusikan ke commit SHA sebelum diserahkan ke worktree.** Lihat *Keamanan
   argumen* di bawah.

5. **Presedens trigger.** `ctx.branch` menang untuk trigger `commit` (yang ingin diuji adalah branch
   yang baru menerima commit); `spec.branchFrom` menang untuk `manual`, `schedule`, `interval`.

6. **CLI memakai `--branch-from`**, berpasangan dengan `--branch-to` yang sudah ada — **bukan**
   `--from`, yang sudah punya arti terdokumentasi (`hanoman scaffold --project P --from objective`).

## Keamanan argumen

Sebuah branch **boleh bernama seperti flag**: `git check-ref-format 'refs/heads/--force'` valid.
Branch begitu ada di dalam repo, sehingga **lolos whitelist**, lalu git membacanya sebagai opsi.

Yang terjadi bukan penolakan. Diverifikasi terhadap git 2.50.1: sub-perintah `worktree`+`add` dengan
`--detach <path> --force` **sukses** — git menelan `--force` sebagai opsi dan diam-diam memakai
`HEAD`. Worktree terbangun di pohon yang salah **tanpa satu pun error**.

Sub-perintah itu juga tak dapat diuji dari dalam sebuah run: `deniesDangerous`
(`runner/src/safety.ts`) memblokirnya, sebagaimana mestinya. Maka desain apa pun yang bersandar pada
cara ia mem-parse `--` akan menjadi klaim yang tak terverifikasi.

Karena itu ambiguitasnya dihilangkan, bukan ditawar:

```ts
const resolveCommit = (repo: string, rev: string) =>
  git(repo, ["rev-parse", "--verify", "--end-of-options", `${rev}^{commit}`]).trim();
```

String heksadesimal tak pernah bisa terbaca sebagai opsi. Urutan argumen mengikat: `--verify` harus
mendahului `--end-of-options`. `switchBase` memakai `git checkout --end-of-options`.

## Konsekuensi

- **Diterima:** sebuah backlog item dapat berjalan di branch selain pilihannya bila dipicu commit
  (keputusan 5). Ini default yang dipilih hanoman, belum dikonfirmasi manusia; membaliknya hanya
  menyentuh `fireTrigger`.
- **Diterima:** repo yang branch default-nya `master` gagal keras di `resolveCommit`. Itu persis
  perilaku sebelum SPEC-143 (`branchFrom` hardcoded `"main"`), jadi bukan regresi — dan kini pesannya
  menyebut nama branch-nya, sejalan [ADR-0009](0009-guardrail-crash-fails-loud.md).
  `Project.defaultBranch` adalah jalan keluarnya bila ada yang menuntut.
- **Efek samping yang diinginkan:** validasi branch memaksa `POST /specs` memuat baris `Project`-nya,
  sehingga project tak dikenal kini menghasilkan 404 jujur, bukan pelanggaran foreign-key.
- **Tetap terbuka, di luar scope:** `PATCH /runs/:id/worktree` menerima `branchFrom` teks bebas tanpa
  whitelist. `switchBase` yang dikeraskan menutup sisi flag-injection-nya, bukan sisi "branch tak ada".
- **Tetap terbuka, di luar scope:** `--from` masih diparse dan dibuang `runFlow`, sehingga
  `hanoman scaffold --from objective` yang didokumentasikan `AGENTS.md` belum melakukan apa pun.

## Alternatif yang ditolak

- **`branchFrom` di dalam `payload` JSON.** Nol migration, tapi mencemari prompt setiap fase (lihat
  keputusan 2) dan harus diduplikasi di dua skema payload (`zBriefPayload`, `zQaPayload`).
- **Menyematkan `refs/heads/` di depan nama branch** alih-alih meresolusikan ke SHA. Aman dari flag,
  tetapi mematikan DWIM: branch yang hanya ada sebagai remote-tracking (run github-backed) tak lagi
  resolve.
- **Menanyakan branch saat tombol "Mulai" ditekan.** Paling malas, tapi gagal memenuhi objective:
  branch harus dipilih saat item dibuat dan dapat diubah selama menunggu di backlog.
