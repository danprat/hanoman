# SPEC-394 — Melanjutkan sesi backlog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menekan "Lanjutkan" pada sesi backlog yang setengah jalan melanjutkan pekerjaannya — worktree, commit, dan fase yang sudah tercatat dipakai ulang — bukan menghapusnya lalu mengulang pipeline dari fase pertama.

**Architecture:** `startSpecSession()` (satu-satunya jalur peluncuran sesi backlog, dipakai `POST /terminal/sessions` **dan** governor scheduler) mengklasifikasi tiap peluncuran jadi **live** (pane tmux hidup → re-attach), **resume** (artefak masih ada → lanjutkan), atau **fresh** (perilaku hari ini). Resume tak pernah memanggil `realGit.addWorktree` di atas worktree yang masih sah, tak pernah menulis ulang `spec.baseSha`, dan mengirim `resumePrompt()` yang memuat baris fase yang sudah tercatat di `$HANOMAN_PHASE_FILE`.

**Tech Stack:** TypeScript strict · pnpm workspace (`runner`, `server`, `src`) · Fastify · Prisma/Postgres · node-pty + tmux · vitest

## Global Constraints

- Sesuai [design doc](../specs/2026-07-29-spec-394-lanjutkan-sesi-backlog-design.md) dan [audit](../../../internal/docs/research/audit-spec-394-lanjutkan-sesi-backlog.md).
- **Tanpa perubahan skema, tanpa migration, tanpa endpoint baru.** `resumed` adalah field respons aditif.
- Server **tidak pernah menulis** ke `$HANOMAN_PHASE_FILE` — berkas itu tetap milik agen (append-only).
- `continuePrompt` (SPEC-172) **tidak disentuh**; `spec.stage === "done"` tetap masuk jalur lama.
- `realGit.addWorktree` **tidak diubah** — semantik "rebut path lalu buat" tetap benar untuk jalur fresh & semua flow lain.
- `spec.baseSha` hanya ditulis pada peluncuran **fresh** (ADR-0030: rentang review harus tetap mengukur basis asli).
- Scope verifikasi sesi ini `changed` (ADR-0080): jalankan hanya test yang tersentuh, typecheck **per paket** (`pnpm --filter ./server typecheck`), jangan `pnpm -r typecheck`, jangan suite penuh.
- Env shell mesin ini menunjuk produksi — **setiap** perintah vitest wajib diawali `env -u NODE_ENV -u DATABASE_URL -u HANOMAN_TMUX_SOCKET TEST_DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman394_test"`.

## File Structure

| Berkas | Tanggung jawab |
| --- | --- |
| `runner/src/types.ts` (modify) | `GitOps.worktreeAlive`/`GitOps.revParse` + tipe `ResumeCtx` |
| `runner/src/git.ts` (modify) | Implementasi dua operasi git murni-baca itu |
| `runner/src/prompt.ts` (modify) | `resumePrompt()` — kerangka `startPrompt` + blok RESUME |
| `runner/test/git.test.ts` (modify) | Test `worktreeAlive` & `revParse` |
| `runner/test/prompt.test.ts` (modify) | Test `resumePrompt` |
| `server/src/services/session-launch.ts` (modify) | Klasifikasi live/resume/fresh + pemilihan prompt & basis worktree |
| `server/test/session-resume.test.ts` (create) | Semua AC resume, terhadap tmux + git nyata |
| `server/src/routes/terminal.ts` (modify) | Meneruskan `resumed` ke respons `201` |
| `server/test/terminal.route.test.ts` (modify) | Kontrak `201 { id, resumed }` |
| `src/src/api/client.ts` (modify) | Tipe respons `startSession` |
| `src/src/App.tsx` (modify) | `onStarted(id, resumed)` → toast "dilanjutkan" |
| `src/test/start-session-modal.test.tsx` (modify/create) | Toast membedakan lanjut vs mulai |
| `internal/docs/adr/0084-melanjutkan-sesi-backlog.md` (create) | Keputusan arsitektur |
| `internal/docs/architecture/api-contract.md` (modify) | Respons `201 { id, resumed? }` |
| `internal/skills/hanoman/SKILL.md` (modify) | Aturan sesi & eksekusi |
| `internal/docs/README.md` (modify) | Taut ADR-0084 (+ audit doc, sudah ada) |
| `internal/docs/adr/README.md` (modify) | Narasi ADR-0084 (sub-index, SPEC-386) |

---

### Task 1: Dua operasi git murni-baca (`worktreeAlive`, `revParse`)

**Files:**
- Modify: `runner/src/types.ts` (interface `GitOps`, sekitar baris 58-67)
- Modify: `runner/src/git.ts` (objek `realGit`)
- Test: `runner/test/git.test.ts`

**Interfaces:**
- Consumes: `seedRepo()` yang sudah ada di `runner/test/git.test.ts` (mengembalikan `{ repo, remote }`, remote bare + `main` ter-push).
- Produces:
  - `realGit.worktreeAlive(path: string): boolean` — `true` hanya bila `path` adalah **akar** sebuah worktree git yang bisa dipakai.
  - `realGit.revParse(repo: string, rev: string): string | null` — resolve **literal** (tanpa DWIM `origin/`), `null` bila gagal, tak pernah melempar.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `runner/test/git.test.ts`, di dalam file (bukan di dalam `describe` yang sudah ada):

```ts
// SPEC-394 · jalur "melanjutkan" harus bisa bertanya ke git tanpa efek samping: apakah
// worktree-nya masih sah, dan apakah sebuah rev masih resolve.
describe("git · pembacaan untuk resume (SPEC-394)", () => {
  it("worktreeAlive true untuk worktree yang sah, false sesudah dihapus", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "spec-alive");
    realGit.addWorktree(repo, wt, "main");
    expect(realGit.worktreeAlive(wt)).toBe(true);
    realGit.removeWorktree(repo, wt);
    expect(realGit.worktreeAlive(wt)).toBe(false);
  });

  it("worktreeAlive false untuk direktori biasa DI DALAM repo", () => {
    const { repo } = seedRepo();
    const plain = join(repo, ".worktrees", "bukan-worktree");
    mkdirSync(plain, { recursive: true });
    // `rev-parse --is-inside-work-tree` di sini menjawab true (ia di dalam repo induk);
    // yang membedakan hanya toplevel-nya, dan itulah yang wajib diuji.
    expect(realGit.worktreeAlive(plain)).toBe(false);
  });

  it("worktreeAlive false untuk path yang tak ada", () => {
    const { repo } = seedRepo();
    expect(realGit.worktreeAlive(join(repo, ".worktrees", "tak-pernah-ada"))).toBe(false);
  });

  it("revParse mengembalikan sha untuk rev yang ada, null untuk yang tidak", () => {
    const { repo } = seedRepo();
    const head = g(repo, "rev-parse", "HEAD").stdout.trim();
    expect(realGit.revParse(repo, "main")).toBe(head);
    expect(realGit.revParse(repo, "hanoman/tidak-ada")).toBeNull();
    expect(realGit.revParse(repo, "--upload-pack=jahat")).toBeNull();   // ADR-0032: argumen berbentuk flag
  });

  it("revParse melihat branch yang di-push dari worktree detached", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "spec-push");
    realGit.addWorktree(repo, wt, "main");
    writeFileSync(join(wt, "a.txt"), "x");
    g(wt, "add", "-A"); g(wt, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "kerja");
    const tip = g(wt, "rev-parse", "HEAD").stdout.trim();
    g(wt, "push", "-q", "origin", "HEAD:refs/heads/hanoman/spec-push");
    realGit.removeWorktree(repo, wt);
    expect(realGit.revParse(repo, "origin/hanoman/spec-push")).toBe(tip);
  });
});
```

