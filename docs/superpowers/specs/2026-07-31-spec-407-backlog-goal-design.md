# SPEC-407 — Backlog khusus sesi mode goal

Tanggal: 2026-07-31 · Sumber: brief · Prioritas: tinggi
Branch: `hanoman/spec-407`

## Masalah

Backlog hanoman hanya mengenal empat source (`brief`, `qa`, `audit`, `cross-audit`) dan tiga di
antaranya berujung ke pipeline berfase. Mode goal (SPEC-332/ADR-0073) adalah **knob yang
ditempelkan di atas pipeline itu**: `POST /terminal/sessions { goal: true }` memasang Stop hook,
tetapi flow-nya tetap `feature` — jadi promptnya tetap `Kerjakan fase berurutan: Brainstorm →
Objective → Spec → Plan → Execute`, dan sesi goal tetap menulis design doc, plan berkotak, lalu
mencentangnya satu per satu.

Untuk pekerjaan yang bentuknya "capai keadaan ini", ritual itu bukan cuma mahal — ia salah
sasaran. Operator sudah tahu apa yang ingin dicapai; yang dibutuhkan sesi cuma **goal-nya**.

Dua pintu masuk yang diminta:
1. **Buat goal backlog langsung** (form backlog baru).
2. **Dari PRD ke goal** — PRD yang sudah ada dijadikan satu goal, bukan dipecah jadi brief.

## Objective (MVP)

Satu jenis backlog baru — **source `goal`** — yang melahirkan sesi ber-**flow `goal`**: dua fase
(`Goal → Verifikasi`), tanpa Brainstorm/Objective/Spec/Plan, dengan mode goal (Stop hook) selalu
menyala dan kondisinya diturunkan dari isi item itu sendiri. Bisa dibuat langsung dari modal
backlog baru, atau dari preview PRD lewat pilihan "sebagai goal".

Bukan bagian dari MVP ini (YAGNI): scheduler khusus goal, goal lintas project, goal tanpa Spec
(sesi lepas), dan mengubah perilaku mode goal untuk source lain.

## Keputusan yang diambil (dijawab operator, 2026-07-31)

| # | Percabangan | Keputusan |
|---|---|---|
| 1 | Bentuk fase | **Dua fase: `Goal` + `Verifikasi`** |
| 2 | Bentuk payload | **Payload khusus `{goal, done, constraints, priority}`** |
| 3 | Jalur PRD → goal | **Tombol "Take ke backlog" lama jadi pilihan** (brief / goal) |
| 4 | Stop hook | **Dipaksa aktif** untuk source `goal`, kondisi bawaan dari item |

## Arsitektur

### 1. Source & flow baru (shared)

```
zSpecSource  += "goal"                       shared/src/enums.ts
zFlow        += "goal"                       shared/src/dto.ts
flowForSource("goal") → "goal"               shared/src/dto.ts
Flow         += "goal"                       runner/src/types.ts
```

Keduanya modul INTI — `vitest --changed` akan menyapu luas (ADR-0080 mencatat efek ini: menyentuh
`shared/src/{enums,entities,dto}.ts` ≈ suite penuh). Itu blast radius yang memang melekat pada
"menambah satu source": tak ada jalan memutar, dan menambah enum di tempat lain justru memecah
satu-satunya sumber kebenaran source→flow.

**Tanpa migration.** `Spec.source` adalah `String` yang divalidasi zod (aturan skema hanoman), dan
`Spec.payload` bertipe `Json`.

### 2. Payload goal (shared)

```ts
export const zGoalPayload = z.object({
  goal: z.string(),          // apa yang harus tercapai — WAJIB (min 1 di form)
  done: z.string(),          // "selesai bila" — bukti/kondisi berhenti; boleh kosong
  constraints: z.string(),   // batasan
  priority: zPriority,
});
```

Masuk ke tiga union yang sudah ada: `zSpec.payload`, `zCreateSpec.payload`, `zPatchSpec.payload`.
`zCreateSpec.superRefine` yang hari ini mengikat `source === "qa"` ↔ payload ber-`severity`
diperluas jadi tiga-arah: `qa` ↔ `severity`, `goal` ↔ `goal`, selain itu → brief. Tanpa itu union
non-strict membuat `deriveSpecFields` bisa menurunkan objective dari bentuk yang salah — persis
alasan superRefine itu ditulis di SPEC-197.

`deriveSpecFields` (server/src/routes/specs.ts) menurunkan `objective` dari `payload.goal`
(fallback `done`), `priority` dari input manual. Author diberi prefix `Goal · <email>` mengikuti
pola `QA ·` / `Audit ·` / `Audit lintas ·`.

### 3. Pipeline & stage

```
PIPELINES.goal = ["Goal", "Verifikasi"]      runner/src/prompt.ts
REACHED.Goal        = "executing"            server/src/services/session-phases.ts
REACHED.Verifikasi  = "done"
```

`Goal` **aktif** juga memetakan ke `executing` (aturan yang sama sudah dipakai `Execute` aktif) —
tanpa itu sesi goal yang sedang berjalan tampak `brainstorming` di board, padahal justru fase itu
yang dihapus. Nama `Goal` dan `Verifikasi` unik lintas `PIPELINES` (syarat `REACHED`).

