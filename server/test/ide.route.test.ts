import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeRepoWithBranches, makeRepoWithSpecBranch, makeRepoWithChanges } from "./factory";
import { createSession, killAll } from "../src/services/pty";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));
const app = buildApp({ requireAuth: false });

// Repo dgn dev MAJU 1 commit di depan main → merge dev bisa fast-forward (uji ff opsional).
function ffRepo(): string {
  const dir = makeRepoWithBranches("dev");
  const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
  g("checkout", "-q", "dev"); writeFileSync(`${dir}/x.txt`, "d"); g("add", "-A"); g("commit", "-qm", "dev ahead");
  g("checkout", "-q", "main");
  return dir;
}

beforeAll(async () => {
  await resetDb();
  await makeProject({ id: "ide", repoDir: makeRepoWithBranches("dev") });
  await makeProject({ id: "ffrepo", repoDir: ffRepo() });
  await makeProject({ id: "delrepo", repoDir: makeRepoWithSpecBranch("del").repoDir }); // branch hanoman/del local+origin
  await makeProject({ id: "delrepo2", repoDir: makeRepoWithSpecBranch("del2").repoDir }); // idem, untuk hapus mandiri (SPEC-206)
  await makeProject({ id: "delrepo3", repoDir: makeRepoWithSpecBranch("del3").repoDir });
  await makeProject({ id: "nodir", repoDir: null });
  await makeProject({ id: "chg", repoDir: makeRepoWithChanges() });
});

