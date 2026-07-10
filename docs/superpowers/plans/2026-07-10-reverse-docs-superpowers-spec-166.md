# SPEC-166 — Implementation Plan: skills superpowers di run + flow reverse docs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sesi run hanoman diinstruksikan memakai skills superpowers per fase, dan project existing bisa di-reverse jadi docs-driven penuh (standar termilo) lewat sesi interaktif yang dipicu manusia.

**Architecture:** Semua lewat prompt yang dibangun package `runner` — peta fase→skill masuk `startPrompt`, standar termilo jadi konstanta TS yang di-inline ke prompt `startProjectPrompt` baru. Server menambah cabang `flow: "reverse"` pada `POST /terminal/sessions` varian project (worktree + prompt + phase file, tanpa Spec). UI menambah satu pintu "Reverse docs" di layar project existing.

**Tech Stack:** TypeScript strict, Fastify, Prisma (tanpa perubahan skema), zod, node-pty+tmux, React, vitest.

## Global Constraints

- Spec acuan: `docs/superpowers/specs/2026-07-10-reverse-docs-superpowers-spec-166-design.md`. ADR baru = **ADR-0026** (0026 sudah diverifikasi bebas di semua branch).
- Worktree utama ini dipakai sesi Claude lain: **JANGAN PERNAH `git add -A`, `git add .`, atau `git stash`** — selalu `git add <path eksplisit>`.
- Env shell sesi menunjuk prod: **semua perintah test/typecheck diawali `env -u NODE_ENV -u DATABASE_URL`**.
- Server test butuh Docker Postgres hidup (`docker compose up -d --wait`) + tmux di PATH. Skema tidak berubah — tidak perlu migrate.
- Komentar kode bahasa Indonesia, menjelaskan "kenapa", gaya file yang disentuh. TypeScript strict.
- Update `internal/docs` yang tersentuh **dalam commit yang sama** (sudah dipetakan per task di bawah).
- Setiap task selesai: centang checklist task itu di file plan ini (`- [ ]` → `- [x]`).
- **JANGAN memverifikasi dengan claude sungguhan**: `POST /terminal/sessions` men-spawn claude nyata ber-`--dangerously-skip-permissions`. Smoke test nyata memakai `HANOMAN_CLAUDE_BIN=/bin/echo` (Task 6).
- Konstanta `REVERSE_STANDARD` ditulis **tanpa backtick dan tanpa `${`** di isinya — ia template literal TS; escape `\"` ditulis `\\"`.

---

### Task 1: Peta fase → skill superpowers di `startPrompt` (runner)

**Files:**
- Modify: `runner/src/prompt.ts`
- Test: `runner/test/prompt.test.ts`
- Modify: `internal/docs/operations/agent-documentation-workflow.md` (baris baru di daftar kontrak)

**Interfaces:**
- Consumes: `PIPELINES`, `startPrompt` yang sudah ada di `runner/src/prompt.ts`.
- Produces: `startPrompt` yang menyisipkan blok "Skills superpowers WAJIB" — dipakai apa adanya oleh `server/src/routes/terminal.ts` (tak ada perubahan signature).

- [ ] **Step 1: Tulis test yang gagal**

Tambah di `runner/test/prompt.test.ts` (di dalam `describe("startPrompt")`):

```ts
  it("feature: menyuruh invoke skill superpowers per fase lewat Skill tool", () => {
    const p = startPrompt("feature", spec, "b");
    for (const s of ["superpowers:brainstorming", "superpowers:writing-plans",
      "superpowers:executing-plans", "superpowers:test-driven-development",
      "superpowers:verification-before-completion"]) expect(p).toContain(s);
    expect(p).toContain("Skill tool");
  });

  it("qa: Audit memakai systematic-debugging, tanpa brainstorming", () => {
    const p = startPrompt("qa", spec, "b");
    expect(p).toContain("superpowers:systematic-debugging");
    expect(p).not.toContain("superpowers:brainstorming");
  });
```

- [ ] **Step 2: Jalankan — pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./runner test`
Expected: 2 test baru FAIL (`expected ... to contain 'superpowers:brainstorming'`), sisanya pass.

- [ ] **Step 3: Implementasi minimal**

Di `runner/src/prompt.ts`, sisipkan setelah `phaseInstruction`:

```ts
// Peta fase → skill superpowers (SPEC-166). Objective dan Spec adalah keluaran skill
// brainstorming yang di-invoke di fase Brainstorm — sengaja tak punya entri sendiri.
// Fase reverse dipandu standar docs di prompt-nya, bukan skill.
const PHASE_SKILLS: Record<string, readonly string[]> = {
  Brainstorm: ["superpowers:brainstorming"],
  Audit: ["superpowers:systematic-debugging"],
  Plan: ["superpowers:writing-plans"],
  Execute: [
    "superpowers:executing-plans",
    "superpowers:test-driven-development",
    "superpowers:verification-before-completion",
  ],
};

