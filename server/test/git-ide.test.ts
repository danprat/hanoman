import { describe, it, expect } from "vitest";
import { makeTempRepo, makeRepoWithBranches, makeRepoWithSpecCommits, makeRepoWithSpecBranch, makeRepoWithChanges } from "./factory";
import { listRepoTree, readRepoFile, repoAbsPath, listGraph, commitDetail, writeRepoFile, runGitOp, validateGitOp, workingStatus, workingFileDiff } from "../src/services/git-ide";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const NUL = "a" + String.fromCharCode(0) + "b";

describe("git-ide read", () => {
  it("listRepoTree working tree = tracked ∪ untracked, sorted", async () => {
    const dir = makeTempRepo({ "src/a.ts": "1", "README.md": "x" });
    expect(await listRepoTree(dir)).toEqual(["README.md", "src/a.ts"]);
  });
  it("listRepoTree at a ref = snapshot ls-tree", async () => {
    const dir = makeRepoWithBranches("dev"); // punya README.md ter-commit di main
    expect(await listRepoTree(dir, "main")).toEqual(["README.md"]);
  });
  it("listRepoTree: repoDir null / bukan repo → []", async () => {
    expect(await listRepoTree(null)).toEqual([]);
    expect(await listRepoTree(makeTempRepo({}) + "/nope")).toEqual([]);
  });
  it("readRepoFile working tree membaca isi disk", async () => {
    const dir = makeTempRepo({ "a.txt": "halo\n" });
    expect(await readRepoFile(dir, "a.txt")).toMatchObject({ content: "halo\n", binary: false });
  });
  it("readRepoFile at a ref membaca via git show", async () => {
    const dir = makeRepoWithBranches();
    expect((await readRepoFile(dir, "README.md", "main"))!.content).toBe("x");
  });
  it("readRepoFile: NUL byte → binary, content null", async () => {
    const dir = makeTempRepo({ "b.bin": NUL });
    expect(await readRepoFile(dir, "b.bin")).toMatchObject({ binary: true, content: null });
  });
  it("readRepoFile: file tak ada → null", async () => {
    expect(await readRepoFile(makeTempRepo({}), "ghost.txt")).toBeNull();
  });
  it("repoAbsPath menolak keluar repo & .git", () => {
    const dir = makeTempRepo({});
    expect(() => repoAbsPath(dir, "../etc/passwd")).toThrow();
    expect(() => repoAbsPath(dir, ".git/config")).toThrow();
    expect(repoAbsPath(dir, "src/a.ts")).toBe(`${dir}/src/a.ts`);
  });
});

describe("git-ide graph", () => {
  it("listGraph mengembalikan commit terurut + refs + current branch", async () => {
    const dir = makeRepoWithSpecCommits({ "a.txt": "1" }, [{ msg: "kedua", changes: { "a.txt": "2" } }]);
    const g = await listGraph(dir);
    expect(g.commits.length).toBe(2);
    expect(g.commits[0]!.subject).toBe("kedua");
    expect(g.commits[0]!.parents.length).toBe(1);
    expect(g.commits[1]!.parents.length).toBe(0); // root
    expect(g.current).toBe("main");
    expect(g.commits.some((c) => c.refs.includes("main"))).toBe(true);
  });
  it("listGraph: repoDir null → kosong", async () => {
    expect(await listGraph(null)).toEqual({ commits: [], current: "" });
  });
  it("commitDetail: file berubah + pesan", async () => {
    const dir = makeRepoWithSpecCommits({ "a.txt": "1" }, [{ msg: "ubah", changes: { "a.txt": "2\n" } }]);
    const head = (await listGraph(dir)).commits[0]!.sha;
    const d = await commitDetail(dir, head);
    expect(d!.subject).toBe("ubah");
    expect(d!.changed.map((c) => c.path)).toEqual(["a.txt"]);
    expect(d!.changed[0]!).toMatchObject({ status: "M" });
  });
  it("commitDetail: sha bukan hex → null (gerbang)", async () => {
    expect(await commitDetail(makeRepoWithSpecCommits({ "a": "1" }, []), "../etc")).toBeNull();
  });
});