describe("ide routes", () => {
  it("GET /tree lists files; project tak ada → 404", async () => {
    const r = await app.inject({ url: "/api/projects/ide/tree" });
    expect(r.statusCode).toBe(200);
    expect(r.json().files).toContain("README.md");
    expect((await app.inject({ url: "/api/projects/ghost/tree" })).statusCode).toBe(404);
  });
  it("GET /file membaca isi; path keluar-repo → 400; hilang → 404", async () => {
    const ok = await app.inject({ url: "/api/projects/ide/file?path=README.md" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().content).toBe("x");
    expect((await app.inject({ url: "/api/projects/ide/file?path=../evil" })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/projects/ide/file?path=ghost" })).statusCode).toBe(404);
  });
  it("PUT /file menulis, TIDAK digerbang sesi aktif", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    createSession("ide", process.cwd());
    const r = await app.inject({ method: "PUT", url: "/api/projects/ide/file", payload: { path: "n.txt", content: "hi" } });
    expect(r.statusCode).toBe(200);
    killAll();
  });
  it("GET /graph mengembalikan commits + current", async () => {
    const r = await app.inject({ url: "/api/projects/ide/graph" });
    expect(r.statusCode).toBe(200);
    expect(["main", "dev"]).toContain(r.json().current); // worktree factory checkout main
    expect(Array.isArray(r.json().commits)).toBe(true);
  });
  it("POST /git checkout: sesi aktif → 409; force → 200", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    createSession("ide", process.cwd());
    const blocked = await app.inject({ method: "POST", url: "/api/projects/ide/git", payload: { op: "checkout", ref: "dev" } });
    expect(blocked.statusCode).toBe(409);
    const forced = await app.inject({ method: "POST", url: "/api/projects/ide/git", payload: { op: "checkout", ref: "dev", force: true } });
    expect(forced.statusCode).toBe(200);
    expect(forced.json().current).toBe("dev");
    killAll();
  });
  it("POST /git op buruk → 400; ref tak ada → 409 + stderr", async () => {
    expect((await app.inject({ method: "POST", url: "/api/projects/ide/git", payload: { op: "nuke" } })).statusCode).toBe(400);
    const bad = await app.inject({ method: "POST", url: "/api/projects/ide/git", payload: { op: "checkout", ref: "ghost" } });
    expect(bad.statusCode).toBe(409);
    expect(bad.json().error).toBeTruthy();
  });
  it("POST /git: project tanpa repoDir → 400", async () => {
    const r = await app.inject({ method: "POST", url: "/api/projects/nodir/git", payload: { op: "checkout", ref: "main" } });
    expect(r.statusCode).toBe(400);
  });
  it("POST /git merge: ff buruk → 400; --no-ff → 200 merge commit (SPEC-193)", async () => {
    const bad = await app.inject({ method: "POST", url: "/api/projects/ffrepo/git", payload: { op: "merge", ref: "dev", ff: "bogus" } });
    expect(bad.statusCode).toBe(400);
    const r = await app.inject({ method: "POST", url: "/api/projects/ffrepo/git", payload: { op: "merge", ref: "dev", ff: "no-ff" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().ok).toBe(true); // merge-commit vs ff dibuktikan di git-ide.test.ts (unit)
  });
  it("POST /git merge deleteBranch: hapus branch local+origin (SPEC-193); deleteBranch kosong → 400", async () => {
    const bad = await app.inject({ method: "POST", url: "/api/projects/delrepo/git", payload: { op: "merge", ref: "hanoman/del", deleteBranch: "" } });
    expect(bad.statusCode).toBe(400);
    const r = await app.inject({ method: "POST", url: "/api/projects/delrepo/git", payload: { op: "merge", ref: "hanoman/del", deleteBranch: "hanoman/del" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().ok).toBe(true);
    // branch tak lagi muncul di daftar branch project
    expect((await app.inject({ url: "/api/projects/delrepo/branches" })).json().branches).not.toContain("hanoman/del");
  });
  it("POST /git delete-branch origin saja: local tetap, origin lenyap (SPEC-206)", async () => {
    const r = await app.inject({ method: "POST", url: "/api/projects/delrepo2/git",
      payload: { op: "delete-branch", name: "hanoman/del2", local: false, remote: true } });
    expect(r.statusCode).toBe(200);
    expect(r.json().ok).toBe(true);
    const b = (await app.inject({ url: "/api/projects/delrepo2/branches" })).json();
    expect(b.branches).toContain("hanoman/del2");     // local tetap
    expect(b.remotes).not.toContain("hanoman/del2");  // origin lenyap
  });
  it("POST /git delete-branch local+origin (force): keduanya lenyap (SPEC-206)", async () => {
    const r = await app.inject({ method: "POST", url: "/api/projects/delrepo3/git",
      payload: { op: "delete-branch", name: "hanoman/del3", remote: true, force: true } });
    expect(r.statusCode).toBe(200);
    expect(r.json().ok).toBe(true);
    const b = (await app.inject({ url: "/api/projects/delrepo3/branches" })).json();
    expect(b.branches).not.toContain("hanoman/del3");
    expect(b.remotes).not.toContain("hanoman/del3");
  });

  it("POST /git/merge clean: merge branch spec ke current → 200 {status:clean} (SPEC-229)", async () => {
    await makeProject({ id: "gm1", repoDir: makeRepoWithSpecBranch("gm").repoDir }); // current main + hanoman/gm
    const r = await app.inject({ method: "POST", url: "/api/projects/gm1/git/merge", payload: { source: "hanoman/gm" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("clean");
  });
  it("POST /git/merge conflict: spawn sesi claude → 200 {status:conflict, sessionId} (SPEC-229)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeProject({ id: "gm2", repoDir: makeRepoWithSpecBranch("gm", {
      base: { "f.txt": "b\n" }, work: { "f.txt": "w\n" }, mainAdvance: { "f.txt": "m\n" } }).repoDir });
    const r = await app.inject({ method: "POST", url: "/api/projects/gm2/git/merge", payload: { source: "hanoman/gm" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("conflict");
    expect(typeof r.json().sessionId).toBe("string");
    killAll();
  });
  it("POST /git/merge source kosong → 400; project tanpa repoDir → 400 (SPEC-229)", async () => {
    expect((await app.inject({ method: "POST", url: "/api/projects/gm1/git/merge", payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/projects/nodir/git/merge", payload: { source: "main" } })).statusCode).toBe(400);
  });

  it("GET /status memisah staged & unstaged; project tak ada → 404 (SPEC-234)", async () => {
    const r = await app.inject({ url: "/api/projects/chg/status" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.branch).toBe("main");
    expect(b.staged.map((c: { path: string }) => c.path)).toEqual(["staged.txt"]);
    expect(b.unstaged.map((c: { path: string }) => c.path)).toEqual(["new.txt", "tracked.txt"]);
    expect((await app.inject({ url: "/api/projects/ghost/status" })).statusCode).toBe(404);
  });
  it("GET /status project tanpa repoDir → kosong 200 (SPEC-234)", async () => {
    const r = await app.inject({ url: "/api/projects/nodir/status" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ branch: "", staged: [], unstaged: [] });
  });
  it("GET /file-diff staged/unstaged; path buruk → 400; tak berubah → 404 (SPEC-234)", async () => {
    const st = await app.inject({ url: "/api/projects/chg/file-diff?path=staged.txt&staged=1" });
    expect(st.statusCode).toBe(200);
    expect(st.json().diff).toMatch(/\+two/);
    const un = await app.inject({ url: "/api/projects/chg/file-diff?path=new.txt" });
    expect(un.statusCode).toBe(200);
    expect(un.json().status).toBe("A");
    expect((await app.inject({ url: "/api/projects/chg/file-diff?path=../evil&staged=1" })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/projects/chg/file-diff?path=staged.txt" })).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/projects/chg/file-diff" })).statusCode).toBe(400);
  });
});
