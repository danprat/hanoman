import { describe, it, expect } from "vitest";
import { SteerQueue } from "../src/steer-queue";
describe("SteerQueue", () => {
  it("yields the initial prompt then pushed messages, then ends on close", async () => {
    const q = new SteerQueue("go");
    const got: string[] = [];
    const consume = (async () => { for await (const m of q.stream()) got.push(m.message.content); })();
    await new Promise((r) => setTimeout(r, 5)); q.push("steer-1");
    await new Promise((r) => setTimeout(r, 5)); q.push("steer-2");
    await new Promise((r) => setTimeout(r, 5)); q.close();
    await consume;
    expect(got).toEqual(["go", "steer-1", "steer-2"]);
  });
});
