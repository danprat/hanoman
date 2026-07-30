import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { UPDATE_RESTART_EXIT } from "@hanoman/shared";
import { supervised, requestRestartForUpdate, __setExiter } from "../src/services/update";

const saved = process.env.HANOMAN_SUPERVISOR;
afterEach(() => {
  if (saved === undefined) delete process.env.HANOMAN_SUPERVISOR;
  else process.env.HANOMAN_SUPERVISOR = saved;
  __setExiter(null);
  vi.useRealTimers();
});
beforeEach(() => { delete process.env.HANOMAN_SUPERVISOR; });

describe("supervised()", () => {
  it("false tanpa env — instalasi tak tersupervisi tak boleh mengaku bisa restart", () => {
    expect(supervised()).toBe(false);
  });
  it('true untuk "1" dan "true"', () => {
    process.env.HANOMAN_SUPERVISOR = "1";
    expect(supervised()).toBe(true);
    process.env.HANOMAN_SUPERVISOR = "true";
    expect(supervised()).toBe(true);
  });
  it('nilai lain tetap false ("0", kosong, sampah)', () => {
    for (const v of ["0", "", "yes", "supervised"]) {
      process.env.HANOMAN_SUPERVISOR = v;
      expect(supervised()).toBe(false);
    }
  });
});

describe("requestRestartForUpdate()", () => {
  it("memanggil exiter dengan sentinel 75, SESUDAH jeda (bukan seketika)", () => {
    vi.useFakeTimers();
    const calls: number[] = [];
    __setExiter((c) => calls.push(c));
    requestRestartForUpdate();
    expect(calls).toEqual([]);          // respons 202 harus sempat ter-flush dulu
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual([UPDATE_RESTART_EXIT]);
  });
});
