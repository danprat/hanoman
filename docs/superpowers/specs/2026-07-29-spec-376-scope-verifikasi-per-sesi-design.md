# SPEC-376 — Scope verifikasi per sesi: test berkas yang berubah, bukan seluruh project

**Tanggal:** 2026-07-29 · **Sumber:** brief · **Prioritas:** tinggi
**Status:** design disetujui (percabangan mekanisme & cakupan dijawab operator di terminal sesi)

## Masalah

Setiap sesi hanoman (backlog maupun terminal) cenderung menjalankan **seluruh** suite test,
typecheck repo-wide, lint repo-wide, build penuh, dan boot server untuk smoke API — bahkan untuk
task yang hanya menyentuh satu-dua berkas. Beberapa sesi berjalan berbarengan di satu mesin, jadi
biayanya dikalikan.

Ukuran nyata di repo hanoman sendiri (mesin operator: **8 core / 8 GB RAM**):

| Kebiasaan | Biaya |
| --- | --- |
| `vitest run --no-file-parallelism` (DoD `AGENTS.md:44`) | **258 berkas test** (server 136 · src 85 · shared 19 · runner 10 · cli 6 · sdk 2) |
| `pnpm -r typecheck` | **6 proses `tsc`** serentak |
| `pnpm build` | `vite build` + `esbuild` bundling |
| Boot server + curl (diwajibkan `CLAUDE.md`) | Postgres + build + proses server per task |

### Akar masalah

`runner/src/prompt.ts` — satu-satunya instruksi yang hanoman berikan ke sesi — **tidak pernah
menyebut scope verifikasi sama sekali**. Prompt bicara soal fase, otonomi, skill, commit, dan push;
soal "seberapa luas harus dites" ia diam. Karena diam, agen jatuh ke dua sumber lain:

1. **Konvensi repo target.** Untuk hanoman: `AGENTS.md` "Definition of done → Test hijau
   (`vitest run --no-file-parallelism`)", `CLAUDE.md` "**test API-nya secara nyata di local** — boot
   server … dan curl endpoint yang tersentuh", dan `internal/skills/hanoman/SKILL.md:166`.
2. **Kebiasaan default agen** — kalau ragu, jalankan semuanya.

Jadi ini bukan bug di satu berkas: ini **lubang di kontrak prompt**. Menambalnya berarti membuat
scope verifikasi jadi hal yang hanoman katakan secara eksplisit, sama seperti ia sudah eksplisit
soal fase (`phaseInstruction`), otonomi (`AUTONOMY_CLAUSE`), dan skill (`skillInstruction`).

## Keputusan operator (dijawab di terminal sesi)

1. **Mekanisme = prompt + env + knob per sesi.** Bukan hook deny.
2. **Cakupan = keempat-empatnya:** unit test, typecheck repo-wide, lint repo-wide, build penuh, dan
   boot-server + curl.

Konsekuensi keputusan (1): **ADR-0037 tetap utuh.** Tidak ada hook `PreToolUse` yang menolak
perintah. Presedennya ADR-0073 (mode goal) yang menambah hook `Stop` sambil menegaskan "BUKAN
guardrail deny". Harganya jujur: klausa ini **mengarahkan**, tidak memaksa — agen yang menilai
perubahannya berdampak luas tetap boleh (dan harus) memperluas sendiri.

## Rancangan

### Konsep: `verifyScope`

Scope verifikasi adalah **properti sesi**, seperti model/effort (ADR-0061), mode goal (ADR-0073),
dan agen (ADR-0074). Dua nilai:

- **`changed`** (default baru) — verifikasi hanya menyentuh apa yang berubah.
- **`full`** — perilaku persis seperti hari ini (klausa tidak disisipkan sama sekali).

Presedens nilai: **override saat Start → `Setting.verifyScope` global → `"changed"`**.

### Komponen

**1. `shared/src/enums.ts` — kosakata.**
```ts
export const VERIFY_SCOPES = ["changed", "full"] as const;
export type VerifyScope = (typeof VERIFY_SCOPES)[number];
export const zVerifyScope = z.enum(VERIFY_SCOPES);
```

**2. `shared/src/entities.ts` — knob global.**
`zSetting` += `verifyScope: zVerifyScope.default("changed")`. `Setting` adalah kolom `Json`
→ **tanpa migration**; baris `Setting` lama tetap parse karena `.default()` mengisi kunci yang
hilang (pola `scheduler` SPEC-294, `goal` SPEC-332, `agent`/`codex` SPEC-338).

