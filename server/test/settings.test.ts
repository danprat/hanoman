import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { resetDb } from "./factory";
import { getSetting, sessionModel, DEFAULT_SETTING } from "../src/services/settings";

// Baris Setting adalah `Json` bebas bentuk. Baris yang ditulis SEBELUM SPEC-162 menyimpan
// `steps` per fase dan tak punya `model` maupun `effort` — dikembalikan mentah, sesi lahir
// dengan `claude --model undefined`.
const BARIS_LAMA = {
  steps: { brainstorm: { model: "claude-opus-4-8", effort: "xhigh" } },
  blockStale: true, requireLinks: true, maxConcurrent: 6, askTimeoutMin: 30,
  autoDefault: true, autoScaffold: true, notifyFail: true,
};

describe("settings", () => {
  beforeEach(async () => { await resetDb(); });

  it("DB tanpa baris Setting jatuh ke default, bukan melempar P2025", async () => {
    expect(await getSetting()).toEqual(DEFAULT_SETTING);
  });

  it("baris pra-SPEC-162 diberi model + effort, dan kunci matinya dibuang", async () => {
    await prisma.setting.create({ data: { id: 1, data: BARIS_LAMA } });
    const s = await getSetting();
    expect(s.model).toBe("claude-opus-4-8");
    expect(s.effort).toBe("xhigh");
    expect(s).not.toHaveProperty("steps");
    expect(s).not.toHaveProperty("maxConcurrent");
  });

  it("sessionModel tak pernah mengembalikan undefined ke argv claude", async () => {
    await prisma.setting.create({ data: { id: 1, data: BARIS_LAMA } });
    const { model, effort } = await sessionModel();
    expect(model).toBeTruthy();
    expect(effort).toBeTruthy();
  });

  it("data yang benar-benar rusak jatuh ke default, tidak mengosongkan layar Settings", async () => {
    await prisma.setting.create({ data: { id: 1, data: { sampah: true } } });
    expect(await getSetting()).toEqual(DEFAULT_SETTING);
  });

  it("default memuat notifyDone + notifySound (SPEC-180)", () => {
    expect(DEFAULT_SETTING.notifyDone).toBe(true);
    expect(DEFAULT_SETTING.notifySound).toBe("short");
  });

  it("default memuat notifyDecision + notifyDecisionSound (SPEC-184)", () => {
    expect(DEFAULT_SETTING.notifyDecision).toBe(true);
    expect(DEFAULT_SETTING.notifyDecisionSound).toBe("alert");
  });

  it("baris yang sudah bentuk baru dikembalikan apa adanya", async () => {
    await prisma.setting.create({ data: { id: 1, data: {
      model: "claude-sonnet-5", effort: "low", autoDefault: false, autoScaffold: false, notifyFail: false } } });
    const s = await getSetting();
    expect(s.model).toBe("claude-sonnet-5");
    expect(s.effort).toBe("low");
    expect(s.autoDefault).toBe(false);
  });

  // SPEC-252 · ADR-0061 — matrix per-fase dicabut; model/effort per sesi (default global).
  it("DEFAULT_SETTING tak punya phaseModels", () => {
    expect("phaseModels" in DEFAULT_SETTING).toBe(false);
  });
  it("baris lama yang masih memuat phaseModels tetap parse; sessionModel = global", async () => {
    await prisma.setting.create({ data: { id: 1, data: {
      model: "claude-sonnet-5", effort: "low", autoDefault: true, autoScaffold: true, notifyFail: true,
      phaseModels: { feature: { Execute: { effort: "max" } } },
    } } });
    const s = await getSetting();
    expect("phaseModels" in s).toBe(false);
    expect(await sessionModel()).toEqual({ model: "claude-sonnet-5", effort: "low" });
  });
});
