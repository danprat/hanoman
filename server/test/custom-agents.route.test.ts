import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { capabilityForRoute } from "../src/services/agent-capabilities";
import { customAgentId } from "@hanoman/shared";
import { agentDefsFor } from "../src/services/custom-agents";

const app = buildApp({ requireAuth: false });
const clean = async () => {
  await prisma.customAgent.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "web" } });
});
afterAll(clean);

const post = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/custom-agents", payload });

// SPEC-405 · kelas bug yang tak boleh terulang: prefix dipetakan ke izin BACA tanpa melihat method.
describe("capabilityForRoute · agents (ADR-0094 keputusan 8)", () => {
  it("dipetakan MENURUT METHOD", () => {
    expect(capabilityForRoute("GET", "/api/custom-agents")).toBe("agents:read");
    expect(capabilityForRoute("POST", "/api/custom-agents")).toBe("agents:write");
    expect(capabilityForRoute("PATCH", "/api/custom-agents/global:agn-a")).toBe("agents:write");
    expect(capabilityForRoute("DELETE", "/api/custom-agents/global:agn-a")).toBe("agents:write");
  });
});

describe("POST /api/custom-agents", () => {
  it("membuat agen global dengan id deterministik", async () => {
    const r = await post({ name: "rev", description: "tinjau", instructions: "kamu peninjau" });
    expect(r.statusCode).toBe(201);
    expect(r.json().id).toBe("global:rev");
    expect(r.json().projectId).toBeNull();
  });

  it("membuat agen project", async () => {
    const r = await post({ projectId: "p1", name: "rev", description: "d", instructions: "i" });
    expect(r.statusCode).toBe(201);
    expect(r.json().id).toBe("p1:rev");
  });

  it("menolak 400 untuk nama yang bukan slug", async () => {
    expect((await post({ name: "Rev", description: "d", instructions: "i" })).statusCode).toBe(400);
  });

  it("menolak 400 untuk projectId yang tak ada", async () => {
    const r = await post({ projectId: "hantu", name: "agn-a", description: "d", instructions: "i" });
    expect(r.statusCode).toBe(400);
  });

  it("menolak 409 untuk nama yang sudah dipakai di scope yang sama", async () => {
    await post({ name: "rev", description: "d", instructions: "i" });
    const r = await post({ name: "rev", description: "d2", instructions: "i2" });
    expect(r.statusCode).toBe(409);
  });

  it("nama yang sama di scope BERBEDA diterima", async () => {
    await post({ name: "rev", description: "d", instructions: "i" });
    const r = await post({ projectId: "p1", name: "rev", description: "d", instructions: "i" });
    expect(r.statusCode).toBe(201);
  });

  it("menolak 400 untuk mention ke nama yang tak terlihat", async () => {
    const r = await post({ name: "agn-a", description: "d", instructions: "i", mentions: ["hantu"] });
    expect(r.statusCode).toBe(400);
    expect(r.json().unknown).toEqual(["hantu"]);
  });

  it("menolak 409 saat mention menutup SIKLUS, dan menyebut jalurnya", async () => {
    await post({ name: "agn-a", description: "d", instructions: "i" });
    await post({ name: "agn-b", description: "d", instructions: "i", mentions: ["agn-a"] });
    const r = await app.inject({
      method: "PATCH", url: "/api/custom-agents/global:agn-a", payload: { mentions: ["agn-b"] },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().cycle).toEqual(["agn-a", "agn-b", "agn-a"]);
    expect(r.json().scope).toBe("global");
  });

  it("menolak 409 untuk siklus yang HANYA muncul karena project menimpa global", async () => {
    // Urutan mengikat: rujukan divalidasi di boundary, jadi yang DITUJU harus lahir lebih dulu
    // (cermin `dependsOn`, ADR-0093). Global agn-g -> agn-h asiklik; yang memecahkannya adalah
    // agen PROJECT bernama sama yang menunjuk balik.
    await post({ name: "agn-h", description: "d", instructions: "i" });
    await post({ name: "agn-g", description: "d", instructions: "i", mentions: ["agn-h"] });
    const r = await post({ projectId: "p1", name: "agn-h", description: "d", instructions: "i", mentions: ["agn-g"] });
    expect(r.statusCode).toBe(409);
    expect(r.json().scope).toBe("p1");
  });
});

describe("GET /api/custom-agents", () => {
  it("tanpa query mengembalikan agen global saja", async () => {
    await post({ name: "agn-g", description: "d", instructions: "i" });
    await post({ projectId: "p1", name: "agn-l", description: "d", instructions: "i" });
    const r = await app.inject({ method: "GET", url: "/api/custom-agents" });
    expect(r.json().map((a: { name: string }) => a.name)).toEqual(["agn-g"]);
  });

  it("dengan projectId mengembalikan himpunan EFEKTIF, ditandai inherited", async () => {
    await post({ name: "agn-g", description: "d", instructions: "i" });
    await post({ projectId: "p1", name: "agn-l", description: "d", instructions: "i" });
    const r = await app.inject({ method: "GET", url: "/api/custom-agents?projectId=p1" });
    const rows = r.json() as { name: string; inherited: boolean }[];
    expect(rows.map((a) => a.name)).toEqual(["agn-g", "agn-l"]);
    expect(rows.find((a) => a.name === "agn-g")!.inherited).toBe(true);
    expect(rows.find((a) => a.name === "agn-l")!.inherited).toBe(false);
  });

  it("nama yang ditimpa project hanya muncul SEKALI — versi project yang menang", async () => {
    await post({ name: "rev", description: "GLOBAL", instructions: "i" });
    await post({ projectId: "p1", name: "rev", description: "PROJECT", instructions: "i" });
    const r = await app.inject({ method: "GET", url: "/api/custom-agents?projectId=p1" });
    const rows = r.json() as { name: string; description: string; inherited: boolean }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.description).toBe("PROJECT");
    expect(rows[0]!.inherited).toBe(false);
  });

  it("agen yang dimatikan tetap terlihat di daftar (UI harus bisa menghidupkannya lagi)", async () => {
    await post({ name: "agn-g", description: "d", instructions: "i", enabled: false });
    const r = await app.inject({ method: "GET", url: "/api/custom-agents" });
    expect(r.json()).toHaveLength(1);
    expect(r.json()[0].enabled).toBe(false);
  });
});

