import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import {
  loadCustomAgents, agentDefsFor, validateGraph, unknownMentions, toDef,
} from "../src/services/custom-agents";
import { customAgentId } from "@hanoman/shared";

const clean = async () => {
  await prisma.customAgent.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "web" } });
  await prisma.project.create({ data: { id: "p2", name: "P2", desc: "", kind: "web" } });
});
afterAll(clean);

const mk = (projectId: string | null, name: string, extra: Record<string, unknown> = {}) =>
  prisma.customAgent.create({ data: {
    id: customAgentId(projectId, name), projectId, name,
    description: "d", instructions: "i", ...extra,
  } as never });

describe("agentDefsFor — resolusi scope (sinkron, dari cache)", () => {
  it("project mendapat agen global + agen project-nya sendiri", async () => {
    await mk(null, "glob");
    await mk("p1", "lokal");
    await mk("p2", "asing");
    await loadCustomAgents();
    expect(agentDefsFor("p1").map((a) => a.name)).toEqual(["glob", "lokal"]);
  });

  it("agen project menimpa global bernama sama", async () => {
    await mk(null, "rev", { instructions: "GLOBAL" });
    await mk("p1", "rev", { instructions: "PROJECT" });
    await loadCustomAgents();
    const defs = agentDefsFor("p1");
    expect(defs).toHaveLength(1);
    expect(defs[0]!.instructions).toBe("PROJECT");
    expect(agentDefsFor("p2")[0]!.instructions).toBe("GLOBAL");
  });

  it("agen yang dimatikan tak ikut", async () => {
    await mk(null, "mati", { enabled: false });
    await loadCustomAgents();
    expect(agentDefsFor("p1")).toHaveLength(0);
  });

  it("project tanpa agen apa pun mengembalikan daftar kosong", async () => {
    await loadCustomAgents();
    expect(agentDefsFor("p1")).toEqual([]);
  });

  it("projectId sintetis (sesi VPS) tak meledak — global tetap terbawa", async () => {
    await mk(null, "glob");
    await loadCustomAgents();
    expect(agentDefsFor("vps:9").map((a) => a.name)).toEqual(["glob"]);
  });

  it("kolom Json rusak dari sync dibaca defensif", async () => {
    await mk(null, "a", { mentions: "bukan array", tools: 42 });
    await loadCustomAgents();
    const d = agentDefsFor("p1")[0]!;
    expect(d.mentions).toEqual([]);
    expect(d.tools).toBeNull();
  });
});

describe("validateGraph — lapis 1 anti-loop, LINTAS SCOPE (ADR-0094 gotcha 2)", () => {
  const row = (projectId: string | null, name: string, mentions: string[]) => ({
    id: customAgentId(projectId, name), projectId, name,
    description: "d", instructions: "i", tools: null, model: null,
    mentions, enabled: true,
  });

  it("graf asiklik → null", () => {
    expect(validateGraph([row(null, "a", ["b"]), row(null, "b", [])])).toBeNull();
  });

  it("siklus di scope global terdeteksi", () => {
    const r = validateGraph([row(null, "a", ["b"]), row(null, "b", ["a"])]);
    expect(r?.scope).toBe("global");
    expect(r?.cycle).toEqual(["a", "b", "a"]);
  });

  it("SIKLUS YANG HANYA MUNCUL SAAT PROJECT MENIMPA GLOBAL terdeteksi", () => {
    // global: g -> h (asiklik). project p1 menimpa `h` dengan versi yang menunjuk balik ke g.
    const r = validateGraph([
      row(null, "g", ["h"]),
      row(null, "h", []),
      row("p1", "h", ["g"]),
    ]);
    expect(r?.scope).toBe("p1");
    expect(r?.cycle).toEqual(["g", "h", "g"]);
  });

  it("agen project yang DIMATIKAN memutus siklus (ia menyembunyikan global)", () => {
    const r = validateGraph([
      row(null, "g", ["h"]),
      row(null, "h", ["g"]),
      { ...row("p1", "h", []), enabled: false },
    ]);
    expect(r?.scope).toBe("global"); // global tetap pecah; p1 tidak
  });
});

describe("unknownMentions", () => {
  const row = (projectId: string | null, name: string, mentions: string[]) => ({
    id: customAgentId(projectId, name), projectId, name,
    description: "d", instructions: "i", tools: null, model: null, mentions, enabled: true,
  });

  it("agen global hanya boleh menyebut agen global", () => {
    const all = [row(null, "g", ["lokal"]), row("p1", "lokal", [])];
    expect(unknownMentions(all[0]!, all)).toEqual(["lokal"]);
  });

  it("agen project boleh menyebut agen project DAN global", () => {
    const all = [row(null, "g", []), row("p1", "a", ["g", "b"]), row("p1", "b", [])];
    expect(unknownMentions(all[1]!, all)).toEqual([]);
  });

  it("nama yang benar-benar tak ada dilaporkan", () => {
    const all = [row("p1", "a", ["hantu"])];
    expect(unknownMentions(all[0]!, all)).toEqual(["hantu"]);
  });

  it("agen project tak bisa menyebut agen project LAIN", () => {
    const all = [row("p1", "a", ["asing"]), row("p2", "asing", [])];
    expect(unknownMentions(all[0]!, all)).toEqual(["asing"]);
  });
});

describe("toDef", () => {
  it("memetakan baris DB ke bentuk render runner", () => {
    const d = toDef({
      id: "global:a", projectId: null, name: "a", description: "desc",
      instructions: "ins", tools: ["Read"], model: "haiku", mentions: ["b"], enabled: true,
    });
    expect(d).toEqual({
      name: "a", description: "desc", instructions: "ins",
      tools: ["Read"], model: "haiku", mentions: ["b"],
    });
  });
});
