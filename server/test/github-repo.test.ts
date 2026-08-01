import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { prisma } from "../src/db";
import { githubSlugFromUrl, resolveGithubRepo } from "../src/services/github-repo";

// Repo git sungguhan (bukan mock) supaya jalur fallback `origin` benar-benar teruji.
function repoWithOrigin(url: string): string {
  const dir = mkdtempSync(join(tmpdir(), "hnm-gh-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", url], { cwd: dir });
  return dir;
}

const dirs: string[] = [];
const clean = async () => {
  await prisma.localBinding.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};

beforeAll(async () => {
  await clean();
  // A · gitRemote terisi, TANPA repoDir  (kasus `inkara` — audit B5.2)
  await prisma.project.create({ data: { id: "gh-a", name: "A", desc: "", kind: "existing",
    gitRemote: "https://github.com/INKARA-CLUB/inkara-product" } });
  // B · gitRemote KOSONG, origin repoDir github  (kasus `crm-tumbuh-ai`/`videos` — audit B5.1)
  const dirB = repoWithOrigin("https://github.com/zamaludin/kirimchat-multi.git"); dirs.push(dirB);
  await prisma.project.create({ data: { id: "gh-b", name: "B", desc: "", kind: "existing", repoDir: dirB } });
  // C · origin GitLab  (kasus `erp-tumbuh-ai` — audit B5.3)
  const dirC = repoWithOrigin("https://gitlab.com/tumbuh.ai/erp.git"); dirs.push(dirC);
  await prisma.project.create({ data: { id: "gh-c", name: "C", desc: "", kind: "existing", repoDir: dirC } });
  // D · tanpa gitRemote & tanpa repoDir
  await prisma.project.create({ data: { id: "gh-d", name: "D", desc: "", kind: "existing" } });
  // E · gitRemote menang atas origin yang berbeda
  const dirE = repoWithOrigin("https://github.com/salah/salah.git"); dirs.push(dirE);
  await prisma.project.create({ data: { id: "gh-e", name: "E", desc: "", kind: "existing",
    repoDir: dirE, gitRemote: "git@github.com:denameidina/hanoman.git" } });
});
afterAll(async () => { await clean(); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

describe("SPEC-471 · githubSlugFromUrl", () => {
  it("https, dengan & tanpa .git", () => {
    expect(githubSlugFromUrl("https://github.com/denameidina/hanoman.git")?.slug).toBe("denameidina/hanoman");
    expect(githubSlugFromUrl("https://github.com/denameidina/hanoman")?.slug).toBe("denameidina/hanoman");
  });
  it("ssh", () => {
    const r = githubSlugFromUrl("git@github.com:INKARA-CLUB/inkara-product.git");
    expect(r).toEqual({ owner: "INKARA-CLUB", repo: "inkara-product", slug: "INKARA-CLUB/inkara-product" });
  });
  it("host non-github → null", () => {
    expect(githubSlugFromUrl("https://gitlab.com/tumbuh.ai/erp.git")).toBeNull();
    expect(githubSlugFromUrl("https://bitbucket.org/a/b.git")).toBeNull();
  });
  it("bukan URL → null", () => expect(githubSlugFromUrl("bukan-url")).toBeNull());
});

describe("SPEC-471 · resolveGithubRepo", () => {
  it("gitRemote terisi tanpa repoDir tetap jalan", async () => {
    const r = await resolveGithubRepo("gh-a");
    expect(r).toEqual({ ok: true, repo: { owner: "INKARA-CLUB", repo: "inkara-product", slug: "INKARA-CLUB/inkara-product" } });
  });
  it("gitRemote kosong → jatuh ke origin repoDir", async () => {
    const r = await resolveGithubRepo("gh-b");
    expect(r.ok && r.repo.slug).toBe("zamaludin/kirimchat-multi");
  });
  it("origin GitLab → not-github, pesannya MENYEBUT hostnya", async () => {
    const r = await resolveGithubRepo("gh-c");
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.kind).toBe("not-github"); expect(r.error).toContain("gitlab.com"); }
  });
  it("tanpa remote apa pun → no-remote", async () => {
    const r = await resolveGithubRepo("gh-d");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("no-remote");
  });
  it("gitRemote MENANG atas origin repoDir", async () => {
    const r = await resolveGithubRepo("gh-e");
    expect(r.ok && r.repo.slug).toBe("denameidina/hanoman");
  });
  it("project tak ada → no-project", async () => {
    const r = await resolveGithubRepo("tidak-ada");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("no-project");
  });
});
