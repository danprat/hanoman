import { describe, it, expect, beforeAll } from "vitest";
import { resetDb, makeProject, makeSpec, makeTempRepo } from "./factory";
import { kindOf, listSpecDocs, resolveDir } from "../src/services/spec-docs";

const repo = makeTempRepo({
  "internal/docs/operations/spec-170-x-audit.md": "# audit",
  "internal/docs/operations/spec-170-x-objective.md": "# obj",
  "docs/superpowers/specs/2026-07-11-x-spec-170-design.md": "# spec",
  "docs/superpowers/specs/2026-07-11-x-spec-170-brainstorm.md": "# brain",
  "docs/superpowers/plans/2026-07-11-x-spec-170.md": "# plan",
  "docs/superpowers/specs/2026-07-11-y-spec-17-design.md": "# neighbor",
  "notes/spec-170-note.txt": "not md",
  "internal/docs/README.md": "root",
});

beforeAll(async () => {
  await resetDb();
  await makeProject({ id: "p1", repoDir: repo });
  await makeSpec({ id: "SPEC-170", projectId: "p1", stage: "done" });
  await makeSpec({ id: "SPEC-17", projectId: "p1", stage: "done" });
});

describe("kindOf", () => {
  it("classifies by suffix and dir", () => {
    expect(kindOf("internal/docs/operations/spec-170-x-audit.md")).toBe("audit");
    expect(kindOf("internal/docs/operations/spec-170-x-objective.md")).toBe("objective");
    expect(kindOf("docs/superpowers/specs/a-spec-170-brainstorm.md")).toBe("brainstorm");
    expect(kindOf("docs/superpowers/specs/a-spec-170-design.md")).toBe("spec");
    expect(kindOf("internal/docs/operations/spec-168-x-spec.md")).toBe("spec");
    expect(kindOf("docs/superpowers/plans/a-spec-170.md")).toBe("plan");
    // SPEC-237 · audit SoT `research/audit-<spec>-<slug>.md` (tak berakhiran -audit.md) → kind audit.
    expect(kindOf("internal/docs/research/audit-spec-237-audit-issue.md")).toBe("audit");
    expect(kindOf("internal/docs/research/audit-spec-230-prd-review-merge.md")).toBe("audit");
    expect(kindOf("README.md")).toBe("other");
  });
});

describe("listSpecDocs", () => {
  it("finds all md for the spec in kind-order, boundary-safe, md-only", async () => {
    const docs = await listSpecDocs("SPEC-170", []); // no live session -> repoDir
    expect(docs.map((d) => d.kind)).toEqual(["audit", "spec", "plan", "objective", "brainstorm"]);
    expect(docs.every((d) => d.path.toLowerCase().includes("spec-170"))).toBe(true);
    expect(docs.some((d) => d.path.endsWith(".txt"))).toBe(false);
  });
  it("does not bleed into spec-17", async () => {
    const docs = await listSpecDocs("SPEC-17", []);
    expect(docs.map((d) => d.path)).toEqual(["docs/superpowers/specs/2026-07-11-y-spec-17-design.md"]);
  });
});

describe("resolveDir", () => {
  const sess = (over: Record<string, unknown>) =>
    ({ id: "spec-170", projectId: "p1", specId: "SPEC-170", flow: "feature" as const, cwd: "/live/wt", exited: false, decision: false, ...over });
  it("prefers a live session cwd over repoDir", async () => {
    expect(await resolveDir("SPEC-170", [sess({})])).toBe("/live/wt");
  });
  it("ignores exited sessions, falls back to repoDir", async () => {
    expect(await resolveDir("SPEC-170", [sess({ exited: true })])).toBe(repo);
  });
  it("null when spec unknown and no session", async () => {
    expect(await resolveDir("SPEC-999", [])).toBeNull();
  });
});