describe("git-ide write + mutate", () => {
  it("writeRepoFile menulis ke disk lewat path-guard", async () => {
    const dir = makeTempRepo({});
    await writeRepoFile(dir, "sub/x.ts", "isi\n");
    expect(readFileSync(`${dir}/sub/x.ts`, "utf8")).toBe("isi\n");
  });
  it("writeRepoFile menolak path keluar repo", async () => {
    await expect(writeRepoFile(makeTempRepo({}), "../evil", "x")).rejects.toThrow();
  });
  it("runGitOp checkout memindah HEAD", async () => {
    const dir = makeRepoWithBranches("dev");
    const r = await runGitOp(dir, { op: "checkout", ref: "dev" });
    expect(r.ok).toBe(true);
    expect(r.current).toBe("dev");
  });
  it("runGitOp checkout ref tak ada → ok:false + stderr (bukan throw)", async () => {
    const r = await runGitOp(makeRepoWithBranches(), { op: "checkout", ref: "ghost" });
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/ghost|did not match|pathspec/i);
  });
  it("runGitOp branch + checkout membuat & pindah", async () => {
    const dir = makeRepoWithBranches();
    const r = await runGitOp(dir, { op: "branch", name: "feat-x", checkout: true });
    expect(r.ok).toBe(true);
    expect(r.current).toBe("feat-x");
  });
  it("validateGitOp menolak op tak dikenal & field kurang", () => {
    expect(validateGitOp({ op: "nuke" })).toBeTruthy();
    expect(validateGitOp({ op: "checkout" })).toBeTruthy();
    expect(validateGitOp({ op: "checkout", ref: "main" })).toBeNull();
  });
});

