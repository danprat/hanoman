import { describe, it, expect } from "vitest";
import { sourceForLabels, zNormalIssue } from "./github";

describe("SPEC-471 · peta label issue → source Spec", () => {
  it("label bug-ish → qa", () => {
    expect(sourceForLabels(["bug"])).toBe("qa");
    expect(sourceForLabels(["Type: Defect"])).toBe("qa");
    expect(sourceForLabels(["regression"])).toBe("qa");
  });
  it("label fitur-ish → brief", () => {
    expect(sourceForLabels(["enhancement"])).toBe("brief");
    expect(sourceForLabels(["feature request"])).toBe("brief");
  });
  it("label tanya/docs → audit", () => {
    expect(sourceForLabels(["question"])).toBe("audit");
    expect(sourceForLabels(["documentation"])).toBe("audit");
  });
  // Kesembilan issue nyata di repo ini TAK BERLABEL (audit B1) dan isinya laporan cacat.
  // Default `qa` = selidiki dulu; `brief` akan membangun dari premis yang belum diperiksa.
  it("tanpa label / label tak dikenal → qa (default menyelidiki)", () => {
    expect(sourceForLabels([])).toBe("qa");
    expect(sourceForLabels(["good first issue", "help wanted"])).toBe("qa");
  });
  it("label bug menang atas label lain saat keduanya ada", () => {
    expect(sourceForLabels(["enhancement", "bug"])).toBe("qa");
  });
  it("zNormalIssue menolak bentuk yang tak lengkap", () => {
    expect(zNormalIssue.safeParse({ number: 1 }).success).toBe(false);
    expect(zNormalIssue.safeParse({
      number: 9, title: "t", body: "b", authorLogin: "u", labels: [],
      url: "https://github.com/o/r/issues/9", issueState: "open",
      issueCreatedAt: "2026-07-30T11:57:43Z", issueUpdatedAt: "2026-07-30T11:57:43Z",
    }).success).toBe(true);
  });
});
