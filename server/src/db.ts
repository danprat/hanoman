import "./env";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { resolveDbUrl, dbFilePath } from "@hanoman/runner";

// SPEC-398 · ADR-0086 · satu titik yang menormalkan DATABASE_URL sebelum PrismaClient dibuat:
// `file:` absolut, default `~/.hanoman/hanoman.db`, dan `postgresql://` melempar dengan petunjuk
// migrasi. `../prisma` benar di dev (server/src → server/prisma), di bundle repo
// (server/dist → server/prisma), dan di paket npm (dist → <pkg>/prisma).
const schemaDir = resolve(dirname(fileURLToPath(import.meta.url)), "../prisma");
const url = resolveDbUrl(process.env, schemaDir);
process.env.DATABASE_URL = url;
mkdirSync(dirname(dbFilePath(url)), { recursive: true }); // SQLite tak membuat direktori sendiri
export const prisma = new PrismaClient();
