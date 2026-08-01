import { describe, it, expect } from "vitest";
import { currentActor, withActor, actorFromRequest } from "../src/services/webhooks/actor";

describe("currentActor", () => {
  it("default `system` di luar konteks mana pun", () => {
    expect(currentActor().kind).toBe("system");
  });

  it("withActor berlaku di dalam saja, tak bocor keluar", async () => {
    const inside = await withActor({ kind: "lead", id: null, label: "hanoman-lead" },
      async () => currentActor());
    expect(inside.kind).toBe("lead");
    expect(currentActor().kind).toBe("system");
  });

  it("withActor bersarang: yang terdalam menang, yang luar pulih", async () => {
    await withActor({ kind: "lead", id: null, label: "lead" }, async () => {
      const deep = await withActor({ kind: "scheduler", id: null, label: "scheduler" },
        async () => currentActor());
      expect(deep.kind).toBe("scheduler");
      expect(currentActor().kind).toBe("lead");
    });
  });

  it("konteks selamat melewati await (inti ALS)", async () => {
    await withActor({ kind: "lead", id: null, label: "lead" }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      expect(currentActor().kind).toBe("lead");
    });
  });
});

describe("actorFromRequest", () => {
  it("cookie sesi → user, berlabel email", () => {
    const a = actorFromRequest({ user: { id: "u1", email: "dena@nafanesia.id" } });
    expect(a).toEqual({ kind: "user", id: "u1", label: "dena@nafanesia.id" });
  });
  it("agent token → agent, berlabel nama token (BUKAN tokennya)", () => {
    const a = actorFromRequest({ agent: { id: "a1", name: "ci-bot" } });
    expect(a).toEqual({ kind: "agent", id: "a1", label: "ci-bot" });
  });
  it("agent tanpa nama (bentuk nyata req.agent) jatuh ke id, bukan undefined", () => {
    expect(actorFromRequest({ agent: { id: "a1" } }))
      .toEqual({ kind: "agent", id: "a1", label: "a1" });
  });
  it("tanpa keduanya → system", () => {
    expect(actorFromRequest({}).kind).toBe("system");
  });
});
