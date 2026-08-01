# SPEC-471 — Tarik issue GitHub ke backlog: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operator dapat menarik issue GitHub sebuah project ke hanoman, lalu memetakan tiap issue 1:1 menjadi satu backlog item yang dikerjakan lewat jalur sesi yang sudah ada.

**Architecture:** Cermin jalur tiket Help Center (ADR-0062): sistem luar → record lokal (`GithubIssue`) → jembatan `accept` idempoten → `Spec`. Pengambilan punya dua jalur auth — `gh` CLI lebih dulu, fallback HTTP ke `api.github.com` — yang **wajib** bermuara ke satu normalizer, karena endpoint REST `/issues` memuat pull request sementara `gh issue list` tidak (terukur: 14/30 di `cli/cli`, **71/71** di repo yang issue-nya dimatikan). hanoman **tidak pernah menulis** ke GitHub.

**Tech Stack:** TypeScript strict · Fastify · Prisma 6 + SQLite · zod · vitest · React+TS (Vite) · `gh` CLI 2.96 · GitHub REST v3

## Global Constraints

- **Spec design**: [`docs/superpowers/specs/2026-08-01-spec-471-pull-issue-github-design.md`](../specs/2026-08-01-spec-471-pull-issue-github-design.md) — patuhi apa adanya.
- **Diagnosis**: [`internal/docs/research/audit-spec-471-pull-issue-github.md`](../../../internal/docs/research/audit-spec-471-pull-issue-github.md).
- **ADR baru: `0095`** — nomor sudah diverifikasi bebas di seluruh branch & worktree pada 2026-08-01. Verifikasi **ulang** tepat sebelum push.
- **Skema berubah ⇒ migration + ADR** (AGENTS.md aturan 2). Migration **ditulis tangan** + `prisma migrate deploy` — **jangan** `migrate dev` (ia me-reset DB saat ada drift worktree tetangga).
- **Bahasa komentar & doc: Indonesia.** Kode, nama simbol, dan output tetap apa adanya.
- **Test wajib serial**: `pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism`. Run tingkat-root tak menghormati `fileParallelism:false` milik project server dan test server berbagi satu berkas DB.
- **Jebakan `--changed`**: ia menyalakan `passWithNoTests` → nol test **terlihat hijau**. Selalu baca jumlah test yang benar-benar berjalan.
- **Tak ada test yang memukul `api.github.com` sungguhan.** Semua jalur jaringan disuntik lewat parameter (fixture terekam).
- **hanoman tidak pernah menulis ke GitHub** — tak ada `gh issue close`, `gh issue comment`, `POST`/`PATCH` ke `api.github.com`.
- **Nilai terukur yang tak boleh dilunakkan**: `gh` default `--limit` = 30; `gh` exit 1 untuk issues-disabled / repo-hilang / token-invalid; REST menjawab **200** untuk repo yang issue-nya dimatikan; `has_issues` di `/repos/{slug}` adalah satu-satunya pembeda "dimatikan" vs "kosong".
- **Sesudah tiap task**: centang kotaknya di berkas ini, lalu jalankan test yang tersentuh task itu.

---

## File Structure

| Berkas | Tanggung jawab | Task |
|---|---|---|
| `shared/src/github.ts` | **Create** — kontrak `NormalIssue`, status triase, peta label→source | 1 |
| `shared/src/index.ts` | **Modify** — ekspor modul baru | 1 |
| `shared/src/github.test.ts` | **Create** — test peta label | 1 |
| `server/src/services/github-repo.ts` | **Create** — resolusi `owner/repo` dari project | 2 |
| `server/test/github-repo.test.ts` | **Create** | 2 |
| `server/test/fixtures/github/` | **Create** — fixture `gh` & REST terekam | 3 |
| `server/src/services/github-fetch.ts` | **Create** — normalizer + filter PR + dua jalur ambil | 3, 4 |
| `server/test/github-fetch.test.ts` | **Create** | 3, 4 |
| `server/prisma/schema.prisma` | **Modify** — model `GithubIssue` | 5 |
| `server/prisma/migrations/20260801170000_github_issue/migration.sql` | **Create** | 5 |
| `server/src/services/github-issues.ts` | **Create** — `pullIssues` upsert idempoten | 5 |
| `server/test/github-pull.test.ts` | **Create** | 5 |
| `server/src/services/sync.ts` | **Modify** — entitas `githubIssue` | 6 |
| `server/test/github-sync.test.ts` | **Create** | 6 |
| `server/src/services/github-accept.ts` | **Create** — jembatan issue → `Spec` | 7 |
| `server/test/github-accept.test.ts` | **Create** | 7 |
| `server/src/routes/github-issues.ts` | **Create** — enam endpoint | 8 |
| `server/src/app.ts` | **Modify** — register route | 8 |
| `server/src/services/agent-capabilities.ts` | **Modify** — peta capability | 8 |
| `server/test/github-routes.test.ts` | **Create** | 8 |
| `server/test/agent-capabilities.test.ts` | **Modify** — kasus baru | 8 |
| `shared/src/config-registry.ts` | **Modify** — `GITHUB_TOKEN`, `HANOMAN_GH_BIN` | 9 |
| `cli/src/commands/doctor.ts` | **Modify** — probe `gh` non-fatal | 9 |
| `cli/test/doctor.test.ts` | **Modify** | 9 |
| `src/src/api/client.ts` | **Modify** — helper API baru | 10 |
| `src/src/screens/TriageScreen.tsx` | **Modify** — tab "Issue GitHub" | 10 |
| `src/test/triage-github.test.tsx` | **Create** | 10 |
| `internal/docs/adr/0095-tarik-issue-github-ke-backlog.md` | **Create** | 11 |
| `internal/docs/README.md` · `internal/docs/adr/README.md` | **Modify** — taut ADR | 11 |
| `internal/docs/architecture/data-model.md` · `api-contract.md` | **Modify** | 11 |

---

### Task 1: Kontrak bersama — `NormalIssue` & peta label→source

**Files:**
- Create: `shared/src/github.ts`
- Create: `shared/src/github.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: `zSpecSource` dari `shared/src/enums.ts`
- Produces: `zNormalIssue`, `type NormalIssue`, `zGithubIssueStatus`, `sourceForLabels(labels: string[]): "qa"|"brief"|"audit"`, `type GithubIssueView`

- [x] **Step 1: Tulis test yang gagal**

`shared/src/github.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sourceForLabels, zNormalIssue } from "./github";

describe("SPEC-471 · peta label issue → source Spec", () => {
  it("label bug-ish → qa", () => {
    expect(sourceForLabels(["bug"])).toBe("qa");
    expect(sourceForLabels(["Type: Defect"])).toBe("qa");
    expect(sourceForLabels(["regression"])).toBe("qa");
  });
  it("label fitur-ish → brief", () => {
    expect(sourceForLabels(["enhancement"])).toBe("brief");
    expect(sourceForLabels(["feature request"])).toBe("brief");
  });
  it("label tanya/docs → audit", () => {
    expect(sourceForLabels(["question"])).toBe("audit");
    expect(sourceForLabels(["documentation"])).toBe("audit");
  });
  // Kesembilan issue nyata di repo ini TAK BERLABEL (audit B1) dan isinya laporan cacat.
  // Default `qa` = selidiki dulu; `brief` akan membangun dari premis yang belum diperiksa.
  it("tanpa label / label tak dikenal → qa (default menyelidiki)", () => {
    expect(sourceForLabels([])).toBe("qa");
    expect(sourceForLabels(["good first issue", "help wanted"])).toBe("qa");
  });
  it("label bug menang atas label lain saat keduanya ada", () => {
    expect(sourceForLabels(["enhancement", "bug"])).toBe("qa");
  });
  it("zNormalIssue menolak bentuk yang tak lengkap", () => {
    expect(zNormalIssue.safeParse({ number: 1 }).success).toBe(false);
    expect(zNormalIssue.safeParse({
      number: 9, title: "t", body: "b", authorLogin: "u", labels: [],
      url: "https://github.com/o/r/issues/9", issueState: "open",
      issueCreatedAt: "2026-07-30T11:57:43Z", issueUpdatedAt: "2026-07-30T11:57:43Z",
    }).success).toBe(true);
  });
});
```

- [x] **Step 2: Jalankan, pastikan MERAH**

Run: `./node_modules/.bin/vitest run --dir shared shared/src/github.test.ts`
Expected: FAIL — `Failed to resolve import "./github"`

- [x] **Step 3: Implementasi minimal**

`shared/src/github.ts`:

```ts
import { z } from "zod";

// SPEC-471 · ADR-0095 · kontrak issue GitHub yang dipakai bersama server & web.
// `NormalIssue` adalah bentuk NORMAL — hasil kedua jalur ambil (gh CLI & REST) sesudah
// dinormalkan. Keduanya WAJIB menghasilkan bentuk ini persis; lihat github-fetch.ts.
export const zGithubIssueStatus = z.enum(["new", "accepted", "rejected"]);
export type GithubIssueStatus = z.infer<typeof zGithubIssueStatus>;

export const zNormalIssue = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string(),
  authorLogin: z.string(),
  labels: z.array(z.string()),
  url: z.string(),
  issueState: z.enum(["open", "closed"]),
  issueCreatedAt: z.string(),  // ISO-8601 apa adanya dari GitHub
  issueUpdatedAt: z.string(),
});
export type NormalIssue = z.infer<typeof zNormalIssue>;

// Bentuk yang menyeberang ke UI (baris DB + spec tertaut bila ada).
export const zGithubIssueView = zNormalIssue.extend({
  id: z.string(), projectId: z.string(), repoSlug: z.string(),
  status: zGithubIssueStatus, specId: z.string().nullable(), pulledAt: z.string(),
});
export type GithubIssueView = z.infer<typeof zGithubIssueView>;

// Peta label → source Spec. URUTAN BERARTI: yang lebih spesifik/berisiko lebih dulu, jadi
// issue ber-label ["enhancement","bug"] jatuh ke `qa` (menyelidiki) bukan `brief` (membangun).
const LABEL_RULES: Array<{ needles: string[]; source: "qa" | "brief" | "audit" }> = [
  { needles: ["bug", "defect", "regression"], source: "qa" },
  { needles: ["question", "docs", "documentation"], source: "audit" },
  { needles: ["enhancement", "feature", "feat"], source: "brief" },
];

// Default `qa`, BUKAN `brief` seperti tiket Help Center (SPEC-291). Disengaja: kesembilan issue
// nyata di repo ini tak berlabel sama sekali sementara isinya laporan cacat (audit B1). Untuk
// laporan yang belum terklasifikasi, flow yang menyelidiki lebih dulu adalah default yang aman.
export function sourceForLabels(labels: string[]): "qa" | "brief" | "audit" {
  const hay = labels.map((l) => l.toLowerCase());
  for (const rule of LABEL_RULES)
    if (hay.some((l) => rule.needles.some((n) => l.includes(n)))) return rule.source;
  return "qa";
}
```

`shared/src/index.ts` — tambahkan di antara ekspor lain:

```ts
export * from "./github";
```

- [x] **Step 4: Jalankan, pastikan HIJAU**

Run: `./node_modules/.bin/vitest run --dir shared shared/src/github.test.ts`
Expected: PASS — 6 test

- [x] **Step 5: Commit**

```bash
git add shared/src/github.ts shared/src/github.test.ts shared/src/index.ts
git commit -m "feat(471): kontrak NormalIssue + peta label issue → source Spec"
```

---

### Task 2: Resolusi repo — `Project.gitRemote ?? origin(repoDir)`

**Files:**
- Create: `server/src/services/github-repo.ts`
- Create: `server/test/github-repo.test.ts`

**Interfaces:**
- Consumes: `listRemotes()` dari `services/git-remotes.ts`, `resolveRepoDir()` dari `services/local-binding.ts`, `prisma`
- Produces: `type GithubRepo = { owner: string; repo: string; slug: string }`, `githubSlugFromUrl(url: string): GithubRepo | null`, `resolveGithubRepo(projectId: string): Promise<{ ok: true; repo: GithubRepo } | { ok: false; kind: "no-project" | "no-remote" | "not-github"; error: string }>`

- [x] **Step 1: Tulis test yang gagal**

`server/test/github-repo.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { prisma } from "../src/db";
import { githubSlugFromUrl, resolveGithubRepo } from "../src/services/github-repo";

// Repo git sungguhan (bukan mock) supaya jalur fallback `origin` benar-benar teruji.
function repoWithOrigin(url: string): string {
  const dir = mkdtempSync(join(tmpdir(), "hnm-gh-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", url], { cwd: dir });
  return dir;
}

const dirs: string[] = [];
const clean = async () => {
  await prisma.localBinding.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};