const skillInstruction = (phases: readonly string[]) => {
  const lines = phases
    .filter((p) => PHASE_SKILLS[p])
    .map((p) => `- ${p}: ${PHASE_SKILLS[p]!.join(", ")}`);
  return lines.length
    ? "Skills superpowers WAJIB: sebelum mengerjakan fase di bawah, invoke skill-nya lewat "
      + `Skill tool — bila skill relevan tersedia, pakai.\n${lines.join("\n")}`
    : "";
};
```

Lalu ubah `startPrompt` — sisipkan `skillInstruction(...)` setelah `phaseInstruction(...)` dan saring string kosong:

```ts
export function startPrompt(flow: Flow, spec: SpecBrief, branchTo: string): string {
  const detail = spec.payload ? `\nDetail: ${JSON.stringify(spec.payload)}` : "";
  return [
    `hanoman ${flow}. Ikuti internal/docs sebagai Source of Truth; perbarui docs yang tersentuh `
      + `dan link-nya di index, dalam commit yang sama.`,
    phaseInstruction(PIPELINES[flow]),
    skillInstruction(PIPELINES[flow]),
    `Setelah fase terakhir: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. `
      + `Worktree ini detached HEAD — itu memang disengaja.`,
    `Backlog item ${spec.id} · sumber ${spec.source} · prioritas ${spec.priority}\n`
      + `Judul: ${spec.title}\nObjective: ${spec.objective}${detail}`,
  ].filter(Boolean).join("\n\n");
}
```

- [ ] **Step 4: Jalankan — pastikan hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./runner test`
Expected: semua PASS (test lama `payload ... tak menghasilkan 'undefined'` dkk tetap hijau).

- [ ] **Step 5: Update doc + commit**

Di `internal/docs/operations/agent-documentation-workflow.md`, tambah satu bullet setelah baris "- **Fitur:** spec → plan → execute...":

```markdown
- Prompt run memetakan fase → skill superpowers (SPEC-166): Brainstorm→brainstorming,
  Audit→systematic-debugging, Plan→writing-plans, Execute→executing-plans + TDD +
  verification-before-completion. Objective/Spec adalah keluaran brainstorming.
```

```bash
git add runner/src/prompt.ts runner/test/prompt.test.ts internal/docs/operations/agent-documentation-workflow.md
git commit -m "feat(runner): prompt run menyuruh invoke skill superpowers per fase (SPEC-166)"
```

---

### Task 2: `REVERSE_STANDARD` — standar termilo terkodifikasi (runner)

**Files:**
- Create: `runner/src/reverse-standard.ts`
- Modify: `runner/src/index.ts`
- Test: `runner/test/reverse-standard.test.ts`

**Interfaces:**
- Produces: `export const REVERSE_STANDARD: string` — markdown standar docs, di-inline ke prompt oleh Task 3. Diekspor dari `@hanoman/runner`.

- [ ] **Step 1: Tulis test yang gagal**

Create `runner/test/reverse-standard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { REVERSE_STANDARD } from "../src/reverse-standard";

// Prompt sesi reverse berdiri di atas konstanta ini: yang diuji adalah kelengkapan
// unsur standarnya, bukan redaksinya.
describe("REVERSE_STANDARD", () => {
  it("memuat semua unsur standar: struktur, format, EARS, index, konvensi, hook", () => {
    for (const t of [
      "internal/docs/", "entrypoints/", "architecture/", "requirements/", "adr/",
      "product/", "business/", "brand/", "research/", "operations/", "security/", "qa/",
      "ADR-NNNN", "Status:", "Date:",
      "Ubiquitous", "Event-driven", "State-driven", "Optional", "Unwanted",
      "README.md", "Reading Order", "Naming Standard",
      "CLAUDE.md", "AGENTS.md", "Definition of Done",
      "ensure-docs-updated.py", "IMPLEMENTATION_PREFIXES",
      "reverse-engineered",
    ]) expect(REVERSE_STANDARD, t).toContain(t);
  });

  it("tanpa backtick dan tanpa interpolasi liar — aman di dalam prompt & argv tmux", () => {
    expect(REVERSE_STANDARD).not.toContain("`");
  });
});
```

- [ ] **Step 2: Jalankan — pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./runner test`
Expected: FAIL — `Cannot find module '../src/reverse-standard'`.

- [ ] **Step 3: Tulis `runner/src/reverse-standard.ts`**

Isi lengkap (perhatikan: **tanpa backtick di isi**, escape `\\"` untuk JSON hook):

```ts
// Standar docs-driven yang ditiru dari termilo (SPEC-166), di-inline ke prompt sesi
// reverse. Konstanta TS, bukan berkas .md: ikut ter-compile tanpa langkah build tambahan,
// dan ter-version bersama kode yang memakainya.
export const REVERSE_STANDARD = `# Standar docs-driven (acuan: termilo)

## Prinsip
- Root repo hanya untuk konfigurasi agent + folder implementasi. SEMUA dokumen hidup di internal/docs/.
- internal/docs/README.md adalah index + registry Source of Truth: SETIAP doc terdaftar di sana dengan deskripsi satu baris, dalam urutan baca bernomor.
- Docs detail adalah kanonik; entrypoints/ hanya pintu masuk ringkas. Bila konflik, perbaiki doc detail dulu, lalu sinkronkan entrypoint-nya.
- Setiap perubahan perilaku ditulis dulu sebagai acceptance criteria EARS sebelum kode.
- Update docs yang tersentuh DALAM COMMIT YANG SAMA dengan kodenya.
- Isi doc harus lengkap dan spesifik terhadap repo ini — bukan kerangka, bukan lorem, bukan tebakan.

