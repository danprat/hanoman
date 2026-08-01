import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIMIT, DEFAULT_MAX_BYTES, MAX_LIMIT,
  clip, paginateLocal, renderResult, shapeProject, shapeSpec, shapeSpecDetail,
} from "./mcp-shape";

describe("clip", () => {
  it("memotong dan menandai potongan, tak diam-diam", () => {
    expect(clip("abcdefghij", 5)).toBe("abcde… (dipotong)");
  });
  it("tak menyentuh yang muat", () => {
    expect(clip("abc", 5)).toBe("abc");
  });
  it("nilai non-string lewat apa adanya", () => {
    expect(clip(null, 5)).toBe(null);
  });
});

describe("shapeProject", () => {
  it("membuang field berat dan menyisakan yang dipakai agen", () => {
    const row = {
      id: "hanoman", name: "hanoman", desc: "orchestrator", kind: "existing",
      repoDir: "/Users/x/hanoman", gitRemote: "git@github.com:x/y.git", stack: "ts",
      docStatus: "ok", coverage: 91, createdAt: "2026-01-01T00:00:00.000Z",
      binding: "/Users/x/hanoman", backlog: 284, topStage: "executing",
      session: { status: "running", phase: "Execute", flow: "feature" },
      activity: "2026-08-01", commit: "abc1234", helpEnabled: true,
      schedulerOptIn: true, leadOptIn: false,
    };
    expect(shapeProject(row)).toEqual({
      id: "hanoman", name: "hanoman", kind: "existing", desc: "orchestrator",
      backlog: 284, topStage: "executing", coverage: 91,
      schedulerOptIn: true, leadOptIn: false,
    });
  });
});

describe("shapeSpec", () => {
  const row = {
    id: "SPEC-482", projectId: "hanoman", title: "MCP server", source: "brief",
    stage: "brainstorming", priority: "sedang", author: "a@b.c",
    objective: "x".repeat(500),
    payload: { context: "c", outcome: "o", constraints: "k", priority: "sedang" },
    branchFrom: null, baseSha: null, headSha: null,
    createdAt: "2026-08-01T00:00:00.000Z", startedAt: null,
    dependsOn: [], blockedBy: [], version: 3, updatedAt: "2026-08-01T00:00:00.000Z",
  };
  it("ringkas: tanpa payload, objective dipotong 200", () => {
    const s = shapeSpec(row) as Record<string, unknown>;
    expect(s.payload).toBeUndefined();
    expect(String(s.objective)).toHaveLength(200 + "… (dipotong)".length);
    expect(s.id).toBe("SPEC-482");
    expect(s.startable).toBe(true); // stage != done
  });
  it("detail: payload utuh dan objective utuh", () => {
    const s = shapeSpecDetail(row) as Record<string, unknown>;
    expect(s.payload).toEqual(row.payload);
    expect(String(s.objective)).toHaveLength(500);
  });
});

describe("paginateLocal", () => {
  const items = Array.from({ length: 55 }, (_, i) => ({ i }));
  it("default 20 per halaman", () => {
    const r = paginateLocal(items, undefined, undefined);
    expect(r.items).toHaveLength(DEFAULT_LIMIT);
    expect(r).toMatchObject({ total: 55, page: 1, pageSize: DEFAULT_LIMIT });
  });
  it("halaman kedua melanjutkan, bukan mengulang", () => {
    expect(paginateLocal(items, 2, 20).items[0]).toEqual({ i: 20 });
  });
  it("limit dijepit ke MAX_LIMIT", () => {
    expect(paginateLocal(items, 1, 9999).pageSize).toBe(MAX_LIMIT);
  });
});

describe("renderResult", () => {
  it("di bawah plafon: JSON apa adanya", () => {
    const out = renderResult({ a: 1 }, DEFAULT_MAX_BYTES);
    expect(JSON.parse(out)).toEqual({ a: 1 });
  });
  it("di atas plafon: JSON yang MASIH SAH plus penanda terbaca mesin", () => {
    const big = { items: Array.from({ length: 500 }, (_, i) => ({ i, pad: "x".repeat(200) })) };
    const out = renderResult(big, 2000);
    const parsed = JSON.parse(out) as { truncated: boolean; shown: number; total: number; hint: string; items: unknown[] };
    expect(parsed.truncated).toBe(true);
    expect(parsed.total).toBe(500);
    expect(parsed.shown).toBeLessThan(500);
    expect(parsed.items).toHaveLength(parsed.shown);
    expect(out.length).toBeLessThanOrEqual(2000);
    expect(parsed.hint).toContain("page");
  });
  it("objek non-daftar yang kebesaran tetap JSON sah", () => {
    const out = renderResult({ blob: "y".repeat(10_000) }, 500);
    const parsed = JSON.parse(out) as { truncated: boolean };
    expect(parsed.truncated).toBe(true);
    expect(out.length).toBeLessThanOrEqual(500);
  });
});
