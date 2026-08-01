import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { recordHeadSha } from "../src/services/spec-head";
import { makeRepoWithBranches } from "./factory";
import { spawnSync } from "node:child_process";

const clean = async () => { await prisma.spec.deleteMany(); await prisma.project.deleteMany(); };
beforeEach(clean); afterAll(clean);

const seed = async (id: string, headSha: string | null = null) => {
  await prisma.project.upsert({ where: { id: "ph" }, update: {}, create: { id: "ph", name: "PH", desc: "", kind: "existing" } });
  return prisma.spec.create({ data: { id, projectId: "ph", title: id, source: "brief", stage: "done", priority: "sedang", author: "a", objective: "", baseSha: "base0", headSha } });
};
const headOf = async (id: string) => (await prisma.spec.findUnique({ where: { id } }))!.headSha;

// SPEC-475 · SATU penulis untuk tiga jalur persist `stage = done`. Sebelumnya hanya
// `DELETE /terminal/sessions/:id` yang menulis kolom ini, sehingga 3 dari 4 item `done`
// ber-worktree tak punya ujung kerja tercatat — dan gerbang dependency ADR-0093 kehilangan
// satu-satunya buktinya.
describe("recordHeadSha (SPEC-475)", () => {
  it("merekam HEAD worktree ke kolom headSha spec", async () => {
    await seed("SPEC-H1");
    const wt = makeRepoWithBranches();
    const expected = spawnSync("git", ["rev-parse", "HEAD"], { cwd: wt, encoding: "utf8" }).stdout.trim();
    expect(await recordHeadSha("SPEC-H1", wt)).toBe(expected);
    expect(await headOf("SPEC-H1")).toBe(expected);
  });

  // HEAD yang tak resolve (worktree lenyap, repo rusak) tak boleh MENGHAPUS ujung yang sudah
  // tercatat — itu menukar "belum ter-merge" jadi "siap" persis di titik yang paling berbahaya.
  it("HEAD tak terbaca → nilai lama dipertahankan, bukan ditimpa null", async () => {
    await seed("SPEC-H2", "lama0");
    expect(await recordHeadSha("SPEC-H2", "/tak/ada/worktree")).toBeNull();
    expect(await headOf("SPEC-H2")).toBe("lama0");
  });

  it("spec yang tak ada tak melempar (bookkeeping tak boleh memblok penutupan sesi)", async () => {
    const wt = makeRepoWithBranches();
    await expect(recordHeadSha("SPEC-HILANG", wt)).resolves.toBeTruthy();
  });
});