Pastikan import di kepala berkas memuat `mkdirSync`:

```ts
import { mkdtempSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
```

- [x] **Step 2: Jalankan test — pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL -u HANOMAN_TMUX_SOCKET pnpm --filter ./runner exec vitest run test/git.test.ts`
Expected: FAIL — `realGit.worktreeAlive is not a function`.

- [x] **Step 3: Tambahkan kontrak di `runner/src/types.ts`**

Di dalam `interface GitOps`, sesudah `initRepo`:

```ts
  /** SPEC-394 · true hanya bila `path` adalah AKAR sebuah worktree git yang masih bisa dipakai.
   *  Bukan `existsSync`: direktori telanjang di dalam repo pun "ada", dan worktree yang gitdir-nya
   *  sudah dipangkas tetap menyisakan direktori. Murni-baca. */
  worktreeAlive(path: string): boolean;
  /** SPEC-394 · resolve rev secara LITERAL (tanpa DWIM `origin/` milik addWorktree) — `null` bila
   *  tak resolve, tak pernah melempar. Dipakai memilih basis worktree saat sesi dilanjutkan. */
  revParse(repo: string, rev: string): string | null;
```

- [x] **Step 4: Implementasi di `runner/src/git.ts`**

Tambahkan import `realpathSync`:

```ts
import { rmSync, mkdirSync, realpathSync } from "node:fs";
```

Tambahkan helper di atas `export const realGit` (sesudah `resolveCommit`):

```ts
// macOS men-symlink /tmp → /private/tmp, dan `git rev-parse --show-toplevel` selalu menjawab
// path fisik. Membandingkan string mentah karenanya gagal palsu di direktori test.
const samePath = (a: string, b: string): boolean => {
  try { return realpathSync(a) === realpathSync(b); } catch { return false; }
};
```

Tambahkan dua anggota di objek `realGit`, sesudah `initRepo`:

```ts
  // SPEC-394 · "boleh dipakai ulang?" harus dijawab git, bukan filesystem. Dua pertanyaan, dan
  // keduanya wajib: (1) apakah ini di dalam work tree — menyingkirkan direktori yang gitdir-nya
  // sudah dipangkas; (2) apakah toplevel-nya path ini SENDIRI — menyingkirkan direktori telanjang
  // di dalam repo induk, yang menjawab "true" untuk pertanyaan pertama. cwd yang tak ada membuat
  // spawnSync gagal (`status` null), dan itu sudah tertangkap `!== 0`.
  worktreeAlive: (path) => {
    const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: path, encoding: "utf8" });
    if (inside.status !== 0 || inside.stdout.trim() !== "true") return false;
    const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: path, encoding: "utf8" });
    return top.status === 0 && samePath(top.stdout.trim(), path);
  },
  // SPEC-394 · cermin `tryRev` di resolveCommit, tapi LITERAL: pemanggil yang memilih urutan
  // (origin/<branch> → <branch> → headSha), jadi DWIM `origin/` di sini justru menyamarkan
  // "branch lokal tak ada" jadi "ada". `--end-of-options` menjaga ADR-0032.
  revParse: (repo, rev) => {
    const r = spawnSync("git", ["rev-parse", "--verify", "--end-of-options", `${rev}^{commit}`],
      { cwd: repo, encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim() : null;
  },
```

- [x] **Step 5: Jalankan test — pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL -u HANOMAN_TMUX_SOCKET pnpm --filter ./runner exec vitest run test/git.test.ts`
Expected: PASS, seluruh berkas hijau (termasuk test `addWorktree` lama).

- [x] **Step 6: Typecheck paket yang tersentuh**

Run: `pnpm --filter ./runner typecheck`
Expected: exit 0, tanpa keluaran error.

- [x] **Step 7: Commit**

```bash
git add runner/src/types.ts runner/src/git.ts runner/test/git.test.ts
git commit -m "feat(spec-394): worktreeAlive & revParse — pembacaan git untuk melanjutkan sesi"
```

---

### Task 2: `resumePrompt()` — prompt lanjutan yang sadar fase

**Files:**
- Modify: `runner/src/types.ts` (tipe `ResumeCtx`)
- Modify: `runner/src/prompt.ts` (sesudah `continuePrompt`, sekitar baris 232)
- Test: `runner/test/prompt.test.ts`

**Interfaces:**
- Consumes: `startPrompt`/`continuePrompt` yang sudah ada, `PIPELINES`, `autonomyClause`, `scopeClause`, `skillInstruction`, `phaseInstruction` (semuanya sudah di `prompt.ts`).
- Produces:
  ```ts
  export type ResumeCtx = { recorded: readonly string[]; next?: string; worktreeKept: boolean };
  export function resumePrompt(
    flow: Flow, spec: SpecBrief, branchTo: string, resume: ResumeCtx,
    autonomy?: Autonomy, verifyScope?: VerifyScope,
  ): string;
  ```

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `runner/test/prompt.test.ts` (import `resumePrompt` di baris 2 bersama yang lain):

```ts
// SPEC-394 · prompt lanjutan: kerangka startPrompt + blok RESUME. Ia harus MENYEBUT keadaan
// nyata (fase tercatat, bentuk worktree) — agen tak punya cara lain mengetahuinya.
describe("resumePrompt", () => {
  const ctx = { recorded: ["Audit done", "Spec skipped"], next: "Plan", worktreeKept: true };

  it("menyebut fase yang sudah tercatat dan fase berikutnya", () => {
    const p = resumePrompt("qa", spec, "hanoman/spec-394", ctx);
    expect(p).toContain("MELANJUTKAN");
    expect(p).toContain("Audit done");
    expect(p).toContain("Spec skipped");
    expect(p).toContain("Lanjutkan dari fase: Plan.");
    // Fase yang BELUM tercatat tak boleh dikarang. Sengaja bukan "Execute done": kalimat itu
    // memang ada di phaseInstruction (gerbang plan ADR-0029), jadi assertion-nya akan lulus palsu.
    expect(p).not.toContain("Plan skipped");
    expect(p).not.toContain("Plan done");
  });

  it("membedakan worktree utuh dari worktree yang dibangun ulang", () => {
    const utuh = resumePrompt("qa", spec, "b", { ...ctx, worktreeKept: true });
    const ulang = resumePrompt("qa", spec, "b", { ...ctx, worktreeKept: false });
    expect(utuh).toContain("belum di-commit");
    expect(ulang).toContain("DIBANGUN ULANG");
    expect(ulang).toContain("TIDAK ada");
  });

  it("tetap membawa kerangka startPrompt: fase, otonomi, skill, push, dan blok backlog", () => {
    const p = resumePrompt("qa", spec, "hanoman/spec-394", ctx);
    expect(p).toContain("Kerjakan fase berurutan: Audit → Spec → Plan → Execute.");
    expect(p).toContain("$HANOMAN_PHASE_FILE");
    expect(p).toContain("git push origin HEAD:refs/heads/hanoman/spec-394");
    expect(p).toContain(spec.id);
    expect(p).toContain(spec.objective);
    expect(p).toContain("superpowers:test-driven-development");
  });

  it("membawa klausa scope verifikasi seperti startPrompt", () => {
    expect(resumePrompt("qa", spec, "b", ctx, undefined, "changed")).toContain("Scope verifikasi");
    expect(resumePrompt("qa", spec, "b", ctx, undefined, "full")).not.toContain("Scope verifikasi");
  });

  it("tanpa fase tercatat tetap sah — worktree-nya sendiri yang jadi alasan melanjutkan", () => {
    const p = resumePrompt("qa", spec, "b", { recorded: [], next: "Audit", worktreeKept: true });
    expect(p).toContain("Belum ada fase yang tercatat");
    expect(p).toContain("Audit");
  });

  it("semua fase tercatat → disuruh memeriksa sisa task plan, bukan fase berikutnya", () => {
    const p = resumePrompt("qa", spec, "b",
      { recorded: ["Audit done", "Spec done", "Plan done", "Execute done"], worktreeKept: true });
    expect(p).toContain("Semua fase sudah tercatat");
    expect(p).not.toContain("Lanjutkan dari fase:");
  });
});
```

- [x] **Step 2: Jalankan test — pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL -u HANOMAN_TMUX_SOCKET pnpm --filter ./runner exec vitest run test/prompt.test.ts`
Expected: FAIL — `resumePrompt is not a function` / import error.

- [x] **Step 3: Tambahkan tipe `ResumeCtx` di `runner/src/types.ts`**

Sesudah `SpecBrief`:

```ts
// SPEC-394 · keadaan yang HANYA diketahui server saat sebuah sesi backlog dilanjutkan. Dipisah
// dari SpecBrief karena isinya bukan properti backlog item melainkan properti peluncuran ini.
export type ResumeCtx = {
  /** Baris yang SUDAH tercatat di $HANOMAN_PHASE_FILE, apa adanya ("Audit done"/"Spec skipped"). */
  recorded: readonly string[];
  /** Fase pertama yang belum tercatat; undefined bila seluruh pipeline sudah tercatat. */
  next?: string;
  /** true = worktree sesi sebelumnya dipakai apa adanya (kerja belum-commit masih ada);
   *  false = worktree dibangun ulang dari tip branch sesi (hanya commit yang selamat). */
  worktreeKept: boolean;
};
```

- [x] **Step 4: Implementasi `resumePrompt` di `runner/src/prompt.ts`**

Tambahkan `ResumeCtx` ke daftar import tipe di baris 1, lalu sisipkan sesudah `continuePrompt` (sekitar baris 232):

```ts
// SPEC-394 · ADR-0084 — sesi backlog yang dilanjutkan. Beda dari continuePrompt (SPEC-172, yang
// melayani spec keburu-`done` dan karena itu melompat ke Execute): di sini pipeline-nya UTUH dan
// yang berubah hanya titik masuknya. Agen tak bisa menurunkan sendiri "fase mana yang sudah
// selesai" — berkas fase hidup di luar worktree dan tak ikut ter-checkout — jadi server yang
// menyebutkannya. Sengaja TIDAK menyalin baris fase ke phase file: berkas itu milik agen.
const resumeClause = (r: ResumeCtx, branchTo: string): string => {
  const fase = r.recorded.length
    ? `Fase yang SUDAH tercatat di $HANOMAN_PHASE_FILE: ${r.recorded.join(" · ")}. `
      + "JANGAN mengulang fase itu dan JANGAN menulis ulang barisnya."
    : "Belum ada fase yang tercatat di $HANOMAN_PHASE_FILE — worktree ini sendiri yang jadi "
      + "alasan melanjutkan.";
  const lanjut = r.next
    ? `Lanjutkan dari fase: ${r.next}.`
    : "Semua fase sudah tercatat. Periksa apakah plan di `docs/superpowers/plans/**` masih "
      + "menyisakan task `- [ ]` dan selesaikan sisanya; bila sudah bersih, tinggal commit & push.";
  const worktree = r.worktreeKept
    ? "Worktree ini adalah worktree sesi sebelumnya apa adanya — termasuk perubahan yang belum "
      + "di-commit."
    : `Worktree ini DIBANGUN ULANG dari tip branch sesi \`${branchTo}\`: commit sesi sebelumnya `
      + "ada, tetapi perubahan yang belum sempat di-commit TIDAK ada.";
  return [
    "Sesi ini MELANJUTKAN pekerjaan sesi sebelumnya untuk backlog item yang sama — bukan memulai "
      + "dari nol.",
    fase, lanjut, worktree,
    "Sebelum menulis apa pun: baca `git log --oneline` dan `git status`, lalu plan di "
      + "`docs/superpowers/plans/**` untuk backlog item ini (`- [x]` sudah selesai, `- [ ]` belum). "
      + "Jangan menulis ulang yang sudah ada.",
  ].join(" ");
};

export function resumePrompt(
  flow: Flow, spec: SpecBrief, branchTo: string, resume: ResumeCtx,
  autonomy?: Autonomy, verifyScope?: VerifyScope,
): string {
  const detail = spec.payload ? `\nDetail: ${JSON.stringify(spec.payload)}` : "";
  return [
    `hanoman ${flow} — MELANJUTKAN sesi backlog yang sudah berjalan. Ikuti internal/docs sebagai `
      + `Source of Truth; perbarui docs yang tersentuh dan link-nya di index, dalam commit yang sama.`,
    resumeClause(resume, branchTo),
    phaseInstruction(PIPELINES[flow]),
    auditDecisionInstruction(flow),
    autonomyClause(autonomy),
    scopeClause(flow, verifyScope),
    skillInstruction(PIPELINES[flow]),
    `Setelah fase terakhir: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. `
      + `Worktree ini detached HEAD — itu memang disengaja.`,
    `Backlog item ${spec.id} · sumber ${spec.source} · prioritas ${spec.priority}\n`
      + `Judul: ${spec.title}\nObjective: ${spec.objective}${detail}`,
  ].filter(Boolean).join("\n\n");
}
```

- [x] **Step 5: Jalankan test — pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL -u HANOMAN_TMUX_SOCKET pnpm --filter ./runner exec vitest run test/prompt.test.ts`
Expected: PASS — termasuk seluruh test `startPrompt`/`continuePrompt` lama.

- [x] **Step 6: Typecheck**

Run: `pnpm --filter ./runner typecheck`
Expected: exit 0.

- [x] **Step 7: Commit**

```bash
git add runner/src/types.ts runner/src/prompt.ts runner/test/prompt.test.ts
git commit -m "feat(spec-394): resumePrompt — prompt lanjutan yang menyebut fase tercatat"
```

---

### Task 3: Pane MATI bukan sesi hidup

**Files:**
- Modify: `server/src/services/session-launch.ts:44-46`
- Test: `server/test/session-resume.test.ts` (create)

**Interfaces:**
- Consumes: `getSession`, `killSession` dari `./pty` (`killSession` sudah diekspor; tambahkan ke daftar import).
- Produces: `startSpecSession` mengembalikan `{ id, reused: true }` **hanya** untuk pane hidup.

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/session-resume.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/db";
import { startSpecSession } from "../src/services/session-launch";
import { killAll, killSession, getSession, promptFilePath } from "../src/services/pty";
import { realGit } from "@hanoman/runner";

// fake-claude.sh TETAP HIDUP (`exec cat`); /bin/echo langsung keluar → pane `dead`. Perbedaan
// itulah alat ukur test ini: pane mati tak bisa berubah jadi hidup tanpa spawn baru.
const ALIVE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));
const DIES = "/bin/echo";

