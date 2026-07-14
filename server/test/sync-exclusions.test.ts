import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { SYNCED, isEntity, snapshot } from "../src/services/sync";
import { listOutbox } from "../src/services/outbox";

const app = buildApp({ requireAuth: false });
const clean = async () => { await prisma.syncOutbox.deleteMany(); };
beforeEach(clean); afterAll(clean);

describe("sync exclusions — preferensi lokal tak tersync (SPEC-213 AC-30)", () => {
  it("SYNCED excludes settings/notification/deviceToken/localBinding", () => {
    for (const e of ["setting", "notification", "deviceToken", "localBinding", "session", "user", "syncOutbox"]) {
      expect(SYNCED as readonly string[]).not.toContain(e);
      expect(isEntity(e)).toBe(false);
    }
  });

  it("SYNCED is exactly the four authoritative entities", () => {
    expect([...SYNCED].sort()).toEqual(["project", "sessionResult", "spec", "vps"]);
  });

  it("mutating settings does NOT enqueue outbox (settings are per-device)", async () => {
    // baca lalu tulis kembali settings via route yang ada
    const get = await app.inject({ method: "GET", url: "/api/settings" });
    expect(get.statusCode).toBe(200);
    const put = await app.inject({ method: "PUT", url: "/api/settings", payload: get.json() });
    expect([200, 204]).toContain(put.statusCode);
    expect(await listOutbox()).toHaveLength(0);
  });

  it("snapshot of an unknown/local-only entity is null (guarded)", async () => {
    // @ts-expect-error — sengaja entity tak dikenal
    expect(await snapshot("setting", "1").catch(() => null)).toBeNull();
  });
});
