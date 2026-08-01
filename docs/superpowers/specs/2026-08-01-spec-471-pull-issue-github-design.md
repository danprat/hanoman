# SPEC-471 — Tarik issue GitHub ke backlog, satu issue satu perbaikan

Tanggal: 2026-08-01 · Sumber: qa · Prioritas: tinggi · Branch: `hanoman/spec-471`
Doc-of-record diagnosis: [`internal/docs/research/audit-spec-471-pull-issue-github.md`](../../../internal/docs/research/audit-spec-471-pull-issue-github.md)

## Objective

1. Operator dapat **menarik** issue dari repo GitHub sebuah project ke dalam hanoman.
2. Tiap issue dapat **dipetakan 1:1 menjadi satu backlog item** — lalu dikerjakan lewat jalur sesi
   yang sudah ada (satu backlog = satu sesi = satu worktree, ADR-0015).
3. Menarik ulang **tidak pernah** melahirkan backlog duplikat, dan tidak pernah membatalkan
   keputusan triase yang sudah diambil.

## Yang sudah terukur (bukan asumsi)

Diukur langsung di mesin ini sebelum desain dikunci (`gh` 2.96.0, `api.github.com`, 2026-08-01).

| # | Probe | Hasil |
|---|---|---|
| M1 | `gh issue list --repo … --json` | 28 field tersedia; yang dipakai: `number,title,body,author,labels,url,state,createdAt,updatedAt`. **Default `--limit` = 30** (bukan semua). |
| M2 | `GH_TOKEN=<palsu> gh issue list …` | **`HTTP 401: Bad credentials`** ⇒ env token **mengalahkan** keyring. Satu jalur `gh` bisa melayani dua mode auth. |
| M3 | `gh` gagal: issues dimatikan / repo tak ada / token invalid | ketiganya **exit 1** dengan stderr yang berbeda-beda dan bisa dibedakan. |
| M4 | REST `GET /repos/cli/cli/issues?state=open&per_page=30` | **30 item, 14 di antaranya pull request** (`"pull_request"` ada di objeknya). `gh issue list` pada repo & limit yang sama: **30 issue murni, 0 PR**. |
| M5 | REST `GET /repos/zamaludin/kirimchat-multi/issues` (issues **DIMATIKAN**) | **HTTP 200**, **71 item — 71-71-nya pull request**. `gh` pada repo yang sama: **exit 1**, `has disabled issues`. |
| M6 | `GET /repos/{slug}` | `has_issues` membedakan dimatikan (`false`) dari kosong; `zamaludin/kirimchat-multi` → `false`, `denameidina/hanoman` → `true` (`open_issues_count: 9`). |
| M7 | Sweep 8 project (audit B5) | 4 ber-host GitHub, hanya **2** punya `Project.gitRemote` terisi; `inkara` punya `gitRemote` **tanpa `repoDir`**; `erp-tumbuh-ai` ber-host GitLab. |

**Konsekuensi desain langsung:**

- **M4+M5 ⇒ kedua jalur auth TIDAK setara, dan ketidaksetaraannya berbahaya.** Di GitHub, setiap
  pull request **adalah** sebuah issue; endpoint REST `/issues` memuat keduanya, `gh issue list`
  hanya issue. Jalur REST **wajib** membuang tiap item ber-kunci `pull_request`. Tanpa filter itu,
  menarik `zamaludin/kirimchat-multi` — repo yang **tak punya issue sama sekali** — akan melahirkan
  **71 backlog item dari pull request**. Ini bukan kemungkinan teoretis; itu angka yang terukur.
- **M5+M6 ⇒ REST tak bisa mendeteksi "issues dimatikan" dari endpoint issue-nya** (ia menjawab 200).
  Jalur REST harus membaca `has_issues` dari `/repos/{slug}` lebih dulu.
