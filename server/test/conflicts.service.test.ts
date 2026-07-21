import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { enqueueOutbox, listOutbox } from "../src/services/outbox";
import { recordConflict, listConflicts, resolveConflict } from "../src/services/conflicts";

const clean = async () => {
  await prisma.syncConflict.deleteMany(); await prisma.syncOutbox.deleteMany();
  await prisma.spec.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

const L = { version: 2, data: { title: "lokal", updatedAt: "2020-01-02T00:00:00.000Z" } };
const S = { version: 3, data: { title: "server", updatedAt: "2020-01-01T00:00:00.000Z" } };

function fullSpec(title: string) {
  return { projectId: "p1", title, source: "brief", stage: "planned", priority: "sedang", author: "a",
    objective: "o", payload: null, branchFrom: null, baseSha: null, headSha: null,
    updatedAt: "2020-01-02T00:00:00.000Z" };
}

describe("conflicts service (SPEC-270)", () => {
  it("record + list mengembalikan konflik pending", async () => {
    await recordConflict("spec", "SPEC-1", L, S);
    const list = await listConflicts();
    expect(list).toHaveLength(1);
    expect(list[0]!).toMatchObject({ entity: "spec", recordId: "SPEC-1", localVersion: 2, serverVersion: 3 });
  });

  it("record idempoten per (entity,recordId) — update snapshot, bukan duplikat", async () => {
    await recordConflict("spec", "SPEC-1", L, S);
    await recordConflict("spec", "SPEC-1", { ...L, version: 4 }, S);
    const list = await listConflicts();
    expect(list).toHaveLength(1);
    expect(list[0]!.localVersion).toBe(4);
  });

  it("resolve(server) mengadopsi data server ke lokal & menuntaskan", async () => {
    await prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: null } });
    await prisma.spec.create({ data: { id: "SPEC-1", projectId: "p1", title: "lokal", source: "brief",
      stage: "planned", priority: "sedang", author: "a", objective: "o", version: 2 } });
    await enqueueOutbox("spec", "SPEC-1");
    await recordConflict("spec", "SPEC-1", { version: 2, data: fullSpec("lokal") },
      { version: 3, data: fullSpec("server") });
    const push = async () => ({ results: [{ ok: true, version: 4 }] });
    const r = await resolveConflict("spec", "SPEC-1", "server", push);
    expect(r.ok).toBe(true);
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-1" } }))!.title).toBe("server");
    expect(await listConflicts()).toHaveLength(0);
    expect(await listOutbox()).toHaveLength(0);
  });

  it("resolve(local) force-push data lokal ke hub & menuntaskan", async () => {
    await recordConflict("spec", "SPEC-1", { version: 2, data: fullSpec("lokal") },
      { version: 3, data: fullSpec("server") });
    let pushed: any = null;
    const push = async (records: unknown[]) => { pushed = records; return { results: [{ ok: true, version: 4 }] }; };
    const r = await resolveConflict("spec", "SPEC-1", "local", push);
    expect(r.ok).toBe(true);
    expect(pushed[0]).toMatchObject({ entity: "spec", id: "SPEC-1", baseVersion: 3 });
    expect(await listConflicts()).toHaveLength(0);
  });
});
