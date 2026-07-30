import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { resolveHome, resolveDbUrl, dbFilePath, prismaCliPath } from "../src/paths";

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
