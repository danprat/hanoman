import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { LEAD_DEFAULTS, type Lead, type LeadDelivery } from "@hanoman/shared";
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
  submits: string[];
};

function harness(over: Partial<DetectDeps> = {}, conf: Lead = cfg()): Harness {
  const sent: { id: string; text: string }[] = [];
  const asked: string[] = [];
  const notes: string[] = [];
  const submits: string[] = [];
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
    // SPEC-480 · default harness: saluran pengiriman kosong → jatuh ke `row.answer`, yaitu
    // perilaku persis sebelum spec ini. Test yang memang menguji perakitan teks menimpanya.
    delivery: () => null,
    optIn: async () => ["demo"],
    notify: async (_id, title) => { notes.push(title); },
    cfg: async () => conf,
    // SPEC-474 · menekan `Submit answers` adalah langkah mekanis; `sleep` disuntik supaya rantai
    // bisa diuji tanpa waktu nyata.
    submit: async (id) => { submits.push(id); return true; },
    sleep: async () => {},
    ...over,
  };
  return { deps, sent, asked, notes, submits };
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

// SPEC-474 · dialog `AskUserQuestion` BERANTAI: satu tool call, beberapa pertanyaan berturut-turut.
// Menjawab satu pertanyaan hanya MEMAJUKAN dialog; yang menutupnya adalah layar rekap. Sampai spec
// ini, lead menjawab pertanyaan pertama lalu mengosongkan marker — dan marker itu TAK PERNAH terisi
// lagi (hook `Notification` menembak sekali per dialog; terukur 0 B selama 120 dtk dengan dialog
// masih terbuka), jadi sisa rantainya tak terlihat oleh siapa pun dan panenya menahan satu slot
// governor selamanya.
const RANTAI_Q1 = [
  "←  ☐ Warna  ☐ Ukuran  ✔ Submit  →", "", "Pilih warna tema?", "",
  "❯ 1. Merah", "  2. Biru", "  3. Type something.", "  4. Chat about this", "",
  "Enter to select · Tab/Arrow keys to navigate · Esc to cancel",
].join("\n");

const RANTAI_Q2 = [
  "←  ☒ Warna  ☐ Ukuran  ✔ Submit  →", "", "Pilih ukuran font?", "",
  "❯ 1. Kecil", "  2. Besar", "  3. Type something.", "  4. Chat about this", "",
  "Enter to select · Tab/Arrow keys to navigate · Esc to cancel",
].join("\n");

const RANTAI_REVIEW = [
  "←  ☒ Warna  ☒ Ukuran  ✔ Submit  →", "", "Review your answers", "",
  "Ready to submit your answers?", "", "❯ 1. Submit answers", "  2. Cancel",
].join("\n");

const SELESAI = "⏺ User answered Claude's questions:\n\n❯\n  ⏵⏵ bypass permissions on";

/** `decide` yang menjawab berbeda tiap panggilan — supaya urutan jawabannya bisa diperiksa. */
const menjawab = (counter: { n: number }): Partial<DetectDeps> => ({
  decide: (async (req: { question: string; projectId: string; specId?: string | null; sessionId?: string | null; notes?: string[] }) => {
    counter.n += 1;
    return recordDecision({
      projectId: req.projectId, specId: req.specId, sessionId: req.sessionId,
      gate: "detected", kind: "answer", question: req.question,
      answer: `jawab-${counter.n}`, reason: "r", refs: [], confidence: "tinggi", action: "none",
    });
  }) as unknown as DetectDeps["decide"],
});

