import { describe, it, expect } from "vitest";
import { prisma } from "../src/db";

describe("github schema", () => {
  it("can create an installation + link a project", async () => {
    await prisma.githubInstallation.upsert({
      where: { id: 99 },
      update: {},
      create: { id: 99, account: "nafanesia", repos: ["nafanesia/arta"] },
    });
    expect(await prisma.githubInstallation.findUnique({ where: { id: 99 } })).toBeTruthy();
  });
});
