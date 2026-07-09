import { describe, it, expect } from "vitest";
import { SteerQueue } from "../src/steer-queue";
describe("SteerQueue", () => {
  it("drains pushed messages in order and empties itself", () => {
    const q = new SteerQueue();
    q.push("a"); q.push("b");
    expect(q.drain()).toEqual(["a", "b"]);
    expect(q.drain()).toEqual([]);
  });
});
