import { describe, it, expect, beforeEach } from "vitest";
import { parseEscalation, readEscalation, readAuditDoc } from "../src/services/audit-escalation";
import { resetDb, makeProject, makeTempRepo, makeSpec } from "./factory";

const BLOCK = `# Audit SPEC-300

Temuan: kebutuhan produk baru.

## Rekomendasi eskalasi

\`\`\`json
{ "escalation": { "target": "prd", "reason": "lintas modul",
  "alternatives": ["brief"], "prefill": { "title": "Kuota tenant", "context": "c", "outcome": "o" } } }
\`\`\`
`;

describe("parseEscalation (SPEC-340 · murni)", () => {
  it("membaca blok json kanonik", () => {
    const e = parseEscalation(BLOCK);
    expect(e?.target).toBe("prd");
    expect(e?.reason).toBe("lintas modul");
    expect(e?.alternatives).toEqual(["brief"]);
    expect(e?.prefill.title).toBe("Kuota tenant");
  });
  it("null saat tak ada blok json", () => {
    expect(parseEscalation("# Audit\n\nprosa saja.")).toBeNull();
  });
  it("null saat json rusak", () => {
    expect(parseEscalation("```json\n{ \"escalation\": { target: prd }\n```")).toBeNull();
  });
  it("null saat target tak dikenal", () => {
    expect(parseEscalation('```json\n{ "escalation": { "target": "epic" } }\n```')).toBeNull();
  });
  it("null saat blok json tanpa kunci escalation", () => {
    expect(parseEscalation('```json\n{ "items": [] }\n```')).toBeNull();
  });
  it("memakai blok json PERTAMA", () => {
    const md = '```json\n{ "escalation": { "target": "qa" } }\n```\n\nlalu\n\n'
      + '```json\n{ "escalation": { "target": "prd" } }\n```';
    expect(parseEscalation(md)?.target).toBe("qa");
  });
  it("mengisi default untuk field yang absen", () => {
    const e = parseEscalation('```json\n{ "escalation": { "target": "none" } }\n```');
    expect(e?.reason).toBe("");
    expect(e?.alternatives).toEqual([]);
    expect(e?.prefill.outcome).toBe("");
  });
});

describe("readEscalation (SPEC-340 · freshest-wins)", () => {
  beforeEach(async () => { await resetDb(); });

  it("membaca dokumen audit dari repoDir", async () => {
    const dir = makeTempRepo({ "internal/docs/research/audit-spec-300-kuota.md": BLOCK });
    await makeProject({ id: "p1", repoDir: dir });
    await makeSpec({ id: "SPEC-300", projectId: "p1", source: "audit" });
    const r = await readEscalation("SPEC-300", []);
    expect(r.live).toBe(false);
    expect(r.docPath).toBe("internal/docs/research/audit-spec-300-kuota.md");
    expect(r.escalation?.target).toBe("prd");
  });

  it("escalation null (bukan lempar) saat dokumen audit tak ada", async () => {
    const dir = makeTempRepo({ "internal/docs/README.md": "# index" });
    await makeProject({ id: "p1", repoDir: dir });
    await makeSpec({ id: "SPEC-301", projectId: "p1", source: "audit" });
    const r = await readEscalation("SPEC-301", []);
    expect(r.escalation).toBeNull();
    expect(r.docPath).toBeNull();
  });

  it("cwd sesi HIDUP menang atas repoDir (live:true)", async () => {
    const repo = makeTempRepo({
      "internal/docs/research/audit-spec-302-x.md": '```json\n{ "escalation": { "target": "qa" } }\n```' });
    const live = makeTempRepo({
      "internal/docs/research/audit-spec-302-x.md": '```json\n{ "escalation": { "target": "prd" } }\n```' });
    await makeProject({ id: "p1", repoDir: repo });
    await makeSpec({ id: "SPEC-302", projectId: "p1", source: "audit" });
    const sessions = [{ id: "spec-302", projectId: "p1", specId: "SPEC-302", cwd: live, exited: false }] as any;
    const r = await readEscalation("SPEC-302", sessions);
    expect(r.live).toBe(true);
    expect(r.escalation?.target).toBe("prd");
  });
});

describe("readAuditDoc (SPEC-340 · penyematan ke prompt PRD)", () => {
  beforeEach(async () => { await resetDb(); });
  it("mengembalikan path + isi dokumen audit", async () => {
    const dir = makeTempRepo({ "internal/docs/research/audit-spec-303-y.md": BLOCK });
    await makeProject({ id: "p1", repoDir: dir });
    await makeSpec({ id: "SPEC-303", projectId: "p1", source: "audit" });
    const d = await readAuditDoc("SPEC-303", []);
    expect(d?.path).toContain("audit-spec-303-y.md");
    expect(d?.content).toContain("Temuan: kebutuhan produk baru.");
  });
  it("null saat spec tak punya dokumen audit", async () => {
    const dir = makeTempRepo({ "internal/docs/README.md": "# index" });
    await makeProject({ id: "p1", repoDir: dir });
    await makeSpec({ id: "SPEC-304", projectId: "p1", source: "audit" });
    expect(await readAuditDoc("SPEC-304", [])).toBeNull();
  });
});
