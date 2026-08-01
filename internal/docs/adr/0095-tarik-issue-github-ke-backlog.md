# ADR-0095 — Tarik issue GitHub ke backlog: record lokal `GithubIssue`, dua jalur ambil, baca-saja

- Status: Accepted
- Tanggal: 2026-08-01
- SPEC: SPEC-471 (pull issue dari GitHub lalu petakan ke fixing 1 per 1)
- Terkait: **mengikuti** [0062](0062-help-center-tiket-publik-triase.md) (sistem luar → record lokal →
  jembatan accept idempoten → `Spec`) dan [0045](0045-skema-sync-synclog-version-stamp.md) (entitas
  baru masuk changefeed dengan version-stamp); **mengikuti pola id deterministik**
  [0094](0094-custom-agent-katalog-materialisasi-native.md); **menyentuh**
  [0065](0065-ai-agent-capability-agent-token.md) (domain `support` bertambah permukaan, dipetakan
  menurut method — kelas bug SPEC-405) dan [0049](0049-config-runtime-store-registry.md) (dua knob
  baru, salah satunya kredensial); **menegakkan** [0015](0015-one-session-per-backlog.md) (satu issue
  → satu backlog → satu sesi); **tidak menghidupkan kembali** [0006](0006-github-app-schema.md) —
  tak ada GitHub App, tak ada installation, tak ada webhook, tak ada commit status; **tidak menyentuh**
  [0024](0024-sesi-interaktif-menggantikan-run.md) — yang dicabutnya adalah eksekusi tanpa penunggu,
  dan menarik issue tetap dipicu manusia yang menekan tombol; **tidak mencabut** apa pun.

## Konteks

hanoman punya empat kanal masuk yang melahirkan backlog item — entri manual, breakdown PRD
(ADR-0069), tiket Help Center (ADR-0062), eskalasi audit (ADR-0076) — dan semuanya bermuara ke
**tiga** call site `prisma.spec.create` di seluruh server. Kanal tempat rekan kerja developer
sesungguhnya menulis pekerjaan, yaitu issue tracker repo, bukan salah satunya: `grep` untuk
`api.github.com` di seluruh `server/src`, `src/src`, `shared/src`, `cli/src`, dan `runner/src`
mengembalikan **kosong**.

Kemampuan membaca GitHub hilang sebagai **efek samping**: ADR-0024 mencabut trigger webhook dan
ikut membuang `octokit` + `@octokit/auth-app` seluruhnya, sehingga ADR-0006 menjadi *de-facto
obsolete*. Yang dibangun sesudahnya melayani audiens lain (pelapor awam lewat form publik, dokumen
PRD, dokumen audit). Tak satu pun ADR sesudah 0024 pernah menimbang arah baca itu kembali.

Harganya terukur, bukan hipotetis (2026-08-01T00:11Z): **9 issue terbuka** di
`denameidina/hanoman` dari dua rekan kerja, badan 2 108–3 942 byte masing-masing (setara isi sebuah
QA finding), yang tertua menganggur **36 jam 37 menit**, sementara backlog project yang sama berisi
**284 `Spec`** — nol di antaranya berasal dari issue. Kontrol negatif membuktikan hambatannya murni
di sisi hanoman: `gh` 2.96.0 di mesin itu terautentikasi ber-scope `repo`, kuota API 4986/5000, dan
mengembalikan kesembilan issue dalam waktu di bawah satu detik. Diagnosis lengkap:
[`research/audit-spec-471-pull-issue-github.md`](../research/audit-spec-471-pull-issue-github.md).

Enam probe menentukan bentuk keputusan ini. Semuanya diukur langsung sebelum desain dikunci:

| # | Yang diukur (2026-08-01 · gh 2.96.0 · api.github.com) | Hasil |
|---|---|---|
| M1 | `gh issue list --json` | 28 field tersedia; **default `--limit` = 30**, memotong tanpa peringatan |
| M2 | `GH_TOKEN=<palsu> gh issue list …` | `HTTP 401: Bad credentials` ⇒ env token **mengalahkan** keyring |
| M3 | `gh` gagal: issues dimatikan / repo hilang / token invalid | ketiganya **exit 1**, stderr-nya berbeda & bisa dibedakan |
| M4 | REST `GET /repos/cli/cli/issues?state=open&per_page=30` | **30 item, 14 di antaranya pull request**; `gh issue list` pada repo & limit yang sama: **30 issue murni** |
| M5 | REST `GET /repos/zamaludin/kirimchat-multi/issues` (issues **DIMATIKAN**) | **HTTP 200 dengan 71 item — 71-71-nya pull request**; `gh` pada repo yang sama **exit 1** |
| M6 | `GET /repos/{slug}` | `has_issues` membedakan "dimatikan" (`false`) dari "kosong" |

**M5 adalah yang paling menentukan.** Di GitHub setiap pull request *adalah* sebuah issue, jadi
endpoint REST `/issues` memuat keduanya. Menarik repo yang **tak punya satu pun issue** lewat jalur
REST tanpa filter akan melahirkan **71 backlog item dari pull request orang lain**.

Sweep 8 project di DB yang sama menambahkan pagar ketiga: 4 project ber-host GitHub tapi hanya **2**
yang punya `Project.gitRemote` terisi (`crm-tumbuh-ai` & `videos` hanya punya `origin` di
`repoDir`-nya), `inkara` punya `gitRemote` **tanpa `repoDir`**, dan `erp-tumbuh-ai` ber-host GitLab.

## Keputusan

