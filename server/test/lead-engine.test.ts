import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { LEAD_DEFAULTS, SCHEDULER_DEFAULTS, type Lead } from "@hanoman/shared";
import { setLead } from "../src/services/lead/config";
import { tick, __resetEngine, lastPulse, type LeadTickDeps } from "../src/services/lead/engine";
import type { DetectDeps } from "../src/services/lead/detect";
import type { PulseDeps } from "../src/services/lead/pulse";

// SPEC-409 · ADR-0091 · AC-12 · denyut in-process. `now` di-parameter agar cadence teruji
// deterministik (pola scheduler engine, SPEC-294).

const clean = async () => { await prisma.setting.deleteMany(); await prisma.leadDecision.deleteMany(); };
beforeEach(async () => { await clean(); __resetEngine(); });
afterAll(clean);

const cfg = (over: Partial<Lead> = {}): Lead => ({ ...LEAD_DEFAULTS, enabled: true, ...over });

// SPEC-432 · satu jam palsu dipakai BERSAMA oleh parameter `now` milik tick dan oleh dep `now`
// yang menstempel akhir denyut — kalau keduanya berjalan di jam berbeda, "jeda sejak denyut
// selesai" tak bisa diuji sama sekali.
function counters() {
  const c = { detect: 0, pulse: 0 };
  const clock = { t: 0 };
  const detect = {
    live: () => { c.detect++; return []; },
    filled: () => false, pane: () => "", agentOf: () => "claude", exited: () => true,
    send: async () => true, decide: (async () => null) as unknown as DetectDeps["decide"],
    decideDeps: {} as DetectDeps["decideDeps"],
    optIn: async () => [], notify: async () => { /* diam */ },
    cfg: async () => cfg(),
  } as DetectDeps;
  const pulse = {
    sessions: () => [], areas: async () => [], planDone: () => true, finished: () => false,
    decide: (async () => null) as unknown as PulseDeps["decide"],
    decideDeps: {} as PulseDeps["decideDeps"],
    apply: (async () => ({ ok: true, detail: "" })) as unknown as PulseDeps["apply"],
    enqueue: async () => { /* diam */ },
    notify: async () => { /* diam */ },
    optIn: async () => { c.pulse++; return []; },
    cfg: async () => cfg(),
    scheduler: async () => SCHEDULER_DEFAULTS,
  } as PulseDeps;
  const deps: LeadTickDeps = { detect, pulse, now: () => clock.t };
  /** Majukan jam ke `t` lalu jalankan satu tick di sana. */
  const at = (t: number) => { clock.t = t; return tick(t, deps); };
  return { c, deps, clock, at };
}

