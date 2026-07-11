import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeRepoWithBranches } from "./factory";
import { createSession, killAll } from "../src/services/pty";
import { fileURLToPath } from "node:url";

const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));
const app = buildApp({ requireAuth: false });

beforeAll(async () => {
  await resetDb();
  await makeProject({ id: "ide", repoDir: makeRepoWithBranches("dev") });
  await makeProject({ id: "nodir", repoDir: null });
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
});