const clean = async () => {
  killAll();
  await prisma.setting.deleteMany();
  await prisma.spec.deleteMany(); await prisma.project.deleteMany(); await prisma.localBinding.deleteMany();
};
beforeEach(clean); afterAll(clean);

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const g = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", env: GIT_ENV });

/** Repo ber-origin bare + satu commit di `main`, ter-bind ke project `p`. */
async function seed(specId: string, stage = "planned") {
  const remote = mkdtempSync(join(tmpdir(), "hanoman394-remote-"));
  execFileSync("git", ["init", "-q", "--bare", remote]);
  const dir = mkdtempSync(join(tmpdir(), "hanoman394-repo-"));
  execFileSync("git", ["init", "-q", dir]);
  g(dir, "commit", "-q", "--allow-empty", "-m", "root");
  g(dir, "branch", "-M", "main");
  g(dir, "remote", "add", "origin", remote);
  g(dir, "push", "-q", "origin", "main");
  await prisma.project.upsert({
    where: { id: "p" }, update: { repoDir: dir },
    create: { id: "p", name: "P", desc: "", kind: "existing", repoDir: dir },
  });
  const spec = await prisma.spec.create({ data: {
    id: specId, projectId: "p", title: "t", source: "qa", stage,
    author: "a", priority: "tinggi", objective: "o",
  } });
  return { dir, spec };
}

