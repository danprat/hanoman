import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

const app = buildApp({ requireAuth: false });
const clean = async () => { await prisma.syncOutbox.deleteMany(); await prisma.vps.deleteMany(); };
beforeEach(clean); afterAll(clean);

describe("VPS SSH key gate (SPEC-213 AC-28)", () => {
  it("keyPath points to a missing file → 409 keyMissing", async () => {
    await prisma.vps.create({ data: { id: "v1", name: "v", host: "127.0.0.1", port: 2, user: "root", keyPath: "/no/such/key/file" } });
    const r = await app.inject({ method: "POST", url: "/api/vps/v1/audit" });
    expect(r.statusCode).toBe(409);
    expect(r.json().keyMissing).toBe(true);
  });

  it("keyPath present → gate passes (not 409/keyMissing; ssh may fail downstream)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hn-key-"));
    const keyFile = join(dir, "id_ed25519");
    writeFileSync(keyFile, "dummy");
    await prisma.vps.create({ data: { id: "v2", name: "v", host: "127.0.0.1", port: 2, user: "root", keyPath: keyFile } });
    const r = await app.inject({ method: "POST", url: "/api/vps/v2/audit" });
    expect(r.statusCode).not.toBe(409);
    expect(r.json().keyMissing).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });
});
