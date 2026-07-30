# hanoman production level — `npm i -g hanoman`, tanpa Docker (SPEC-398)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** hanoman dipasang dengan `npm i -g hanoman`, dijalankan dengan satu perintah `hanoman`, tanpa Docker/Postgres, dan diperbarui dengan `hanoman update`.

**Architecture:** Data layer pindah dari Postgres ke **SQLite embedded** (Prisma 6, berkas di `~/.hanoman/hanoman.db`) sehingga tak ada proses eksternal. CLI `hanoman` yang sudah ada diperluas jadi entrypoint produksi: ia me-resolve home + URL DB, menjalankan `prisma migrate deploy`, lalu men-spawn bundle server yang menyajikan SPA dari dalam paket. Rilis dirakit ke staging `dist-npm/` oleh perintah dev tersembunyi `hanoman __pack`; deteksi update berhenti membaca git dan membaca semver dari registry npm.

**Tech Stack:** Node ≥20 · TypeScript strict · Prisma **6.19.x** + SQLite · Fastify 4 · esbuild · vitest · `pg` (hanya untuk tool migrasi sekali-jalan)

## Global Constraints

- **Prisma 6.19.x**, bukan 7 — Prisma 7 mewajibkan driver adapter. `Json` di SQLite baru ada sejak 6.2.
- **SQLite satu-satunya provider** (ADR-0086). `DATABASE_URL` non-`file:` harus **melempar** dengan petunjuk `hanoman migrate-from-postgres`, bukan didiamkan.
- Path relatif di `file:` URL di-resolve **relatif terhadap direktori `schema.prisma`** — aturan Prisma. Jangan pakai cwd.
- Panel update tetap **read-only** (ADR-0048 utuh): tidak ada endpoint apply/self-mutation.
- Jaringan hanya di satu tempat (`services/update.ts`) dan tetap digerbangi knob `HANOMAN_UPDATE_FETCH` yang sudah ada; test memaksa `0`.
- Script rilis **tidak pernah** memanggil `npm publish`. Publish adalah tindakan manusia.
- Nama paket npm: `hanoman`. Versi: field `version` di root `package.json` — sumber tunggal, mulai `0.1.0`.
- Test yang dijalankan: **hanya yang tersentuh** (`pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism` atau path langsung). Typecheck hanya paket yang tersentuh.
- Semua prosa docs/komentar baru dalam bahasa Indonesia, mengikuti gaya repo.

---

### Task 1: Cutover SQLite (Prisma 6 + provider + resolusi path + test DB per checkout)

**Files:**
- Modify: `server/package.json` (deps `prisma`/`@prisma/client` → `^6.19.0`)
- Modify: `server/prisma/schema.prisma:5-8` (provider `postgresql` → `sqlite`)
- Delete: `server/prisma/migrations/*` (33 direktori PG)
- Create: `server/prisma/migrations/20260730000000_init_sqlite/migration.sql`
- Modify: `server/prisma/migrations/migration_lock.toml`
- Create: `runner/src/paths.ts`
- Modify: `runner/src/index.ts` (export `./paths`)
- Test: `runner/test/paths.test.ts`
- Modify: `server/src/db.ts`
- Modify: `server/src/services/session-history.ts:69-72` (buang `mode: "insensitive"`)
- Modify: `server/vitest.config.ts`
- Create: `server/test/global-setup.ts`
- Modify: `package.json` (buang `predev`/`prod:db`, tambah `version`)
- Delete: `docker-compose.yml`
- Modify: `.gitignore`, `.env.example`, `.env.production.example`

**Interfaces:**
- Produces: `resolveHome(env?): string` · `resolveDbUrl(env, schemaDir): string` · `dbFilePath(url): string` — semuanya dari `@hanoman/runner`.
- Consumes: tidak ada.

- [x] **Step 1: Tulis test yang gagal untuk resolusi path**

Create `runner/test/paths.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveHome, resolveDbUrl, dbFilePath } from "../src/paths";

const SCHEMA = "/repo/server/prisma";

describe("resolveHome", () => {
  it("default ~/.hanoman", () => {
    expect(resolveHome({}, "/Users/x")).toBe("/Users/x/.hanoman");
  });
  it("HANOMAN_HOME menang", () => {
    expect(resolveHome({ HANOMAN_HOME: "/srv/hn" }, "/Users/x")).toBe("/srv/hn");
  });
  it("HANOMAN_HOME kosong diabaikan", () => {
    expect(resolveHome({ HANOMAN_HOME: "  " }, "/Users/x")).toBe("/Users/x/.hanoman");
  });
});

describe("resolveDbUrl", () => {
  it("DATABASE_URL absen → berkas di home", () => {
    expect(resolveDbUrl({ HANOMAN_HOME: "/srv/hn" }, SCHEMA)).toBe("file:/srv/hn/hanoman.db");
  });
  it("path relatif di-resolve relatif ke direktori schema (aturan Prisma)", () => {
    expect(resolveDbUrl({ DATABASE_URL: "file:../../hanoman-dev.db" }, SCHEMA))
      .toBe("file:/repo/hanoman-dev.db");
  });
  it("path absolut dipertahankan", () => {
    expect(resolveDbUrl({ DATABASE_URL: "file:/data/a.db" }, SCHEMA)).toBe("file:/data/a.db");
  });
  it(":memory: dilewatkan apa adanya", () => {
    expect(resolveDbUrl({ DATABASE_URL: "file::memory:" }, SCHEMA)).toBe("file::memory:");
  });
  it("URL Postgres melempar dan menyebut tool migrasi", () => {
    expect(() => resolveDbUrl({ DATABASE_URL: "postgresql://u:p@h:5432/hanoman" }, SCHEMA))
      .toThrow(/migrate-from-postgres/);
  });
});

describe("dbFilePath", () => {
  it("melucuti skema file:", () => {
    expect(dbFilePath("file:/srv/hn/hanoman.db")).toBe("/srv/hn/hanoman.db");
  });
  it("bukan file: → melempar", () => {
    expect(() => dbFilePath("postgresql://x")).toThrow();
  });
});
```

- [x] **Step 2: Jalankan test — harus gagal**

Run: `pnpm vitest --run runner/test/paths.test.ts`
Expected: FAIL — `Failed to resolve import "../src/paths"`.

- [x] **Step 3: Implementasi `runner/src/paths.ts`**

```ts
// SPEC-398 · ADR-0086 · resolusi lokasi data hanoman. Dipakai server (db.ts, vitest.config)
// DAN cli (`hanoman start`, `migrate-from-postgres`) — karena itu ia hidup di runner, satu-satunya
// library node-only yang kedua paket sudah bergantung padanya (`shared` ikut dibundel Vite ke
// browser, jadi ia tak boleh menyentuh `node:os`/`node:path`).
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export type EnvLike = Record<string, string | undefined>;

/** Direktori data hanoman: `HANOMAN_HOME` bila diisi, jika tidak `~/.hanoman`. */
export function resolveHome(env: EnvLike = process.env, home: string = homedir()): string {
  const v = env.HANOMAN_HOME?.trim();
  return v ? v : join(home, ".hanoman");
}

/**
 * URL SQLite absolut untuk Prisma. `schemaDir` = direktori `schema.prisma`, karena Prisma
 * me-resolve path relatif di `file:` URL relatif terhadap situ — BUKAN cwd. Menyamakan aturannya
 * di sini mencegah kelas bug paling mahal di setup ini: CLI dan runtime menunjuk dua berkas beda.
 */
export function resolveDbUrl(env: EnvLike, schemaDir: string): string {
  const raw = env.DATABASE_URL?.trim();
  if (!raw) return `file:${join(resolveHome(env), "hanoman.db")}`;
  if (!raw.startsWith("file:")) {
    const scheme = raw.split("://")[0] ?? raw;
    throw new Error(
      `DATABASE_URL harus URL SQLite \`file:…\` sejak ADR-0086 (dapat \`${scheme}\`). ` +
      `Masih punya data Postgres? Pindahkan sekali: hanoman migrate-from-postgres --from "${raw}"`,
    );
  }
  const p = raw.slice("file:".length);
  if (p.startsWith(":")) return raw;              // file::memory: & kawan-kawan
  return `file:${isAbsolute(p) ? p : resolve(schemaDir, p)}`;
}

/** Path berkas dari URL SQLite. Melempar untuk URL non-`file:` — jangan pernah menebak. */
export function dbFilePath(url: string): string {
  if (!url.startsWith("file:")) throw new Error(`bukan URL SQLite: ${url}`);
  return url.slice("file:".length);
}
```

Tambahkan ke `runner/src/index.ts`:

```ts
export * from "./paths";
```

- [x] **Step 4: Jalankan test — harus lulus**

Run: `pnpm vitest --run runner/test/paths.test.ts`
Expected: PASS (11 test).

- [x] **Step 5: Naikkan Prisma dan tukar provider**

`server/package.json`: `"@prisma/client": "^6.19.0"` (dependencies) dan `"prisma": "^6.19.0"` (devDependencies).

`server/prisma/schema.prisma`:

```prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
```

Run: `pnpm install`
Expected: exit 0.

- [x] **Step 6: Ganti riwayat migrasi PG dengan satu init SQLite**

```bash
cd server
rm -rf prisma/migrations
mkdir -p prisma/migrations/20260730000000_init_sqlite
printf '# Please do not edit this file manually\nprovider = "sqlite"\n' > prisma/migrations/migration_lock.toml
pnpm exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script \
  > prisma/migrations/20260730000000_init_sqlite/migration.sql
pnpm exec prisma generate
```

Expected: `migration.sql` memuat `CREATE TABLE "Project"` dst dan **tak** memuat tipe khas PG (`JSONB`, `SERIAL`); `prisma generate` exit 0.
Verifikasi: `grep -c 'CREATE TABLE' prisma/migrations/20260730000000_init_sqlite/migration.sql` → 26.

- [x] **Step 7: Buang `mode: "insensitive"` (tak didukung SQLite)**

`server/src/services/session-history.ts:68-73` — hapus `, mode: "insensitive" as const` dari empat klausa `contains`, dan tambahkan komentar:

```ts
      OR: [
        // SPEC-398 · ADR-0086 · SQLite tak punya `mode: "insensitive"`; `LIKE`-nya sudah
        // case-insensitive untuk ASCII, jadi pencarian ini tetap berperilaku sama.
        { sessionId: { contains: term } },
        { specId: { contains: term } },
        { title: { contains: term } },
        { branch: { contains: term } },
      ],