beforeAll(async () => {
  await clean();
  // A · gitRemote terisi, TANPA repoDir  (kasus `inkara` — audit B5.2)
  await prisma.project.create({ data: { id: "gh-a", name: "A", desc: "", kind: "existing",
    gitRemote: "https://github.com/INKARA-CLUB/inkara-product" } });
  // B · gitRemote KOSONG, origin repoDir github  (kasus `crm-tumbuh-ai`/`videos` — audit B5.1)
  const dirB = repoWithOrigin("https://github.com/zamaludin/kirimchat-multi.git"); dirs.push(dirB);
  await prisma.project.create({ data: { id: "gh-b", name: "B", desc: "", kind: "existing", repoDir: dirB } });
  // C · origin GitLab  (kasus `erp-tumbuh-ai` — audit B5.3)
  const dirC = repoWithOrigin("https://gitlab.com/tumbuh.ai/erp.git"); dirs.push(dirC);
  await prisma.project.create({ data: { id: "gh-c", name: "C", desc: "", kind: "existing", repoDir: dirC } });
  // D · tanpa gitRemote & tanpa repoDir
  await prisma.project.create({ data: { id: "gh-d", name: "D", desc: "", kind: "existing" } });
  // E · gitRemote menang atas origin yang berbeda
  const dirE = repoWithOrigin("https://github.com/salah/salah.git"); dirs.push(dirE);
  await prisma.project.create({ data: { id: "gh-e", name: "E", desc: "", kind: "existing",
    repoDir: dirE, gitRemote: "git@github.com:denameidina/hanoman.git" } });
});
afterAll(async () => { await clean(); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

describe("SPEC-471 · githubSlugFromUrl", () => {
  it("https, dengan & tanpa .git", () => {
    expect(githubSlugFromUrl("https://github.com/denameidina/hanoman.git")?.slug).toBe("denameidina/hanoman");
    expect(githubSlugFromUrl("https://github.com/denameidina/hanoman")?.slug).toBe("denameidina/hanoman");
  });
  it("ssh", () => {
    const r = githubSlugFromUrl("git@github.com:INKARA-CLUB/inkara-product.git");
    expect(r).toEqual({ owner: "INKARA-CLUB", repo: "inkara-product", slug: "INKARA-CLUB/inkara-product" });
  });
  it("host non-github → null", () => {
    expect(githubSlugFromUrl("https://gitlab.com/tumbuh.ai/erp.git")).toBeNull();
    expect(githubSlugFromUrl("https://bitbucket.org/a/b.git")).toBeNull();
  });
  it("bukan URL → null", () => expect(githubSlugFromUrl("bukan-url")).toBeNull());
});

describe("SPEC-471 · resolveGithubRepo", () => {
  it("gitRemote terisi tanpa repoDir tetap jalan", async () => {
    const r = await resolveGithubRepo("gh-a");
    expect(r).toEqual({ ok: true, repo: { owner: "INKARA-CLUB", repo: "inkara-product", slug: "INKARA-CLUB/inkara-product" } });
  });
  it("gitRemote kosong → jatuh ke origin repoDir", async () => {
    const r = await resolveGithubRepo("gh-b");
    expect(r.ok && r.repo.slug).toBe("zamaludin/kirimchat-multi");
  });
  it("origin GitLab → not-github, pesannya MENYEBUT hostnya", async () => {
    const r = await resolveGithubRepo("gh-c");
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.kind).toBe("not-github"); expect(r.error).toContain("gitlab.com"); }
  });
  it("tanpa remote apa pun → no-remote", async () => {
    const r = await resolveGithubRepo("gh-d");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("no-remote");
  });
  it("gitRemote MENANG atas origin repoDir", async () => {
    const r = await resolveGithubRepo("gh-e");
    expect(r.ok && r.repo.slug).toBe("denameidina/hanoman");
  });
  it("project tak ada → no-project", async () => {
    const r = await resolveGithubRepo("tidak-ada");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("no-project");
  });
});
```

- [x] **Step 2: Jalankan, pastikan MERAH**

Run: `./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/github-repo.test.ts`
Expected: FAIL — `Cannot find module '../src/services/github-repo'`

- [x] **Step 3: Implementasi minimal**

`server/src/services/github-repo.ts`:

```ts
import { prisma } from "../db";
import { listRemotes } from "./git-remotes";
import { resolveRepoDir } from "./local-binding";

// SPEC-471 · ADR-0095 · dari mana hanoman tahu repo GitHub sebuah project.
// Sweep 8 project (audit B5) mengukur tiga keadaan yang semuanya nyata: `Project.gitRemote`
// terisi tanpa `repoDir` (inkara), `gitRemote` kosong sementara `origin` di repoDir justru
// GitHub (crm-tumbuh-ai, videos — separuh project GitHub akan terlewat kalau hanya kolom
// yang dibaca), dan host non-GitHub (erp-tumbuh-ai di GitLab) yang harus DITOLAK BERSUARA.
export type GithubRepo = { owner: string; repo: string; slug: string };
export type RepoResolution =
  | { ok: true; repo: GithubRepo }
  | { ok: false; kind: "no-project" | "no-remote" | "not-github"; error: string };

// Ekstrak host + owner/repo. Sengaja tidak memakai parseRemote() milik git-remotes.ts karena
// yang di sana memancarkan `slug` mentah (bisa memuat sub-path); di sini owner & repo harus
// terpisah untuk membangun path REST.
function parse(url: string): { host: string; owner: string; repo: string } | null {
  const u = url.trim();
  let m = /^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/.exec(u);
  if (!m) m = /^https?:\/\/(?:[^@/]+@)?([^/]+)\/([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(u);
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  return { host: m[1], owner: m[2], repo: m[3] };
}

export function githubSlugFromUrl(url: string): GithubRepo | null {
  const p = parse(url);
  if (!p || !p.host.includes("github.")) return null;
  return { owner: p.owner, repo: p.repo, slug: `${p.owner}/${p.repo}` };
}

export async function resolveGithubRepo(projectId: string): Promise<RepoResolution> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return { ok: false, kind: "no-project", error: `project "${projectId}" tidak ada` };

  // Kandidat berurut: kolom resmi dulu (disync, berlaku di semua mesin), lalu origin lokal.
  const candidates: string[] = [];
  if (project.gitRemote) candidates.push(project.gitRemote);
  const repoDir = await resolveRepoDir(projectId).catch(() => null);
  if (repoDir) {
    const origin = (await listRemotes(repoDir)).find((r) => r.name === "origin");
    if (origin?.fetch) candidates.push(origin.fetch);
  }
  if (candidates.length === 0)
    return { ok: false, kind: "no-remote", error: "project belum punya remote GitHub (isi gitRemote atau tambahkan origin di repo lokalnya)" };

  for (const url of candidates) {
    const gh = githubSlugFromUrl(url);
    if (gh) return { ok: true, repo: gh };
  }
  const host = parse(candidates[0]!)?.host ?? candidates[0]!;
  return { ok: false, kind: "not-github", error: `remote project ber-host "${host}", bukan GitHub — tarik issue hanya mendukung GitHub` };
}
```

- [x] **Step 4: Jalankan, pastikan HIJAU**

Run: `./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/github-repo.test.ts`
Expected: PASS — 10 test

- [x] **Step 5: Commit**

```bash
git add server/src/services/github-repo.ts server/test/github-repo.test.ts
git commit -m "feat(471): resolusi repo GitHub — gitRemote ?? origin(repoDir), host non-GitHub ditolak bersuara"
```

---

### Task 3: Normalizer dua jalur + filter pull request

Ini jantung spec-nya. `gh issue list` mengembalikan issue murni; REST `/issues` mengembalikan issue **dan** pull request. Terukur: 14 dari 30 di `cli/cli`, dan **71 dari 71** di `zamaludin/kirimchat-multi` — repo yang issue-nya **dimatikan** dan REST tetap menjawab **200**. Tanpa filter, menarik repo itu melahirkan 71 backlog item dari pull request.

**Files:**
- Create: `server/test/fixtures/github/gh-list.json`
- Create: `server/test/fixtures/github/rest-issues.json`
- Create: `server/src/services/github-fetch.ts`
- Create: `server/test/github-fetch.test.ts`

**Interfaces:**
- Consumes: `NormalIssue` dari `@hanoman/shared`
- Produces: `issueFromGh(raw: GhRaw): NormalIssue`, `issuesFromRest(raw: RestRaw[]): { issues: NormalIssue[]; skippedPullRequests: number }`

- [x] **Step 1: Buat fixture terekam**

`server/test/fixtures/github/gh-list.json` — bentuk `gh issue list --json …` apa adanya (perhatikan `state` KAPITAL, `author.login`, `url`):

```json
[
  {
    "number": 9,
    "title": "[Moderate][Handoff] Reconciled crash/reboot sessions are shown as successful completion",
    "body": "## Severity\nModerate\n\n## Location\n- `server/src/...`",
    "author": { "id": "U_kgDOEDU0PA", "is_bot": false, "login": "wulanrlestari", "name": "Wulan R Lestari" },
    "labels": [],
    "url": "https://github.com/denameidina/hanoman/issues/9",
    "state": "OPEN",
    "createdAt": "2026-07-30T11:57:43Z",
    "updatedAt": "2026-07-30T11:57:43Z"
  },
  {
    "number": 6,
    "title": "[UX/A11y] 15 destructive flow melewati ConfirmDialog dan memakai window.confirm",
    "body": "Detail keluhan.",
    "author": { "login": "RamaAditya49" },
    "labels": [{ "id": "L_1", "name": "bug", "description": "", "color": "d73a4a" }],
    "url": "https://github.com/denameidina/hanoman/issues/6",
    "state": "OPEN",
    "createdAt": "2026-07-30T11:46:25Z",
    "updatedAt": "2026-07-30T11:46:25Z"
  }
]
```

`server/test/fixtures/github/rest-issues.json` — bentuk REST apa adanya (`state` kecil, `user.login`, `html_url`, dan **satu item ber-`pull_request`**):

```json
[
  {
    "number": 9,
    "title": "[Moderate][Handoff] Reconciled crash/reboot sessions are shown as successful completion",
    "body": "## Severity\nModerate\n\n## Location\n- `server/src/...`",
    "user": { "login": "wulanrlestari" },
    "labels": [],
    "html_url": "https://github.com/denameidina/hanoman/issues/9",
    "state": "open",
    "created_at": "2026-07-30T11:57:43Z",
    "updated_at": "2026-07-30T11:57:43Z"
  },
  {
    "number": 14017,
    "title": "feat(discussion): add support for Discussion Templates",
    "body": "PR body",
    "user": { "login": "kontributor" },
    "labels": [],
    "html_url": "https://github.com/cli/cli/pull/14017",
    "state": "open",
    "created_at": "2026-07-29T10:00:00Z",
    "updated_at": "2026-07-29T10:00:00Z",
    "pull_request": {
      "url": "https://api.github.com/repos/cli/cli/pulls/14017",
      "html_url": "https://github.com/cli/cli/pull/14017"
    }
  },
  {
    "number": 6,
    "title": "[UX/A11y] 15 destructive flow melewati ConfirmDialog dan memakai window.confirm",
    "body": "Detail keluhan.",
    "user": { "login": "RamaAditya49" },
    "labels": [{ "name": "bug", "color": "d73a4a" }],
    "html_url": "https://github.com/denameidina/hanoman/issues/6",
    "state": "open",
    "created_at": "2026-07-30T11:46:25Z",
    "updated_at": "2026-07-30T11:46:25Z"
  }
]
```

- [x] **Step 2: Tulis test yang gagal**

`server/test/github-fetch.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { issueFromGh, issuesFromRest } from "../src/services/github-fetch";

const fx = (n: string) => JSON.parse(readFileSync(join(__dirname, "fixtures/github", n), "utf8"));

describe("SPEC-471 · normalizer dua jalur", () => {
  it("jalur gh: state KAPITAL → kecil, author.login, labels[].name", () => {
    const [first] = fx("gh-list.json").map(issueFromGh);
    expect(first).toEqual({
      number: 9,
      title: "[Moderate][Handoff] Reconciled crash/reboot sessions are shown as successful completion",
      body: "## Severity\nModerate\n\n## Location\n- `server/src/...`",
      authorLogin: "wulanrlestari",
      labels: [],
      url: "https://github.com/denameidina/hanoman/issues/9",
      issueState: "open",
      issueCreatedAt: "2026-07-30T11:57:43Z",
      issueUpdatedAt: "2026-07-30T11:57:43Z",
    });
    expect(fx("gh-list.json").map(issueFromGh)[1]!.labels).toEqual(["bug"]);
  });

  // Terukur: REST /issues memuat PULL REQUEST. 14/30 di cli/cli; 71/71 di repo yang
  // issue-nya DIMATIKAN. Tanpa filter ini, menarik repo itu melahirkan 71 backlog palsu.
  it("jalur REST: item ber-`pull_request` DIBUANG dan dihitung", () => {
    const { issues, skippedPullRequests } = issuesFromRest(fx("rest-issues.json"));
    expect(skippedPullRequests).toBe(1);
    expect(issues.map((i) => i.number)).toEqual([9, 6]);
    expect(issues.some((i) => i.url.includes("/pull/"))).toBe(false);
  });

  it("PARITAS: kedua jalur menghasilkan baris identik untuk issue yang sama", () => {
    const viaGh = fx("gh-list.json").map(issueFromGh);
    const viaRest = issuesFromRest(fx("rest-issues.json")).issues;
    expect(viaRest).toEqual(viaGh);
  });

  it("body null (issue tanpa deskripsi) → string kosong, bukan crash", () => {
    expect(issueFromGh({ ...fx("gh-list.json")[0], body: null }).body).toBe("");
    expect(issuesFromRest([{ ...fx("rest-issues.json")[0], body: null }]).issues[0]!.body).toBe("");
  });

  it("issue tertutup → issueState closed", () => {
    expect(issueFromGh({ ...fx("gh-list.json")[0], state: "CLOSED" }).issueState).toBe("closed");
    expect(issuesFromRest([{ ...fx("rest-issues.json")[0], state: "closed" }]).issues[0]!.issueState).toBe("closed");
  });
});
```

- [x] **Step 3: Jalankan, pastikan MERAH**

Run: `./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/github-fetch.test.ts`
Expected: FAIL — `Cannot find module '../src/services/github-fetch'`

- [x] **Step 4: Implementasi minimal**

`server/src/services/github-fetch.ts` (bagian normalizer saja; jalur IO menyusul di Task 4):

```ts
import type { NormalIssue } from "@hanoman/shared";

// SPEC-471 · ADR-0095 · DUA jalur ambil, SATU bentuk keluaran.
//
// Kenapa filter pull request ada di sini dan bukan opsional: di GitHub setiap pull request
// ADALAH sebuah issue, jadi endpoint REST `/repos/{slug}/issues` memuat keduanya sementara
// `gh issue list` hanya memuat issue. Terukur 2026-08-01: 14 dari 30 item di `cli/cli` adalah
// PR, dan di `zamaludin/kirimchat-multi` — repo yang issue-nya DIMATIKAN — REST menjawab
// HTTP 200 dengan 71 item yang 71-71-nya PR. Tanpa filter, "tarik issue" pada repo tanpa
// satu pun issue akan melahirkan 71 backlog item dari pull request orang lain.

type GhLabel = { name?: string };
export type GhRaw = {
  number: number; title: string; body: string | null;
  author?: { login?: string } | null; labels?: GhLabel[] | null;
  url: string; state: string; createdAt: string; updatedAt: string;
};
export type RestRaw = {
  number: number; title: string; body: string | null;
  user?: { login?: string } | null; labels?: Array<GhLabel | string> | null;
  html_url: string; state: string; created_at: string; updated_at: string;
  pull_request?: unknown;
};

const labelNames = (l: Array<GhLabel | string> | null | undefined): string[] =>
  (l ?? []).map((x) => (typeof x === "string" ? x : x.name ?? "")).filter(Boolean);

const norm = (s: string): "open" | "closed" => (s.toLowerCase() === "closed" ? "closed" : "open");

export function issueFromGh(raw: GhRaw): NormalIssue {
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body ?? "",
    authorLogin: raw.author?.login ?? "",
    labels: labelNames(raw.labels),
    url: raw.url,
    issueState: norm(raw.state),
    issueCreatedAt: raw.createdAt,
    issueUpdatedAt: raw.updatedAt,
  };
}