**3. `shared/src/dto.ts` — override per sesi.**
Varian sesi backlog di `zCreateSession` += `verifyScope: zVerifyScope.optional()`.

**4. `runner/src/verify-scope.ts` (baru, murni & bertest) — klausa prompt.**
```ts
export function verifyScopeClause(scope: VerifyScope): string   // "" untuk "full"
```

Isi klausa untuk `changed` (bahasa Indonesia, netral-agen & netral-stack):

> **Scope verifikasi: HANYA yang berubah.** Mesin ini menjalankan beberapa sesi sekaligus —
> verifikasi seluruh project menghabiskan RAM & CPU yang dipakai sesi lain.
>
> Berkas yang berubah: `git diff --name-only "$HANOMAN_BASE_SHA"...HEAD` dan `git status --porcelain`.
>
> - **Test** — jalankan hanya test yang berkaitan dengan berkas itu. Untuk repo vitest:
>   `pnpm vitest --run --changed "$HANOMAN_BASE_SHA"` (vitest sendiri yang menurunkan berkas
>   berubah dari git, termasuk yang belum di-commit), atau `pnpm vitest related --run <berkas…>`,
>   atau sebut path test-nya langsung. Padanan stack lain: `pytest <path>`, `go test ./paket/...`.
>   **JANGAN** `pnpm test` / `vitest run` polos.
>   Catatan: `--changed` menyalakan `passWithNoTests` — pastikan test memang berjalan, jangan
>   menganggap "0 test" sebagai hijau.
> - **Typecheck** — hanya paket yang tersentuh (`pnpm --filter ./server typecheck`), bukan
>   `pnpm -r typecheck`.
> - **Lint** — hanya berkas yang berubah, bukan seluruh repo.
> - **Build penuh** — hanya bila yang kamu ubah memang soal build/bundling.
> - **Boot server + curl / smoke end-to-end** — hanya bila task ini menyentuh endpoint atau
>   perilaku runtime-nya; sekali di akhir, bukan tiap task.
>
> Suite penuh, lint penuh, dan build penuh adalah **tugas manusia sebelum merge**, bukan tugas sesi.
> Pengecualian yang kamu putuskan sendiri: bila perubahanmu memang berdampak luas (mis. mengubah
> tipe/kontrak bersama, skema, atau berkas yang diimpor banyak modul), perluas scope seperlunya dan
> **katakan alasannya**. Ini panduan biaya, bukan larangan.

**5. Penyisipan ke prompt (`runner/src/prompt.ts`).**
`startPrompt()` dan `continuePrompt()` menerima parameter `verifyScope?: VerifyScope` dan
menyisipkan klausa sesudah klausa otonomi. **Hanya kedua fungsi ini** — flow lain
(`reverse`/`scaffold`/`prd`/`breakdown`/`audit`/`cross-audit`) tidak menulis kode fitur, jadi tak
punya test untuk dijalankan; menyisipkan klausa di sana hanya menambah token tanpa efek.

**6. Env sesi (`server/src/services/session-launch.ts` → `createSession({ env })`).**
- `HANOMAN_BASE_SHA` — `baseSha` **sudah** dihitung di `startSpecSession` (`realGit.addWorktree`)
  dan disimpan ke `Spec`; di sini ia tinggal diteruskan. Tanpa ini, klausa "berkas yang berubah"
  tak bisa dieksekusi tanpa menebak: worktree lahir `--detach`, jadi `main` belum tentu ada dan
  `HEAD~1` salah.
- `HANOMAN_VERIFY_SCOPE` — `changed` | `full`, supaya scope terbaca dari dalam sesi.

Jalur env sudah ada (`CreateOpts.env`, dipakai SPEC-337 untuk kunci audit) — tak ada mekanisme baru.

**7. Terminal biasa (agen tanpa prompt).** `POST /terminal/sessions` tanpa `flow` men-spawn agen di
`repoDir` **tanpa prompt** — tak ada tempat menyisipkan klausa. Sesi itu tetap menerima
`HANOMAN_VERIFY_SCOPE`, dan pengarahannya datang dari `AGENTS.md`/`CLAUDE.md` repo target (untuk
hanoman: diperbarui di spec ini). Ini batas yang disadari, bukan yang terlewat.

