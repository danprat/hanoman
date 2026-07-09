import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// `bullConnection` dulu hanya memungut host+port dari REDIS_URL. Index db-nya dibuang,
// jadi BullMQ selalu memakai db 0 — antrean worker dev. Sebuah test yang enqueue
// (POST /runs, `resume` di terminal) menyerahkan run NYATA ke worker itu: worktree
// dibuat, `claude` di-spawn. Dua invarian di bawah yang menahannya.
describe("redis connection", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllEnvs());

  it("carries the db index from REDIS_URL into the BullMQ connection", async () => {
    vi.stubEnv("REDIS_URL", "redis://localhost:6379/3");
    const { bullConnection } = await import("../src/redis");
    expect(bullConnection).toMatchObject({ host: "localhost", port: 6379, db: 3 });
  });

  it("defaults to db 0 when the url carries no index", async () => {
    vi.stubEnv("NODE_ENV", "production");            // the db-0 guard is test-only
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
    const { bullConnection } = await import("../src/redis");
    expect(bullConnection.db).toBe(0);
  });

  it("refuses to let a test process point BullMQ at the dev queue (db 0)", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
    await expect(import("../src/redis")).rejects.toThrow(/db 0/);
  });

  // Yang sebenarnya berlaku saat suite ini jalan: vitest.config.ts sudah menggeser
  // REDIS_URL ke db lain, jadi tidak ada job test yang bisa mendarat di antrean dev.
  it("the live test env is isolated from the dev queue", async () => {
    const { bullConnection } = await import("../src/redis");
    expect(bullConnection.db).not.toBe(0);
  });
});