const waitExited = async (id: string) => {
  for (let i = 0; i < 200 && !getSession(id)?.exited; i++) await new Promise((r) => setTimeout(r, 20));
  return getSession(id)?.exited === true;
};

describe("SPEC-394 · pane mati bukan sesi hidup", () => {
  it("pane HIDUP tetap re-attach (ADR-0015), tanpa menyentuh apa pun", async () => {
    process.env.HANOMAN_CLAUDE_BIN = ALIVE;
    const { spec } = await seed("SPEC-L1");
    const r1 = await startSpecSession(spec, { flow: "qa" });
    const r2 = await startSpecSession(spec, { flow: "qa" });
    expect(r2).toEqual({ id: r1.id, reused: true });
    killSession(r1.id);
  });

  it("pane MATI dilahirkan ulang, bukan dikembalikan sebagai sesi", async () => {
    process.env.HANOMAN_CLAUDE_BIN = DIES;
    const { spec } = await seed("SPEC-L2");
    const r1 = await startSpecSession(spec, { flow: "qa" });
    expect(await waitExited(r1.id)).toBe(true);

    process.env.HANOMAN_CLAUDE_BIN = ALIVE;   // sesi kedua hidup — pane mati tak bisa jadi hidup
    const fresh = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-L2" } });
    const r2 = await startSpecSession(fresh, { flow: "qa" });
    expect(r2.reused).toBeFalsy();
    expect(getSession(r2.id)?.exited).toBe(false);
    killSession(r2.id);
  });
});
```

- [x] **Step 2: Jalankan test — pastikan test kedua GAGAL**

Run:
```bash
env -u NODE_ENV -u DATABASE_URL -u HANOMAN_TMUX_SOCKET \
  TEST_DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman394_test" \
  pnpm --filter ./server exec vitest run test/session-resume.test.ts --no-file-parallelism
```
Expected: test pertama PASS, test kedua FAIL — `r2.reused` bernilai `true` dan `exited` masih `true`.

- [x] **Step 3: Perbaiki gerbang di `server/src/services/session-launch.ts`**

Ubah import `pty`:

```ts
import { createSession, getSession, killSession, sessionIdForSpec } from "./pty";
```

Ganti blok baris 44-46:

```ts
  // Sesi hidup: JANGAN bangun ulang worktree (ada kerja belum-commit) — re-attach (ADR-0015).
  const live = getSession(id);
  if (live) return { id: live.id, reused: true };
```

menjadi:

```ts
  // SPEC-394 · ADR-0084 — pane HIDUP adalah sesinya: re-attach (ADR-0015), jangan sentuh apa pun.
  // Pane MATI bukan sesi: tmux menahannya (`remain-on-exit on`) hanya supaya layar terakhirnya
  // masih terbaca. Mengembalikannya sebagai "sesi" membuat tombol Lanjutkan diam — UI sendiri
  // sudah menghitung `!exited`, jadi tombol itu muncul persis saat pane-nya mati. Dibunuh dulu
  // (SPEC-362: menutup baris SessionHistory + menyimpan transkrip pane) lalu dilahirkan ulang.
  const pane = getSession(id);
  if (pane && !pane.exited) return { id: pane.id, reused: true };
  if (pane) killSession(id);
```

- [x] **Step 4: Jalankan test — pastikan LULUS**

Run:
```bash
env -u NODE_ENV -u DATABASE_URL -u HANOMAN_TMUX_SOCKET \
  TEST_DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman394_test" \
  pnpm --filter ./server exec vitest run test/session-resume.test.ts --no-file-parallelism
```
Expected: PASS (2 test).

- [x] **Step 5: Pastikan test tetangga yang menyentuh jalur ini tetap hijau**

Run:
```bash
env -u NODE_ENV -u DATABASE_URL -u HANOMAN_TMUX_SOCKET \
  TEST_DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman394_test" \
  pnpm --filter ./server exec vitest run test/session-launch.test.ts test/terminal.route.test.ts --no-file-parallelism