export function issuesFromRest(raw: RestRaw[]): { issues: NormalIssue[]; skippedPullRequests: number } {
  let skippedPullRequests = 0;
  const issues: NormalIssue[] = [];
  for (const r of raw) {
    if (r.pull_request !== undefined) { skippedPullRequests++; continue; }
    issues.push({
      number: r.number,
      title: r.title,
      body: r.body ?? "",
      authorLogin: r.user?.login ?? "",
      labels: labelNames(r.labels),
      url: r.html_url,
      issueState: norm(r.state),
      issueCreatedAt: r.created_at,
      issueUpdatedAt: r.updated_at,
    });
  }
  return { issues, skippedPullRequests };
}
```

- [x] **Step 5: Jalankan, pastikan HIJAU**

Run: `./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/github-fetch.test.ts`
Expected: PASS — 5 test

- [x] **Step 6: Commit**

```bash
git add server/src/services/github-fetch.ts server/test/github-fetch.test.ts server/test/fixtures/github
git commit -m "feat(471): normalizer issue dua jalur + buang pull request dari REST (terukur 14/30 & 71/71)"
```

---

### Task 4: `fetchIssues` — `gh` dulu, fallback HTTP, kegagalan otoritatif tidak di-fallback

Aturan fallback adalah bagian paling halus dari spec ini. `gh` menjawab **exit 1** untuk "issues dimatikan"; REST menjawab **200 + 71 PR** untuk repo yang sama. Jatuh ke REST karena `gh` gagal justru **memproduksi** bug yang paling ingin dihindari. Fallback karena itu hanya sah saat `gh` **tak bisa dieksekusi** atau **tak terautentikasi**.

**Files:**
- Modify: `server/src/services/github-fetch.ts`
- Modify: `server/test/github-fetch.test.ts`

**Interfaces:**
- Consumes: `issueFromGh`, `issuesFromRest` (Task 3), `GithubRepo` (Task 2), `effectiveStr` dari `../config`
- Produces:
  ```ts
  export type FetchDeps = {
    runGh?: (args: string[], env: NodeJS.ProcessEnv) => Promise<{ code: number; stdout: string; stderr: string }>;
    httpGet?: (url: string, headers: Record<string, string>) => Promise<{ status: number; json: unknown }>;
    token?: string;
    ghBin?: string;
  };
  export type FetchOutcome =
    | { ok: true; issues: NormalIssue[]; via: "gh" | "rest"; skippedPullRequests: number }
    | { ok: false; kind: "issues-disabled" | "not-found" | "unauthorized" | "other"; error: string };
  export function fetchIssues(repo: GithubRepo, opts: { state: "open" | "all"; limit: number }, deps?: FetchDeps): Promise<FetchOutcome>
  ```

- [x] **Step 1: Tulis test yang gagal** — tambahkan di `server/test/github-fetch.test.ts`

```ts
import { fetchIssues } from "../src/services/github-fetch";

const REPO = { owner: "denameidina", repo: "hanoman", slug: "denameidina/hanoman" };
const OPTS = { state: "open" as const, limit: 100 };

// stub `gh`: mengembalikan (code, stdout, stderr) yang persis diukur dari biner 2.96.0
const gh = (code: number, stdout = "", stderr = "") =>
  async () => ({ code, stdout, stderr });

