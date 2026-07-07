import { describe, it, expect } from "vitest";
import { ping } from "../src/index";
describe("workspace", () => {
  it("runs vitest and imports shared", () => { expect(ping()).toBe("pong"); });
});
