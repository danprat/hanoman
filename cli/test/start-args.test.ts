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
  it("--host tanpa nilai → melempar, tak menelan flag berikutnya", () => {
    expect(() => parseStartArgs(["--host", "--no-migrate"])).toThrow(/--host/);
  });
  it("argumen tak dikenal → melempar", () => {
    expect(() => parseStartArgs(["--wat"])).toThrow(/--wat/);
  });
});
