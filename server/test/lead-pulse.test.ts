import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { LEAD_DEFAULTS, SCHEDULER_DEFAULTS, type Lead } from "@hanoman/shared";
import { pulse, findCollisions, __resetPulse, type PulseDeps, type WorkArea } from "../src/services/lead/pulse";
import { recordDecision } from "../src/services/lead/trail";

// SPEC-409 · ADR-0091 · pintu #3 (denyut proaktif): mutu hasil, tabrakan area kerja, urutan kerja.

const clean = async () => {
  await prisma.leadDecision.deleteMany();
  await prisma.schedulerQueueItem.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(async () => {
  await clean(); __resetPulse();
  await prisma.project.create({ data: { id: "demo", name: "Demo", desc: "", kind: "web", leadOptIn: true } });
});
afterAll(clean);

const cfg = (over: Partial<Lead> = {}): Lead => ({ ...LEAD_DEFAULTS, enabled: true, ...over });
const area = (specId: string, paths: string[]): WorkArea =>
  ({ specId, sessionId: specId, projectId: "demo", paths });

describe("findCollisions (AC-14, OQ-9)", () => {
  it("finds the same file touched by two sessions", () => {
    const c = findCollisions([area("a", ["server/src/x.ts"]), area("b", ["server/src/x.ts"])]);
    expect(c).toHaveLength(1);
    expect(c[0]!.shared).toEqual(["server/src/x.ts"]);
  });
  it("reports a shared module as a weaker signal, without double-counting the shared file", () => {
    const c = findCollisions([
      area("a", ["server/src/x.ts", "server/src/y.ts"]),
      area("b", ["server/src/x.ts", "server/src/z.ts"]),
    ]);
    expect(c[0]!.shared).toEqual(["server/src/x.ts"]);
    expect(c[0]!.nearby).toEqual([]);   // modulnya sudah terwakili oleh berkas yang sama
  });
  it("flags a shared module even when no single file matches", () => {
    const c = findCollisions([area("a", ["server/src/y.ts"]), area("b", ["server/src/z.ts"])]);
    expect(c[0]!.shared).toEqual([]);
    expect(c[0]!.nearby).toEqual(["server/src"]);
  });
  it("is not a collision when the work is genuinely apart", () => {
    expect(findCollisions([area("a", ["server/src/x.ts"]), area("b", ["src/src/y.tsx"])])).toEqual([]);
  });
  it("never crosses project boundaries — satu lead melayani satu project (NG1)", () => {
    const b = { ...area("b", ["server/src/x.ts"]), projectId: "lain" };
    expect(findCollisions([area("a", ["server/src/x.ts"]), b])).toEqual([]);
  });
});

type Rec = { question: string; kind: string; options?: string[] };
function harness(over: Partial<PulseDeps> = {}, conf: Lead = cfg()) {
  const asked: Rec[] = [];
  const applied: string[] = [];
  const enqueued: string[] = [];
  const deps: PulseDeps = {
    sessions: () => [],
    areas: async () => [],
    planDone: () => true,
    // SPEC-451 · default `false`: sebagian besar test di berkas ini bicara soal sesi yang GAGAL,
    // dan pintu keberhasilan tak boleh ikut menyalak di sana.
    finished: () => false,
    decide: (async (req: { projectId: string; specId?: string | null; sessionId?: string | null; kind: string; question: string; options?: string[] }) => {
      asked.push({ question: req.question, kind: req.kind, options: req.options });
      return recordDecision({
        projectId: req.projectId, specId: req.specId, sessionId: req.sessionId,
        gate: "pulse", kind: req.kind as "quality", question: req.question,
        answer: "spec-2, spec-1", reason: "r", refs: [], confidence: "tinggi", action: "none",
      });
    }) as unknown as PulseDeps["decide"],
    decideDeps: {} as PulseDeps["decideDeps"],
    apply: (async (row: { action: string }) => { applied.push(row.action); return { ok: true, detail: "" }; }) as unknown as PulseDeps["apply"],
    enqueue: async (i) => { enqueued.push(i.specId); },
    notify: async () => { /* diam */ },
    optIn: async () => ["demo"],
    cfg: async () => conf,
    scheduler: async () => ({ ...SCHEDULER_DEFAULTS, enabled: true }),
    ...over,
  };
  return { deps, asked, applied, enqueued };
}

describe("pulse · gerbang (AC-12/15/30)", () => {
  it("is fully idle while the master switch is off", async () => {
    const h = harness({}, { ...LEAD_DEFAULTS, enabled: false });
    expect(await pulse(h.deps)).toEqual({ ordered: 0, collisions: 0, quality: 0 });
    expect(h.asked).toEqual([]);
  });
  it("is idle while paused", async () => {
    const h = harness({}, cfg({ paused: true }));
    expect(h.asked).toEqual([]);
    await pulse(h.deps);
    expect(h.asked).toEqual([]);
  });
  it("skips a project paused individually", async () => {
    const h = harness({
      sessions: () => [{ id: "s1", projectId: "demo", specId: "spec-1", cwd: "/wt", exited: true, exitCode: 1 }],
    }, cfg({ pausedProjects: ["demo"] }));
    await pulse(h.deps);
    expect(h.asked).toEqual([]);
  });
});

describe("pulse · mutu hasil (AC-16/17)", () => {
  const failedSession = [{ id: "s1", projectId: "demo", specId: "spec-1", cwd: "/wt", exited: true, exitCode: 1 }];

  it("follows up a session that died with a non-zero exit code", async () => {
    const h = harness({ sessions: () => failedSession });
    expect((await pulse(h.deps)).quality).toBe(1);
    expect(h.asked[0]!.kind).toBe("quality");
    expect(h.asked[0]!.question).toContain("kode keluar 1");
  });
  it("follows up a session that ended with unchecked plan boxes", async () => {
    const h = harness({
      sessions: () => [{ ...failedSession[0]!, exitCode: 0 }],
      planDone: () => false,
    });
    expect((await pulse(h.deps)).quality).toBe(1);
    expect(h.asked[0]!.question).toContain("`- [ ]`");
  });
  // SPEC-451 · pintu KEGAGALAN memang tak punya urusan dengan sesi yang bersih — tapi sampai spec
  // ini, "pintu kegagalan diam" berarti "tak ada yang menyentuhnya sama sekali", dan itulah bugnya.
  // Yang menyentuhnya sekarang pintu keberhasilan di blok bawah, digerbangi `finished` (SPEC-433),
  // bukan `exited`.
  it("leaves an exited session alone when the failure door has nothing to say", async () => {
    const h = harness({ sessions: () => [{ ...failedSession[0]!, exitCode: 0 }] });
    expect((await pulse(h.deps)).quality).toBe(0);
  });
  it("never touches a session that is still running", async () => {
    const h = harness({ sessions: () => [{ ...failedSession[0]!, exited: false }] });
    expect((await pulse(h.deps)).quality).toBe(0);
  });
  // Pane mati bertahan di tmux berhari-hari (`remain-on-exit on`) dan denyut jalan tiap 5 menit:
  // tanpa idempotensi lewat JEJAK, lead memutuskan hal yang sama berulang kali — juga sesudah
  // restart server, justru saat penanda di memori kosong.
  it("decides once per session, even across restarts (idempotent lewat jejak)", async () => {
    const h = harness({ sessions: () => failedSession });
    await pulse(h.deps); __resetPulse();
    await pulse(h.deps);
    expect(h.asked).toHaveLength(1);
  });
  // SPEC-432 · `decide()` MENULIS ULANG `kind` jadi "refusal" saat tindakan usulan lead di luar
  // allowlist (`kind = allowed ? req.kind : "refusal"`). Gerbang idempotensi yang mencari `kind`
  // aslinya karena itu tak pernah cocok, dan sesi mati yang sama ditanyakan ulang TIAP denyut —
  // selamanya, karena pane mati bertahan berhari-hari (`remain-on-exit on`). Ia belum terpicu di
  // lapangan hanya karena semua keputusan gagal lebih dulu; ia terpicu justru saat itu diperbaiki.
  it("does not re-decide a session whose verdict was recorded as a refusal", async () => {
    const h = harness({
      sessions: () => failedSession,
      decide: (async (req: { projectId: string; specId?: string | null; sessionId?: string | null; kind: string; question: string }) => {
        h.asked.push({ question: req.question, kind: req.kind });
        return recordDecision({
          projectId: req.projectId, specId: req.specId, sessionId: req.sessionId,
          gate: "pulse", kind: "refusal", question: req.question,
          answer: "hapus worktree-nya lalu mulai bersih", reason: "DITOLAK: menghapus worktree …",
          refs: [], confidence: "tinggi", action: "none", weighty: true,
        });
      }) as unknown as PulseDeps["decide"],
    });
    await pulse(h.deps); __resetPulse();
    await pulse(h.deps);
    expect(h.asked).toHaveLength(1);
  });

  it("executes the follow-up action lead chose", async () => {
    const h = harness({
      sessions: () => failedSession,
      decide: (async (req: { projectId: string; specId?: string | null; sessionId?: string | null; question: string }) => recordDecision({
        projectId: req.projectId, specId: req.specId, sessionId: req.sessionId,
        gate: "pulse", kind: "quality", question: req.question,
        answer: "lanjutkan", reason: "r", refs: [], confidence: "tinggi", action: "resume-session",
      })) as unknown as PulseDeps["decide"],
    });
    await pulse(h.deps);
    expect(h.applied).toEqual(["resume-session"]);
  });
});

// SPEC-451 · pintu KEBERHASILAN. `followUpFinished` di atas hanya mengenal kegagalan (exit ≠ 0,
// plan bersisa kotak) dan gerbangnya menuntut pane MATI — padahal di jalur sukses pane tak pernah
// mati sendiri (SPEC-433: agen adalah TUI yang kembali ke `❯` sesudah fase terakhir + push).
// Backlog yang SELESAI karena itu tak pernah diputuskan sama sekali, dan panenya terus terhitung
// `liveCount()` governor sehingga antrean scheduler tak pernah dapat ruang.
describe("pulse · backlog selesai (SPEC-451)", () => {
  const liveDone = [{ id: "s1", projectId: "demo", specId: "spec-1", cwd: "/wt", exited: false }];

  // Inti temuannya: gerbangnya `finished`, BUKAN `exited`. Sesi di bawah ini panenya masih hidup —
  // keadaan yang di kode lama tersaring di baris pertama loop dan tak pernah sampai ke lead.
  it("asks what to do with finished work whose pane is still alive", async () => {
    const h = harness({ sessions: () => liveDone, finished: () => true });
    expect((await pulse(h.deps)).quality).toBe(1);
    expect(h.asked[0]!.kind).toBe("quality");
    expect(h.asked[0]!.question).toContain("sudah selesai");
  });

  // Kedua tindakan ini sudah terimplementasi penuh di apply.ts sejak ADR-0091 dan tak pernah
  // ditawarkan satu pintu pun — mesin tanpa pengemudi.
  it("offers integrating the work and stopping the session", async () => {
    const h = harness({ sessions: () => liveDone, finished: () => true });
    await pulse(h.deps);
    const opts = h.asked[0]!.options!.join(" ");
    expect(opts).toContain("integrate-main");
    expect(opts).toContain("stop-session");
  });

  it("leaves a session that is still working alone", async () => {
    const h = harness({ sessions: () => liveDone, finished: () => false });
    expect((await pulse(h.deps)).quality).toBe(0);
    expect(h.asked).toEqual([]);
  });

  // Pane hidup bertahan berhari-hari dan denyut jalan tiap 5 menit; idempotensi lewat JEJAK, bukan
  // Set memori yang justru kosong sesudah restart (pelajaran ADR-0091 / SPEC-432).
  it("decides once per finished session, even across restarts", async () => {
    const h = harness({ sessions: () => liveDone, finished: () => true });
    await pulse(h.deps); __resetPulse();
    await pulse(h.deps);
    expect(h.asked).toHaveLength(1);
  });

  // Gerbang kedua pintu saling eksklusif secara konstruksi: `finished` sudah memuat `planComplete`,
  // jadi sesi selesai tak pernah `unfinished`. Tanpa itu satu sesi menerima DUA pertanyaan dalam
  // satu denyut — dua giliran agen untuk satu keadaan.
  it("never asks twice about a session both doors could see", async () => {
    const h = harness({
      sessions: () => [{ ...liveDone[0]!, exited: true, exitCode: 0 }],
      finished: () => true,
    });
    await pulse(h.deps);
    expect(h.asked).toHaveLength(1);
  });

  // Sesi yang gagal tetap milik pintu kegagalan: menawarkan "integrasikan" pada exit ≠ 0 adalah
  // persis kesalahan yang gerbang bukti objektif OQ-3 ada untuk mencegahnya.
  it("leaves a failed session to the failure door even when its phases are all recorded", async () => {
    const h = harness({
      sessions: () => [{ ...liveDone[0]!, exited: true, exitCode: 143 }],
      finished: () => true,
    });
    await pulse(h.deps);
    expect(h.asked).toHaveLength(1);
    expect(h.asked[0]!.question).toContain("kode keluar 143");
  });

  // Lead memutuskan LALU melapor: yang mengembalikan slot ke governor adalah tindakannya, bukan
  // barisnya di jejak.
  it("executes the action lead chose", async () => {
    const h = harness({
      sessions: () => liveDone,
      finished: () => true,
      decide: (async (req: { projectId: string; specId?: string | null; sessionId?: string | null; question: string }) => recordDecision({
        projectId: req.projectId, specId: req.specId, sessionId: req.sessionId,
        gate: "pulse", kind: "quality", question: req.question,
        answer: "integrasikan", reason: "r", refs: [], confidence: "tinggi", action: "integrate-main",
      })) as unknown as PulseDeps["decide"],
    });
    await pulse(h.deps);
    expect(h.applied).toEqual(["integrate-main"]);
  });

  // Berbeda dari `orderReadyWork`: penataan antrean tak punya pembaca saat scheduler mati, tapi
  // mengintegrasikan pekerjaan yang sudah selesai berharga baik antreannya dikuras maupun tidak.
  it("still runs while the scheduler is off", async () => {
    const h = harness({
      sessions: () => liveDone,
      finished: () => true,
      scheduler: async () => ({ ...SCHEDULER_DEFAULTS, enabled: false }),
    });
    expect((await pulse(h.deps)).quality).toBe(1);
  });
});

describe("pulse · urutan kerja (AC-13)", () => {
  beforeEach(async () => {
    // SPEC-432 · penataan hanya berarti bila antrean memang bisa dikuras: scheduler menyala &
    // tak dijeda, dan project-nya opt-in scheduler. Dunia default di sini sengaja AKTIONABEL —
    // ketidak-aktionabelan diuji satu per satu di blok "gerbang aktionabilitas" di bawah.
    await prisma.project.update({ where: { id: "demo" }, data: { schedulerOptIn: true } });
    for (const id of ["spec-1", "spec-2"]) {
      await prisma.spec.create({ data: {
        id, projectId: "demo", title: id, source: "brief", stage: "backlog",
        priority: "sedang", author: "t", objective: `objective ${id}`,
      } });
    }
  });

  it("hands the order it decided to the EXISTING queue, in that order", async () => {
    const h = harness();
    expect((await pulse(h.deps)).ordered).toBe(2);
    expect(h.enqueued).toEqual(["spec-2", "spec-1"]);   // urutan dari jawaban lead
  });
  it("still queues an item lead forgot to name, at the back", async () => {
    const h = harness({
      decide: (async (req: { projectId: string; question: string }) => recordDecision({
        projectId: req.projectId, gate: "pulse", kind: "order", question: req.question,
        answer: "spec-2", reason: "r", refs: [], confidence: "tinggi", action: "none",
      })) as unknown as PulseDeps["decide"],
    });
    await pulse(h.deps);
    expect(h.enqueued).toEqual(["spec-2", "spec-1"]);
  });
  // OQ-2 · jangan membakar kuota saat tak ada yang berubah.
  it("does not spend a lead turn when the ready set has not changed", async () => {
    const h = harness();
    await pulse(h.deps);
    await pulse(h.deps);
    expect(h.asked.filter((a) => a.kind === "order")).toHaveLength(1);
  });
  it("does not bother ordering a single ready item", async () => {
    await prisma.spec.delete({ where: { id: "spec-2" } });
    const h = harness();
    expect((await pulse(h.deps)).ordered).toBe(0);
    expect(h.asked).toEqual([]);
  });
  it("ignores backlog that already started (baseSha ada)", async () => {
    await prisma.spec.update({ where: { id: "spec-2" }, data: { baseSha: "abc1234" } });
    const h = harness();
    expect((await pulse(h.deps)).ordered).toBe(0);
  });
  // SPEC-431 · predikat lama (`baseSha: null` telanjang) juga dipakai di sini, jadi lead ikut
  // mengurutkan DAN mengantrekan pekerjaan yang sudah tuntas — item lama yang selesai sebelum
  // ADR-0030 tak pernah punya `baseSha`.
  it("ignores backlog that is already done, even without baseSha", async () => {
    await prisma.spec.update({ where: { id: "spec-2" }, data: { stage: "done" } });
    const h = harness();
    expect((await pulse(h.deps)).ordered).toBe(0);   // tersisa satu item siap → tak ada yang ditata
    expect(h.enqueued).toEqual([]);
  });
  // NG1 · satu lead melayani satu project. Menata dua project dalam SATU giliran akan menaruh
  // backlog project lain ke dalam pertanyaan yang diberi label project pertama — dan tanda tangan
  // "sudah ditata" jadi gabungan, sehingga project yang diam menahan project yang bergerak.
  it("orders each project separately, never in one mixed turn", async () => {
    await prisma.project.create({ data: { id: "lain", name: "Lain", desc: "", kind: "web", leadOptIn: true, schedulerOptIn: true } });
    for (const id of ["lain-1", "lain-2"]) {
      await prisma.spec.create({ data: {
        id, projectId: "lain", title: id, source: "brief", stage: "backlog",
        priority: "sedang", author: "t", objective: `objective ${id}`,
      } });
    }
    const h = harness({ optIn: async () => ["demo", "lain"] });
    expect((await pulse(h.deps)).ordered).toBe(4);
    const orders = h.asked.filter((a) => a.kind === "order");
    expect(orders).toHaveLength(2);
    for (const o of orders) expect(o.question).toContain("Ada 2 backlog");
  });
});

// SPEC-432 · audit `research/audit-spec-432-lead-tak-memutuskan-denyut-spam.md`.
//
// Enam dari tujuh panggilan lead di mesin operator adalah `pulse|order`, dan ketiga-tiganya per
// denyut TERBUKTI tak bisa mengubah apa pun: `scheduler.paused=true` (antrean tak pernah dikuras),
// 8/8 & 20/20 backlog siap-kerja SUDAH ada di antrean (`enqueue` = `upsert(update:{})` → penataan
// ulang no-op total), dan project ketiga `leadOptIn=1` tapi `schedulerOptIn=0`. Itulah "heartbeat
// spam tanpa ada hal yang bisa dilakukan": bukan lead yang terlalu rajin, melainkan lead yang
// membakar giliran agen untuk pekerjaan yang mustahil berdampak.
describe("pulse · gerbang aktionabilitas penataan (audit SPEC-432)", () => {
  beforeEach(async () => {
    await prisma.project.update({ where: { id: "demo" }, data: { schedulerOptIn: true } });
    for (const id of ["spec-1", "spec-2"]) {
      await prisma.spec.create({ data: {
        id, projectId: "demo", title: id, source: "brief", stage: "backlog",
        priority: "sedang", author: "t", objective: `objective ${id}`,
      } });
    }
  });

  it("spends no lead turn while the scheduler subsystem is off", async () => {
    const h = harness({ scheduler: async () => ({ ...SCHEDULER_DEFAULTS, enabled: false }) });
    expect((await pulse(h.deps)).ordered).toBe(0);
    expect(h.asked).toEqual([]);
  });

  it("spends no lead turn while the scheduler is paused — nothing drains the queue", async () => {
    const h = harness({ scheduler: async () => ({ ...SCHEDULER_DEFAULTS, enabled: true, paused: true }) });
    expect((await pulse(h.deps)).ordered).toBe(0);
    expect(h.asked).toEqual([]);
  });

  it("spends no lead turn on a project the scheduler may never launch", async () => {
    await prisma.project.update({ where: { id: "demo" }, data: { schedulerOptIn: false } });
    const h = harness();
    expect((await pulse(h.deps)).ordered).toBe(0);
    expect(h.asked).toEqual([]);
  });

  // `enqueue` adalah `upsert(..., update: {})`: spec yang sudah punya baris antrean tak berubah
  // sama sekali, termasuk `enqueuedAt` yang jadi tiebreak FIFO-nya. Menata ulang himpunan yang
  // seluruhnya sudah antre karena itu no-op — dan no-op tak boleh berharga satu panggilan agen.
  it("spends no lead turn when every ready item is already queued", async () => {
    for (const specId of ["spec-1", "spec-2"]) {
      await prisma.schedulerQueueItem.create({ data: { specId, projectId: "demo", source: "backlog", priority: "sedang" } });
    }
    const h = harness();
    expect((await pulse(h.deps)).ordered).toBe(0);
    expect(h.asked).toEqual([]);
  });

  it("still orders when at least two ready items are genuinely un-queued", async () => {
    const h = harness();
    expect((await pulse(h.deps)).ordered).toBe(2);
    expect(h.asked.filter((a) => a.kind === "order")).toHaveLength(1);
  });

  // SPEC-447 · ADR-0093 · gerbang aktionabilitas diperluas: item yang dependency-nya belum siap
  // TAK BISA diluncurkan governor, jadi menatanya membakar giliran agen untuk nol hasil.
  it("spends no lead turn when the only other ready item is blocked by a dependency", async () => {
    await prisma.spec.update({ where: { id: "spec-2" }, data: { dependsOn: ["spec-1"] } });
    const h = harness();
    expect((await pulse(h.deps)).ordered).toBe(0);   // tersisa satu item benar-benar siap
    expect(h.asked).toEqual([]);
  });

  // Tanda tangannya harus dihitung atas himpunan BELUM-ANTRE, bukan seluruh himpunan siap-kerja:
  // kalau tidak, satu item yang masuk antrean lewat jalur lain menggeser tanda tangan dan membeli
  // satu giliran agen lagi untuk penataan yang sisanya sudah no-op.
  it("does not re-decide when the only change is an item that just got queued", async () => {
    const h = harness();
    await pulse(h.deps);
    expect(h.asked.filter((a) => a.kind === "order")).toHaveLength(1);
    await prisma.spec.create({ data: {
      id: "spec-3", projectId: "demo", title: "spec-3", source: "brief", stage: "backlog",
      priority: "sedang", author: "t", objective: "objective spec-3",
    } });
    await prisma.schedulerQueueItem.create({ data: { specId: "spec-3", projectId: "demo", source: "backlog", priority: "sedang" } });
    await pulse(h.deps);
    expect(h.asked.filter((a) => a.kind === "order")).toHaveLength(1);
  });
});

describe("pulse · tabrakan (AC-14)", () => {
  const two = [
    { id: "s1", projectId: "demo", specId: "spec-1", cwd: "/wt1", exited: false },
    { id: "s2", projectId: "demo", specId: "spec-2", cwd: "/wt2", exited: false },
  ];
  it("records one decision per colliding pair", async () => {
    const h = harness({ sessions: () => two, areas: async () => ["server/src/x.ts"] });
    expect((await pulse(h.deps)).collisions).toBe(1);
    expect(h.asked[0]!.kind).toBe("collision");
  });
  it("does not re-decide the same pair on the next beat", async () => {
    const h = harness({ sessions: () => two, areas: async () => ["server/src/x.ts"] });
    await pulse(h.deps); __resetPulse();
    await pulse(h.deps);
    expect(h.asked.filter((a) => a.kind === "collision")).toHaveLength(1);
  });
  // SPEC-432 · cermin cacat yang sama di pintu tabrakan.
  it("does not re-decide a pair whose verdict was recorded as a refusal", async () => {
    const h = harness({
      sessions: () => two,
      areas: async () => ["server/src/x.ts"],
      decide: (async (req: { projectId: string; specId?: string | null; sessionId?: string | null; kind: string; question: string }) => {
        h.asked.push({ question: req.question, kind: req.kind });
        return recordDecision({
          projectId: req.projectId, specId: req.specId, sessionId: req.sessionId,
          gate: "pulse", kind: "refusal", question: req.question,
          answer: "hapus branch salah satunya", reason: "DITOLAK: menghapus branch …",
          refs: [], confidence: "tinggi", action: "none", weighty: true,
        });
      }) as unknown as PulseDeps["decide"],
    });
    await pulse(h.deps); __resetPulse();
    await pulse(h.deps);
    expect(h.asked).toHaveLength(1);
  });

  it("says nothing when the two sessions work apart", async () => {
    const h = harness({
      sessions: () => two,
      areas: async (s) => (s.specId === "spec-1" ? ["server/src/x.ts"] : ["src/src/y.tsx"]),
    });
    expect((await pulse(h.deps)).collisions).toBe(0);
  });
});
