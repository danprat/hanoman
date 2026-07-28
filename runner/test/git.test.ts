import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { realGit } from "../src/git";
const g = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" });
function seedRepo() {
  const remote = mkdtempSync(join(tmpdir(), "remote-")); g(remote, "init", "--bare", "-q");
  const repo = mkdtempSync(join(tmpdir(), "repo-"));
  g(repo, "init", "-q"); g(repo, "config", "user.email", "t@t"); g(repo, "config", "user.name", "t");
  writeFileSync(join(repo, "README.md"), "x"); g(repo, "add", "-A"); g(repo, "commit", "-qm", "init");
  g(repo, "branch", "-M", "main"); g(repo, "remote", "add", "origin", remote); g(repo, "push", "-q", "origin", "main");
  return { repo, remote };
}

// commitAndPush dan switchBase hilang bersama runner headless (SPEC-162): agen sendiri yang
// commit dan push dari dalam sesi interaktifnya.
describe("git worktree ops", () => {
  it("membangun worktree lalu membuangnya", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "spec-1");
    realGit.addWorktree(repo, wt, "main");
    expect(existsSync(wt)).toBe(true);
    realGit.removeWorktree(repo, wt);
    expect(existsSync(wt)).toBe(false);
  });

  it("addWorktree mengembalikan baseSha", () => {
    const { repo } = seedRepo();
    const head = g(repo, "rev-parse", "HEAD").stdout.trim();
    const wt = join(repo, ".worktrees", "spec-sha");
    expect(realGit.addWorktree(repo, wt, "main")).toBe(head);
    realGit.removeWorktree(repo, wt);
  });

  // SPEC-176 · headSha dibaca sebelum removeWorktree untuk menyimpan ujung range review.
  it("headSha mengembalikan HEAD worktree", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "spec-head");
    const base = realGit.addWorktree(repo, wt, "main"); // detached di base, belum commit
    expect(realGit.headSha(wt)).toBe(base);
    realGit.removeWorktree(repo, wt);
  });

  // Worktree yang tertinggal dari sesi mati tak boleh memblokir sesi berikutnya: id backlog
  // item bisa dipakai ulang, dan "already exists" akan menyandera Start selamanya.
  it("merebut kembali .worktrees/<id> yang tertinggal", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "spec-ulang");
    realGit.addWorktree(repo, wt, "main");
    writeFileSync(join(wt, "kerja-lama.txt"), "x");
    expect(() => realGit.addWorktree(repo, wt, "main")).not.toThrow();
    expect(existsSync(join(wt, "kerja-lama.txt"))).toBe(false);  // pohon lama benar-benar dibuang
    realGit.removeWorktree(repo, wt);
  });

  // Worktree lahir detached: `main` boleh tetap ter-checkout di working tree utama (ADR-0002).
  it("worktree lahir detached, jadi branchFrom yang sedang dipakai tetap boleh", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "spec-detach");
    realGit.addWorktree(repo, wt, "main");   // `main` ter-checkout di repo utama
    expect(g(wt, "rev-parse", "--abbrev-ref", "HEAD").stdout.trim()).toBe("HEAD");
    realGit.removeWorktree(repo, wt);
  });

  // SPEC-143. `refs/heads/--force` adalah refname yang sah, jadi sebuah branch boleh bernama
  // `--force`: ia lolos whitelist (memang ada di repo) lalu `git worktree add --detach <path>
  // --force` membacanya sebagai OPSI. resolveCommit menyerahkan SHA, bukan nama.
  it("accepts a branch whose name looks like a flag", () => {
    const { repo } = seedRepo();
    // Branch bernama flag menunjuk commit PERTAMA, sementara HEAD sudah maju ke commit kedua.
    // Tanpa resolveCommit, git menelan `--force` sebagai opsi dan diam-diam memakai HEAD —
    // worktree terbangun di pohon yang salah tanpa satu pun error. Dua commit berbeda inilah
    // yang membedakan "branch dihormati" dari "branch diabaikan".
    const first = g(repo, "rev-parse", "HEAD").stdout.trim();
    g(repo, "update-ref", "refs/heads/--force", first);
    writeFileSync(join(repo, "kedua.txt"), "2"); g(repo, "add", "-A"); g(repo, "commit", "-qm", "second");
    const head = g(repo, "rev-parse", "HEAD").stdout.trim();
    expect(head).not.toBe(first);

    const wt = join(repo, ".worktrees", "spec-flag");
    realGit.addWorktree(repo, wt, "--force");
    expect(existsSync(wt)).toBe(true);
    expect(g(wt, "rev-parse", "HEAD").stdout.trim()).toBe(first); // bukan head
    realGit.removeWorktree(repo, wt);
  });

  // SPEC-244 · branch PRD/audit di-push dari worktree detached → hanya refs/remotes/origin/<b>
  // tersisa di mesin. resolveCommit harus fallback ke origin/<rev>.
  it("resolves a branchFrom that exists only on origin", () => {
    const { repo } = seedRepo();
    writeFileSync(join(repo, "f.txt"), "1"); g(repo, "add", "-A"); g(repo, "commit", "-qm", "c");
    const sha = g(repo, "rev-parse", "HEAD").stdout.trim();
    g(repo, "branch", "prd/x"); g(repo, "push", "-q", "origin", "prd/x");
    g(repo, "branch", "-D", "prd/x");                 // lokal hilang; origin/prd/x tetap
    const wt = join(repo, ".worktrees", "spec-origin");
    expect(realGit.addWorktree(repo, wt, "prd/x")).toBe(sha);
    realGit.removeWorktree(repo, wt);
  });

  // ADR-0009: branch yang dihapus sebelum sesi dibuka gagal keras dan menyebut namanya,
  // bukan mundur diam-diam ke main.
  it("fails loud and names the missing branch", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "spec-hantu");
    expect(() => realGit.addWorktree(repo, wt, "tidak-ada")).toThrow(/tidak-ada/);
  });

  // SPEC-197 · worktree bisa lenyap di tengah run (dipangkas sesi sibling). removeWorktree harus
  // toleran — DELETE /terminal/sessions tak boleh 500 hanya karena pohonnya sudah tak ada.
  // SPEC-362 · `git worktree remove` di bawahnya memakai tryGit (gagal-diam), jadi rmSync di baris
  // terakhir tetap jalan meski git menolak. Satu pemanggil yang salah karenanya bisa menghapus
  // seluruh checkout — itu benar-benar terjadi. Jaring pengaman terakhir: tolak repo itu sendiri.
  it("removeWorktree MENOLAK menghapus repo itu sendiri, dan isinya selamat", () => {
    const { repo } = seedRepo();
    expect(() => realGit.removeWorktree(repo, repo)).toThrow(/repo itu sendiri/);
    expect(existsSync(join(repo, "README.md"))).toBe(true);
    // path relatif yang menunjuk balik ke repo ditolak juga (dinormalkan dulu).
    expect(() => realGit.removeWorktree(repo, ".")).toThrow(/repo itu sendiri/);
    expect(existsSync(join(repo, "README.md"))).toBe(true);
  });

  it("removeWorktree pada path yang sudah hilang tak throw", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "spec-lenyap");
    realGit.addWorktree(repo, wt, "main");
    rmSync(wt, { recursive: true, force: true });     // pohonnya raib, registrasi git masih stale
    expect(() => realGit.removeWorktree(repo, wt)).not.toThrow();
    expect(() => realGit.removeWorktree(repo, wt)).not.toThrow(); // dobel-panggil pun aman
  });
});

