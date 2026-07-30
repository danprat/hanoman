import { describe, it, expect } from "vitest";
import { resolveLayout } from "../src/layout";

const has = (...ok: string[]) => (p: string) => ok.includes(p);

describe("resolveLayout", () => {
  it("paket npm: prisma & server & web bersebelahan dist", () => {
    const l = resolveLayout("/pkg/dist", has("/pkg/prisma/schema.prisma", "/pkg/web"));
    expect(l).toEqual({
      root: "/pkg", schema: "/pkg/prisma/schema.prisma",
      server: "/pkg/dist/server.js", web: "/pkg/web",
    });
  });
  it("checkout: schema di server/prisma, SPA di src/dist", () => {
    const l = resolveLayout("/repo/cli/dist", has("/repo/server/prisma/schema.prisma", "/repo/src/dist"));
    expect(l).toEqual({
      root: "/repo", schema: "/repo/server/prisma/schema.prisma",
      server: "/repo/server/dist/server.js", web: "/repo/src/dist",
    });
  });
  it("SPA belum dibangun → web null, bukan melempar", () => {
    expect(resolveLayout("/pkg/dist", has("/pkg/prisma/schema.prisma")).web).toBeNull();
  });
  it("tak ada schema di mana pun → melempar", () => {
    expect(() => resolveLayout("/x/dist", has())).toThrow(/schema\.prisma/);
  });
});