describe("lead engine tick", () => {
  it("is completely idle while the master switch is off (AC-30)", async () => {
    await setLead({ ...LEAD_DEFAULTS, enabled: false });
    const { c, at } = counters();
    await at(1_000_000);
    expect(c).toEqual({ detect: 0, pulse: 0 });
  });

  // Sesi mandek diukur dalam MENIT (M1), jadi pintu deteksi jalan tiap tick; denyut proaktif
  // menyentuh git & bisa memanggil agen, jadi ia mengikuti `everyMin`.
  it("scans for waiting sessions on every tick", async () => {
    await setLead(cfg());
    const { c, at } = counters();
    await at(1_000_000);
    await at(1_005_000);
    expect(c.detect).toBe(2);
  });

  it("runs the proactive pulse only once per everyMin window", async () => {
    await setLead(cfg({ everyMin: 5 }));
    const { c, at } = counters();
    const t0 = 1_000_000;
    await at(t0);                       // belum pernah → jatuh tempo
    expect(c.pulse).toBe(1);
    await at(t0 + 4 * 60_000);          // 4 mnt < 5 → lewat
    expect(c.pulse).toBe(1);
    await at(t0 + 5 * 60_000);          // 5 mnt → jatuh tempo lagi
    expect(c.pulse).toBe(2);
    expect(lastPulse()).toBe(t0 + 5 * 60_000);
  });

  // Pause = rem darurat, bukan matikan: pintu deteksi ikut diam lewat gerbangnya sendiri, dan
  // denyut proaktif tak pernah dijalankan.
  it("stops the proactive pulse while paused (AC-27)", async () => {
    await setLead(cfg({ paused: true }));
    const { c, at } = counters();
    await at(1_000_000);
    expect(c.pulse).toBe(0);
  });

  // AC-37 · lead yang mati (agennya crash, kuota habis, git gagal) tak boleh menjatuhkan proses
  // server maupun menghentikan sesi yang berjalan.
  it("survives a detect door that throws, and still runs the pulse", async () => {
    await setLead(cfg());
    const { c, deps, at } = counters();
    deps.detect!.live = () => { throw new Error("tmux tak terbaca"); };
    await expect(at(1_000_000)).resolves.toBeUndefined();
    expect(c.pulse).toBe(1);
  });
  it("survives a pulse that throws", async () => {
    await setLead(cfg());
    const { deps, at } = counters();
    deps.pulse!.optIn = async () => { throw new Error("DB kedip"); };
    await expect(at(1_000_000)).resolves.toBeUndefined();
  });
});

// SPEC-432 · audit `research/audit-spec-432-lead-tak-memutuskan-denyut-spam.md`.
//
// ADR-0091 §5 sengaja memisahkan dua irama: pintu deteksi tiap 5 detik (sesi mandek diukur dalam
// menit — M1 median ≤ 2 mnt) dan denyut proaktif tiap `everyMin`. `tick()` menyatukannya kembali
// lewat SATU flag `busy`: di mesin operator satu denyut = 3 project × 120 dtk timeout = 360 dtk,
// dan selama itu setiap tick 5 detik langsung `return` — pintu yang justru menjawab sesi mandek
// mati berkala oleh pekerjaan yang sudah terbukti nihil.
describe("lead engine · dua irama tak boleh saling melaparkan (audit SPEC-432)", () => {
  it("keeps scanning for waiting sessions while a slow pulse is still in flight", async () => {
    await setLead(cfg());
    const { c, deps, at } = counters();
    let release: () => void = () => { /* diisi saat denyut mulai */ };
    deps.pulse!.optIn = async () => {
      c.pulse++;
      await new Promise<void>((r) => { release = r; });
      return [];
    };
    const slow = at(1_000_000);                       // denyut yang menggantung
    await new Promise((r) => setTimeout(r, 10));      // biarkan denyut benar-benar mulai
    await at(1_005_000);                              // tick berikutnya, 5 detik kemudian
    expect(c.detect).toBe(2);                         // pintu deteksi TETAP jalan
    expect(c.pulse).toBe(1);                          // tapi denyut tak dimulai dua kali
    release();
    await slow;
  });

  // `lastPulseAt` distempel di AWAL denyut, jadi denyut yang lebih lama dari `everyMin` langsung
  // jatuh tempo lagi begitu ia selesai — `everyMin` berhenti jadi lantai, dan denyut berikutnya
  // menyentuh git (`specReview` per sesi hidup) tanpa jeda sama sekali.
  it("counts the everyMin gap from when the pulse FINISHED, not when it started", async () => {
    await setLead(cfg({ everyMin: 5 }));
    const { c, deps, clock, at } = counters();
    deps.pulse!.optIn = async () => { c.pulse++; clock.t += 6 * 60_000; return []; };   // denyut 6 mnt
    await at(1_000_000);
    expect(c.pulse).toBe(1);
    await tick(clock.t, deps);            // tick tepat sesudah denyut yang overrun selesai
    expect(c.pulse).toBe(1);
    await at(clock.t + 5 * 60_000);       // baru sesudah jeda tenang penuh
    expect(c.pulse).toBe(2);
  });
});
