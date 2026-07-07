import { describe, it, expect, beforeAll } from "vitest";
import { seed } from "../prisma/seed";
import { nextSpecId } from "../src/services/id";
describe("id", () => {
  beforeAll(async () => { await seed(); });
  it("next spec id is one past the max", async () => expect(await nextSpecId()).toBe("SPEC-143"));
});