```
Expected: PASS. Bila ada kegagalan tmux yang aneh, jalankan ULANG dulu — sesi tmux bocor dari run sebelumnya bisa menggagalkan test `listSessions` secara palsu.

- [x] **Step 6: Commit**

```bash
git add server/src/services/session-launch.ts server/test/session-resume.test.ts
git commit -m "fix(spec-394): pane tmux yang mati bukan sesi hidup — lahirkan ulang"
```

---

### Task 4: Resume dengan worktree utuh

**Files:**
- Modify: `server/src/services/session-launch.ts` (blok worktree + pemilihan prompt)
- Test: `server/test/session-resume.test.ts`

**Interfaces:**
- Consumes: `realGit.worktreeAlive`/`realGit.revParse` (Task 1), `resumePrompt`/`ResumeCtx` (Task 2), `readPhases` + `phaseFilePath` dari `./session-phases`.
- Produces: `StartSpecResult` bertambah `resumed?: boolean`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan `describe` baru di `server/test/session-resume.test.ts`:

```ts
describe("SPEC-394 · resume dengan worktree utuh", () => {
  it("tak menghapus worktree, tak menulis ulang baseSha, dan mengirim prompt lanjutan", async () => {
    process.env.HANOMAN_CLAUDE_BIN = ALIVE;
    const { dir, spec } = await seed("SPEC-L3");
    const r1 = await startSpecSession(spec, { flow: "qa" });
    const wt = join(dir, ".worktrees", r1.id);
    const baseAwal = (await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-L3" } })).baseSha;

    // kerja setengah jalan: plan berkotak + berkas belum di-commit + fase tercatat
    mkdirSync(join(wt, "docs", "superpowers", "plans"), { recursive: true });
    writeFileSync(join(wt, "docs", "superpowers", "plans", "spec-l3-plan.md"), "- [x] satu\n- [ ] dua\n");
    writeFileSync(join(wt, "belum-commit.txt"), "jangan hilang");
    writeFileSync(join(dir, ".worktrees", ".phases", r1.id), "Audit done\nSpec skipped\n");
    killSession(r1.id);   // pane hilang, worktree tetap (mis. mesin restart)

    const fresh = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-L3" } });
    const r2 = await startSpecSession(fresh, { flow: "qa" });
    expect(r2.resumed).toBe(true);
    expect(existsSync(join(wt, "belum-commit.txt"))).toBe(true);
    expect(existsSync(join(wt, "docs", "superpowers", "plans", "spec-l3-plan.md"))).toBe(true);

    const after = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-L3" } });
    expect(after.baseSha).toBe(baseAwal);

    const prompt = readFileSync(promptFilePath(r2.id), "utf8");
    expect(prompt).toContain("MELANJUTKAN");
    expect(prompt).toContain("Audit done");
    expect(prompt).toContain("Spec skipped");
    expect(prompt).toContain("Lanjutkan dari fase: Plan.");
    expect(prompt).toContain("belum di-commit");
    killSession(r2.id);
  });

  it("berkas fase tidak pernah ditulis server", async () => {
    process.env.HANOMAN_CLAUDE_BIN = ALIVE;
    const { dir, spec } = await seed("SPEC-L4");
    const r1 = await startSpecSession(spec, { flow: "qa" });
    const phaseFile = join(dir, ".worktrees", ".phases", r1.id);
    writeFileSync(phaseFile, "Audit done\n");
    killSession(r1.id);
    const fresh = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-L4" } });
    const r2 = await startSpecSession(fresh, { flow: "qa" });
    expect(readFileSync(phaseFile, "utf8")).toBe("Audit done\n");
    killSession(r2.id);
  });
});
```

- [x] **Step 2: Jalankan test — pastikan GAGAL**

Run:
```bash
env -u NODE_ENV -u DATABASE_URL -u HANOMAN_TMUX_SOCKET \
  TEST_DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman394_test" \
  pnpm --filter ./server exec vitest run test/session-resume.test.ts --no-file-parallelism
```
Expected: FAIL — `belum-commit.txt` sudah tidak ada (worktree dihapus `addWorktree`), `r2.resumed` `undefined`.

- [x] **Step 3: Implementasi klasifikasi resume di `server/src/services/session-launch.ts`**

Perbarui import:

```ts
import { realGit, startPrompt, continuePrompt, resumePrompt, startCrossAuditPrompt, resolveGoalCondition, type Flow, type Autonomy, type VerifyScope, type ResumeCtx } from "@hanoman/runner";
...
import { phaseFilePath, decisionFilePath, readPhases } from "./session-phases";
```

Perbarui tipe hasil:

```ts
export type StartSpecResult = { id: string; reused?: boolean; resumed?: boolean };
```

Tambahkan helper di atas `startSpecSession` (sesudah `LaunchError`):

```ts
// SPEC-394 · ADR-0084 — keadaan KETIGA sebuah peluncuran, di antara "re-attach" dan "sesi baru".
// Resume hanya sah bila artefaknya benar-benar masih ada (syarat yang ditulis ADR-0017): worktree
// yang masih sah, atau tip branch sesi yang bisa di-checkout. `baseSha` null = spec ini belum
// pernah punya worktree, jadi apa pun isi disk bukan miliknya.
type Resume = { worktreeKept: boolean; base?: string };
function resumeState(
  repoDir: string, worktree: string, branchTo: string, headSha: string | null,
): Resume | null {
  if (realGit.worktreeAlive(worktree)) return { worktreeKept: true };
  // Urutan mengikat: `origin/<branchTo>` lebih dulu karena ITULAH ref yang push berikutnya harus
  // fast-forward — worktree yang lahir dari basis lain membuat `git push` di akhir sesi ditolak
  // non-fast-forward (ADR-0017). `headSha` (SPEC-176) jadi jaring terakhir untuk commit yang tak
  // sempat di-push; ia bisa sudah tak terjangkau, jadi resolve-nya lunak.
  const base = realGit.revParse(repoDir, `origin/${branchTo}`)
    ?? realGit.revParse(repoDir, branchTo)
    ?? (headSha ? realGit.revParse(repoDir, headSha) : null);
  return base ? { worktreeKept: false, base } : null;
}
```

Ganti blok worktree (baris `const isContinue …` sampai `await prisma.spec.update({ … baseSha, headSha: null })`) menjadi:

```ts
  const isContinue = spec.stage === "done";
  const worktree = `${repoDir}/.worktrees/${id}`;
  const branchTo = `hanoman/${id}`;
  // `done` tetap milik SPEC-172: kerjanya umumnya sudah ter-merge ke branchFrom, jadi worktree
  // barunya memang harus lahir dari sana — bukan dari tip branch sesi yang sudah usang.
  const resume = !isContinue && spec.baseSha
    ? resumeState(repoDir, worktree, branchTo, spec.headSha)
    : null;
  ...
  if (agent === "codex") ensureCodexTrust(repoDir);

  let baseSha: string;
  if (resume?.worktreeKept) {
    // Satu-satunya jalur yang TIDAK memanggil addWorktree: ia selalu merebut path lebih dulu
    // (`remove --force` + `rmSync`), dan di sini path itu berisi pekerjaan yang mau dilanjutkan.
    baseSha = spec.baseSha!;
  } else {
    try {
      const born = realGit.addWorktree(repoDir, worktree, resume?.base ?? spec.branchFrom ?? "HEAD");
      // Resume: rentang review tetap diukur dari basis ASLI (ADR-0030) — yang berubah hanya
      // titik checkout-nya. Fresh: basis barulah yang dicatat.
      baseSha = resume ? spec.baseSha! : born;
    } catch (e) {
      throw new LaunchError(`gagal membuat worktree: ${(e as Error).message}`, "worktree");
    }
    if (!resume) await prisma.spec.update({ where: { id: spec.id }, data: { baseSha, headSha: null } });
  }
```

Ganti pemilihan prompt:

```ts
  let prompt: string;
  if (isContinue) {
    prompt = continuePrompt(opts.flow, brief, branchTo, opts.autonomy, verifyScope);
  } else if (resume) {
    const phases = readPhases(phaseFilePath(repoDir, id), opts.flow);
    const ctx: ResumeCtx = {
      recorded: phases.filter((p) => p.state === "done" || p.state === "skipped")
        .map((p) => `${p.name} ${p.state}`),
      next: phases.find((p) => p.state === "active")?.name,
      worktreeKept: resume.worktreeKept,
    };
    prompt = resumePrompt(opts.flow, brief, branchTo, ctx, opts.autonomy, verifyScope);
  } else {
    prompt = startPrompt(opts.flow, brief, branchTo, opts.autonomy, verifyScope);
  }
```

Pastikan `branchTo` dipakai juga di `resolveGoalCondition` (`branchTo: \`hanoman/${id}\`` → `branchTo`) dan di blok cross-audit, lalu ubah `return`:

```ts
  return resume ? { id: s.id, resumed: true } : { id: s.id };
```

- [x] **Step 4: Jalankan test — pastikan LULUS**

Run:
```bash
env -u NODE_ENV -u DATABASE_URL -u HANOMAN_TMUX_SOCKET \
  TEST_DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman394_test" \
  pnpm --filter ./server exec vitest run test/session-resume.test.ts --no-file-parallelism
```
Expected: PASS (4 test).

- [x] **Step 5: Typecheck**

Run: `pnpm --filter ./server typecheck`
Expected: exit 0.

- [x] **Step 6: Commit**

