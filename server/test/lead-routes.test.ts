import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createHash } from "node:crypto";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { LEAD_DEFAULTS } from "@hanoman/shared";
import { capabilityForRoute, checkAgentCapability } from "../src/services/agent-capabilities";
import { setLead } from "../src/services/lead/config";
import { recordDecision } from "../src/services/lead/trail";

// SPEC-409 · ADR-0091 · permukaan HTTP hanoman-lead.

// SPEC-480 · agen lead disuntik di titik spawn-nya (`brain.think`) — satu-satunya jalan menguji
// jalur 201 tanpa men-spawn `claude -p` sungguhan. `leadOutput` diganti per test.
const { leadOutput } = vi.hoisted(() => ({ leadOutput: { raw: "" } }));
vi.mock("../src/services/lead/brain", () => ({ think: async () => leadOutput.raw }));

const app = buildApp();
const clean = async () => {
  await prisma.leadDecision.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.agentToken.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
};
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "demo", name: "Demo", desc: "", kind: "web", leadOptIn: true } });
});
afterAll(clean);

const cookieOf = (r: { headers: Record<string, unknown> }) => (r.headers["set-cookie"] as string).split(";")[0];
async function login() {
  const r = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "a@b.co", password: "password1" } });
  return cookieOf(r);
}
async function agentToken(capabilities: string[]) {
  const plain = `hnm_agt_${capabilities.join("_").replace(/[^a-z]/g, "")}`;
  await prisma.agentToken.create({ data: {
    name: "t", tokenHash: createHash("sha256").update(plain).digest("hex"),
    tokenPrefix: plain.slice(0, 12), capabilities, enabled: true,
  } });
  await prisma.setting.upsert({
    where: { id: 1 },
    update: { data: { agentAccessEnabled: true } as never },
    create: { id: 1, data: { agentAccessEnabled: true, autoDefault: true, autoScaffold: true, notifyFail: true } as never },
  });
  return plain;
}

// SPEC-405 · kelas bug yang tak boleh terulang: prefix status dipetakan ke izin BACA tanpa melihat
// method, sehingga endpoint tulis baru di bawahnya terbuka untuk setiap token. Endpoint keputusan
// adalah endpoint tulis (AC-5).
describe("capabilityForRoute · lead (AC-5)", () => {
  it("maps by method, not by prefix", () => {
    expect(capabilityForRoute("GET", "/api/lead/decisions")).toBe("lead:read");
    expect(capabilityForRoute("GET", "/api/lead/status")).toBe("lead:read");
    expect(capabilityForRoute("POST", "/api/lead/decisions")).toBe("lead:write");
    expect(capabilityForRoute("PUT", "/api/lead/config")).toBe("lead:write");
    expect(capabilityForRoute("POST", "/api/lead/decisions/x/override")).toBe("lead:write");
  });
  it("never lets a read capability ask for a decision", () => {
    expect(checkAgentCapability(["lead:read"], "POST", "/api/lead/decisions"))
      .toMatchObject({ ok: false, status: 403, need: "lead:write" });
    expect(checkAgentCapability(["lead:write"], "POST", "/api/lead/decisions")).toEqual({ ok: true });
  });
  it("does not hand lead access to holders of other domains", () => {
    expect(checkAgentCapability(["sessions:write", "backlog:write"], "GET", "/api/lead/decisions").ok).toBe(false);
  });
});

