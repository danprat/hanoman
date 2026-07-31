# ADR-0089 — Backlog goal: source & flow `goal` dua fase, mode goal dipaksa dengan kondisi dari item

- Status: Accepted
- Tanggal: 2026-07-31
- SPEC: SPEC-407 (backlog khusus sesi mode goal)
- Terkait: **memperluas [0073](0073-mode-goal-stop-hook-per-sesi.md)** — mode goal berhenti jadi
  sekadar knob di atas pipeline `feature` dan mendapat bentuk backlog-nya sendiri; memakai
  [0080](0080-scope-verifikasi-per-sesi.md) (klausa scope ikut karena flow ini menulis kode),
  [0084](0084-melanjutkan-sesi-backlog.md) (resume berlaku sama), [0015](0015-one-session-per-backlog.md),
  [0002](0002-git-worktree-isolation.md); **tidak** menyentuh
  [0029](0029-execute-done-butuh-plan-terceklist.md) (gerbang plan tetap berlaku apa adanya) maupun
  [0037](0037-cabut-guardrail-safety.md) (ini Stop hook, bukan hook deny).

## Konteks

Mode goal (ADR-0073) lahir sebagai **knob per sesi**: `POST /terminal/sessions { goal: true }`
menyisipkan hook `Stop` ke `--settings`, dan itu saja. Flow sesinya tetap diturunkan dari source
backlog — dan keempat source yang ada (`brief`, `qa`, `audit`, `cross-audit`) semuanya bermuara ke
pipeline berfase. Akibatnya sesi "goal" tetap menjalankan Brainstorm → Objective → Spec → Plan →
Execute: ia menulis design doc, menulis plan berkotak, lalu mencentangnya satu per satu, sebelum
menyentuh pekerjaan yang sebetulnya diminta.

Untuk pekerjaan yang bentuknya **"capai keadaan ini"**, ritual itu bukan cuma mahal — ia salah
sasaran. Operator sudah tahu apa yang ingin dicapai; yang dibutuhkan sesi hanyalah **goal-nya**.
Dan karena backlog adalah satu-satunya pintu masuk pekerjaan berspec, "goal" tak punya tempat
tinggal: ia hanya bisa dititipkan sebagai brief lalu diharapkan agen mengabaikan fase-fasenya
sendiri — harapan yang bertabrakan langsung dengan kontrak prompt.

## Keputusan

**1. Source `goal` + flow `goal`.** `zSpecSource` menerima `"goal"`, `zFlow` menerima `"goal"`, dan
`flowForSource("goal") === "goal"` — satu-satunya pemetaan source→flow tetap satu tempat.
`Flow` di runner ikut bertambah. **Tanpa migration**: `Spec.source` adalah `String` yang divalidasi
zod (aturan skema hanoman), `Spec.payload` bertipe `Json`.

**2. Pipeline dua fase: `Goal → Verifikasi`.** Bukan nol fase, bukan lima. Nol fase membuat board
buta terhadap sesi yang sedang berjalan (stage tak pernah bergerak, dan `Spec.stage` adalah
satu-satunya yang dilihat operator dari daftar). Fase kedua ada karena **pintu keluar butuh
tempat**: `Goal` mengerjakan, `Verifikasi` membuktikan. Pemetaan stage:

| Keadaan fase | Stage |
|---|---|
| `Goal` aktif | `executing` |
| `Goal` done/skipped | `executing` |
| `Verifikasi` done/skipped | `done` |

`Goal` **aktif** sengaja sudah `executing` — aturan yang sama sudah berlaku untuk `Execute` aktif.
Tanpa itu sesi goal yang sedang berjalan tampak `brainstorming`, persis fase yang dihapus flow ini.
Nama `Goal` dan `Verifikasi` unik lintas `PIPELINES`, syarat peta `REACHED` yang berkunci nama fase.

**3. Payload sendiri: `zGoalPayload {goal, done, constraints, priority}`.** `goal` wajib —
`Spec.objective` diturunkan darinya (`deriveSpecFields`) dan ia jadi inti kondisi Stop hook. `done`
= bukti berhenti; kosong berarti "goal itu sendiri buktinya". Pengikatan source ↔ bentuk payload di
`zCreateSpec.superRefine` (SPEC-197) jadi **tiga-arah**: `qa` ↔ `severity`, `goal` ↔ `goal`, selain
itu → brief. Author diberi prefix `Goal · ` mengikuti pola `QA ·`/`Audit ·`.

**4. Prompt terpisah `startGoalPrompt`, bukan cabang di `startPrompt`.** Yang berbeda bukan
satu-dua kalimat melainkan kerangkanya: tak ada instruksi fase perencanaan, tak ada keputusan
pasca-Audit (ADR-0040), tak ada skill Brainstorm/Plan, tak ada blok `Detail:` berisi JSON payload
(isinya sudah dieja sebagai Goal / Selesai bila / Batasan). Fase `Goal` sengaja **tanpa skill** —
seluruh inti flow ini adalah membebaskan sesi dari proses kaku; yang tetap dijaga cuma pintu
keluarnya (`Verifikasi` → `superpowers:verification-before-completion`).