1. **Issue GitHub masuk sebagai record lokal `GithubIssue`**, bukan dibaca ulang dari jaringan tiap
   kali dilihat — cermin `Ticket` (ADR-0062), berikut status triase `new|accepted|rejected` dan
   back-pointer `specId`. Id **deterministik** `"<projectId>:<owner>/<repo>#<number>"` ditulis
   aplikasi (bukan default DB), alasan yang sama dengan `CustomAgent` (ADR-0094): dua mesin yang
   menarik repo yang sama harus bertemu sebagai **satu** baris di changefeed, bukan dua yang saling
   menelan. `projectId` ikut di dalam id karena dua project hanoman boleh menunjuk repo yang sama.
   `specId` **tanpa FK** (cermin `Ticket.specId`) — changefeed bisa memancarkan `GithubIssue`
   sebelum `Spec`-nya mendarat (kelas SPEC-382).

2. **Dua jalur ambil, satu bentuk keluaran**: `gh` CLI lebih dulu (keyring mesin, nol rahasia
   disimpan hanoman), fallback HTTPS langsung ke `api.github.com`. `GITHUB_TOKEN` melayani
   **keduanya** — diteruskan sebagai `GH_TOKEN` ke proses `gh` (M2) dan sebagai `Authorization:
   Bearer` di jalur REST — sehingga hub VPS yang tak punya keyring tetap terlayani satu jalur kode.

3. **Kegagalan `gh` adalah jawaban otoritatif, bukan alasan fallback.** Fallback ke REST hanya sah
   saat `gh` **tak bisa dieksekusi** (ENOENT) atau **tak terautentikasi**. Setiap kegagalan lain
   (M3) disampaikan apa adanya. Alasannya M5: bila `gh` menjawab "issues dimatikan" lalu hanoman
   diam-diam jatuh ke REST, REST akan menjawab HTTP 200 dengan 71 pull request — fallback justru
   **memproduksi** bug yang paling ingin dihindari.

4. **Jalur REST wajib membuang setiap item ber-kunci `pull_request` dan memeriksa `has_issues`
   lebih dulu.** Keduanya bukan penyempurnaan: tanpa yang pertama 14 dari 30 baris di repo ramai
   adalah PR (M4), dan tanpa yang kedua repo ber-issue-dimatikan tak bisa dibedakan dari repo
   kosong (M5+M6). `--limit` selalu eksplisit (M1).

5. **`pullIssues` tak pernah menyentuh `status` maupun `specId` saat memperbarui baris yang sudah
   ada** — hanya konten (`title`, `body`, `labels`, `url`, `issueState`, stempel waktu). Keputusan
   triase milik operator, bukan milik GitHub. Tanpa aturan ini, issue yang sudah diterima kembali
   `new` di tarikan berikutnya dan accept berikutnya melahirkan `Spec` kedua.

6. **Resolusi repo = `Project.gitRemote` ?? `origin` dari `repoDir`**, tak mensyaratkan `repoDir`
   ada, dan host non-GitHub **ditolak dengan pesan yang menyebut hostnya** — bukan didiamkan
   sebagai daftar kosong.

7. **hanoman tidak pernah menulis ke GitHub.** Tak ada komentar, tak ada close, tak ada label. Ini
   batas sadar, bukan kekurangan yang menunggu ditambal: setiap gerbang "selesai" di hanoman sudah
   salah baca tiga kali (SPEC-402/433/451), dan efek keluar ke repo publik menunggu gerbang yang
   lebih matang. Menutup issue tetap tindakan manusia.

Pemetaan asal → flow mengikuti label, dengan default yang **berbeda** dari jalur tiket: label
bug-ish → `qa`, fitur-ish → `brief`, tanya/docs → `audit`, dan **tanpa label → `qa`** (bukan `brief`
seperti SPEC-291). Disengaja — kesembilan issue nyata tak berlabel sama sekali sementara isinya
laporan cacat; untuk laporan yang belum terklasifikasi, flow yang **menyelidiki lebih dulu** adalah
default yang aman. Operator bisa menimpanya saat menerima.

## Konsekuensi

- (+) Kanal tempat rekan kerja benar-benar menulis pekerjaan akhirnya punya pintu; antrean hanoman
  berhenti tak lengkap secara struktural.
- (+) "Petakan 1 per 1" terpenuhi tanpa mekanisme baru: satu issue → satu `Spec` → satu sesi →
  satu worktree (ADR-0015), konkurensi tetap dijaga `maxConcurrent` governor.
- (+) Menarik ulang aman kapan saja — idempotensi dijamin id deterministik + aturan keputusan 5.
- (+) Nol rahasia wajib: di mesin ber-`gh` terautentikasi, fitur ini jalan tanpa konfigurasi apa pun.
- (−) Satu tabel + satu migration + satu entitas sync baru.
- (−) Dua jalur ambil = dua permukaan yang bisa menyimpang. Diikat test **paritas** yang menuntut
  fixture `gh` dan fixture REST menghasilkan baris identik, plus regresi eksplisit untuk filter PR.
- (−) `gh` menjadi prasyarat **opsional** baru (dilaporkan `hanoman doctor`, non-fatal).
- (−) Issue tetap harus ditarik manual. Source scheduler otonom sengaja tidak dibangun: tarikan tak
  berpenunggu ke jaringan luar tak diminta backlog ini, dan `registry.ts` membuatnya tambahan kecil
  kapan pun diinginkan.
- (−) GitLab/Bitbucket tak didukung. `parseRemote()` sudah mengenalinya; menolaknya dengan pesan
  jelas adalah perilaku yang dispesifikasikan.