```bash
git add server/src/services/session-launch.ts server/test/session-resume.test.ts
git commit -m "feat(spec-394): worktree utuh dipakai ulang saat sesi backlog dilanjutkan"
```

---

### Task 5: Resume dari tip branch sesi + jalur fresh/`done` tetap utuh

**Files:**
- Test: `server/test/session-resume.test.ts`
- (Implementasi sudah masuk di Task 4; task ini yang membuktikannya dan mengunci regresi.)

**Interfaces:**
- Consumes: `resumeState` (Task 4), `realGit.revParse` (Task 1).
- Produces: tak ada API baru — hanya jaminan perilaku.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan `describe` baru di `server/test/session-resume.test.ts`:

```ts
describe("SPEC-394 · resume tanpa worktree, fresh, dan stage done", () => {
  it("worktree hilang tapi branch sesi ada → lahir di tip branch itu", async () => {
    process.env.HANOMAN_CLAUDE_BIN = ALIVE;
    const { dir, spec } = await seed("SPEC-L5");
    const r1 = await startSpecSession(spec, { flow: "qa" });
    const wt = join(dir, ".worktrees", r1.id);
    const baseAwal = (await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-L5" } })).baseSha;

    writeFileSync(join(wt, "hasil.txt"), "commit sesi 1");
    g(wt, "add", "-A"); g(wt, "commit", "-qm", "kerja sesi 1");
    const tip = g(wt, "rev-parse", "HEAD").trim();
    g(wt, "push", "-q", "origin", `HEAD:refs/heads/hanoman/${r1.id}`);
    killSession(r1.id);
    realGit.removeWorktree(dir, wt);            // operator menutup sesi (SPEC-362)
    expect(existsSync(wt)).toBe(false);

    const fresh = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-L5" } });
    const r2 = await startSpecSession(fresh, { flow: "qa" });
    expect(r2.resumed).toBe(true);
    expect(realGit.headSha(wt)).toBe(tip);       // bukan `main`
    expect(existsSync(join(wt, "hasil.txt"))).toBe(true);
    expect((await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-L5" } })).baseSha).toBe(baseAwal);

    const prompt = readFileSync(promptFilePath(r2.id), "utf8");
    expect(prompt).toContain("DIBANGUN ULANG");
    expect(prompt).toContain("TIDAK ada");
    killSession(r2.id);
  });

  it("tanpa worktree & tanpa branch sesi → perilaku lama persis (startPrompt, baseSha ditulis)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = ALIVE;
    const { spec } = await seed("SPEC-L6");
    const r = await startSpecSession(spec, { flow: "qa" });
    expect(r.resumed).toBeUndefined();
    const row = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-L6" } });
    expect(row.baseSha).toMatch(/^[0-9a-f]{40}$/);
    expect(row.headSha).toBeNull();
    const prompt = readFileSync(promptFilePath(r.id), "utf8");
    expect(prompt).not.toContain("MELANJUTKAN");
    expect(prompt).toContain("Kerjakan fase berurutan: Audit → Spec → Plan → Execute.");
    killSession(r.id);
  });

  it("stage done tetap jalur SPEC-172: continuePrompt, worktree dari branchFrom", async () => {
    process.env.HANOMAN_CLAUDE_BIN = ALIVE;
    const { dir, spec } = await seed("SPEC-L7", "done");
    const r1 = await startSpecSession(spec, { flow: "qa" });
    const wt = join(dir, ".worktrees", r1.id);
    writeFileSync(join(wt, "sisa.txt"), "artefak sesi lama");
    killSession(r1.id);

    const fresh = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-L7" } });
    const r2 = await startSpecSession(fresh, { flow: "qa" });
    expect(r2.resumed).toBeUndefined();
    expect(existsSync(join(wt, "sisa.txt"))).toBe(false);   // worktree memang dibangun ulang
    const prompt = readFileSync(promptFilePath(r2.id), "utf8");
    expect(prompt).toContain("sebelumnya ditandai selesai");
    expect(prompt).not.toContain("Sesi ini MELANJUTKAN pekerjaan sesi sebelumnya");
    killSession(r2.id);
  });
});
```

- [x] **Step 2: Jalankan test**

Run:
```bash
env -u NODE_ENV -u DATABASE_URL -u HANOMAN_TMUX_SOCKET \
  TEST_DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman394_test" \
  pnpm --filter ./server exec vitest run test/session-resume.test.ts --no-file-parallelism
```
Expected: PASS (7 test). Bila test pertama gagal pada `headSha(wt)`, periksa apakah `revParse` memakai urutan `origin/<branchTo>` lebih dulu — itu satu-satunya ref yang ada di skenario ini.

- [x] **Step 3: Jalankan test tetangga jalur sesi**

Run:
```bash
env -u NODE_ENV -u DATABASE_URL -u HANOMAN_TMUX_SOCKET \
  TEST_DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman394_test" \
  pnpm --filter ./server exec vitest run test/session-launch.test.ts test/terminal.route.test.ts test/scheduler-engine.test.ts --no-file-parallelism
```
Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add server/test/session-resume.test.ts
git commit -m "test(spec-394): resume dari tip branch sesi + kunci regresi fresh & SPEC-172"
```

---

### Task 6: Kontrak `resumed` sampai ke toast

**Files:**
- Modify: `server/src/routes/terminal.ts:78`
- Modify: `src/src/api/client.ts:229-232`
- Modify: `src/src/App.tsx:47-48, 112, 1130-1131`
- Test: `server/test/terminal.route.test.ts`, `src/test/start-session-modal.test.tsx`

**Interfaces:**
- Consumes: `StartSpecResult.resumed` (Task 4).
- Produces:
  - `POST /terminal/sessions {spec,…}` → `201 { id }` atau `201 { id, resumed: true }`.
  - `StartSessionModal` prop `onStarted: (id: string, resumed?: boolean) => void`.

- [x] **Step 1: Tulis test route yang gagal**

Tambahkan di `server/test/terminal.route.test.ts`, di dalam `describe("terminal routes · sesi backlog")`:

```ts
  // SPEC-394 · respons menyebut apa yang benar-benar terjadi. Keluhan aslinya soal persepsi
  // ("malah membuat session baru"), jadi umpan baliknya tak boleh sama untuk dua hal berbeda.
  it("peluncuran pertama 201 {id} tanpa resumed; peluncuran lanjutan 201 {id, resumed:true}", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-394A", projectId: "p1", stage: "planned" });
    const a = await start("SPEC-394A", "qa");
    expect(a.statusCode).toBe(201);
    expect(a.json().resumed).toBeUndefined();

    // worktree tetap, pane dibunuh → peluncuran berikutnya adalah lanjutan
    killSession("spec-394a");
    const b = await start("SPEC-394A", "qa");
    expect(b.statusCode).toBe(201);
    expect(b.json()).toEqual({ id: "spec-394a", resumed: true });
  });
```

Pastikan `killSession` ada di import `../src/services/pty` pada berkas itu.

- [x] **Step 2: Jalankan test — pastikan GAGAL**

Run:
```bash
env -u NODE_ENV -u DATABASE_URL -u HANOMAN_TMUX_SOCKET \
  TEST_DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman394_test" \
  pnpm --filter ./server exec vitest run test/terminal.route.test.ts -t "resumed" --no-file-parallelism