```

- [x] **Step 8: Sambungkan `db.ts` ke resolver**

`server/src/db.ts`:

```ts
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
```

- [x] **Step 9: Test DB jadi berkas per checkout + migrasi otomatis**

`server/vitest.config.ts` — ganti blok derivasi DB (baris 15-25):

```ts
// SPEC-398 · ADR-0086 · DB test kini BERKAS di sebelah DB nyata (`…​.test.db`), bukan database
// Postgres bersama. Dua kelas gagal palsu ikut hilang: worktree tetangga tak bisa lagi men-truncate
// DB test sesi lain, dan tak ada lagi DB test yang harus di-`migrate deploy` manual (global-setup
// yang mengerjakannya). Tetap menolak jalan bila berkasnya sama dengan DB nyata.
{
  const schemaDir = resolve(import.meta.dirname, "prisma");
  const real = resolveDbUrl(process.env, schemaDir);
  const test = process.env.TEST_DATABASE_URL
    ?? (real.endsWith(".db") ? `${real.slice(0, -3)}.test.db` : `${real}.test.db`);
  if (test === real) throw new Error("vitest: menolak jalan — DB test sama dengan DATABASE_URL nyata");
  process.env.DATABASE_URL = test;
}
```

Tambahkan import di atas berkas itu: `import { resolveDbUrl } from "@hanoman/runner";` dan `globalSetup: ["./test/global-setup.ts"],` di dalam `test: { … }`.

Create `server/test/global-setup.ts`:

```ts
// SPEC-398 · ADR-0086 · siapkan DB test SQLite sekali per run: hapus berkasnya lalu terapkan
// migrasi. Sebelum ini DB test Postgres harus di-`migrate deploy` manual, dan lupa melakukannya
// memberi ~24 test gagal P2022 yang tampak seperti regresi.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { dbFilePath } from "@hanoman/runner";

export default function setup(): void {
  const url = process.env.DATABASE_URL;
  if (!url?.startsWith("file:")) throw new Error(`global-setup: butuh DATABASE_URL file:, dapat ${url}`);
  const file = dbFilePath(url);
  mkdirSync(dirname(file), { recursive: true });
  for (const s of ["", "-journal", "-wal", "-shm"]) rmSync(file + s, { force: true });
  const prismaCli = createRequire(import.meta.url).resolve("prisma");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema",
    resolve(import.meta.dirname, "../prisma/schema.prisma")],
    { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });
}
```

- [x] **Step 10: Cabut Docker & rapikan env**

`package.json` root: hapus baris `predev` dan `prod:db`; ubah `prod:setup` menjadi

```json
"prod:setup": "set -a && . ./.env.production && set +a && pnpm --filter ./server exec prisma migrate deploy && pnpm --filter ./server exec prisma generate && pnpm build",
```

dan tambahkan `"version": "0.1.0",` sesudah `"name": "hanoman",`.

```bash
rm docker-compose.yml
```

`.gitignore` — tambahkan:

```
*.db
*.db-journal
dist-npm/
```

`.env.example` — ganti blok `## Wajib`:

```
# ── Wajib ──────────────────────────────────────────────────────────────────────
# SQLite (Prisma). ADR-0086: SQLite satu-satunya provider — tak ada Postgres, tak ada Docker.
# Path RELATIF di-resolve relatif ke server/prisma (aturan Prisma), jadi `../../` = akar repo.
# Kosongkan untuk memakai default produksi: ~/.hanoman/hanoman.db (atau $HANOMAN_HOME).
DATABASE_URL=file:../../hanoman-dev.db
```

dan blok `## Test`:

```
# ── Test ────────────────────────────────────────────────────────────────────────
# Test jalan di BERKAS terpisah `<db>.test.db` yang diturunkan dari DATABASE_URL dan dimigrasi
# otomatis oleh server/test/global-setup.ts. Set ini hanya untuk override.
# TEST_DATABASE_URL=file:../../hanoman-dev.test.db
```

Tambahkan juga knob baru di bagian opsional:

```
# Direktori data hanoman (DB SQLite, key SSH, transkrip). Default ~/.hanoman.
# HANOMAN_HOME=

# Direktori aset dashboard yang di-serve server. Default: `web/` di dalam paket npm,
# atau `src/dist` saat dijalankan dari checkout.
# HANOMAN_WEB_DIR=
```

`.env.production.example`: ganti `DATABASE_URL` menjadi `DATABASE_URL=file:../../hanoman-prod.db` dan hapus penyebutan `hanoman_prod`/Postgres di komentarnya.

- [x] **Step 11: Buat DB dev lalu jalankan test yang tersentuh**

```bash
pnpm --filter ./server exec prisma migrate deploy
pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism
```

Expected: `migrate deploy` exit 0 (`1 migration applied`); vitest hijau. `--no-file-parallelism` **wajib** — test server berbagi satu berkas DB.

- [x] **Step 12: Typecheck paket yang tersentuh**

Run: `pnpm --filter ./server typecheck && pnpm --filter ./runner typecheck`
Expected: exit 0, tanpa output.

- [x] **Step 13: Commit**

```bash
git add -A
git commit -m "feat(spec-398): cutover SQLite — Prisma 6, provider sqlite, DB test per checkout, Docker dicabut"
```

---

### Task 2: Server menyajikan SPA dari dalam paket (`HANOMAN_WEB_DIR`)

**Files:**
- Create: `server/src/web-dir.ts`
- Modify: `server/src/app.ts:155-160`
- Test: `server/test/web-dir.test.ts`

**Interfaces:**
- Consumes: —
- Produces: `pickWebDir(distDir: string, env: EnvLike, exists: (p: string) => boolean): string | null`

- [x] **Step 1: Tulis test yang gagal**

Create `server/test/web-dir.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pickWebDir } from "../src/web-dir";

const has = (...ok: string[]) => (p: string) => ok.includes(p);

describe("pickWebDir", () => {
  it("HANOMAN_WEB_DIR menang bila ada", () => {
    expect(pickWebDir("/pkg/dist", { HANOMAN_WEB_DIR: "/custom" }, has("/custom"))).toBe("/custom");
  });
  it("HANOMAN_WEB_DIR di-set tapi tak ada → melempar (salah konfigurasi, jangan didiamkan)", () => {
    expect(() => pickWebDir("/pkg/dist", { HANOMAN_WEB_DIR: "/nope" }, has())).toThrow(/HANOMAN_WEB_DIR/);
  });
  it("layout paket npm: <pkg>/web", () => {
    expect(pickWebDir("/pkg/dist", {}, has("/pkg/web"))).toBe("/pkg/web");
  });
  it("layout checkout: <repo>/src/dist", () => {
    expect(pickWebDir("/repo/server/dist", {}, has("/repo/src/dist"))).toBe("/repo/src/dist");
  });
  it("tak ada aset → null (server tetap boleh jalan sebagai API saja)", () => {
    expect(pickWebDir("/pkg/dist", {}, has())).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan test — harus gagal**

Run: `pnpm vitest --run server/test/web-dir.test.ts`
Expected: FAIL — modul `../src/web-dir` tak ada.

- [x] **Step 3: Implementasi**

Create `server/src/web-dir.ts`:

```ts
// SPEC-398 · ADR-0087 · aset dashboard bisa berada di dua tempat: `web/` di dalam paket npm
// (dist bersebelahan) atau `src/dist` di checkout. Pemilihannya murni supaya bisa dites tanpa
// filesystem; `HANOMAN_WEB_DIR` yang di-set tapi salah MELEMPAR, karena "dashboard hilang tanpa
// pesan" adalah gejala yang mahal didiagnosis.
import { resolve } from "node:path";
import type { EnvLike } from "@hanoman/runner";

export function pickWebDir(distDir: string, env: EnvLike, exists: (p: string) => boolean): string | null {
  const forced = env.HANOMAN_WEB_DIR?.trim();
  if (forced) {
    if (!exists(forced)) throw new Error(`HANOMAN_WEB_DIR menunjuk direktori yang tak ada: ${forced}`);
    return forced;
  }
  for (const c of [resolve(distDir, "../web"), resolve(distDir, "../../src/dist")]) {
    if (exists(c)) return c;
  }
  return null;
}
```

- [x] **Step 4: Jalankan test — harus lulus**

Run: `pnpm vitest --run server/test/web-dir.test.ts`
Expected: PASS (5 test).

- [x] **Step 5: Sambungkan `app.ts`**

`server/src/app.ts` — ganti blok static:

```ts
  // Prod: serve the built dashboard from one process; SPA-fallback to
  // index.html for non-/api routes (api 404s stay JSON, never a fake page).
  // SPEC-398 · ADR-0087 · direktorinya dipilih pickWebDir (paket npm `web/` atau checkout
  // `src/dist`); absen → server tetap jalan sebagai API saja, bukan crash.
  if (process.env.NODE_ENV === "production") {
    const dist = pickWebDir(dirname(fileURLToPath(import.meta.url)), process.env, existsSync);
    if (dist) {
      app.register(fastifyStatic, { root: dist });
      app.setNotFoundHandler((req, reply) =>
        req.url.startsWith("/api") ? reply.code(404).send({ error: "not found" }) : reply.sendFile("index.html"));
    }
  }
```

Tambahkan import `existsSync` dari `node:fs` dan `pickWebDir` dari `./web-dir`; hapus import `resolve` bila jadi tak terpakai (cek dulu — `resolve` mungkin masih dipakai baris lain).

- [x] **Step 6: Jalankan test yang tersentuh + typecheck**

Run: `pnpm vitest --run server/test/web-dir.test.ts server/test/app.test.ts --no-file-parallelism && pnpm --filter ./server typecheck`
Expected: hijau. (Bila `server/test/app.test.ts` tak ada, cukup `web-dir.test.ts`.)

- [x] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(spec-398): pickWebDir — SPA di-serve dari paket npm atau checkout"
```

---

### Task 3: `hanoman start` + `hanoman doctor` (satu perintah untuk jalan)

**Files:**
- Create: `cli/src/layout.ts`
- Create: `cli/src/commands/start.ts`
- Create: `cli/src/commands/doctor.ts`
- Modify: `cli/src/router.ts`
- Modify: `cli/package.json` (deps + build externals)
- Test: `cli/test/layout.test.ts`, `cli/test/start-args.test.ts`, `cli/test/doctor.test.ts`

**Interfaces:**
- Consumes: `resolveHome`, `resolveDbUrl`, `dbFilePath` dari `@hanoman/runner`.
- Produces: `resolveLayout(distDir, exists): Layout` dengan `Layout = { root, schema, server, web }` · `parseStartArgs(argv): StartOpts` dengan `StartOpts = { port: number | null, host: string | null, db: string | null, migrate: boolean }` · `doctorReport(probes): { lines: string[], ok: boolean }`

