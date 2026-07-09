import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { classifyVerify, retryOnCrash, resolveCliEntry, guardEnv } from "../src/runner/deps";

describe("resolveCliEntry (SPEC-010) — cwd-independent CLI path", () => {
  // RUN-8801: the dev worker runs from `server/`, so a cwd-relative path pointed at the
  // non-existent `server/cli/dist/hanoman.js`. Resolving from any nested start dir must
  // land on the repo-root CLI regardless.
  const repoRoot = join(__dirname, "..", "..");
  it("finds the repo-root CLI from a nested server/ start dir", () => {
    const fromServer = resolveCliEntry(join(repoRoot, "server", "src", "runner"));
    expect(fromServer).toBe(join(repoRoot, "cli", "dist", "hanoman.js"));
  });
  it("resolves to the same path from the repo root", () => {
    expect(resolveCliEntry(repoRoot)).toBe(join(repoRoot, "cli", "dist", "hanoman.js"));
  });
  it("the anchored root actually contains the workspace marker", () => {
    expect(existsSync(join(repoRoot, "pnpm-workspace.yaml"))).toBe(true);
  });
});

describe("guardEnv — switch guardrail dashboard turun ke subprocess verify", () => {
  it("guardrail on: no coverage override, both switches on", () => {
    const e = guardEnv({ requireLinks: true, blockStale: true });
    expect(e.HANOMAN_REQUIRE_LINKS).toBe("true");
    expect(e.HANOMAN_BLOCK_STALE).toBe("true");
    expect(e.HANOMAN_COVERAGE_THRESHOLD).toBeUndefined();
  });
  // Tanpa ambang 0, mematikan "wajib link" hanya menukar violation `unlinked` jadi `coverage`
  // — run tetap diblok, persis keluhan yang memicu perbaikan ini.
  it("requireLinks off also drops the coverage threshold to 0", () => {
    const e = guardEnv({ requireLinks: false, blockStale: false });
    expect(e.HANOMAN_REQUIRE_LINKS).toBe("false");
    expect(e.HANOMAN_COVERAGE_THRESHOLD).toBe("0");
  });
});

describe("classifyVerify (SPEC-010, pure)", () => {
  it("exit 0 -> not blocked", () =>
    expect(classifyVerify({ status: 0, stdout: '{"ok":true,"violations":[]}', stderr: "" }))
      .toEqual({ blocked: false }));

  it("exit != 0 with valid violations JSON -> blocked with joined reasons", () =>
    expect(classifyVerify({ status: 1, stdout: '{"ok":false,"violations":[{"reason":"a"},{"reason":"b"}]}', stderr: "" }))
      .toEqual({ blocked: true, reason: "a; b" }));

  it("exit != 0 with non-JSON stdout -> tool crash (error set, still blocked)", () => {
    const r = classifyVerify({ status: 1, stdout: "Cannot find module\n", stderr: "stack trace here" });
    expect(r.blocked).toBe(true);
    expect(r.error).toBe("stack trace here");
    expect(r.reason).toBeUndefined();
  });

  it("crash with empty stderr falls back to stdout then exit code", () => {
    expect(classifyVerify({ status: 7, stdout: "", stderr: "" }).error).toBe("exit 7");
  });
});

describe("retryOnCrash (SPEC-010, pure)", () => {
  it("returns first result when it is not a crash (runs once)", () => {
    let n = 0;
    const out = retryOnCrash(() => { n++; return { blocked: false }; });
    expect(out).toEqual({ blocked: false });
    expect(n).toBe(1);
  });

  it("retries once and returns the second result when the first is a crash", () => {
    const results = [{ blocked: true, error: "boom" }, { blocked: false }];
    let n = 0;
    const out = retryOnCrash(() => results[n++]!);
    expect(out).toEqual({ blocked: false });
    expect(n).toBe(2);
  });

  it("returns the crash when both attempts crash", () => {
    let n = 0;
    const out = retryOnCrash(() => { n++; return { blocked: true, error: "still broken" }; });
    expect(out).toEqual({ blocked: true, error: "still broken" });
    expect(n).toBe(2);
  });
});
