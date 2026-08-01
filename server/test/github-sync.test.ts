import { describe, it, expect } from "vitest";
import { SYNCED, __FIELDS, __DATE_FIELDS } from "../src/services/sync";

// Kolom bermakna GithubIssue — `id` (PK, di where) & `version` (stempel mekanisme) dikecualikan.
const MEANINGFUL = [
  "projectId", "repoSlug", "number", "title", "body", "authorLogin", "labels", "url",
  "issueState", "status", "specId", "issueCreatedAt", "issueUpdatedAt", "pulledAt",
  "createdAt", "updatedAt",
];

describe("SPEC-471 · githubIssue ikut record-sync", () => {
  it("terdaftar di SYNCED", () => {
    expect(SYNCED as readonly string[]).toContain("githubIssue");
  });
  // Kelas ADR-0090/0093/0094: `upsert` yang melewatkan kolom ber-default TETAP berhasil, jadi
  // kolom yang terlupa mendarat sebagai default palsu di tiap client TANPA satu pun error.
  it("FIELDS memuat SETIAP kolom bermakna, dan tak memuat version/id", () => {
    const fields = __FIELDS.githubIssue;
    expect(fields).toBeDefined();
    for (const f of MEANINGFUL) expect(fields).toContain(f);
    expect(fields).not.toContain("version");
    expect(fields).not.toContain("id");
  });
  it("DATE_FIELDS memuat semua kolom DateTime", () => {
    expect(__DATE_FIELDS.githubIssue).toEqual(
      expect.arrayContaining(["issueCreatedAt", "issueUpdatedAt", "pulledAt", "createdAt", "updatedAt"]));
  });
});
