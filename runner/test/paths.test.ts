import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { resolveHome, resolveDbUrl, dbFilePath, prismaCliPath, dbUrlNotice } from "../src/paths";

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
  // `hanoman` dipasang GLOBAL dan mewarisi shell apa pun. `DATABASE_URL` adalah nama env var
  // paling umum yang ada (Rails/Django/Heroku/Prisma), jadi nilai non-`file:` di lingkungan
  // hampir selalu milik project ORANG LAIN — bukan Postgres hanoman yang minta dimigrasi.
  // Mematikan CLI karenanya membuat hanoman tak bisa dipakai di mesin mana pun yang punya var itu.
  it("DATABASE_URL Postgres dari lingkungan DIABAIKAN, bukan mematikan hanoman", () => {
    expect(resolveDbUrl({ DATABASE_URL: "postgresql://u:p@h:5432/other_app", HANOMAN_HOME: "/srv/hn" }, SCHEMA))
      .toBe("file:/srv/hn/hanoman.db");
  });
  it("HANOMAN_DATABASE_URL menang atas DATABASE_URL", () => {
    expect(resolveDbUrl({ HANOMAN_DATABASE_URL: "file:/data/a.db", DATABASE_URL: "file:/data/b.db" }, SCHEMA))
      .toBe("file:/data/a.db");
  });
  // Di knob milik hanoman sendiri, niatnya EKSPLISIT — di situ diam-diam jatuh ke default
  // memang berbahaya (semangat ADR-0086), jadi hard-fail dipertahankan justru di sini.
  it("HANOMAN_DATABASE_URL non-file: MELEMPAR dan menyebut tool migrasi", () => {
    expect(() => resolveDbUrl({ HANOMAN_DATABASE_URL: "postgresql://u:p@h:5432/hanoman" }, SCHEMA))
      .toThrow(/migrate-from-postgres/);
  });
});

describe("dbUrlNotice", () => {
  it("senyap saat tak ada yang diabaikan", () => {
    expect(dbUrlNotice({ HANOMAN_HOME: "/srv/hn" })).toBeNull();
    expect(dbUrlNotice({ DATABASE_URL: "file:/data/a.db" })).toBeNull();
    expect(dbUrlNotice({ HANOMAN_DATABASE_URL: "file:/data/a.db" })).toBeNull();
  });
  // Semangat ADR-0086 dijaga di sini: pengabaian tak boleh SENYAP, dan peringatannya harus
  // membawa jalan keluar untuk kedua kemungkinan (punya data PG / var milik project lain).
  it("memperingatkan saat DATABASE_URL non-file: diabaikan, menyebut jalan keluarnya", () => {
    const n = dbUrlNotice({ DATABASE_URL: "postgresql://u:p@h:5432/other_app" });
    expect(n).toMatch(/DATABASE_URL/);
    expect(n).toMatch(/diabaikan/i);
    expect(n).toMatch(/migrate-from-postgres/);
    expect(n).toMatch(/HANOMAN_DATABASE_URL/);
  });
  it("tak membocorkan kredensial di dalam URL", () => {
    const n = dbUrlNotice({ DATABASE_URL: "postgresql://user:s3cret@h:5432/db" });
    expect(n).not.toMatch(/s3cret/);
    expect(n).not.toMatch(/user/);
  });
  it("senyap bila HANOMAN_DATABASE_URL diisi — DATABASE_URL memang kalah, bukan diabaikan diam-diam", () => {
    expect(dbUrlNotice({ HANOMAN_DATABASE_URL: "file:/a.db", DATABASE_URL: "postgresql://x" })).toBeNull();
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

describe("prismaCliPath", () => {
  it("memakai subpath build/index.js yang di-ekspor resmi", () => {
    expect(prismaCliPath((s) => `/nm/${s}`)).toBe("/nm/prisma/build/index.js");
  });
  it("subpath diblokir → jatuh ke package.json lalu susun build/index.js", () => {
    expect(prismaCliPath((s) => {
      if (s !== "prisma/package.json") throw new Error("blocked by exports");
      return "/nm/prisma/package.json";
    })).toBe("/nm/prisma/build/index.js");
  });
  it("prisma tak terpasang → melempar", () => {
    expect(() => prismaCliPath(() => { throw new Error("nope"); })).toThrow(/prisma/);
  });
  it("resolusi NYATA menunjuk berkas yang ada (jaring pengaman peta exports prisma)", () => {
    const p = prismaCliPath(createRequire(import.meta.url).resolve);
    expect(existsSync(p)).toBe(true);
  });
});
