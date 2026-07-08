import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// PrismaClient reads DATABASE_URL from process.env at runtime (only the CLI
// auto-loads .env). Load the root .env so server tests can hit Postgres.
try {
  for (const line of readFileSync(resolve(import.meta.dirname, "../.env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m && m[1] && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* .env optional in CI where env is already set */ }

// Tests seed with a wipe-then-load; point them at an ISOLATED throwaway DB so
// they can never wipe the real hanoman DB. Prefer TEST_DATABASE_URL; else derive
// a `_test` database from DATABASE_URL. Refuse to run if it would equal the real
// DB — a missing/misconfigured test DB must fail loudly, not nuke real data.
{
  const real = process.env.DATABASE_URL;
  const test = process.env.TEST_DATABASE_URL
    ?? real?.replace(/\/([^/?]+)(\?|$)/, "/$1_test$2");
  if (!test) throw new Error("vitest: no DATABASE_URL/TEST_DATABASE_URL to derive a test database");
  if (test === real) throw new Error("vitest: refusing to run — test DB would equal the real DATABASE_URL");
  process.env.DATABASE_URL = test;
}

export default defineConfig({
  test: {
    environment: "node",
    // Every server test file re-seeds the same Postgres DB in beforeAll; running
    // files in parallel would race on deleteMany/createMany. Force sequential.
    fileParallelism: false,
  },
});
