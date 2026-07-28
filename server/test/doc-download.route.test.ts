import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeSpec, makeTempRepo } from "./factory";

const app = buildApp({ requireAuth: false });
const DOC = "internal/docs/product/prd.md";
const BODY = "# PRD\n\nAlur: spec → plan.";
let dir: string;

beforeEach(async () => {
  await resetDb();
  dir = makeTempRepo({
    "internal/docs/README.md": "- [prd](product/prd.md)",
    "internal/docs/product/prd.md": BODY,
    "docs/prd/x.md": "# PRD x",
    "docs/superpowers/plans/rencana.md": "# Rencana\n\n- [ ] satu",
  });
  await makeProject({ id: "p1", repoDir: dir });
  await makeSpec({ id: "SPEC-900", projectId: "p1" });
});

describe("unduh dokumen (?download=)", () => {
  it("docs project: md mentah dengan content-disposition", async () => {
    const res = await app.inject({ url: `/api/projects/p1/docs/${DOC}?download=md` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/markdown");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="p1-prd.md"');
    expect(res.body).toBe(BODY);
  });

  it("docs project: pdf valid", async () => {
    const res = await app.inject({ url: `/api/projects/p1/docs/${DOC}?download=pdf` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="p1-prd.pdf"');
    expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("tanpa query: JSON lama tak berubah", async () => {
    const res = await app.inject({ url: `/api/projects/p1/docs/${DOC}` });
    expect(res.json()).toEqual({ path: DOC, content: BODY });
  });

  it("query tak dikenal diabaikan (tetap JSON)", async () => {
    const res = await app.inject({ url: `/api/projects/p1/docs/${DOC}?download=docx` });
    expect(res.json().content).toBe(BODY);
  });

  it("dokumen tak ada tetap 404 walau diminta unduh", async () => {
    const res = await app.inject({ url: "/api/projects/p1/docs/internal/docs/tak/ada.md?download=pdf" });
    expect(res.statusCode).toBe(404);
  });

  it("prd: md & pdf", async () => {
    const md = await app.inject({ url: "/api/projects/p1/prds/docs/prd/x.md?download=md" });
    expect(md.statusCode).toBe(200);
    expect(md.headers["content-disposition"]).toBe('attachment; filename="p1-x.md"');
    const pdf = await app.inject({ url: "/api/projects/p1/prds/docs/prd/x.md?download=pdf" });
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("dokumen backlog: prefix nama berkas memakai id spec", async () => {
    const md = await app.inject({ url: "/api/specs/SPEC-900/docs/docs/superpowers/plans/rencana.md?download=md" });
    expect(md.statusCode).toBe(200);
    expect(md.headers["content-disposition"]).toBe('attachment; filename="SPEC-900-rencana.md"');
    const pdf = await app.inject({ url: "/api/specs/SPEC-900/docs/docs/superpowers/plans/rencana.md?download=pdf" });
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("berkas IDE: unduh mentah & pdf", async () => {
    const md = await app.inject({ url: `/api/projects/p1/file?path=${encodeURIComponent(DOC)}&download=md` });
    expect(md.statusCode).toBe(200);
    expect(md.headers["content-disposition"]).toBe('attachment; filename="p1-prd.md"');
    expect(md.body).toBe(BODY);
    const pdf = await app.inject({ url: `/api/projects/p1/file?path=${encodeURIComponent(DOC)}&download=pdf` });
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("berkas IDE tanpa query: JSON RepoFile lama", async () => {
    const res = await app.inject({ url: `/api/projects/p1/file?path=${encodeURIComponent(DOC)}` });
    expect(res.json()).toHaveProperty("binary", false);
  });
});
