import { describe, it, expect } from "vitest";
import {
  LEAD_ACTIONS, LEAD_FORBIDDEN, leadActionAllowed, leadRefusalReason,
  isWeightyDecision, zLeadVerdict, zLeadAsk,
} from "./lead";
import { zLead, LEAD_DEFAULTS, zSetting } from "./entities";
import { CAPABILITY_IDS, grantsCapability } from "./agent";

describe("SPEC-409 · permukaan tindakan lead (AC-31/32/34)", () => {
  it("is an allowlist: anything not listed is locked", () => {
    expect(leadActionAllowed("integrate-main")).toBe(true);
    expect(leadActionAllowed("deploy")).toBe(false);
    expect(leadActionAllowed("rm -rf /")).toBe(false);
    expect(leadActionAllowed("")).toBe(false);
  });
  // Test niat, bukan sekadar isi: allowlist yang kelak bertambah satu entri berbahaya akan
  // menabrak assert ini alih-alih lolos diam-diam.
  it("never lets a forbidden action into the allowlist", () => {
    for (const forbidden of Object.keys(LEAD_FORBIDDEN)) {
      expect(LEAD_ACTIONS as readonly string[]).not.toContain(forbidden);
      expect(leadActionAllowed(forbidden)).toBe(false);
    }
  });
  it("names every locked action in plain language, including unknown ones", () => {
    expect(leadRefusalReason("deploy")).toContain("produksi");
    expect(leadRefusalReason("vps-console")).toContain("VPS");
    expect(leadRefusalReason("delete-decision")).toContain("jejak keputusan");
    expect(leadRefusalReason("sesuatu-yang-baru")).toContain("di luar permukaan tindakan lead");
  });
  it("has no action that deletes anything", () => {
    for (const a of LEAD_ACTIONS) expect(a.startsWith("delete")).toBe(false);
  });
});

describe("SPEC-409 · putusan berbobot (AC-25, OQ-5)", () => {
  const base = { kind: "answer", action: "none", confidence: "tinggi" } as const;
  it("is quiet for an ordinary confident answer", () => {
    expect(isWeightyDecision(base)).toBe(false);
  });
  it("fires on doubt regardless of anything else", () => {
    expect(isWeightyDecision({ ...base, confidence: "ragu" })).toBe(true);
  });
  it("fires on hard-to-undo actions", () => {
    for (const action of ["integrate-main", "run-migration", "stop-session", "restart-session"] as const) {
      expect(isWeightyDecision({ ...base, action })).toBe(true);
    }
  });
  it("fires on collisions and refusals", () => {
    expect(isWeightyDecision({ ...base, kind: "collision" })).toBe(true);
    expect(isWeightyDecision({ ...base, kind: "refusal" })).toBe(true);
  });
  it("stays quiet for reversible actions", () => {
    for (const action of ["answer-session", "order-queue", "resume-session", "hold-work"] as const) {
      expect(isWeightyDecision({ ...base, action })).toBe(false);
    }
  });
});

describe("SPEC-409 · bentuk jawaban (AC-1)", () => {
  it("fills sane defaults so a terse-but-valid verdict is still usable", () => {
    const v = zLeadVerdict.parse({ decision: "pakai opsi 1", reason: "ADR-0029" });
    expect(v).toEqual({ decision: "pakai opsi 1", reason: "ADR-0029", refs: [], confidence: "sedang", action: "none", reply: "" });
  });
  it("rejects a verdict without a decision or a reason", () => {
    expect(zLeadVerdict.safeParse({ decision: "", reason: "x" }).success).toBe(false);
    expect(zLeadVerdict.safeParse({ decision: "x" }).success).toBe(false);
  });
  // Yang bikin ini penting: kalau enum menyaring `action` di sini, permintaan "deploy" hanya akan
  // tampak sebagai keluaran rusak — dan justru peristiwa paling layak dilaporkan (AC-33) hilang.
  it("lets a forbidden action through parsing so the server can refuse it on the record", () => {
    const v = zLeadVerdict.parse({ decision: "d", reason: "r", action: "deploy" });
    expect(v.action).toBe("deploy");
    expect(leadActionAllowed(v.action)).toBe(false);
  });
});

