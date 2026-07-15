import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

// Mock ws agar connectWs tak membuka socket nyata (hindari reconnect timer bocor di test).
vi.mock("ws", () => {
  class FakeWS { readyState = 0; on() { /* noop */ } close() { /* noop */ } }
  return { WebSocket: FakeWS, default: { WebSocket: FakeWS } };
});

import { prisma } from "../src/db";
import * as cfg from "../src/config";
import { syncStatus, stopSyncClient } from "../src/services/sync-client";
import { applyConfigSideEffect } from "../src/services/config-apply";

const clean = async () => { await prisma.runtimeConfig.deleteMany(); };
beforeEach(async () => { await clean(); await cfg.loadConfig(); });
afterAll(async () => { await clean(); stopSyncClient(); });

describe("config side-effects (SPEC-215)", () => {
  it("set SYNC_SERVER_URL+token → sync client running; clear → stop", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ records: [], cursor: "0" }), status: 200 }));
    await cfg.setConfig("SYNC_SERVER_URL", "http://127.0.0.1:9"); await applyConfigSideEffect("SYNC_SERVER_URL");
    await cfg.setConfig("SYNC_DEVICE_TOKEN", "tok"); await applyConfigSideEffect("SYNC_DEVICE_TOKEN");
    expect(syncStatus().running).toBe(true);
    await cfg.clearConfig("SYNC_SERVER_URL"); await applyConfigSideEffect("SYNC_SERVER_URL");
    expect(syncStatus().running).toBe(false);
    vi.unstubAllGlobals();
  });
  it("kredensial inheritEnv di-mirror ke process.env", async () => {
    await cfg.setConfig("ANTHROPIC_API_KEY", "sk-test"); await applyConfigSideEffect("ANTHROPIC_API_KEY");
    expect(process.env.ANTHROPIC_API_KEY).toBe("sk-test");
    await cfg.clearConfig("ANTHROPIC_API_KEY"); await applyConfigSideEffect("ANTHROPIC_API_KEY");
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});
