import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueAgentToken } from "../src/services/agent-token";

const dir = mkdtempSync(join(tmpdir(), "hanoman-doc-"));
const file = join(dir, "agent-integration.md");
writeFileSync(file, "# hanoman — integrasi AI agent\n\nBearer hnm_agt_…\n");

// requireAuth default true = gerbang produksi. Kalau endpoint ini bocor dari daftar PUBLIC, test
// pertama langsung 401 — itulah gunanya membangun app-nya bergerbang penuh di sini.
const app = buildApp({ agentDocFile: file });
const appTanpaNaskah = buildApp({ agentDocFile: null });

const blob = (agentAccessEnabled: boolean) => ({
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true,
  notifyFail: true, notifyDone: true, notifySound: "short",
  notifyDecision: true, notifyDecisionSound: "alert", agentAccessEnabled,
});
const clean = async () => {
  await prisma.agentToken.deleteMany(); await prisma.setting.deleteMany();
  await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(clean);
afterAll(clean);

describe("GET /api/agent-integration.md", () => {
  it("tanpa auth apa pun → 200 text/markdown", async () => {
    const r = await app.inject({ method: "GET", url: "/api/agent-integration.md" });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("text/markdown");
    expect(r.body).toContain("# hanoman — integrasi AI agent");
  });

  // Justru inilah alasan endpoint ini publik: agen yang tokennya kurang capability tak boleh
  // menerima 403 pada dokumen yang menjelaskan arti 403 itu.
  it("agent token ber-capability KOSONG tetap 200", async () => {
    await prisma.setting.upsert({ where: { id: 1 }, update: { data: blob(true) }, create: { id: 1, data: blob(true) } });
    const { token } = await issueAgentToken({ name: "bot", capabilities: [] });
    const r = await app.inject({
      method: "GET", url: "/api/agent-integration.md",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
  });

  it("token sampah tak mengubah apa pun — tetap 200", async () => {
    const r = await app.inject({
      method: "GET", url: "/api/agent-integration.md",
      headers: { authorization: "Bearer hnm_agt_bukan-token" },
    });
    expect(r.statusCode).toBe(200);
  });

  it("naskah tak ada di instalasi → 404 JSON yang menyebut berkasnya, bukan 500", async () => {
    const r = await appTanpaNaskah.inject({ method: "GET", url: "/api/agent-integration.md" });
    expect(r.statusCode).toBe(404);
    expect(r.json().error).toContain("docs/agent-integration.md");
  });

  // Hanya BACA. Tak ada jalur tulis ke naskah — kalau ada, ia akan publik juga.
  it("method tulis tidak ada", async () => {
    const r = await app.inject({ method: "PUT", url: "/api/agent-integration.md" });
    expect(r.statusCode).not.toBe(200);
  });
});