describe("SPEC-471 · fetchIssues — pemilihan jalur", () => {
  it("gh sukses → dipakai, REST tak pernah disentuh", async () => {
    let httpCalls = 0;
    const r = await fetchIssues(REPO, OPTS, {
      runGh: gh(0, readFileSync(join(__dirname, "fixtures/github/gh-list.json"), "utf8")),
      httpGet: async () => { httpCalls++; return { status: 200, json: [] }; },
    });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.via).toBe("gh"); expect(r.issues.map((i) => i.number)).toEqual([9, 6]); }
    expect(httpCalls).toBe(0);
  });

  it("gh TAK ADA (ENOENT) → fallback REST", async () => {
    const rest = JSON.parse(readFileSync(join(__dirname, "fixtures/github/rest-issues.json"), "utf8"));
    const r = await fetchIssues(REPO, OPTS, {
      runGh: async () => { const e = new Error("spawn gh ENOENT") as NodeJS.ErrnoException; e.code = "ENOENT"; throw e; },
      httpGet: async (url) => url.endsWith("/hanoman")
        ? { status: 200, json: { has_issues: true } }
        : { status: 200, json: rest },
      token: "tok",
    });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.via).toBe("rest"); expect(r.skippedPullRequests).toBe(1); }
  });

  it("gh ada tapi TAK TERAUTENTIKASI → fallback REST", async () => {
    const r = await fetchIssues(REPO, OPTS, {
      runGh: gh(1, "", "gh auth login -h github.com"),
      httpGet: async (url) => url.endsWith("/hanoman")
        ? { status: 200, json: { has_issues: true } } : { status: 200, json: [] },
      token: "tok",
    });
    expect(r.ok && r.via).toBe("rest");
  });

  // INTI: gh menjawab "issues dimatikan" secara OTORITATIF. REST pada repo yang sama menjawab
  // 200 dengan 71 pull request. Fallback di sini akan memproduksi 71 backlog palsu.
  it("gh gagal OTORITATIF (issues dimatikan) → ERROR, BUKAN fallback", async () => {
    let httpCalls = 0;
    const r = await fetchIssues(REPO, OPTS, {
      runGh: gh(1, "", "the 'zamaludin/kirimchat-multi' repository has disabled issues"),
      httpGet: async () => { httpCalls++; return { status: 200, json: [] }; },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("issues-disabled");
    expect(httpCalls).toBe(0);
  });

  it("gh gagal repo tak ada → not-found, bukan fallback", async () => {
    const r = await fetchIssues(REPO, OPTS, {
      runGh: gh(1, "", "GraphQL: Could not resolve to a Repository with the name 'x/y'. (repository)"),
      httpGet: async () => { throw new Error("tak boleh dipanggil"); },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("not-found");
  });

  it("--limit diteruskan eksplisit (default gh cuma 30)", async () => {
    let seen: string[] = [];
    await fetchIssues(REPO, { state: "open", limit: 250 }, {
      runGh: async (args) => { seen = args; return { code: 0, stdout: "[]", stderr: "" }; },
    });
    expect(seen).toContain("--limit");
    expect(seen[seen.indexOf("--limit") + 1]).toBe("250");
    expect(seen).toContain("--repo");
    expect(seen[seen.indexOf("--repo") + 1]).toBe("denameidina/hanoman");
  });

  it("GITHUB_TOKEN diteruskan sebagai GH_TOKEN ke env gh", async () => {
    let env: NodeJS.ProcessEnv = {};
    await fetchIssues(REPO, OPTS, {
      runGh: async (_a, e) => { env = e; return { code: 0, stdout: "[]", stderr: "" }; },
      token: "ghp_rahasia",
    });
    expect(env.GH_TOKEN).toBe("ghp_rahasia");
  });
});

describe("SPEC-471 · fetchIssues — jalur REST", () => {
  // REST /issues menjawab 200 untuk repo yang issue-nya dimatikan (terukur: 71 item, semuanya PR).
  // Satu-satunya pembeda "dimatikan" vs "kosong" adalah has_issues di /repos/{slug}.
  it("has_issues:false → issues-disabled, endpoint issue tak pernah dipanggil", async () => {
    const seen: string[] = [];
    const r = await fetchIssues(REPO, OPTS, {
      runGh: async () => { const e = new Error("ENOENT") as NodeJS.ErrnoException; e.code = "ENOENT"; throw e; },
      httpGet: async (url) => { seen.push(url); return { status: 200, json: { has_issues: false } }; },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("issues-disabled");
    expect(seen.some((u) => u.includes("/issues"))).toBe(false);
  });

  it("HTTP 404 → not-found; HTTP 401 → unauthorized", async () => {
    const enoent = async () => { const e = new Error("ENOENT") as NodeJS.ErrnoException; e.code = "ENOENT"; throw e; };
    const r404 = await fetchIssues(REPO, OPTS, { runGh: enoent, httpGet: async () => ({ status: 404, json: {} }) });
    expect(!r404.ok && r404.kind).toBe("not-found");
    const r401 = await fetchIssues(REPO, OPTS, { runGh: enoent, httpGet: async () => ({ status: 401, json: {} }) });
    expect(!r401.ok && r401.kind).toBe("unauthorized");
  });

  it("tanpa token → tak mengirim header Authorization", async () => {
    const heads: Array<Record<string, string>> = [];
    await fetchIssues(REPO, OPTS, {
      runGh: async () => { const e = new Error("ENOENT") as NodeJS.ErrnoException; e.code = "ENOENT"; throw e; },
      httpGet: async (url, h) => { heads.push(h); return url.endsWith("/hanoman")
        ? { status: 200, json: { has_issues: true } } : { status: 200, json: [] }; },
    });
    expect(heads.every((h) => !("Authorization" in h))).toBe(true);
  });
});
```

- [x] **Step 2: Jalankan, pastikan MERAH**

Run: `./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/github-fetch.test.ts`
Expected: FAIL — `fetchIssues is not a function`

- [x] **Step 3: Implementasi minimal** — tambahkan ke `server/src/services/github-fetch.ts`

```ts
import { execFile } from "node:child_process";
import type { GithubRepo } from "./github-repo";
import { effectiveStr } from "../config";

export type FetchDeps = {
  runGh?: (args: string[], env: NodeJS.ProcessEnv) => Promise<{ code: number; stdout: string; stderr: string }>;
  httpGet?: (url: string, headers: Record<string, string>) => Promise<{ status: number; json: unknown }>;
  token?: string;
  ghBin?: string;
};
export type FetchOutcome =
  | { ok: true; issues: NormalIssue[]; via: "gh" | "rest"; skippedPullRequests: number }
  | { ok: false; kind: "issues-disabled" | "not-found" | "unauthorized" | "other"; error: string };

const GH_FIELDS = "number,title,body,author,labels,url,state,createdAt,updatedAt";
const API = "https://api.github.com";

const defaultRunGh: NonNullable<FetchDeps["runGh"]> = (args, env) =>
  new Promise((resolve, reject) => {
    execFile(args[0]!, args.slice(1), { env, maxBuffer: 1 << 26, encoding: "utf8", timeout: 60_000 },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { code?: string | number }) | null;
        if (e && (e.code === "ENOENT" || e.code === "EACCES")) return reject(e);
        resolve({ code: err ? Number((err as { code?: number }).code ?? 1) : 0, stdout, stderr });
      });
  });

const defaultHttpGet: NonNullable<FetchDeps["httpGet"]> = async (url, headers) => {
  const res = await fetch(url, { headers: { Accept: "application/vnd.github+json", "User-Agent": "hanoman", ...headers } });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
};

// Klasifikasi stderr `gh`. Terukur pada gh 2.96.0 — ketiganya exit 1, teksnya yang membedakan.
// `unauth` adalah SATU-SATUNYA kegagalan yang boleh jatuh ke REST: yang lain adalah jawaban
// otoritatif tentang repo-nya, dan REST akan menjawab hal yang BERBEDA (issues dimatikan →
// HTTP 200 + 71 pull request).
function classifyGhStderr(stderr: string): "unauth" | "issues-disabled" | "not-found" | "other" {
  const s = stderr.toLowerCase();
  if (s.includes("gh auth login") || s.includes("bad credentials") || s.includes("http 401")) return "unauth";
  if (s.includes("disabled issues")) return "issues-disabled";
  if (s.includes("could not resolve to a repository") || s.includes("http 404")) return "not-found";
  return "other";
}

async function viaGh(repo: GithubRepo, opts: { state: "open" | "all"; limit: number }, deps: FetchDeps):
  Promise<FetchOutcome | { fallback: true; reason: string }> {
  const bin = deps.ghBin ?? effectiveStr("HANOMAN_GH_BIN") ?? "gh";
  // `--limit` WAJIB eksplisit: default gh adalah 30 dan ia memotong tanpa peringatan apa pun.
  const args = [bin, "issue", "list", "--repo", repo.slug, "--state", opts.state,
    "--limit", String(opts.limit), "--json", GH_FIELDS];
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (deps.token) env.GH_TOKEN = deps.token;   // terukur: env token mengalahkan keyring
  let out: { code: number; stdout: string; stderr: string };
  try { out = await (deps.runGh ?? defaultRunGh)(args, env); }
  catch { return { fallback: true, reason: "gh tak terpasang" }; }
  if (out.code !== 0) {
    const kind = classifyGhStderr(out.stderr);
    if (kind === "unauth") return { fallback: true, reason: "gh tak terautentikasi" };
    return { ok: false, kind, error: out.stderr.trim() || `gh keluar dengan kode ${out.code}` };
  }
  let raw: GhRaw[];
  try { raw = JSON.parse(out.stdout || "[]") as GhRaw[]; }
  catch { return { ok: false, kind: "other", error: "keluaran gh bukan JSON" }; }
  return { ok: true, issues: raw.map(issueFromGh), via: "gh", skippedPullRequests: 0 };
}

async function viaRest(repo: GithubRepo, opts: { state: "open" | "all"; limit: number }, deps: FetchDeps):
  Promise<FetchOutcome> {
  const get = deps.httpGet ?? defaultHttpGet;
  const headers: Record<string, string> = {};
  if (deps.token) headers.Authorization = `Bearer ${deps.token}`;

  // Endpoint issue TIDAK bisa membedakan "issues dimatikan" dari "kosong" — ia menjawab 200
  // dengan daftar pull request. `has_issues` di /repos adalah satu-satunya pembeda jujur.
  const meta = await get(`${API}/repos/${repo.slug}`, headers);
  if (meta.status === 404) return { ok: false, kind: "not-found", error: `repo "${repo.slug}" tak ditemukan atau tak terjangkau` };
  if (meta.status === 401 || meta.status === 403)
    return { ok: false, kind: "unauthorized", error: "GitHub menolak kredensial — isi GITHUB_TOKEN di Settings" };
  if (meta.status !== 200) return { ok: false, kind: "other", error: `GitHub menjawab HTTP ${meta.status}` };
  if ((meta.json as { has_issues?: boolean } | null)?.has_issues === false)
    return { ok: false, kind: "issues-disabled", error: `repo "${repo.slug}" mematikan fitur issue` };

  const issues: NormalIssue[] = [];
  let skippedPullRequests = 0;
  for (let page = 1; issues.length < opts.limit && page <= 10; page++) {
    const per = Math.min(100, opts.limit - issues.length);
    const res = await get(`${API}/repos/${repo.slug}/issues?state=${opts.state}&per_page=${per}&page=${page}`, headers);
    if (res.status === 404) return { ok: false, kind: "not-found", error: `repo "${repo.slug}" tak ditemukan` };
    if (res.status === 401 || res.status === 403)
      return { ok: false, kind: "unauthorized", error: "GitHub menolak kredensial" };
    if (res.status !== 200) return { ok: false, kind: "other", error: `GitHub menjawab HTTP ${res.status}` };
    const batch = Array.isArray(res.json) ? (res.json as RestRaw[]) : [];
    if (batch.length === 0) break;
    const n = issuesFromRest(batch);
    issues.push(...n.issues);
    skippedPullRequests += n.skippedPullRequests;
    if (batch.length < per) break;
  }
  return { ok: true, issues: issues.slice(0, opts.limit), via: "rest", skippedPullRequests };
}

export async function fetchIssues(
  repo: GithubRepo, opts: { state: "open" | "all"; limit: number }, deps: FetchDeps = {},
): Promise<FetchOutcome> {
  const token = deps.token ?? effectiveStr("GITHUB_TOKEN") ?? undefined;
  const first = await viaGh(repo, opts, { ...deps, token });
  if (!("fallback" in first)) return first;
  return viaRest(repo, opts, { ...deps, token });
}
```

- [x] **Step 4: Jalankan, pastikan HIJAU**

Run: `./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/github-fetch.test.ts`
Expected: PASS — 15 test (5 dari Task 3 + 10 baru)

- [x] **Step 5: Commit**

```bash
git add server/src/services/github-fetch.ts server/test/github-fetch.test.ts
git commit -m "feat(471): fetchIssues gh→REST; kegagalan gh yang otoritatif TIDAK di-fallback"
```

---

### Task 5: Model `GithubIssue` + migration + `pullIssues` idempoten

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260801170000_github_issue/migration.sql`
- Create: `server/src/services/github-issues.ts`
- Create: `server/test/github-pull.test.ts`

**Interfaces:**
- Consumes: `resolveGithubRepo` (Task 2), `fetchIssues` + `FetchDeps` (Task 4), `notifySynced`
- Produces:
  ```ts
  export function issueRowId(projectId: string, slug: string, number: number): string   // "<projectId>:<slug>#<n>"
  export type PullResult =
    | { ok: true; repo: string; pulled: number; created: number; updated: number; via: "gh" | "rest"; skippedPullRequests: number }
    | { ok: false; kind: string; error: string };
  export function pullIssues(projectId: string, opts?: { state?: "open" | "all"; limit?: number }, deps?: FetchDeps): Promise<PullResult>
  ```

- [x] **Step 1: Tambahkan model ke schema**

`server/prisma/schema.prisma` — sesudah `model CustomAgent`:

```prisma
// SPEC-471 · ADR-0095 · cermin issue GitHub sebagai record lokal, pola Ticket (ADR-0062).
// `id` DETERMINISTIK "<projectId>:<owner>/<repo>#<number>" ditulis aplikasi, bukan default DB —
// alasan yang sama dengan CustomAgent (ADR-0094): dua mesin yang menarik repo yang sama harus
// bertemu sebagai SATU baris di changefeed, bukan dua yang saling menelan.
// `specId` sengaja TANPA FK (cermin Ticket.specId) — menghindari feed yang memancarkan anak
// sebelum induk (SPEC-382).
model GithubIssue {
  id             String   @id
  projectId      String
  repoSlug       String   // "owner/repo"
  number         Int
  title          String
  body           String
  authorLogin    String
  labels         Json     // string[]
  url            String
  issueState     String   // open | closed — keadaan DI GITHUB saat ditarik
  status         String   @default("new") // new | accepted | rejected (zGithubIssueStatus)
  specId         String?  // soft-link Spec hasil promosi
  issueCreatedAt DateTime
  issueUpdatedAt DateTime
  pulledAt       DateTime
  version        Int      @default(0) // SPEC-471 · version-stamp sync (ADR-0045)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  project        Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId, status])
}
```

Dan tambahkan relasinya di `model Project`, sebaris di bawah `customAgents`:

```prisma
  githubIssues GithubIssue[] // SPEC-471 · ADR-0095 · cermin issue repo project ini
```

- [x] **Step 2: Tulis migration TANGAN**

`server/prisma/migrations/20260801170000_github_issue/migration.sql`:

```sql
-- SPEC-471 · ADR-0095 · cermin issue GitHub sebagai record lokal (pola Ticket, ADR-0062).
--
-- Tabel baru → `CREATE TABLE` polos; tak ada redefinisi tabel.
-- `id` deterministik "<projectId>:<owner>/<repo>#<number>" ditulis aplikasi, bukan default DB —
-- itulah yang mencegah dua mesin melahirkan dua baris untuk issue yang sama.
-- `specId` sengaja TANPA FOREIGN KEY, cermin Ticket.specId: changefeed bisa memancarkan
-- GithubIssue sebelum Spec-nya mendarat (kelas SPEC-382), dan FK akan menolaknya.
CREATE TABLE "GithubIssue" (
    "id"             TEXT NOT NULL PRIMARY KEY,
    "projectId"      TEXT NOT NULL,
    "repoSlug"       TEXT NOT NULL,
    "number"         INTEGER NOT NULL,
    "title"          TEXT NOT NULL,
    "body"           TEXT NOT NULL,
    "authorLogin"    TEXT NOT NULL,
    "labels"         JSONB NOT NULL,
    "url"            TEXT NOT NULL,
    "issueState"     TEXT NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'new',
    "specId"         TEXT,
    "issueCreatedAt" DATETIME NOT NULL,
    "issueUpdatedAt" DATETIME NOT NULL,
    "pulledAt"       DATETIME NOT NULL,
    "version"        INTEGER NOT NULL DEFAULT 0,
    "createdAt"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      DATETIME NOT NULL,
    CONSTRAINT "GithubIssue_projectId_fkey" FOREIGN KEY ("projectId")
        REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "GithubIssue_projectId_status_idx" ON "GithubIssue" ("projectId", "status");
```

- [x] **Step 3: Terapkan migration + regenerate client**

```bash
pnpm --filter ./server exec prisma migrate deploy
pnpm --filter ./server exec prisma generate
```

Expected: `1 migration found` … `Applied`. **Jangan** `migrate dev` — ia me-reset DB saat ada drift worktree tetangga.

- [x] **Step 4: Tulis test yang gagal**

`server/test/github-pull.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { issueRowId, pullIssues } from "../src/services/github-issues";

const ISSUES = [
  { number: 9, title: "Judul lama", body: "isi lama", authorLogin: "wulanrlestari", labels: [],
    url: "https://github.com/denameidina/hanoman/issues/9", issueState: "open" as const,
    issueCreatedAt: "2026-07-30T11:57:43Z", issueUpdatedAt: "2026-07-30T11:57:43Z" },
  { number: 6, title: "Issue kedua", body: "isi", authorLogin: "RamaAditya49", labels: ["bug"],
    url: "https://github.com/denameidina/hanoman/issues/6", issueState: "open" as const,
    issueCreatedAt: "2026-07-30T11:46:25Z", issueUpdatedAt: "2026-07-30T11:46:25Z" },
];
// deps yang mengembalikan fixture di atas lewat jalur gh, tanpa jaringan sama sekali
const deps = (issues = ISSUES) => ({
  runGh: async () => ({
    code: 0,
    stdout: JSON.stringify(issues.map((i) => ({
      number: i.number, title: i.title, body: i.body, author: { login: i.authorLogin },
      labels: i.labels.map((n) => ({ name: n })), url: i.url,
      state: i.issueState.toUpperCase(), createdAt: i.issueCreatedAt, updatedAt: i.issueUpdatedAt,
    }))),
    stderr: "",
  }),
  httpGet: async () => { throw new Error("REST tak boleh dipanggil saat gh sukses"); },
});

const clean = async () => {
  await prisma.githubIssue.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};

beforeAll(async () => { await clean(); });
beforeEach(async () => {
  await prisma.githubIssue.deleteMany();
  await prisma.project.deleteMany();
  await prisma.project.create({ data: { id: "pull-p", name: "P", desc: "", kind: "existing",
    gitRemote: "https://github.com/denameidina/hanoman" } });
});
afterAll(async () => { await clean(); });

describe("SPEC-471 · pullIssues", () => {
  it("tarikan pertama membuat satu baris per issue, id deterministik", async () => {
    const r = await pullIssues("pull-p", {}, deps());
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.created).toBe(2); expect(r.updated).toBe(0); expect(r.repo).toBe("denameidina/hanoman"); }
    const row = await prisma.githubIssue.findUnique({ where: { id: issueRowId("pull-p", "denameidina/hanoman", 9) } });
    expect(row?.id).toBe("pull-p:denameidina/hanoman#9");
    expect(row?.status).toBe("new");
    expect(row?.specId).toBeNull();
    expect(row?.labels).toEqual([]);
  });

  it("tarik dua kali → tetap 2 baris, bukan 4", async () => {
    await pullIssues("pull-p", {}, deps());
    const r = await pullIssues("pull-p", {}, deps());
    expect(r.ok && r.created).toBe(0);
    expect(r.ok && r.updated).toBe(2);
    expect(await prisma.githubIssue.count()).toBe(2);
  });

  // Jaminan idempotensi yang sesungguhnya: tanpa ini, issue yang sudah diterima kembali
  // berstatus `new` dan accept berikutnya melahirkan Spec KEDUA untuk issue yang sama.
  it("tarik ulang TIDAK me-reset status/specId yang sudah ditriase", async () => {
    await pullIssues("pull-p", {}, deps());
    const id = issueRowId("pull-p", "denameidina/hanoman", 9);
    await prisma.githubIssue.update({ where: { id }, data: { status: "accepted", specId: "SPEC-999" } });
    await prisma.githubIssue.update({
      where: { id: issueRowId("pull-p", "denameidina/hanoman", 6) }, data: { status: "rejected" } });

    await pullIssues("pull-p", {}, deps([{ ...ISSUES[0]!, title: "Judul BARU", body: "isi baru" }, ISSUES[1]!]));

    const a = await prisma.githubIssue.findUnique({ where: { id } });
    expect(a?.status).toBe("accepted");
    expect(a?.specId).toBe("SPEC-999");
    expect(a?.title).toBe("Judul BARU");     // konten tetap disegarkan
    expect(a?.body).toBe("isi baru");
    const b = await prisma.githubIssue.findUnique({ where: { id: issueRowId("pull-p", "denameidina/hanoman", 6) } });
    expect(b?.status).toBe("rejected");
  });

  it("project tanpa remote GitHub → ok:false, tak ada baris lahir", async () => {
    await prisma.project.create({ data: { id: "pull-x", name: "X", desc: "", kind: "existing" } });
    const r = await pullIssues("pull-x", {}, deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("no-remote");
    expect(await prisma.githubIssue.count({ where: { projectId: "pull-x" } })).toBe(0);
  });

  it("gagal ambil (issues dimatikan) → ok:false, tak ada baris lahir", async () => {
    const r = await pullIssues("pull-p", {}, {
      runGh: async () => ({ code: 1, stdout: "", stderr: "the 'x/y' repository has disabled issues" }),
      httpGet: async () => { throw new Error("tak boleh dipanggil"); },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("issues-disabled");
    expect(await prisma.githubIssue.count()).toBe(0);
  });
});
```

- [x] **Step 5: Jalankan, pastikan MERAH**

Run: `./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/github-pull.test.ts`
Expected: FAIL — `Cannot find module '../src/services/github-issues'`

- [x] **Step 6: Implementasi minimal**

`server/src/services/github-issues.ts`:

```ts
import { prisma } from "../db";
import { resolveGithubRepo } from "./github-repo";
import { fetchIssues, type FetchDeps } from "./github-fetch";
import { notifySynced } from "./sync-notify";

// SPEC-471 · ADR-0095 · menarik issue → baris GithubIssue. Idempotensi hidup di DUA tempat:
// (1) id deterministik — issue yang sama selalu baris yang sama, di mesin mana pun;
// (2) `update` yang TAK PERNAH menyentuh `status`/`specId` — tanpa itu issue yang sudah
//     diterima kembali `new` dan accept berikutnya melahirkan Spec kedua.
export const issueRowId = (projectId: string, slug: string, number: number): string =>
  `${projectId}:${slug}#${number}`;

export type PullResult =
  | { ok: true; repo: string; pulled: number; created: number; updated: number;
      via: "gh" | "rest"; skippedPullRequests: number }
  | { ok: false; kind: string; error: string };

export async function pullIssues(
  projectId: string,
  opts: { state?: "open" | "all"; limit?: number } = {},
  deps: FetchDeps = {},
): Promise<PullResult> {
  const resolved = await resolveGithubRepo(projectId);
  if (!resolved.ok) return { ok: false, kind: resolved.kind, error: resolved.error };

  const state = opts.state ?? "open";
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  const got = await fetchIssues(resolved.repo, { state, limit }, deps);
  if (!got.ok) return { ok: false, kind: got.kind, error: got.error };

  const slug = resolved.repo.slug;
  const now = new Date();
  let created = 0, updated = 0;
  for (const i of got.issues) {
    const id = issueRowId(projectId, slug, i.number);
    const exists = await prisma.githubIssue.findUnique({ where: { id }, select: { id: true } });
    // `status` & `specId` SENGAJA absen dari `update` — keputusan triase milik operator,
    // bukan milik GitHub. Lihat komentar di kepala berkas.
    const fresh = {
      title: i.title, body: i.body, authorLogin: i.authorLogin, labels: i.labels, url: i.url,
      issueState: i.issueState,
      issueCreatedAt: new Date(i.issueCreatedAt), issueUpdatedAt: new Date(i.issueUpdatedAt),
      pulledAt: now,
    };
    await prisma.githubIssue.upsert({
      where: { id },
      create: { id, projectId, repoSlug: slug, number: i.number, status: "new", specId: null, ...fresh },
      update: fresh,
    });
    if (exists) updated++; else created++;
    await notifySynced("githubIssue", id);
  }
  return { ok: true, repo: slug, pulled: got.issues.length, created, updated,
    via: got.via, skippedPullRequests: got.skippedPullRequests };
}
```

- [x] **Step 7: Jalankan, pastikan HIJAU**

Run: `./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/github-pull.test.ts`
Expected: PASS — 5 test

- [x] **Step 8: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260801170000_github_issue \
        server/src/services/github-issues.ts server/test/github-pull.test.ts
git commit -m "feat(471): model GithubIssue + migration + pullIssues idempoten (status/specId tak pernah ter-reset)"
```

---

### Task 6: Entitas sync `githubIssue`

**Files:**
- Modify: `server/src/services/sync.ts`
- Create: `server/test/github-sync.test.ts`

**Interfaces:**
- Consumes: `SYNCED`, `FIELDS`, `DATE_FIELDS`, `DELEGATE` di `services/sync.ts`
- Produces: entitas `"githubIssue"` terdaftar penuh

- [x] **Step 1: Tulis test yang gagal**

`server/test/github-sync.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SYNCED } from "../src/services/sync";

// Kolom bermakna GithubIssue — `id` (PK, di where) & `version` (stempel mekanisme) dikecualikan.
const MEANINGFUL = [
  "projectId", "repoSlug", "number", "title", "body", "authorLogin", "labels", "url",
  "issueState", "status", "specId", "issueCreatedAt", "issueUpdatedAt", "pulledAt",
  "createdAt", "updatedAt",
];

describe("SPEC-471 · githubIssue ikut record-sync", () => {
  it("terdaftar di SYNCED", () => {
    expect(SYNCED).toContain("githubIssue");
  });
  // Kelas ADR-0090/0093/0094: `upsert` yang melewatkan kolom ber-default TETAP berhasil, jadi
  // kolom yang terlupa mendarat sebagai default palsu di tiap client TANPA satu pun error.
  it("FIELDS memuat SETIAP kolom bermakna, dan tak memuat version", async () => {
    const mod = await import("../src/services/sync") as unknown as { __FIELDS?: Record<string, string[]> };
    const fields = mod.__FIELDS?.githubIssue;
    expect(fields).toBeDefined();
    for (const f of MEANINGFUL) expect(fields).toContain(f);
    expect(fields).not.toContain("version");
    expect(fields).not.toContain("id");
  });
  it("DATE_FIELDS memuat semua kolom DateTime", async () => {
    const mod = await import("../src/services/sync") as unknown as { __DATE_FIELDS?: Record<string, string[]> };
    expect(mod.__DATE_FIELDS?.githubIssue).toEqual(
      expect.arrayContaining(["issueCreatedAt", "issueUpdatedAt", "pulledAt", "createdAt", "updatedAt"]));
  });
});
```

- [x] **Step 2: Jalankan, pastikan MERAH**

Run: `./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/github-sync.test.ts`
Expected: FAIL — `expected [...] to contain 'githubIssue'`

- [x] **Step 3: Implementasi minimal** — di `server/src/services/sync.ts`

1. Perluas `SYNCED` (tambahkan komentar di atasnya, sejajar catatan `customAgent`):

```ts
// SPEC-471 · ADR-0095 · `githubIssue` ikut menyeberang: cermin issue adalah pengetahuan
// bersama tim, bukan setelan mesin. Id-nya deterministik ("<projectId>:<slug>#<n>") justru
// supaya dua mesin yang menarik repo yang sama bertemu sebagai SATU baris di sini.
export const SYNCED = ["project", "spec", "vps", "sessionResult", "ticket", "ticketAttachment", "customAgent", "githubIssue"] as const;
```

2. `DELEGATE` — tambahkan baris:

```ts
  githubIssue: prisma.githubIssue as unknown as Delegate,
```

3. `FIELDS` — tambahkan entri:

```ts
  // SPEC-471 · ADR-0095 · SELURUH kolom bermakna ikut. `status`/`specId` termasuk: keputusan
  // triase adalah bagian keadaan yang harus dilihat sama oleh semua mesin — tanpa itu satu
  // mesin bisa menerima ulang issue yang di mesin lain sudah jadi backlog.
  githubIssue: ["projectId", "repoSlug", "number", "title", "body", "authorLogin", "labels", "url",
    "issueState", "status", "specId", "issueCreatedAt", "issueUpdatedAt", "pulledAt", "createdAt", "updatedAt"],
```

4. `DATE_FIELDS` — tambahkan entri:

```ts
  githubIssue: ["issueCreatedAt", "issueUpdatedAt", "pulledAt", "createdAt", "updatedAt"],
```

5. Buka `FIELDS`/`DATE_FIELDS` untuk test (di bawah definisinya, sejajar pola ekspor test-only lain):

```ts
// Ekspor test-only: kontrak "setiap kolom bermakna ikut" hanya bisa diuji dari luar bila
// petanya terlihat. Bukan API publik — tak ada kode produksi yang mengimpornya.
export const __FIELDS = FIELDS;
export const __DATE_FIELDS = DATE_FIELDS;
```

- [x] **Step 4: Jalankan, pastikan HIJAU**

Run: `./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/github-sync.test.ts server/test/sync.test.ts`
Expected: PASS — 3 test baru + test sync lama tetap hijau

- [x] **Step 5: Commit**

```bash
git add server/src/services/sync.ts server/test/github-sync.test.ts
git commit -m "feat(471): githubIssue masuk record-sync (FIELDS memuat status & specId)"
```

---

### Task 7: Jembatan `acceptGithubIssue` — issue → `Spec`

Call site `prisma.spec.create` **keempat** di seluruh server. Cermin `services/ticket-accept.ts`.

**Files:**
- Create: `server/src/services/github-accept.ts`
- Create: `server/test/github-accept.test.ts`

**Interfaces:**
- Consumes: `nextSpecId` (`services/id.ts`), `resolveRepoDir` (`services/local-binding.ts`), `sourceForLabels` (Task 1), `notifySynced`
- Produces: `acceptGithubIssue(issue: GithubIssue, opts: { author: string; priority?: string; source?: "qa" | "brief" | "audit" }): Promise<{ spec: Spec; created: boolean }>`

- [x] **Step 1: Tulis test yang gagal**

`server/test/github-accept.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { zCreateSpec } from "@hanoman/shared";
import { acceptGithubIssue } from "../src/services/github-accept";

const mkIssue = async (over: Partial<{ number: number; labels: string[]; title: string; body: string }> = {}) => {
  const number = over.number ?? 9;
  return prisma.githubIssue.create({
    data: {
      id: `acc-p:denameidina/hanoman#${number}`, projectId: "acc-p",
      repoSlug: "denameidina/hanoman", number,
      title: over.title ?? "History purge deletes transcript files before DB commit",
      body: over.body ?? "## Severity\nMajor\n\nLangkah reproduksi …",
      authorLogin: "wulanrlestari", labels: over.labels ?? [],
      url: `https://github.com/denameidina/hanoman/issues/${number}`,
      issueState: "open", status: "new", specId: null,
      issueCreatedAt: new Date("2026-07-30T11:57:43Z"),
      issueUpdatedAt: new Date("2026-07-30T11:57:43Z"),
      pulledAt: new Date("2026-08-01T00:00:00Z"),
    },
  });
};

