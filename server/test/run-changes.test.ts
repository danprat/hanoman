import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runChanges, runChangeFile, ChangesUnavailable, PREVIEW_LIMIT } from "../src/services/run-changes";

const g = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" });

// Repo dengan satu commit basis. `worktree` dibuat dari KODE, bukan Bash tool:
// deniesDangerous memblokir perintah Bash yang cocok /git\s+worktree\s+add/.
function seed(): { repo: string; base: string } {
  const repo = mkdtempSync(join(tmpdir(), "runchanges-"));
  g(repo, "init", "-q"); g(repo, "config", "user.email", "t@t"); g(repo, "config", "user.name", "t");
  writeFileSync(join(repo, "keep.txt"), "a\nb\nc\n");
  writeFileSync(join(repo, "gone.txt"), "x\n");
  g(repo, "add", "-A"); g(repo, "commit", "-qm", "base"); g(repo, "branch", "-M", "main");
  return { repo, base: g(repo, "rev-parse", "HEAD").stdout.trim() };
}
function addWorktree(repo: string, rel: string, base: string): string {
  const wt = join(repo, rel);
  g(repo, "worktree", "add", "--detach", wt, base);
  return wt;
}
// Hitung loose object (bukan pack) — untuk membuktikan jalur baca tak mencemari repo.
function looseObjects(repo: string): number {
  const root = join(repo, ".git", "objects");
  let n = 0;
  for (const d of readdirSync(root)) {
    if (d === "pack" || d === "info") continue;
    const p = join(root, d);
    if (statSync(p).isDirectory()) n += readdirSync(p).length;
  }
  return n;
}
const row = (worktree: string, baseSha: string | null, headSha: string | null = null) => ({ worktree, baseSha, headSha });

describe("runChanges — run hidup (worktree ada)", () => {
  it("menampilkan file UNTRACKED yang baru dibuat", async () => {
    const { repo, base } = seed();
    addWorktree(repo, ".worktrees/run-1", base);
    writeFileSync(join(repo, ".worktrees/run-1", "baru.md"), "satu\ndua\n");
    const c = await runChanges(row(".worktrees/run-1", base), repo);
    expect(c.files).toContainEqual({ path: "baru.md", add: 2, del: 0, status: "A", binary: false });
  });

  it("menampilkan file tracked yang diubah dan yang dihapus", async () => {
    const { repo, base } = seed();
    const wt = addWorktree(repo, ".worktrees/run-2", base);
    writeFileSync(join(wt, "keep.txt"), "a\nb\nc\nd\n");
    rmSync(join(wt, "gone.txt"));
    const c = await runChanges(row(".worktrees/run-2", base), repo);
    expect(c.files).toContainEqual({ path: "keep.txt", add: 1, del: 0, status: "M", binary: false });
    expect(c.files).toContainEqual({ path: "gone.txt", add: 0, del: 1, status: "D", binary: false });
  });

  it("menandai berkas biner, bukan NaN", async () => {
    const { repo, base } = seed();
    const wt = addWorktree(repo, ".worktrees/run-3", base);
    writeFileSync(join(wt, "b.bin"), Buffer.from([0, 1, 2, 3]));
    const c = await runChanges(row(".worktrees/run-3", base), repo);
    const f = c.files.find((x) => x.path === "b.bin")!;
    expect(f.binary).toBe(true);
    expect(Number.isNaN(f.add)).toBe(false);
  });

  it("path berspasi utuh (-z)", async () => {
    const { repo, base } = seed();
    const wt = addWorktree(repo, ".worktrees/run-4", base);
    writeFileSync(join(wt, "ada spasi.md"), "x\n");
    const c = await runChanges(row(".worktrees/run-4", base), repo);
    expect(c.files.map((f) => f.path)).toContain("ada spasi.md");
  });

  it("memuat commit yang dibuat agen di dalam worktree", async () => {
    const { repo, base } = seed();
    const wt = addWorktree(repo, ".worktrees/run-5", base);
    writeFileSync(join(wt, "a.md"), "x\n");
    g(wt, "add", "-A"); g(wt, "commit", "-qm", "commit agen");
    const c = await runChanges(row(".worktrees/run-5", base), repo);
    expect(c.commits.map((x) => x.subject)).toEqual(["commit agen"]);
  });

  it("tidak mengubah index worktree dan tidak mencemari object database", async () => {
    const { repo, base } = seed();
    const wt = addWorktree(repo, ".worktrees/run-6", base);
    writeFileSync(join(wt, "baru.md"), "satu\n");
    const before = g(wt, "status", "--porcelain", "-uall").stdout;

    await runChanges(row(".worktrees/run-6", base), repo);
    const after1 = looseObjects(repo);
    await runChanges(row(".worktrees/run-6", base), repo);
    const after2 = looseObjects(repo);

    expect(g(wt, "status", "--porcelain", "-uall").stdout).toBe(before);
    expect(after2).toBe(after1);            // idempoten: hanya blob kosong, sekali
  });
});