Gerbang plan ADR-0029 tetap berlaku apa adanya lewat `stageForRun`: sesi goal biasanya tak menulis
plan (`planComplete` → `true` bila tak ada berkas plan yang cocok id spec-nya), tapi kalau agen
memang menulis plan, `- [ ]` yang tersisa tetap menahan item di `executing`. Tak ada pengecualian
baru yang perlu ditulis.

### 4. Prompt sesi goal (runner)

`startGoalPrompt(spec, branchTo, { autonomy, verifyScope, resume? })` — builder terpisah, bukan
cabang di dalam `startPrompt`, karena isinya memang beda bentuk: tak ada instruksi fase
perencanaan, tak ada `auditDecisionInstruction`, tak ada skill Brainstorm/Plan.

Isinya:
1. Kalimat pembuka: ini sesi **goal**; TIDAK ada fase Brainstorm/Objective/Spec/Plan; jangan
   menulis design doc atau plan berkotak — langsung kejar goal-nya. SoT tetap berlaku (docs yang
   tersentuh diperbarui di commit yang sama).
2. Goal · Selesai bila · Batasan, dari payload.
3. `phaseInstruction(PIPELINES.goal)` apa adanya (dua fase, tanpa gerbang plan — gerbang itu
   hanya ditambahkan untuk pipeline ber-`Plan`+`Execute`).
4. `autonomyClause` (manual → klausa lama; scheduler → full-control).
5. **`verifyScopeClause`** — sesi goal menulis kode, jadi klausa scope wajib ada. Gerbangnya hari
   ini `PIPELINES[flow].includes("Execute")`; diperluas jadi predikat `writesCode(flow)` yang juga
   benar untuk pipeline goal. Melewatkan ini berarti sesi goal jatuh ke DoD repo target dan
   menjalankan suite penuh — persis lubang yang ditutup ADR-0080.
6. `skillInstruction`: `Verifikasi → superpowers:verification-before-completion`. Fase `Goal`
   **sengaja tanpa skill** — keseluruhan intinya membebaskan sesi dari proses kaku; yang tetap
   dijaga adalah pintu keluarnya (bukti sebelum klaim selesai).
7. Commit + `git push origin HEAD:refs/heads/<branchTo>`.
8. Blok backlog item (id · source · prioritas · judul · objective · detail payload).

Bila sesi **dilanjutkan** (SPEC-394/ADR-0084), `startGoalPrompt` menerima `ResumeCtx` dan
menyisipkan `resumeClause` yang sama seperti `resumePrompt` — dengan satu penyesuaian: kalimat
"baca plan di `docs/superpowers/plans/**`" hanya ditulis untuk pipeline ber-fase `Plan`. Sesi goal
tak punya plan, dan menyuruh agen mencarinya cuma mengundang ia membuatnya.

### 5. Mode goal dipaksa aktif (server)

Di `startSpecSession`:

```
flow === "goal"  → goal SELALU aktif (opts.goal tak bisa mematikannya)
kondisi          : opts.goalCondition (override operator)
                 → defaultGoalCondition({ flow: "goal", specId, branchTo, goal: <payload> })
```

Template global `Setting.goal.condition` **dilewati** untuk flow goal: template itu bersifat
generik untuk semua sesi, sedangkan item goal membawa kondisinya sendiri — yang lebih spesifik
harus menang. Override per-sesi tetap paling tinggi.

`defaultGoalCondition` mendapat cabang goal (di `runner/src/goal.ts`, murni & bertest):

```
Sesi goal hanoman SPEC-407. GOAL: <payload.goal>
Hanya boleh berhenti bila transkrip TERBARU memuat bukti langsung:
1. goal tercapai — <payload.done bila ada, jika tidak: goal itu sendiri>;
2. output `cat "$HANOMAN_PHASE_FILE"` memuat baris untuk fase Goal → Verifikasi;
3. output `git push origin HEAD:refs/heads/<branchTo>` yang SUKSES sesudah commit terakhir.
```

Klausa 2 & 3 bukan hiasan: tanpa baris fase, board tak pernah melihat item itu selesai; tanpa
push, hasil sesi hilang bersama worktree-nya. Tetap dipotong `GOAL_MAX` (4000) seperti sekarang.

Pembacaan payload dilakukan `readGoalPayload()` di modul baru `runner/src/goal-spec.ts` — modul
terpisah karena `goal.ts` sudah mengimpor `prompt.ts` (`PIPELINES`), jadi menaruh reader di
`prompt.ts` akan membuat siklus impor. Reader-nya defensif: payload datang dari kolom Json, jadi
bentuk apa pun yang bukan objek ber-`goal` string → `null`.

### 6. UI

**Modal backlog baru** (`NewSpecModal`): tab keempat **Goal** (ikon `target`). Field: Project ·
Branch · Judul · **Goal** (wajib) · **Selesai bila** · **Batasan** · Prioritas. Kalimat penjelas:
"Sesi goal langsung mengejar goal-nya — tanpa brainstorm, spec, atau plan. Sesi lahir dengan mode
goal aktif dan menolak berhenti sampai buktinya ada."

