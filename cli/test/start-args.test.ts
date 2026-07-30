import { describe, it, expect } from "vitest";
import { parseStartArgs, migrateFailureHint } from "../src/commands/start";

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
  it("--host tanpa nilai → melempar, tak menelan flag berikutnya", () => {
    expect(() => parseStartArgs(["--host", "--no-migrate"])).toThrow(/--host/);
  });
  it("argumen tak dikenal → melempar", () => {
    expect(() => parseStartArgs(["--wat"])).toThrow(/--wat/);
  });
});

// SPEC-398 · Prisma membalas P3005 saat berkas DB sudah punya tabel tapi tak punya riwayat
// migrasi — terjadi nyata di `~/.hanoman/hanoman.db` milik prototipe hanoman lama (tabel
// `runs`/`meta`, nol baris). Pesan mentahnya menyuruh operator "baseline an existing production
// database", yang tak bisa ditindaklanjuti oleh orang yang baru `npm i -g hanoman`.
describe("migrateFailureHint", () => {
  const DB = "/Users/x/.hanoman/hanoman.db";

  it("P3005 → menjelaskan sebabnya dan memberi jalan keluar yang konkret", () => {
    const h = migrateFailureHint("Error: P3005\nThe database schema is not empty.", DB);
    expect(h).not.toBeNull();
    expect(h).toContain(DB);                    // sebut BERKAS mana yang bermasalah
    expect(h).toMatch(/bukan.*hanoman|prototipe|riwayat migrasi/i);
    expect(h).toMatch(/--db|HANOMAN_DATABASE_URL/); // cara memakai berkas lain
    expect(h).not.toMatch(/baseline/i);          // jangan teruskan jargon Prisma
  });

  it("kegagalan lain tidak dikarang-karang penjelasannya", () => {
    expect(migrateFailureHint("Error: P1001 can't reach database", DB)).toBeNull();
    expect(migrateFailureHint("", DB)).toBeNull();
  });
});