describe("git-ide merge fast-forward opsional (SPEC-193)", () => {
  const parentsOf = (dir: string): string[] =>
    spawnSync("git", ["rev-list", "--parents", "-n1", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim().split(" ");

  // main & dev di base yang sama, lalu dev MAJU 1 commit → dev bisa di-fast-forward ke main.
  // HEAD ditinggal di main (tertinggal 1 commit di belakang dev).
  function makeFfRepo(): string {
    const dir = makeRepoWithBranches("dev");
    const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
    g("checkout", "-q", "dev"); writeFileSync(`${dir}/on-dev.txt`, "d"); g("add", "-A"); g("commit", "-qm", "dev ahead");
    g("checkout", "-q", "main");
    return dir;
  }

  // main & dev sama-sama maju 1 commit dari base (file beda) → divergen, tak bisa fast-forward.
  function makeDivergentRepo(): string {
    const dir = makeRepoWithBranches("dev");
    const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
    writeFileSync(`${dir}/on-main.txt`, "m"); g("add", "-A"); g("commit", "-qm", "main advance");
    g("checkout", "-q", "dev"); writeFileSync(`${dir}/on-dev.txt`, "d"); g("add", "-A"); g("commit", "-qm", "dev advance");
    g("checkout", "-q", "main");
    return dir;
  }

  it("merge --no-ff selalu buat merge commit (walau bisa ff)", async () => {
    const dir = makeFfRepo();
    const r = await runGitOp(dir, { op: "merge", ref: "dev", ff: "no-ff" });
    expect(r.ok).toBe(true);
    expect(parentsOf(dir).length).toBe(3); // commit + 2 parent = merge commit
  });

  it("merge --ff-only gagal saat divergen (ok:false, bukan throw)", async () => {
    const r = await runGitOp(makeDivergentRepo(), { op: "merge", ref: "dev", ff: "ff-only" });
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/not possible to fast-forward|fast-forward/i);
  });

  it("merge tanpa ff = default (fast-forward: HEAD pindah tanpa merge commit)", async () => {
    const dir = makeFfRepo();
    const r = await runGitOp(dir, { op: "merge", ref: "dev" });
    expect(r.ok).toBe(true);
    expect(parentsOf(dir).length).toBe(2); // ff ke commit dev (1 parent) → commit + 1 parent
  });

  it("validateGitOp: ff harus no-ff/ff-only bila ada; absen valid", () => {
    expect(validateGitOp({ op: "merge", ref: "x", ff: "bogus" })).toBeTruthy();
    expect(validateGitOp({ op: "merge", ref: "x", ff: "no-ff" })).toBeNull();
    expect(validateGitOp({ op: "merge", ref: "x", ff: "ff-only" })).toBeNull();
    expect(validateGitOp({ op: "merge", ref: "x" })).toBeNull();
  });
});

describe("git-ide merge + hapus branch local & origin (SPEC-193)", () => {
  const list = (dir: string, ...a: string[]) =>
    spawnSync("git", a, { cwd: dir, encoding: "utf8" }).stdout.trim();

  it("merge deleteBranch: hapus branch local + origin setelah merge sukses", async () => {
    const { repoDir } = makeRepoWithSpecBranch("btest"); // main; branch hanoman/btest ada local + origin
    const branch = "hanoman/btest";
    const r = await runGitOp(repoDir, { op: "merge", ref: branch, deleteBranch: branch });
    expect(r.ok).toBe(true);
    expect(list(repoDir, "branch", "--list", branch)).toBe("");          // local terhapus
    expect(list(repoDir, "ls-remote", "origin", branch)).toBe("");       // origin terhapus
  });

  it("merge deleteBranch tanpa origin: hapus local saja, tetap ok", async () => {
    const dir = makeRepoWithBranches("dev");
    const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
    g("checkout", "-q", "dev"); writeFileSync(`${dir}/z.txt`, "z"); g("add", "-A"); g("commit", "-qm", "dev ahead"); g("checkout", "-q", "main");
    const r = await runGitOp(dir, { op: "merge", ref: "dev", deleteBranch: "dev" });
    expect(r.ok).toBe(true);
    expect(list(dir, "branch", "--list", "dev")).toBe("");
  });

  it("merge gagal (konflik) TIDAK menghapus branch", async () => {
    // main & branch mengubah file sama → merge konflik; deleteBranch tak boleh jalan
    const { repoDir } = makeRepoWithSpecBranch("cft", { base: { "f.txt": "base\n" }, work: { "f.txt": "work\n" }, mainAdvance: { "f.txt": "main\n" } });
    const branch = "hanoman/cft";
    const r = await runGitOp(repoDir, { op: "merge", ref: branch, deleteBranch: branch });
    expect(r.ok).toBe(false);
    expect(list(repoDir, "branch", "--list", branch)).toBe(branch); // branch masih ada
  });

  it("validateGitOp: deleteBranch harus string tak kosong bila ada", () => {
    expect(validateGitOp({ op: "merge", ref: "x", deleteBranch: "" })).toBeTruthy();
    expect(validateGitOp({ op: "merge", ref: "x", deleteBranch: "dev" })).toBeNull();
  });
});

describe("git-ide hapus branch local &/atau origin standalone (SPEC-206)", () => {
  const list = (dir: string, ...a: string[]) =>
    spawnSync("git", a, { cwd: dir, encoding: "utf8" }).stdout.trim();
  const branch = "hanoman/btest";

  it("delete-branch remote:true → hapus branch local + origin", async () => {
    const { repoDir } = makeRepoWithSpecBranch("btest"); // main; branch local + origin
    const r = await runGitOp(repoDir, { op: "delete-branch", name: branch, remote: true, force: true });
    expect(r.ok).toBe(true);
    expect(list(repoDir, "branch", "--list", branch)).toBe("");        // local terhapus
    expect(list(repoDir, "ls-remote", "origin", branch)).toBe("");     // origin terhapus
  });

  it("delete-branch local:false remote:true → hapus origin saja, local tetap", async () => {
    const { repoDir } = makeRepoWithSpecBranch("btest");
    const r = await runGitOp(repoDir, { op: "delete-branch", name: branch, local: false, remote: true });
    expect(r.ok).toBe(true);
    expect(list(repoDir, "branch", "--list", branch)).toBe(branch);    // local tetap
    expect(list(repoDir, "ls-remote", "origin", branch)).toBe("");     // origin terhapus
  });

  it("delete-branch default → hapus local saja, origin tetap", async () => {
    const { repoDir } = makeRepoWithSpecBranch("btest");
    const r = await runGitOp(repoDir, { op: "delete-branch", name: branch, force: true });
    expect(r.ok).toBe(true);
    expect(list(repoDir, "branch", "--list", branch)).toBe("");        // local terhapus
    expect(list(repoDir, "ls-remote", "origin", branch)).not.toBe(""); // origin tetap
  });

  it("delete-branch remote:true origin tak ada → ok:false + stderr (local tetap terhapus)", async () => {
    const dir = makeRepoWithBranches("dev"); // tanpa origin
    const r = await runGitOp(dir, { op: "delete-branch", name: "dev", remote: true });
    expect(r.ok).toBe(false);                                          // push --delete gagal (no origin)
    expect(list(dir, "branch", "--list", "dev")).toBe("");             // local sudah terhapus lebih dulu
  });
});

describe("git-ide working status (SPEC-234)", () => {
  it("memisah staged (index vs HEAD) dari unstaged (working tree vs index) + untracked", async () => {
    const s = await workingStatus(makeRepoWithChanges());
    expect(s.branch).toBe("main");
    expect(s.staged.map((c) => c.path)).toEqual(["staged.txt"]);
    expect(s.staged[0]!).toMatchObject({ status: "M", add: 1, del: 0, binary: false });
    // unstaged terurut path: new.txt (untracked→A), tracked.txt (M)
    expect(s.unstaged.map((c) => c.path)).toEqual(["new.txt", "tracked.txt"]);
    expect(s.unstaged.find((c) => c.path === "new.txt")!).toMatchObject({ status: "A", add: 2, del: 0 });
    expect(s.unstaged.find((c) => c.path === "tracked.txt")!).toMatchObject({ status: "M", add: 1, del: 0 });
  });
  it("repoDir null / bukan repo → kosong, tak throw", async () => {
    expect(await workingStatus(null)).toEqual({ branch: "", staged: [], unstaged: [] });
    expect(await workingStatus(makeTempRepo({}) + "/nope")).toEqual({ branch: "", staged: [], unstaged: [] });
  });
  it("working tree bersih → staged & unstaged kosong", async () => {
    expect(await workingStatus(makeRepoWithBranches())).toMatchObject({ branch: "main", staged: [], unstaged: [] });
  });
});

describe("git-ide working file-diff (SPEC-234)", () => {
  it("staged: diff index vs HEAD + isi index", async () => {
    const f = await workingFileDiff(makeRepoWithChanges(), "staged.txt", true);
    expect(f!.status).toBe("M");
    expect(f!.diff).toMatch(/\+two/);
    expect(f!.content).toBe("one\ntwo\n");
  });
  it("unstaged untracked: diff new-file penuh + isi disk", async () => {
    const f = await workingFileDiff(makeRepoWithChanges(), "new.txt", false);
    expect(f!.status).toBe("A");
    expect(f!.diff).toMatch(/\+brand/);
    expect(f!.diff).toMatch(/\+new/);
    expect(f!.content).toBe("brand\nnew\n");
  });
  it("unstaged tracked: diff working tree vs index", async () => {
    const f = await workingFileDiff(makeRepoWithChanges(), "tracked.txt", false);
    expect(f!.status).toBe("M");
    expect(f!.diff).toMatch(/\+more/);
  });
  it("file tak dalam changeset → null (gerbang 404)", async () => {
    expect(await workingFileDiff(makeRepoWithChanges(), "staged.txt", false)).toBeNull();
    expect(await workingFileDiff(makeRepoWithChanges(), "ghost.txt", true)).toBeNull();
  });
  it("path keluar repo / .git → throw (gerbang 400)", async () => {
    await expect(workingFileDiff(makeRepoWithChanges(), "../evil", true)).rejects.toThrow();
    await expect(workingFileDiff(makeRepoWithChanges(), ".git/config", false)).rejects.toThrow();
  });
});
