import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { hashKey } from "../src/services/ingest-key";
import { __resetBuckets } from "../src/services/error-ingest";

// SPEC-276 · ADR-0070 · upload source-map + symbolication end-to-end.
const app = buildApp({ requireAuth: false });
const KEY = "hnm_ing_" + "b".repeat(48);

// Source-map minimal: generated (line 1, col 10) → src/app.ts (line 2), name handleClick. mappings "UACAA".
const rawMap = JSON.stringify({
  version: 3,
  sources: ["src/app.ts"],
  sourcesContent: ["const a = 1;\nfunction handleClick() { throw new Error('x'); }\nconst b = 2;\n"],
  names: ["handleClick"],
  mappings: "UACAA",
});

const clean = async () => {
  await prisma.sourceMapArtifact.deleteMany();
  await prisma.errorEvent.deleteMany();
  await prisma.errorGroup.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "p1", name: "P", desc: "", kind: "existing", ingestKeyHash: hashKey(KEY), ingestKeyPrefix: KEY.slice(0, 16) } });
  __resetBuckets();
});
afterAll(clean);

describe("POST /api/ingest/:slug/sourcemaps", () => {
  it("stores uploaded source-map (202) with valid DSN", async () => {
    const r = await app.inject({ method: "POST", url: "/api/ingest/p1/sourcemaps?key=" + KEY,
      payload: { release: "1.0.0", artifacts: [{ filename: "index-4f3a2b.js", map: rawMap }] } });
    expect(r.statusCode).toBe(202);
    expect(r.json()).toMatchObject({ ok: true, stored: 1 });
    expect(await prisma.sourceMapArtifact.count()).toBe(1);
  });
  it("401 on wrong key", async () => {
    const r = await app.inject({ method: "POST", url: "/api/ingest/p1/sourcemaps?key=bad",
      payload: { release: "1.0.0", artifacts: [{ filename: "a.js", map: "{}" }] } });
    expect(r.statusCode).toBe(401);
  });
  it("400 on invalid payload (missing release)", async () => {
    const r = await app.inject({ method: "POST", url: "/api/ingest/p1/sourcemaps?key=" + KEY,
      payload: { artifacts: [{ filename: "a.js", map: "{}" }] } });
    expect(r.statusCode).toBe(400);
  });
  it("OPTIONS preflight 204 with CORS", async () => {
    const r = await app.inject({ method: "OPTIONS", url: "/api/ingest/p1/sourcemaps" });
    expect(r.statusCode).toBe(204);
    expect(r.headers["access-control-allow-origin"]).toBe("*");
  });
});

describe("symbolication end-to-end", () => {
  it("GET /errors/:id returns symbolicated sampleFrames + release", async () => {
    // 1) ingest error dengan frame terstruktur + release
    const ingest = await app.inject({ method: "POST", url: "/api/ingest/p1?key=" + KEY, payload: {
      type: "TypeError", message: "boom", environment: "production", release: "1.0.0",
      frames: [{ function: "t", filename: "https://h/assets/index-4f3a2b.js", lineno: 1, colno: 11, in_app: true }],
    } });
    expect(ingest.statusCode).toBe(202);
    const groupId = ingest.json().groupId as string;

    // 2) upload source-map untuk release itu
    const up = await app.inject({ method: "POST", url: "/api/ingest/p1/sourcemaps?key=" + KEY,
      payload: { release: "1.0.0", artifacts: [{ filename: "index-4f3a2b.js", map: rawMap }] } });
    expect(up.statusCode).toBe(202);

    // 3) detail grup → frame tersimbolikasi ke sumber
    const detail = await app.inject({ method: "GET", url: "/api/errors/" + groupId });
    expect(detail.statusCode).toBe(200);
    const body = detail.json();
    expect(body.release).toBe("1.0.0");
    expect(Array.isArray(body.sampleFrames)).toBe(true);
    expect(body.sampleFrames[0].symbolicated).toBe(true);
    expect(body.sampleFrames[0].source).toBe("src/app.ts");
    expect(body.sampleFrames[0].sourceLine).toBe(2);
    expect(body.sampleFrames[0].function).toBe("handleClick");
    expect(body.sampleFrames[0].contextLine).toContain("handleClick");
  });

  it("GET /errors list surfaces release", async () => {
    await app.inject({ method: "POST", url: "/api/ingest/p1?key=" + KEY, payload: {
      type: "E", message: "m", environment: "production", release: "2.3.4",
    } });
    const list = await app.inject({ method: "GET", url: "/api/errors?project=p1" });
    expect(list.json().items[0].release).toBe("2.3.4");
  });

  it("no map yet → sampleFrames present but symbolicated false (raw)", async () => {
    const ingest = await app.inject({ method: "POST", url: "/api/ingest/p1?key=" + KEY, payload: {
      type: "E", message: "m", environment: "production", release: "9.9.9",
      frames: [{ function: "t", filename: "index-nomap.js", lineno: 1, colno: 2 }],
    } });
    const groupId = ingest.json().groupId as string;
    const detail = await app.inject({ method: "GET", url: "/api/errors/" + groupId });
    expect(detail.json().sampleFrames[0].symbolicated).toBe(false);
    expect(detail.json().sampleFrames[0].filename).toBe("index-nomap.js");
  });
});