```
Expected: FAIL — `b.json()` hanya `{ id: "spec-394a" }`.

- [x] **Step 3: Teruskan `resumed` di route**

`server/src/routes/terminal.ts`, ganti `return reply.code(201).send({ id: r.id });` di cabang `"spec" in parsed.data` menjadi:

```ts
        // SPEC-394 · ADR-0084 · `resumed` hanya muncul saat peluncuran benar-benar melanjutkan
        // artefak sesi sebelumnya. Aditif — klien yang hanya membaca `id` tak terpengaruh.
        return reply.code(201).send(r.resumed ? { id: r.id, resumed: true } : { id: r.id });
```

- [x] **Step 4: Jalankan test — pastikan LULUS**

Run:
```bash
env -u NODE_ENV -u DATABASE_URL -u HANOMAN_TMUX_SOCKET \
  TEST_DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman394_test" \
  pnpm --filter ./server exec vitest run test/terminal.route.test.ts --no-file-parallelism
```
Expected: PASS (seluruh berkas).

- [x] **Step 5: Tulis test UI yang gagal**

Buat/lengkapi `src/test/start-session-modal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StartSessionModal } from "../src/App";
import { api } from "../src/api/client";

const spec = { id: "SPEC-394", projectId: "p", title: "t", source: "qa", priority: "tinggi",
  stage: "planned", objective: "o", author: "a" } as never;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "getSettings").mockResolvedValue({
    model: "claude-opus-5", effort: "xhigh", agent: "claude",
    codex: { model: "gpt-5.6-sol", effort: "high" },
    goal: { enabled: false, condition: "" }, verifyScope: "changed",
  } as never);
  vi.spyOn(api, "getCodexVersion").mockResolvedValue({ version: null } as never);
});

