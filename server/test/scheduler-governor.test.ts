import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { enqueue, queueItemForSpec, listQueue } from "../src/services/scheduler/queue";
import { drain, type GovernorDeps } from "../src/services/scheduler/governor";
import { SCHEDULER_DEFAULTS } from "@hanoman/shared";

const clean = () => prisma.schedulerQueueItem.deleteMany();
beforeEach(clean); afterAll(clean);
const cfg = (over = {}) => ({ ...SCHEDULER_DEFAULTS, enabled: true, ...over });

describe("governor.drain", () => {
  it("never launches beyond cap (live count invariant)", async () => {
    for (const p of ["a", "b", "c", "d"]) await enqueue({ specId: `SPEC-${p}`, projectId: "p1", source: "backlog", priority: "sedang" });
    let launched = 0;
    const deps: GovernorDeps = { liveCount: () => launched, isLive: () => null, isDone: async () => false, launch: async () => { launched++; return `s${launched}`; } };
    await drain(cfg({ maxConcurrent: 2 }), deps);
    expect(launched).toBe(2);                                   // cap dihormati
    expect((await listQueue("launched")).length).toBe(2);
    expect((await listQueue("queued")).length).toBe(2);        // sisanya tertahan
  });
  it("does nothing when live already at cap", async () => {
    await enqueue({ specId: "SPEC-x", projectId: "p1", source: "backlog", priority: "tinggi" });
    let launches = 0;
    const deps: GovernorDeps = { liveCount: () => 3, isLive: () => null, isDone: async () => false, launch: async () => { launches++; return "s"; } };
    await drain(cfg({ maxConcurrent: 3 }), deps);
    expect(launches).toBe(0);
    expect((await listQueue("queued")).length).toBe(1);
  });
  it("idempotent: a spec already live is marked launched without consuming a slot", async () => {
    await enqueue({ specId: "SPEC-live", projectId: "p1", source: "backlog", priority: "tinggi" });
    await enqueue({ specId: "SPEC-new", projectId: "p1", source: "backlog", priority: "sedang" });
    let launches = 0;
    const deps: GovernorDeps = {
      liveCount: () => 1,                                        // SPEC-live sudah dihitung live
      isLive: (specId) => (specId === "SPEC-live" ? "spec_live" : null),
      isDone: async () => false,
      launch: async () => { launches++; return "spec_new"; },
    };
    await drain(cfg({ maxConcurrent: 2 }), deps);
    expect(launches).toBe(1);                                   // hanya SPEC-new benar-benar di-launch
    expect((await queueItemForSpec("SPEC-live"))!.status).toBe("launched");
    expect((await queueItemForSpec("SPEC-live"))!.sessionId).toBe("spec_live");
    expect((await queueItemForSpec("SPEC-new"))!.status).toBe("launched");
  });
  // SPEC-431 · gerbang terakhir sebelum sebuah baris antrean jadi sesi tmux sungguhan. Memperbaiki
  // checker saja tidak cukup: 27 baris `queued` yang telanjur ada di DB produksi menunjuk spec yang
  // sudah `done` dan akan tetap meluncur. Ini juga menutup balapan nyata — operator menyelesaikan
  // item itu SELAGI ia mengantre.
  it("never launches a spec that is already done; the stale row is closed instead", async () => {
    await enqueue({ specId: "SPEC-old", projectId: "p1", source: "backlog", priority: "tinggi" });
    await enqueue({ specId: "SPEC-open", projectId: "p1", source: "backlog", priority: "sedang" });
    const launched: string[] = [];
    const deps: GovernorDeps = {
      liveCount: () => 0, isLive: () => null,
      isDone: async (specId) => specId === "SPEC-old",
      launch: async (item) => { launched.push(item.specId); return "s_open"; },
    };
    await drain(cfg({ maxConcurrent: 5 }), deps);
    expect(launched).toEqual(["SPEC-open"]);                    // item selesai tak pernah di-launch
    const old = (await queueItemForSpec("SPEC-old"))!;
    expect(old.status).toBe("done");                            // ditutup, bukan dibiarkan mengantre
    expect(old.sessionId).toBeNull();                           // tak ada sesi yang bisa diklaim
    expect(old.note).toBe("spec sudah selesai — tak diluncurkan");
  });

  it("a spec closed by the done gate does not consume a slot", async () => {
    for (const p of ["done1", "done2", "open"]) {
      await enqueue({ specId: `SPEC-${p}`, projectId: "p1", source: "backlog", priority: "sedang" });
    }
    let launches = 0;
    const deps: GovernorDeps = {
      liveCount: () => 0, isLive: () => null,
      isDone: async (specId) => specId.startsWith("SPEC-done"),
      launch: async () => { launches++; return `s${launches}`; },
    };
    await drain(cfg({ maxConcurrent: 1 }), deps);               // satu slot saja
    expect(launches).toBe(1);                                   // dan slot itu jatuh ke SPEC-open
    expect((await queueItemForSpec("SPEC-open"))!.status).toBe("launched");
  });

  it("marks an item failed when launch throws (no retry, next item still processed)", async () => {
    await enqueue({ specId: "SPEC-bad", projectId: "p1", source: "backlog", priority: "tinggi" });
    await enqueue({ specId: "SPEC-ok", projectId: "p1", source: "backlog", priority: "sedang" });
    const deps: GovernorDeps = {
      liveCount: () => 0, isLive: () => null, isDone: async () => false,
      launch: async (item) => { if (item.specId === "SPEC-bad") throw new Error("needs-bind"); return "s_ok"; },
    };
    await drain(cfg({ maxConcurrent: 5 }), deps);
    expect((await queueItemForSpec("SPEC-bad"))!.status).toBe("failed");
    expect((await queueItemForSpec("SPEC-bad"))!.note).toBe("needs-bind");
    expect((await queueItemForSpec("SPEC-ok"))!.status).toBe("launched");
  });
});
