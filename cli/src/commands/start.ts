// SPEC-398 · ADR-0087 · `hanoman` (tanpa argumen) = perintah tunggal yang menjalankan hanoman:
// resolve home → terapkan migrasi → spawn bundle server dengan NODE_ENV=production supaya ia
// menyajikan dashboard dari dalam paket. Server hidup sebagai proses ANAK (bukan import) supaya
// sinyal, exit code, dan flag node-nya bersih; sesi tmux tetap selamat dari restart (ADR-0016).
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHome, resolveDbUrl, dbFilePath, prismaCliPath, dbUrlNotice } from "@hanoman/runner";
import type { Ctx } from "../router";
import { resolveLayout } from "../layout";

export type StartOpts = { port: number | null; host: string | null; db: string | null; migrate: boolean };

export function parseStartArgs(argv: string[]): StartOpts {
  const out: StartOpts = { port: null, host: null, db: null, migrate: true };
  const value = (i: number, flag: string, inline: string | undefined): string => {
    const v = inline ?? argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} butuh nilai`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]!;
    const eq = raw.indexOf("=");
    const flag = eq === -1 ? raw : raw.slice(0, eq);
    const inline = eq === -1 ? undefined : raw.slice(eq + 1);
    if (flag === "--no-migrate") { out.migrate = false; continue; }
    if (flag === "--port") {
      const v = value(i, "--port", inline);
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) throw new Error(`--port harus angka, dapat "${v}"`);
      out.port = n; if (inline === undefined) i++; continue;
    }
    if (flag === "--host") { out.host = value(i, "--host", inline); if (inline === undefined) i++; continue; }
    if (flag === "--db") { out.db = value(i, "--db", inline); if (inline === undefined) i++; continue; }
    throw new Error(`argumen tak dikenal untuk start: ${raw}`);
  }
  return out;
}

export function distDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

function runPrisma(args: string[], dbUrl: string): void {
  const prismaCli = prismaCliPath(createRequire(import.meta.url).resolve);
  execFileSync(process.execPath, [prismaCli, ...args], {
    env: { ...process.env, DATABASE_URL: dbUrl }, stdio: "inherit",
  });
}

/** `prisma migrate deploy` lewat CLI prisma yang ikut terpasang sebagai dependency paket. */
export function applyMigrations(schema: string, dbUrl: string): void {
  runPrisma(["migrate", "deploy", "--schema", schema], dbUrl);
}

/**
 * `@prisma/client` yang datang dari npm adalah STUB: kodenya baru ada setelah `prisma generate`.
 *
 * GOTCHA terukur di instalasi `npm i -g` nyata: migrasi berhasil, server lalu mati seketika dengan
 * "@prisma/client did not initialize yet". `npm install` sendiri tidak pernah menghasilkan client —
 * paket terbit karena itu punya `postinstall`, TAPI postinstall bisa dilewati (`--ignore-scripts`,
 * beberapa CI, sebagian setup npm global), jadi pemeriksaannya diulang di sini saat start.
 *
 * Pemeriksaannya LANGSUNG — mencoba mengonstruksi client dan menangkap kegagalannya — bukan menebak
 * dari keberadaan berkas: berkas stub `default.js` memang ADA justru saat client belum di-generate,
 * jadi `existsSync` akan selalu berkata "sudah siap".
 */
export async function prismaClientUsable(): Promise<boolean> {
  try {
    const { PrismaClient } = await import("@prisma/client");
    new PrismaClient();     // konstruksi saja; Prisma menyambung DB secara lazy
    return true;
  } catch { return false; }
}

export async function ensurePrismaClient(schema: string, dbUrl: string, ctx: Ctx): Promise<boolean> {
  if (await prismaClientUsable()) return true;
  ctx.stdout("hanoman · menyiapkan Prisma client (sekali per instalasi)\n");
  try { runPrisma(["generate", "--schema", schema], dbUrl); return true; }
  catch {
    ctx.stderr("hanoman: `prisma generate` gagal — jalankan manual di direktori paket, " +
      "atau pasang ulang tanpa --ignore-scripts\n");
    return false;
  }
}

export default async function start(argv: string[], ctx: Ctx): Promise<number> {
  let opts: StartOpts;
  try { opts = parseStartArgs(argv); } catch (e) { ctx.stderr(`${(e as Error).message}\n`); return 2; }

  let layout: ReturnType<typeof resolveLayout>;
  let dbUrl: string;
  try {
    layout = resolveLayout(distDir(), existsSync);
    dbUrl = opts.db ? `file:${resolvePath(opts.db)}` : resolveDbUrl(ctx.env, dirname(layout.schema));
  } catch (e) { ctx.stderr(`${(e as Error).message}\n`); return 1; }

  // `DATABASE_URL` asing diabaikan, tapi TIDAK diam-diam — lihat amandemen ADR-0086.
  const notice = dbUrlNotice(ctx.env);
  if (notice) ctx.stderr(`${notice}\n`);

  const home = resolveHome(ctx.env);
  mkdirSync(home, { recursive: true });
  mkdirSync(dirname(dbFilePath(dbUrl)), { recursive: true });

  if (!existsSync(layout.server)) {
    ctx.stderr(`hanoman: bundle server tak ada di ${layout.server} — jalankan \`pnpm build\` dulu\n`);
    return 1;
  }
  if (!await ensurePrismaClient(layout.schema, dbUrl, ctx)) return 1;
  if (opts.migrate) {
    ctx.stdout(`hanoman · menerapkan migrasi ke ${dbFilePath(dbUrl)}\n`);
    try { applyMigrations(layout.schema, dbUrl); }
    catch { ctx.stderr("hanoman: `prisma migrate deploy` gagal — lihat keluaran di atas\n"); return 1; }
  }

  const port = opts.port ?? Number(ctx.env.PORT ?? 8787);
  const host = opts.host ?? ctx.env.HOST ?? "127.0.0.1";
  ctx.stdout(`hanoman · http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}\n`);

  const child = spawn(process.execPath, [layout.server], {
    stdio: "inherit",
    env: {
      ...process.env, NODE_ENV: "production", DATABASE_URL: dbUrl,
      PORT: String(port), HOST: host, HANOMAN_HOME: home,
      ...(layout.web ? { HANOMAN_WEB_DIR: layout.web } : {}),
    },
  });
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => child.kill(sig));
  return await new Promise<number>((res) => child.on("exit", (code) => res(code ?? 0)));
}