- **M3 ⇒ kegagalan `gh` adalah jawaban OTORITATIF, bukan alasan fallback.** Bila `gh` menjawab
  "issues dimatikan" lalu hanoman diam-diam jatuh ke REST, REST akan menjawab 200 dengan 71 PR
  (M5) — fallback justru **memproduksi** bug yang paling ingin dihindari. Fallback hanya sah saat
  `gh` **tak bisa dieksekusi** (ENOENT) atau **tak terautentikasi**.
- **M1 ⇒ `--limit` wajib eksplisit.** Default 30 akan memotong repo ramai tanpa satu pun peringatan.
- **M2 ⇒ satu jalur `gh`, dua mode auth.** `GITHUB_TOKEN` dari `CONFIG_REGISTRY` cukup diteruskan
  sebagai `GH_TOKEN` di env anak; tak perlu cabang kode kedua untuk hub VPS yang tak punya keyring.
- **M7 ⇒ resolusi repo tak boleh bergantung pada satu sumber.** `Project.gitRemote` **??** `origin`
  dari `repoDir`, tanpa mensyaratkan `repoDir` ada.

## Keputusan manusia (ditanya & dijawab di sesi ini)

1. **Cara bicara ke GitHub** = **keduanya** — `gh` dulu, fallback HTTP ke `api.github.com`.
2. **Tempat idempotensi** = **model `GithubIssue` penuh**, cermin `Ticket` (ADR-0062), berikut
   status triase `new|accepted|rejected` dan back-pointer `specId`.
3. **Arah balik** = **baca saja**. hanoman tidak pernah menulis komentar maupun menutup issue.

## Arsitektur

```
 Settings ─► GITHUB_TOKEN (kind:"secret", CONFIG_REGISTRY, ADR-0049) ──┐
                                                                       │
 UI Triase ─► POST /api/projects/:id/github/pull                       │
                    │                                                  │
                    ▼                                                  │
        services/github-issues.ts                                      │
          ├─ resolveGithubRepo()   gitRemote ?? origin(repoDir)  ◄── M7 │
          │     └─ host bukan github. → 400 bertuliskan hostnya         │
          ├─ fetchIssues(slug)                                          │
          │     ├─ [1] gh CLI  ──── env: GH_TOKEN ◄────────────────────┘
          │     │     exit≠0 & bukan ENOENT/unauth ⇒ ERROR, BUKAN fallback ◄── M3/M5
          │     └─ [2] REST  ── buang item ber-`pull_request` ◄── M4/M5 (14/30 · 71/71)
          │                  └─ cek has_issues dulu ◄── M6
          │     └─ keduanya → toIssue() : SATU bentuk normal
          └─ upsert GithubIssue  id = "<projectId>:<owner>/<repo>#<n>"
                └─ update TAK PERNAH menyentuh `status` / `specId` ◄── jaminan idempotensi
                    │
                    ▼
 UI Triase tab "Issue GitHub" ─► POST /api/github-issues/:id/accept  (satu & massal)
                    │
                    ▼
        services/github-accept.ts   (cermin services/ticket-accept.ts)
          └─ prisma.spec.create  ← call site KEEMPAT di seluruh server
                    │
                    ▼
              Backlog → Start → worktree → fix → integrate
```

### 1. Data — `GithubIssue` (ADR-0095, migration tulis tangan)

```prisma
model GithubIssue {
  id             String   @id       // deterministik: "<projectId>:<owner>/<repo>#<number>"
  projectId      String
  repoSlug       String             // "owner/repo"
  number         Int
  title          String
  body           String             // markdown apa adanya
  authorLogin    String
  labels         Json               // string[]
  url            String
  issueState     String             // open | closed — keadaan DI GITHUB saat ditarik
  status         String   @default("new") // new | accepted | rejected (cermin zTicketStatus)
  specId         String?            // soft-link Spec (TANPA FK — cermin Ticket.specId)
  issueCreatedAt DateTime
  issueUpdatedAt DateTime
  pulledAt       DateTime
  version        Int      @default(0) // version-stamp sync (ADR-0045)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  project        Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  @@index([projectId, status])
}
```