- [x] **Step 1: Tulis test yang gagal untuk layout & argumen**

Create `cli/test/layout.test.ts`:

```ts
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
```

Create `cli/test/start-args.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseStartArgs } from "../src/commands/start";

describe("parseStartArgs", () => {
  it("default: tanpa override, migrasi menyala", () => {
    expect(parseStartArgs([])).toEqual({ port: null, host: null, db: null, migrate: true });
  });
  it("--port --host --db", () => {
    expect(parseStartArgs(["--port", "9000", "--host", "0.0.0.0", "--db", "/tmp/a.db"]))
      .toEqual({ port: 9000, host: "0.0.0.0", db: "/tmp/a.db", migrate: true });
  });
  it("bentuk --port=9000 juga diterima", () => {
    expect(parseStartArgs(["--port=9000"]).port).toBe(9000);
  });
  it("--no-migrate", () => {
    expect(parseStartArgs(["--no-migrate"]).migrate).toBe(false);
  });
  it("--port bukan angka → melempar", () => {
    expect(() => parseStartArgs(["--port", "abc"])).toThrow(/--port/);
  });
});
```

- [x] **Step 2: Jalankan — harus gagal**

Run: `pnpm vitest --run cli/test/layout.test.ts cli/test/start-args.test.ts`
Expected: FAIL — modul belum ada.

- [x] **Step 3: Implementasi `cli/src/layout.ts`**

```ts
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
```

- [x] **Step 4: Implementasi `cli/src/commands/start.ts`**

```ts
// SPEC-398 · ADR-0087 · `hanoman` (tanpa argumen) = perintah tunggal yang menjalankan hanoman:
// resolve home → terapkan migrasi → spawn bundle server dengan NODE_ENV=production supaya ia
// menyajikan dashboard dari dalam paket. Server hidup sebagai proses ANAK (bukan import) supaya
// sinyal, exit code, dan flag node-nya bersih; sesi tmux tetap selamat dari restart (ADR-0016).
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHome, resolveDbUrl, dbFilePath } from "@hanoman/runner";
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

/** `prisma migrate deploy` lewat CLI prisma yang ikut terpasang sebagai dependency paket. */
export function applyMigrations(schema: string, dbUrl: string): void {
  const prismaCli = createRequire(import.meta.url).resolve("prisma");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", schema], {
    env: { ...process.env, DATABASE_URL: dbUrl }, stdio: "inherit",
  });
}

export default async function start(argv: string[], ctx: Ctx): Promise<number> {
  let opts: StartOpts;
  try { opts = parseStartArgs(argv); } catch (e) { ctx.stderr(`${(e as Error).message}\n`); return 2; }

  const layout = resolveLayout(distDir(), existsSync);
  const home = resolveHome(ctx.env);
  const dbUrl = opts.db ? `file:${resolvePath(opts.db)}` : resolveDbUrl(ctx.env, dirname(layout.schema));
  mkdirSync(home, { recursive: true });
  mkdirSync(dirname(dbFilePath(dbUrl)), { recursive: true });

  if (!existsSync(layout.server)) {
    ctx.stderr(`hanoman: bundle server tak ada di ${layout.server} — jalankan \`pnpm build\` dulu\n`);
    return 1;
  }
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
```

- [x] **Step 5: Jalankan test layout & args — harus lulus**

Run: `pnpm vitest --run cli/test/layout.test.ts cli/test/start-args.test.ts`
Expected: PASS (9 test).

- [x] **Step 6: Tulis test doctor yang gagal**

Create `cli/test/doctor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { doctorReport } from "../src/commands/doctor";

const ok = {
  node: "v22.0.0", git: "git version 2.44.0", tmux: "tmux 3.4",
  claude: "1.0.0", codex: null, homeWritable: true, web: true, db: "/h/.hanoman/hanoman.db",
};

describe("doctorReport", () => {
  it("semua ada → ok", () => {
    const r = doctorReport(ok);
    expect(r.ok).toBe(true);
    expect(r.lines.join("\n")).toContain("git");
  });
  it("git absen → tidak ok", () => {
    expect(doctorReport({ ...ok, git: null }).ok).toBe(false);
  });
  it("tmux absen → tidak ok (sesi mustahil tanpa tmux)", () => {
    expect(doctorReport({ ...ok, tmux: null }).ok).toBe(false);
  });
  it("node di bawah 20 → tidak ok", () => {
    expect(doctorReport({ ...ok, node: "v18.20.0" }).ok).toBe(false);
  });
  it("kedua agen absen → tidak ok", () => {
    expect(doctorReport({ ...ok, claude: null, codex: null }).ok).toBe(false);
  });
  it("satu agen cukup", () => {
    expect(doctorReport({ ...ok, claude: null, codex: "0.146.0" }).ok).toBe(true);
  });
  it("aset web absen → peringatan, tetap ok (API tetap jalan)", () => {
    const r = doctorReport({ ...ok, web: false });
    expect(r.ok).toBe(true);
    expect(r.lines.join("\n")).toContain("dashboard");
  });
});
```

- [x] **Step 7: Jalankan — harus gagal**

Run: `pnpm vitest --run cli/test/doctor.test.ts`
Expected: FAIL — modul belum ada.

- [x] **Step 8: Implementasi `cli/src/commands/doctor.ts`**

```ts
// SPEC-398 · ADR-0087 · `hanoman doctor` melaporkan prasyarat yang TIDAK bisa dibawa npm: git,
// tmux, dan CLI agen. Menyembunyikannya akan membuat kegagalan muncul jauh nanti, di dalam pane
// tmux yang tak dibaca siapa pun. Keputusannya murni (probes → laporan) supaya bisa dites.
import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { dirname } from "node:path";
import { resolveHome, resolveDbUrl, dbFilePath } from "@hanoman/runner";
import type { Ctx } from "../router";
import { resolveLayout } from "../layout";
import { distDir } from "./start";

export type Probes = {
  node: string; git: string | null; tmux: string | null;
  claude: string | null; codex: string | null;
  homeWritable: boolean; web: boolean; db: string;
};

export function doctorReport(p: Probes): { lines: string[]; ok: boolean } {
  const major = Number(/^v?(\d+)/.exec(p.node)?.[1] ?? 0);
  const rows: Array<{ mark: string; text: string; fatal: boolean }> = [
    { mark: major >= 20 ? "✓" : "✗", text: `node ${p.node} (butuh ≥ 20)`, fatal: major < 20 },
    { mark: p.git ? "✓" : "✗", text: p.git ?? "git — TAK ADA (wajib: worktree per sesi)", fatal: !p.git },
    { mark: p.tmux ? "✓" : "✗", text: p.tmux ?? "tmux — TAK ADA (wajib: sesi agen hidup di tmux)", fatal: !p.tmux },
    { mark: p.claude ? "✓" : "·", text: p.claude ? `claude ${p.claude}` : "claude — tak ada", fatal: false },
    { mark: p.codex ? "✓" : "·", text: p.codex ? `codex ${p.codex}` : "codex — tak ada", fatal: false },
    { mark: p.homeWritable ? "✓" : "✗", text: `data dir ${p.homeWritable ? "bisa ditulis" : "TAK bisa ditulis"}`, fatal: !p.homeWritable },
    { mark: p.web ? "✓" : "!", text: p.web ? "aset dashboard ada" : "aset dashboard tak ada — API jalan, dashboard tidak", fatal: false },
    { mark: "·", text: `db ${p.db}`, fatal: false },
  ];
  const noAgent = !p.claude && !p.codex;
  if (noAgent) rows.push({ mark: "✗", text: "tak ada CLI agen (claude ATAU codex wajib ada)", fatal: true });
  const lines = rows.map((r) => `  ${r.mark} ${r.text}`);
  return { lines, ok: !rows.some((r) => r.fatal) };
}

function version(bin: string, args: string[]): string | null {
  try { return execFileSync(bin, args, { encoding: "utf8", timeout: 10_000 }).trim().split("\n")[0] ?? null; }
  catch { return null; }
}

export default async function doctor(_argv: string[], ctx: Ctx): Promise<number> {
  const layout = resolveLayout(distDir(), existsSync);
  const home = resolveHome(ctx.env);
  let homeWritable = false;
  try { accessSync(existsSync(home) ? home : dirname(home), constants.W_OK); homeWritable = true; } catch { /* tetap false */ }
  const r = doctorReport({
    node: process.version,
    git: version("git", ["--version"]),
    tmux: version("tmux", ["-V"]),
    claude: version(ctx.env.HANOMAN_CLAUDE_BIN ?? "claude", ["--version"]),
    codex: version(ctx.env.HANOMAN_CODEX_BIN ?? "codex", ["--version"]),
    homeWritable, web: layout.web !== null,
    db: dbFilePath(resolveDbUrl(ctx.env, dirname(layout.schema))),
  });
  ctx.stdout(`hanoman doctor\n${r.lines.join("\n")}\n`);
  if (!r.ok) ctx.stderr("\nada prasyarat yang belum terpenuhi — hanoman tak akan bisa menjalankan sesi\n");
  return r.ok ? 0 : 1;
}
```

- [x] **Step 9: Jalankan test doctor — harus lulus**

Run: `pnpm vitest --run cli/test/doctor.test.ts`
Expected: PASS (7 test).

- [x] **Step 10: Sambungkan router + versi dari package.json**

`cli/src/router.ts` — ganti `VERSION`, `HELP`, dan dispatch:

```ts
// SPEC-398 · ADR-0087 · versi = versi paket npm (sumber tunggal: package.json paket ini),
// bukan konstanta yang mudah basi.
import { createRequire } from "node:module";
function version(): string {
  try { return createRequire(import.meta.url)("../package.json").version as string; }
  catch { return "0.0.0"; }
}
const HELP = `hanoman <command>

  (tanpa argumen) | start                   jalankan hanoman (migrasi + server + dashboard)
    --port <n> --host <h> --db <file> --no-migrate
  doctor                                    periksa prasyarat: node, git, tmux, CLI agen, data dir
  update [--check]                          bandingkan versi dengan registry npm; pasang yang terbaru
  migrate-from-postgres --from <url>        pindahkan data Postgres lama ke SQLite
    [--to <file>] [--dry-run] [--force]
  docs scan [--json]                        coverage + laporan per-kategori
  docs index --check | --fix                integritas index
  docs link <path> [--category c]           tambahkan doc ke index
  --version | --help`;

