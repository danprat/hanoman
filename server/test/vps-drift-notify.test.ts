import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { resetDb, makeVps } from "./factory";
import { recordDrift } from "../src/services/notifications";

beforeAll(async () => { await resetDb(); });
beforeEach(async () => { await prisma.notification.deleteMany(); });

describe("recordDrift (SPEC-221 AC-19)", () => {
  it("buat 1 notif agregat type drift, dedup per snapshot", async () => {
    const v = await makeVps({ name: "d1", host: "198.51.100.201" });
    const drift = [{ itemId: "ssh-b3", from: "pass", to: "fail" }];
    await recordDrift(v.id, "d1", drift, "snap1");
    await recordDrift(v.id, "d1", drift, "snap1"); // ulang snapshot sama → tak dobel
    const n = await prisma.notification.findMany({ where: { type: "drift" } });
    expect(n.length).toBe(1);
    expect(n[0]!.title).toContain("d1");
    expect(n[0]!.title).toContain("ssh-b3");
    expect(n[0]!.key).toBe(`drift:${v.id}:snap1`);
  });

  it("drift kosong → tak buat notif", async () => {
    const v = await makeVps({ name: "d2", host: "198.51.100.202" });
    await recordDrift(v.id, "d2", [], "snap2");
    expect(await prisma.notification.count({ where: { type: "drift" } })).toBe(0);
  });

  it("banyak item → judul ringkas (maks 5 + sisanya)", async () => {
    const v = await makeVps({ name: "d3", host: "198.51.100.203" });
    const drift = ["a", "b", "c", "d", "e", "f", "g"].map((id) => ({ itemId: id, from: "pass", to: "fail" }));
    await recordDrift(v.id, "d3", drift, "snap3");
    const n = await prisma.notification.findFirst({ where: { key: `drift:${v.id}:snap3` } });
    expect(n!.title).toContain("7 item");
    expect(n!.title).toContain("+2 lagi");
  });
});
