import { describe, it, expect } from "vitest";
import { getInstallationOctokit } from "../src/github/app";

describe("github app", () => {
  it("returns an installation-scoped octokit", async () => {
    const fakeApp = { getInstallationOctokit: async (id: number) => ({ id, rest: {} }) } as any;
    const octo = await getInstallationOctokit(123, fakeApp);
    expect((octo as any).id).toBe(123);
  });
});
