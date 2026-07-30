// SPEC-398 · ADR-0086 · siapkan DB test SQLite sekali per run: hapus berkasnya lalu terapkan
// migrasi. Sebelum ini DB test Postgres harus di-`migrate deploy` manual, dan lupa melakukannya
// memberi ~24 test gagal P2022 yang tampak seperti regresi.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { dbFilePath, prismaCliPath } from "../../runner/src/paths";

export default function setup(): void {
  const url = process.env.DATABASE_URL;
  if (!url?.startsWith("file:")) throw new Error(`global-setup: butuh DATABASE_URL file:, dapat ${url}`);
  const file = dbFilePath(url);
  mkdirSync(dirname(file), { recursive: true });
  for (const s of ["", "-journal", "-wal", "-shm"]) rmSync(file + s, { force: true });
  const prismaCli = prismaCliPath(createRequire(import.meta.url).resolve);
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema",
    resolve(import.meta.dirname, "../prisma/schema.prisma")],
    { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });
}