const clean = async () => {
  await prisma.githubIssue.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};
beforeAll(clean);
beforeEach(async () => {
  await prisma.githubIssue.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
  await prisma.project.create({ data: { id: "acc-p", name: "P", desc: "", kind: "existing",
    gitRemote: "https://github.com/denameidina/hanoman" } });
});
afterAll(clean);

describe("SPEC-471 · acceptGithubIssue", () => {
  it("issue tanpa label → source qa, payload qa-shaped, backlink issue ada", async () => {
    const issue = await mkIssue();
    const { spec, created } = await acceptGithubIssue(issue, { author: "dena@x.co" });
    expect(created).toBe(true);
    expect(spec.source).toBe("qa");
    expect(spec.author).toBe("GitHub · dena@x.co");
    const p = spec.payload as { severity: string; actual: string };
    expect(p.severity).toBe("major");
    expect(p.actual).toContain("Langkah reproduksi");
    expect(p.actual).toContain("denameidina/hanoman#9");
    expect(p.actual).toContain("https://github.com/denameidina/hanoman/issues/9");
    expect(spec.objective).toContain("denameidina/hanoman#9");
  });

  it("label enhancement → source brief, payload brief-shaped", async () => {
    const issue = await mkIssue({ number: 5, labels: ["enhancement"] });
    const { spec } = await acceptGithubIssue(issue, { author: "dena@x.co" });
    expect(spec.source).toBe("brief");
    expect(spec.payload as Record<string, unknown>).toHaveProperty("context");
    expect(spec.payload as Record<string, unknown>).not.toHaveProperty("severity");
  });

  it("override source oleh operator menang atas label", async () => {
    const issue = await mkIssue({ number: 4, labels: ["bug"] });
    const { spec } = await acceptGithubIssue(issue, { author: "d@x.co", source: "brief" });
    expect(spec.source).toBe("brief");
    expect(spec.payload as Record<string, unknown>).toHaveProperty("context");
  });

  // Bentuk payload diikat ke source oleh zCreateSpec.superRefine (kelas jebakan SPEC-197).
  it("payload yang dihasilkan LOLOS zCreateSpec untuk source-nya", async () => {
    for (const [n, labels] of [[9, []], [8, ["enhancement"]], [7, ["question"]]] as const) {
      const issue = await mkIssue({ number: n, labels: [...labels] });
      const { spec } = await acceptGithubIssue(issue, { author: "d@x.co" });
      const parsed = zCreateSpec.safeParse({
        project: spec.projectId, source: spec.source, title: spec.title,
        priority: spec.priority, payload: spec.payload,
      });
      expect(parsed.success, `source ${spec.source} payload ditolak`).toBe(true);
    }
  });

  it("accept dua kali → SATU Spec, created:false di panggilan kedua", async () => {
    const issue = await mkIssue();
    const first = await acceptGithubIssue(issue, { author: "d@x.co" });
    const again = await prisma.githubIssue.findUnique({ where: { id: issue.id } });
    const second = await acceptGithubIssue(again!, { author: "d@x.co" });
    expect(second.created).toBe(false);
    expect(second.spec.id).toBe(first.spec.id);
    expect(await prisma.spec.count()).toBe(1);
  });

  it("menandai issue accepted + menautkan specId dua arah", async () => {
    const issue = await mkIssue();
    const { spec } = await acceptGithubIssue(issue, { author: "d@x.co" });
    const row = await prisma.githubIssue.findUnique({ where: { id: issue.id } });
    expect(row?.status).toBe("accepted");
    expect(row?.specId).toBe(spec.id);
  });

  it("prioritas manual dipakai untuk source non-qa", async () => {
    const issue = await mkIssue({ number: 3, labels: ["enhancement"] });
    const { spec } = await acceptGithubIssue(issue, { author: "d@x.co", priority: "rendah" });
    expect(spec.priority).toBe("rendah");
  });
});
```

- [x] **Step 2: Jalankan, pastikan MERAH**

Run: `./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/github-accept.test.ts`
Expected: FAIL — `Cannot find module '../src/services/github-accept'`

- [x] **Step 3: Implementasi minimal**

`server/src/services/github-accept.ts`:

```ts
import { sourceForLabels } from "@hanoman/shared";
import type { GithubIssue, Spec } from "@prisma/client";
import { prisma } from "../db";
import { nextSpecId } from "./id";
import { resolveRepoDir } from "./local-binding";
import { notifySynced } from "./sync-notify";

