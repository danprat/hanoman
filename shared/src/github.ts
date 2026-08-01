import { z } from "zod";

// SPEC-471 · ADR-0095 · kontrak issue GitHub yang dipakai bersama server & web.
// `NormalIssue` adalah bentuk NORMAL — hasil kedua jalur ambil (gh CLI & REST) sesudah
// dinormalkan. Keduanya WAJIB menghasilkan bentuk ini persis; lihat server/services/github-fetch.ts.
export const zGithubIssueStatus = z.enum(["new", "accepted", "rejected"]);
export type GithubIssueStatus = z.infer<typeof zGithubIssueStatus>;

export const zNormalIssue = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string(),
  authorLogin: z.string(),
  labels: z.array(z.string()),
  url: z.string(),
  issueState: z.enum(["open", "closed"]),
  issueCreatedAt: z.string(),  // ISO-8601 apa adanya dari GitHub
  issueUpdatedAt: z.string(),
});
export type NormalIssue = z.infer<typeof zNormalIssue>;

// Bentuk yang menyeberang ke UI (baris DB + tautan Spec bila sudah diterima).
export const zGithubIssueView = zNormalIssue.extend({
  id: z.string(), projectId: z.string(), repoSlug: z.string(),
  status: zGithubIssueStatus, specId: z.string().nullable(), pulledAt: z.string(),
});
export type GithubIssueView = z.infer<typeof zGithubIssueView>;

// Peta label → source Spec. URUTAN BERARTI: yang lebih menyelidiki lebih dulu, jadi issue
// ber-label ["enhancement","bug"] jatuh ke `qa` (audit dulu) bukan `brief` (langsung bangun).
const LABEL_RULES: Array<{ needles: string[]; source: "qa" | "brief" | "audit" }> = [
  { needles: ["bug", "defect", "regression"], source: "qa" },
  { needles: ["question", "docs", "documentation"], source: "audit" },
  { needles: ["enhancement", "feature", "feat"], source: "brief" },
];

// Default `qa`, BUKAN `brief` seperti tiket Help Center (SPEC-291). Disengaja: kesembilan issue
// nyata di repo ini tak berlabel sama sekali sementara isinya laporan cacat (audit B1). Untuk
// laporan yang belum terklasifikasi, flow yang menyelidiki lebih dulu adalah default yang aman.
export function sourceForLabels(labels: string[]): "qa" | "brief" | "audit" {
  const hay = labels.map((l) => l.toLowerCase());
  for (const rule of LABEL_RULES)
    if (hay.some((l) => rule.needles.some((n) => l.includes(n)))) return rule.source;
  return "qa";
}
