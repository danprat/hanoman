import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { recordDecision } from "../src/services/lead/trail";

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

const base = {
  projectId: "demo", gate: "contract", kind: "answer",
  question: "q?", answer: "a", reason: "r",
  refs: [], confidence: "tinggi", action: "none",
} as const;

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