**Kenapa id deterministik.** Persis alasan `CustomAgent` (ADR-0094): dua mesin yang menarik repo
yang sama harus bertemu sebagai **satu** baris di change-feed, bukan dua yang saling menelan.
`projectId` ikut di dalamnya karena dua project hanoman boleh menunjuk repo yang sama.

**`specId` sengaja tanpa FK**, cermin `Ticket.specId` — menghindari kelas SPEC-382 (feed
memancarkan anak sebelum induk → FK ditolak). Satu-satunya FK adalah ke `Project`, yang sudah disync.

**Sync** (`services/sync.ts`): `githubIssue` masuk `SYNCED`, `DELEGATE`, `FIELDS`, `DATE_FIELDS`.
`FIELDS` memuat **setiap** kolom bermakna — `upsert` yang melewatkan kolom ber-default tetap
berhasil dan mendaratkan default palsu di tiap client **tanpa satu pun error** (kelas
ADR-0090/0093/0094). `version` tak pernah masuk `FIELDS`.

### 2. Menarik — `services/github-issues.ts`

`resolveGithubRepo(projectId)` → `{ owner, repo, slug }` | `{ error }`:

| Keadaan | Hasil |
|---|---|
| `Project.gitRemote` terisi & ber-host github | slug dari situ |
| `gitRemote` kosong → `origin` dari `repoDir` (`listRemotes`, sudah ada) | slug dari situ (M7: menyelamatkan `crm-tumbuh-ai` & `videos`) |
| host bukan `github.` (mis. `gitlab.com`) | error yang **menyebut hostnya** — bukan diam (M7: `erp-tumbuh-ai`) |
| tak ada `gitRemote` **dan** tak ada `repoDir`/origin | error "project belum punya remote GitHub" |
| ada `gitRemote` tapi tak ada `repoDir` | **tetap jalan** (M7: `inkara`) |

`fetchIssues(slug, { state, limit })` — dua jalur, satu bentuk keluaran:

```
[1] gh   : HANOMAN_GH_BIN (default "gh")
           gh issue list --repo <slug> --state <s> --limit <n>
              --json number,title,body,author,labels,url,state,createdAt,updatedAt
           env: { ...process.env, GH_TOKEN?: cfg.GITHUB_TOKEN }        ◄── M2
           ENOENT / "gh auth login" di stderr  → jatuh ke [2]
           exit≠0 lainnya                      → ERROR (jawaban otoritatif)  ◄── M3/M5

[2] REST : GET /repos/<slug>            → has_issues===false ⇒ error "issues dimatikan"  ◄── M6
           GET /repos/<slug>/issues?state=<s>&per_page=100 (paginate s.d. limit)
           .filter(i => !("pull_request" in i))                        ◄── M4/M5 WAJIB
           header Authorization hanya bila GITHUB_TOKEN ada
```

Keduanya bermuara ke `toIssue(raw): NormalIssue` — satu normalizer, dua adapter tipis. Perbedaan
bentuk yang harus diserap adapter: `gh` memberi `author.login` & `labels[].name` & `state:"OPEN"`
(kapital), REST memberi `user.login` & `labels[].name` & `state:"open"`.

`pullIssues(projectId, opts)` → upsert per issue:

- **create** → `status: "new"`, `specId: null`.
- **update** → **hanya** `title, body, labels, url, issueState, issueUpdatedAt, pulledAt`.
  `status` dan `specId` **tidak pernah** disentuh. Ini satu-satunya yang membuat "tarik ulang tak
  melahirkan duplikat" benar; kalau `status` ikut di-reset, issue yang sudah `accepted` kembali
  `new` dan accept berikutnya melahirkan `Spec` kedua.
- `notifySynced("githubIssue", id)` per baris yang berubah.

