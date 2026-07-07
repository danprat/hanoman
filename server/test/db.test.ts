import { describe, it, expect } from "vitest";
import { prisma } from "../src/db";
describe("db", () => {
  it("connects and counts projects", async () => {
    expect(await prisma.project.count()).toBeGreaterThanOrEqual(0);
  });
});
