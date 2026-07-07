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

export default defineConfig({
  test: {
    environment: "node",
    // Every server test file re-seeds the same Postgres DB in beforeAll; running
    // files in parallel would race on deleteMany/createMany. Force sequential.
    fileParallelism: false,
  },
});