Mengembalikan `{ repo, pulled, created, updated, skippedPullRequests }` — `skippedPullRequests`
sengaja dilaporkan, bukan disenyapkan: ia bukti filter M4/M5 hidup.

### 3. Menerima — `services/github-accept.ts` (cermin `ticket-accept.ts`)

```
acceptGithubIssue(issue, { author, priority, source? }) → { spec, created }
```

- **Idempoten**: `if (issue.specId) return { spec: existing, created: false }` — persis
  `acceptTicket`.
- **Label → source**, dengan override operator:

  | label (lowercase, `includes`) | source | flow |
  |---|---|---|
  | `bug`, `defect`, `regression` | `qa` | audit → keputusan → execute |
  | `enhancement`, `feature`, `feat` | `brief` | spec → plan → execute |
  | `question`, `docs`, `documentation` | `audit` | audit-only |
  | **tak ada / tak dikenal** | **`qa`** | audit dulu |

  Default `qa` **bukan** cermin `Ticket` (yang default `brief`), dan itu disengaja: kesembilan issue
  nyata di repo ini **tak berlabel sama sekali** (audit B1), sementara isinya laporan cacat. Untuk
  laporan yang belum terklasifikasi, flow yang **menyelidiki lebih dulu** adalah default yang aman;
  flow `brief` akan langsung membangun sesuatu dari premis yang belum diperiksa. Operator tetap bisa
  menimpanya lewat `source` di request.

- **Payload cocok-source** (dituntut `zCreateSpec.superRefine`, kelas jebakan yang sudah dibayar
  SPEC-197): `qa` → `{severity:"major", steps, expected, actual, env}` dengan badan issue + backlink
  di `actual`; selain itu → `{context, outcome, constraints}`.
- `author: "GitHub · <email>"` (cermin `"Help · …"`), `objective` memuat `<slug>#<n>` + URL.
- Retry `P2002` ≤3 di sekitar `nextSpecId` (TOCTOU) — cermin ketiga call site yang sudah ada.
- Tandai `issue.status = "accepted"`, `issue.specId = spec.id`; `notifySynced` untuk **dua** entitas.