export async function run(argv: string[], ctx: Ctx): Promise<number> {
  if (argv.includes("--version")) { ctx.stdout(version() + "\n"); return 0; }
  if (argv.includes("--help")) { ctx.stdout(HELP + "\n"); return 0; }
  // SPEC-398 · `hanoman` telanjang MENJALANKAN hanoman (dulu mencetak help) — itu inti objective-nya.
  if (argv.length === 0) return (await import("./commands/start")).default([], ctx);
  const [group, sub, ...rest] = argv;
  if (group === "start")  return (await import("./commands/start")).default(argv.slice(1), ctx);
  if (group === "doctor") return (await import("./commands/doctor")).default(argv.slice(1), ctx);
  if (group === "docs" && sub === "scan")   return (await import("./commands/docs-scan")).default(rest, ctx);
  if (group === "docs" && sub === "index")  return (await import("./commands/docs-index")).default(rest, ctx);
  if (group === "docs" && sub === "link")   return (await import("./commands/docs-link")).default(rest, ctx);
  ctx.stderr(`unknown command: ${argv.join(" ")}\n\n${HELP}\n`);
  return 1;
}
```

Catatan: `run(argv)` untuk `--version` HARUS tetap mendahului dispatch, dan `argv.length === 0` tak lagi mencetak help.

`cli/package.json` — tambahkan dependency & external build:

```json
  "bin": { "hanoman": "dist/hanoman.js" },
  "scripts": {
    "build": "esbuild src/hanoman.ts --bundle --platform=node --format=esm --outfile=dist/hanoman.js --external:prisma --external:@prisma/client --external:pg",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": { "@hanoman/shared": "workspace:*", "@hanoman/runner": "workspace:*", "@prisma/client": "^6.19.0", "zod": "^3.23.0" },
```

Run: `pnpm install`
Expected: exit 0.

- [x] **Step 11: Bukti nyata — CLI benar-benar mem-boot hanoman**

```bash
pnpm --filter ./cli build && pnpm --filter ./src build && pnpm --filter ./server build
node cli/dist/hanoman.js doctor; echo "exit=$?"
HANOMAN_HOME=/tmp/hn398 DATABASE_URL= PORT=8899 timeout 25 node cli/dist/hanoman.js --port 8899 &
sleep 12 && curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8899/health
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8899/
```

Expected: `doctor` mencetak daftar ✓; `/health` → `200`; `/` → `200` (index.html dari `src/dist`);
`/tmp/hn398/hanoman.db` ada.

- [x] **Step 12: Test yang tersentuh + typecheck**

Run: `pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism && pnpm --filter ./cli typecheck`
Expected: hijau.

- [x] **Step 13: Commit**

```bash
git add -A
git commit -m "feat(spec-398): hanoman start + doctor — satu perintah untuk menjalankan hanoman"
```

---

### Task 4: Deteksi update lewat registry npm (`hanoman update`)

**Files:**
- Create: `shared/src/semver.ts`
- Modify: `shared/src/index.ts`, `shared/src/dto.ts:375-390`
- Modify: `shared/test/update-dto.test.ts`
- Modify: `server/src/services/update.ts`
- Modify: `server/test/update.test.ts`, `server/test/update.service.test.ts`
- Modify: `src/src/screens/UpdateIndicator.tsx`, `src/test/update.test.ts`, `src/test/update-indicator.test.tsx`
- Create: `cli/src/commands/update.ts`, `cli/test/update-cmd.test.ts`
- Modify: `cli/src/router.ts`, `scripts/stamp-build.mjs`

**Interfaces:**
- Consumes: —
- Produces: `compareSemver(a, b): -1 | 0 | 1` (shared) · `UpdateStatus = { currentVersion, latestVersion, registry: { status, checkedAt }, updateAvailable, command }` · `composeUpdate(x): UpdateStatus` · `UPDATE_COMMAND = "npm i -g hanoman@latest"`

- [x] **Step 1: Tulis test semver yang gagal**

Create `shared/test/semver.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { compareSemver } from "../src/semver";

describe("compareSemver", () => {
  it("major/minor/patch", () => {
    expect(compareSemver("1.0.0", "2.0.0")).toBe(-1);
    expect(compareSemver("1.2.0", "1.10.0")).toBe(-1);   // numerik, bukan leksikal
    expect(compareSemver("1.0.10", "1.0.9")).toBe(1);
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
  });
  it("prefix v ditoleransi", () => {
    expect(compareSemver("v1.2.3", "1.2.3")).toBe(0);
  });
  it("rilis stabil > prerelease", () => {
    expect(compareSemver("1.0.0", "1.0.0-rc.1")).toBe(1);
    expect(compareSemver("1.0.0-rc.1", "1.0.0")).toBe(-1);
    expect(compareSemver("1.0.0-rc.2", "1.0.0-rc.10")).toBe(-1);
  });
  it("versi tak terbaca → 0 (fail-safe: jangan pernah mengaku ada update)", () => {
    expect(compareSemver("latest", "1.0.0")).toBe(0);
    expect(compareSemver("", "")).toBe(0);
  });
});
```

- [x] **Step 2: Jalankan — harus gagal**

Run: `pnpm vitest --run shared/test/semver.test.ts`
Expected: FAIL — modul belum ada.

- [x] **Step 3: Implementasi `shared/src/semver.ts`**

```ts
// SPEC-398 · ADR-0087 · identitas versi hanoman pindah dari SHA git ke semver npm, jadi
// perbandingannya harus numerik per-komponen ("1.10.0" > "1.2.0") dan tahu prerelease.
// Ditulis tangan agar `shared` tetap tanpa dependency runtime (ia ikut dibundel ke browser).
// Versi tak terbaca → 0: fail-safe, panel update tak boleh mengarang "ada update".
const RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/;

function parse(v: string): { nums: [number, number, number]; pre: string | null } | null {
  const m = RE.exec(v.trim());
  return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null } : null;
}

export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parse(a), pb = parse(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    const d = pa.nums[i]! - pb.nums[i]!;
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  const ka = pa.pre.split(".").map((s) => (/^\d+$/.test(s) ? s.padStart(12, "0") : s)).join(".");
  const kb = pb.pre.split(".").map((s) => (/^\d+$/.test(s) ? s.padStart(12, "0") : s)).join(".");
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}
```

Tambahkan `export * from "./semver";` ke `shared/src/index.ts`.

- [x] **Step 4: Jalankan — harus lulus**

Run: `pnpm vitest --run shared/test/semver.test.ts`
Expected: PASS (4 test / 10 assertion).

- [x] **Step 5: Ganti bentuk `UpdateStatus`**

`shared/src/dto.ts` — ganti blok SPEC-214 (baris ~375-390):

```ts
// SPEC-398 · ADR-0087 · versi hanoman = semver paket npm (dulu SHA git, SPEC-214). Panel tetap
// READ-ONLY: `command` adalah panduan untuk disalin, bukan aksi yang server jalankan (ADR-0048).
export type UpdateRegistryStatus = "ok" | "unavailable";  // unavailable = offline / opt-out / paket belum terbit
export type UpdateStatus = {
  currentVersion: string;                 // versi yang sedang berjalan (build-info.json → package.json)
  latestVersion: string | null;           // versi terbaru di registry; null bila tak terbaca
  registry: { status: UpdateRegistryStatus; checkedAt: string | null };
  updateAvailable: boolean;               // compareSemver(latest, current) > 0
  command: string;                        // "npm i -g hanoman@latest"; "" bila sudah terkini
};
```

Hapus `UpdateReason`, `UpdateRemoteStatus`, dan `UpdateCommit` — tak ada lagi konsumennya sesudah task ini. Jalankan `grep -rn "UpdateReason\|UpdateRemoteStatus\|UpdateCommit" shared server src cli --include="*.ts" --include="*.tsx"` untuk memastikan nol sisa.

- [x] **Step 6: Tulis ulang `services/update.ts`**

```ts
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compareSemver, type UpdateStatus, type UpdateRegistryStatus } from "@hanoman/shared";
import { effectiveStr, effectiveBool } from "../config";

export const UPDATE_COMMAND = "npm i -g hanoman@latest";

export type UpdateInputs = {
  currentVersion: string;
  latestVersion: string | null;
  registryStatus: UpdateRegistryStatus;
  checkedAt: string | null;
};

// Murni & deterministik: seluruh keputusan "update tersedia?" ada di sini, terpisah dari jaringan.
export function composeUpdate(x: UpdateInputs): UpdateStatus {
  const available = x.registryStatus === "ok" && x.latestVersion != null
    && compareSemver(x.latestVersion, x.currentVersion) > 0;
  return {
    currentVersion: x.currentVersion,
    latestVersion: x.latestVersion,
    registry: { status: x.registryStatus, checkedAt: x.checkedAt },
    updateAvailable: available,
    command: available ? UPDATE_COMMAND : "",
  };
}

const RESULT_TTL_MS = 15_000;
const FETCH_TTL_MS = 5 * 60_000;
const DEFAULT_REGISTRY = "https://registry.npmjs.org";

let cached: { at: number; value: UpdateStatus } | null = null;
let lastFetchAt = 0;
let lastLatest: string | null = null;
let lastStatus: UpdateRegistryStatus = "unavailable";

// Versi yang sedang jalan: dist/build-info.json (ditanam scripts/stamp-build.mjs), lalu
// package.json paket. Absen keduanya → "0.0.0" (dev): compareSemver tetap aman.
export function runningVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const [p, key] of [[resolve(here, "build-info.json"), "version"], [resolve(here, "../package.json"), "version"]] as const) {
    try { const v = JSON.parse(readFileSync(p, "utf8"))?.[key]; if (typeof v === "string" && v) return v; }
    catch { /* lanjut ke kandidat berikutnya */ }
  }
  return "0.0.0";
}

