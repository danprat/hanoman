import { describe, it, expect, beforeAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app";
import { killAll, getSession, sessionPhasesBySpec } from "../src/services/pty";
import { prisma } from "../src/db";
import { resetDb, makeProject, makeSpec, makeRepoWithBranches, makeTempRepo, makeRepoWithWorktree, makeRepoWithSpecCommits, makeRepoWithSpecBranch } from "./factory";

// SPEC-198 · overlay stage-live baca tmux nyata; di test tak ada pane. Mock hanya
// sessionPhasesBySpec (sisanya asli) — default Map kosong = perilaku identik dgn env test
// tanpa sesi. Satu test memakainya untuk membuktikan write-through jalan atas SET PENUH.
vi.mock("../src/services/pty", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/pty")>();
  return { ...actual, sessionPhasesBySpec: vi.fn(() => new Map()) };
});

const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));
const app = buildApp({ requireAuth: false });
const brief = { context: "c", outcome: "o", constraints: "", priority: "sedang" as const };
let artifactRepo: string;
beforeAll(async () => {
  await resetDb();
  // repo nyata: branch `main` + `dev`. Daftar branch-nya adalah whitelist validasi (SPEC-143).
  await makeProject({ id: "p1", repoDir: makeRepoWithBranches("dev") });
  await makeSpec({ id: "SPEC-140", projectId: "p1", stage: "brainstorming" });
  await makeSpec({ id: "SPEC-137", projectId: "p1", stage: "done" });
  await makeSpec({ id: "SPEC-142", projectId: "p1", stage: "planned" });
  // SPEC-167 · project + spec `done` khusus uji revert-dengan-artefak.
  artifactRepo = makeTempRepo({
    "docs/superpowers/specs/2026-07-11-x-spec-200-design.md": "s",
    "docs/superpowers/plans/2026-07-11-x-spec-200.md": "p",
  });
  await makeProject({ id: "p2", repoDir: artifactRepo });
  await makeSpec({ id: "SPEC-200", projectId: "p2", stage: "done" });
  // SPEC-171 · project + spec dengan worktree berisi perubahan, dan satu spec tanpa worktree.
  const wtRepo = makeRepoWithWorktree("SPEC-171",
    { "keep.txt": "a\n" }, { "keep.txt": "a\nb\n", "new.txt": "baru\n" });
  await makeProject({ id: "pr", repoDir: wtRepo });
  await makeSpec({ id: "SPEC-171", projectId: "pr", stage: "executing", branchFrom: null });
  await makeSpec({ id: "SPEC-172", projectId: "pr", stage: "executing" });
  // SPEC-171 · item selesai: worktree lenyap, review jatuh ke commit history `(spec-N)`.
  const histRepo = makeRepoWithSpecCommits(
    { "keep.txt": "satu\n" },
    [{ msg: "feat(spec-901): ubah keep + tambah baru", changes: { "keep.txt": "satu\ndua\n", "new.md": "baru\n" } }]);
  await makeProject({ id: "ph", repoDir: histRepo });
  await makeSpec({ id: "SPEC-901", projectId: "ph", stage: "done" });
  // SPEC-176 · done via baseSha/headSha tersimpan; pesan commit SENGAJA tanpa (spec-N) →
  // grep specCommitRange pasti kosong, jadi 200 membuktikan SHA tersimpan yang dipakai.
  const shaRepo = makeRepoWithSpecCommits(
    { "keep.txt": "satu\n" },
    [{ msg: "ubah keep tanpa penanda spec", changes: { "keep.txt": "satu\ndua\n" } }]);
  const shaBase = execFileSync("git", ["rev-parse", "HEAD~1"], { cwd: shaRepo, encoding: "utf8" }).trim();
  const shaHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: shaRepo, encoding: "utf8" }).trim();
  await makeProject({ id: "psha", repoDir: shaRepo });
  await makeSpec({ id: "SPEC-960", projectId: "psha", stage: "done", baseSha: shaBase, headSha: shaHead });
  // SPEC-186 · edit konten selagi belum dimulai.
  await makeSpec({ id: "SPEC-186A", projectId: "p1", stage: "brainstorming",
    priority: "sedang", objective: "lama", payload: { context: "c0", outcome: "o0", constraints: "", priority: "sedang" } });
  await makeSpec({ id: "SPEC-186B", projectId: "p1", stage: "brainstorming",
    payload: { context: "", outcome: "", constraints: "", priority: "sedang" }, baseSha: "deadbeef" }); // sudah dimulai
});
describe("specs routes", () => {
  it("filters by project", async () => {
    const res = await app.inject({ url: "/api/specs?project=p1" });
    expect(res.json().items.every((s: any) => s.projectId === "p1")).toBe(true);
  });
  // SPEC-198 · envelope + filter + paginasi (di layer response, atas stage live).
  it("returns a pagination envelope", async () => {
    const res = await app.inject({ url: "/api/specs?project=p1" });
    const b = res.json();
    expect(Array.isArray(b.items)).toBe(true);
    expect(typeof b.total).toBe("number");
    expect(b.page).toBe(1);
    expect(b.items.every((s: any) => s.projectId === "p1")).toBe(true);
  });
  it("filters by q over id+title+objective (case-insensitive)", async () => {
    const b = (await app.inject({ url: "/api/specs?project=p1&q=SPEC-142" })).json();
    expect(b.items.some((s: any) => s.id === "SPEC-142")).toBe(true);
    expect(b.items.every((s: any) => s.id === "SPEC-142")).toBe(true);
  });
  it("filters by stage and priority", async () => {
    const planned = (await app.inject({ url: "/api/specs?project=p1&stage=planned" })).json();
    expect(planned.items.length).toBeGreaterThan(0);
    expect(planned.items.every((s: any) => s.stage === "planned")).toBe(true);
  });
  it("startable excludes done", async () => {
    const b = (await app.inject({ url: "/api/specs?project=p1&startable=true" })).json();
    expect(b.items.every((s: any) => s.stage !== "done")).toBe(true);
  });
  it("paginates: page/limit slice with full total", async () => {
    const all = (await app.inject({ url: "/api/specs?project=p1" })).json();
    expect(all.total).toBeGreaterThan(2);
    const p1 = (await app.inject({ url: "/api/specs?project=p1&page=1&limit=2" })).json();
    expect(p1.items.length).toBe(2);
    expect(p1.total).toBe(all.total);
    expect(p1.pageSize).toBe(2);
    const p2 = (await app.inject({ url: "/api/specs?project=p1&page=2&limit=2" })).json();
    expect(p2.items.map((s: any) => s.id)).not.toEqual(p1.items.map((s: any) => s.id));
  });
  // Fitur tersembunyi: overlay + write-through jalan atas SET PENUH, tak diciutkan paginasi.
  // Spec yang stage live-nya maju TETAP ter-persist walau ada di luar halaman.
  it("advances + persists off-page specs even when paginated (overlay over full set)", async () => {
    await makeProject({ id: "ppage", repoDir: makeTempRepo({}) });
    await makeSpec({ id: "SPEC-501", projectId: "ppage", stage: "brainstorming" });
    await makeSpec({ id: "SPEC-500", projectId: "ppage", stage: "brainstorming" });
    // Sesi live (mock) memajukan SPEC-500 brainstorming → planned. stageForRun tak menggerbang
    // stage non-`done` dgn plan, jadi cwd palsu cukup.
    vi.mocked(sessionPhasesBySpec).mockReturnValueOnce(
      new Map([["SPEC-500", { phases: [{ name: "Plan", state: "done" }], cwd: "/tmp/none" }]]) as any);
    // id desc → SPEC-501 di halaman 1; limit=1 menaruh SPEC-500 DI LUAR halaman.
    const res = await app.inject({ url: "/api/specs?project=ppage&page=1&limit=1" });
    expect(res.json().items.some((s: any) => s.id === "SPEC-500")).toBe(false);
    const row = await prisma.spec.findUnique({ where: { id: "SPEC-500" } });
    expect(row?.stage).toBe("planned"); // write-through jalan walau item di luar halaman
  });
  it("creates a brief spec with next id", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/specs", payload: {
        project: "p1", source: "brief", title: "New", priority: "sedang", payload: brief
      }
    });
    expect(res.statusCode).toBe(201); expect(res.json().id).toMatch(/^SPEC-\d+$/); expect(res.json().stage).toBe("brainstorming");
  });

  // SPEC-237 · source audit (audit-only) memakai payload brief-shaped; author berawalan `Audit ·`.
  it("creates an audit spec with a brief-shaped payload", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/specs", payload: {
        project: "p1", source: "audit", title: "Audit funnel", priority: "tinggi",
        payload: { context: "cek double count", outcome: "akar masalah", constraints: "", priority: "tinggi" }
      }
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().source).toBe("audit");
    expect(res.json().author).toContain("Audit");
  });
  it("rejects an audit spec that carries a qa payload (severity)", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/specs", payload: {
        project: "p1", source: "audit", title: "salah", priority: "tinggi",
        payload: { severity: "major", steps: "s", expected: "e", actual: "a", env: "prod" }
      }
    });
    expect(res.statusCode).toBe(400);
  });

  // SPEC-143
  it("stores a valid branchFrom", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/specs", payload: {
        project: "p1", source: "brief", title: "B", priority: "sedang", branchFrom: "dev", payload: brief
      }
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().branchFrom).toBe("dev");
  });
  it("rejects a branch that does not exist in the repo", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/specs", payload: {
        project: "p1", source: "brief", title: "B", priority: "sedang", branchFrom: "hantu", payload: brief
      }
    });
    expect(res.statusCode).toBe(400);
  });
  // Validasi branch memaksa POST memuat baris Project — efek samping yang diinginkan:
  // project tak dikenal jadi 404 jujur, bukan pelanggaran foreign-key.
  it("404s on an unknown project instead of a foreign-key blow-up", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/specs", payload: {
        project: "hantu", source: "brief", title: "B", priority: "sedang", payload: brief
      }
    });
    expect(res.statusCode).toBe(404);
  });
  it("defaults branchFrom to null when omitted (QA source too)", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/specs", payload: {
        project: "p1", source: "qa", title: "Q", priority: "tinggi",
        payload: { severity: "major", steps: "s", expected: "e", actual: "a", env: "prod" }
      }
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().branchFrom).toBeNull();
  });
  it("PATCH sets the branch", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/specs/SPEC-140", payload: { branchFrom: "dev" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().branchFrom).toBe("dev");
  });
  it("PATCH with null clears the branch back to the project default", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/specs/SPEC-140", payload: { branchFrom: null } });
    expect(res.statusCode).toBe(200);
    expect(res.json().branchFrom).toBeNull();
  });
  it("PATCH rejects an unknown branch", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/specs/SPEC-140", payload: { branchFrom: "hantu" } });
    expect(res.statusCode).toBe(400);
  });
  it("PATCH 404s on an unknown spec", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/specs/SPEC-999", payload: { branchFrom: null } });
    expect(res.statusCode).toBe(404);
  });

  // SPEC-167 — revert stage backward-only
  it("reverts stage backward (no artefak) → 200 + stage baru", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/specs/SPEC-142", payload: { stage: "objective" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().stage).toBe("objective");
  });
  it("rejects a forward/same stage with 422", async () => {
    const up = await app.inject({ method: "PATCH", url: "/api/specs/SPEC-140", payload: { stage: "planned" } });
    expect(up.statusCode).toBe(422);
    const same = await app.inject({ method: "PATCH", url: "/api/specs/SPEC-137", payload: { stage: "done" } });
    expect(same.statusCode).toBe(422);
  });
  it("400s on an unknown stage value", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/specs/SPEC-137", payload: { stage: "hantu" } });
    expect(res.statusCode).toBe(400);
  });
  it("dry-run: artefak ada tanpa confirmDelete → pending + wouldDelete, tak mengubah apa pun", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/specs/SPEC-200", payload: { stage: "objective" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().pending).toBe(true);
    expect(res.json().wouldDelete.sort()).toEqual([
      "docs/superpowers/plans/2026-07-11-x-spec-200.md",
      "docs/superpowers/specs/2026-07-11-x-spec-200-design.md",
    ]);
    const after = await app.inject({ url: "/api/specs?project=p2" });
    expect(after.json().items.find((s: any) => s.id === "SPEC-200").stage).toBe("done");
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    expect(existsSync(join(artifactRepo, "docs/superpowers/plans/2026-07-11-x-spec-200.md"))).toBe(true);
  });
  it("execute: confirmDelete true → stage berubah + berkas terhapus dari disk", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/api/specs/SPEC-200",
      payload: { stage: "objective", confirmDelete: true }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().stage).toBe("objective");
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    expect(existsSync(join(artifactRepo, "docs/superpowers/plans/2026-07-11-x-spec-200.md"))).toBe(false);
    expect(existsSync(join(artifactRepo, "docs/superpowers/specs/2026-07-11-x-spec-200-design.md"))).toBe(false);
  });

  // SPEC-186 — edit backlog selagi belum dimulai
  it("PATCH edit title/priority/payload → 200, objective dihitung ulang", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/api/specs/SPEC-186A",
      payload: { title: "Judul baru", priority: "tinggi",
        payload: { context: "c1", outcome: "hasil baru", constraints: "x", priority: "tinggi" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe("Judul baru");
    expect(res.json().priority).toBe("tinggi");
    expect(res.json().objective).toBe("hasil baru");     // outcome → objective
    expect(res.json().payload.context).toBe("c1");
  });
  it("PATCH konten pada item yang sudah dimulai (baseSha) → 409", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/api/specs/SPEC-186B", payload: { title: "tak boleh" },
    });
    expect(res.statusCode).toBe(409);
  });
  it("PATCH konten pada item stage maju → 409", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/api/specs/SPEC-137", payload: { title: "tak boleh" }, // SPEC-137 stage done
    });
    expect(res.statusCode).toBe(409);
  });

  it("deletes a spec", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/specs/SPEC-142" });
    expect(res.statusCode).toBe(204);
  });
});

