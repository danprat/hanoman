import { describe, it, expect } from "vitest";
import { SteerQueue } from "../src/steer-queue";
describe("SteerQueue", () => {
  it("drains pushed messages in order and empties itself", () => {
    const q = new SteerQueue();
    q.push("a"); q.push("b");
    expect(q.drain()).toEqual(["a", "b"]);
    expect(q.drain()).toEqual([]);
  });

  it("next() menunggu push berikutnya", async () => {
    const q = new SteerQueue();
    const p = q.next();
    q.push("jawab");
    await expect(p).resolves.toBe("jawab");
  });

  // Balapan yang membuat fitur ini benar: jawaban tiba SEBELUM ada yang menunggu.
  it("next() langsung selesai kalau pesannya sudah lebih dulu masuk buffer", async () => {
    const q = new SteerQueue();
    q.push("duluan");
    await expect(q.next()).resolves.toBe("duluan");
  });

  it("pesan yang diambil next() tidak ikut ter-drain lagi", async () => {
    const q = new SteerQueue();
    q.push("a");
    await q.next();
    expect(q.drain()).toEqual([]);
  });

  it("dua penunggu dilayani sesuai urutan datang", async () => {
    const q = new SteerQueue();
    const first = q.next(); const second = q.next();
    q.push("1"); q.push("2");
    await expect(first).resolves.toBe("1");
    await expect(second).resolves.toBe("2");
  });
});