**8. UI.**
- `SettingsScreen.tsx` — kartu setelan sesi: pilihan "Scope verifikasi" (Hanya yang berubah /
  Seluruh project) beserta penjelasan biayanya.
- `App.tsx` `StartSessionModal` — `Select` "Scope verifikasi", prefill dari setelan global,
  dikirim sebagai `verifyScope` (pola `agent`/`goal`).

**9. Docs (DoD hanoman sendiri).** Sumber kebiasaan lama ikut diperbaiki dalam commit yang sama:
- `AGENTS.md` — "Test hijau (`vitest run --no-file-parallelism`)" → test **yang tersentuh** hijau;
  suite penuh milik manusia sebelum merge.
- `CLAUDE.md` — kewajiban boot server + curl dilonggarkan jadi "bila task menyentuh endpoint".
- `internal/skills/hanoman/SKILL.md` — aturan sesi + baris DoD.
- `internal/docs/architecture/{api-contract,nfr}.md`, `internal/docs/requirements/frd.md` (bila
  relevan), `internal/docs/README.md` (link ADR baru).

**10. ADR-0080** — mencatat: scope verifikasi = properti sesi; mekanismenya prompt + env + knob;
**bukan** hook deny (ADR-0037 utuh); tanpa migration.

## Data flow

```
Setting.verifyScope (Json, default "changed")
        │
        ├── GET /settings ─→ SettingsScreen (default global)
        │                 └→ StartSessionModal (prefill)
        │
POST /terminal/sessions { spec, flow, verifyScope? }
        │
   startSpecSession(spec, { verifyScope })
        │  scope = opts.verifyScope ?? setting.verifyScope
        ├── startPrompt(flow, brief, branchTo, autonomy, scope)  ─→ klausa di prompt
        └── createSession(..., { env: { HANOMAN_BASE_SHA, HANOMAN_VERIFY_SCOPE } })
                                              │
                                       sesi agen: `git diff --name-only "$HANOMAN_BASE_SHA"...HEAD`
                                                  `pnpm vitest --run --changed "$HANOMAN_BASE_SHA"`
```

## Testing

| Lapis | Yang diuji |
| --- | --- |
| `runner/src/verify-scope.test.ts` | `changed` memuat perintah ber-scope & larangan suite penuh; `full` → string kosong |
| `runner/src/prompt.test.ts` | `startPrompt`/`continuePrompt` memuat klausa saat `changed`, tak memuatnya saat `full` & saat parameter absen-`full`; flow non-kode tak tersentuh |
| `shared` | baris `Setting` lama (tanpa `verifyScope`) parse → `"changed"`; `zCreateSession` menerima/menolak nilai |
| `server` (route) | body `verifyScope` diterima & diteruskan; nilai tak sah → 400 |
| `server` (launch) | env sesi memuat `HANOMAN_BASE_SHA` = `baseSha` worktree + `HANOMAN_VERIFY_SCOPE` |
| `src` (UI) | picker di `StartSessionModal` mengirim `verifyScope`; kartu Settings menyimpan |

## Non-goals

- **Tidak** ada hook deny / gate perintah (ADR-0037 utuh).
- **Tidak** mengubah cap concurrency scheduler (`maxConcurrent`) — itu knob lain yang sudah ada.
- **Tidak** menyentuh flow yang tak menulis kode (audit, cross-audit, prd, breakdown, reverse,
  scaffold).
- **Tidak** ada migration / kolom DB baru.
- **Tidak** menjanjikan jaminan keras: klausa mengarahkan, dan agen boleh memperluas scope dengan
  alasan. Jaminan keras butuh hook deny → ADR baru yang mencabut ADR-0037.

## Risiko

| Risiko | Mitigasi |
| --- | --- |
| Regresi lolos karena test ber-scope tak melihat dampak lintas modul | Typecheck paket tersentuh tetap wajib; klausa memuat pengecualian eksplisit untuk perubahan berdampak luas; suite penuh tetap dijalankan manusia sebelum merge |
| `--changed` + `passWithNoTests` → "hijau" padahal 0 test berjalan | Klausa menyebut jebakan ini terang-terangan |
| `$HANOMAN_BASE_SHA` kosong di sesi lama/terminal biasa | Klausa memberi jalan kedua (`git status --porcelain`, sebut path langsung) |
| Prompt membengkak | Klausa hanya untuk `startPrompt`/`continuePrompt`, dan kosong saat `full` |