// SPEC-222 · project from-scratch lahir tanpa repo; scaffold butuh worktree berbasis HEAD.
describe("git initRepo", () => {
  it("membuat repo dengan satu HEAD commit di direktori kosong", () => {
    const dir = mkdtempSync(join(tmpdir(), "init-"));
    realGit.initRepo(dir);
    expect(existsSync(join(dir, ".git"))).toBe(true);
    expect(g(dir, "rev-parse", "HEAD").status).toBe(0);          // HEAD resolves
    const wt = join(dir, ".worktrees", "scaffold-x");
    expect(() => realGit.addWorktree(dir, wt, "HEAD")).not.toThrow();
    realGit.removeWorktree(dir, wt);
  });

  it("membuat direktori bila belum ada", () => {
    const parent = mkdtempSync(join(tmpdir(), "init-parent-"));
    const dir = join(parent, "nested", "proj");
    realGit.initRepo(dir);
    expect(existsSync(join(dir, ".git"))).toBe(true);
  });

  it("idempoten: repo yang sudah punya commit tak berubah HEAD-nya", () => {
    const { repo } = seedRepo();
    const before = g(repo, "rev-parse", "HEAD").stdout.trim();
    realGit.initRepo(repo);
    expect(g(repo, "rev-parse", "HEAD").stdout.trim()).toBe(before); // no new commit
  });
});
