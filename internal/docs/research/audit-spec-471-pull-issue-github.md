# Audit SPEC-471 — issue GitHub tak bisa ditarik ke backlog: kanal kolaborator tanpa pintu

- **Sumber**: QA finding SPEC-471 · severity **major** · prioritas tinggi
- **Tanggal**: 2026-08-01
- **Status**: akar masalah tunggal & terbukti, tapi perbaikannya **bukan** diff kecil — kanal masuk baru,
  egress jaringan pertama ke pihak ketiga, kredensial, persistensi idempotensi, dan permukaan UI.
  Keputusan pasca-audit: **Spec → Plan → Execute penuh** (ADR-0020/0040), dengan **ADR baru** untuk
  keputusan arsitekturnya (aturan AGENTS.md: skema berubah ⇒ migration + ADR).

## Keluhan

> Judul: Pull issue dari github lalu petakan ke fixing 1 per 1
> Expected: dapat melakukan pull issue dan melakukan fixing issue nya
> Actual: *(kosong)*

## Ringkas

hanoman punya **empat kanal masuk** yang melahirkan backlog item — entri manual, breakdown PRD,
tiket Help Center, dan eskalasi audit — dan sebuah scheduler yang bisa menguras dua di antaranya
secara otonom. Semuanya bermuara ke **tiga** call site `prisma.spec.create` di seluruh server.

Kanal tempat **rekan kerja developer sesungguhnya menulis pekerjaan** — issue GitHub — bukan salah
satunya. Bukan "belum sempurna": **nol baris kode di repo ini pernah berbicara dengan GitHub**.
`octokit` dan `@octokit/auth-app` dicabut ADR-0024 bersama trigger webhook; ADR-0006 (GitHub App
schema) berstatus *de-facto obsolete* sejak itu. Yang dibangun sesudahnya — Help Center (ADR-0062),
breakdown PRD (ADR-0069), eskalasi audit (ADR-0076) — semuanya kanal masuk untuk **audiens lain**
(pelapor awam, dokumen PRD, dokumen audit). Arah tarik GitHub → hanoman hilang bersama arah dorong,
dan tak pernah dibangun kembali.

Akibatnya terukur hari ini: **9 issue terbuka** di `denameidina/hanoman`, ditulis dua rekan kerja,
yang tertua menganggur **36 jam 37 menit**, sementara backlog project yang sama berisi **284 Spec**
— **nol** di antaranya berasal dari issue. Bahan bakunya ada dan terjangkau (`gh` di mesin ini
terautentikasi ber-scope `repo`, kuota API 4986/5000); yang tak ada adalah pintunya.

## Bukti

### B1 · keadaan hidup: 9 issue, 36 jam, nol backlog

Diukur 2026-08-01T00:11Z dari mesin operator (bukan repro sintetis):

| # | Judul | Penulis | Dibuat (UTC) | Menganggur | Label |
|---|---|---|---|---|---|
| 1 | [Release] CI dapat publish saat test/typecheck merah… | RamaAditya49 | 2026-07-30T11:34:22Z | **36 j 37 m** | — |
| 2 | [Release] Tag dari commit yang belum masuk main tetap eligible… | RamaAditya49 | 2026-07-30T11:34:23Z | 36 j 37 m | — |
| 3 | [Docs/SoT] Release Requirements kanonik masih… checkout lama | RamaAditya49 | 2026-07-30T11:34:25Z | 36 j 37 m | — |
| 4 | [Docs/Operations] deploy-vps salah menjanjikan DATABASE_URL Postgres… | RamaAditya49 | 2026-07-30T11:34:26Z | 36 j 37 m | — |
| 5 | [Product/Onboarding] CTA existing codebase menjanjikan reverse docs… | RamaAditya49 | 2026-07-30T11:45:54Z | 36 j 25 m | — |
| 6 | [UX/A11y] 15 destructive flow melewati ConfirmDialog… | RamaAditya49 | 2026-07-30T11:46:25Z | 36 j 25 m | — |
| 7 | [Major][Continuity] Transcript dan upload defaults ignore HANOMAN_HOME… | wulanrlestari | 2026-07-30T11:57:42Z | 36 j 13 m | — |
| 8 | [Major][Recovery] History purge deletes transcript files before DB… | wulanrlestari | 2026-07-30T11:57:43Z | 36 j 13 m | — |
| 9 | [Moderate][Handoff] Reconciled crash/reboot sessions shown as successful | wulanrlestari | 2026-07-30T11:57:43Z | 36 j 13 m | — |

