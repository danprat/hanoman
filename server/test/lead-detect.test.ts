import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { LEAD_DEFAULTS, type Lead } from "@hanoman/shared";
import type { LeadDecision } from "@prisma/client";
import { scanAndAnswer, __resetDetect, resetSession, answerCount, failureCount, type DetectDeps } from "../src/services/lead/detect";
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
    clearMarker: () => {},
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

// SPEC-472 (QA) · pagar AC-11 menghitung jawaban yang BERHASIL diberikan, jadi sesi yang
// keputusannya selalu gagal tak pernah mendekatinya: `engine.ts` TICK_MS = 5 dtk menjadwalkan
// percobaan berikutnya, selamanya. Terukur di produksi — 152 keputusan `gagal` untuk tiga sesi yang
// sama dalam ±13 menit, satu proses agen (dan kuota langganan yang sama dengan sesi pekerja) untuk
// masing-masing, tanpa satu pun jalan berhenti.
describe("scanAndAnswer · batas kegagalan beruntun (SPEC-472)", () => {
  const failing = (): Partial<DetectDeps> => ({
    decide: (async (req: { projectId: string; specId?: string | null; sessionId?: string | null; question: string }) =>
      recordDecision({
        projectId: req.projectId, specId: req.specId, sessionId: req.sessionId,
        gate: "detected", kind: "answer", question: req.question,
        answer: "", reason: "lead claude gagal (exit 1): Invalid API key · Fix external API key",
        refs: [], confidence: "ragu", action: "none", status: "gagal",
      })) as unknown as DetectDeps["decide"],
  });

  it("berhenti memanggil agen setelah maxAutoAnswers kegagalan beruntun", async () => {
    let calls = 0;
    const base = failing();
    const h = harness({
      decide: (async (...a: Parameters<DetectDeps["decide"]>) => { calls++; return (base.decide as DetectDeps["decide"])(...a); }) as DetectDeps["decide"],
    }, cfg({ maxAutoAnswers: 2 }));
    await scanAndAnswer(h.deps);
    await scanAndAnswer(h.deps);
    expect(calls).toBe(2);
    expect(failureCount("s1")).toBe(2);

    const third = await scanAndAnswer(h.deps);
    expect(calls).toBe(2);                       // tak ada agen ketiga yang di-spawn
    expect(third.answered).toEqual([]);
    expect(third.skipped[0]!.reason).toContain("gagal");
  });

  it("menotifikasi operator tepat sekali saat menyerah", async () => {
    const h = harness(failing(), cfg({ maxAutoAnswers: 1 }));
    await scanAndAnswer(h.deps);
    await scanAndAnswer(h.deps);
    await scanAndAnswer(h.deps);
    expect(h.notes.filter((t) => t.includes("gagal"))).toHaveLength(1);
  });

  // Kegagalan harus BERUNTUN: satu keputusan yang berhasil membuktikan lead masih sanggup.
  it("keputusan yang berhasil mengosongkan penghitung kegagalan", async () => {
    let broken = true;
    const base = failing();
    const h = harness({
      decide: (async (...a: Parameters<DetectDeps["decide"]>) =>
        broken ? (base.decide as DetectDeps["decide"])(...a) : harness().deps.decide(...a)) as DetectDeps["decide"],
    }, cfg({ maxAutoAnswers: 2 }));
    await scanAndAnswer(h.deps);
    expect(failureCount("s1")).toBe(1);
    broken = false;
    expect((await scanAndAnswer(h.deps)).answered).toEqual(["s1"]);
    expect(failureCount("s1")).toBe(0);
  });

  it("campur tangan operator memulihkan sesi yang sudah menyerah", async () => {
    const h = harness(failing(), cfg({ maxAutoAnswers: 1 }));
    await scanAndAnswer(h.deps);
    expect((await scanAndAnswer(h.deps)).skipped[0]!.reason).toContain("gagal");
    resetSession("s1");
    expect(failureCount("s1")).toBe(0);
  });

  it("melupakan penghitung begitu sesinya tak ada lagi", async () => {
    const h = harness(failing(), cfg({ maxAutoAnswers: 2 }));
    await scanAndAnswer(h.deps);
    expect(failureCount("s1")).toBe(1);
    const gone = harness({ ...failing(), live: () => [] }, cfg({ maxAutoAnswers: 2 }));
    await scanAndAnswer(gone.deps);
    expect(failureCount("s1")).toBe(0);
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

// SPEC-452 · dua cacat di ujung pintu deteksi: opsi dialog tak pernah sampai ke lead, dan marker
// tak pernah dikosongkan sesudah dialog dijawab (menjawab dialog BUKAN `UserPromptSubmit`, jadi
// hook pengosongnya tak menembak) — lead lalu mengetik lagi ke sesi yang sudah kembali bekerja.
const ASKQ_PANE = `
Mau pakai strategi cache yang mana?

❯ 1. In-memory
  2. Redis
  3. Tanpa cache
  4. Type something.
  5. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel
`;

describe("scanAndAnswer · dialog pilihan (SPEC-452)", () => {
  it("meneruskan opsi dialog ke lead, bukan hanya teks layarnya", async () => {
    const opts: (string[] | undefined)[] = [];
    const h = harness({
      pane: () => ASKQ_PANE,
      decide: (async (req: { question: string; options?: string[]; projectId: string; specId?: string | null; sessionId?: string | null }) => {
        opts.push(req.options);
        return recordDecision({
          projectId: req.projectId, specId: req.specId, sessionId: req.sessionId,
          gate: "detected", kind: "answer", question: req.question,
          answer: "Tanpa cache", reason: "r", refs: [], confidence: "tinggi", action: "none",
        });
      }) as unknown as DetectDeps["decide"],
    });
    await scanAndAnswer(h.deps);
    expect(opts[0]).toEqual(["In-memory", "Redis", "Tanpa cache"]);
  });

  it("mengosongkan marker sesudah jawaban benar-benar mendarat", async () => {
    const cleared: string[] = [];
    const h = harness({ clearMarker: (f: string) => { cleared.push(f); } });
    await scanAndAnswer(h.deps);
    expect(cleared).toEqual(["/marker"]);
  });

  it("TIDAK mengosongkan marker saat pengetikan gagal — sesi memang masih menunggu", async () => {
    const cleared: string[] = [];
    const h = harness({ send: async () => false, clearMarker: (f: string) => { cleared.push(f); } });
    await scanAndAnswer(h.deps);
    expect(cleared).toEqual([]);
  });
});
