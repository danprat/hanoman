# SPEC-166 — Run pakai skills superpowers + flow reverse docs untuk project existing

**Tanggal:** 2026-07-10 · **Status:** diimplementasi (lihat plan + verifikasi nyata)
**Membangun di atas:** ADR-0016 (sesi tmux interaktif), ADR-0024, SPEC-162

## Konteks

Dua lubang pada run hanoman hari ini:

1. **Sesi run tidak pernah diinstruksikan memakai skills superpowers.** Plugin
   superpowers sudah ter-enable global di `~/.claude/settings.json`
   (`enabledPlugins`), jadi setiap sesi claude yang di-spawn hanoman bisa
   mengaksesnya — tetapi `startPrompt` (`runner/src/prompt.ts`) tidak menyebut
   skill sama sekali. Fase pipeline sebenarnya sudah sejajar satu-satu dengan
   skill superpowers (Brainstorm ↔ `brainstorming`, Plan ↔ `writing-plans`,
   Execute ↔ `executing-plans`/TDD), agen hanya tidak disuruh.

2. **Flow `reverse` ada tapi mati.** `PIPELINES.reverse` (Scan → Doc index) dan
   `zFlow` menerimanya, tetapi tidak ada satu pun pemicu: cabang `{ project }`
   di `POST /api/terminal/sessions` (`server/src/routes/terminal.ts`) spawn sesi
   kosong tanpa flow/prompt, dan UI "reverse-engineer docs" untuk project
   `kind: "existing"` hanya teks. Padahal `AGENTS.md`,
   `operations/agent-documentation-workflow.md`, dan `product/onboarding.md`
   menjanjikan alur ini (dulu lewat CLI `hanoman reverse` yang sudah dicabut
   bersama runner headless).

Acuan standar docs-driven yang dituju adalah **termilo**
(`~/Documents/Nafanesia/termilo/termilo`): seluruh pengetahuan di
`internal/docs/**` berkategori, `README.md` index bernomor sebagai registry
source-of-truth, header polos `Status:`/`Date:` (tanpa YAML), ADR `NNNN-judul.md`
(Context/Decision/Rationale/Consequences/Sources), EARS acceptance criteria
sebelum kode, trio spec + implementation-plan (`- [ ]`) + review, Documentation
Ownership Map, Definition of Done, aturan "update docs di commit yang sama" di
CLAUDE.md/AGENTS.md, dan Stop hook `ensure-docs-updated` yang memblokir commit
implementasi tanpa perubahan docs.

## Keputusan yang sudah diambil bersama user

- Hasil reverse = **full standar termilo**, bukan subset teknis. Bagian
  non-teknis (product/business/brand/research) **didiskusikan interaktif
  dengan human** di sesi, bukan placeholder, bukan tebakan. Isi file harus
  lengkap dan detail, bukan sekadar struktur.
- Landing hasil: **worktree + branch + push, human yang merge** — konsisten
  dengan run lain dan prinsip "semuanya dipicu aksi manusia".
- **Stop hook ala termilo ikut dipasang di repo target.** (Repo hanoman sendiri
  tetap tanpa gate, sesuai ADR-0023 — hook hanya untuk repo target.)
- Standar dikodifikasi sebagai **prompt module di package runner** — ter-version
  di repo hanoman, tidak bergantung setup mesin.

## Desain

### 1. Fitur A — mapping fase → skill superpowers di prompt

`runner/src/prompt.ts` mendapat peta fase→skill; `startPrompt` (dan
`startProjectPrompt` baru, lihat §3) menyisipkan satu baris per fase:
*"Sebelum mengerjakan fase ini, invoke skill `superpowers:<X>` lewat Skill
tool — bila skill relevan tersedia, wajib dipakai."*

| Fase | Skill |
|---|---|
| Brainstorm / Objective / Spec | `superpowers:brainstorming` (Objective & Spec adalah keluarannya) |
| Audit (qa) | `superpowers:systematic-debugging` |
| Plan | `superpowers:writing-plans` |
| Execute | `superpowers:executing-plans` + `superpowers:test-driven-development` + `superpowers:verification-before-completion` |
| Scan / fase reverse | tanpa skill khusus — dipandu standar docs (§2) |

