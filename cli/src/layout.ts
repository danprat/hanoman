// SPEC-398 · ADR-0087 · `hanoman` hidup di dua layout: paket npm global (dist/, prisma/, web/
// bersebelahan) dan checkout repo (cli/dist, server/prisma, src/dist). Probing-nya murni supaya
// bisa dites tanpa menyentuh filesystem.
import { join, resolve } from "node:path";

export type Layout = { root: string; schema: string; server: string; web: string | null };

export function resolveLayout(distDir: string, exists: (p: string) => boolean): Layout {
  const pkg = resolve(distDir, "..");
  if (exists(join(pkg, "prisma", "schema.prisma"))) {
    return {
      root: pkg,
      schema: join(pkg, "prisma", "schema.prisma"),
      server: join(pkg, "dist", "server.js"),
      web: exists(join(pkg, "web")) ? join(pkg, "web") : null,
    };
  }
  const repo = resolve(distDir, "../..");
  if (exists(join(repo, "server", "prisma", "schema.prisma"))) {
    return {
      root: repo,
      schema: join(repo, "server", "prisma", "schema.prisma"),
      server: join(repo, "server", "dist", "server.js"),
      web: exists(join(repo, "src", "dist")) ? join(repo, "src", "dist") : null,
    };
  }
  throw new Error(`hanoman: prisma/schema.prisma tak ditemukan dari ${distDir} — instalasi rusak?`);
}
