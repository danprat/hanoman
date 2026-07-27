import { describe, it, expect } from "vitest";
import { startCrossAuditPrompt, PIPELINES } from "../src/prompt";
import type { CrossAuditCtx } from "../src/types";

const ctx: CrossAuditCtx = {
  primary: { id: "web", name: "Web", stack: "React", repoDir: "/repo/web" },
  neighbors: [
    { id: "api", name: "API", stack: "Fastify", repoDir: "/repo/api", relation: "Web bergantung pada API (api)", note: "web memanggil /api/orders" },
    { id: "sdk", name: "SDK", stack: "TS", repoDir: null, relation: "SDK bergantung pada Web (sdk)", note: "" },
  ],
  apiUrl: "http://127.0.0.1:8787/api/audit",
};

describe("PIPELINES.cross-audit", () => {
  it("memakai fase audit-only yang sama", () => {
    expect(PIPELINES["cross-audit"]).toEqual(["Audit", "Laporan"]);
  });
});

describe("startCrossAuditPrompt", () => {
  it("memetakan semua project ter-scope beserta path & relasinya", () => {
    const p = startCrossAuditPrompt(ctx, "live");
    expect(p).toContain("/repo/web");
    expect(p).toContain("/repo/api");
    expect(p).toContain("web memanggil /api/orders");
    expect(p).toContain("Web bergantung pada API (api)");
  });

  it("menandai tetangga tanpa checkout lokal, bukan diam-diam menghilangkannya", () => {
    const p = startCrossAuditPrompt(ctx, "live");
    expect(p).toContain("sdk");
    expect(p).toMatch(/tak ada checkout lokal/i);
  });

  it("melarang menulis di luar worktree sendiri", () => {
    expect(startCrossAuditPrompt(ctx, "live")).toMatch(/read-only|JANGAN menulis/i);
  });

  it("mengajarkan cara menarik log dengan kunci sesi", () => {
    const p = startCrossAuditPrompt(ctx, "live");
    expect(p).toContain("$HANOMAN_AUDIT_KEY");
    expect(p).toContain("http://127.0.0.1:8787/api/audit");
    expect(p).toContain("X-Hanoman-Audit-Key");
  });

  it("mode live: tanpa fase, tanpa dokumen, tanpa push", () => {
    const p = startCrossAuditPrompt(ctx, "live");
    expect(p).not.toContain("HANOMAN_PHASE_FILE");
    expect(p).not.toContain("git push");
    expect(p).not.toContain("research/audit-");
  });

  it("menyebutkan scope kosong terang-terangan saat project belum punya relasi", () => {
    const p = startCrossAuditPrompt({ ...ctx, neighbors: [] }, "live");
    expect(p).toMatch(/belum punya relasi/i);
  });

  it("mode backlog: fase Audit → Laporan, dokumen SoT, push, dan detail backlog", () => {
    const p = startCrossAuditPrompt({
      ...ctx,
      spec: { id: "SPEC-400", title: "Cek integrasi web↔api", source: "cross-audit", priority: "tinggi", objective: "temukan penyebab 500" },
      branchTo: "hanoman/spec-400",
    }, "backlog");
    expect(p).toContain("Audit → Laporan");
    expect(p).toContain("HANOMAN_PHASE_FILE");
    expect(p).toContain("internal/docs/research/audit-spec-400-");
    expect(p).toContain("git push origin HEAD:refs/heads/hanoman/spec-400");
    expect(p).toContain("SPEC-400");
    expect(p).toContain("superpowers:systematic-debugging");
  });
});