// SPEC-171 · review worktree backlog item.
describe("GET /specs/:id/review", () => {
  it("mengembalikan base, files, changed", async () => {
    const res = await app.inject({ url: "/api/specs/SPEC-171/review" });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.files).toContain("new.txt");
    expect(b.changed.map((c: any) => c.path).sort()).toEqual(["keep.txt", "new.txt"]);
  });
  it("worktree tak ada & tanpa commit → 409", async () => {
    const res = await app.inject({ url: "/api/specs/SPEC-172/review" });
    expect(res.statusCode).toBe(409);
  });
  it("item selesai tanpa worktree → review dari commit history (200)", async () => {
    const res = await app.inject({ url: "/api/specs/SPEC-901/review" });
    expect(res.statusCode).toBe(200);
    expect(res.json().changed.map((c: any) => c.path).sort()).toEqual(["keep.txt", "new.md"]);
  });
  it("done via baseSha/headSha tersimpan — meski pesan commit tanpa (spec-N) (SPEC-176)", async () => {
    const res = await app.inject({ url: "/api/specs/SPEC-960/review" });
    expect(res.statusCode).toBe(200);
    expect(res.json().changed.map((c: any) => c.path)).toEqual(["keep.txt"]);
  });
  it("done via SHA tersimpan: file changed → diff dari commit range (SPEC-176)", async () => {
    const res = await app.inject({ url: "/api/specs/SPEC-960/review/keep.txt" });
    expect(res.statusCode).toBe(200);
    expect(res.json().diff).toContain("+dua");
    expect(res.json().content).toBe("satu\ndua\n");
  });
  it("item selesai: file changed → diff + content dari commit", async () => {
    const res = await app.inject({ url: "/api/specs/SPEC-901/review/keep.txt" });
    expect(res.statusCode).toBe(200);
    expect(res.json().diff).toContain("+dua");
    expect(res.json().content).toBe("satu\ndua\n");
  });
  it("spec tak ada → 404", async () => {
    const res = await app.inject({ url: "/api/specs/SPEC-999/review" });
    expect(res.statusCode).toBe(404);
  });
  it("file changed → diff + content", async () => {
    const res = await app.inject({ url: "/api/specs/SPEC-171/review/keep.txt" });
    expect(res.statusCode).toBe(200);
    expect(res.json().diff).toContain("+b");
    expect(res.json().content).toBe("a\nb\n");
  });
  it("path di luar daftar → 404", async () => {
    const res = await app.inject({ url: "/api/specs/SPEC-171/review/does/not/exist.ts" });
    expect(res.statusCode).toBe(404);
  });
});