describe("scanAndAnswer · rantai dialog sampai submit (SPEC-474)", () => {
  it("menjawab tiap pertanyaan lalu MENEKAN submit, satu keputusan per pertanyaan", async () => {
    const screens = [RANTAI_Q1, RANTAI_Q2, RANTAI_REVIEW, SELESAI];
    let idx = 0;
    const counter = { n: 0 };
    const cleared: string[] = [];
    const h = harness({
      ...menjawab(counter),
      pane: () => screens[Math.min(idx, screens.length - 1)]!,
      send: async (id, text) => { idx++; return (h.sent.push({ id, text }), true); },
      submit: async (id) => { idx++; return (h.submits.push(id), true); },
      clearMarker: (f: string) => { cleared.push(f); },
    });
    const r = await scanAndAnswer(h.deps);
    expect(r.answered).toEqual(["s1"]);
    expect(counter.n).toBe(2);                       // dua pertanyaan, dua keputusan
    expect(h.submits).toEqual(["s1"]);               // submit TIDAK memanggil agen
    expect(h.sent.map((s) => s.text)).toEqual(["jawab-1", "jawab-2"]);
    expect(cleared).toEqual(["/marker"]);            // marker dikosongkan SEKALI, di ujung rantai
    expect(answerCount("s1")).toBe(1);               // satu rantai = SATU jawaban otomatis
  });

  it("memberi tahu lead posisi pertanyaannya di dalam rantai", async () => {
    const screens = [RANTAI_Q1, RANTAI_Q2, RANTAI_REVIEW, SELESAI];
    let idx = 0;
    const seen: string[] = [];
    const h = harness({
      pane: () => screens[Math.min(idx, screens.length - 1)]!,
      send: async () => { idx++; return true; },
      submit: async () => { idx++; return true; },
      decide: (async (req: { question: string; projectId: string; notes?: string[] }) => {
        seen.push((req.notes ?? []).join(" "));
        return recordDecision({
          projectId: req.projectId, gate: "detected", kind: "answer", question: req.question,
          answer: "ok", reason: "r", refs: [], confidence: "tinggi", action: "none",
        });
      }) as unknown as DetectDeps["decide"],
    });
    await scanAndAnswer(h.deps);
    expect(seen[0]).toContain("pertanyaan ke-1");
    expect(seen[1]).toContain("pertanyaan ke-2");
  });

  // Kebalikan dari perilaku hari ini: rantai yang putus HARUS tetap terlihat menunggu.
  it("rantai putus TIDAK mengosongkan marker dan dihitung sebagai kegagalan", async () => {
    const screens = [RANTAI_Q1, RANTAI_Q2];
    let idx = 0, calls = 0;
    const cleared: string[] = [];
    const h = harness({
      pane: () => screens[Math.min(idx, screens.length - 1)]!,
      send: async () => { idx++; return true; },
      clearMarker: (f: string) => { cleared.push(f); },
      decide: (async (req: { question: string; projectId: string }) => {
        calls++;
        return recordDecision({
          projectId: req.projectId, gate: "detected", kind: "answer", question: req.question,
          answer: calls === 1 ? "ok" : "", reason: "r", refs: [], confidence: "tinggi",
          action: "none", ...(calls === 1 ? {} : { status: "gagal" as const }),
        });
      }) as unknown as DetectDeps["decide"],
    });
    const r = await scanAndAnswer(h.deps);
    expect(r.answered).toEqual([]);
    expect(cleared).toEqual([]);                     // operator tetap melihat sesi MENUNGGU
    expect(failureCount("s1")).toBe(1);
    expect(answerCount("s1")).toBe(0);
  });

  // Pane yang tak pernah maju tak boleh membuat lead mengetik berulang-ulang ke layar yang sama.
  it("berhenti bila layar dialog tak berubah sesudah dijawab (anti-loop)", async () => {
    const counter = { n: 0 };
    const cleared: string[] = [];
    const h = harness({
      ...menjawab(counter),
      pane: () => RANTAI_Q1,                          // layar MACET
      clearMarker: (f: string) => { cleared.push(f); },
    });
    await scanAndAnswer(h.deps);
    expect(counter.n).toBe(1);                        // tak mengulang keputusan untuk layar yang sama
    expect(cleared).toEqual([]);
    expect(failureCount("s1")).toBe(1);
  });

  it("submit yang gagal tak pernah dilaporkan sebagai rantai tuntas", async () => {
    const cleared: string[] = [];
    const h = harness({
      pane: () => RANTAI_REVIEW,
      submit: async () => false,
      clearMarker: (f: string) => { cleared.push(f); },
    });
    const r = await scanAndAnswer(h.deps);
    expect(r.answered).toEqual([]);
    expect(cleared).toEqual([]);
    expect(r.skipped[0]!.reason).toContain("Submit");
  });

  // Layar rekap adalah langkah MEKANIS: menutup dialog yang jawabannya sudah masuk tak butuh
  // pertimbangan apa pun, jadi tak boleh membakar satu giliran agen.
  it("layar rekap ditutup tanpa memanggil agen sama sekali", async () => {
    const screens = [RANTAI_REVIEW, SELESAI];
    let idx = 0;
    const counter = { n: 0 };
    const h = harness({
      ...menjawab(counter),
      pane: () => screens[Math.min(idx, screens.length - 1)]!,
      submit: async (id) => { idx++; return (h.submits.push(id), true); },
    });
    const r = await scanAndAnswer(h.deps);
    expect(counter.n).toBe(0);
    expect(h.submits).toEqual(["s1"]);
    expect(r.answered).toEqual(["s1"]);
  });

  // Jalur lama (kolom chat biasa) tak boleh berubah sedikit pun.
  it("kolom chat biasa tetap satu jawaban lalu selesai", async () => {
    const cleared: string[] = [];
    const counter = { n: 0 };
    const h = harness({ ...menjawab(counter), clearMarker: (f: string) => { cleared.push(f); } });
    const r = await scanAndAnswer(h.deps);
    expect(r.answered).toEqual(["s1"]);
    expect(counter.n).toBe(1);
    expect(cleared).toEqual(["/marker"]);
    expect(answerCount("s1")).toBe(1);
  });

  // Dialog satu pertanyaan: menjawabnya SUDAH men-submit (claude menyembunyikan tab Submit), jadi
  // layar berikutnya bukan dialog lagi dan rantainya berhenti di situ — tanpa keputusan kedua.
  it("dialog satu pertanyaan tetap selesai dalam satu jawaban", async () => {
    const screens = [ASKQ_PANE, SELESAI];
    let idx = 0;
    const counter = { n: 0 };
    const cleared: string[] = [];
    const h = harness({
      ...menjawab(counter),
      pane: () => screens[Math.min(idx, screens.length - 1)]!,
      send: async () => { idx++; return true; },
      clearMarker: (f: string) => { cleared.push(f); },
    });
    const r = await scanAndAnswer(h.deps);
    expect(r.answered).toEqual(["s1"]);
    expect(counter.n).toBe(1);
    expect(h.submits).toEqual([]);
    expect(cleared).toEqual(["/marker"]);
  });
});

