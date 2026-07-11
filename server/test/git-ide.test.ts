import { describe, it, expect } from "vitest";
import { makeTempRepo, makeRepoWithBranches, makeRepoWithSpecCommits } from "./factory";
import { listRepoTree, readRepoFile, repoAbsPath, listGraph, commitDetail } from "../src/services/git-ide";

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
    expect(g.commits[0].subject).toBe("kedua");
    expect(g.commits[0].parents.length).toBe(1);
    expect(g.commits[1].parents.length).toBe(0); // root
    expect(g.current).toBe("main");
    expect(g.commits.some((c) => c.refs.includes("main"))).toBe(true);
  });
  it("listGraph: repoDir null → kosong", async () => {
    expect(await listGraph(null)).toEqual({ commits: [], current: "" });
  });
  it("commitDetail: file berubah + pesan", async () => {
    const dir = makeRepoWithSpecCommits({ "a.txt": "1" }, [{ msg: "ubah", changes: { "a.txt": "2\n" } }]);
    const head = (await listGraph(dir)).commits[0].sha;
    const d = await commitDetail(dir, head);
    expect(d!.subject).toBe("ubah");
    expect(d!.changed.map((c) => c.path)).toEqual(["a.txt"]);
    expect(d!.changed[0]).toMatchObject({ status: "M" });
  });
  it("commitDetail: sha bukan hex → null (gerbang)", async () => {
    expect(await commitDetail(makeRepoWithSpecCommits({ "a": "1" }, []), "../etc")).toBeNull();
  });
});