// SPEC-471 · ADR-0095 · jembatan issue GitHub → backlog item. Cermin services/ticket-accept.ts
// (ADR-0062): idempoten lewat back-pointer, pemetaan asal → source, retry P2002 di sekitar
// nextSpecId. Ini call site prisma.spec.create KEEMPAT di server — ketiganya yang lain adalah
// POST /specs, POST /specs/batch, dan acceptTicket.

const backlinkOf = (i: GithubIssue) => `Dari GitHub issue ${i.repoSlug}#${i.number} (${i.url}).`;

export async function acceptGithubIssue(
  issue: GithubIssue,
  opts: { author: string; priority?: string; source?: "qa" | "brief" | "audit" },
): Promise<{ spec: Spec; created: boolean }> {
  // Idempoten: issue yang sudah tertaut mengembalikan Spec-nya, tak pernah membuat yang kedua.
  if (issue.specId) {
    const spec = await prisma.spec.findUnique({ where: { id: issue.specId } });
    if (spec) return { spec, created: false };
  }
  const labels = Array.isArray(issue.labels) ? (issue.labels as string[]) : [];
  const source = opts.source ?? sourceForLabels(labels);
  const priority = opts.priority ?? "sedang";
  const backlink = backlinkOf(issue);
  const detail = `${issue.body}\n\nPelapor: @${issue.authorLogin}\n`
    + `Label: ${labels.length ? labels.join(", ") : "(tanpa label)"}\n${backlink}`;

  // Bentuk payload WAJIB cocok dengan source — zCreateSpec.superRefine menuntutnya (SPEC-197).
  const payload = source === "qa"
    ? { severity: "major" as const,
        steps: "Reproduksi dari deskripsi issue.",
        expected: "Perilaku yang diharapkan pelapor issue.",
        actual: detail, env: "" }
    : { context: detail, outcome: "", constraints: "" };

  const repoDir = await resolveRepoDir(issue.projectId).catch(() => null);
  // SPEC-197 · nextSpecId TOCTOU → retry P2002 (≤3), bukan 500. Cermin ketiga call site lain.
  let spec: Spec | null = null;
  for (let attempt = 0; attempt < 3 && !spec; attempt++) {
    const sid = await nextSpecId(repoDir);
    try {
      spec = await prisma.spec.create({
        data: {
          id: sid, projectId: issue.projectId, title: issue.title, source,
          stage: "brainstorming", priority, author: `GitHub · ${opts.author}`,
          objective: source === "qa"
            ? `${issue.title}. ${backlink}`
            : `${issue.title}. ${backlink}`,
          payload,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002" && attempt < 2) continue;
      throw e;
    }
  }
  await prisma.githubIssue.update({
    where: { id: issue.id }, data: { status: "accepted", specId: spec!.id } });
  await notifySynced("spec", spec!.id);
  await notifySynced("githubIssue", issue.id);
  return { spec: spec!, created: true };
}
```

- [x] **Step 4: Jalankan, pastikan HIJAU**

Run: `./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/github-accept.test.ts`
Expected: PASS — 7 test

- [x] **Step 5: Commit**

```bash
git add server/src/services/github-accept.ts server/test/github-accept.test.ts
git commit -m "feat(471): jembatan issue GitHub → Spec, idempoten lewat back-pointer specId"
```

---

### Task 8: Endpoint + gerbang capability

**Files:**
- Create: `server/src/routes/github-issues.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/services/agent-capabilities.ts`
- Create: `server/test/github-routes.test.ts`
- Modify: `server/test/agent-capabilities.test.ts`

**Interfaces:**
- Consumes: `pullIssues` (Task 5), `acceptGithubIssue` (Task 7), `resolveGithubRepo` (Task 2)
- Produces: enam endpoint di bawah prefix `/api`

- [x] **Step 1: Tulis test yang gagal**

`server/test/github-routes.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

// Jalur jaringan disuntik lewat mock modul — tak ada test yang memukul api.github.com.
vi.mock("../src/services/github-fetch", async (orig) => {
  const real = await orig<typeof import("../src/services/github-fetch")>();
  return { ...real, fetchIssues: vi.fn(async () => ({
    ok: true as const, via: "gh" as const, skippedPullRequests: 2,
    issues: [{ number: 9, title: "Issue sembilan", body: "isi", authorLogin: "wulanrlestari",
      labels: [], url: "https://github.com/denameidina/hanoman/issues/9", issueState: "open" as const,
      issueCreatedAt: "2026-07-30T11:57:43Z", issueUpdatedAt: "2026-07-30T11:57:43Z" }],
  })) };
});

const app = buildApp({ requireAuth: false });
const clean = async () => {
  await prisma.githubIssue.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};

beforeAll(async () => { await app.ready(); await clean(); });
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "r-p", name: "P", desc: "", kind: "existing",
    gitRemote: "https://github.com/denameidina/hanoman" } });
  await prisma.project.create({ data: { id: "r-none", name: "N", desc: "", kind: "existing" } });
});
afterAll(async () => { await clean(); await app.close(); });

const pull = (p = "r-p") => app.inject({ method: "POST", url: `/api/projects/${p}/github/pull`, payload: {} });

describe("SPEC-471 · endpoint tarik & triase issue", () => {
  it("POST pull → 200 dengan ringkasan, termasuk skippedPullRequests", async () => {
    const res = await pull();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ repo: "denameidina/hanoman", pulled: 1, created: 1, updated: 0, skippedPullRequests: 2 });
  });

  it("POST pull pada project tanpa remote → 400 dengan sebab yang bisa dibaca", async () => {
    const res = await pull("r-none");
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("remote GitHub");
  });

  it("POST pull project tak dikenal → 404", async () => {
    expect((await pull("tidak-ada")).statusCode).toBe(404);
  });

  it("GET daftar issue, bisa difilter status", async () => {
    await pull();
    const all = await app.inject({ method: "GET", url: "/api/projects/r-p/github/issues" });
    expect(all.statusCode).toBe(200);
    expect(all.json().items).toHaveLength(1);
    expect(all.json().items[0]).toMatchObject({ number: 9, status: "new", specId: null });
    const none = await app.inject({ method: "GET", url: "/api/projects/r-p/github/issues?status=accepted" });
    expect(none.json().items).toHaveLength(0);
  });

  it("POST accept satu → 201 + Spec, accept ulang → 200 alreadyPromoted", async () => {
    await pull();
    const id = "r-p:denameidina/hanoman#9";
    const first = await app.inject({ method: "POST", url: `/api/github-issues/${encodeURIComponent(id)}/accept`, payload: {} });
    expect(first.statusCode).toBe(201);
    expect(first.json().spec.source).toBe("qa");
    const second = await app.inject({ method: "POST", url: `/api/github-issues/${encodeURIComponent(id)}/accept`, payload: {} });
    expect(second.statusCode).toBe(200);
    expect(second.json().alreadyPromoted).toBe(true);
    expect(await prisma.spec.count()).toBe(1);
  });

  it("POST accept massal → satu Spec per issue", async () => {
    await pull();
    await prisma.githubIssue.create({ data: {
      id: "r-p:denameidina/hanoman#6", projectId: "r-p", repoSlug: "denameidina/hanoman", number: 6,
      title: "Enam", body: "b", authorLogin: "a", labels: [], url: "u", issueState: "open",
      issueCreatedAt: new Date(), issueUpdatedAt: new Date(), pulledAt: new Date() } });
    const res = await app.inject({ method: "POST", url: "/api/github-issues/accept",
      payload: { ids: ["r-p:denameidina/hanoman#9", "r-p:denameidina/hanoman#6"] } });
    expect(res.statusCode).toBe(201);
    expect(res.json().created).toHaveLength(2);
    expect(await prisma.spec.count()).toBe(2);
  });

  it("POST reject → status rejected", async () => {
    await pull();
    const res = await app.inject({ method: "POST", url: "/api/github-issues/r-p%3Adenameidina%2Fhanoman%239/reject", payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("rejected");
  });

  it("POST unlink → specId lepas, status kembali new", async () => {
    await pull();
    const id = "r-p:denameidina/hanoman#9";
    await app.inject({ method: "POST", url: `/api/github-issues/${encodeURIComponent(id)}/accept`, payload: {} });
    const res = await app.inject({ method: "POST", url: `/api/github-issues/${encodeURIComponent(id)}/unlink`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "new", specId: null });
  });

  it("issue tak dikenal → 404", async () => {
    expect((await app.inject({ method: "POST", url: "/api/github-issues/tidak-ada/accept", payload: {} })).statusCode).toBe(404);
  });
});
```

Tambahkan ke `server/test/agent-capabilities.test.ts`:

```ts
  // SPEC-471 · ADR-0095 · triase issue satu domain dengan tiket; dipetakan MENURUT METHOD
  // (kelas bug SPEC-405: prefix status yang lolos GLOBAL_READ tanpa melihat method).
  it("SPEC-471 · github-issues & projects/:id/github → domain support per-method", () => {
    expect(capabilityForRoute("GET", "/api/projects/p/github/issues")).toBe("support:read");
    expect(capabilityForRoute("POST", "/api/projects/p/github/pull")).toBe("support:write");
    expect(capabilityForRoute("GET", "/api/github-issues")).toBe("support:read");
    expect(capabilityForRoute("POST", "/api/github-issues/x/accept")).toBe("support:write");
  });
```

- [x] **Step 2: Jalankan, pastikan MERAH**

Run: `./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/github-routes.test.ts server/test/agent-capabilities.test.ts`
Expected: FAIL — 404 untuk semua route baru; `capabilityForRoute` mengembalikan `projects:read`

- [x] **Step 3: Implementasi route**

`server/src/routes/github-issues.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { pullIssues } from "../services/github-issues";
import { acceptGithubIssue } from "../services/github-accept";
import { notifySynced } from "../services/sync-notify";

// SPEC-471 · ADR-0095 · permukaan HTTP tarik & triase issue GitHub. Cermin routes/tickets.ts.
// hanoman TIDAK PERNAH menulis ke GitHub (keputusan 3): tak ada endpoint komentar/close.

const zPull = z.object({
  state: z.enum(["open", "all"]).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
}).default({});
const zAccept = z.object({
  priority: z.enum(["tinggi", "sedang", "rendah"]).optional(),
  source: z.enum(["qa", "brief", "audit"]).optional(),
}).default({});
const zAcceptMany = zAccept.extend({ ids: z.array(z.string().min(1)).min(1).max(100) });

// Kegagalan resolusi/ambil dipetakan ke status yang membedakan "salah konfigurasi project"
// (400 — operator bisa memperbaikinya) dari "tak ada di GitHub" (404).
const STATUS: Record<string, number> = {
  "no-project": 404, "not-found": 404,
  "no-remote": 400, "not-github": 400, "issues-disabled": 400,
  unauthorized: 401, other: 502,
};

const view = (i: Awaited<ReturnType<typeof prisma.githubIssue.findFirst>> & object) => ({
  id: i.id, projectId: i.projectId, repoSlug: i.repoSlug, number: i.number,
  title: i.title, body: i.body, authorLogin: i.authorLogin,
  labels: Array.isArray(i.labels) ? i.labels : [],
  url: i.url, issueState: i.issueState, status: i.status, specId: i.specId,
  issueCreatedAt: i.issueCreatedAt.toISOString(),
  issueUpdatedAt: i.issueUpdatedAt.toISOString(),
  pulledAt: i.pulledAt.toISOString(),
});

