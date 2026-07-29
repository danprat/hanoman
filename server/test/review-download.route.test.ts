/* SPEC-385 · ADR-0078 · parity unduh untuk pratinjau `.md` di Review & pane diff IDE.
   Query `?download=` menempel di endpoint yang SUDAH ada — tanpa query, bentuk JSON
   ReviewFile lama harus utuh. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { killSession, createSession as createSessionSvc } from "../src/services/pty";
import { resetDb, makeProject, makeSpec, makeRepoWithWorktree, makeRepoWithChanges, makeRepoWithBranches } from "./factory";

const app = buildApp({ requireAuth: false });
const DOC = "docs/catatan.md";
const AFTER = "# Catatan\n\nbaris baru sesudah perubahan.";
let prdRepo = "";

beforeAll(async () => {
  await resetDb();
  const wtRepo = makeRepoWithWorktree("SPEC-385",
    { [DOC]: "# Catatan\n", "docs/hapus.md": "# Dihapus\n" },
    { [DOC]: AFTER, "docs/hapus.md": null });
  await makeProject({ id: "rv", repoDir: wtRepo });
  await makeSpec({ id: "SPEC-385", projectId: "rv" });
  await makeProject({ id: "chg2", repoDir: makeRepoWithChanges() });
  prdRepo = makeRepoWithBranches();
  await makeProject({ id: "prdp", repoDir: prdRepo });
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

  // Berkas yang DIHAPUS punya diff tapi tak punya isi. Mengunduhnya sebagai string kosong akan
  // menghasilkan PDF satu halaman yang tampak sah padahal isinya bohong → 404 lebih jujur.
  it("berkas dihapus: JSON tetap 200 (diff bisa dibaca) tapi unduh → 404", async () => {
    const json = await app.inject({ url: "/api/specs/SPEC-385/review/docs/hapus.md" });
    expect(json.statusCode).toBe(200);
    expect(json.json().content).toBeNull();
    for (const fmt of ["md", "pdf"]) {
      const dl = await app.inject({ url: `/api/specs/SPEC-385/review/docs/hapus.md?download=${fmt}` });
      expect(dl.statusCode).toBe(404);
    }
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

// SPEC-230/385 · Review sesi project-level (PRD) memakai LAYAR yang sama dengan review backlog,
// jadi endpoint-nya harus menerima `?download=` yang sama. Sesi dibuat lewat service dengan
// command `sleep` — jangan pernah spawn agen sungguhan dari test.
describe("unduh berkas review sesi PRD (?download=)", () => {
  const SESSION = "prd-unduh";
  let wt = "";

  beforeAll(() => {
    wt = join(prdRepo, ".worktrees", SESSION);
    execFileSync("git", ["worktree", "add", "--detach", "-q", wt, "HEAD"], { cwd: prdRepo });
    writeFileSync(join(wt, "prd.md"), "# PRD Unduh\n\nisi dokumen.\n");
    createSessionSvc("prdp", wt, { id: SESSION, flow: "prd", branch: "prd/unduh", command: ["/bin/sleep", "30"] });
  });

  afterAll(() => {
    killSession(SESSION);
    if (existsSync(wt)) execFileSync("git", ["worktree", "remove", "--force", wt], { cwd: prdRepo });
  });

  it("md mentah + pdf, prefix nama berkas memakai id sesi", async () => {
    const md = await app.inject({ url: `/api/terminal/sessions/${SESSION}/review/prd.md?download=md` });
    expect(md.statusCode).toBe(200);
    expect(md.headers["content-disposition"]).toBe(`attachment; filename="${SESSION}-prd.md"`);
    expect(md.body).toBe("# PRD Unduh\n\nisi dokumen.\n");
    const pdf = await app.inject({ url: `/api/terminal/sessions/${SESSION}/review/prd.md?download=pdf` });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("tanpa query: bentuk JSON ReviewFile lama utuh", async () => {
    const res = await app.inject({ url: `/api/terminal/sessions/${SESSION}/review/prd.md` });
    expect(res.statusCode).toBe(200);
    const j = res.json();
    expect(j).toHaveProperty("binary", false);
    expect(j).toHaveProperty("diff");
    expect(j.content).toBe("# PRD Unduh\n\nisi dokumen.\n");
  });
});
