import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchIssues, issueFromGh, issuesFromRest } from "../src/services/github-fetch";

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

const REPO = { owner: "denameidina", repo: "hanoman", slug: "denameidina/hanoman" };
const OPTS = { state: "open" as const, limit: 100 };

// stub `gh`: mengembalikan (code, stdout, stderr) yang persis diukur dari biner 2.96.0
const gh = (code: number, stdout = "", stderr = "") =>
  async () => ({ code, stdout, stderr });
// `gh` tak terpasang: execFile melempar ENOENT, bukan mengembalikan exit code.
const ghMissing = async () => {
  const e = new Error("spawn gh ENOENT") as NodeJS.ErrnoException;
  e.code = "ENOENT";
  throw e;
};

describe("SPEC-471 · fetchIssues — pemilihan jalur", () => {
  it("gh sukses → dipakai, REST tak pernah disentuh", async () => {
    let httpCalls = 0;
    const r = await fetchIssues(REPO, OPTS, {
      runGh: gh(0, fxRaw("gh-list.json")),
      httpGet: async () => { httpCalls++; return { status: 200, json: [] }; },
    });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.via).toBe("gh"); expect(r.issues.map((i) => i.number)).toEqual([9, 6]); }
    expect(httpCalls).toBe(0);
  });

  it("gh TAK ADA (ENOENT) → fallback REST", async () => {
    const rest = fx("rest-issues.json");
    const r = await fetchIssues(REPO, OPTS, {
      runGh: ghMissing,
      httpGet: async (url) => url.endsWith("/hanoman")
        ? { status: 200, json: { has_issues: true } }
        : { status: 200, json: rest },
      token: "tok",
    });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.via).toBe("rest"); expect(r.skippedPullRequests).toBe(1); }
  });

  it("gh ada tapi TAK TERAUTENTIKASI → fallback REST", async () => {
    const r = await fetchIssues(REPO, OPTS, {
      runGh: gh(1, "", "gh auth login -h github.com"),
      httpGet: async (url) => url.endsWith("/hanoman")
        ? { status: 200, json: { has_issues: true } } : { status: 200, json: [] },
      token: "tok",
    });
    expect(r.ok && r.via).toBe("rest");
  });

  // INTI: gh menjawab "issues dimatikan" secara OTORITATIF. REST pada repo yang sama menjawab
  // 200 dengan 71 pull request. Fallback di sini akan memproduksi 71 backlog palsu.
  it("gh gagal OTORITATIF (issues dimatikan) → ERROR, BUKAN fallback", async () => {
    let httpCalls = 0;
    const r = await fetchIssues(REPO, OPTS, {
      runGh: gh(1, "", "the 'zamaludin/kirimchat-multi' repository has disabled issues"),
      httpGet: async () => { httpCalls++; return { status: 200, json: [] }; },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("issues-disabled");
    expect(httpCalls).toBe(0);
  });

  it("gh gagal repo tak ada → not-found, bukan fallback", async () => {
    const r = await fetchIssues(REPO, OPTS, {
      runGh: gh(1, "", "GraphQL: Could not resolve to a Repository with the name 'x/y'. (repository)"),
      httpGet: async () => { throw new Error("tak boleh dipanggil"); },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("not-found");
  });

  it("--limit diteruskan eksplisit (default gh cuma 30)", async () => {
    let seen: string[] = [];
    await fetchIssues(REPO, { state: "open", limit: 250 }, {
      runGh: async (args) => { seen = args; return { code: 0, stdout: "[]", stderr: "" }; },
    });
    expect(seen).toContain("--limit");
    expect(seen[seen.indexOf("--limit") + 1]).toBe("250");
    expect(seen).toContain("--repo");
    expect(seen[seen.indexOf("--repo") + 1]).toBe("denameidina/hanoman");
  });

  it("GITHUB_TOKEN diteruskan sebagai GH_TOKEN ke env gh", async () => {
    let env: NodeJS.ProcessEnv = {};
    await fetchIssues(REPO, OPTS, {
      runGh: async (_a, e) => { env = e; return { code: 0, stdout: "[]", stderr: "" }; },
      token: "ghp_rahasia",
    });
    expect(env.GH_TOKEN).toBe("ghp_rahasia");
  });
});

describe("SPEC-471 · fetchIssues — jalur REST", () => {
  // REST /issues menjawab 200 untuk repo yang issue-nya dimatikan (terukur: 71 item, semuanya PR).
  // Satu-satunya pembeda "dimatikan" vs "kosong" adalah has_issues di /repos/{slug}.
  it("has_issues:false → issues-disabled, endpoint issue tak pernah dipanggil", async () => {
    const seen: string[] = [];
    const r = await fetchIssues(REPO, OPTS, {
      runGh: ghMissing,
      httpGet: async (url) => { seen.push(url); return { status: 200, json: { has_issues: false } }; },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("issues-disabled");
    expect(seen.some((u) => u.includes("/issues"))).toBe(false);
  });

  it("HTTP 404 → not-found; HTTP 401 → unauthorized", async () => {
    const r404 = await fetchIssues(REPO, OPTS, { runGh: ghMissing, httpGet: async () => ({ status: 404, json: {} }) });
    expect(!r404.ok && r404.kind).toBe("not-found");
    const r401 = await fetchIssues(REPO, OPTS, { runGh: ghMissing, httpGet: async () => ({ status: 401, json: {} }) });
    expect(!r401.ok && r401.kind).toBe("unauthorized");
  });

  it("tanpa token → tak mengirim header Authorization", async () => {
    // Env mesin ini boleh saja punya GITHUB_TOKEN; yang diuji adalah perilaku saat TAK ada.
    const saved = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    try {
      const heads: Array<Record<string, string>> = [];
      await fetchIssues(REPO, OPTS, {
        runGh: ghMissing,
        httpGet: async (url, h) => { heads.push(h); return url.endsWith("/hanoman")
          ? { status: 200, json: { has_issues: true } } : { status: 200, json: [] }; },
      });
      expect(heads.length).toBeGreaterThan(0);
      expect(heads.every((h) => !("Authorization" in h))).toBe(true);
    } finally { if (saved !== undefined) process.env.GITHUB_TOKEN = saved; }
  });
});
