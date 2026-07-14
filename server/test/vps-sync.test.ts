import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { listOutbox } from "../src/services/outbox";
import { snapshot, applyPush } from "../src/services/sync";

const app = buildApp({ requireAuth: false });
const clean = async () => { await prisma.syncOutbox.deleteMany(); await prisma.vps.deleteMany(); };
beforeEach(clean); afterAll(clean);

describe("Vps sync (SPEC-213 AC-26/29)", () => {
  it("create/patch vps enqueues outbox(vps)", async () => {
    const created = await app.inject({ method: "POST", url: "/api/vps", payload: { name: "v", host: "1.2.3.4", user: "root", keyPath: "/k" } });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect((await listOutbox()).find((o) => o.entity === "vps" && o.recordId === id)).toBeTruthy();

    await prisma.syncOutbox.deleteMany();
    await app.inject({ method: "PATCH", url: `/api/vps/${id}`, payload: { name: "v2" } });
    expect((await listOutbox()).find((o) => o.entity === "vps" && o.recordId === id)).toBeTruthy();
  });

  it("snapshot vps never exposes keyPath; applyPush advances version (AC-29)", async () => {
    await prisma.vps.create({ data: { id: "v1", name: "v", host: "h", user: "u", keyPath: "/secret/key" } });
    const snap = await snapshot("vps", "v1");
    expect(snap?.data).not.toHaveProperty("keyPath");
    const r = await applyPush("vps", "v1", 0, { name: "v", host: "h", user: "u", port: 22, hardened: true });
    expect(r).toMatchObject({ ok: true, version: 1 });
  });
});