// SPEC-175 · rebase/merge branch hasil sebuah done spec.
describe("POST /specs/:id/integrate", () => {
  it("spec non-done → 409", async () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-I1");
    await makeProject({ id: "pi1", repoDir });
    await makeSpec({ id: "SPEC-I1", projectId: "pi1", stage: "planned" });
    const res = await app.inject({ method: "POST", url: "/api/specs/SPEC-I1/integrate", payload: { op: "merge", target: "origin:main" } });
    expect(res.statusCode).toBe(409);
  });
  it("target invalid (bukan local:/origin:) → 400", async () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-I2");
    await makeProject({ id: "pi2", repoDir });
    await makeSpec({ id: "SPEC-I2", projectId: "pi2", stage: "done" });
    const res = await app.inject({ method: "POST", url: "/api/specs/SPEC-I2/integrate", payload: { op: "merge", target: "garbage" } });
    expect(res.statusCode).toBe(400);
  });
  it("merge bersih → 200 {status:clean}, kerja mendarat di origin/main", async () => {
    const { repoDir, origin } = makeRepoWithSpecBranch("SPEC-I3");
    await makeProject({ id: "pi3", repoDir });
    await makeSpec({ id: "SPEC-I3", projectId: "pi3", stage: "done" });
    const res = await app.inject({ method: "POST", url: "/api/specs/SPEC-I3/integrate", payload: { op: "merge", target: "origin:main" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("clean");
    expect(execFileSync("git", ["--git-dir", origin, "show", "main:work.txt"], { encoding: "utf8" })).toBe("work\n");
  });
  it("merge konflik → 200 {status:conflict, sessionId}, sesi dibuat", async () => {
    killAll();
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const { repoDir } = makeRepoWithSpecBranch("SPEC-I7", {
      base: { "f.txt": "base\n" }, work: { "f.txt": "branch\n" }, mainAdvance: { "f.txt": "main\n" },
    });
    await makeProject({ id: "pi7", repoDir });
    await makeSpec({ id: "SPEC-I7", projectId: "pi7", stage: "done" });
    const res = await app.inject({ method: "POST", url: "/api/specs/SPEC-I7/integrate", payload: { op: "merge", target: "origin:main" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("conflict");
    const sid = res.json().sessionId as string;
    expect(getSession(sid)).toBeTruthy();
    killAll();
  });
});
