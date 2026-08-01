import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { issueFromGh, issuesFromRest } from "../src/services/github-fetch";

const fxRaw = (n: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/github/${n}`, import.meta.url)), "utf8");
const fx = (n: string) => JSON.parse(fxRaw(n));

describe("SPEC-471 · normalizer dua jalur", () => {
  it("jalur gh: state KAPITAL → kecil, author.login, labels[].name", () => {
    const [first] = fx("gh-list.json").map(issueFromGh);
    expect(first).toEqual({
      number: 9,
      title: "[Moderate][Handoff] Reconciled crash/reboot sessions are shown as successful completion",
      body: "## Severity\nModerate\n\n## Location\n- `server/src/...`",
      authorLogin: "wulanrlestari",
      labels: [],
      url: "https://github.com/denameidina/hanoman/issues/9",
      issueState: "open",
      issueCreatedAt: "2026-07-30T11:57:43Z",
      issueUpdatedAt: "2026-07-30T11:57:43Z",
    });
    expect(fx("gh-list.json").map(issueFromGh)[1]!.labels).toEqual(["bug"]);
  });

  // Terukur: REST /issues memuat PULL REQUEST. 14/30 di cli/cli; 71/71 di repo yang
  // issue-nya DIMATIKAN. Tanpa filter ini, menarik repo itu melahirkan 71 backlog palsu.
  it("jalur REST: item ber-`pull_request` DIBUANG dan dihitung", () => {
    const { issues, skippedPullRequests } = issuesFromRest(fx("rest-issues.json"));
    expect(skippedPullRequests).toBe(1);
    expect(issues.map((i) => i.number)).toEqual([9, 6]);
    expect(issues.some((i) => i.url.includes("/pull/"))).toBe(false);
  });

  it("PARITAS: kedua jalur menghasilkan baris identik untuk issue yang sama", () => {
    const viaGh = fx("gh-list.json").map(issueFromGh);
    const viaRest = issuesFromRest(fx("rest-issues.json")).issues;
    expect(viaRest).toEqual(viaGh);
  });

  it("body null (issue tanpa deskripsi) → string kosong, bukan crash", () => {
    expect(issueFromGh({ ...fx("gh-list.json")[0], body: null }).body).toBe("");
    expect(issuesFromRest([{ ...fx("rest-issues.json")[0], body: null }]).issues[0]!.body).toBe("");
  });

  it("issue tertutup → issueState closed", () => {
    expect(issueFromGh({ ...fx("gh-list.json")[0], state: "CLOSED" }).issueState).toBe("closed");
    expect(issuesFromRest([{ ...fx("rest-issues.json")[0], state: "closed" }]).issues[0]!.issueState).toBe("closed");
  });
});
