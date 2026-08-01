import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { recordDecision, toDecisionView, type TrailInput } from "../src/services/lead/trail";

// SPEC-480 · ADR-0098 · jejak keputusan menyimpan PILIHAN sebagai data, bukan hanya prosa.
// `options` ikut disimpan karena tanpa itu jejaknya tak bisa dibaca ulang: `question` tersimpan,
// menunya tidak, jadi "lead memilih opsi 2" tak bisa diverifikasi enam jam kemudian.

const clean = async () => {
  await prisma.leadDecision.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "demo", name: "Demo", desc: "", kind: "web" } });
});
afterAll(clean);

const base: TrailInput = {
  projectId: "demo", gate: "contract", kind: "answer",
  question: "q?", answer: "a", reason: "r",
  refs: [], confidence: "tinggi", action: "none",
};

describe("recordDecision · kolom pilihan (SPEC-480)", () => {
  it("stores the chosen option, its 1-based index, the menu, and the missing list", async () => {
    const row = await recordDecision({
      ...base,
      choice: "stop-session — lepas panenya",
      choiceIndex: 2,
      options: ["integrate-main — merge", "stop-session — lepas panenya"],
      missing: ["versi Node produksi"],
    });
    const read = await prisma.leadDecision.findUniqueOrThrow({ where: { id: row.id } });
    expect(read.choice).toBe("stop-session — lepas panenya");
    expect(read.choiceIndex).toBe(2);
    expect(read.options).toEqual(["integrate-main — merge", "stop-session — lepas panenya"]);
    expect(read.missing).toEqual(["versi Node produksi"]);
  });

  // Baris lama (dan baris tanpa opsi) tetap sah: keempat kolom nullable, tanpa default.
  it("leaves all four columns null when the caller offered no options", async () => {
    const row = await recordDecision({ ...base });
    const read = await prisma.leadDecision.findUniqueOrThrow({ where: { id: row.id } });
    expect(read.choice).toBeNull();
    expect(read.choiceIndex).toBeNull();
    expect(read.options).toBeNull();
    expect(read.missing).toBeNull();
  });
});

// SPEC-485 · ADR-0102 · jawaban SELALU daftar di permukaan baca. Baris pra-migrasi tak punya kolom
// `choices`, jadi ia diturunkan dari pasangan skalar lama — inilah yang membuat riwayat lama tetap
// terbaca sesudah perubahan skema, tanpa satu pun backfill.
describe("toDecisionView · kompatibilitas mundur pilihan (SPEC-485)", () => {
  const row = (over: Record<string, unknown>) => ({
    id: "d1", projectId: "demo", specId: null, sessionId: null,
    gate: "contract", kind: "answer", question: "q?", answer: "a", reason: "r",
    refs: [], confidence: "tinggi", action: "none",
    choice: null, choiceIndex: null, options: null, missing: null,
    choices: null, select: null, flowId: null, step: null,
    status: "berlaku", weighty: false, supersededById: null, actor: "lead",
    createdAt: new Date(), updatedAt: new Date(),
    ...over,
  });

  it("baris LAMA (hanya choice/choiceIndex) tetap memancarkan `choices` satu elemen", () => {
    const view = toDecisionView(row({ choice: "beta", choiceIndex: 2 }) as never);
    expect(view.choices).toEqual([{ index: 2, option: "beta" }]);
  });

  it("baris tanpa pilihan sama sekali memancarkan daftar kosong", () => {
    expect(toDecisionView(row({}) as never).choices).toEqual([]);
  });

  it("baris BARU memancarkan seluruh daftarnya apa adanya", () => {
    const view = toDecisionView(row({
      choice: "alpha", choiceIndex: 1,
      choices: [{ index: 1, option: "alpha" }, { index: 3, option: "gamma" }],
      select: { mode: "multi", min: 1, max: 2 }, flowId: "f1", step: 2,
    }) as never);
    expect(view.choices.map((c) => c.option)).toEqual(["alpha", "gamma"]);
    expect(view.select).toEqual({ mode: "multi", min: 1, max: 2 });
    expect(view.flowId).toBe("f1");
    expect(view.step).toBe(2);
  });

  it("bentuk `choices` yang rusak jatuh ke daftar kosong, bukan meruntuhkan pembacaan", () => {
    expect(toDecisionView(row({ choices: [{ index: 1 }, { option: "" }] }) as never).choices).toEqual([]);
  });
});

describe("recordDecision · pilihan jamak & rantai (SPEC-485)", () => {
  it("menyimpan daftar pilihan, spec select, dan tautan rantainya", async () => {
    const saved = await recordDecision({
      ...base,
      choices: [{ index: 1, option: "alpha" }, { index: 3, option: "gamma" }],
      choice: "alpha", choiceIndex: 1,
      options: ["alpha", "beta", "gamma"],
      select: { mode: "multi", min: 1, max: 2 },
      flowId: "f1", step: 2,
    });
    const read = await prisma.leadDecision.findUniqueOrThrow({ where: { id: saved.id } });
    expect(read.choices).toEqual([{ index: 1, option: "alpha" }, { index: 3, option: "gamma" }]);
    expect(read.select).toEqual({ mode: "multi", min: 1, max: 2 });
    expect(read.flowId).toBe("f1");
    expect(read.step).toBe(2);
  });
});