describe("SPEC-409 · knob lead (AC-30)", () => {
  it("is off by default in every dimension that can act", () => {
    expect(LEAD_DEFAULTS.enabled).toBe(false);
    expect(LEAD_DEFAULTS.paused).toBe(false);
    expect(LEAD_DEFAULTS.pausedProjects).toEqual([]);
    expect(LEAD_DEFAULTS.engine.enabled).toBe(false);   // warisi sessionAgentDefaults()
  });
  it("keeps an objective gate before integrating to main by default (OQ-3)", () => {
    expect(LEAD_DEFAULTS.requireGreenBeforeIntegrate).toBe(true);
  });
  it("caps consecutive auto-answers per session (AC-11 / OQ-10)", () => {
    expect(LEAD_DEFAULTS.maxAutoAnswers).toBe(3);
  });
  // Baris Setting yang ditulis sebelum SPEC-409 tak punya blok ini sama sekali; tanpa .default()
  // seluruh layar Settings jatuh ke DEFAULT_SETTING dan setelan operator lenyap dari tampilan.
  it("parses a pre-SPEC-409 Setting row without the block", () => {
    const parsed = zSetting.parse({
      model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
    });
    expect(parsed.lead).toEqual(LEAD_DEFAULTS);
  });
  it("rejects a heartbeat faster than a minute", () => {
    expect(zLead.safeParse({ everyMin: 0 }).success).toBe(false);
  });
});

// SPEC-479 (QA) · sebelum ini "berapa putusan boleh disusun sekaligus" tak dinyatakan di mana pun,
// jadi jawabannya jatuh ke bentuk kode tiap pintu: 1 (pintu deteksi, `for`+`await`) dan tak hingga
// (pintu kontrak, Fastify konkuren). Knob-nya hidup di blok `lead` yang sudah ada — kolom
// `Setting.data` bertipe Json, jadi TANPA migration, cermin seluruh knob lead sejak ADR-0091.
describe("SPEC-479 · batas konkurensi & deadline penerimaan", () => {
  it("membatasi putusan yang disusun sekaligus, default kecil", () => {
    // 2 diambil dari mesin tempat keluhan lahir (8 GB / 8 core yang sudah menanggung sesi pekerja
    // di tmux), bukan dari angka bulat: satu `claude -p --effort xhigh` adalah runtime Node penuh.
    expect(LEAD_DEFAULTS.maxConcurrent).toBe(2);
  });
  it("memberi deadline pada antreannya — menunggu harus punya ujung", () => {
    // Fastify menyetel `requestTimeout: 0` (terukur), jadi TAK ADA yang memutus peminta selain
    // batas ini. Antrean tanpa deadline = "menggantung tanpa batas" yang diminta dihapus keluhan.
    expect(LEAD_DEFAULTS.queueWaitSec).toBe(120);
  });
  it("menolak kapasitas nol — gerbang yang tak meloloskan siapa pun bukan gerbang", () => {
    expect(zLead.safeParse({ maxConcurrent: 0 }).success).toBe(false);
  });
  it("mengizinkan antrean tanpa tunggu (0) — penuh berarti langsung ditolak", () => {
    expect(zLead.safeParse({ queueWaitSec: 0 }).success).toBe(true);
  });
});

describe("SPEC-409 · capability lead (AC-5)", () => {
  it("adds a domain of its own rather than borrowing an existing prefix", () => {
    expect(CAPABILITY_IDS).toContain("lead:read");
    expect(CAPABILITY_IDS).toContain("lead:write");
  });
  it("never lets a read capability stand in for the write one", () => {
    expect(grantsCapability(["lead:read"], "lead:write")).toBe(false);
    expect(grantsCapability(["lead:write"], "lead:read")).toBe(true);
  });
});

describe("SPEC-409 · permintaan putusan (kontrak eksplisit)", () => {
  it("needs a project and a question", () => {
    expect(zLeadAsk.safeParse({ projectId: "p" }).success).toBe(false);
    expect(zLeadAsk.safeParse({ question: "q?" }).success).toBe(false);
    expect(zLeadAsk.safeParse({ projectId: "p", question: "q?" }).success).toBe(true);
  });
});