Tidak ada perubahan di `pty.ts` untuk fitur ini: plugin sudah global, cukup
instruksi prompt. Berlaku untuk semua flow (`feature`, `qa`, `scaffold`,
`reverse`).

### 2. Fitur B — standar termilo terkodifikasi

File baru `runner/src/reverse-standard.ts`: konstanta template-literal markdown
(ikut ter-compile ke dist, tanpa config build tambahan) berisi:

- Struktur kategori `internal/docs/**`: entrypoints, product, business,
  requirements, research, brand, architecture, adr, design-system, frontend,
  operations, security, qa — dengan tujuan tiap kategori.
- Konvensi penamaan: ADR `NNNN-judul.md` (4 digit), RD `rd-NN-<domain>.md`,
  file bertanggal `YYYY-MM-DD-<slug>-{spec,review,implementation-plan}.md`.
- Format header polos `Status:` / `Date:` (tanpa YAML frontmatter).
- Template ADR: Context / Decision / Rationale / Consequences / Sources.
- 5 pola EARS (Ubiquitous / Event-driven / State-driven / Optional / Unwanted)
  dan aturan "criteria terukur, bukan 'cepat/aman' tanpa angka".
- Kewajiban `README.md` index bernomor: setiap doc terdaftar + deskripsi satu
  baris; Canonical Files; Naming Standard; Source Discipline.
- Isi CLAUDE.md + AGENTS.md repo target: start-here order, hirarki
  source-of-truth, Documentation-First Rule, "update docs di commit yang
  sama", Definition of Done.
- Spek Stop hook `ensure-docs-updated` (adaptasi termilo): blok Stop bila file
  implementasi ter-stage tanpa docs/guidance ter-stage; ditulis ke
  `.claude/settings.json` + `.claude/hooks/ensure-docs-updated.py` repo target.

### 3. Prompt project-level

`startPrompt(flow, spec, branchTo)` terikat pada Spec. Ditambah
`startProjectPrompt(flow, project, branchTo)` di `runner/src/prompt.ts` untuk
flow tanpa backlog item. Untuk `reverse`, prompt berisi: instruksi fase (§4),
standar termilo (inline dari `reverse-standard.ts`), konteks project
(name/desc/stack), aturan phase-file (`$HANOMAN_PHASE_FILE`, format sama
dengan run lain), dan aturan commit/push (§5).

### 4. Pipeline reverse baru

`PIPELINES.reverse` diganti dari `["Scan", "Doc index"]` menjadi:

```
Scan → Docs teknis → Wawancara → Konvensi & index → Serah terima
```

1. **Scan** — baca source repo target: stack, arsitektur, data model, API
   surface, perilaku domain. Belum menulis docs.
2. **Docs teknis** — tulis kategori yang bisa diturunkan dari kode, lengkap
   isinya: `architecture/` (stack, data-model, api-contract, nfr),
   `requirements/` (RD per domain + EARS dari perilaku nyata), `adr/`
   (keputusan yang terbaca dari kode, `Status: accepted (reverse-engineered)`),
   `operations/`, `security/`, `design-system`/`frontend` bila relevan.
3. **Wawancara** — kategori non-teknis (`product/`, `business/`, `brand/`,
   `research/`, `entrypoints/`): agen bertanya ke human **satu per satu di
   terminal sesi**, mengisi docs dari jawaban. Topik yang belum bisa dijawab
   ditandai eksplisit `Status: draft — menunggu input`, tidak dikarang.
4. **Konvensi & index** — `internal/docs/README.md` index bernomor,
   CLAUDE.md + AGENTS.md, `.claude/settings.json` + hook
   `ensure-docs-updated`.
5. **Serah terima** — verifikasi index mencakup semua file docs, laporan
   ringkas ke human di terminal.

### 5. Data flow, progress, landing

- Progress via `HANOMAN_PHASE_FILE` seperti run lain. Karena reverse
  project-level (tanpa Spec), **tidak ada mirror ke `Spec.stage`** —
  `session-phases` cukup menoleransi sesi tanpa spec; progress terlihat via
  `GET /terminal/sessions/:id/phases` dan PTY.
