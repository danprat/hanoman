import { describe, it, expect, beforeEach } from "vitest";
import { runGated, leadGateStats, LeadBusyError, __resetLeadGate } from "../src/services/lead/gate";

// SPEC-479 (QA) · gerbang penerimaan lead. Murni & tanpa DB: yang diuji adalah batas konkurensi,
// urutan FIFO, dan deadline penerimaan — bukan siapa yang memanggilnya.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const WAIT = 5_000;   // deadline longgar: test yang menguji batas konkurensi tak boleh ikut kena

beforeEach(() => { __resetLeadGate(); });

describe("batas konkurensi", () => {
  it("tak pernah menjalankan lebih dari `capacity` pekerjaan sekaligus", async () => {
    let inFlight = 0, max = 0;
    const task = async () => {
      inFlight++; max = Math.max(max, inFlight);
      await sleep(20);
      inFlight--;
    };
    await Promise.all(Array.from({ length: 8 }, () =>
      runGated({ capacity: 2, waitMs: WAIT }, task)));
    expect(max).toBe(2);
  });

  it("melepas slot walau pekerjaannya melempar", async () => {
    await expect(runGated({ capacity: 1, waitMs: WAIT }, async () => { throw new Error("boom"); }))
      .rejects.toThrow("boom");
    // Slot harus kembali: pekerjaan berikutnya lewat tanpa menunggu deadline.
    await expect(runGated({ capacity: 1, waitMs: 0 }, async () => "ok")).resolves.toBe("ok");
    expect(leadGateStats()).toEqual({ inFlight: 0, queued: 0 });
  });

  it("mengembalikan nilai pekerjaannya apa adanya", async () => {
    await expect(runGated({ capacity: 1, waitMs: WAIT }, async () => 42)).resolves.toBe(42);
  });
});

describe("urutan FIFO", () => {
  // Inti temuan A: yang mencegah kelaparan bukan adanya antrean, melainkan antrean yang
  // menghormati urutan kedatangan. `tmux list-panes -a` selalu menyodorkan urutan yang sama,
  // jadi gerbang "siapa cepat" akan melaparkan ekor daftar persis seperti loop serial hari ini.
  it("melayani penunggu sesuai urutan kedatangan", async () => {
    const order: number[] = [];
    // Isi satu-satunya slot supaya lima berikutnya benar-benar mengantre.
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const first = runGated({ capacity: 1, waitMs: WAIT }, async () => { await held; });

    const rest: Promise<void>[] = [];
    for (let i = 0; i < 5; i++) {
      rest.push(runGated({ capacity: 1, waitMs: WAIT }, async () => { order.push(i); }));
      await sleep(5);   // jamin urutan KEDATANGAN yang berbeda
    }
    expect(leadGateStats().queued).toBe(5);

    release();
    await Promise.all([first, ...rest]);
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("deadline penerimaan", () => {
  it("menolak dengan LeadBusyError saat slot tak didapat dalam waitMs", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const busy = runGated({ capacity: 1, waitMs: WAIT }, async () => { await held; });

    await expect(runGated({ capacity: 1, waitMs: 30 }, async () => "tak-pernah"))
      .rejects.toBeInstanceOf(LeadBusyError);

    release();
    await busy;
  });

  it("penunggu yang ditolak KELUAR dari antrean — ia tak boleh menahan slot belakangan", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const busy = runGated({ capacity: 1, waitMs: WAIT }, async () => { await held; });

    await expect(runGated({ capacity: 1, waitMs: 20 }, async () => "x")).rejects.toBeInstanceOf(LeadBusyError);
    expect(leadGateStats().queued).toBe(0);

    release();
    await busy;
    expect(leadGateStats()).toEqual({ inFlight: 0, queued: 0 });
  });

  it("LeadBusyError menyebut berapa lama ia menunggu dan berapa yang mengantre", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const busy = runGated({ capacity: 1, waitMs: WAIT }, async () => { await held; });

    const err = await runGated({ capacity: 1, waitMs: 40 }, async () => "x")
      .then(() => null, (e: unknown) => e as LeadBusyError);
    expect(err).toBeInstanceOf(LeadBusyError);
    expect(err!.waitedMs).toBeGreaterThanOrEqual(30);
    expect(err!.message).toMatch(/antre/i);

    release();
    await busy;
  });

  it("waitMs 0 = tanpa antrean: penuh berarti langsung ditolak", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const busy = runGated({ capacity: 1, waitMs: WAIT }, async () => { await held; });

    await expect(runGated({ capacity: 1, waitMs: 0 }, async () => "x")).rejects.toBeInstanceOf(LeadBusyError);
    release();
    await busy;
  });
});

describe("kapasitas yang berubah saat berjalan", () => {
  // Operator boleh menggeser knob-nya kapan saja; gerbangnya membaca cfg tiap panggilan.
  it("kapasitas yang dinaikkan berlaku untuk penunggu yang sudah antre", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const first = runGated({ capacity: 1, waitMs: WAIT }, async () => { await held; });
    await sleep(5);

    // Datang dengan kapasitas 2 → slot kedua terbuka walau yang pertama masih memegang satu.
    await expect(runGated({ capacity: 2, waitMs: 50 }, async () => "lewat")).resolves.toBe("lewat");

    release();
    await first;
  });
});

describe("statistik", () => {
  it("melaporkan in-flight dan panjang antrean", async () => {
    expect(leadGateStats()).toEqual({ inFlight: 0, queued: 0 });
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const first = runGated({ capacity: 1, waitMs: WAIT }, async () => { await held; });
    await sleep(5);
    expect(leadGateStats()).toEqual({ inFlight: 1, queued: 0 });

    const second = runGated({ capacity: 1, waitMs: WAIT }, async () => {});
    await sleep(5);
    expect(leadGateStats()).toEqual({ inFlight: 1, queued: 1 });

    release();
    await Promise.all([first, second]);
    expect(leadGateStats()).toEqual({ inFlight: 0, queued: 0 });
  });
});