export default async function githubIssues(app: FastifyInstance): Promise<void> {
  app.post("/projects/:id/github/pull", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zPull.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const r = await pullIssues(id, parsed.data);
    if (!r.ok) return reply.code(STATUS[r.kind] ?? 400).send({ error: r.error });
    return reply.code(200).send(r);
  });

  app.get("/projects/:id/github/issues", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { status } = req.query as { status?: string };
    const project = await prisma.project.findUnique({ where: { id }, select: { id: true } });
    if (!project) return reply.code(404).send({ error: "not found" });
    const items = await prisma.githubIssue.findMany({
      where: { projectId: id, ...(status ? { status } : {}) },
      orderBy: [{ number: "desc" }],
    });
    return reply.send({ items: items.map(view) });
  });

  // Massal DULU: Fastify mencocokkan literal sebelum parameter, tapi menulisnya lebih dulu
  // membuat urutannya eksplisit bagi pembaca.
  app.post("/github-issues/accept", async (req, reply) => {
    const parsed = zAcceptMany.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { ids, priority, source } = parsed.data;
    const author = req.user?.email ?? "system";
    const created: unknown[] = [];
    const failed: Array<{ id: string; error: string }> = [];
    for (const id of ids) {
      const issue = await prisma.githubIssue.findUnique({ where: { id } });
      if (!issue) { failed.push({ id, error: "not found" }); continue; }
      // Satu issue gagal tak menghentikan sisanya — cermin checkTriase.
      try { created.push((await acceptGithubIssue(issue, { author, priority, source })).spec); }
      catch (e) { failed.push({ id, error: (e as Error).message }); }
    }
    return reply.code(201).send({ created, failed });
  });

  app.post("/github-issues/:id/accept", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zAccept.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const issue = await prisma.githubIssue.findUnique({ where: { id } });
    if (!issue) return reply.code(404).send({ error: "not found" });
    const { spec, created } = await acceptGithubIssue(issue, {
      author: req.user?.email ?? "system", priority: parsed.data.priority, source: parsed.data.source });
    return reply.code(created ? 201 : 200).send(created ? { spec } : { spec, alreadyPromoted: true });
  });

  app.post("/github-issues/:id/reject", async (req, reply) => {
    const { id } = req.params as { id: string };
    const issue = await prisma.githubIssue.findUnique({ where: { id } });
    if (!issue) return reply.code(404).send({ error: "not found" });
    const row = await prisma.githubIssue.update({ where: { id }, data: { status: "rejected" } });
    await notifySynced("githubIssue", id);
    return reply.send({ id: row.id, status: row.status });
  });

  app.post("/github-issues/:id/unlink", async (req, reply) => {
    const { id } = req.params as { id: string };
    const issue = await prisma.githubIssue.findUnique({ where: { id } });
    if (!issue) return reply.code(404).send({ error: "not found" });
    const row = await prisma.githubIssue.update({ where: { id }, data: { status: "new", specId: null } });
    await notifySynced("githubIssue", id);
    return reply.send({ id: row.id, status: row.status, specId: row.specId });
  });
}
```

`server/src/app.ts` — import & register (setelah `customAgents`):

```ts
import githubIssues from "./routes/github-issues";
```
```ts
    await api.register(githubIssues); // SPEC-471 · ADR-0095 · tarik & triase issue GitHub (capability `support`)
```

`server/src/services/agent-capabilities.ts` — dua sisipan:

```ts
  // SPEC-471 · ADR-0095 · triase issue GitHub satu domain dengan tiket: keduanya permukaan
  // masuk yang melahirkan backlog. `rw()` menurunkannya dari method (kelas bug SPEC-405).
  if (top === "github-issues") return rw("support");
```

dan di dalam cabang `top === "projects"`, sebelum `if (sub && IDE_SUBS.has(sub))`:

```ts
    if (sub === "github") return rw("support");   // SPEC-471 · ADR-0095
```

- [x] **Step 4: Jalankan, pastikan HIJAU**

Run: `./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/github-routes.test.ts server/test/agent-capabilities.test.ts`
Expected: PASS — 9 test route + suite capability lengkap

- [x] **Step 5: Commit**

```bash
git add server/src/routes/github-issues.ts server/src/app.ts \
        server/src/services/agent-capabilities.ts \
        server/test/github-routes.test.ts server/test/agent-capabilities.test.ts
git commit -m "feat(471): endpoint tarik/triase issue GitHub + gerbang capability support"
```

---

### Task 9: Config `GITHUB_TOKEN`/`HANOMAN_GH_BIN` + probe `gh` di doctor

**Files:**
- Modify: `shared/src/config-registry.ts`
- Modify: `cli/src/commands/doctor.ts`
- Modify: `cli/test/doctor.test.ts`
- Modify: `server/test/config-registry.test.ts`

**Interfaces:**
- Consumes: `ConfigEntry` (`shared/src/config-registry.ts`), `Probes`/`doctorReport` (`cli/src/commands/doctor.ts`)
- Produces: dua entri registry; `Probes` bertambah field `gh: string | null`

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/config-registry.test.ts`:

```ts
  // SPEC-471 · ADR-0095 · dua knob untuk tarik issue. Token BUKAN knob biasa: ia kredensial,
  // jadi kind `secret` (UI tak pernah menampilkan nilainya kembali).
  it("SPEC-471 · GITHUB_TOKEN & HANOMAN_GH_BIN terdaftar dengan kind yang benar", () => {
    const tok = CONFIG_REGISTRY.find((e) => e.key === "GITHUB_TOKEN");
    expect(tok).toBeDefined();
    expect(tok!.kind).toBe("secret");
    expect(tok!.category).toBe("credential");
    const bin = CONFIG_REGISTRY.find((e) => e.key === "HANOMAN_GH_BIN");
    expect(bin).toBeDefined();
    expect(bin!.kind).toBe("path");
    expect(bin!.default).toBe("gh");
  });
```

Tambahkan ke `cli/test/doctor.test.ts`:

```ts
  // SPEC-471 · `gh` opsional (cermin claude/codex): absen TIDAK boleh menggagalkan doctor —
  // jalur REST + GITHUB_TOKEN tetap bekerja tanpa biner itu.
  it("SPEC-471 · gh absen = baris informatif, BUKAN fatal", () => {
    const base = { node: "v22.0.0", git: "git version 2.0", tmux: "tmux 3.4",
      claude: "2.1.220", codex: null, homeWritable: true, web: true, db: "/x.db" };
    const tanpa = doctorReport({ ...base, gh: null });
    expect(tanpa.ok).toBe(true);
    expect(tanpa.lines.join("\n")).toContain("GITHUB_TOKEN");
    const dengan = doctorReport({ ...base, gh: "gh version 2.96.0" });
    expect(dengan.ok).toBe(true);
    expect(dengan.lines.join("\n")).toContain("gh version 2.96.0");
  });
```

- [x] **Step 2: Jalankan, pastikan MERAH**

Run: `./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/config-registry.test.ts` dan `./node_modules/.bin/vitest run --dir cli cli/test/doctor.test.ts`
Expected: FAIL — entri tak ditemukan; `gh` bukan properti `Probes`

- [x] **Step 3: Implementasi minimal**

`shared/src/config-registry.ts` — sisipkan grup baru sesudah blok `vps`:

```ts
  // github (SPEC-471 · ADR-0095 · tarik issue → backlog). Dua mode auth, satu jalur kode:
  // `gh` memakai keyring mesin; bila GITHUB_TOKEN diisi ia diteruskan sebagai GH_TOKEN ke
  // proses gh DAN dipakai jalur REST (hub VPS yang tak punya keyring).
  { key: "GITHUB_TOKEN", group: "github", label: "GitHub token", kind: "secret", apply: "live", category: "credential",
    help: "PAT scope `repo` (atau `public_repo`). Kosong = andalkan `gh auth login` di mesin ini." },
  { key: "HANOMAN_GH_BIN", group: "github", label: "Biner gh", kind: "path", apply: "live", category: "knob", default: "gh",
    help: "Absen = tarik issue lewat HTTPS langsung ke api.github.com." },
```

`cli/src/commands/doctor.ts` — tiga sisipan:

```ts
export type Probes = {
  node: string; git: string | null; tmux: string | null;
  claude: string | null; codex: string | null;
  gh: string | null;   // SPEC-471 · opsional: tanpa gh, tarik issue lewat REST + GITHUB_TOKEN
  homeWritable: boolean; web: boolean; db: string;
};
```

Di dalam `rows`, sesudah baris `codex`:

```ts
    { mark: p.gh ? "✓" : "·",
      text: p.gh ? `gh ${p.gh}` : "gh — tak ada (tarik issue akan lewat HTTP + GITHUB_TOKEN)",
      fatal: false },
```

Di dalam `doctor()`, di objek `doctorReport({…})`:

```ts
    gh: version(ctx.env.HANOMAN_GH_BIN ?? "gh", ["--version"]),
```

- [x] **Step 4: Jalankan, pastikan HIJAU**

Run: `./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/config-registry.test.ts` lalu `./node_modules/.bin/vitest run --dir cli cli/test/doctor.test.ts`
Expected: PASS keduanya

- [x] **Step 5: Commit**

```bash
git add shared/src/config-registry.ts cli/src/commands/doctor.ts \
        cli/test/doctor.test.ts server/test/config-registry.test.ts
git commit -m "feat(471): knob GITHUB_TOKEN & HANOMAN_GH_BIN + probe gh non-fatal di doctor"
```

---

### Task 10: UI — tab "Issue GitHub" di layar Triase

**Files:**
- Modify: `src/src/api/client.ts`
- Modify: `src/src/screens/TriageScreen.tsx`
- Create: `src/test/triage-github.test.tsx`

**Interfaces:**
- Consumes: `GithubIssueView` (Task 1), endpoint Task 8
- Produces: `api.pullGithubIssues`, `api.listGithubIssues`, `api.acceptGithubIssue`, `api.acceptGithubIssues`, `api.rejectGithubIssue`; komponen `GithubIssuesPanel`

- [ ] **Step 1: Tulis test yang gagal**

`src/test/triage-github.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { GithubIssuesPanel } from "../src/screens/TriageScreen";

const issue = (over: Record<string, unknown> = {}) => ({
  id: "p:o/r#9", projectId: "p", repoSlug: "o/r", number: 9,
  title: "History purge menghapus transkrip", body: "isi", authorLogin: "wulanrlestari",
  labels: [], url: "https://github.com/o/r/issues/9", issueState: "open",
  status: "new", specId: null, pulledAt: "2026-08-01T00:00:00Z",
  issueCreatedAt: "2026-07-30T11:57:43Z", issueUpdatedAt: "2026-07-30T11:57:43Z", ...over,
});

const api = {
  listGithubIssues: vi.fn(async () => ({ items: [issue()] })),
  pullGithubIssues: vi.fn(async () => ({ repo: "o/r", pulled: 1, created: 1, updated: 0, via: "gh", skippedPullRequests: 3 })),
  acceptGithubIssues: vi.fn(async () => ({ created: [{ id: "SPEC-472" }], failed: [] })),
  rejectGithubIssue: vi.fn(async () => ({ id: "p:o/r#9", status: "rejected" })),
};
vi.mock("../src/api/client", () => ({ api: new Proxy({}, { get: (_t, k) => (api as never)[k] }) }));

beforeEach(() => { for (const f of Object.values(api)) f.mockClear(); });

describe("SPEC-471 · panel issue GitHub", () => {
  it("memuat & menampilkan issue", async () => {
    render(<GithubIssuesPanel projectId="p" />);
    expect(await screen.findByText(/History purge menghapus transkrip/)).toBeTruthy();
    expect(screen.getByText("#9")).toBeTruthy();
  });

  it("tombol Tarik issue memanggil endpoint & melaporkan PR yang dibuang", async () => {
    render(<GithubIssuesPanel projectId="p" />);
    await screen.findByText(/History purge/);
    fireEvent.click(screen.getByRole("button", { name: /tarik issue/i }));
    await waitFor(() => expect(api.pullGithubIssues).toHaveBeenCalledWith("p"));
    expect(await screen.findByText(/3 pull request dilewati/i)).toBeTruthy();
  });

  it("terima terpilih mengirim daftar id", async () => {
    render(<GithubIssuesPanel projectId="p" />);
    await screen.findByText(/History purge/);
    fireEvent.click(screen.getByRole("checkbox", { name: /pilih issue 9/i }));
    fireEvent.click(screen.getByRole("button", { name: /terima terpilih/i }));
    await waitFor(() => expect(api.acceptGithubIssues).toHaveBeenCalledWith(["p:o/r#9"], undefined));
  });

  // Sebab kegagalan HARUS terbaca — daftar kosong tanpa penjelasan adalah gejala yang
  // membuat SPEC-471 tak terlihat selama 36 jam.
  it("gagal tarik menampilkan SEBABNYA, bukan daftar kosong senyap", async () => {
    api.pullGithubIssues.mockRejectedValueOnce(
      Object.assign(new Error("400"), { detail: { error: 'remote project ber-host "gitlab.com", bukan GitHub' } }));
    render(<GithubIssuesPanel projectId="p" />);
    await screen.findByText(/History purge/);
    fireEvent.click(screen.getByRole("button", { name: /tarik issue/i }));
    expect(await screen.findByText(/gitlab\.com/)).toBeTruthy();
  });

  it("issue yang sudah diterima menampilkan tautan Spec-nya, tanpa tombol Terima", async () => {
    api.listGithubIssues.mockResolvedValueOnce({ items: [issue({ status: "accepted", specId: "SPEC-472" })] });
    render(<GithubIssuesPanel projectId="p" />);
    expect(await screen.findByText("SPEC-472")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /pilih issue 9/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan, pastikan MERAH**

Run: `env -u NODE_ENV ./node_modules/.bin/vitest run --dir src src/test/triage-github.test.tsx`
Expected: FAIL — `GithubIssuesPanel is not exported`

> `env -u NODE_ENV` wajib: env sesi ini memuat `NODE_ENV=production` yang membuat RTL `act` gagal massal.

- [ ] **Step 3: Implementasi — helper API**

`src/src/api/client.ts` — tambahkan di objek `api`, sesudah blok tiket:

```ts
  // SPEC-471 · ADR-0095 · tarik & triase issue GitHub. hanoman tak pernah menulis ke GitHub.
  listGithubIssues: (projectId: string, status?: string) =>
    j<{ items: GithubIssueView[] }>(`/api/projects/${encodeURIComponent(projectId)}/github/issues` + qs({ status })),
  pullGithubIssues: (projectId: string, p: { state?: "open" | "all"; limit?: number } = {}) =>
    j<{ repo: string; pulled: number; created: number; updated: number; via: "gh" | "rest"; skippedPullRequests: number }>(
      `/api/projects/${encodeURIComponent(projectId)}/github/pull`, { method: "POST", ...body(p) }),
  acceptGithubIssue: (id: string, priority?: string, source?: string) =>
    j<{ spec: Spec; alreadyPromoted?: boolean }>(`/api/github-issues/${encodeURIComponent(id)}/accept`,
      { method: "POST", ...body({ priority, source }) }),
  acceptGithubIssues: (ids: string[], priority?: string) =>
    j<{ created: Spec[]; failed: Array<{ id: string; error: string }> }>("/api/github-issues/accept",
      { method: "POST", ...body({ ids, priority }) }),
  rejectGithubIssue: (id: string) =>
    j<{ id: string; status: string }>(`/api/github-issues/${encodeURIComponent(id)}/reject`, { method: "POST", ...body({}) }),
  unlinkGithubIssue: (id: string) =>
    j<{ id: string; status: string; specId: string | null }>(`/api/github-issues/${encodeURIComponent(id)}/unlink`, { method: "POST", ...body({}) }),
