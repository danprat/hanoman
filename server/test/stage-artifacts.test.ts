import { describe, it, expect, beforeAll } from "vitest";
import { resetDb, makeProject, makeTempRepo } from "./factory";
import { artifactsToRemove } from "../src/services/stage-artifacts";

// Repo dengan artefak superpowers dua spec bertetangga (167 & 16) untuk uji boundary.
const repo = makeTempRepo({
  "docs/superpowers/specs/2026-07-11-x-spec-167-design.md": "s",
  "docs/superpowers/plans/2026-07-11-x-spec-167.md": "p",
  "docs/superpowers/specs/2026-07-11-y-spec-16-design.md": "s16",
  "internal/docs/README.md": "root",
});

beforeAll(async () => {
  await resetDb();
  await makeProject({ id: "p1", repoDir: repo });
});

describe("artifactsToRemove", () => {
  it("done→objective menghapus artefak spec-ready DAN planned", async () => {
    const out = await artifactsToRemove("p1", "SPEC-167", "objective", "done");
    expect(out.sort()).toEqual([
      "docs/superpowers/plans/2026-07-11-x-spec-167.md",
      "docs/superpowers/specs/2026-07-11-x-spec-167-design.md",
    ]);
  });
  it("done→spec-ready menghapus hanya artefak planned", async () => {
    const out = await artifactsToRemove("p1", "SPEC-167", "spec-ready", "done");
    expect(out).toEqual(["docs/superpowers/plans/2026-07-11-x-spec-167.md"]);
  });
  it("done→planned tak menghapus apa pun (execute/done tanpa artefak berkas)", async () => {
    expect(await artifactsToRemove("p1", "SPEC-167", "planned", "done")).toEqual([]);
  });
  it("spec-16 tak menyerempet spec-167", async () => {
    const out = await artifactsToRemove("p1", "SPEC-16", "objective", "done");
    expect(out).toEqual(["docs/superpowers/specs/2026-07-11-y-spec-16-design.md"]);
  });
  it("project tanpa repoDir → kosong", async () => {
    await makeProject({ id: "p2", repoDir: null });
    expect(await artifactsToRemove("p2", "SPEC-167", "objective", "done")).toEqual([]);
  });
});
