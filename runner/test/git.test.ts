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
describe("git worktree ops", () => {
  it("adds a worktree, commits, pushes, removes", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "run-1");
    realGit.addWorktree(repo, wt, "main");
    expect(existsSync(wt)).toBe(true);
    writeFileSync(join(wt, "new.txt"), "hi");
    realGit.commitAndPush(wt, "feat: x", "feat/run-1");
    expect(g(repo, "branch", "-r").stdout).toContain("origin/feat/run-1");
    realGit.removeWorktree(repo, wt);
    expect(existsSync(wt)).toBe(false);
  });

  // Project lokal tanpa `origin`: push selalu gagal, dan gagalnya terjadi setelah fase
  // terakhir sudah `done` — run yang pekerjaannya beres berakhir bukan `done`.
  it("lands branchTo locally when the repo has no remote", () => {
    const repo = mkdtempSync(join(tmpdir(), "noremote-"));
    g(repo, "init", "-q"); g(repo, "config", "user.email", "t@t"); g(repo, "config", "user.name", "t");
    writeFileSync(join(repo, "README.md"), "x"); g(repo, "add", "-A"); g(repo, "commit", "-qm", "init");
    g(repo, "branch", "-M", "main");

    const wt = join(repo, ".worktrees", "run-1");
    realGit.addWorktree(repo, wt, "main");
    writeFileSync(join(wt, "new.txt"), "hi");

    realGit.commitAndPush(wt, "feat: x", "feat/run-1");
    expect(g(repo, "branch", "--list", "feat/run-1").stdout).toContain("feat/run-1");
    expect(g(repo, "show", "feat/run-1:new.txt").stdout).toBe("hi");
    realGit.removeWorktree(repo, wt);
  });

  // ADR-0017. addWorktree biasanya menghapus paksa pohon sisa run sebelumnya. Run yang
  // dilanjutkan justru butuh isinya — spec dan plan yang ditulis fase-fase terdahulu.
  it("reuse: keeps an existing worktree untouched, but still rebuilds a missing one", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "run-1");
    realGit.addWorktree(repo, wt, "main");
    writeFileSync(join(wt, "plan.md"), "rencana fase Plan");

    realGit.addWorktree(repo, wt, "main", true);
    expect(existsSync(join(wt, "plan.md"))).toBe(true); // artefaknya selamat

    realGit.addWorktree(repo, wt, "main", false);
    expect(existsSync(wt)).toBe(true);
    expect(existsSync(join(wt, "plan.md"))).toBe(false); // tanpa reuse: dibangun ulang bersih

    realGit.removeWorktree(repo, wt);
    realGit.addWorktree(repo, wt, "main", true); // reuse tapi pohonnya hilang → buat baru
    expect(existsSync(wt)).toBe(true);
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

    const wt = join(repo, ".worktrees", "run-flag");
    realGit.addWorktree(repo, wt, "--force");
    expect(existsSync(wt)).toBe(true);
    expect(g(wt, "rev-parse", "HEAD").stdout.trim()).toBe(first); // bukan head
    realGit.removeWorktree(repo, wt);
  });

  // ADR-0009: branch yang dihapus sebelum run jalan gagal keras dan menyebut namanya,
  // bukan mundur diam-diam ke main.
  it("fails loud and names the missing branch", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "run-hantu");
    expect(() => realGit.addWorktree(repo, wt, "tidak-ada")).toThrow(/tidak-ada/);
  });

  it("switchBase moves the worktree onto another branch", () => {
    const { repo } = seedRepo();
    g(repo, "branch", "dev");
    const wt = join(repo, ".worktrees", "run-sb");
    realGit.addWorktree(repo, wt, "main");
    realGit.switchBase(wt, "dev");
    expect(g(wt, "rev-parse", "--abbrev-ref", "HEAD").stdout.trim()).toBe("dev");
    realGit.removeWorktree(repo, wt);
  });
});