**5. Mode goal DIPAKSA aktif, kondisinya dari item.** Untuk flow `goal`, `opts.goal: false` tak bisa
mematikannya — backlog goal tanpa Stop hook hanyalah backlog biasa berprompt lain. Presedens
kondisinya: **override per-sesi → default dari item**; template global `Setting.goal.condition`
**dilewati**, karena ia generik untuk semua sesi sedangkan item goal membawa kondisinya sendiri, dan
yang lebih spesifik harus menang. Kondisi bawaannya menuntut tiga bukti segar di transkrip: goal
tercapai (teks `done`, atau goal itu sendiri), baris fase `Goal → Verifikasi` di `$HANOMAN_PHASE_FILE`,
dan `git push` yang sukses. Dua klausa terakhir bukan hiasan: tanpa baris fase board tak pernah
melihat item ini selesai (ADR-0008), tanpa push hasilnya hilang bersama worktree-nya.

**6. Klausa scope verifikasi ikut.** Gerbangnya berpindah dari "punya fase `Execute`" ke predikat
`writesCode(flow)` (`Execute` **atau** `Goal`). Sesi goal menulis kode meski pipeline-nya tak punya
fase `Execute`; melewatkan klausa ini membuatnya jatuh ke DoD repo target dan menjalankan suite
penuh — persis lubang yang ditutup ADR-0080.

**7. Dua pintu masuk.** (a) Tab **Goal** di modal backlog baru. (b) Tombol **"Take ke backlog"** di
preview PRD berubah jadi **pemilih**: *sebagai feature brief* (perilaku lama) atau *sebagai goal*
(prefill `goal: "Wujudkan PRD <path>"`). Keduanya tetap membawa `branchFrom = prd/<slug>` (SPEC-244).

## Konsekuensi

- **Tanpa migration, tanpa model baru, tanpa endpoint baru.** `POST /specs`, `PATCH /specs/:id`, dan
  `POST /terminal/sessions` hanya bertambah nilai enum + varian payload.
- **Gerbang plan ADR-0029 tetap berlaku.** Sesi goal umumnya tak berplan (`planComplete` → `true`
  bila tak ada berkas plan yang cocok id spec-nya), tapi bila agen memang menulis plan, `- [ ]` yang
  tersisa tetap menahan item di `executing`. Tak ada pengecualian baru.
- **Resume (ADR-0084) berlaku sama**, lewat builder yang sama: `startGoalPrompt` menerima `ResumeCtx`
  opsional. Satu penyesuaian: kalimat "baca plan di `docs/superpowers/plans/**`" di `resumeClause`
  kini hanya ditulis untuk pipeline ber-fase `Plan` — menyuruh sesi goal mencari plan justru
  mengundangnya membuat satu.
- **`ADR-0037` utuh**: yang dipasang adalah hook `Stop`, bukan deny. Interupsi manusia (`Esc`) tetap
  bekerja, dan isolasi worktree tetap satu-satunya batas keamanan.
- **Blast radius test**: menambah source & flow menyentuh `shared/src/{enums,entities,dto}.ts` —
  modul inti, jadi `vitest --changed` mendekati suite penuh (efek yang sudah diukur di ADR-0080).
  Itu melekat pada perubahannya; memindahkan enum ke tempat lain hanya akan memecah satu-satunya
  sumber kebenaran source→flow.

## Alternatif yang ditolak

- **Reuse `zBriefPayload`** (`context` = goal, `outcome` = selesai bila). Nol perubahan skema zod,
  tapi menaruh konvensi tersembunyi di kolom `Json`: pembaca DB, prompt, dan UI harus sama-sama tahu
  bahwa `context` sebenarnya bukan konteks. Bentuk payload di repo ini justru yang mengikat source —
  melunakkannya berarti melemahkan gerbang SPEC-197.
- **Tanpa fase sama sekali.** Paling longgar, tapi `Spec.stage` tak pernah bergerak: board buta
  terhadap sesi yang sedang berjalan dan operator harus menandai selesai secara manual.
- **Satu fase (`Goal` saja).** Pintu keluar tak punya tempat untuk dibuktikan; "selesai" jadi klaim
  agen alih-alih baris fase yang menyusul verifikasi.
- **Mode goal tetap opsional untuk source ini.** Backlog bernama "goal" yang bisa berjalan tanpa
  Stop hook hanya beda prompt — ia tak menjamin apa pun, dan menambah satu kombinasi keadaan yang
  harus dijelaskan ke operator tanpa memberi kemampuan baru.
