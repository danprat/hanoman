import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeTempRepo, makeSpec } from "./factory";

const app = buildApp({ requireAuth: false });

const audit = (id: string) => makeSpec({ id, projectId: "p1", title: "audit " + id,
  source: "audit", stage: "done", priority: "sedang", author: "Audit · tester", objective: "menelusuri" });

describe("GET /specs/:id/escalation (SPEC-340 · ADR-0076)", () => {
  beforeEach(async () => { await resetDb(); });

  it("404 bila spec tak ada", async () => {
    await makeProject({ id: "p1", repoDir: makeTempRepo({ "internal/docs/README.md": "#" }) });
    const res = await app.inject({ url: "/api/specs/SPEC-999/escalation" });
    expect(res.statusCode).toBe(404);
  });

  it("200 + escalation null bila dokumen audit tak ada", async () => {
    await makeProject({ id: "p1", repoDir: makeTempRepo({ "internal/docs/README.md": "#" }) });
    await audit("SPEC-310");
    const res = await app.inject({ url: "/api/specs/SPEC-310/escalation" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ escalation: null, docPath: null, live: false });
  });

  it("200 + escalation null bila blok json rusak (bukan 5xx)", async () => {
    await makeProject({ id: "p1", repoDir: makeTempRepo({
      "internal/docs/research/audit-spec-311-x.md": "```json\n{ rusak\n```" }) });
    await audit("SPEC-311");
    const res = await app.inject({ url: "/api/specs/SPEC-311/escalation" });
    expect(res.statusCode).toBe(200);
    expect(res.json().escalation).toBeNull();
    expect(res.json().docPath).toContain("audit-spec-311-x.md");
  });

  it("200 + rekomendasi dari dokumen audit", async () => {
    await makeProject({ id: "p1", repoDir: makeTempRepo({
      "internal/docs/research/audit-spec-312-y.md":
        '# Audit\n\n```json\n{ "escalation": { "target": "brief", "reason": "fitur kecil",'
        + ' "alternatives": ["prd"], "prefill": { "title": "Ekspor CSV", "outcome": "bisa unduh" } } }\n```' }) });
    await audit("SPEC-312");
    const res = await app.inject({ url: "/api/specs/SPEC-312/escalation" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.escalation.target).toBe("brief");
    expect(body.escalation.reason).toBe("fitur kecil");
    expect(body.escalation.alternatives).toEqual(["prd"]);
    expect(body.escalation.prefill.title).toBe("Ekspor CSV");
    expect(body.live).toBe(false);
  });
});
