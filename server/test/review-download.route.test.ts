/* SPEC-385 · ADR-0078 · parity unduh untuk pratinjau `.md` di Review & pane diff IDE.
   Query `?download=` menempel di endpoint yang SUDAH ada — tanpa query, bentuk JSON
   ReviewFile lama harus utuh. */
import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeSpec, makeRepoWithWorktree, makeRepoWithChanges } from "./factory";

const app = buildApp({ requireAuth: false });
const DOC = "docs/catatan.md";
const AFTER = "# Catatan\n\nbaris baru sesudah perubahan.";

beforeAll(async () => {
  await resetDb();
  const wtRepo = makeRepoWithWorktree("SPEC-385", { [DOC]: "# Catatan\n", "bin.png": "x" }, { [DOC]: AFTER });
  await makeProject({ id: "rv", repoDir: wtRepo });
  await makeSpec({ id: "SPEC-385", projectId: "rv" });
  await makeProject({ id: "chg2", repoDir: makeRepoWithChanges() });
});

describe("unduh berkas review backlog (?download=)", () => {
  it("md mentah = isi SESUDAH perubahan, dengan content-disposition", async () => {
    const res = await app.inject({ url: `/api/specs/SPEC-385/review/${DOC}?download=md` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/markdown");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="SPEC-385-catatan.md"');
    expect(res.body).toBe(AFTER);
  });

  it("pdf valid", async () => {
    const res = await app.inject({ url: `/api/specs/SPEC-385/review/${DOC}?download=pdf` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("tanpa query: bentuk JSON ReviewFile lama utuh", async () => {
    const res = await app.inject({ url: `/api/specs/SPEC-385/review/${DOC}` });
    expect(res.statusCode).toBe(200);
    const j = res.json();
    expect(j).toHaveProperty("binary", false);
    expect(j).toHaveProperty("diff");
    expect(j.content).toBe(AFTER);
  });

  it("nilai download tak dikenal diabaikan (tetap JSON)", async () => {
    const res = await app.inject({ url: `/api/specs/SPEC-385/review/${DOC}?download=docx` });
    expect(res.json().content).toBe(AFTER);
  });
});

describe("unduh berkas diff working tree IDE (?download=)", () => {
  it("unstaged: md mentah + pdf", async () => {
    const md = await app.inject({ url: "/api/projects/chg2/file-diff?path=tracked.txt&download=md" });
    expect(md.statusCode).toBe(200);
    expect(md.body).toBe("keep\nmore\n");
    const pdf = await app.inject({ url: "/api/projects/chg2/file-diff?path=tracked.txt&download=pdf" });
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("staged: isi dari index", async () => {
    const md = await app.inject({ url: "/api/projects/chg2/file-diff?path=staged.txt&staged=1&download=md" });
    expect(md.statusCode).toBe(200);
    expect(md.body).toBe("one\ntwo\n");
  });

  it("tanpa query: JSON ReviewFile lama", async () => {
    const res = await app.inject({ url: "/api/projects/chg2/file-diff?path=tracked.txt" });
    expect(res.json()).toHaveProperty("binary", false);
  });
});

describe("unduh berkas commit & compare di Git Graph (?download=)", () => {
  it("commit/:sha/file mengunduh isi berkas di commit itu", async () => {
    const head = await app.inject({ url: "/api/projects/rv/graph?limit=5" });
    const sha = head.json().commits[0].sha as string;
    const md = await app.inject({ url: `/api/projects/rv/commit/${sha}/file?path=${DOC}&download=md` });
    expect(md.statusCode).toBe(200);
    expect(md.headers["content-disposition"]).toContain("catatan.md");
    expect(md.body).toContain("# Catatan");
  });

  it("compare/file mengunduh isi berkas di ujung `to`", async () => {
    const head = await app.inject({ url: "/api/projects/rv/graph?limit=5" });
    const sha = head.json().commits[0].sha as string;
    const md = await app.inject({ url: `/api/projects/rv/compare/file?from=${sha}&to=${sha}&path=${DOC}&download=md` });
    expect(md.statusCode).toBe(200);
    expect(md.body).toContain("# Catatan");
  });
});
