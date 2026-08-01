import { describe, expect, it } from "vitest";
import { TelegramApiError } from "../src/services/telegram/client";
import {
  TelegramTypingIndicator, clampTypingCooldown, pollTimeoutFor,
  TYPING_COOLDOWN_MAX_MS, TYPING_COOLDOWN_MIN_MS,
} from "../src/services/telegram/typing";

function harness(options: { enabled?: boolean; fail?: () => unknown } = {}) {
  const calls: string[] = [];
  let clock = 1_000_000;
  const indicator = new TelegramTypingIndicator({
    enabled: options.enabled ?? true,
    now: () => clock,
    client: {
      sendChatAction: async (chatId) => {
        const failure = options.fail?.();
        if (failure) throw failure;
        calls.push(chatId);
        return true;
      },
    },
  });
  return { calls, indicator, advance: (ms: number) => { clock += ms; } };
}

describe("TelegramTypingIndicator (SPEC-493)", () => {
  it("arms immediately and bypasses the refresh throttle", async () => {
    const h = harness();
    await h.indicator.arm("42");
    await h.indicator.arm("42");
    expect(h.calls).toEqual(["42", "42"]);
  });

  it("throttles refresh below the minimum interval and resumes after it", async () => {
    const h = harness();
    await h.indicator.refresh(["42"]);
    h.advance(2_999);
    await h.indicator.refresh(["42"]);
    expect(h.calls).toEqual(["42"]);
    h.advance(1);
    await h.indicator.refresh(["42"]);
    expect(h.calls).toEqual(["42", "42"]);
  });

  it("stays completely silent when the progress flag is off", async () => {
    const h = harness({ enabled: false });
    await h.indicator.arm("42");
    await h.indicator.refresh(["42", "43"]);
    expect(h.calls).toEqual([]);
  });

  it("never throws, whatever sendChatAction does", async () => {
    const h = harness({ fail: () => new Error("boom") });
    await expect(h.indicator.arm("42")).resolves.toBeUndefined();
    await expect(h.indicator.refresh(["42"])).resolves.toBeUndefined();
  });

  it("honours retry_after as the per-chat cooldown", async () => {
    let fail = true;
    const h = harness({ fail: () => (fail ? new TelegramApiError("sendChatAction", 429, "429", 7) : null) });
    await h.indicator.arm("42");
    fail = false;
    h.advance(6_999);
    await h.indicator.arm("42");
    expect(h.calls).toEqual([]);
    h.advance(1);
    await h.indicator.arm("42");
    expect(h.calls).toEqual(["42"]);
  });

  it("backs off exponentially when no retry_after is offered", async () => {
    let fail = true;
    const h = harness({ fail: () => (fail ? new TelegramApiError("sendChatAction", 500, "500") : null) });
    await h.indicator.arm("42");          // gagal → cooldown 5s, berikutnya 10s
    h.advance(5_000);
    await h.indicator.arm("42");          // gagal lagi → cooldown 10s
    fail = false;
    h.advance(9_999);
    await h.indicator.arm("42");
    expect(h.calls).toEqual([]);
    h.advance(1);
    await h.indicator.arm("42");
    expect(h.calls).toEqual(["42"]);
  });

  it("clears the cooldown once a call succeeds", async () => {
    let fail = true;
    const h = harness({ fail: () => (fail ? new TelegramApiError("sendChatAction", 500, "500") : null) });
    await h.indicator.arm("42");
    fail = false;
    h.advance(5_000);
    await h.indicator.arm("42");
    fail = true;
    await h.indicator.arm("42");          // gagal → cooldown kembali ke DASAR 5s, bukan 10s
    fail = false;
    h.advance(4_999);
    await h.indicator.arm("42");
    expect(h.calls).toEqual(["42"]);
    h.advance(1);
    await h.indicator.arm("42");
    expect(h.calls).toEqual(["42", "42"]);
  });

  it("cools down one chat without silencing its neighbour", async () => {
    let fail = true;
    const h = harness({ fail: () => (fail ? new TelegramApiError("sendChatAction", 500, "500") : null) });
    await h.indicator.arm("42");
    fail = false;
    await h.indicator.arm("43");
    expect(h.calls).toEqual(["43"]);
  });

  it("clamps every cooldown into the 1s..300s fence", () => {
    expect(clampTypingCooldown(0)).toBe(TYPING_COOLDOWN_MIN_MS);
    expect(clampTypingCooldown(-5)).toBe(TYPING_COOLDOWN_MIN_MS);
    expect(clampTypingCooldown(9_999_999)).toBe(TYPING_COOLDOWN_MAX_MS);
    expect(clampTypingCooldown(42_000)).toBe(42_000);
  });

  it("shortens the long poll only while work is in flight, and never to zero", () => {
    expect(pollTimeoutFor(0, 25)).toBe(25);
    expect(pollTimeoutFor(1, 25)).toBe(4);
    expect(pollTimeoutFor(9, 25)).toBe(4);
    expect(pollTimeoutFor(1, 2)).toBe(2);
    expect(pollTimeoutFor(1, 25)).toBeGreaterThan(0);
  });
});