Badan issue 2 108–3 942 byte — bukan satu baris keluhan, melainkan laporan lengkap yang setara isi
sebuah QA finding.

Kontrol positif di sisi yang sama: `~/.hanoman/hanoman.db` berisi **284 `Spec`**, 25 terbaru untuk
project `hanoman` — dan **nol** yang menyebut issue GitHub mana pun di `title`/`objective`
(`select … where lower(objective) like '%github%'` → 0 baris untuk kelas ini). Selisih 36 jam itu
bukan kelambatan proses: tak ada proses yang bisa dilambatkan.

**Kontrol negatif — bahan bakunya terjangkau, bukan hambatan lingkungan:**

```
$ gh --version           → gh version 2.96.0
$ gh auth status         → ✓ Logged in to github.com account denameidina (keyring)
                           Token scopes: 'gist', 'read:org', 'repo', 'workflow'
$ gh api rate_limit      → core: 4986/5000 tersisa
$ gh issue list --repo denameidina/hanoman   → 9 baris, < 1 detik
```

Perintah yang menghasilkan tabel di atas berjalan di mesin yang sama, dengan kredensial yang sama,
dalam waktu di bawah satu detik. Kesenjangannya **murni di sisi hanoman**.

### B2 · enumerasi: tiga pintu melahirkan backlog, tak satu pun dari GitHub

`grep -rn "prisma.spec.create" server/src` → **3** call site, habis:

| # | Call site | Kanal | ADR |
|---|---|---|---|
| 1 | `routes/specs.ts:121` (`POST /specs`) | entri manual + take-to-backlog audit/PRD dari UI | ADR-0059/0076 |
| 2 | `routes/specs.ts:166` (`POST /specs/batch`) | materialisasi manifest breakdown PRD | ADR-0069 |
| 3 | `services/ticket-accept.ts:76` (`acceptTicket`) | tiket Help Center → Spec (manual **dan** scheduler) | ADR-0062 · SPEC-291/297 |

Scheduler mendaftarkan **2** source di boot (`server.ts:59-60`): `backlog` dan `triase`. `zSpecSource`
punya **5** nilai (`brief`/`qa`/`audit`/`help`/`goal`) — tak satu pun beraroma GitHub.
`server/src/routes/` berisi **27** berkas route; tak ada `github.ts` maupun `issues.ts`.

### B3 · egress: hanoman tak pernah menghubungi GitHub

`grep -rn "api.github.com\|githubusercontent" server/src src/src shared/src cli/src runner/src`
→ **kosong**. Empat berkas server memanggil `fetch(` (`sync-client`, `uploads`, `limits`, `update`) —
tujuannya hub sync, hub lampiran, `~/.claude/.credentials.json`, dan registry npm. Tak ada `octokit`
di `package.json` mana pun.

Seluruh jejak GitHub yang tersisa di repo ini ada **tiga**, semuanya kosmetik dan searah-keluar:

| Jejak | Berkas | Sifat |
|---|---|---|
| `prUrl()` — bangun URL `/compare/…?expand=1` | `services/git-remotes.ts:24` | string builder, tanpa jaringan |
| knob `gitGraph.issueLinkPattern` (`…/issues/$1`) | `shared/src/config-registry.ts:57` | **menautkan** nomor issue di pesan commit, tak pernah membacanya |
| `REPO_URL` paket npm | `cli/src/release/pack.ts:13` | metadata rilis |

Ketiganya menegaskan pola yang sama: hanoman tahu cara **menunjuk** ke GitHub, tak pernah cara
**mengambil** darinya.

### B4 · sejarah: pintunya pernah ada, dicabut, dan kanal penggantinya salah audiens

ADR-0006 memutuskan `GithubInstallation` + `Project.installationId` + `Run.commitSha/reportRepo`
untuk memetakan webhook push → run. ADR-0024 (SPEC-162) membuangnya:

> **Tak ada lagi yang berjalan tanpa penunggu.** Cron, webhook GitHub, dan commit status hilang
> bersama trigger. … `bullmq`, `ioredis`, `cron-parser`, `octokit`, dan `@octokit/auth-app` dicabut