**Backlog** (`BacklogScreen`): `SOURCE_META.goal = { label: "Goal", icon: "target", tone: "brass" }`;
detail item menampilkan Goal / Selesai bila / Batasan; form edit inline (selagi item belum pernah
dimulai) memakai field yang sama.

**Picker Start** (`StartSessionModal`): saat `flowForSource(source) === "goal"`, switch "Mode goal"
**dipaksa aktif & dinonaktifkan** dengan hint "Backlog goal selalu berjalan dalam mode goal", dan
textarea kondisi ber-placeholder "Kosong = goal item ini". Kirimannya tetap `goal: true` +
`goalCondition` opsional — kontrak endpoint tak berubah.

**PRD** (`PrdScreen`): tombol "Take ke backlog" tak lagi langsung membuka modal brief; ia membuka
**pemilih kecil** (modal DS, dua pilihan berpenjelasan):
- *Sebagai feature brief* — perilaku hari ini (brainstorm → … → execute), prefill `context: "Dari
  PRD: <path>"`.
- *Sebagai goal* — prefill kind `goal`, `goal: "Wujudkan PRD <path>"`, `done` kosong.

Keduanya tetap membawa `branchFrom = prdBranchOf(path)` (SPEC-244) supaya worktree lahir di branch
PRD-nya. "Breakdown ke backlog" tak tersentuh.

## Kontrak yang TIDAK berubah

- Tak ada endpoint baru. `POST /specs`, `PATCH /specs/:id`, `POST /terminal/sessions` menerima
  bentuk yang sudah ada, hanya union payload & enum yang bertambah.
- Tak ada migration; tak ada model Prisma baru.
- ADR-0037 (guardrail dicabut) tetap utuh — mode goal adalah Stop hook, bukan deny.
- ADR-0015 (satu backlog satu sesi), ADR-0084 (resume), ADR-0080 (scope verifikasi) berlaku sama
  untuk flow goal.

## Test (yang akan ditulis lebih dulu — TDD)

| Lapis | Berkas | Yang dijaga |
|---|---|---|
| shared | `shared/test/enums.test.ts`, `dto.test.ts`, `entities.test.ts` | `goal` sah sebagai source & flow; `flowForSource("goal")`; superRefine tiga-arah menolak pasangan source↔payload yang salah |
| runner | `runner/test/prompt.test.ts` | `PIPELINES.goal`; `startGoalPrompt` memuat goal/selesai-bila/scope/push dan **tidak** memuat kata Brainstorm/Spec/Plan; varian resume tanpa kalimat plan |
| runner | `runner/test/goal.test.ts` | `defaultGoalCondition` flow goal memuat teks goal + dua bukti; fallback saat `done` kosong; potong `GOAL_MAX` |
| runner | `runner/test/goal-spec.test.ts` (baru) | `readGoalPayload` defensif (null/objek asing/`goal` non-string) |
| server | `server/test/session-phases.test.ts` | `Goal` aktif → `executing`; `Goal done` → `executing`; `Verifikasi done` → `done`; gerbang plan tetap menahan |
| server | `server/test/session-launch.test.ts` | flow goal → prompt goal + `goal` argv terpasang walau `opts.goal === false`; kondisi dari payload; template global dilewati |
| server | `server/test/specs.route.test.ts` | `POST /specs` source goal → objective dari `payload.goal`, author `Goal ·`; payload salah bentuk → 400 |
| web | `src/test/backlog-goal.test.tsx` (baru) | tab Goal di modal, payload terkirim, badge & detail item |
| web | `src/test/start-session-goal.test.tsx` | switch terkunci aktif untuk spec goal |
| web | `src/test/prd-screen.test.tsx` | pemilih brief/goal, prefill & branchFrom |

## Docs yang tersentuh (commit yang sama)

- `internal/docs/adr/0089-backlog-goal-flow-dua-fase.md` (baru) + ditaut di
  `internal/docs/README.md` **dan** `internal/docs/adr/README.md` (SPEC-386).
- `internal/docs/architecture/api-contract.md` — enum source & flow, bentuk payload goal.
- `internal/docs/architecture/data-model.md` — bentuk `Spec.payload` ketiga.
- `internal/skills/hanoman/SKILL.md` — butir sesi & eksekusi.

## Risiko

1. **Blast radius `--changed`.** Menyentuh `shared/src/{enums,dto,entities}.ts` menarik hampir
   seluruh suite. Mitigasi: jalankan set `--changed` dengan `--no-file-parallelism` (wajib — test
   server berbagi satu berkas DB; SPEC-397 mengukur 181 gagal palsu vs 736 lulus).
2. **Sesi goal tanpa rem perencanaan** bisa mengembara. Mitigasi: kondisi Stop hook menuntut bukti
   segar + push; `verifyScope` tetap `changed`; worktree tetap satu-satunya batas (ADR-0002/0037).
3. **Item goal lama sebelum fitur ini tak ada** — tak ada masalah kompatibilitas mundur; enum
   hanya bertambah, dan `flowForSource` tetap jatuh ke `feature` untuk source tak dikenal.
