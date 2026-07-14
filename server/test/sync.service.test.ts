import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { applyPush, pull, snapshot } from "../src/services/sync";

const clean = async () => {
  await prisma.syncLog.deleteMany();
  await prisma.spec.deleteMany(); await prisma.vps.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

async function project() {
  return prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: "/local/only" } });
}
const specData = (over: Record<string, unknown> = {}) => ({
  projectId: "p1", title: "t", source: "brief", stage: "planned", priority: "sedang",
  author: "a@b.co", objective: "o", payload: null, branchFrom: null, baseSha: null, headSha: null, ...over,
});

describe("sync service (SPEC-213 AC-9..15)", () => {
  it("insert new record → version 1; snapshot reflects it", async () => {
    await project();
    const r = await applyPush("spec", "SPEC-1", 0, specData());
    expect(r).toMatchObject({ ok: true, version: 1 });
    const snap = await snapshot("spec", "SPEC-1");
    expect(snap).toMatchObject({ version: 1 });
    expect(snap?.data).toMatchObject({ title: "t", stage: "planned" });
  });

  it("stale push rejected with server snapshot; DB unchanged (AC-12)", async () => {
    await project();
    await applyPush("spec", "SPEC-1", 0, specData());
    const stale = await applyPush("spec", "SPEC-1", 0, specData({ title: "HIJACK" }));
    expect(stale).toMatchObject({ ok: false, conflict: true });
    expect((stale as { server: { version: number } }).server.version).toBe(1);
    const snap = await snapshot("spec", "SPEC-1");
    expect(snap?.version).toBe(1);
    expect(snap?.data).toMatchObject({ title: "t" }); // NOT hijacked
  });

  it("fresh push with matching baseVersion advances version (AC-11)", async () => {
    await project();
    await applyPush("spec", "SPEC-1", 0, specData());
    const r = await applyPush("spec", "SPEC-1", 1, specData({ stage: "executing" }));
    expect(r).toMatchObject({ ok: true, version: 2 });
    expect((await snapshot("spec", "SPEC-1"))?.data).toMatchObject({ stage: "executing" });
  });

  it("pull returns records after cursor, then is idempotent/empty (AC-15)", async () => {
    await project();
    await applyPush("spec", "SPEC-1", 0, specData());
    const first = await pull("0");
    expect(first.records.map((x) => x.recordId)).toContain("SPEC-1");
    expect(Number(first.cursor)).toBeGreaterThan(0);
    const second = await pull(first.cursor);
    expect(second.records).toHaveLength(0);
    expect(second.cursor).toBe(first.cursor);
  });

  it("snapshot excludes never-sync fields (repoDir on project, keyPath on vps) (AC-7/29)", async () => {
    await project();
    const psnap = await snapshot("project", "p1");
    expect(psnap?.data).not.toHaveProperty("repoDir");
    await prisma.vps.create({ data: { id: "v1", name: "v", host: "h", user: "u", keyPath: "/secret/key" } });
    const vsnap = await snapshot("vps", "v1");
    expect(vsnap?.data).not.toHaveProperty("keyPath");
    expect(vsnap?.data).toMatchObject({ name: "v", host: "h" });
  });
});