- **Commit per fase, push per fase** ke branch `reverse-docs`
  (`git push origin HEAD:refs/heads/reverse-docs`) — kerja tidak hilang bila
  worktree terhapus di tengah jalan. Human me-review dan merge sendiri.
- Repo target tanpa remote `origin` → fallback: commit di branch lokal
  `reverse-docs`, laporkan ke human tanpa push — tidak gagal diam-diam.

### 6. Route & DTO

Cabang `{ project }` di `POST /api/terminal/sessions`
(`server/src/routes/terminal.ts:66-70`) menerima field opsional
`flow: "reverse"`:

- Dengan flow: validasi `project.repoDir` ada dan git repo → buat worktree
  `<repoDir>/.worktrees/<session-id>` (base HEAD/main) → `createSession` dengan
  `startProjectPrompt("reverse", project, "reverse-docs")`. Idempoten ala
  ADR-0015 (Start ulang menempel ke sesi hidup).
- `repoDir` null → **422** dengan pesan jelas.
- Worktree gagal dibuat (bukan git repo, path hilang) → error rapi dari route,
  sesi tidak dibuat.
- Tanpa flow → perilaku lama (sesi kosong di repoDir) tetap, tidak berubah.

`zTerminalSession` di `shared/src/dto.ts` diperluas: varian project mendapat
`flow` opsional (hanya `reverse` yang diwire sekarang).

Guard hook Bash (`guardSettings`) tetap terpasang seperti sesi lain.

### 7. UI

Tombol "Reverse docs" pada project `kind === "existing"` yang punya `repoDir`
(layar project di `src/src/App.tsx`) → `api.startSession({ project,
flow: "reverse" })` → buka view terminal sesi. Fase Wawancara berlangsung di
PTY itu. Copy "reverse-engineer docs" yang selama ini mati jadi tombol nyata.

### 8. Non-goals

- Wiring flow `scaffold` (from-scratch) — mekanisme `startProjectPrompt` bisa
  dipakai ulang nanti, di luar spec ini.
- Perubahan skema Prisma — nol migration.
- Verifikasi otomatis bahwa agen benar-benar memanggil Skill tool — instruksi
  prompt saja; enforcement bisa jadi spec lanjutan bila drift terbukti.
- Stop hook untuk repo hanoman sendiri — tetap dilarang tanpa ADR baru
  (ADR-0023).

## Error handling (rangkuman)

| Kondisi | Perilaku |
|---|---|
| `repoDir` null saat flow reverse | 422, pesan "project belum punya path repo" |
| `repoDir` bukan git repo / worktree gagal | error rapi, sesi tidak dibuat |
| Repo target tanpa `origin` | commit lokal branch `reverse-docs`, lapor ke human, tanpa push |
| Sesi mati di tengah fase | commit+push per fase membatasi kehilangan; Start ulang menempel ke sesi hidup (ADR-0015) |
| Human belum bisa jawab wawancara | doc ditandai `Status: draft — menunggu input` |

## Testing

- **Unit `runner`:** prompt `feature`/`qa` memuat baris skill per fase sesuai
  peta; `startProjectPrompt("reverse", …)` memuat standar termilo (kategori,
  format ADR, EARS), instruksi wawancara, aturan commit/push per fase.
- **Route `server`:** `{ project, flow: "reverse" }` → 201 + worktree dibuat;
  `repoDir` null → 422; `{ project }` tanpa flow → perilaku lama.
- **Nyata di local (kebiasaan repo):** boot server, curl
  `POST /api/terminal/sessions` dengan project existing, verifikasi sesi tmux
  hidup + worktree + prompt benar.

## Dokumentasi (commit yang sama saat implementasi)

- **ADR-0026** — "Reverse docs sebagai sesi interaktif project-level" (pengganti
  janji CLI `hanoman reverse` yang dicabut).
- `internal/docs/architecture/api-contract` — bentuk baru body
  `POST /terminal/sessions`.
- `internal/docs/operations/agent-documentation-workflow.md` +
  `internal/docs/product/onboarding.md` — ganti referensi CLI mati dengan
  trigger UI.
