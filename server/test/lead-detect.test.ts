import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { LEAD_DEFAULTS, type Lead } from "@hanoman/shared";
import type { LeadDecision } from "@prisma/client";
import { scanAndAnswer, __resetDetect, resetSession, answerCount, type DetectDeps } from "../src/services/lead/detect";
import { recordDecision } from "../src/services/lead/trail";

// SPEC-409 · ADR-0091 · pintu #2 (deteksi otomatis). Semua deps disuntik: nol tmux, nol agen.

const clean = async () => {
  await prisma.leadDecision.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(async () => { await clean(); __resetDetect(); });
afterAll(clean);

const cfg = (over: Partial<Lead> = {}): Lead => ({ ...LEAD_DEFAULTS, enabled: true, ...over });

type Harness = {
  deps: DetectDeps;
  sent: { id: string; text: string }[];
  asked: string[];
  notes: string[];
};

function harness(over: Partial<DetectDeps> = {}, conf: Lead = cfg()): Harness {
  const sent: { id: string; text: string }[] = [];
  const asked: string[] = [];
  const notes: string[] = [];
  const deps: DetectDeps = {
    live: () => [{ id: "s1", specId: "spec-1", projectId: "demo", decisionFile: "/marker" }],
    filled: () => true,
    pane: () => "Saya butuh keputusan.\nMana yang kamu mau?",
    agentOf: () => "claude",
    exited: () => false,
    send: async (id, text) => { sent.push({ id, text }); return true; },
    decide: (async (req: { question: string; projectId: string; specId?: string | null; sessionId?: string | null }) => {
      asked.push(req.question);
      return recordDecision({
        projectId: req.projectId, specId: req.specId, sessionId: req.sessionId,
        gate: "detected", kind: "answer", question: req.question,
        answer: "opsi 1", reason: "r", refs: [], confidence: "tinggi", action: "none",
      });
    }) as unknown as DetectDeps["decide"],
    decideDeps: {} as DetectDeps["decideDeps"],
    optIn: async () => ["demo"],
    notify: async (_id, title) => { notes.push(title); },
    cfg: async () => conf,
    ...over,
  };
  return { deps, sent, asked, notes };
}

describe("scanAndAnswer · gerbang", () => {
  it("does nothing while the master switch is off", async () => {
    const h = harness({}, { ...LEAD_DEFAULTS, enabled: false });
    expect((await scanAndAnswer(h.deps)).answered).toEqual([]);
    expect(h.sent).toEqual([]);
  });
  it("does nothing while paused (AC-15)", async () => {
    const h = harness({}, cfg({ paused: true }));
    expect((await scanAndAnswer(h.deps)).answered).toEqual([]);
  });
  it("skips a project that never opted in", async () => {
    const h = harness({ optIn: async () => [] });
    const r = await scanAndAnswer(h.deps);
    expect(r.answered).toEqual([]);
    expect(r.skipped[0]!.reason).toContain("opt-in");
  });
  it("skips a project paused individually", async () => {
    const h = harness({}, cfg({ pausedProjects: ["demo"] }));
    expect((await scanAndAnswer(h.deps)).skipped[0]!.reason).toContain("dijeda");
  });
  it("ignores sessions whose marker is empty — mereka tak menunggu apa-apa", async () => {
    const h = harness({ filled: () => false });
    const r = await scanAndAnswer(h.deps);
    expect(r.answered).toEqual([]);
    expect(r.skipped).toEqual([]);
  });
  // AC-10 · `remain-on-exit on` menahan pane mati; mengetik ke sana tak menghidupkan apa pun.
  it("never types into a dead pane (AC-10)", async () => {
    const h = harness({ exited: () => true });
    expect((await scanAndAnswer(h.deps)).skipped[0]!.reason).toBe("pane mati");
    expect(h.sent).toEqual([]);
  });
  // AC-9 · marker codex menyala juga saat sesi selesai wajar (ADR-0074).
  it("never types into a codex session that merely finished (AC-9)", async () => {
    const h = harness({ agentOf: () => "codex", pane: () => "Goal achieved\n42k tokens used" });
    expect(h.sent).toEqual([]);
    expect((await scanAndAnswer(h.deps)).skipped[0]!.reason).toContain("selesai wajar");
  });
});

describe("scanAndAnswer · menjawab (AC-7/AC-8)", () => {
  it("reads the pane, decides, and types the answer back", async () => {
    const h = harness();
    const r = await scanAndAnswer(h.deps);
    expect(r.answered).toEqual(["s1"]);
    expect(h.asked[0]).toContain("Mana yang kamu mau?");
    expect(h.sent).toEqual([{ id: "s1", text: "opsi 1" }]);
  });
  it("does not count an answer that never reached the pane", async () => {
    const h = harness({ send: async () => false });
    const r = await scanAndAnswer(h.deps);
    expect(r.answered).toEqual([]);
    expect(answerCount("s1")).toBe(0);
    expect(r.skipped[0]!.reason).toContain("mengetik");
  });
  it("does not type when lead failed to produce a valid decision", async () => {
    const h = harness({
      decide: (async (req: { projectId: string; question: string }) => recordDecision({
        projectId: req.projectId, gate: "detected", kind: "answer", question: req.question,
        answer: "", reason: "timeout", refs: [], confidence: "ragu", action: "none", status: "gagal",
      })) as unknown as DetectDeps["decide"],
    });
    expect((await scanAndAnswer(h.deps)).answered).toEqual([]);
    expect(h.sent).toEqual([]);
  });
});

describe("scanAndAnswer · batas jawaban otomatis (AC-11 / OQ-10)", () => {
  it("stops after maxAutoAnswers and notifies exactly once", async () => {
    const h = harness({}, cfg({ maxAutoAnswers: 2 }));
    await scanAndAnswer(h.deps);
    await scanAndAnswer(h.deps);
    expect(answerCount("s1")).toBe(2);
    const third = await scanAndAnswer(h.deps);
    expect(third.answered).toEqual([]);
    expect(third.skipped[0]!.reason).toContain("batas");
    expect(h.notes.filter((t) => t.includes("berhenti menjawab"))).toHaveLength(1);
    await scanAndAnswer(h.deps);   // putaran berikutnya tak menotifikasi ulang
    expect(h.notes.filter((t) => t.includes("berhenti menjawab"))).toHaveLength(1);
    expect(h.sent).toHaveLength(2);
  });
  // Marker memang kosong sesaat setelah lead mengetik (hook UserPromptSubmit menjalankan `: >`).
  // Kalau penghitung di-reset di sana, pagarnya tak pernah tercapai — loop tanpa ujung.
  it("keeps counting across the marker going empty and filling again", async () => {
    let filled = true;
    const h = harness({ filled: () => filled }, cfg({ maxAutoAnswers: 2 }));
    await scanAndAnswer(h.deps);
    filled = false; await scanAndAnswer(h.deps);   // agen sedang bekerja
    filled = true; await scanAndAnswer(h.deps);    // bertanya lagi
    expect(answerCount("s1")).toBe(2);
    expect((await scanAndAnswer(h.deps)).answered).toEqual([]);
  });
  // OQ-8 · manusia menang: campur tangan operator memutus rantai "berturut-turut".
  it("resets the counter when the operator steps in", async () => {
    const h = harness({}, cfg({ maxAutoAnswers: 1 }));
    await scanAndAnswer(h.deps);
    expect((await scanAndAnswer(h.deps)).answered).toEqual([]);
    resetSession("s1");
    expect((await scanAndAnswer(h.deps)).answered).toEqual(["s1"]);
  });
  it("forgets the counter once the session is gone", async () => {
    const h = harness({}, cfg({ maxAutoAnswers: 1 }));
    await scanAndAnswer(h.deps);
    expect(answerCount("s1")).toBe(1);
    const gone = harness({ live: () => [] }, cfg({ maxAutoAnswers: 1 }));
    await scanAndAnswer(gone.deps);
    expect(answerCount("s1")).toBe(0);
  });
});

describe("scanAndAnswer · jejak", () => {
  it("leaves one trail row per answer, linked to the session", async () => {
    const h = harness();
    await scanAndAnswer(h.deps);
    const rows: LeadDecision[] = await prisma.leadDecision.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sessionId: "s1", specId: "spec-1", gate: "detected" });
  });
});
