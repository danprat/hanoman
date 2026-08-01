import { execFile } from "node:child_process";
import type { NormalIssue } from "@hanoman/shared";
import type { GithubRepo } from "./github-repo";
import { effectiveStr } from "../config";

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

export type FetchDeps = {
  runGh?: (args: string[], env: NodeJS.ProcessEnv) => Promise<{ code: number; stdout: string; stderr: string }>;
  httpGet?: (url: string, headers: Record<string, string>) => Promise<{ status: number; json: unknown }>;
  token?: string;
  ghBin?: string;
};
export type FetchOutcome =
  | { ok: true; issues: NormalIssue[]; via: "gh" | "rest"; skippedPullRequests: number }
  | { ok: false; kind: "issues-disabled" | "not-found" | "unauthorized" | "other"; error: string };

const GH_FIELDS = "number,title,body,author,labels,url,state,createdAt,updatedAt";
const API = "https://api.github.com";

// `gh` yang TAK TERPASANG melempar ENOENT dari spawn; `gh` yang terpasang dan menjawab
// exit≠0 mengembalikan kode + stderr. Keduanya harus dibedakan di pemanggil (lihat viaGh).
const defaultRunGh: NonNullable<FetchDeps["runGh"]> = (args, env) =>
  new Promise((resolve, reject) => {
    execFile(args[0]!, args.slice(1), { env, maxBuffer: 1 << 26, encoding: "utf8", timeout: 60_000 },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { code?: string | number }) | null;
        if (e && (e.code === "ENOENT" || e.code === "EACCES")) return reject(e);
        resolve({ code: err ? Number((err as { code?: number }).code ?? 1) : 0, stdout, stderr });
      });
  });

const defaultHttpGet: NonNullable<FetchDeps["httpGet"]> = async (url, headers) => {
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "hanoman", ...headers } });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
};

// Klasifikasi stderr `gh`. Terukur pada gh 2.96.0 — ketiganya exit 1, teksnya yang membedakan.
// `unauth` adalah SATU-SATUNYA kegagalan yang boleh jatuh ke REST: yang lain adalah jawaban
// otoritatif tentang repo-nya, dan REST akan menjawab hal yang BERBEDA (issues dimatikan →
// HTTP 200 + 71 pull request).
function classifyGhStderr(stderr: string): "unauth" | "issues-disabled" | "not-found" | "other" {
  const s = stderr.toLowerCase();
  if (s.includes("gh auth login") || s.includes("bad credentials") || s.includes("http 401")) return "unauth";
  if (s.includes("disabled issues")) return "issues-disabled";
  if (s.includes("could not resolve to a repository") || s.includes("http 404")) return "not-found";
  return "other";
}

async function viaGh(
  repo: GithubRepo, opts: { state: "open" | "all"; limit: number }, deps: FetchDeps,
): Promise<FetchOutcome | { fallback: true; reason: string }> {
  const bin = deps.ghBin ?? effectiveStr("HANOMAN_GH_BIN") ?? "gh";
  // `--limit` WAJIB eksplisit: default gh adalah 30 dan ia memotong tanpa peringatan apa pun.
  const args = [bin, "issue", "list", "--repo", repo.slug, "--state", opts.state,
    "--limit", String(opts.limit), "--json", GH_FIELDS];
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (deps.token) env.GH_TOKEN = deps.token;   // terukur: env token mengalahkan keyring
  let out: { code: number; stdout: string; stderr: string };
  try { out = await (deps.runGh ?? defaultRunGh)(args, env); }
  catch { return { fallback: true, reason: "gh tak terpasang" }; }
  if (out.code !== 0) {
    const kind = classifyGhStderr(out.stderr);
    if (kind === "unauth") return { fallback: true, reason: "gh tak terautentikasi" };
    return { ok: false, kind, error: out.stderr.trim() || `gh keluar dengan kode ${out.code}` };
  }
  let raw: GhRaw[];
  try { raw = JSON.parse(out.stdout || "[]") as GhRaw[]; }
  catch { return { ok: false, kind: "other", error: "keluaran gh bukan JSON" }; }
  return { ok: true, issues: raw.map(issueFromGh), via: "gh", skippedPullRequests: 0 };
}

async function viaRest(
  repo: GithubRepo, opts: { state: "open" | "all"; limit: number }, deps: FetchDeps,
): Promise<FetchOutcome> {
  const get = deps.httpGet ?? defaultHttpGet;
  const headers: Record<string, string> = {};
  if (deps.token) headers.Authorization = `Bearer ${deps.token}`;

  // Endpoint issue TIDAK bisa membedakan "issues dimatikan" dari "kosong" — ia menjawab 200
  // dengan daftar pull request. `has_issues` di /repos adalah satu-satunya pembeda jujur.
  const meta = await get(`${API}/repos/${repo.slug}`, headers);
  if (meta.status === 404)
    return { ok: false, kind: "not-found", error: `repo "${repo.slug}" tak ditemukan atau tak terjangkau` };
  if (meta.status === 401 || meta.status === 403)
    return { ok: false, kind: "unauthorized", error: "GitHub menolak kredensial — isi GITHUB_TOKEN di Settings" };
  if (meta.status !== 200) return { ok: false, kind: "other", error: `GitHub menjawab HTTP ${meta.status}` };
  if ((meta.json as { has_issues?: boolean } | null)?.has_issues === false)
    return { ok: false, kind: "issues-disabled", error: `repo "${repo.slug}" mematikan fitur issue` };

  const issues: NormalIssue[] = [];
  let skippedPullRequests = 0;
  for (let page = 1; issues.length < opts.limit && page <= 10; page++) {
    const per = Math.min(100, opts.limit - issues.length);
    const res = await get(
      `${API}/repos/${repo.slug}/issues?state=${opts.state}&per_page=${per}&page=${page}`, headers);
    if (res.status === 404) return { ok: false, kind: "not-found", error: `repo "${repo.slug}" tak ditemukan` };
    if (res.status === 401 || res.status === 403)
      return { ok: false, kind: "unauthorized", error: "GitHub menolak kredensial" };
    if (res.status !== 200) return { ok: false, kind: "other", error: `GitHub menjawab HTTP ${res.status}` };
    const batch = Array.isArray(res.json) ? (res.json as RestRaw[]) : [];
    if (batch.length === 0) break;
    const n = issuesFromRest(batch);
    issues.push(...n.issues);
    skippedPullRequests += n.skippedPullRequests;
    if (batch.length < per) break;
  }
  return { ok: true, issues: issues.slice(0, opts.limit), via: "rest", skippedPullRequests };
}

export async function fetchIssues(
  repo: GithubRepo, opts: { state: "open" | "all"; limit: number }, deps: FetchDeps = {},
): Promise<FetchOutcome> {
  const token = deps.token ?? effectiveStr("GITHUB_TOKEN") ?? undefined;
  const first = await viaGh(repo, opts, { ...deps, token });
  if (!("fallback" in first)) return first;
  return viaRest(repo, opts, { ...deps, token });
}
