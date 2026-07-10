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

  // Agen men-commit pekerjaannya sendiri, jadi pohonnya bersih saat runOne sampai di sini.
  // `git commit` di atas pohon bersih keluar dengan status 1: dulu itu melempar setelah fase
  // terakhir done, menutupi sebab kematian run yang sesungguhnya (RUN-8804/8805).
  it("pushes the agent's own commits when the worktree is already clean", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "run-1");
    realGit.addWorktree(repo, wt, "main");
    writeFileSync(join(wt, "new.txt"), "hi");
    g(wt, "add", "-A"); g(wt, "commit", "-qm", "agen commit sendiri");

    expect(() => realGit.commitAndPush(wt, "feat: x", "feat/run-1")).not.toThrow();
    expect(g(repo, "branch", "-r").stdout).toContain("origin/feat/run-1");
    expect(g(repo, "show", "origin/feat/run-1:new.txt").stdout).toBe("hi");
    // Tidak ada commit kosong yang ditumpuk di atas milik agen.
    expect(g(repo, "log", "--format=%s", "-1", "origin/feat/run-1").stdout.trim()).toBe("agen commit sendiri");
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

  it("addWorktree mengembalikan baseSha, dan undefined saat reuse", () => {
    const { repo } = seedRepo();
    const head = g(repo, "rev-parse", "HEAD").stdout.trim();
    const wt = join(repo, ".worktrees", "run-sha");
    expect(realGit.addWorktree(repo, wt, "main")).toBe(head);
    expect(realGit.addWorktree(repo, wt, "main", true)).toBeUndefined();  // reuse: pohon sudah ada
    realGit.removeWorktree(repo, wt);
  });

  // Worktree run yang hilang dulu selalu dibangun ulang dari `branchFrom`, membuang commit yang
  // sudah pernah di-push run itu. `commitAndPush` berikutnya lalu menabrak tip remote yang tak
  // lagi jadi leluhurnya: ditolak non-fast-forward, dan run mati. Basis yang benar untuk
  // membangun ulang adalah tip milik run itu sendiri.
  it("membangun ulang worktree di atas headSha run, bukan branchFrom", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "run-ff");
    realGit.addWorktree(repo, wt, "main");
    writeFileSync(join(wt, "kerja.txt"), "hasil fase sebelumnya");
    const head = realGit.commitAndPush(wt, "hanoman feature SPEC-1", "hanoman/run-ff");
    realGit.removeWorktree(repo, wt);   // worktree lenyap: dipangkas, atau dihapus run yang sukses

    expect(realGit.addWorktree(repo, wt, "main", false, head)).toBe(head);
    expect(g(wt, "rev-parse", "HEAD").stdout.trim()).toBe(head);
    expect(existsSync(join(wt, "kerja.txt"))).toBe(true);   // kerja fase lalu ikut kembali

    // dan percobaan berikutnya fast-forward di atasnya, bukan ditolak
    writeFileSync(join(wt, "lagi.txt"), "percobaan kedua");
    expect(() => realGit.commitAndPush(wt, "hanoman feature SPEC-1", "hanoman/run-ff")).not.toThrow();
  });

  // `git push` tak meninggalkan ref lokal, dan removeWorktree memangkas reflog-nya — objek
  // headSha bisa hilang dari repo (gc) meski run-nya sukses. Itu bukan alasan untuk gagal.
  it("jatuh kembali ke branchFrom saat objek headSha sudah tidak ada", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "run-gc");
    const main = g(repo, "rev-parse", "main").stdout.trim();
    expect(realGit.addWorktree(repo, wt, "main", false, "0".repeat(40))).toBe(main);
    expect(g(wt, "rev-parse", "HEAD").stdout.trim()).toBe(main);
  });

  it("commitAndPush mengembalikan headSha worktree", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "run-head");
    const base = realGit.addWorktree(repo, wt, "main")!;
    writeFileSync(join(wt, "baru.txt"), "isi\n");
    const head = realGit.commitAndPush(wt, "pesan", "hanoman/run-head");
    expect(head).toMatch(/^[0-9a-f]{40}$/);
    expect(head).not.toBe(base);
    realGit.removeWorktree(repo, wt);
  });
});