## Struktur kategori (subfolder internal/docs/)
- entrypoints/ — blueprint.md, brd.md, prd.md, frd.md, rd.md; ringkas, menunjuk doc detail.
- product/ — blueprint produk, prinsip scope, onboarding.
- business/ — brd.md: model bisnis, target pasar, pricing.
- requirements/ — prd.md, frd.md, rd-NN-<domain>.md per domain, standar EARS.
- research/ — riset pasar, kompetitor, sizing.
- brand/ — strategi brand, warna, logo, tone copywriting.
- architecture/ — stack.md, data-model.md, api-contract.md, nfr.md.
- adr/ — keputusan arsitektur, NNNN-judul.md (4 digit, mulai 0001).
- design-system/ — spec design system (bila ada UI).
- frontend/ — catatan implementasi frontend (bila ada).
- operations/ — runbook, roadmap, implementation-standard, agent-documentation-workflow.
- security/ — standar keamanan, audit bertanggal YYYY-MM-DD.
- qa/ — spec QA bertanggal YYYY-MM-DD-<slug>-spec.md; yang selesai pindah ke qa/done/.

## Format doc
Setiap doc dibuka header polos (BUKAN YAML frontmatter):

  # Judul
  Status: <draft | accepted | operating standard | ...>
  Date: YYYY-MM-DD

Format ADR (internal/docs/adr/NNNN-judul.md):

  # ADR-NNNN Judul
  Status: accepted
  Date: YYYY-MM-DD
  ## Context
  ## Decision
  ## Rationale
  ## Consequences
  ## Sources

ADR yang diturunkan dari kode saat reverse ditandai: Status: accepted (reverse-engineered).

## EARS — 5 pola acceptance criteria (semua terukur; tanpa "cepat/aman" tanpa angka)
- Ubiquitous: "The system shall <respons>"
- Event-driven: "When <trigger>, the system shall <respons>"
- State-driven: "While <keadaan>, the system shall <respons>"
- Optional: "Where <fitur ada>, the system shall <respons>"
- Unwanted: "If <kondisi tak diinginkan>, then the system shall <respons>"

## internal/docs/README.md (index, wajib)
- Bagian Reading Order: daftar bernomor, satu baris per doc: "N. [judul](path) - deskripsi satu baris".
- Bagian Canonical Files: doc mana yang kanonik untuk area apa.
- Bagian Naming Standard: glosarium istilah domain repo ini (agar sebutan konsisten).
- Bagian Source Discipline: aturan "perbaiki doc detail dulu, sinkronkan entrypoint".

## CLAUDE.md + AGENTS.md repo target (tulis KEDUANYA)
Isi minimal (sesuaikan dengan repo):
- Start here: baca AGENTS.md -> internal/docs/README.md -> hanya doc yang relevan dengan task. Jangan implement dari ingatan bila doc-nya ada.
- Documentation-First Rule: sebelum task, kenali doc pemilik area; perubahan perilaku -> tulis/ubah EARS dulu; keputusan arsitektural -> ADR baru; doc baru wajib ter-link dari README index.
- Update docs tersentuh dalam commit yang sama; bila perubahan murni mekanis, sebut eksplisit "no docs update needed".
- Definition of Done: implementasi sesuai docs; docs tersentuh terbarui; test jalan (atau diblokir dengan alasan eksplisit); tak ada path/istilah basi; laporan akhir menyebut docs yang berubah.

## Stop hook enforcement (pasang di repo target)
Tulis .claude/settings.json (gabungkan bila sudah ada):

  {
    "hooks": {
      "Stop": [
        { "matcher": "", "hooks": [
          { "type": "command",
            "command": "\\"$CLAUDE_PROJECT_DIR\\"/.claude/hooks/ensure-docs-updated.py" }
        ] }
      ]
    }
  }

Tulis .claude/hooks/ensure-docs-updated.py lalu chmod +x. Sesuaikan IMPLEMENTATION_PREFIXES
dengan folder implementasi nyata repo ini (hasil fase Scan):

  #!/usr/bin/env python3
  """Stop hook: blok bila implementasi ter-stage tanpa update docs."""
  import json, subprocess, sys

  IMPLEMENTATION_PREFIXES = ("src/",)  # SESUAIKAN dengan repo ini
  DOC_PREFIXES = ("internal/docs/", "AGENTS.md", "CLAUDE.md")

  def staged():
      out = subprocess.run(["git", "diff", "--cached", "--name-only"],
                           text=True, capture_output=True).stdout
      return [l.strip() for l in out.splitlines() if l.strip()]

  def main():
      paths = staged()
      impl = [p for p in paths if p.startswith(IMPLEMENTATION_PREFIXES)]
      docs = [p for p in paths if p.startswith(DOC_PREFIXES)]
      if impl and not docs:
          print(json.dumps({"decision": "block", "reason":
              "Implementasi ter-stage tanpa update internal/docs/**. Perbarui doc yang "
              "tersentuh + link di index, atau nyatakan 'no docs update needed'."}))
      return 0

  if __name__ == "__main__":
      sys.exit(main())
`;
```

Tambahkan di `runner/src/index.ts`:

```ts
export * from "./reverse-standard";
```

