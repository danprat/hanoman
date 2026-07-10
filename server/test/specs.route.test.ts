import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeSpec, makeRepoWithBranches, makeTempRepo, makeRepoWithWorktree, makeRepoWithSpecCommits } from "./factory";
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
});
describe("specs routes", () => {
  it("filters by project", async () => {
    const res = await app.inject({ url: "/api/specs?project=p1" });
    expect(res.json().every((s: any) => s.projectId === "p1")).toBe(true);
  });
  it("creates a brief spec with next id", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/specs", payload: {
        project: "p1", source: "brief", title: "New", priority: "sedang", payload: brief
      }
    });
    expect(res.statusCode).toBe(201); expect(res.json().id).toMatch(/^SPEC-\d+$/); expect(res.json().stage).toBe("brainstorming");
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
    expect(after.json().find((s: any) => s.id === "SPEC-200").stage).toBe("done");
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
