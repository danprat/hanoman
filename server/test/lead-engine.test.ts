import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { LEAD_DEFAULTS, type Lead } from "@hanoman/shared";
import { setLead } from "../src/services/lead/config";
import { tick, __resetEngine, lastPulse } from "../src/services/lead/engine";
import type { DetectDeps } from "../src/services/lead/detect";
import type { PulseDeps } from "../src/services/lead/pulse";

// SPEC-409 · ADR-0091 · AC-12 · denyut in-process. `now` di-parameter agar cadence teruji
// deterministik (pola scheduler engine, SPEC-294).

const clean = async () => { await prisma.setting.deleteMany(); await prisma.leadDecision.deleteMany(); };
beforeEach(async () => { await clean(); __resetEngine(); });
afterAll(clean);

const cfg = (over: Partial<Lead> = {}): Lead => ({ ...LEAD_DEFAULTS, enabled: true, ...over });

function counters() {
  const c = { detect: 0, pulse: 0 };
  const detect = {
    live: () => { c.detect++; return []; },
    filled: () => false, pane: () => "", agentOf: () => "claude", exited: () => true,
    send: async () => true, decide: (async () => null) as unknown as DetectDeps["decide"],
    decideDeps: {} as DetectDeps["decideDeps"],
    optIn: async () => [], notify: async () => { /* diam */ },
    cfg: async () => cfg(),
  } as DetectDeps;
  const pulse = {
    sessions: () => [], areas: async () => [], planDone: () => true,
    decide: (async () => null) as unknown as PulseDeps["decide"],
    decideDeps: {} as PulseDeps["decideDeps"],
    apply: (async () => ({ ok: true, detail: "" })) as unknown as PulseDeps["apply"],
    enqueue: async () => { /* diam */ },
    notify: async () => { /* diam */ },
    optIn: async () => { c.pulse++; return []; },
    cfg: async () => cfg(),
  } as PulseDeps;
  return { c, deps: { detect, pulse } };
}

describe("lead engine tick", () => {
  it("is completely idle while the master switch is off (AC-30)", async () => {
    await setLead({ ...LEAD_DEFAULTS, enabled: false });
    const { c, deps } = counters();
    await tick(1_000_000, deps);
    expect(c).toEqual({ detect: 0, pulse: 0 });
  });

  // Sesi mandek diukur dalam MENIT (M1), jadi pintu deteksi jalan tiap tick; denyut proaktif
  // menyentuh git & bisa memanggil agen, jadi ia mengikuti `everyMin`.
  it("scans for waiting sessions on every tick", async () => {
    await setLead(cfg());
    const { c, deps } = counters();
    await tick(1_000_000, deps);
    await tick(1_005_000, deps);
    expect(c.detect).toBe(2);
  });

  it("runs the proactive pulse only once per everyMin window", async () => {
    await setLead(cfg({ everyMin: 5 }));
    const { c, deps } = counters();
    const t0 = 1_000_000;
    await tick(t0, deps);                       // belum pernah → jatuh tempo
    expect(c.pulse).toBe(1);
    await tick(t0 + 4 * 60_000, deps);          // 4 mnt < 5 → lewat
    expect(c.pulse).toBe(1);
    await tick(t0 + 5 * 60_000, deps);          // 5 mnt → jatuh tempo lagi
    expect(c.pulse).toBe(2);
    expect(lastPulse()).toBe(t0 + 5 * 60_000);
  });

  // Pause = rem darurat, bukan matikan: pintu deteksi ikut diam lewat gerbangnya sendiri, dan
  // denyut proaktif tak pernah dijalankan.
  it("stops the proactive pulse while paused (AC-27)", async () => {
    await setLead(cfg({ paused: true }));
    const { c, deps } = counters();
    await tick(1_000_000, deps);
    expect(c.pulse).toBe(0);
  });

  // AC-37 · lead yang mati (agennya crash, kuota habis, git gagal) tak boleh menjatuhkan proses
  // server maupun menghentikan sesi yang berjalan.
  it("survives a detect door that throws, and still runs the pulse", async () => {
    await setLead(cfg());
    const { c, deps } = counters();
    deps.detect.live = () => { throw new Error("tmux tak terbaca"); };
    await expect(tick(1_000_000, deps)).resolves.toBeUndefined();
    expect(c.pulse).toBe(1);
  });
  it("survives a pulse that throws", async () => {
    await setLead(cfg());
    const { deps } = counters();
    deps.pulse.optIn = async () => { throw new Error("DB kedip"); };
    await expect(tick(1_000_000, deps)).resolves.toBeUndefined();
  });
});
