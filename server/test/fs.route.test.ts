import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { buildApp } from "../src/app";

const app = buildApp({ requireAuth: false });
let base = "";
beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "hanoman-fs-"));
  await mkdir(join(base, "my-repo"));
  await mkdir(join(base, ".hidden"));
});
afterAll(async () => { await rm(base, { recursive: true, force: true }); });

describe("fs browse route", () => {
  it("lists sub-directories with absolute paths, hides dotfiles", async () => {
    const res = await app.inject({ url: `/api/fs/browse?path=${encodeURIComponent(base)}` });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.path).toBe(base);
    expect(b.entries.map((e: { name: string }) => e.name)).toEqual(["my-repo"]);
    expect(b.entries[0].path).toBe(join(base, "my-repo"));
    expect(b.parent).toBe(dirname(base));
  });
  it("defaults to home dir when no path given", async () => {
    const res = await app.inject({ url: "/api/fs/browse" });
    expect(res.statusCode).toBe(200);
    expect(res.json().path).toBe(homedir());
  });
  it("400s on an unreadable path", async () => {
    const res = await app.inject({ url: `/api/fs/browse?path=${encodeURIComponent(join(base, "nope"))}` });
    expect(res.statusCode).toBe(400);
  });
});