// Jaringan HANYA di sini, dan hanya bila opt-in (knob HANOMAN_UPDATE_FETCH; test memaksa "0").
async function maybeFetch(): Promise<void> {
  if (!effectiveBool("HANOMAN_UPDATE_FETCH")) return;
  if (lastFetchAt && Date.now() - lastFetchAt < FETCH_TTL_MS) return;
  lastFetchAt = Date.now();
  const base = (effectiveStr("HANOMAN_NPM_REGISTRY") ?? DEFAULT_REGISTRY).replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/hanoman/latest`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) { lastStatus = "unavailable"; lastLatest = null; return; }
    const body = (await res.json()) as { version?: unknown };
    if (typeof body.version === "string" && body.version) { lastLatest = body.version; lastStatus = "ok"; }
    else { lastStatus = "unavailable"; lastLatest = null; }
  } catch { lastStatus = "unavailable"; lastLatest = null; }
}

export async function getUpdateStatus(): Promise<UpdateStatus> {
  if (cached && Date.now() - cached.at < RESULT_TTL_MS) return cached.value;
  await maybeFetch();
  const value = composeUpdate({
    currentVersion: runningVersion(),
    latestVersion: lastLatest,
    registryStatus: lastStatus,
    checkedAt: lastFetchAt ? new Date(lastFetchAt).toISOString() : null,
  });
  cached = { at: Date.now(), value };
  return value;
}

export function _resetUpdateCache(): void {
  cached = null; lastFetchAt = 0; lastLatest = null; lastStatus = "unavailable";
}
```

- [x] **Step 7: Perbarui test server untuk update**

`server/test/update.test.ts` — ganti isinya:

```ts
import { describe, it, expect } from "vitest";
import { composeUpdate, UPDATE_COMMAND } from "../src/services/update";

const base = { currentVersion: "0.1.0", latestVersion: null, registryStatus: "unavailable" as const, checkedAt: null };

describe("composeUpdate", () => {
  it("registry tak terjangkau → tak ada update, tanpa perintah", () => {
    const u = composeUpdate(base);
    expect(u.updateAvailable).toBe(false);
    expect(u.command).toBe("");
  });
  it("versi terbaru lebih tinggi → ada update + perintah npm", () => {
    const u = composeUpdate({ ...base, latestVersion: "0.2.0", registryStatus: "ok", checkedAt: "2026-07-30T00:00:00Z" });
    expect(u.updateAvailable).toBe(true);
    expect(u.command).toBe(UPDATE_COMMAND);
  });
  it("versi sama → tak ada update", () => {
    expect(composeUpdate({ ...base, latestVersion: "0.1.0", registryStatus: "ok" }).updateAvailable).toBe(false);
  });
  it("registry lebih tua dari yang jalan (dev di depan rilis) → tak ada update", () => {
    expect(composeUpdate({ ...base, currentVersion: "0.3.0", latestVersion: "0.2.0", registryStatus: "ok" }).updateAvailable).toBe(false);
  });
});
```

`server/test/update.service.test.ts` — ganti isinya:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { getUpdateStatus, runningVersion, _resetUpdateCache } from "../src/services/update";

describe("getUpdateStatus", () => {
  beforeEach(() => _resetUpdateCache());

  it("HANOMAN_UPDATE_FETCH=0 → nol jaringan, fail-safe tanpa melempar", async () => {
    const u = await getUpdateStatus();
    expect(u.updateAvailable).toBe(false);
    expect(u.registry.status).toBe("unavailable");
    expect(u.latestVersion).toBeNull();
  });
  it("currentVersion selalu terisi semver", async () => {
    expect((await getUpdateStatus()).currentVersion).toMatch(/^\d+\.\d+\.\d+/);
  });
  it("hasil di-cache dalam TTL (identitas objek sama)", async () => {
    expect(await getUpdateStatus()).toBe(await getUpdateStatus());
  });
  it("runningVersion fallback aman", () => {
    expect(runningVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
```

`shared/test/update-dto.test.ts` — ganti dua objek literalnya dengan bentuk baru:

```ts
import { describe, it, expect } from "vitest";
import type { UpdateStatus, EventMsg } from "../src/dto";

describe("UpdateStatus DTO", () => {
  it("bentuk terkini: tak ada update", () => {
    const u: UpdateStatus = {
      currentVersion: "0.1.0", latestVersion: "0.1.0",
      registry: { status: "ok", checkedAt: "2026-07-30T00:00:00Z" },
      updateAvailable: false, command: "",
    };
    expect(u.updateAvailable).toBe(false);
  });
  it("frame siar memuat update", () => {
    const u: UpdateStatus = {
      currentVersion: "0.1.0", latestVersion: "0.2.0",
      registry: { status: "ok", checkedAt: null },
      updateAvailable: true, command: "npm i -g hanoman@latest",
    };
    const msg: EventMsg = { t: "update", update: u };
    expect(msg.t).toBe("update");
  });
});
```

Hapus assertion apa pun yang menyebut `currentSha`/`newCommits`/`reason` di ketiga berkas itu.

- [x] **Step 8: Jalankan test server & shared yang tersentuh**

Run: `pnpm vitest --run shared/test/semver.test.ts shared/test/update-dto.test.ts server/test/update.test.ts server/test/update.service.test.ts --no-file-parallelism`
Expected: PASS.

- [x] **Step 9: Perbarui UI `UpdateIndicator.tsx`**

Baca `src/src/screens/UpdateIndicator.tsx` dan `src/src/api/update.ts` lalu ganti setiap referensi
field lama dengan yang baru: `currentSha`→`currentVersion`, `remote.behind`/`newCommits`→
`latestVersion`, `local.stale`/`reason` dihapus. Teks yang ditampilkan: `v<currentVersion>` bila
terkini; `v<currentVersion> → v<latestVersion>` bila ada update, dengan `command` dalam blok
`<code>` untuk disalin. Sesuaikan `src/test/update.test.ts` dan
`src/test/update-indicator.test.tsx` ke bentuk & teks baru (fixture memakai `currentVersion` dst).

- [x] **Step 10: Implementasi `hanoman update`**

Create `cli/src/commands/update.ts`:

```ts
// SPEC-398 · ADR-0087 · update = `npm i -g hanoman@latest`. CLI-lah yang melakukannya, BUKAN
// server: instance yang me-`npm i` dirinya sendiri lalu keluar akan memutus sesi tmux yang sedang
// berjalan tanpa peringatan (ADR-0048 tetap read-only di sisi server).
import { execFileSync } from "node:child_process";
import { compareSemver } from "@hanoman/shared";
import type { Ctx } from "../router";

export const PKG = "hanoman";
export const INSTALL_ARGS = ["i", "-g", `${PKG}@latest`] as const;

export type UpdatePlan =
  | { action: "up-to-date"; current: string; latest: string }
  | { action: "install"; current: string; latest: string }
  | { action: "unknown"; current: string; latest: null };

export function planUpdate(current: string, latest: string | null): UpdatePlan {
  if (!latest) return { action: "unknown", current, latest: null };
  return compareSemver(latest, current) > 0
    ? { action: "install", current, latest }
    : { action: "up-to-date", current, latest };
}

async function latestVersion(registry: string): Promise<string | null> {
  try {
    const res = await fetch(`${registry.replace(/\/+$/, "")}/${PKG}/latest`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch { return null; }
}

export default async function update(argv: string[], ctx: Ctx): Promise<number> {
  const check = argv.includes("--check");
  const current = (await import("../router")).currentVersion();
  const latest = await latestVersion(ctx.env.HANOMAN_NPM_REGISTRY ?? "https://registry.npmjs.org");
  const plan = planUpdate(current, latest);
  if (plan.action === "unknown") {
    ctx.stderr(`hanoman ${current} · registry npm tak terjangkau — coba lagi nanti\n`);
    return 1;
  }
  if (plan.action === "up-to-date") { ctx.stdout(`hanoman ${current} sudah terkini\n`); return 0; }
  ctx.stdout(`hanoman ${plan.current} → ${plan.latest}\n`);
  if (check) { ctx.stdout(`jalankan: npm ${INSTALL_ARGS.join(" ")}\n`); return 0; }
  try { execFileSync("npm", [...INSTALL_ARGS], { stdio: "inherit" }); }
  catch { ctx.stderr("npm i -g gagal — jalankan manual (mungkin butuh sudo)\n"); return 1; }
  ctx.stdout(`terpasang hanoman ${plan.latest} · restart instance yang berjalan\n`);
  return 0;
}
```

`cli/src/router.ts` — ekspor `currentVersion` (ganti fungsi lokal `version()` menjadi
`export function currentVersion(): string`) dan tambahkan dispatch:

```ts
  if (group === "update") return (await import("./commands/update")).default(argv.slice(1), ctx);
```

- [x] **Step 11: Test `hanoman update` (murni)**

Create `cli/test/update-cmd.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { planUpdate, INSTALL_ARGS, PKG } from "../src/commands/update";

describe("planUpdate", () => {
  it("registry tak terjangkau → unknown", () => {
    expect(planUpdate("0.1.0", null).action).toBe("unknown");
  });
  it("lebih baru tersedia → install", () => {
    expect(planUpdate("0.1.0", "0.2.0").action).toBe("install");
  });
  it("sama → up-to-date", () => {
    expect(planUpdate("0.2.0", "0.2.0").action).toBe("up-to-date");
  });
  it("registry lebih tua → up-to-date, jangan pernah turun versi", () => {
    expect(planUpdate("0.3.0", "0.2.0").action).toBe("up-to-date");
  });
  it("perintah pemasangan global & bernama tepat", () => {
    expect(INSTALL_ARGS.join(" ")).toBe(`i -g ${PKG}@latest`);
  });
});
```

Run: `pnpm vitest --run cli/test/update-cmd.test.ts`
Expected: PASS (5 test).

- [x] **Step 12: Tanam versi ke build-info.json**

`scripts/stamp-build.mjs` — tambahkan versi dari root `package.json`:

```js
const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version ?? "0.0.0";
...
writeFileSync(out, JSON.stringify({ version, sha, builtAt: new Date().toISOString() }, null, 2) + "\n");
console.log(`stamped build-info.json · v${version} · ${sha}`);
```

(Tambahkan `readFileSync` ke import `node:fs` yang sudah ada.)

- [x] **Step 13: Test yang tersentuh + typecheck**

Run: `pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism && pnpm --filter ./server typecheck && pnpm --filter ./cli typecheck && pnpm --filter ./src typecheck`
Expected: hijau.

- [x] **Step 14: Commit**

```bash
git add -A
git commit -m "feat(spec-398): deteksi update dari registry npm + hanoman update"
```

---

### Task 5: Rakit paket npm (`hanoman __pack` + `pnpm release`)

**Files:**
- Create: `cli/src/release/pack.ts`
- Create: `cli/src/commands/pack.ts`
- Modify: `cli/src/router.ts`
- Test: `cli/test/pack.test.ts`
- Modify: `package.json` (`build:cli`, `release`)
- Create: `dist-npm/README.md` sumbernya → `internal/docs/../` (lihat step)

**Interfaces:**
- Consumes: `resolveLayout` (Task 3)
- Produces: `RUNTIME_DEPS: readonly string[]` · `packageJsonFor(version, deps): object` · `copyPlan(repo: string): Array<{ from: string; to: string; dir?: boolean }>` · `REQUIRED_ARTIFACTS: readonly string[]`

- [ ] **Step 1: Tulis test yang gagal**

Create `cli/test/pack.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { packageJsonFor, copyPlan, RUNTIME_DEPS, REQUIRED_ARTIFACTS } from "../src/release/pack";

describe("packageJsonFor", () => {
  const pkg = packageJsonFor("1.2.3", { fastify: "^4.28.0", prisma: "^6.19.0" }) as Record<string, any>;

  it("nama & versi & bin", () => {
    expect(pkg.name).toBe("hanoman");
    expect(pkg.version).toBe("1.2.3");
    expect(pkg.bin).toEqual({ hanoman: "bin/hanoman.mjs" });
  });
  it("ESM + engine node ≥20", () => {
    expect(pkg.type).toBe("module");
    expect(pkg.engines.node).toBe(">=20");
  });
  it("BUKAN private — paket ini memang diterbitkan", () => {
    expect(pkg.private).toBeUndefined();
  });
  it("hanya dependency yang disebutkan yang masuk", () => {
    expect(Object.keys(pkg.dependencies)).toEqual(["fastify", "prisma"]);
  });
  it("files memuat seluruh artefak runtime", () => {
    for (const f of ["bin", "dist", "web", "prisma"]) expect(pkg.files).toContain(f);
  });
});

describe("copyPlan", () => {
  const plan = copyPlan("/repo");
  const to = plan.map((p) => p.to);

  it("membawa dua bundle, SPA, dan prisma", () => {
    expect(to).toContain("dist/server.js");
    expect(to).toContain("dist/cli.js");
    expect(to).toContain("web");
    expect(to).toContain("prisma/schema.prisma");
    expect(to).toContain("prisma/migrations");
  });
  it("sumbernya di dalam repo yang diberikan", () => {
    for (const p of plan) expect(p.from.startsWith("/repo/")).toBe(true);
  });
  it("SPA & migrations disalin sebagai direktori", () => {
    expect(plan.find((p) => p.to === "web")?.dir).toBe(true);
    expect(plan.find((p) => p.to === "prisma/migrations")?.dir).toBe(true);
  });
});

describe("RUNTIME_DEPS", () => {
  it("memuat semua external esbuild server + prisma CLI + pg", () => {
    for (const d of ["fastify", "@fastify/static", "@fastify/websocket", "@fastify/cookie",
                     "@prisma/client", "node-pty", "pdfkit", "prisma", "pg"]) {
      expect(RUNTIME_DEPS).toContain(d);
    }
  });
  it("tak memuat paket workspace (semuanya sudah dibundel esbuild)", () => {
    for (const d of RUNTIME_DEPS) expect(d.startsWith("@hanoman/")).toBe(false);
  });
});

describe("REQUIRED_ARTIFACTS", () => {
  it("menuntut entry bin & index dashboard ada", () => {
    expect(REQUIRED_ARTIFACTS).toContain("bin/hanoman.mjs");
    expect(REQUIRED_ARTIFACTS).toContain("web/index.html");
  });
});
```

- [ ] **Step 2: Jalankan — harus gagal**

Run: `pnpm vitest --run cli/test/pack.test.ts`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: Implementasi `cli/src/release/pack.ts`**

```ts
// SPEC-398 · ADR-0087 · rakit paket npm `hanoman` ke staging `dist-npm/`. Workspace TIDAK
// dipublikasikan: yang diterbitkan adalah satu paket self-contained berisi dua bundle esbuild,
// aset dashboard, dan skema+migrasi Prisma. Bagian yang bisa salah tanpa suara (daftar dependency,
// daftar berkas) dipisah ke fungsi murni supaya dijaga test.
import { join } from "node:path";

export const PKG_NAME = "hanoman";

// Wajib = seluruh `--external:` di build server, plus CLI prisma (`migrate deploy` di `hanoman
// start`) dan `pg` (`migrate-from-postgres`). Apa pun di luar daftar ini ikut dibundel esbuild.
export const RUNTIME_DEPS = [
  "fastify", "@fastify/static", "@fastify/websocket", "@fastify/cookie",
  "@prisma/client", "node-pty", "pdfkit", "prisma", "pg",
] as const;

export const REQUIRED_ARTIFACTS = [
  "package.json", "bin/hanoman.mjs", "dist/cli.js", "dist/server.js",
  "prisma/schema.prisma", "web/index.html", "README.md",
] as const;

export function packageJsonFor(version: string, deps: Record<string, string>): object {
  return {
    name: PKG_NAME,
    version,
    description: "Orchestrator + dashboard workflow docs-driven untuk sesi Claude Code / Codex",
    type: "module",
    bin: { hanoman: "bin/hanoman.mjs" },
    engines: { node: ">=20" },
    files: ["bin", "dist", "web", "prisma", "README.md"],
    dependencies: deps,
    license: "UNLICENSED",
  };
}

export function copyPlan(repo: string): Array<{ from: string; to: string; dir?: boolean }> {
  return [
    { from: join(repo, "server/dist/server.js"), to: "dist/server.js" },
    { from: join(repo, "server/dist/build-info.json"), to: "dist/build-info.json" },
    { from: join(repo, "cli/dist/hanoman.js"), to: "dist/cli.js" },
    { from: join(repo, "src/dist"), to: "web", dir: true },
    { from: join(repo, "server/prisma/schema.prisma"), to: "prisma/schema.prisma" },
    { from: join(repo, "server/prisma/migrations"), to: "prisma/migrations", dir: true },
    { from: join(repo, "internal/docs/operations/npm-readme.md"), to: "README.md" },
  ];
}

export const BIN_SHIM = `#!/usr/bin/env node
// SPEC-398 · shim tipis: seluruh logika ada di dist/cli.js (bundle esbuild).
import "../dist/cli.js";
`;
```

- [ ] **Step 4: Jalankan — harus lulus**

Run: `pnpm vitest --run cli/test/pack.test.ts`
Expected: PASS (11 test).

- [ ] **Step 5: Implementasi perintah `__pack`**

Create `cli/src/commands/pack.ts`:

```ts
// SPEC-398 · ADR-0087 · perintah DEV (tak didokumentasikan di --help): merakit dist-npm/.
// Ia hidup di CLI, bukan di scripts/*.mjs, supaya logikanya TypeScript & bertest.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { existsSync as exists } from "node:fs";
import type { Ctx } from "../router";
import { resolveLayout } from "../layout";
import { distDir } from "./start";
import { BIN_SHIM, REQUIRED_ARTIFACTS, RUNTIME_DEPS, copyPlan, packageJsonFor } from "../release/pack";

function depVersions(repo: string): Record<string, string> {
  const server = JSON.parse(readFileSync(join(repo, "server/package.json"), "utf8"));
  const cli = JSON.parse(readFileSync(join(repo, "cli/package.json"), "utf8"));
  const pools = [server.dependencies, server.devDependencies, cli.dependencies, cli.devDependencies];
  const out: Record<string, string> = {};
  for (const d of RUNTIME_DEPS) {
    const v = pools.map((p) => p?.[d]).find((x) => typeof x === "string");
    if (!v) throw new Error(`pack: versi dependency "${d}" tak ditemukan di server/cli package.json`);
    out[d] = v;
  }
  return out;
}

export default async function pack(argv: string[], ctx: Ctx): Promise<number> {
  const repo = resolveLayout(distDir(), exists).root;
  const outIdx = argv.indexOf("--out");
  const out = outIdx === -1 ? join(repo, "dist-npm") : join(repo, argv[outIdx + 1]!);
  const version = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version as string;
  if (!version) { ctx.stderr("pack: root package.json tanpa field version\n"); return 1; }

  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "bin"), { recursive: true });
  for (const item of copyPlan(repo)) {
    if (!existsSync(item.from)) { ctx.stderr(`pack: artefak hilang — ${item.from} (sudah \`pnpm build\`?)\n`); return 1; }
    const dest = join(out, item.to);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(item.from, dest, item.dir ? { recursive: true } : {});
  }
  writeFileSync(join(out, "bin/hanoman.mjs"), BIN_SHIM);
  writeFileSync(join(out, "package.json"),
    JSON.stringify(packageJsonFor(version, depVersions(repo)), null, 2) + "\n");

  const missing = REQUIRED_ARTIFACTS.filter((a) => !existsSync(join(out, a)));
  if (missing.length) { ctx.stderr(`pack: artefak wajib hilang: ${missing.join(", ")}\n`); return 1; }
  ctx.stdout(`pack · ${out} · hanoman@${version} · ${REQUIRED_ARTIFACTS.length} artefak wajib ada\n`);
  ctx.stdout("terbitkan MANUAL: cd dist-npm && npm publish --otp <kode>\n");
  return 0;
}
```

`cli/src/router.ts` — tambahkan sebelum baris `unknown command`:

```ts
  // SPEC-398 · perintah rilis, sengaja tak muncul di --help (hanya berguna di checkout repo).
  if (group === "__pack") return (await import("./commands/pack")).default(argv.slice(1), ctx);
```

- [ ] **Step 6: Tulis README paket**

Create `internal/docs/operations/npm-readme.md` — README yang ikut terbit di npm:

```markdown
# hanoman

Orchestrator + dashboard workflow docs-driven: ia menyuruh **Claude Code** atau **Codex** membangun
project terhadap dokumentasi sebagai kebenaran, lalu memantau semua sesi dalam satu dashboard.

## Pasang

```bash
npm i -g hanoman
hanoman doctor     # periksa prasyarat
hanoman            # jalan di http://127.0.0.1:8787
```

Buka URL-nya, buat akun pertama, selesai. Datanya di `~/.hanoman/` (SQLite — **tanpa Docker,
tanpa Postgres, tanpa Redis**).

## Prasyarat yang tidak dibawa npm

| Butuh | Untuk apa |
|---|---|
| `git` | tiap sesi jalan di git worktree terisolasi |
| `tmux` | sesi agen hidup di tmux, selamat dari restart server |
| `claude` **atau** `codex` | agen yang mengerjakan backlog |

`hanoman doctor` melaporkan mana yang belum ada.

## Perintah

```
hanoman [start]                    jalankan (migrasi + server + dashboard)
  --port <n> --host <h> --db <file> --no-migrate
hanoman doctor                     periksa prasyarat
hanoman update [--check]           pasang versi terbaru dari npm
hanoman migrate-from-postgres --from <url> [--to <file>] [--dry-run] [--force]
hanoman docs scan | index | link   operasi index Source of Truth
```

## Update

```bash
hanoman update            # npm i -g hanoman@latest
```

Instance yang berjalan perlu di-restart sesudahnya (mis. `systemctl restart hanoman`).

## Bind & TLS

Default `127.0.0.1:8787`. hanoman punya auth, tapi cookie sesinya `Secure` — set
`--host 0.0.0.0` **hanya** di belakang reverse proxy yang menerminasi TLS.

## Pindah dari Postgres

Instalasi hanoman lama memakai Postgres. Pindahkan sekali:

```bash
hanoman migrate-from-postgres --from "postgresql://user:pass@host:5432/hanoman" --dry-run
hanoman migrate-from-postgres --from "postgresql://user:pass@host:5432/hanoman"
```
```

- [ ] **Step 7: Sambungkan script rilis**

`package.json` root — tambahkan:

```json
    "build:cli": "pnpm --filter ./cli build",
    "release": "pnpm build && pnpm build:cli && node cli/dist/hanoman.js __pack && (cd dist-npm && npm pack --dry-run)",
```

- [ ] **Step 8: Bukti nyata — rakit paketnya**

```bash
pnpm release 2>&1 | tail -25
ls dist-npm && du -sh dist-npm
node -e "const p=require('./dist-npm/package.json');console.log(p.name,p.version,Object.keys(p.dependencies).length)"
```

Expected: `pack · …/dist-npm · hanoman@0.1.0 · 7 artefak wajib ada`; `npm pack --dry-run` mencetak
daftar berkas tanpa error; `hanoman 0.1.0 9`.

- [ ] **Step 9: Bukti nyata — paket hasil rakitan benar-benar jalan**

```bash
cd /tmp && rm -rf hn-pack && mkdir hn-pack && cd hn-pack
npm pack /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-398/dist-npm 2>&1 | tail -2
npm i -g ./hanoman-0.1.0.tgz 2>&1 | tail -3
HANOMAN_HOME=/tmp/hn-pack/data hanoman doctor; echo "exit=$?"
HANOMAN_HOME=/tmp/hn-pack/data PORT=8898 timeout 30 hanoman --port 8898 &
sleep 14 && curl -sS -o /dev/null -w 'health=%{http_code}\n' http://127.0.0.1:8898/health \
  && curl -sS -o /dev/null -w 'spa=%{http_code}\n' http://127.0.0.1:8898/
npm rm -g hanoman
```

Expected: `health=200`, `spa=200`, `/tmp/hn-pack/data/hanoman.db` ada. Ini bukti utama objective
SPEC-398 — `npm i -g hanoman` lalu `hanoman` jalan tanpa Docker.

- [ ] **Step 10: Test yang tersentuh + typecheck**

Run: `pnpm vitest --run cli/test --no-file-parallelism && pnpm --filter ./cli typecheck`
Expected: hijau.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(spec-398): rakit paket npm hanoman (hanoman __pack + pnpm release)"
```

---

### Task 6: `hanoman migrate-from-postgres`

**Files:**
- Create: `cli/src/commands/migrate-pg.ts`
- Modify: `cli/src/router.ts`, `cli/package.json` (dep `pg`)
- Test: `cli/test/migrate-pg.test.ts`

**Interfaces:**
- Consumes: `resolveLayout`, `resolveDbUrl`, `dbFilePath`
- Produces: `PG_ORDER: readonly string[]` · `chunk<T>(xs: T[], n: number): T[][]` · `parseMigrateArgs(argv): MigrateOpts`

- [ ] **Step 1: Tulis test yang gagal — urutan FK dijaga DMMF, bukan komentar**

Create `cli/test/migrate-pg.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { PG_ORDER, chunk, parseMigrateArgs } from "../src/commands/migrate-pg";

const models = Prisma.dmmf.datamodel.models;

describe("PG_ORDER", () => {
  it("memuat setiap model Prisma tepat sekali", () => {
    expect([...PG_ORDER].sort()).toEqual(models.map((m) => m.name).sort());
    expect(new Set(PG_ORDER).size).toBe(PG_ORDER.length);
  });

  it("setiap model muncul SESUDAH induk relasinya (urutan FK sah)", () => {
    const at = new Map(PG_ORDER.map((n, i) => [n, i]));
    const problems: string[] = [];
    for (const m of models) {
      for (const f of m.fields) {
        // sisi yang memegang FK adalah yang punya relationFromFields terisi
        if (f.kind !== "object" || !f.relationFromFields?.length) continue;
        if (f.type === m.name) continue;                       // self-relation: dijamin oleh urutan baris
        if (at.get(m.name)! < at.get(f.type)!) problems.push(`${m.name}.${f.name} → ${f.type}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("chunk", () => {
  it("memotong sesuai ukuran, sisa ikut", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("kosong → kosong", () => {
    expect(chunk([], 3)).toEqual([]);
  });
});

describe("parseMigrateArgs", () => {
  it("--from wajib", () => {
    expect(() => parseMigrateArgs([])).toThrow(/--from/);
  });
  it("bentuk lengkap", () => {
    expect(parseMigrateArgs(["--from", "postgresql://x/db", "--to", "/t/a.db", "--dry-run", "--force"]))
      .toEqual({ from: "postgresql://x/db", to: "/t/a.db", dryRun: true, force: true });
  });
  it("--from harus URL postgres", () => {
    expect(() => parseMigrateArgs(["--from", "file:/x.db"])).toThrow(/postgres/);
  });
});
```

- [ ] **Step 2: Jalankan — harus gagal**

Run: `pnpm vitest --run cli/test/migrate-pg.test.ts`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: Tambah dependency `pg`**

`cli/package.json`: tambahkan `"pg": "^8.13.1"` ke `dependencies` dan `"@types/pg": "^8.11.10"` ke `devDependencies`.

Run: `pnpm install`
Expected: exit 0.

- [ ] **Step 4: Implementasi `cli/src/commands/migrate-pg.ts`**

```ts
// SPEC-398 · ADR-0086 · pindah sekali-jalan Postgres → SQLite. Dibutuhkan karena instance hanoman
// yang sudah hidup (termasuk hub produksi) menyimpan akun & tiket nyata di Postgres, dan cutover
// provider tanpa jalan pindah berarti membuang data orang.
//
// Skema hanoman tak memakai `@map` sama sekali, jadi nama kolom Postgres = nama field Prisma dan
// baris hasil `SELECT *` bisa langsung dipakai sebagai data `createMany`. Yang TIDAK boleh
// diserahkan pada nasib adalah URUTAN tabel: FK menolak anak yang datang sebelum induk. Karena itu
// PG_ORDER ditulis eksplisit dan diverifikasi test terhadap DMMF — model baru tanpa memperbarui
// urutan = test merah, bukan kegagalan runtime di mesin orang lain.
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { resolve as resolvePath } from "node:path";
import { resolveDbUrl, dbFilePath } from "@hanoman/runner";
import type { Ctx } from "../router";
import { resolveLayout } from "../layout";
import { distDir, applyMigrations } from "./start";

export const PG_ORDER = [
  "Project", "ProjectLink", "Spec", "Setting", "Notification",
  "User", "Session", "DeviceToken", "AgentToken",
  "Vps", "VpsAuditSnapshot", "VpsItemState",
  "SessionResult", "SessionHistory",
  "SyncLog", "LocalBinding", "SyncOutbox", "SyncState", "SyncConflict",
  "SchedulerQueueItem", "RuntimeConfig",
  "ErrorGroup", "ErrorEvent", "SourceMapArtifact",
  "Ticket", "TicketAttachment",
] as const;

const CHUNK = 200;

export function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export type MigrateOpts = { from: string; to: string | null; dryRun: boolean; force: boolean };

export function parseMigrateArgs(argv: string[]): MigrateOpts {
  const out: MigrateOpts = { from: "", to: null, dryRun: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--dry-run") { out.dryRun = true; continue; }
    if (a === "--force") { out.force = true; continue; }
    if (a === "--from" || a === "--to") {
      const v = argv[i + 1];
      if (!v || v.startsWith("--")) throw new Error(`${a} butuh nilai`);
      if (a === "--from") out.from = v; else out.to = v;
      i++; continue;
    }
    throw new Error(`argumen tak dikenal: ${a}`);
  }
  if (!out.from) throw new Error("--from <postgresql://…> wajib");
  if (!/^postgres(ql)?:\/\//.test(out.from)) throw new Error("--from harus URL postgres://…");
  return out;
}

export default async function migratePg(argv: string[], ctx: Ctx): Promise<number> {
  let opts: MigrateOpts;
  try { opts = parseMigrateArgs(argv); } catch (e) { ctx.stderr(`${(e as Error).message}\n`); return 2; }

  const layout = resolveLayout(distDir(), existsSync);
  const dbUrl = opts.to ? `file:${resolvePath(opts.to)}` : resolveDbUrl(ctx.env, dirname(layout.schema));
  const { Client } = await import("pg");
  const pg = new Client({ connectionString: opts.from });
  await pg.connect();

  // Client SQLite dibuat SESUDAH DATABASE_URL di-set — PrismaClient membacanya saat konstruksi.
  if (!opts.dryRun) applyMigrations(layout.schema, dbUrl);
  process.env.DATABASE_URL = dbUrl;
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient() as unknown as Record<string, { createMany(a: unknown): Promise<unknown>; count(): Promise<number>; deleteMany(): Promise<unknown> }>;
  const key = (m: string) => m.charAt(0).toLowerCase() + m.slice(1);

  try {
    const existing: string[] = [];
    for (const m of PG_ORDER) if (await db[key(m)]!.count() > 0) existing.push(m);
    if (existing.length && !opts.force && !opts.dryRun) {
      ctx.stderr(`target sudah berisi data (${existing.join(", ")}) — pakai --force untuk menimpa\n`);
      return 1;
    }
    if (existing.length && opts.force && !opts.dryRun) {
      for (const m of [...PG_ORDER].reverse()) await db[key(m)]!.deleteMany();
      ctx.stdout("target dikosongkan (--force)\n");
    }

    let total = 0;
    for (const model of PG_ORDER) {
      const { rows } = await pg.query(`SELECT * FROM "${model}"`);
      total += rows.length;
      if (rows.length && !opts.dryRun) {
        for (const part of chunk(rows, CHUNK)) await db[key(model)]!.createMany({ data: part });
      }
      ctx.stdout(`  ${opts.dryRun ? "akan pindah" : "pindah"} ${String(rows.length).padStart(6)} · ${model}\n`);
    }
    ctx.stdout(`${opts.dryRun ? "DRY RUN — tak ada yang ditulis. " : ""}${total} baris · ${dbFilePath(dbUrl)}\n`);
    return 0;
  } catch (e) {
    ctx.stderr(`migrasi gagal: ${(e as Error).message}\n`);
    return 1;
  } finally {
    await pg.end();
    await (db as unknown as { $disconnect(): Promise<void> }).$disconnect();
  }
}
```

`cli/src/router.ts` — tambahkan dispatch:

```ts
  if (group === "migrate-from-postgres") return (await import("./commands/migrate-pg")).default(argv.slice(1), ctx);
```

- [ ] **Step 5: Jalankan test — harus lulus**

Run: `pnpm vitest --run cli/test/migrate-pg.test.ts`
Expected: PASS. Bila test urutan FK merah, ia mencetak pasangan `Anak.field → Induk` yang salah
urut — pindahkan model itu ke posisi sesudah induknya di `PG_ORDER`, jangan melemahkan test-nya.

- [ ] **Step 6: Perbarui `RUNTIME_DEPS`/help & typecheck**

`pg` sudah ada di `RUNTIME_DEPS` (Task 5) dan `migrate-from-postgres` sudah ada di `HELP` (Task 3).
Tambahkan `--external:pg` ke build cli bila belum (Task 3 step 10 sudah memasukkannya).

Run: `pnpm --filter ./cli typecheck && pnpm vitest --run cli/test --no-file-parallelism`
Expected: hijau.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(spec-398): hanoman migrate-from-postgres — pindahkan data Postgres ke SQLite"
```

---

### Task 7: ADR-0086 & ADR-0087 + docs Source of Truth

**Files:**
- Create: `internal/docs/adr/0086-sqlite-satu-satunya-provider.md`
- Create: `internal/docs/adr/0087-distribusi-npm-global-satu-perintah.md`
- Modify: `internal/docs/README.md` (index ADR + operations)
- Modify: `internal/docs/adr/README.md` (narasi)
- Modify: `internal/docs/architecture/stack.md`, `internal/docs/architecture/data-model.md`
- Modify: `internal/docs/operations/production.md`, `internal/docs/operations/deploy-vps.md`
- Modify: `README.md`, `AGENTS.md`, `CLAUDE.md`
- Modify: `internal/skills/hanoman/SKILL.md`, `internal/skills/hanoman-devops/SKILL.md`

**Interfaces:** —

- [ ] **Step 1: Tulis ADR-0086 (SQLite satu-satunya provider)**

Isi wajib: konteks (Docker satu-satunya alasan Postgres ada; objective SPEC-398), keputusan
(provider `sqlite`, Prisma 6.19, DB di `~/.hanoman/hanoman.db`, `DATABASE_URL` non-`file:` melempar),
konsekuensi (33 migrasi PG diganti satu init; `mode:"insensitive"` dicabut — LIKE SQLite sudah
case-insensitive ASCII; DB test jadi berkas per checkout sehingga dua kelas gagal palsu hilang;
`hanoman migrate-from-postgres` wajib untuk instance lama), alternatif ditolak (embedded-postgres
±100 MB; dua provider berdampingan = dua set migrasi selamanya; "Postgres tanpa Docker" tetap ribet).
Sebutkan angka kelayakan terukur: nol raw SQL, nol `@db.`, nol scalar list, 14 kolom `Json`,
4 `mode:"insensitive"`.

- [ ] **Step 2: Tulis ADR-0087 (distribusi npm global, satu perintah, update dari registry)**

Isi wajib: keputusan (paket `hanoman` di npm publik; `hanoman` telanjang = `start`; staging
`dist-npm/` dirakit `hanoman __pack`, publish tetap manual; `prisma` CLI ikut jadi dependency
runtime demi `migrate deploy`; aset dashboard di `web/` dipilih `pickWebDir`; identitas versi pindah
dari SHA git ke semver, `services/update.ts` membaca registry npm dan **tetap read-only** sehingga
ADR-0048 utuh; `hanoman doctor` melaporkan prasyarat non-npm: git, tmux, CLI agen), konsekuensi
(±100 MB terpasang; update = `hanoman update` + restart supervisor; `HANOMAN_HOME` jadi akar data),
alternatif ditolak (`POST /api/update/apply` yang mematikan dirinya sendiri di tengah sesi tmux;
self-update git-checkout).

- [ ] **Step 3: Tautkan di kedua index**

`internal/docs/README.md` — di bagian `## adr`, tambahkan **di atas** baris 0085:

```markdown
- [0087 — Distribusi hanoman sebagai paket npm global: satu perintah `hanoman`, update dari registry](adr/0087-distribusi-npm-global-satu-perintah.md)
- [0086 — SQLite satu-satunya provider: DB embedded di `~/.hanoman`, Docker dicabut](adr/0086-sqlite-satu-satunya-provider.md)
```

Di bagian `## operations`, tambahkan:

```markdown
- [npm-readme](operations/npm-readme.md) — README yang terbit bersama paket npm `hanoman` (pasang, prasyarat, update, pindah dari Postgres)
```

`internal/docs/adr/README.md` — tambahkan narasi kedua ADR di posisi paling atas daftarnya,
sesuai gaya entri 0085 yang sudah ada (apa yang diperluas/dicabut + gotcha terukur).

- [ ] **Step 4: Perbarui stack.md & data-model.md**

`internal/docs/architecture/stack.md`:
- Baris tabel DB: `| DB | **SQLite (Prisma 6)** | embedded, nol proses eksternal; berkas di `~/.hanoman/hanoman.db` (ADR-0086) |`
- Tambah baris: `| Distribusi | **paket npm global `hanoman`** | `npm i -g hanoman` → `hanoman`; update `hanoman update` (ADR-0087) |`
- Di blok "Bentuk sistem", ganti `└─ Postgres (Prisma): …` menjadi `└─ SQLite (Prisma): …` dan
  tambahkan baris `├─ @fastify/static → web/ (aset dashboard di dalam paket, HANOMAN_WEB_DIR)`.
- Tambah paragraf: SQLite embedded + prasyarat non-npm (git/tmux/agen) + `hanoman doctor`.

`internal/docs/architecture/data-model.md`: perbarui penyebutan provider/Postgres/`hanoman_test`
menjadi SQLite + berkas `.test.db` yang dimigrasi otomatis `server/test/global-setup.ts`, dan
sebutkan `hanoman migrate-from-postgres` sebagai jalan pindah sekali-jalan.

- [ ] **Step 5: Perbarui runbook operasi**

`internal/docs/operations/production.md` — cara menjalankan instance prod jadi: `npm i -g hanoman`
+ `HANOMAN_HOME=/srv/hanoman-prod hanoman --port 8788` (DB & port terpisah lewat `HANOMAN_HOME`,
bukan database Postgres terpisah).

`internal/docs/operations/deploy-vps.md` — runbook deploy jadi berbasis npm:
`npm i -g hanoman@latest` → `hanoman migrate-from-postgres --from "$OLD_PG_URL" --dry-run` →
tanpa `--dry-run` → `systemctl restart hanoman`, dengan unit systemd yang men-set `HANOMAN_HOME`
dan menjalankan `hanoman`. Sertakan peringatan: `pg_dump` dulu sebelum migrasi, dan Postgres Docker
lama boleh dimatikan HANYA sesudah migrasi diverifikasi.

- [ ] **Step 6: Perbarui README + kontrak agent + skill**

`README.md` (root): tambahkan bagian "Pasang sebagai paket npm" di paling atas (tiga baris perintah),
dan ubah instruksi dev supaya tak menyebut `docker compose`.

`AGENTS.md` & `CLAUDE.md`: pada bagian test, ganti penyebutan Postgres bersama menjadi berkas SQLite
`.test.db` per checkout yang dimigrasi otomatis — **`--no-file-parallelism` tetap wajib** karena
test server masih berbagi satu berkas DB.

`internal/skills/hanoman/SKILL.md`: perbarui deskripsi frontmatter & "Aturan Arsitektur"/"Aturan Data
& Skema" (SQLite, distribusi npm, `hanoman start|doctor|update|migrate-from-postgres`, ADR-0086/0087).
`internal/skills/hanoman-devops/SKILL.md`: ganti langkah deploy Postgres/Docker menjadi alur npm.

- [ ] **Step 7: Verifikasi integritas index**

Run: `node cli/dist/hanoman.js docs index --check`
Expected: exit 0, tanpa laporan doc tak ter-link.

- [ ] **Step 8: Test yang tersentuh (terakhir, penuh untuk set berubah)**

Run: `pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism`
Expected: hijau. Bila `sync-ws.test.ts` merah, ulangi terisolasi dulu — ia terbukti
non-deterministik (SPEC-376), bukan indikasi regresi.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "docs(spec-398): ADR-0086 SQLite-only + ADR-0087 distribusi npm + runbook & skill"
```

---

## Self-Review

**Cakupan spec → task:** SQLite-only → Task 1 · `pickWebDir` → Task 2 · `hanoman start`/`doctor` +
`resolveLayout` → Task 3 · update semver dari registry + `hanoman update` → Task 4 · paket npm +
`dist-npm/` + README npm → Task 5 · `migrate-from-postgres` → Task 6 · ADR & docs → Task 7. Unit
`resolveHome`/`resolveDbUrl`/`dbFilePath` yang di tabel spec disebut `server/src/db-url.ts` **pindah
ke `runner/src/paths.ts`** karena CLI juga memakainya dan CLI tak boleh bergantung pada paket server;
`compareSemver` tetap di `shared`. `coerceRow()` yang disebut spec **dihapus** — baris `SELECT *`
dari Postgres sudah langsung cocok sebagai data `createMany` (skema tanpa `@map`), jadi menambah
lapisan koersi berarti kode spekulatif; yang benar-benar rapuh (urutan FK) dijaga test DMMF.

**Konsistensi tipe:** `Layout` (Task 3) dipakai Task 5 & 6 lewat `resolveLayout`. `distDir()` dan
`applyMigrations()` diekspor `commands/start.ts` dan diimpor `doctor.ts`, `pack.ts`, `migrate-pg.ts`.
`EnvLike` diekspor `runner/src/paths.ts` dan dipakai `server/src/web-dir.ts`. `currentVersion()`
diekspor `cli/src/router.ts` dan dipakai `commands/update.ts`. `UPDATE_COMMAND` di
`services/update.ts` sama dengan `INSTALL_ARGS` di CLI (`i -g hanoman@latest`) — keduanya bertest.

**Urutan wajib:** Task 1 harus lebih dulu (semua task lain menganggap SQLite). Task 3 sebelum 5 & 6
(keduanya memakai `resolveLayout`/`distDir`/`applyMigrations`). Task 5 sebelum bukti `npm i -g`.
