// SPEC-398 · ADR-0086 · resolusi lokasi data hanoman. Dipakai server (db.ts, vitest.config)
// DAN cli (`hanoman start`, `migrate-from-postgres`) — karena itu ia hidup di runner, satu-satunya
// library node-only yang kedua paket sudah bergantung padanya (`shared` ikut dibundel Vite ke
// browser, jadi ia tak boleh menyentuh `node:os`/`node:path`).
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

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

/**
 * Path entry CLI prisma (`build/index.js`), dipanggil dengan `node <path> migrate deploy`.
 *
 * GOTCHA terukur di prisma 6.19: `require.resolve("prisma")` **tidak** memberi CLI-nya. Peta
 * `exports` paket itu memetakan `"."` ke `./build/types.js` — berkas yang TIDAK ADA di tarball —
 * sehingga resolusi bare-specifier gagal `MODULE_NOT_FOUND` alih-alih memberi `build/index.js`.
 * Yang di-ekspor resmi adalah subpath `./build/index.js` dan `./package.json`; keduanya dicoba di
 * sini supaya perubahan peta exports di versi berikutnya tak langsung mematikan `hanoman start`.
 */
export function prismaCliPath(resolver: (spec: string) => string): string {
  for (const spec of ["prisma/build/index.js", "prisma/package.json"]) {
    try {
      const p = resolver(spec);
      return spec.endsWith("package.json") ? join(dirname(p), "build", "index.js") : p;
    } catch { /* coba kandidat berikutnya */ }
  }
  throw new Error("CLI prisma tak ditemukan — `prisma` wajib terpasang sebagai dependency");
}