describe("StartSessionModal · SPEC-394", () => {
  it("meneruskan resumed ke onStarted", async () => {
    vi.spyOn(api, "startSession").mockResolvedValue({ id: "spec-394", resumed: true } as never);
    const onStarted = vi.fn();
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={onStarted} />);
    await userEvent.click(await screen.findByRole("button", { name: "Mulai" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("spec-394", true));
  });

  it("peluncuran biasa meneruskan resumed falsy", async () => {
    vi.spyOn(api, "startSession").mockResolvedValue({ id: "spec-394" } as never);
    const onStarted = vi.fn();
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={onStarted} />);
    await userEvent.click(await screen.findByRole("button", { name: "Mulai" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("spec-394", undefined));
  });
});
```

- [x] **Step 6: Jalankan test UI — pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/start-session-modal.test.tsx`
Expected: FAIL — `onStarted` dipanggil dengan satu argumen saja.

- [x] **Step 7: Rambatkan `resumed` di frontend**

`src/src/api/client.ts` — ubah tipe respons `startSession`:

```ts
    // SPEC-394 · `resumed` ada hanya saat peluncuran melanjutkan artefak sesi sebelumnya.
    j<{ id: string; resumed?: boolean }>(paths.terminalSessions, { method: "POST", ...body(b) }),
```

`src/src/App.tsx` — tanda tangan prop (baris 48):

```ts
  { open: boolean; spec: Spec | null; onClose: () => void;
    onStarted: (id: string, resumed?: boolean) => void; onError?: (e: unknown) => void }
```

Isi `start()` (baris 107-112):

```ts
      const { id, resumed } = await api.startSession({
        spec: s.id, flow, model, effort, agent,
        goal: goalOn, goalCondition: goalOn && goalCond.trim() ? goalCond.trim() : undefined,
        verifyScope,
      });
      onStarted(id, resumed); onClose();
```

Toast (baris 1131):

```tsx
          onStarted={(id, resumed) => showToast(
            (startSpec?.id ?? "") + " · sesi " + id + (resumed ? " dilanjutkan" : " dimulai"),
            "info", "play")}
```

- [x] **Step 8: Jalankan test UI — pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/start-session-modal.test.tsx`
Expected: PASS (2 test).

- [x] **Step 9: Typecheck kedua paket yang tersentuh**

Run: `pnpm --filter ./server typecheck && pnpm --filter ./src typecheck`
Expected: exit 0 keduanya.

- [x] **Step 10: Commit**

```bash
git add server/src/routes/terminal.ts server/test/terminal.route.test.ts \
        src/src/api/client.ts src/src/App.tsx src/test/start-session-modal.test.tsx
git commit -m "feat(spec-394): respons & toast membedakan sesi dilanjutkan dari sesi baru"
```

---

### Task 7: Source of Truth — ADR-0084 + kontrak + skill + index

**Files:**
- Create: `internal/docs/adr/0084-melanjutkan-sesi-backlog.md`
- Modify: `internal/docs/architecture/api-contract.md` (blok `POST /terminal/sessions`, sekitar baris 395-401)
- Modify: `internal/skills/hanoman/SKILL.md` (bagian "Aturan Sesi & Eksekusi")
- Modify: `internal/docs/README.md` (taut ADR-0084)
- Modify: `internal/docs/adr/README.md` (narasi ADR-0084)

**Interfaces:**
- Consumes: keputusan di design doc + perilaku yang sudah terkunci test Task 3-6.
- Produces: nomor ADR **0084** (0083 sudah diklaim SPEC-386 di `origin/hanoman/spec-386`).

- [x] **Step 1: Verifikasi ulang nomor ADR sebelum mengklaim**

Run:
```bash
for b in $(git branch -a --format='%(refname:short)' | grep -E 'main|hanoman/'); do \
  git ls-tree -r --name-only "$b" -- internal/docs/adr 2>/dev/null | grep -E '008[3-9]'; done | sort -u
ls ../*/internal/docs/adr 2>/dev/null | grep -E '008[3-9]' | sort -u
```
Expected: hanya `0083-retensi-dokumen-audit.md`. Bila `0084` muncul, naikkan ke nomor bebas berikutnya dan sesuaikan seluruh rujukan di doc yang sudah ditulis (audit doc, design doc, komentar kode).

- [x] **Step 2: Tulis ADR-0084**

Buat `internal/docs/adr/0084-melanjutkan-sesi-backlog.md` dengan struktur ADR repo ini (Status · Konteks · Keputusan · Konsekuensi · Ditolak). Isi wajib:

- **Status:** accepted · memulihkan substansi ADR-0017 di arsitektur ADR-0024 · melengkapi ADR-0015/0002/0030.
- **Konteks:** tiga cacat terukur dari audit (pane mati lolos gerbang, `addWorktree` merebut path, `isContinue` hanya `stage === "done"`), plus bukti non-fast-forward, plus premis ADR-0024 yang terlalu kuat ("sesi tmux tak pernah terputus").
- **Keputusan:** tiga keadaan peluncuran (live/resume/fresh); dua bentuk resume (worktree utuh / dibangun ulang di tip `origin/hanoman/<id>` → `hanoman/<id>` → `headSha`); `baseSha` tak pernah ditulis ulang saat resume; prompt lanjutan sadar-fase; server tak pernah menulis berkas fase; `stage === "done"` tetap SPEC-172.
- **Konsekuensi:** (+) retry governor scheduler berhenti menghancurkan pekerjaan; (+) push di akhir sesi lanjutan fast-forward; (−) worktree lama kini bisa hidup lebih panjang (Tutup tetap menghapusnya); (−) resume mempercayai artefak di disk, jadi worktree rusak harus terdeteksi git (`worktreeAlive`), bukan `existsSync`.
- **Ditolak:** `claude --resume <sessionId>` (percakapan agen bukan kontrak hanoman & melanggar netralitas agen ADR-0074); server menulis sendiri berkas fase (state ganda); parameter `reuse` pada `addWorktree` ala ADR-0017 (menaruh keputusan di pemanggil membuat satu-satunya jalur penghapus worktree tetap satu baris).

- [x] **Step 3: Perbarui kontrak API**

`internal/docs/architecture/api-contract.md`, pada blok `POST /terminal/sessions`, sesudah baris `#     sesi backlog di worktree .worktrees/<spec>, prompt pipeline penuh.` sisipkan:

```
#     201 { id } · 201 { id, resumed: true } bila peluncuran MELANJUTKAN sesi yang sudah berjalan
#       (SPEC-394/ADR-0084). Tiga keadaan: pane tmux HIDUP → re-attach (ADR-0015); pane MATI atau
#       hilang tapi artefak masih ada (worktree .worktrees/<id> masih sah, ATAU tip
#       origin/hanoman/<id> → hanoman/<id> → Spec.headSha resolve) DAN stage ≠ done DAN baseSha
#       ada → resume: worktree utuh dipakai apa adanya (tak dihapus), atau dibangun ulang `--detach`
#       di tip branch sesi; baseSha & headSha TIDAK ditulis ulang (rentang review ADR-0030 tetap
#       dari basis asli); prompt = resumePrompt yang menyebut baris fase yang sudah tercatat.
#       Selain itu → fresh: persis perilaku sebelum SPEC-394. stage = done tetap jalur SPEC-172
#       (continuePrompt, worktree dari branchFrom).
```

- [x] **Step 4: Perbarui skill project**

`internal/skills/hanoman/SKILL.md`, di bagian **Aturan Sesi & Eksekusi**, tepat sesudah butir "**Satu backlog = satu sesi** (ADR-0015)", sisipkan butir baru:

```markdown
- **Sesi backlog DILANJUTKAN, bukan diulang** (SPEC-394/ADR-0084, memulihkan substansi ADR-0017 yang
  ikut tercabut bersama ADR-0024): `startSpecSession` punya **tiga** keadaan, bukan dua. **live** =
  pane tmux hidup → re-attach. **resume** = `stage ≠ done` + `baseSha` ada + artefak masih ada →
  lanjutkan. **fresh** = selain itu. **Pane MATI bukan sesi** — `remain-on-exit on` menahannya hanya
  agar layar terakhirnya terbaca, dan mengembalikannya sebagai sesi membuat tombol "Lanjutkan" diam
  (UI sudah menghitung `!exited`, jadi tombol itu muncul persis saat pane mati); ia dibunuh dulu lalu
  sesi dilahirkan ulang. Dua bentuk resume: worktree `.worktrees/<id>` yang masih sah dipakai **apa
  adanya** (jalur satu-satunya yang TIDAK memanggil `addWorktree` — helper itu selalu merebut path
  dengan `remove --force` + `rmSync`), atau — bila worktree hilang — dibangun ulang `--detach` di tip
  **`origin/hanoman/<id>` → `hanoman/<id>` → `Spec.headSha`**. Urutan itu mengikat: `origin/…` adalah
  ref yang `git push` di akhir sesi harus fast-forward, dan worktree yang lahir dari `branchFrom`
  membuat push itu **ditolak non-fast-forward** (terukur). `baseSha` & `headSha` **tak pernah ditulis
  ulang saat resume** (rentang review ADR-0030 tetap dari basis asli). Prompt-nya `resumePrompt` yang
  menyebut baris fase yang sudah tercatat + fase berikutnya + bentuk worktree-nya; server **tak pernah
  menulis** ke `$HANOMAN_PHASE_FILE` (tetap milik agen, append-only). `stage = done` tetap jalur
  SPEC-172 (`continuePrompt`, worktree dari `branchFrom`) — kerjanya umumnya sudah ter-merge.
  Respons: `201 { id, resumed: true }`. Berlaku juga untuk governor scheduler (jalur peluncuran sama).
```

- [x] **Step 5: Tautkan ADR di kedua index**

`internal/docs/README.md` — tambahkan baris ADR-0084 di daftar ADR, mengikuti format tetangganya (ADR-0083).

`internal/docs/adr/README.md` — **tidak dikerjakan di branch ini, sengaja.** Sub-index itu lahir di
SPEC-386 dan masih hidup di `origin/hanoman/spec-386` yang belum ter-merge ke base SPEC-394;
membuatnya di sini akan melahirkan berkas tandingan yang bentrok saat merge. Yang benar: saat
spec-386 dan spec-394 bertemu di `main`, tambahkan narasi ADR-0084 ke sub-index itu (aturan "ADR
baru wajib ditaut di KEDUANYA" berlaku begitu berkasnya ada).

- [x] **Step 6: Verifikasi integritas index**

Run: `npx tsx cli/src/hanoman.ts docs index --check`
Expected: exit 0 (`node cli/src/hanoman.ts` **gagal** — berkas TS, wajib lewat `tsx`).

- [x] **Step 7: Commit**

```bash
git add internal/docs/adr/0084-melanjutkan-sesi-backlog.md internal/docs/adr/README.md \
        internal/docs/README.md internal/docs/architecture/api-contract.md \
        internal/skills/hanoman/SKILL.md
git commit -m "docs(spec-394): ADR-0084 melanjutkan sesi backlog + kontrak, skill & index"
```

---

### Task 8: Verifikasi akhir end-to-end

**Files:** tak ada perubahan berkas — hanya bukti.

- [x] **Step 1: Jalankan seluruh test yang tersentuh perubahan**

Run:
```bash
env -u NODE_ENV -u DATABASE_URL -u HANOMAN_TMUX_SOCKET \
  TEST_DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman394_test" \
  pnpm --filter ./server exec vitest run test/session-resume.test.ts test/session-launch.test.ts \
  test/terminal.route.test.ts --no-file-parallelism
env -u NODE_ENV -u DATABASE_URL -u HANOMAN_TMUX_SOCKET pnpm --filter ./runner exec vitest run
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/start-session-modal.test.tsx
```
Expected: semua PASS. Jangan menerima "no test files" sebagai bukti — pastikan jumlah test yang berjalan masuk akal.

- [x] **Step 2: Smoke endpoint nyata (task ini menyentuh endpoint)**

Boot server ke DB sekali-pakai yang sudah dimigrasi (JANGAN `hanoman_test` — run tetangga men-truncate di tengah smoke), lalu buktikan siklus penuh dengan `curl`:

```bash
# 1. build + boot
pnpm build
env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman394_smoke" \
  PORT=8899 HANOMAN_TMUX_SOCKET=hanoman-smoke394 node server/dist/server.js &
# 2. setup akun + login (cookie), buat project ter-bind ke repo scratch, buat spec
# 3. POST /api/terminal/sessions {spec,flow:"qa"}  → 201 {id}, tanpa `resumed`
# 4. tulis berkas ke .worktrees/<id>, DELETE pane lewat tmux kill-session (BUKAN DELETE /terminal/sessions,
#    yang memang menghapus worktree), lalu POST ulang → 201 {id, resumed:true}
# 5. buktikan berkas tadi masih ada di worktree
```
Expected: langkah 3 tanpa `resumed`, langkah 4 dengan `resumed: true`, langkah 5 berkasnya masih ada.

- [x] **Step 3: Diff bersih & push**

```bash
git status --porcelain          # kosong
git push origin HEAD:refs/heads/hanoman/spec-394
```