// SPEC-480 · ADR-0098 · yang diketik ke kolom jawaban bebas DIRAKIT dari putusan terstruktur.
// Sebelum spec ini, prosa lead adalah satu-satunya jembatan: model di seberang harus menafsirkan
// kalimatnya untuk menebak opsi mana yang dipilih — dan SPEC-452 sudah mengukur ongkos salah tebak.
describe("scanAndAnswer · teks jawaban dirakit dari pilihan (SPEC-480)", () => {
  const withDelivery = (d: Partial<LeadDelivery>): Partial<DetectDeps> => ({
    pane: () => ASKQ_PANE,
    delivery: () => ({ decision: "d", reason: "Redis sudah dipakai modul lain.", reply: "", choice: null, missing: [], ...d }),
  });

  it("types the chosen option verbatim instead of the raw prose", async () => {
    const h = harness(withDelivery({ choice: { index: 2, option: "Redis" } }));
    await scanAndAnswer(h.deps);
    expect(h.sent[0]!.text).toBe("Pilih: Redis. Redis sudah dipakai modul lain.");
  });

  it("says what is missing when lead declared the context insufficient", async () => {
    const h = harness(withDelivery({ missing: ["versi Redis yang dipakai produksi"] }));
    await scanAndAnswer(h.deps);
    expect(h.sent[0]!.text).toContain("Belum bisa kuputuskan");
    expect(h.sent[0]!.text).toContain("versi Redis yang dipakai produksi");
  });

  // Saluran pengiriman boleh meleset — yang selalu ada adalah `answer`, dan mengetik string kosong
  // ke pane tak pernah boleh terjadi.
  it("falls back to the trail answer when the delivery channel misses", async () => {
    const h = harness({ pane: () => ASKQ_PANE, delivery: () => null });
    await scanAndAnswer(h.deps);
    expect(h.sent[0]!.text).toBe("opsi 1");
  });
});