describe("PATCH /api/custom-agents/:id", () => {
  it("menolak 400 saat mencoba mengubah nama (changefeed tak punya operasi hapus)", async () => {
    await post({ name: "agn-a", description: "d", instructions: "i" });
    const r = await app.inject({
      method: "PATCH", url: "/api/custom-agents/global:agn-a", payload: { name: "agn-b" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("mengubah instruksi & enabled", async () => {
    await post({ name: "agn-a", description: "d", instructions: "i" });
    const r = await app.inject({
      method: "PATCH", url: "/api/custom-agents/global:agn-a",
      payload: { instructions: "baru", enabled: false },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().instructions).toBe("baru");
    expect(r.json().enabled).toBe(false);
  });

  it("404 untuk id yang tak ada", async () => {
    const r = await app.inject({
      method: "PATCH", url: "/api/custom-agents/global:hantu", payload: { enabled: false },
    });
    expect(r.statusCode).toBe(404);
  });
});

describe("DELETE /api/custom-agents/:id", () => {
  it("menghapus agen DAN mencabut namanya dari mentions agen lain", async () => {
    await post({ name: "agn-b", description: "d", instructions: "i" });
    await post({ name: "agn-a", description: "d", instructions: "i", mentions: ["agn-b"] });
    const r = await app.inject({ method: "DELETE", url: "/api/custom-agents/global:agn-b" });
    expect(r.statusCode).toBe(204);
    const a = await prisma.customAgent.findUnique({ where: { id: customAgentId(null, "agn-a") } });
    expect(a?.mentions).toEqual([]);
  });

  it("404 untuk id yang tak ada", async () => {
    expect((await app.inject({ method: "DELETE", url: "/api/custom-agents/global:hantu" })).statusCode).toBe(404);
  });
});

// ADR-0094 keputusan 7 · setiap mutasi WAJIB me-refresh cache: tanpa itu sesi yang lahir
// sesudahnya memakai katalog basi, dan gejalanya senyap (agen lama tetap muncul).
describe("cache di-invalidasi tiap mutasi", () => {
  it("agen baru langsung terbaca sumber sinkron", async () => {
    await post({ name: "baru", description: "d", instructions: "i" });
    expect(agentDefsFor("p1").map((a) => a.name)).toContain("baru");
    await app.inject({ method: "DELETE", url: "/api/custom-agents/global:baru" });
    expect(agentDefsFor("p1").map((a) => a.name)).not.toContain("baru");
  });
});
