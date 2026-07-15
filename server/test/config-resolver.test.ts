import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import * as cfg from "../src/config";

const clean = async () => { await prisma.runtimeConfig.deleteMany(); };
beforeEach(async () => { await clean(); delete process.env.SYNC_TICK_MS; await cfg.loadConfig(); });
afterAll(clean);

describe("config resolver (DB → env → default)", () => {
  it("default registry saat DB & env kosong", () => {
    expect(cfg.effectiveInt("SYNC_TICK_MS")).toBe(15000);
    expect(cfg.sourceOf("SYNC_TICK_MS")).toBe("default");
  });
  it("env menang atas default; source=env", () => {
    process.env.SYNC_TICK_MS = "9000";
    expect(cfg.effectiveInt("SYNC_TICK_MS")).toBe(9000);
    expect(cfg.sourceOf("SYNC_TICK_MS")).toBe("env");
    delete process.env.SYNC_TICK_MS;
  });
  it("DB menang atas env; source=db", async () => {
    process.env.SYNC_TICK_MS = "9000";
    await cfg.setConfig("SYNC_TICK_MS", "3000");
    expect(cfg.effectiveInt("SYNC_TICK_MS")).toBe(3000);
    expect(cfg.sourceOf("SYNC_TICK_MS")).toBe("db");
    await cfg.clearConfig("SYNC_TICK_MS");
    expect(cfg.effectiveInt("SYNC_TICK_MS")).toBe(9000); // balik ke env
    delete process.env.SYNC_TICK_MS;
  });
  it("effectiveBool", async () => {
    expect(cfg.effectiveBool("HANOMAN_UPDATE_FETCH")).toBe(true); // default "1"
    await cfg.setConfig("HANOMAN_UPDATE_FETCH", "0");
    expect(cfg.effectiveBool("HANOMAN_UPDATE_FETCH")).toBe(false);
  });
  it("effectiveStr tanpa default → undefined", () => {
    expect(cfg.effectiveStr("SYNC_SERVER_URL")).toBeUndefined();
  });
});