Yang dicabut ADR-0024 adalah **trigger otomatis** (GitHub menyuruh hanoman bekerja tanpa manusia) —
premis yang memang sudah tak berlaku. Tetapi `octokit` dibuang seluruhnya, jadi **kemampuan membaca**
GitHub ikut hilang sebagai efek samping, bukan sebagai keputusan tersendiri. Tak satu pun ADR
sesudahnya pernah menimbangnya kembali. SPEC-471 adalah tagihan atas efek samping itu.

Yang lahir sesudahnya bukan penggantinya:

| ADR | Kanal masuk | Audiens |
|---|---|---|
| 0062 (SPEC-253) | Help Center → tiket → triase → Spec | **pelapor awam** lewat form publik ber-honeypot |
| 0069 (SPEC-273) | PRD → manifest breakdown → N Spec | dokumen internal |
| 0076 (SPEC-340) | dokumen audit → manifest eskalasi → Spec | dokumen internal |

Rekan kerja developer tidak menulis di form Help Center; mereka menulis di issue tracker repo.
Kanal itulah yang tak punya pintu.

### B5 · resolusi repo: `Project.gitRemote` saja tidak cukup (terukur)

Delapan project di DB, diperiksa satu per satu terhadap `origin` di `repoDir`-nya:

| Project | `Project.gitRemote` (DB) | `origin` di `repoDir` | Host |
|---|---|---|---|
| hanoman | `https://github.com/denameidina/hanoman` | sama | **github** |
| crm-tumbuh-ai | *(kosong)* | `https://github.com/zamaludin/kirimchat-multi.git` | **github** |
| videos | *(kosong)* | `https://github.com/denameidina/hyperframes-video-workflow.git` | **github** |
| inkara | `https://github.com/INKARA-CLUB/inkara-product` | *(tak ada `repoDir` di mesin ini)* | **github** |
| erp-tumbuh-ai | *(kosong)* | `https://gitlab.com/tumbuh.ai/erp.git` | gitlab |
| raciklaba.id · oneshotcpns · walet.id | *(kosong)* | *(tak ada origin)* | — |

Tiga konsekuensi yang mengikat desain:

1. **4 dari 8** project ber-host GitHub, tapi hanya **2** yang punya `gitRemote` terisi. Resolusi
   yang bergantung pada kolom itu saja akan **melewatkan separuhnya** (crm-tumbuh-ai, videos) —
   fitur yang tampak "tak berlaku" padahal cuma kolomnya kosong.
2. `inkara` punya `gitRemote` **tanpa `repoDir`**: resolusi tak boleh mensyaratkan checkout lokal.
   Cermin `bindings.ts:41` yang sudah memakai `gitRemote` justru untuk meng-*clone*.
3. `erp-tumbuh-ai` ber-host GitLab. `parseRemote()`/`prUrl()` di `git-remotes.ts` sudah membedakan
   `github.`/`gitlab.`/`bitbucket.` — pola yang sama harus dipakai untuk **gagal terbuka dengan
   pesan jelas**, bukan diam.

Ditambah satu penemuan dari sweep yang sama: `zamaludin/kirimchat-multi` menjawab
`the 'zamaludin/kirimchat-multi' repository has disabled issues`. Repo ber-issue **dimatikan** adalah
keadaan sah dan harus dibedakan dari "tak ada issue" maupun "tak punya akses".

## Akar masalah

**Kanal masuk GitHub issue tidak ada dan tidak pernah dibangun kembali sesudah ADR-0024 mencabut
`octokit` sebagai efek samping pencabutan trigger webhook.** Bukan bug pada jalur yang salah jalan —
tak ada jalur. Tiga call site pembuat `Spec` semuanya bersumber dari data yang sudah hidup di dalam
hanoman (form tiket, dokumen PRD, dokumen audit) atau diketik manusia; tak satu pun pernah membaca
sistem luar.

Konsekuensi yang membuatnya *major*, bukan sekadar "fitur belum ada": hanoman **mengklaim** menjadi
satu-satunya tempat pekerjaan project diantre dan dieksekusi (ADR-0015 satu backlog satu sesi,
ADR-0072 scheduler otonom, ADR-0091 lead menata antrean). Selama kanal tempat rekan kerja benar-benar
menulis pekerjaan berada di luar klaim itu, antrean hanoman **secara struktural tidak lengkap** — dan
ketidaklengkapannya tak terlihat dari dalam dashboard, persis seperti 36 jam yang terukur di B1.