describe("runChanges — run selesai (worktree hilang)", () => {
  it("membaca diff dari object database lewat baseSha..headSha", async () => {
    const { repo, base } = seed();
    const wt = addWorktree(repo, ".worktrees/run-7", base);
    writeFileSync(join(wt, "hasil.md"), "x\ny\n");
    g(wt, "add", "-A"); g(wt, "commit", "-qm", "hasil");
    const head = g(wt, "rev-parse", "HEAD").stdout.trim();
    g(repo, "worktree", "remove", "--force", wt);

    const c = await runChanges(row(".worktrees/run-7", base, head), repo);
    expect(c.head).toBe(head);
    expect(c.files).toContainEqual({ path: "hasil.md", add: 2, del: 0, status: "A", binary: false });
    expect(c.commits.map((x) => x.subject)).toEqual(["hasil"]);
  });
});

describe("runChanges — kondisi yang harus dijawab jujur", () => {
  it("baseSha null → hasil kosong, bukan error", async () => {
    const { repo } = seed();
    const c = await runChanges(row(".worktrees/hantu", null), repo);
    expect(c).toEqual({ base: null, head: null, commits: [], files: [] });
  });

  it("project tanpa repoDir → ChangesUnavailable", async () => {
    await expect(runChanges(row(".worktrees/x", "aaa"), null)).rejects.toBeInstanceOf(ChangesUnavailable);
  });

  it("worktree hilang dan tak pernah commit → ChangesUnavailable", async () => {
    const { repo, base } = seed();
    await expect(runChanges(row(".worktrees/hantu", base), repo)).rejects.toBeInstanceOf(ChangesUnavailable);
  });

  it("headSha tak terjangkau → ChangesUnavailable yang menyebut sha-nya", async () => {
    const { repo, base } = seed();
    await expect(runChanges(row(".worktrees/hantu", base, "0".repeat(40)), repo))
      .rejects.toThrow(/0{40}/);
  });
});

describe("runChangeFile — gerbang path dan preview", () => {
  it("mengembalikan diff dan isi penuh file baru", async () => {
    const { repo, base } = seed();
    const wt = addWorktree(repo, ".worktrees/run-8", base);
    writeFileSync(join(wt, "baru.md"), "satu\ndua\n");
    const p = (await runChangeFile(row(".worktrees/run-8", base), repo, "baru.md"))!;
    expect(p.status).toBe("A");
    expect(p.content).toBe("satu\ndua\n");
    expect(p.diff).toContain("+satu");
    expect(p.truncated).toBe(false);
  });

  it("file terhapus → content null, diff tetap ada", async () => {
    const { repo, base } = seed();
    const wt = addWorktree(repo, ".worktrees/run-9", base);
    rmSync(join(wt, "gone.txt"));
    const p = (await runChangeFile(row(".worktrees/run-9", base), repo, "gone.txt"))!;
    expect(p.status).toBe("D");
    expect(p.content).toBeNull();
    expect(p.diff).toContain("-x");
  });

  it("berkas biner → tanpa diff, tanpa content", async () => {
    const { repo, base } = seed();
    const wt = addWorktree(repo, ".worktrees/run-10", base);
    writeFileSync(join(wt, "b.bin"), Buffer.from([0, 1, 2]));
    const p = (await runChangeFile(row(".worktrees/run-10", base), repo, "b.bin"))!;
    expect(p).toMatchObject({ binary: true, diff: null, content: null });
  });

  it("path di luar daftar changes → null (gerbang)", async () => {
    const { repo, base } = seed();
    addWorktree(repo, ".worktrees/run-11", base);
    expect(await runChangeFile(row(".worktrees/run-11", base), repo, "keep.txt")).toBeNull();
    expect(await runChangeFile(row(".worktrees/run-11", base), repo, "../../etc/passwd")).toBeNull();
  });

  it("content di atas 256 KB dipotong dan ditandai", async () => {
    const { repo, base } = seed();
    const wt = addWorktree(repo, ".worktrees/run-12", base);
    writeFileSync(join(wt, "besar.txt"), "a\n".repeat(PREVIEW_LIMIT));   // 2 × PREVIEW_LIMIT byte
    const p = (await runChangeFile(row(".worktrees/run-12", base), repo, "besar.txt"))!;
    expect(p.truncated).toBe(true);
    expect(p.content!.length).toBe(PREVIEW_LIMIT);
  });
});
