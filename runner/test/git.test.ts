import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
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

  // ADR-0009: branch yang dihapus sebelum sesi dibuka gagal keras dan menyebut namanya,
  // bukan mundur diam-diam ke main.
  it("fails loud and names the missing branch", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "spec-hantu");
    expect(() => realGit.addWorktree(repo, wt, "tidak-ada")).toThrow(/tidak-ada/);
  });
});
