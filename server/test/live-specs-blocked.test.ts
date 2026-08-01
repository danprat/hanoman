import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { liveSpecs } from "../src/services/live-specs";
import { __clearGitCaches } from "../src/services/spec-deps";
import { makeRepoWithBranches } from "./factory";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const clean = async () => { await prisma.spec.deleteMany(); await prisma.project.deleteMany(); };
beforeEach(async () => { await clean(); __clearGitCaches(); });
afterAll(clean);

const spec = (id: string, over: Record<string, unknown> = {}) => prisma.spec.create({
  data: { id, projectId: "pl", title: id, source: "brief", stage: "brainstorming",
    priority: "sedang", author: "a", objective: "", ...over },
});

// SPEC-447 · `liveSpecs` dipakai GET /specs DAN grup siar WS `specs`. Menghias hanya salah satunya
// membuat badge berkedip tiap frame WS tiba — persis alasan SPEC-199 menyatukan keduanya.
describe("liveSpecs · blockedBy (SPEC-447)", () => {
  beforeEach(() => prisma.project.create({ data: { id: "pl", name: "PL", desc: "", kind: "existing" } }));

  it("spec tanpa dependency mendapat dependsOn [] dan blockedBy []", async () => {
    await spec("SPEC-L1");
    const [row] = await liveSpecs({ project: "pl" });
    expect(row).toMatchObject({ id: "SPEC-L1", dependsOn: [], blockedBy: [] });
  });

  it("dependency belum selesai muncul sebagai blockedBy unfinished", async () => {
    await spec("SPEC-L1");
    await spec("SPEC-L2", { dependsOn: ["SPEC-L1"] });
    const rows = await liveSpecs({ project: "pl" });
    const l2 = rows.find((r) => r.id === "SPEC-L2")!;
    expect(l2.dependsOn).toEqual(["SPEC-L1"]);
    expect(l2.blockedBy).toEqual([{ id: "SPEC-L1", reason: "unfinished" }]);
  });

  it("dependency yang tak ada → missing (bukan diam-diam lolos)", async () => {
    await spec("SPEC-L3", { dependsOn: ["SPEC-HILANG"] });
    const rows = await liveSpecs({ project: "pl" });
    expect(rows[0]!.blockedBy).toEqual([{ id: "SPEC-HILANG", reason: "missing" }]);
  });

  it("dependency done tanpa jejak kerja apa pun tidak memblokir", async () => {
    await spec("SPEC-L4", { stage: "done" });
    await spec("SPEC-L5", { dependsOn: ["SPEC-L4"] });
    const rows = await liveSpecs({ project: "pl" });
    expect(rows.find((r) => r.id === "SPEC-L5")!.blockedBy).toEqual([]);
  });

  // SPEC-475 · permukaan BACA harus memakai definisi "siap" yang sama dengan gerbang peluncuran —
  // kalau tidak, badge di dashboard berkata "siap" untuk item yang governor tolak (atau sebaliknya).
  it("dependency done yang branch sesinya belum ter-merge muncul sebagai unmerged", async () => {
    const dir = makeRepoWithBranches();
    const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
    g("checkout", "-q", "-b", "hanoman/spec-l6");
    writeFileSync(join(dir, "kerja.txt"), "x"); g("add", "-A"); g("commit", "-qm", "kerja L6");
    g("checkout", "-q", "main");
    await prisma.project.update({ where: { id: "pl" }, data: { repoDir: dir } });
    await spec("SPEC-L6", { stage: "done", baseSha: "base0" });
    await spec("SPEC-L7", { dependsOn: ["SPEC-L6"], branchFrom: "main" });
    const rows = await liveSpecs({ project: "pl" });
    expect(rows.find((r) => r.id === "SPEC-L7")!.blockedBy)
      .toEqual([{ id: "SPEC-L6", reason: "unmerged" }]);
  });
});
