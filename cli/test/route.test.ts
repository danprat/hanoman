import { describe, it, expect } from "vitest";
import { route } from "../src/router";

describe("route", () => {
  it("tanpa argumen → start", () => {
    expect(route([])).toEqual({ cmd: "start", args: [] });
  });
  it("`start` eksplisit meneruskan flag-nya", () => {
    expect(route(["start", "--port", "9000"])).toEqual({ cmd: "start", args: ["--port", "9000"] });
  });
  // Regresi: `hanoman --port 8899` sempat jatuh ke "unknown command" karena hanya argv KOSONG
  // yang dianggap start. Bentuk telanjang-ber-flag itu justru cara paling wajar memanggilnya.
  it("flag telanjang tanpa subcommand → start, flag utuh", () => {
    expect(route(["--port", "8899"])).toEqual({ cmd: "start", args: ["--port", "8899"] });
    expect(route(["--no-migrate"])).toEqual({ cmd: "start", args: ["--no-migrate"] });
  });
  it("--version dan --help ditangani sebelum routing", () => {
    expect(route(["--version"])).toEqual({ cmd: "version", args: [] });
    expect(route(["--help"])).toEqual({ cmd: "help", args: [] });
    expect(route(["start", "--help"])).toEqual({ cmd: "help", args: [] });
  });
  it("doctor", () => {
    expect(route(["doctor"])).toEqual({ cmd: "doctor", args: [] });
  });
  it("update meneruskan --check", () => {
    expect(route(["update", "--check"])).toEqual({ cmd: "update", args: ["--check"] });
  });
  it("docs bertingkat dua kata", () => {
    expect(route(["docs", "scan", "--json"])).toEqual({ cmd: "docs:scan", args: ["--json"] });
    expect(route(["docs", "index", "--check"])).toEqual({ cmd: "docs:index", args: ["--check"] });
    expect(route(["docs", "link", "a.md"])).toEqual({ cmd: "docs:link", args: ["a.md"] });
  });
  it("migrate-from-postgres meneruskan flag-nya", () => {
    expect(route(["migrate-from-postgres", "--from", "postgres://x/db", "--dry-run"]))
      .toEqual({ cmd: "migrate-pg", args: ["--from", "postgres://x/db", "--dry-run"] });
  });
  it("__pack tersembunyi tapi ter-route (perintah rilis dev)", () => {
    expect(route(["__pack", "--out", "tmp"])).toEqual({ cmd: "__pack", args: ["--out", "tmp"] });
  });
  it("SPEC-482 · mcp adalah perintahnya sendiri, bukan start ber-flag", () => {
    expect(route(["mcp"]).cmd).toBe("mcp");
    expect(route(["mcp", "--read-only"]).cmd).toBe("mcp");
  });
  it("perintah tak dikenal", () => {
    expect(route(["wat"])).toEqual({ cmd: "unknown", args: ["wat"] });
    expect(route(["docs", "wat"])).toEqual({ cmd: "unknown", args: ["docs", "wat"] });
  });
});