describe("GET/PUT /api/lead/config", () => {
  it("401 tanpa cookie", async () => {
    expect((await app.inject({ method: "GET", url: "/api/lead/config" })).statusCode).toBe(401);
  });
  it("returns the off-by-default block for a fresh instance (AC-30)", async () => {
    const cookie = await login();
    const r = await app.inject({ method: "GET", url: "/api/lead/config", headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual(LEAD_DEFAULTS);
  });
  it("writes the whole block; Pause is just a field (AC-27)", async () => {
    const cookie = await login();
    const r = await app.inject({ method: "PUT", url: "/api/lead/config", headers: { cookie },
      payload: { ...LEAD_DEFAULTS, enabled: true, paused: true } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ enabled: true, paused: true });
  });
  it("400 for a malformed block", async () => {
    const cookie = await login();
    const r = await app.inject({ method: "PUT", url: "/api/lead/config", headers: { cookie },
      payload: { ...LEAD_DEFAULTS, everyMin: 0 } });
    expect(r.statusCode).toBe(400);
  });
});

describe("POST /api/lead/decisions (pintu #1)", () => {
  it("409 while lead is off — peminta kembali menunggu manusia, bukan 500", async () => {
    const cookie = await login();
    const r = await app.inject({ method: "POST", url: "/api/lead/decisions", headers: { cookie },
      payload: { projectId: "demo", question: "pakai kolom baru?" } });
    expect(r.statusCode).toBe(409);
  });
  it("409 for a project that never opted in", async () => {
    const cookie = await login();
    await setLead({ ...LEAD_DEFAULTS, enabled: true });
    await prisma.project.update({ where: { id: "demo" }, data: { leadOptIn: false } });
    const r = await app.inject({ method: "POST", url: "/api/lead/decisions", headers: { cookie },
      payload: { projectId: "demo", question: "q?" } });
    expect(r.statusCode).toBe(409);
  });
  it("404 for an unknown project", async () => {
    const cookie = await login();
    await setLead({ ...LEAD_DEFAULTS, enabled: true });
    const r = await app.inject({ method: "POST", url: "/api/lead/decisions", headers: { cookie },
      payload: { projectId: "hantu", question: "q?" } });
    expect(r.statusCode).toBe(404);
  });
  it("400 without a question", async () => {
    const cookie = await login();
    const r = await app.inject({ method: "POST", url: "/api/lead/decisions", headers: { cookie },
      payload: { projectId: "demo" } });
    expect(r.statusCode).toBe(400);
  });
  it("403 for an agent token holding only the read capability (AC-5)", async () => {
    const token = await agentToken(["lead:read"]);
    const r = await app.inject({ method: "POST", url: "/api/lead/decisions",
      headers: { authorization: `Bearer ${token}` }, payload: { projectId: "demo", question: "q?" } });
    expect(r.statusCode).toBe(403);
    expect(r.json().need).toBe("lead:write");
  });
});

describe("GET /api/lead/decisions (AC-24)", () => {
  beforeEach(async () => {
    for (const [i, specId] of ["spec-1", "spec-2"].entries()) {
      await recordDecision({
        projectId: i === 0 ? "demo" : "lain", specId, sessionId: `s${i}`,
        gate: "detected", kind: "answer", question: `q${i}`, answer: `a${i}`, reason: "r",
        refs: ["ADR-0091"], confidence: "tinggi", action: "none",
      });
    }
  });
  it("lists newest-first and exposes the refs it kept", async () => {
    const cookie = await login();
    const r = await app.inject({ method: "GET", url: "/api/lead/decisions", headers: { cookie } });
    expect(r.statusCode).toBe(200);
    const items = r.json().items;
    expect(items).toHaveLength(2);
    expect(items[0].refs).toEqual(["ADR-0091"]);
  });
  it("filters per project and per backlog", async () => {
    const cookie = await login();
    const byProject = await app.inject({ method: "GET", url: "/api/lead/decisions?projectId=demo", headers: { cookie } });
    expect(byProject.json().items.map((d: { specId: string }) => d.specId)).toEqual(["spec-1"]);
    const bySpec = await app.inject({ method: "GET", url: "/api/lead/decisions?specId=spec-2", headers: { cookie } });
    expect(bySpec.json().items.map((d: { specId: string }) => d.specId)).toEqual(["spec-2"]);
  });
});

describe("override & cancel (AC-28, US-3)", () => {
  const seed = () => recordDecision({
    projectId: "demo", specId: "spec-1", sessionId: null,
    gate: "detected", kind: "answer", question: "q", answer: "jawaban lead", reason: "r",
    refs: [], confidence: "sedang", action: "none",
  });

  it("marks the old row ditimpa, stores the operator answer as the live one, and links both", async () => {
    const cookie = await login();
    const row = await seed();
    const r = await app.inject({ method: "POST", url: `/api/lead/decisions/${row.id}/override`,
      headers: { cookie }, payload: { answer: "jawaban saya" } });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.old.status).toBe("ditimpa");
    expect(b.old.supersededById).toBe(b.next.id);
    expect(b.next.status).toBe("berlaku");
    expect(b.next.answer).toBe("jawaban saya");
    // AC-32 · menimpa TIDAK menghapus apa pun: kedua baris tetap ada.
    expect(await prisma.leadDecision.count()).toBe(2);
  });
  it("refuses to override an already-overridden row — 'mana yang berlaku' tak boleh jadi tebakan", async () => {
    const cookie = await login();
    const row = await seed();
    await app.inject({ method: "POST", url: `/api/lead/decisions/${row.id}/override`, headers: { cookie }, payload: { answer: "x" } });
    const again = await app.inject({ method: "POST", url: `/api/lead/decisions/${row.id}/override`, headers: { cookie }, payload: { answer: "y" } });
    expect(again.statusCode).toBe(409);
  });
  it("cancels without replacing, keeping the row", async () => {
    const cookie = await login();
    const row = await seed();
    const r = await app.inject({ method: "POST", url: `/api/lead/decisions/${row.id}/cancel`, headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("dibatalkan");
    expect(await prisma.leadDecision.count()).toBe(1);
  });
  it("409 for a decision that does not exist", async () => {
    const cookie = await login();
    expect((await app.inject({ method: "POST", url: "/api/lead/decisions/hantu/cancel", headers: { cookie } })).statusCode).toBe(409);
  });
});

describe("GET /api/lead/status", () => {
  it("reports config, opt-in projects, and their pause state", async () => {
    const cookie = await login();
    await setLead({ ...LEAD_DEFAULTS, enabled: true, pausedProjects: ["demo"] });
    const r = await app.inject({ method: "GET", url: "/api/lead/status", headers: { cookie } });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.config.enabled).toBe(true);
    expect(b.projects).toHaveLength(1);
    expect(b.projects[0]).toMatchObject({ projectId: "demo", optIn: true, paused: true });
    expect(Array.isArray(b.deciding)).toBe(true);
  });
  // Jejak keputusan hidup di HTTP polling; tak ada kanal WebSocket baru (AC-26, ADR-0039).
  it("counts the last 24 hours of decisions per project", async () => {
    const cookie = await login();
    await setLead({ ...LEAD_DEFAULTS, enabled: true });
    await recordDecision({
      projectId: "demo", gate: "pulse", kind: "answer", question: "q", answer: "a", reason: "r",
      refs: [], confidence: "tinggi", action: "none",
    });
    const r = await app.inject({ method: "GET", url: "/api/lead/status", headers: { cookie } });
    expect(r.json().projects[0].decisions24h).toBe(1);
  });
});

// SPEC-480 · ADR-0098 · pintu #1 harus bisa dibaca MESIN: peminta tak boleh menafsirkan prosa
// untuk menebak opsi mana yang sebenarnya dipilih.
describe("POST /api/lead/decisions · balasan terstruktur (SPEC-480)", () => {
  beforeEach(() => setLead({ ...LEAD_DEFAULTS, enabled: true }));

  it("returns the resolved choice, the missing list, and clamped prose", async () => {
    const cookie = await login();
    leadOutput.raw = "```json\n" + JSON.stringify({
      decision: "Node 22.",
      choice: "2",
      reason: `LTS berikutnya sudah dekat. ${"Uraian panjang yang tak diminta. ".repeat(40)}`,
    }) + "\n```";
    const r = await app.inject({ method: "POST", url: "/api/lead/decisions", headers: { cookie },
      payload: { projectId: "demo", question: "Node berapa untuk runtime baru?",
        options: ["Node 20 LTS", "Node 22"] } });
    expect(r.statusCode).toBe(201);
    const b = r.json();
    expect(b.choice).toEqual({ index: 2, option: "Node 22" });
    expect(b.missing).toEqual([]);
    expect(b.decision.length).toBeLessThanOrEqual(241);
    expect(b.reason.length).toBeLessThanOrEqual(481);
    // Jejaknya tetap PENUH — yang dipangkas hanya yang dikirim.
    const row = await prisma.leadDecision.findUniqueOrThrow({ where: { id: b.id } });
    expect(row.reason.length).toBeGreaterThan(600);
    expect(row.choice).toBe("Node 22");
  });

  it("returns a null choice and names what is missing when lead says the context is thin", async () => {
    const cookie = await login();
    leadOutput.raw = "```json\n" + JSON.stringify({
      decision: "Belum bisa diputuskan sampai versi Node produksi diketahui.",
      reason: "Tak ada di repo.",
      missing: ["versi Node yang dipakai produksi"],
    }) + "\n```";
    const r = await app.inject({ method: "POST", url: "/api/lead/decisions", headers: { cookie },
      payload: { projectId: "demo", question: "Node berapa?" } });
    expect(r.statusCode).toBe(201);
    const b = r.json();
    expect(b.choice).toBeNull();
    expect(b.missing).toEqual(["versi Node yang dipakai produksi"]);
    expect(b.confidence).toBe("ragu");
    // Kompatibilitas mundur: pemanggil lama yang cuma membaca teks tetap dapat kalimat bermakna.
    expect(b.decision).toContain("Belum bisa diputuskan");
  });
});