- [ ] **Step 4: Jalankan — pastikan hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./runner test && env -u NODE_ENV -u DATABASE_URL pnpm --filter ./runner typecheck`
Expected: PASS semua.

- [ ] **Step 5: Commit**

```bash
git add runner/src/reverse-standard.ts runner/src/index.ts runner/test/reverse-standard.test.ts
git commit -m "feat(runner): kodifikasi standar docs-driven termilo untuk sesi reverse (SPEC-166)"
```

(Tak ada doc tersentuh: konstanta internal; kontraknya didokumentasikan di ADR-0026 pada Task 4.)

---

### Task 3: Pipeline reverse 5 fase + `startProjectPrompt` (runner)

**Files:**
- Modify: `runner/src/prompt.ts`
- Modify: `runner/src/types.ts`
- Test: `runner/test/prompt.test.ts`
- Modify: `server/test/session-phases.test.ts:39-43` (memakai nama fase reverse lama)

**Interfaces:**
- Consumes: `REVERSE_STANDARD` (Task 2), `phaseInstruction`/`PIPELINES` yang ada.
- Produces:
  - `PIPELINES.reverse = ["Scan", "Docs teknis", "Wawancara", "Konvensi & index", "Serah terima"]`
  - `export type ProjectBrief = { id: string; name: string; desc: string; stack: string }` di `runner/src/types.ts`
  - `export function startProjectPrompt(flow: Flow, project: ProjectBrief, branchTo: string): string` — dipakai Task 4.

- [ ] **Step 1: Tulis test yang gagal**

Tambah di `runner/test/prompt.test.ts`:

```ts
import { PIPELINES, startPrompt, startProjectPrompt } from "../src/prompt";
```

```ts
// SPEC-166 · sesi reverse project-level: prompt-nya membawa standar docs lengkap.
describe("startProjectPrompt", () => {
  const project = { id: "termilo", name: "termilo", desc: "booking SaaS", stack: "cloudflare" };

  it("reverse: kelima fase berurutan, dengan instruksi phase file", () => {
    const p = startProjectPrompt("reverse", project, "reverse-docs");
    const phases = ["Scan", "Docs teknis", "Wawancara", "Konvensi & index", "Serah terima"];
    expect(PIPELINES.reverse).toEqual(phases);
    for (const ph of phases) expect(p).toContain(ph);
    expect(p.indexOf("Scan")).toBeLessThan(p.indexOf("Serah terima"));
    expect(p).toContain("$HANOMAN_PHASE_FILE");
  });

  it("memuat standar docs: kategori, ADR, EARS, index, hook", () => {
    const p = startProjectPrompt("reverse", project, "reverse-docs");
    for (const t of ["STANDAR DOCS", "internal/docs/", "ADR-NNNN", "Event-driven",
      "ensure-docs-updated.py", "Reading Order"]) expect(p).toContain(t);
  });

  it("wawancara: satu pertanyaan per giliran, dilarang mengarang", () => {
    const p = startProjectPrompt("reverse", project, "reverse-docs");
    expect(p).toContain("SATU pertanyaan");
    expect(p).toContain("menunggu input");
    expect(p).toContain("Jangan mengarang");
  });

  it("commit+push per fase ke branch-nya, dengan fallback tanpa origin", () => {
    const p = startProjectPrompt("reverse", project, "reverse-docs");
    expect(p).toContain("refs/heads/reverse-docs");
    expect(p).toContain("origin tidak ada");
  });

  it("identitas project ikut, tanpa 'undefined'", () => {
    const p = startProjectPrompt("reverse", project, "reverse-docs");
    expect(p).toContain("termilo");
    expect(p).toContain("booking SaaS");
    expect(p).not.toContain("undefined");
  });
});
```

- [ ] **Step 2: Jalankan — pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./runner test`
Expected: FAIL — `startProjectPrompt` belum diekspor.

- [ ] **Step 3: Implementasi**

`runner/src/types.ts` — tambah setelah `SpecBrief`:

```ts
// Identitas project untuk sesi project-level (reverse): tak ada backlog item, jadi
// konteksnya diambil dari baris Project (SPEC-166).
export type ProjectBrief = { id: string; name: string; desc: string; stack: string };
```

`runner/src/prompt.ts` — ganti baris pipeline reverse:

```ts
  reverse: ["Scan", "Docs teknis", "Wawancara", "Konvensi & index", "Serah terima"],
```

lalu tambah di akhir file:

```ts
// Panduan per fase reverse (SPEC-166). Wawancara adalah fase interaktif: manusia menonton
// sesi ini lewat terminal dashboard dan menjawab di sana — karena itu SATU pertanyaan per
// giliran, bukan borongan.
const REVERSE_PHASE_GUIDE = [
  "- Scan: baca source code — stack, arsitektur, data model, API surface, perilaku domain. Belum menulis docs.",
  "- Docs teknis: tulis kategori yang bisa diturunkan dari kode (architecture, requirements + "
    + "EARS dari perilaku nyata, adr ber-Status accepted (reverse-engineered), operations, "
    + "security, design-system/frontend bila relevan). Isi lengkap dan spesifik, bukan kerangka.",
  "- Wawancara: untuk product, business, brand, research, entrypoints — ajukan SATU pertanyaan "
    + "per giliran ke manusia di terminal ini, tunggu jawabannya, isi docs dari jawaban. "
    + "Jangan mengarang. Topik tanpa jawaban tandai: Status: draft — menunggu input.",
  "- Konvensi & index: tulis internal/docs/README.md (index bernomor lengkap), CLAUDE.md, "
    + "AGENTS.md, .claude/settings.json + .claude/hooks/ensure-docs-updated.py persis seperti STANDAR DOCS.",
  "- Serah terima: pastikan setiap berkas docs terdaftar di index, lalu tulis ringkasan hasil "
    + "+ daftar pertanyaan yang belum terjawab ke terminal.",
].join("\n");

export function startProjectPrompt(flow: Flow, project: ProjectBrief, branchTo: string): string {
  return [
    `hanoman ${flow}. Susun Source of Truth repo ini dari kodenya di internal/docs/**, `
      + `mengikuti STANDAR DOCS di bagian bawah prompt ini.`,
    phaseInstruction(PIPELINES[flow]),
    REVERSE_PHASE_GUIDE,
    `Setiap fase selesai: commit hasilnya, lalu \`git push origin HEAD:refs/heads/${branchTo}\` — `
      + `push per fase, supaya pekerjaan tak hilang bila worktree lenyap. Bila remote origin tidak ada, `
      + `lewati push dan catat itu di laporan akhir — jangan gagal diam-diam. Worktree ini `
      + `detached HEAD — memang disengaja. Manusia yang me-review dan merge branch ${branchTo}.`,
    `Project ${project.id} · ${project.name}\nDeskripsi: ${project.desc || "—"}\nStack: ${project.stack || "—"}`,
    `=== STANDAR DOCS ===\n${REVERSE_STANDARD}`,
  ].join("\n\n");
}
```

dan import di kepala file:

```ts
import type { Flow, SpecBrief, ProjectBrief } from "./types";
import { REVERSE_STANDARD } from "./reverse-standard";
```

- [ ] **Step 4: Perbaiki test server yang memakai fase reverse lama**

`server/test/session-phases.test.ts:39-43` — test "nama fase berspasi" masih memakai
"Doc index" milik pipeline lama. Ganti bloknya menjadi (perhatikan: fase yang selesai
tak berurutan justru menguatkan test parsing token terakhir):

```ts
  // "Docs teknis" / "Konvensi & index" mengandung spasi: state adalah token TERAKHIR.
  it("nama fase boleh berspasi", () => {
    write("Scan done\nDocs teknis done\nKonvensi & index done\n");
    expect(readPhases(file, "reverse").map((p) => p.state))
      .toEqual(["done", "done", "active", "done", "pending"]);
  });
```

- [ ] **Step 5: Jalankan — pastikan hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./runner test && docker compose up -d --wait && env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test`
Expected: PASS semua (runner + server; server butuh Postgres+tmux).

- [ ] **Step 6: Commit**

```bash
git add runner/src/prompt.ts runner/src/types.ts runner/test/prompt.test.ts server/test/session-phases.test.ts
git commit -m "feat(runner): pipeline reverse 5 fase + startProjectPrompt (SPEC-166)"
```

---

### Task 4: Server — DTO `flow` reverse, sesi project-level, DELETE worktree, ADR-0026

**Files:**
- Modify: `shared/src/dto.ts:36-39` (`zTerminalSession`)
- Modify: `server/src/services/pty.ts:101-107` (`CreateOpts` + id)
- Modify: `server/src/routes/terminal.ts` (cabang project + DELETE)
- Test: `server/test/terminal.route.test.ts`
- Modify: `internal/docs/architecture/api-contract.md:79`
- Create: `internal/docs/adr/0026-reverse-docs-sesi-interaktif-project-level.md`
- Modify: `internal/docs/README.md` (link ADR-0026 di index)

**Interfaces:**
- Consumes: `startProjectPrompt` (Task 3) dari `@hanoman/runner`; `phaseFilePath`, `sessionModel`, `realGit`, `createSession`, `getSession` yang ada.
- Produces:
  - `POST /api/terminal/sessions` body `{ project: string, flow?: "reverse" }` → 201 `{ id: "reverse-<project>" }` · 404 project · 400 tanpa repoDir (tanpa flow) · **422** tanpa repoDir / worktree gagal (dengan flow).
  - `CreateOpts.id?: string` — id sesi eksplisit (dipakai route reverse).
  - `DELETE /terminal/sessions/:id` membuang worktree untuk SEMUA sesi ber-flow, bukan hanya yang ber-spec.

- [ ] **Step 1: Tulis test route yang gagal**

Tambah di akhir `server/test/terminal.route.test.ts`:

```ts
// SPEC-166: reverse menyusun Source of Truth dari kode — sesi project-level di worktree-nya.
describe("terminal routes · sesi reverse", () => {
  const start = (project: string) =>
    app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project, flow: "reverse" } });

  it("POST { project, flow: reverse } membuat worktree + sesi ber-id deterministik", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const res = await start("p1");
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe("reverse-p1");
    expect(existsSync(join(repoDir, ".worktrees", "reverse-p1"))).toBe(true);
  });

  it("POST kedua menyambung ke sesi yang sama (ADR-0015)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const a = await start("p1");
    const b = await start("p1");
    expect(a.json().id).toBe(b.json().id);
    expect(listSessions().filter((s) => s.id === "reverse-p1")).toHaveLength(1);
  });

  it("project tanpa repoDir + flow → 422 (bukan 400)", async () => {
    expect((await start("p2")).statusCode).toBe(422);
  });

  it("GET phases memakai pipeline reverse baru", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await start("p1");
    appendFileSync(phaseFilePath(repoDir, "reverse-p1"), "Scan done\n");
    const res = await app.inject({ url: "/api/terminal/sessions/reverse-p1/phases" });
    expect(res.json().flow).toBe("reverse");
    expect(res.json().phases[0]).toEqual({ name: "Scan", state: "done" });
    expect(res.json().phases[1]).toEqual({ name: "Docs teknis", state: "active" });
  });

  it("DELETE membuang worktree sesi reverse — meski tanpa spec", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await start("p1");
    expect((await app.inject({ method: "DELETE", url: "/api/terminal/sessions/reverse-p1" })).statusCode).toBe(204);
    expect(existsSync(join(repoDir, ".worktrees", "reverse-p1"))).toBe(false);
  });

  it("prompt sesi reverse memuat standar docs", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const res = await start("p1"); // sesi lama sudah di-DELETE oleh test sebelumnya
    expect(res.statusCode).toBe(201);
    const c = connect("reverse-p1");
    await c.opened;
    await waitFor(() => c.frames.some((f) => f.t === "exit"));
    expect(c.data()).toContain("STANDAR DOCS");
    c.ws.close();
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/reverse-p1" });
  });
});
```

- [ ] **Step 2: Jalankan — pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run test/terminal.route.test.ts`
Expected: describe baru FAIL (400 dari zod union — `flow` belum dikenal varian project).

- [ ] **Step 3: Implementasi**

`shared/src/dto.ts` — ganti `zTerminalSession`:

```ts
export const zTerminalSession = z.union([
  // flow opsional (SPEC-166): "reverse" = sesi project-level di worktree-nya sendiri,
  // menyusun Source of Truth dari kode. Tanpa flow = terminal biasa di repoDir.
  z.object({ project: z.string(), flow: z.literal("reverse").optional() }),
  z.object({ spec: z.string(), flow: zFlow }),
]);
```

`server/src/services/pty.ts` — `CreateOpts` + resolusi id:

```ts
export type CreateOpts = {
  id?: string; specId?: string; flow?: Flow; prompt?: string; phaseFile?: string;
  model?: string; effort?: string;
};
```

dan di `createSession`, ganti baris pertama:

```ts
  // Sesi project-level (reverse) tak punya spec: id-nya dipasok route agar tetap
  // deterministik — Start kedua harus menyambung, bukan melahirkan sesi baru (SPEC-166).
  const id = opts.id ?? idFor(opts.specId);
```

`server/src/routes/terminal.ts` — ganti blok project (baris 66-70) dengan:

```ts
    const project = await prisma.project.findUnique({ where: { id: parsed.data.project } });
    if (!project) return reply.code(404).send({ error: "project not found" });
    if (!project.repoDir) {
      // 422 saat ber-flow (SPEC-166): body-nya sah, keadaan project-nya yang belum siap.
      return reply.code(parsed.data.flow ? 422 : 400)
        .send({ error: `project "${project.id}" belum punya repoDir` });
    }

    // SPEC-166 · sesi reverse: worktree + prompt standar docs, tanpa Spec. Id deterministik
    // dari project-nya supaya Start kedua menyambung ke sesi yang sama (ADR-0015).
    if (parsed.data.flow === "reverse") {
      const id = `reverse-${project.id.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
      const live = getSession(id);
      if (live) return reply.code(201).send({ id: live.id });

      const { model, effort } = await sessionModel();
      try {
        // HEAD, bukan "main": repo target bukan milik hanoman — default branch-nya bebas.
        realGit.addWorktree(project.repoDir, `${project.repoDir}/.worktrees/${id}`, "HEAD");
      } catch (e) {
        return reply.code(422).send({ error: `gagal membuat worktree: ${(e as Error).message}` });
      }
      const s = createSession(project.id, `${project.repoDir}/.worktrees/${id}`, {
        id, flow: "reverse", model, effort,
        phaseFile: phaseFilePath(project.repoDir, id),
        prompt: startProjectPrompt("reverse", {
          id: project.id, name: project.name, desc: project.desc, stack: project.stack,
        }, "reverse-docs"),
      });
      return reply.code(201).send({ id: s.id });
    }

    const s = createSession(project.id, project.repoDir);
    return reply.code(201).send({ id: s.id });
```

dan ubah import runner-nya:

```ts
import { realGit, startPrompt, startProjectPrompt, type Flow } from "@hanoman/runner";
```

DELETE (baris 86-95) — sesi ber-flow apa pun hidup di worktree; hanya yang ber-spec
menggerakkan stage:

```ts
    if (s.flow) {
      const project = await prisma.project.findUnique({ where: { id: s.projectId } });
      if (project?.repoDir) {
        // Bacaan terakhir sebelum worktree-nya lenyap: sesudah ini berkas fasenya tak berarti lagi.
        if (s.specId) await advanceStage(s.specId, project.repoDir, id, s.flow);
        killSession(id);
        realGit.removeWorktree(project.repoDir, s.cwd);
        return reply.code(204).send();
      }
    }
```

- [ ] **Step 4: Jalankan — pastikan hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test && env -u NODE_ENV -u DATABASE_URL pnpm -r typecheck`
Expected: PASS semua (termasuk test lama: `{project}` tanpa flow tetap 400/404, sesi spec tak berubah).

- [ ] **Step 5: Update docs (commit yang sama)**

`internal/docs/architecture/api-contract.md:79` — ganti baris POST menjadi:

```
POST   /terminal/sessions  {project, flow?} # 201 { id } · 404 project · 400 tanpa repoDir · flow "reverse" (SPEC-166): worktree + prompt standar docs, 422 bila repoDir kosong/worktree gagal
```

Create `internal/docs/adr/0026-reverse-docs-sesi-interaktif-project-level.md`:

```markdown
# ADR-0026 Reverse docs sebagai sesi interaktif project-level

Status: accepted
Tanggal: 2026-07-10

## Context
Flow `reverse` dijanjikan sejak awal untuk onboarding project existing, tapi tak pernah
punya pemicu: CLI headless-nya dicabut bersama runner lama (ADR-0024), dan cabang
`{ project }` di POST /terminal/sessions hanya melahirkan sesi kosong tanpa prompt.
Acuan standar docs-driven yang dituju adalah termilo (SPEC-166).

## Decision
Reverse berjalan sebagai sesi claude interaktif project-level — tanpa baris Spec — di
worktree `.worktrees/reverse-<project>`, dipicu manusia dari UI. Pipeline lima fase:
Scan → Docs teknis → Wawancara → Konvensi & index → Serah terima. Standar docs yang
diikuti (struktur internal/docs, ADR, EARS, README index, CLAUDE.md/AGENTS.md, Stop hook
ensure-docs-updated untuk repo TARGET) dikodifikasi di `runner/src/reverse-standard.ts`
dan di-inline ke prompt. Commit + push per fase ke branch `reverse-docs`; manusia yang
me-review dan merge. Prompt semua flow kini juga memetakan fase → skill superpowers.

## Rationale
- Wawancara non-teknis butuh dialog manusia — sesi tmux interaktif adalah kanal yang ada.
- Konstanta di runner ter-version bersama kode yang memakainya, tak bergantung setup mesin.
- Tanpa Spec: reverse milik project; memaksakan baris Spec hanya menambah cabang if
  (pola yang sama dengan keputusan VPS bukan Project di SPEC-164).
- Push per fase: worktree bisa lenyap saat sesi ditutup; branch adalah tempat kerja selamat.

## Consequences
- `Spec.stage` tak bergerak untuk sesi reverse — progres hanya lewat berkas fase.
- Repo target mendapat Stop hook docs; repo hanoman sendiri tetap tanpa gate (ADR-0023).
- DELETE sesi reverse membuang worktree-nya, sama seperti sesi backlog item.
```

`internal/docs/README.md` — tambah di daftar ADR (setelah baris 0025):

```markdown
- [ADR-0026 — Reverse docs sebagai sesi interaktif project-level](adr/0026-reverse-docs-sesi-interaktif-project-level.md)
```

(Sesuaikan bentuk barisnya dengan pola baris ADR lain di index — lihat baris 0025 tepat di atasnya.)

- [ ] **Step 6: Commit**

```bash
git add shared/src/dto.ts server/src/services/pty.ts server/src/routes/terminal.ts \
  server/test/terminal.route.test.ts internal/docs/architecture/api-contract.md \
  internal/docs/adr/0026-reverse-docs-sesi-interaktif-project-level.md internal/docs/README.md
git commit -m "feat(server): sesi reverse project-level — worktree, prompt standar docs, 422 (SPEC-166, ADR-0026)"
```

---

### Task 5: Web — tombol "Reverse docs" di layar project

**Files:**
- Modify: `src/src/api/client.ts` (metode baru)
- Modify: `src/src/screens/ProjectDetailScreen.tsx` (pintu keempat)
- Modify: `src/src/App.tsx` (handler + prop)
- Modify: `internal/docs/operations/agent-documentation-workflow.md:9`
- Modify: `internal/docs/product/onboarding.md:6`

**Interfaces:**
- Consumes: endpoint Task 4 (`POST /terminal/sessions { project, flow: "reverse" }`).
- Produces: `api.reverseDocs(project: string): Promise<{ id: string }>`; prop opsional `onReverse?: () => void` pada `ProjectDetailScreen`.

- [ ] **Step 1: `api/client.ts` — metode reverseDocs**

Tambah setelah `startSession` (baris 41-42):

```ts
  // SPEC-166 · reverse: sesi project-level menyusun Source of Truth dari kode, di worktree-nya.
  reverseDocs: (project: string) =>
    j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body({ project, flow: "reverse" }) }),
```

- [ ] **Step 2: `ProjectDetailScreen.tsx` — pintu keempat (kondisional)**

Ganti signature komponen (baris 37-39):

```ts
export function ProjectDetailScreen({ p, onEdit, onGotoDocs, onGotoTerminal, onGotoBacklog, onDelete, onReverse }:
  { p: ProjectVM; onEdit: () => void; onGotoDocs: () => void; onGotoTerminal: () => void;
    onGotoBacklog: () => void; onDelete: () => void; onReverse?: () => void }) {
```

Ganti grid pintu (baris 73-77):

```tsx
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${onReverse ? 4 : 3}, 1fr)`, gap: 12 }}>
        <Door icon="book-open" title="Source of Truth" hint="baca & sunting docs" onClick={onGotoDocs} />
        <Door icon="terminal" title="Buka terminal" hint="sesi claude project ini" onClick={onGotoTerminal} />
        <Door icon="list-checks" title="Lihat backlog" hint={`${p.backlog} spec terbuka`} onClick={onGotoBacklog} />
        {onReverse && <Door icon="radar" title="Reverse docs" hint="susun Source of Truth dari kode" onClick={onReverse} />}
      </div>
```

- [ ] **Step 3: `App.tsx` — handler + prop**

Tambah setelah `startSession` (sekitar baris 373):

```ts
  // SPEC-166 · Reverse docs: sesi interaktif menyusun Source of Truth dari kode. Fase
  // Wawancara hidup di layar Terminal — di sanalah manusia menjawab agen.
  async function reverseDocs(p: ProjectVM) {
    try {
      const { id } = await api.reverseDocs(p.id);
      setSection("terminal");
      showToast(p.id + " · reverse docs · sesi " + id + " dimulai", "info", "radar");
    } catch (e) {
      const noRepo = e instanceof ApiError && (e.status === 422 || e.status === 400);
      showToast(p.id + " · gagal mulai reverse" + (noRepo ? " · project belum punya repoDir" : ""), "warn", "x-circle");
    }
  }
```

Di pemanggilan `ProjectDetailScreen` (sekitar baris 442-446), tambah prop — pintu hanya
muncul untuk project existing yang punya repoDir:

```tsx
          ? <ProjectDetailScreen p={proj} onEdit={() => setModal("project-edit")}
              onGotoDocs={() => setSection("docs")}
              onGotoTerminal={() => { setProjectFilter(proj.id); setSection("terminal"); }}
              onGotoBacklog={() => { setProjectFilter(proj.id); setSection("backlog"); }}
              onReverse={proj.kind === "existing" && proj.repoDir ? () => reverseDocs(proj) : undefined}
              onDelete={() => deleteProject(proj)} />
```

- [ ] **Step 4: Typecheck web**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src typecheck`
Expected: bersih, 0 error. (Tak ada suite unit UI di repo ini — verifikasi visual di Task 6.)

- [ ] **Step 5: Update docs (commit yang sama)**

`internal/docs/operations/agent-documentation-workflow.md:9` — ganti:

```markdown
- **Existing:** tombol **Reverse docs** di layar project — sesi interaktif menyusun docs dari codebase (SPEC-166, ADR-0026): Scan → Docs teknis → Wawancara → Konvensi & index → Serah terima, hasil di branch `reverse-docs`.
```

`internal/docs/product/onboarding.md:6` — ganti langkah 2 menjadi:

```markdown
2. Tambah project: **from-scratch** (brainstorm → objective → scaffold docs) atau **existing** (pilih direktori → tombol **Reverse docs** menyusun Source of Truth lewat sesi interaktif; fase Wawancara dijawab di Terminal).
```

- [ ] **Step 6: Commit**

```bash
git add src/src/api/client.ts src/src/screens/ProjectDetailScreen.tsx src/src/App.tsx \
  internal/docs/operations/agent-documentation-workflow.md internal/docs/product/onboarding.md
git commit -m "feat(web): tombol Reverse docs di layar project existing (SPEC-166)"
```

---

### Task 6: Verifikasi menyeluruh + smoke API nyata

**Files:**
- Modify: `docs/superpowers/specs/2026-07-10-reverse-docs-superpowers-spec-166-design.md:3` (status)
- Modify: file plan ini (centang semua checklist)

**Interfaces:**
- Consumes: seluruh hasil Task 1-5.
- Produces: bukti verifikasi nyata (output curl + tmux) di pesan akhir; status spec berubah.

- [ ] **Step 1: Suite penuh repo**

Run: `docker compose up -d --wait && env -u NODE_ENV -u DATABASE_URL pnpm test`
Expected: PASS semua (root vitest `--no-file-parallelism`; ingat: `queue-durability` flaky HANYA bila dijalankan sendirian — di suite penuh harus hijau).

- [ ] **Step 2: Boot server dengan claude palsu**

`POST /terminal/sessions` men-spawn claude sungguhan — untuk smoke, ganti binarinya:

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman
env -u NODE_ENV -u DATABASE_URL HANOMAN_CLAUDE_BIN=/bin/echo PORT=8787 pnpm dev:api
# tunggu "listening" di log
```

- [ ] **Step 3: Smoke nyata — project temp + sesi reverse**

```bash
rm -rf /tmp/rev-demo && mkdir -p /tmp/rev-demo && cd /tmp/rev-demo \
  && git init -qb main && git -c user.email=t@t -c user.name=t commit -qm init --allow-empty

curl -s localhost:8787/api/projects -X POST -H 'content-type: application/json' \
  -d '{"name":"rev-demo","kind":"existing","repoDir":"/tmp/rev-demo"}'
# catat "id" dari respons (mis. "rev-demo")

curl -si localhost:8787/api/terminal/sessions -X POST -H 'content-type: application/json' \
  -d '{"project":"rev-demo","flow":"reverse"}'
```

Expected: `201` + `{"id":"reverse-rev-demo"}`.

```bash
ls /tmp/rev-demo/.worktrees/               # ada: reverse-rev-demo
tmux -L hanoman list-sessions              # ada: hanoman-reverse-rev-demo
tmux -L hanoman capture-pane -p -J -S -200 -t hanoman-reverse-rev-demo | grep -c "STANDAR DOCS"  # ≥ 1
curl -s localhost:8787/api/terminal/sessions/reverse-rev-demo/phases   # flow "reverse", Scan active
```

- [ ] **Step 4: Bersih-bersih smoke**

```bash
curl -s -X DELETE localhost:8787/api/terminal/sessions/reverse-rev-demo   # 204
curl -s -X DELETE localhost:8787/api/projects/rev-demo                    # project temp dibuang
rm -rf /tmp/rev-demo
# matikan pnpm dev:api
```

Expected: worktree `/tmp/rev-demo/.worktrees/reverse-rev-demo` ikut lenyap sebelum `rm`.

- [ ] **Step 5: Tandai selesai + commit**

Ubah baris 3 spec design menjadi:

```
**Tanggal:** 2026-07-10 · **Status:** diimplementasi (lihat plan + verifikasi)
```

Centang seluruh checkbox plan ini, lalu:

```bash
git add docs/superpowers/specs/2026-07-10-reverse-docs-superpowers-spec-166-design.md \
  docs/superpowers/plans/2026-07-10-reverse-docs-superpowers-spec-166.md
git commit -m "docs(spec-166): tandai terimplementasi + centang plan, catat verifikasi nyata"
```