## Bentuk perbaikan (garis besar — detail milik Spec)

Pola yang sudah terbukti dan harus diikuti, bukan diciptakan ulang, adalah **jalur tiket**
(ADR-0062/SPEC-291/SPEC-297): sistem luar → record lokal → jembatan `accept` idempoten → `Spec` →
(opsional) `enqueue` scheduler. `acceptTicket` bahkan sudah memiliki tiap properti yang dibutuhkan
di sini — idempotensi lewat back-pointer `ticket.specId`, pemetaan kategori → `source`, retry P2002
untuk TOCTOU `nextSpecId`, dan `notifySynced` ke feed. Pekerjaannya adalah memberi issue GitHub
**cermin** jalur itu, bukan jalur kedua yang berbeda.

"Petakan ke fixing 1 per 1" dalam kosakata hanoman berarti: **satu issue → satu backlog item → satu
sesi → satu worktree/branch** (ADR-0015), dengan konkurensi dijaga `maxConcurrent` governor —
bukan satu sesi yang menyapu banyak issue.

### Tiga percabangan yang mengubah bentuk kerja (dibawa ke Spec)

1. **Cara bicara ke GitHub** — `gh` CLI (host sudah terautentikasi, nol rahasia disimpan hanoman,
   idiomatis: hanoman sudah men-*shell out* ke `git`/`tmux`/`ssh`/`claude`/`codex`) **vs** HTTPS
   langsung ke `api.github.com` dengan PAT di `CONFIG_REGISTRY` (`kind: "secret"`, preseden
   `SYNC_DEVICE_TOKEN`/`ANTHROPIC_API_KEY`, ADR-0049 — jalan di hub VPS tanpa biner tambahan).
2. **Tempat idempotensi hidup** — model `GithubIssue` (cermin penuh `Ticket`, memberi layar triase
   dan keadaan "diabaikan") **vs** satu kolom `Spec.externalRef @unique` (migration kecil, issue
   langsung jadi backlog tanpa kotak masuk perantara).
3. **Arah balik** — apakah hanoman menulis kembali ke GitHub (komentar/close saat backlog selesai)
   atau murni baca. Menulis adalah efek keluar ke repo publik dan tak boleh menyelinap sebagai
   detail implementasi.

### Pagar yang sudah terbukti dibutuhkan (dari B5)

- Resolusi repo = `Project.gitRemote` **??** `origin` dari `repoDir` — bukan kolom saja (B5.1).
- Tak mensyaratkan `repoDir` (B5.2 · `inkara`).
- Host non-GitHub → tolak dengan pesan, jangan diam (B5.3 · `erp-tumbuh-ai` GitLab).
- Bedakan **issue dimatikan** / tak ada akses / nol issue (`zamaludin/kirimchat-multi`).
- Tarik ulang tak boleh melahirkan duplikat — kelas bug yang sudah dibayar di jalur tiket lewat
  `specId` back-pointer; di sini tak ada record lokal yang otomatis memilikinya.

## Yang TIDAK menjadi penyebab (dibantah)

- **Bukan kredensial/lingkungan.** `gh` terpasang, terautentikasi, ber-scope `repo`, kuota hampir
  penuh, dan mengembalikan kesembilan issue dalam < 1 detik (B1 kontrol negatif).
- **Bukan `Project.gitRemote` yang kosong.** Kolom itu memang kosong di 6 dari 8 project, tapi
  project yang mengeluh (`hanoman`) justru terisi — dan tetap tak ada yang membacanya untuk issue.
- **Bukan scheduler/lead.** Keduanya menata dan meluncurkan apa yang **sudah** ada di antrean;
  tak satu pun pernah bertugas mengisinya dari sistem luar. Antrean 32 baris `queued` yang terukur
  di SPEC-451 membuktikan sisi hilir sehat.
- **Bukan regresi.** Tak ada commit yang merusaknya: `git log` tak pernah memuat jalur baca issue.
  ADR-0024 mencabut jalur *tulis-balik* (webhook/status check), bukan jalur baca yang diminta di sini.