```

Tambahkan `GithubIssueView` ke import tipe `@hanoman/shared` di kepala berkas.

- [ ] **Step 4: Implementasi — panel**

`src/src/screens/TriageScreen.tsx` — tambahkan komponen ter-ekspor (dipakai layar Triase sebagai tab kedua):

```tsx
// SPEC-471 · ADR-0095 · panel issue GitHub. Ditempatkan sebagai TAB di layar Triase, bukan
// layar baru: keduanya permukaan yang sama — laporan dari luar yang menunggu diputuskan.
export function GithubIssuesPanel({ projectId }: { projectId: string }) {
  const [items, setItems] = React.useState<GithubIssueView[]>([]);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<string[]>([]);

  const load = React.useCallback(async () => {
    try { setItems((await api.listGithubIssues(projectId)).items); setState("ready"); }
    catch { setState("error"); }
  }, [projectId]);
  React.useEffect(() => { void load(); }, [load]);

  // Sebab kegagalan selalu ditampilkan. Daftar kosong tanpa penjelasan adalah gejala yang
  // membuat kanal ini tak terlihat selama 36 jam (audit B1).
  const reason = (e: unknown): string => {
    const d = (e as { detail?: { error?: unknown } }).detail?.error;
    return typeof d === "string" ? d : (e as Error).message;
  };

  async function pull() {
    setBusy(true); setErr(null); setNote(null);
    try {
      const r = await api.pullGithubIssues(projectId);
      setNote(`${r.repo}: ${r.created} baru, ${r.updated} diperbarui`
        + (r.skippedPullRequests ? ` · ${r.skippedPullRequests} pull request dilewati` : ""));
      await load();
    } catch (e) { setErr(reason(e)); }
    finally { setBusy(false); }
  }

  async function acceptPicked() {
    setBusy(true); setErr(null);
    try { await api.acceptGithubIssues(picked, undefined); setPicked([]); await load(); }
    catch (e) { setErr(reason(e)); }
    finally { setBusy(false); }
  }

  async function reject(id: string) {
    setBusy(true);
    try { await api.rejectGithubIssue(id); await load(); }
    catch (e) { setErr(reason(e)); }
    finally { setBusy(false); }
  }

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <Button onClick={pull} disabled={busy}>Tarik issue</Button>
        <Button onClick={acceptPicked} disabled={busy || picked.length === 0} variant="primary">
          Terima terpilih{picked.length ? ` (${picked.length})` : ""}
        </Button>
        {note && <span className="hn-muted">{note}</span>}
      </div>
      {err && <div role="alert" className="hn-error">{err}</div>}
      {state === "loading" && <div>Memuat…</div>}
      {state === "error" && <div role="alert">Gagal memuat daftar issue.</div>}
      {state === "ready" && items.length === 0 && (
        <div className="hn-muted">Belum ada issue tertarik. Tekan “Tarik issue”.</div>
      )}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {items.map((i) => (
          <li key={i.id} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "8px 0" }}>
            {i.status === "new" && (
              <input type="checkbox" aria-label={`Pilih issue ${i.number}`}
                checked={picked.includes(i.id)} onChange={() => toggle(i.id)} />
            )}
            <span className="hn-mono">#{i.number}</span>
            <a href={i.url} target="_blank" rel="noreferrer">{i.title}</a>
            <span className="hn-muted">@{i.authorLogin}</span>
            {i.labels.map((l) => <Badge key={l}>{l}</Badge>)}
            {i.specId && <span className="hn-mono">{i.specId}</span>}
            {i.status === "new" && (
              <Button onClick={() => reject(i.id)} disabled={busy} variant="ghost">Tolak</Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Pasang sebagai tab kedua di komponen layar Triase (di sebelah daftar tiket), memakai state
`React.useState<"tiket" | "issue">("tiket")` dan dua `Button` sebagai pemilih tab — **bukan**
komponen `Switch`, yang `getByLabelText`-nya tak terjangkau di test DS (jebakan SPEC-299).

Selaraskan import: `Badge`, `Button` dari `../ds`, dan `GithubIssueView` dari `@hanoman/shared`.

- [ ] **Step 5: Jalankan, pastikan HIJAU**

Run: `env -u NODE_ENV ./node_modules/.bin/vitest run --dir src src/test/triage-github.test.tsx`
Expected: PASS — 5 test

- [ ] **Step 6: Commit**

```bash
git add src/src/api/client.ts src/src/screens/TriageScreen.tsx src/test/triage-github.test.tsx
git commit -m "feat(471): tab Issue GitHub di layar Triase — tarik, terima massal, tolak"
```

---

### Task 11: ADR-0095 + docs Source of Truth

**Files:**
- Create: `internal/docs/adr/0095-tarik-issue-github-ke-backlog.md`
- Modify: `internal/docs/README.md`
- Modify: `internal/docs/adr/README.md`
- Modify: `internal/docs/architecture/data-model.md`
- Modify: `internal/docs/architecture/api-contract.md`

- [ ] **Step 1: Verifikasi ulang nomor ADR bebas**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman
git worktree list
git branch -a --format='%(refname:short)' | while read b; do \
  git ls-tree -r --name-only "$b" -- internal/docs/adr 2>/dev/null | grep -E "0095"; done | sort -u
```

Expected: kosong. Bila terisi, naikkan ke nomor bebas berikutnya **di seluruh berkas plan & kode**.

- [ ] **Step 2: Tulis ADR-0095**

`internal/docs/adr/0095-tarik-issue-github-ke-backlog.md` — struktur wajib (ikuti gaya ADR-0094):
judul, **Status: accepted**, tanggal, **Konteks** (kutip angka audit: 9 issue · 36 j 37 m · 284 Spec ·
3 call site `spec.create` · `octokit` dicabut ADR-0024 sebagai efek samping), **Keputusan** dengan
enam butir bernomor:

1. Issue GitHub masuk sebagai **record lokal** `GithubIssue` ber-id deterministik
   `"<projectId>:<owner>/<repo>#<n>"`, bukan dibaca ulang tiap kali — cermin `Ticket` (ADR-0062),
   alasan id deterministik sama dengan `CustomAgent` (ADR-0094).
2. **Dua jalur ambil, satu bentuk**: `gh` CLI lebih dulu, fallback HTTPS ke `api.github.com`.
   Fallback **hanya** saat `gh` tak bisa dieksekusi atau tak terautentikasi.
3. Jalur REST **wajib** membuang item ber-`pull_request` dan memeriksa `has_issues` — dengan
   angka terukurnya (14/30, 71/71, HTTP 200).
4. `pullIssues` **tak pernah** menyentuh `status`/`specId` saat memperbarui.
5. **hanoman tidak pernah menulis ke GitHub.**
6. Resolusi repo = `Project.gitRemote ?? origin(repoDir)`; host non-GitHub ditolak bersuara.

Lalu **Konsekuensi** (+/−) dan **Catatan**: ADR-0006 tetap *obsolete* — ini **tidak**
menghidupkannya (tak ada GitHub App, tak ada webhook, tak ada trigger; arah tulis-balik tetap
tertutup); ADR-0024 utuh — yang dicabutnya adalah eksekusi tanpa penunggu, dan tarik issue tetap
dipicu manusia.

- [ ] **Step 3: Taut ADR di DUA index**

`internal/docs/README.md` — baris pertama daftar `## adr`:

```markdown
- [0095 — Tarik issue GitHub ke backlog: record lokal `GithubIssue`, dua jalur ambil, baca-saja](adr/0095-tarik-issue-github-ke-backlog.md)
```

`internal/docs/adr/README.md` — entri naratif memuat gotcha terukur: PR ikut di endpoint REST
(14/30 · **71/71** di repo yang issue-nya dimatikan, yang tetap dijawab **HTTP 200**), `gh` exit 1
sebagai jawaban **otoritatif** yang tak boleh di-fallback, `--limit` default 30, `GH_TOKEN`
mengalahkan keyring, dan `status`/`specId` yang harus kebal tarik-ulang.

- [ ] **Step 4: Perbarui doc arsitektur**

`internal/docs/architecture/data-model.md` — tambahkan `GithubIssue` mengikuti format model lain
(kolom, id deterministik, `specId` tanpa FK + alasannya, ikut sync).

`internal/docs/architecture/api-contract.md` — tambahkan enam endpoint Task 8 dengan
method/path/body/response dan pemetaan capability `support`.

- [ ] **Step 5: Verifikasi integritas index**

```bash
node cli/dist/index.js docs index --check 2>/dev/null || pnpm --filter ./cli exec tsx src/index.ts docs index --check
```

Expected: tak ada doc yatim.

- [ ] **Step 6: Commit**

```bash
git add internal/docs
git commit -m "docs(471): ADR-0095 tarik issue GitHub + data-model + api-contract + index"
```

---

### Task 12: Verifikasi akhir

- [ ] **Step 1: Typecheck paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck && \
pnpm --filter ./cli typecheck && pnpm --filter ./src typecheck
```

Expected: nol error. (Empat paket memang tersentuh; **jangan** `pnpm -r typecheck`.)

- [ ] **Step 2: Jalankan test yang tersentuh, SERIAL**

```bash
pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism
```

Expected: semua hijau. **Baca jumlah test yang berjalan** — `--changed` menyalakan
`passWithNoTests`, jadi "no test files" **bukan** bukti hijau. Minimal yang harus terlihat berjalan:
`github.test.ts`, `github-repo`, `github-fetch`, `github-pull`, `github-sync`, `github-accept`,
`github-routes`, `agent-capabilities`, `config-registry`, `doctor`, `triage-github`.

- [ ] **Step 3: Smoke endpoint sungguhan (task ini menyentuh endpoint)**

DB khusus supaya sesi tetangga tak menghapusnya di tengah smoke:

```bash
export HANOMAN_HOME=/tmp/hnm-smoke-471
mkdir -p "$HANOMAN_HOME"
env -u DATABASE_URL pnpm --filter ./server exec prisma migrate deploy
env -u DATABASE_URL -u NODE_ENV node server/dist/server.js --port 8791 &
```

Lalu (project `hanoman` sudah punya `gitRemote` GitHub — repo yang sama yang punya 9 issue):

```bash
curl -sS -XPOST localhost:8791/api/projects/hanoman/github/pull -H 'content-type: application/json' -d '{}'
curl -sS 'localhost:8791/api/projects/hanoman/github/issues' | head -c 400
```

Expected: `pull` menjawab `{"repo":"denameidina/hanoman","pulled":9,...}` dan daftar memuat
kesembilan nomor issue. Matikan server **per-PID** (`lsof -ti:8791` → `kill <pid>`) — **jangan**
`pkill -f node`.

- [ ] **Step 4: Diff bersih & nomor ADR final**

```bash
git status --porcelain
cd /Users/denameidina/Documents/Nafanesia/hanoman && git worktree list
```

- [ ] **Step 5: Push**

```bash
git push origin HEAD:refs/heads/hanoman/spec-471
```

---

## Self-Review

**Cakupan spec → task**

| Bagian spec | Task |
|---|---|
| Data `GithubIssue` + id deterministik + `specId` tanpa FK | 5 |
| Sync entitas | 6 |
| Resolusi repo (`gitRemote ?? origin`, non-GitHub, tanpa repoDir) | 2 |
| Dua jalur ambil + aturan fallback | 4 |
| Filter pull request + `has_issues` | 3, 4 |
| Idempotensi tarik-ulang | 5 |
| Jembatan accept + label→source + payload cocok-source | 1, 7 |
| Accept massal | 7, 8 |
| Enam endpoint + capability | 8 |
| Config `GITHUB_TOKEN`/`HANOMAN_GH_BIN` + doctor | 9 |
| UI tab Triase | 10 |
| ADR-0095 + docs | 11 |
| Non-goal (tulis-balik, scheduler source, GitLab) | tak ada task — disengaja |

**Konsistensi tipe** — `NormalIssue` (Task 1) dipakai apa adanya oleh `issueFromGh`/`issuesFromRest`
(Task 3), `FetchOutcome` (Task 4), `pullIssues` (Task 5). `issueRowId` dipakai Task 5 & test Task 7/8
dengan bentuk `"<projectId>:<slug>#<n>"` yang sama. `sourceForLabels` mengembalikan
`"qa"|"brief"|"audit"` — sama persis dengan parameter `source` di `acceptGithubIssue` dan `zAccept`.
