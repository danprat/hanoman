// Load the nearest .env (walking up from this module) into process.env so the
// server/seed have DATABASE_URL without a wrapper — tsx and plain node don't
// auto-load .env the way the Prisma CLI and vitest config do. Real env wins:
// existing vars are never overwritten (CI/prod set them directly).
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let dir = dirname(fileURLToPath(import.meta.url));
for (let i = 0; i < 6; i++) {
  const file = resolve(dir, ".env");
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && m[1] && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2]!.trim().replace(/^["']|["']$/g, "");
      }
    }
    break;
  }
  const up = dirname(dir);
  if (up === dir) break;
  dir = up;
}
