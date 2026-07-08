import { describe, it, expect } from "vitest";
import { zControl, zSteer } from "../src/index";
describe("control DTOs", () => {
  it("accepts a valid control action", () => expect(zControl.parse({ action: "pause" }).action).toBe("pause"));
  it("rejects an unknown action", () => expect(() => zControl.parse({ action: "explode" })).toThrow());
  it("requires a non-empty steer message", () => expect(() => zSteer.parse({ message: "" })).toThrow());
});
