import type { NormalIssue } from "@hanoman/shared";

// SPEC-471 · ADR-0095 · DUA jalur ambil, SATU bentuk keluaran.
//
// Kenapa filter pull request ada di sini dan bukan opsional: di GitHub setiap pull request
// ADALAH sebuah issue, jadi endpoint REST `/repos/{slug}/issues` memuat keduanya sementara
// `gh issue list` hanya memuat issue. Terukur 2026-08-01: 14 dari 30 item di `cli/cli` adalah
// PR, dan di `zamaludin/kirimchat-multi` — repo yang issue-nya DIMATIKAN — REST menjawab
// HTTP 200 dengan 71 item yang 71-71-nya PR. Tanpa filter, "tarik issue" pada repo tanpa
// satu pun issue akan melahirkan 71 backlog item dari pull request orang lain.

type GhLabel = { name?: string };
export type GhRaw = {
  number: number; title: string; body: string | null;
  author?: { login?: string } | null; labels?: GhLabel[] | null;
  url: string; state: string; createdAt: string; updatedAt: string;
};
export type RestRaw = {
  number: number; title: string; body: string | null;
  user?: { login?: string } | null; labels?: Array<GhLabel | string> | null;
  html_url: string; state: string; created_at: string; updated_at: string;
  pull_request?: unknown;
};

const labelNames = (l: Array<GhLabel | string> | null | undefined): string[] =>
  (l ?? []).map((x) => (typeof x === "string" ? x : x.name ?? "")).filter(Boolean);

const norm = (s: string): "open" | "closed" => (s.toLowerCase() === "closed" ? "closed" : "open");

export function issueFromGh(raw: GhRaw): NormalIssue {
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body ?? "",
    authorLogin: raw.author?.login ?? "",
    labels: labelNames(raw.labels),
    url: raw.url,
    issueState: norm(raw.state),
    issueCreatedAt: raw.createdAt,
    issueUpdatedAt: raw.updatedAt,
  };
}

export function issuesFromRest(raw: RestRaw[]): { issues: NormalIssue[]; skippedPullRequests: number } {
  let skippedPullRequests = 0;
  const issues: NormalIssue[] = [];
  for (const r of raw) {
    if (r.pull_request !== undefined) { skippedPullRequests++; continue; }
    issues.push({
      number: r.number,
      title: r.title,
      body: r.body ?? "",
      authorLogin: r.user?.login ?? "",
      labels: labelNames(r.labels),
      url: r.html_url,
      issueState: norm(r.state),
      issueCreatedAt: r.created_at,
      issueUpdatedAt: r.updated_at,
    });
  }
  return { issues, skippedPullRequests };
}
