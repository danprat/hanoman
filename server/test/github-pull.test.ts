import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { issueRowId, pullIssues } from "../src/services/github-issues";

const ISSUES = [
  { number: 9, title: "Judul lama", body: "isi lama", authorLogin: "wulanrlestari", labels: [] as string[],
    url: "https://github.com/denameidina/hanoman/issues/9", issueState: "open" as const,
    issueCreatedAt: "2026-07-30T11:57:43Z", issueUpdatedAt: "2026-07-30T11:57:43Z" },
  { number: 6, title: "Issue kedua", body: "isi", authorLogin: "RamaAditya49", labels: ["bug"],
    url: "https://github.com/denameidina/hanoman/issues/6", issueState: "open" as const,
    issueCreatedAt: "2026-07-30T11:46:25Z", issueUpdatedAt: "2026-07-30T11:46:25Z" },
];
// deps yang mengembalikan fixture di atas lewat jalur gh, tanpa jaringan sama sekali
const deps = (issues = ISSUES) => ({
  runGh: async () => ({
    code: 0,
    stdout: JSON.stringify(issues.map((i) => ({
      number: i.number, title: i.title, body: i.body, author: { login: i.authorLogin },
      labels: i.labels.map((n) => ({ name: n })), url: i.url,
      state: i.issueState.toUpperCase(), createdAt: i.issueCreatedAt, updatedAt: i.issueUpdatedAt,
    }))),
    stderr: "",
  }),
  httpGet: async () => { throw new Error("REST tak boleh dipanggil saat gh sukses"); },
});

const clean = async () => {
  await prisma.githubIssue.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};

beforeAll(async () => { await clean(); });
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "pull-p", name: "P", desc: "", kind: "existing",
    gitRemote: "https://github.com/denameidina/hanoman" } });
});
afterAll(async () => { await clean(); });

describe("SPEC-471 · pullIssues", () => {
  it("tarikan pertama membuat satu baris per issue, id deterministik", async () => {
    const r = await pullIssues("pull-p", {}, deps());
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.created).toBe(2); expect(r.updated).toBe(0); expect(r.repo).toBe("denameidina/hanoman"); }
    const row = await prisma.githubIssue.findUnique({
      where: { id: issueRowId("pull-p", "denameidina/hanoman", 9) } });
    expect(row?.id).toBe("pull-p:denameidina/hanoman#9");
    expect(row?.status).toBe("new");
    expect(row?.specId).toBeNull();
    expect(row?.labels).toEqual([]);
  });

  it("tarik dua kali → tetap 2 baris, bukan 4", async () => {
    await pullIssues("pull-p", {}, deps());
    const r = await pullIssues("pull-p", {}, deps());
    expect(r.ok && r.created).toBe(0);
    expect(r.ok && r.updated).toBe(2);
    expect(await prisma.githubIssue.count()).toBe(2);
  });

  // Jaminan idempotensi yang sesungguhnya: tanpa ini, issue yang sudah diterima kembali
  // berstatus `new` dan accept berikutnya melahirkan Spec KEDUA untuk issue yang sama.
  it("tarik ulang TIDAK me-reset status/specId yang sudah ditriase", async () => {
    await pullIssues("pull-p", {}, deps());
    const id = issueRowId("pull-p", "denameidina/hanoman", 9);
    await prisma.githubIssue.update({ where: { id }, data: { status: "accepted", specId: "SPEC-999" } });
    await prisma.githubIssue.update({
      where: { id: issueRowId("pull-p", "denameidina/hanoman", 6) }, data: { status: "rejected" } });

    await pullIssues("pull-p", {}, deps([{ ...ISSUES[0]!, title: "Judul BARU", body: "isi baru" }, ISSUES[1]!]));

    const a = await prisma.githubIssue.findUnique({ where: { id } });
    expect(a?.status).toBe("accepted");
    expect(a?.specId).toBe("SPEC-999");
    expect(a?.title).toBe("Judul BARU");     // konten tetap disegarkan
    expect(a?.body).toBe("isi baru");
    const b = await prisma.githubIssue.findUnique({
      where: { id: issueRowId("pull-p", "denameidina/hanoman", 6) } });
    expect(b?.status).toBe("rejected");
  });

  it("project tanpa remote GitHub → ok:false, tak ada baris lahir", async () => {
    await prisma.project.create({ data: { id: "pull-x", name: "X", desc: "", kind: "existing" } });
    const r = await pullIssues("pull-x", {}, deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("no-remote");
    expect(await prisma.githubIssue.count({ where: { projectId: "pull-x" } })).toBe(0);
  });

  it("gagal ambil (issues dimatikan) → ok:false, tak ada baris lahir", async () => {
    const r = await pullIssues("pull-p", {}, {
      runGh: async () => ({ code: 1, stdout: "", stderr: "the 'x/y' repository has disabled issues" }),
      httpGet: async () => { throw new Error("tak boleh dipanggil"); },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("issues-disabled");
    expect(await prisma.githubIssue.count()).toBe(0);
  });
});