**Massal**: `POST /api/github-issues/accept { ids[], priority?, source? }` memanggil fungsi yang
sama dalam loop — satu issue tetap satu `Spec` (objective #2). Satu issue gagal tak menghentikan
sisanya (cermin `checkTriase`).

### 4. API

| Method & path | Fungsi | Capability |
|---|---|---|
| `POST /api/projects/:id/github/pull` | tarik issue → `GithubIssue` | `support:write` |
| `GET /api/projects/:id/github/issues` | daftar (filter `?status=`) | `support:read` |
| `POST /api/github-issues/accept` | terima massal → N `Spec` | `support:write` |
| `POST /api/github-issues/:id/accept` | terima satu → 1 `Spec` | `support:write` |
| `POST /api/github-issues/:id/reject` | `status = "rejected"` | `support:write` |
| `POST /api/github-issues/:id/unlink` | lepas `specId`, balik `new` (cermin unlink tiket) | `support:write` |

`capabilityForRoute`: `top === "github-issues"` → `rw("support")` (satu domain dengan `tickets` —
keduanya permukaan triase masuk), dan di cabang `top === "projects"`, `sub === "github"` →
`rw("support")`. Dipetakan **menurut method** lewat `rw()`, bukan prefix — kelas bug SPEC-405.

### 5. Config

| Key | kind | category | Keterangan |
|---|---|---|---|
| `GITHUB_TOKEN` | `secret` | `credential` | PAT scope `repo` (atau `public_repo`). Kosong = andalkan keyring `gh`; repo publik tetap terbaca via REST tanpa token (kuota 60/jam). |
| `HANOMAN_GH_BIN` | `path` | `knob` | default `gh`; cermin `HANOMAN_CLAUDE_BIN`/`HANOMAN_SSH_BIN`. |

`hanoman doctor` menambah satu probe **non-fatal** `gh` (cermin `claude`/`codex`): ada → versinya;
tak ada → "gh — tak ada (tarik issue akan lewat HTTP + GITHUB_TOKEN)".

### 6. UI

`TriageScreen` mendapat **tab kedua** — "Issue GitHub" — bukan layar/nav baru:
tombol **Tarik issue** (per project), daftar issue ber-badge status, aksi **Terima** / **Tolak**
per baris, checkbox + **Terima terpilih** untuk massal, dan tautan ke `Spec` untuk yang sudah
diterima. Repo yang tak bisa di-resolve tampil sebagai pesan yang menyebut sebabnya (host bukan
GitHub / belum ada remote / issues dimatikan), bukan daftar kosong.

## Testing

Rigid TDD — merah dulu, per unit terkecil.

| Berkas | Menjaga |
|---|---|
| `server/test/github-slug.test.ts` | `gitRemote` menang; fallback `origin`; GitLab ditolak **menyebut host**; tanpa remote → error; `gitRemote` tanpa `repoDir` **tetap jalan** (M7) |
| `server/test/github-fetch.test.ts` | **paritas dua jalur**: fixture `gh` & fixture REST menghasilkan baris `toIssue()` identik; fixture REST ber-`pull_request` **tersaring** (regresi 14/30 & 71/71); `has_issues:false` → error "dimatikan", bukan daftar; `gh` exit≠0 non-ENOENT **tidak** memicu fallback |
| `server/test/github-pull.test.ts` | tarik ulang: `status`/`specId` **tak** ter-reset; `title`/`body` segar; id deterministik stabil |
| `server/test/github-accept.test.ts` | accept dua kali → **satu** `Spec`; peta label→source; tanpa label → `qa`; override `source`; bentuk payload lolos `zCreateSpec`; retry P2002 |
| `server/test/github-routes.test.ts` | status code + gerbang capability (baca ≠ tulis) |
| `server/test/sync-github-issue.test.ts` | `githubIssue` ada di `SYNCED`/`FIELDS`/`DATE_FIELDS`/`DELEGATE`; `FIELDS` memuat tiap kolom bermakna; `version` **tidak** ikut |
| `src/test/triage-github.test.tsx` | tab render, tombol tarik, terima massal, pesan sebab-kegagalan |

Test jaringan memakai **fixture terekam** dari probe M4/M5/M6 — tak ada test yang memukul
`api.github.com` sungguhan.

Perintah: `pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism` (wajib serial —
set-nya menyentuh test server), `pnpm --filter ./server typecheck`, dan sekali di akhir boot server
+ curl endpoint baru (task ini menyentuh endpoint).

## Yang TIDAK dibangun (YAGNI, sadar)

- **Tulis-balik ke GitHub** (komentar/close) — keputusan manusia #3. Setiap gerbang "selesai" di
  hanoman sudah salah baca tiga kali (SPEC-402/433/451); efek keluar ke repo publik menunggu
  gerbang yang lebih matang.
- **Scheduler source `github` otonom.** `registry.ts` membuatnya tambahan ~20 baris kapan pun
  diinginkan; tarikan tak berpenunggu ke jaringan luar tidak diminta backlog ini.
- **GitLab / Bitbucket.** `parseRemote()` sudah mengenalinya; menolaknya dengan pesan jelas adalah
  perilaku yang dispesifikasikan, bukan kekurangan.
- **Komentar, lampiran, milestone, assignee, project board** issue.
- **Menarik pull request** — justru yang secara eksplisit disaring (M4/M5).

## Dampak docs

- **ADR-0095** baru — ditaut di `internal/docs/README.md` **dan** `internal/docs/adr/README.md`.
- `internal/docs/architecture/data-model.md` — model `GithubIssue`.
- `internal/docs/architecture/api-contract.md` — enam endpoint baru.
- `internal/docs/research/audit-spec-471-pull-issue-github.md` — sudah ditulis & ter-link.
