import { describe, it, expect } from "vitest";
import { parseDuration, isValidCron, scheduleSpecFor } from "../src/schedule-parse";
describe("schedule parse", () => {
  it("parses durations", () => { expect(parseDuration("6h")).toBe(21600000); expect(parseDuration("30m")).toBe(1800000); expect(parseDuration("nope")).toBeNull(); });
  it("validates cron", () => { expect(isValidCron("0 2 * * *")).toBe(true); expect(isValidCron("banana")).toBe(false); });
  it("builds a spec by type", () => {
    expect(scheduleSpecFor("schedule", "0 2 * * *")).toEqual({ pattern: "0 2 * * *" });
    expect(scheduleSpecFor("interval", "6h")).toEqual({ every: 21600000 });
    expect(scheduleSpecFor("manual", "x")).toBeNull();
  });
});
