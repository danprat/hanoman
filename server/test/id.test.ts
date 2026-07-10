import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDb, makeProject, makeSpec } from "./factory";
import { nextSpecId, specFloorFrom } from "../src/services/id";

// listRepoDocs memakai `git ls-files`, jadi lantai docs hanya nyata di dalam repo git.
function repoWithDocs(names: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "hanoman-id-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  mkdirSync(join(dir, "internal/docs/operations"), { recursive: true });
  for (const n of names) writeFileSync(join(dir, "internal/docs/operations", n), "#\n");
  return dir;
}

describe("id", () => {
  const trash: string[] = [];
  beforeEach(async () => {
    await resetDb();
    await makeProject({ id: "p1" });
    await makeSpec({ id: "SPEC-142", projectId: "p1" });
  });
  afterEach(() => { delete process.env.RUN_ID_FLOOR; });
  afterEach(() => { for (const d of trash.splice(0)) rmSync(d, { recursive: true, force: true }); });
  it("next spec id is one past the max", async () => expect(await nextSpecId()).toBe("SPEC-143"));

  it("specFloorFrom membaca nomor yang diklaim nama berkas docs", () => {
    expect(specFloorFrom([])).toBe(140);
    expect(specFloorFrom(["internal/docs/operations/spec-008-de-mock-objective.md"])).toBe(140); // 8 < lantai
    expect(specFloorFrom(["internal/docs/operations/spec-141-overview.md"])).toBe(141);
    expect(specFloorFrom(["docs/superpowers/plans/2026-07-09-hanoman-qa-spec-145.md"])).toBe(145);
    expect(specFloorFrom(["internal/docs/architecture/stack.md"])).toBe(140);      // bukan spec
  });

  // Akar bug: DB kosong pada instance kedua mencetak ulang SPEC-141, padahal repo sudah
  // punya spec-141-*.md bertopik lain — fase Audit membacanya dan mengabaikan prompt.
  it("nomor yang sudah dipegang docs tidak pernah dicetak ulang", async () => {
    const dir = repoWithDocs(["spec-141-overview.md", "spec-145-qa-after-audit.md"]);
    trash.push(dir);
    expect(await nextSpecId(dir)).toBe("SPEC-146");
  });

  it("DB tetap menang saat nomornya melampaui docs", async () => {
    const dir = repoWithDocs(["spec-141-overview.md"]);   // docs 141, DB 142
    trash.push(dir);
    expect(await nextSpecId(dir)).toBe("SPEC-143");
  });

  it("project tanpa repoDir berperilaku seperti semula", async () =>
    expect(await nextSpecId(null)).toBe("SPEC-143"));
});
