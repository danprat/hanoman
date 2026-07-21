import { describe, it, expect, beforeEach } from "vitest";
import { breakdownPathFor, parseBreakdown, readBreakdown } from "../src/services/project-breakdowns";
import { resetDb, makeProject, makeTempRepo } from "./factory";

const MANIFEST = `# Breakdown: Jadwal Invoice

Ringkasan.

\`\`\`json
{ "items": [
  { "title": "Endpoint jadwal", "context": "bagian A", "outcome": "POST /jadwal jalan", "priority": "tinggi" },
  { "title": "UI daftar jadwal", "context": "bagian B", "outcome": "list tampil" }
] }
\`\`\`
`;

describe("breakdownPathFor", () => {
  it("PRD → sibling .breakdown.md", () => {
    expect(breakdownPathFor("docs/prd/jadwal.md")).toBe("docs/prd/jadwal.breakdown.md");
  });
  it("tolak non-PRD & manifest itu sendiri", () => {
    expect(breakdownPathFor("docs/other.md")).toBe(null);
    expect(breakdownPathFor("docs/prd/jadwal.breakdown.md")).toBe(null);
  });
});

describe("parseBreakdown", () => {
  it("ambil blok json, zod tiap item, isi default", () => {
    const items = parseBreakdown(MANIFEST);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: "Endpoint jadwal", priority: "tinggi" });
    expect(items[1]).toMatchObject({ title: "UI daftar jadwal", priority: "sedang", outcome: "list tampil" });
  });
  it("tanpa blok json → []", () => {
    expect(parseBreakdown("# Breakdown\n\nteks saja")).toEqual([]);
  });
  it("json rusak → []", () => {
    expect(parseBreakdown("```json\n{ items: [ }\n```")).toEqual([]);
  });
  it("item invalid (title kosong) dibuang, valid dipertahankan", () => {
    const md = '```json\n{ "items": [ { "title": "" }, { "title": "ok" } ] }\n```';
    expect(parseBreakdown(md).map((i) => i.title)).toEqual(["ok"]);
  });
});

describe("readBreakdown (freshest-wins repoDir)", () => {
  let dir: string;
  beforeEach(async () => {
    await resetDb();
    dir = makeTempRepo({ "docs/prd/jadwal.breakdown.md": MANIFEST });
    await makeProject({ id: "p1", repoDir: dir });
  });
  it("baca manifest dari repoDir", async () => {
    const r = await readBreakdown("p1", "docs/prd/jadwal.md", []);
    expect(r.items).toHaveLength(2);
    expect(r.live).toBe(false);
  });
  it("prdPath non-PRD → items []", async () => {
    expect((await readBreakdown("p1", "docs/x.md", [])).items).toEqual([]);
  });
  it("manifest belum ada → items []", async () => {
    const d2 = makeTempRepo({ "docs/prd/lain.md": "# lain" });
    await makeProject({ id: "p2", repoDir: d2 });
    expect((await readBreakdown("p2", "docs/prd/lain.md", [])).items).toEqual([]);
  });
});
