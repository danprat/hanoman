import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

const app = buildApp();
const clean = async () => {
  await prisma.sessionResult.deleteMany();
  await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(clean); afterAll(clean);

const cookieOf = (r: { headers: Record<string, unknown> }) => (r.headers["set-cookie"] as string).split(";")[0];
async function login() {
  return cookieOf(await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "a@b.co", password: "password1" } }));
}

describe("session-results routes (SPEC-213 AC-22)", () => {
  it("401 without cookie", async () => {
    expect((await app.inject({ method: "GET", url: "/api/session-results" })).statusCode).toBe(401);
  });

  it("GET filters by project; DELETE purges by before, keeps newer (append-only + purge manual)", async () => {
    const cookie = await login();
    const old = new Date("2026-01-01T00:00:00Z");
    const recent = new Date("2026-07-14T00:00:00Z");
    await prisma.sessionResult.createMany({ data: [
      { id: "r1", projectId: "p1", status: "done", createdAt: old },
      { id: "r2", projectId: "p1", status: "done", createdAt: old },
      { id: "r3", projectId: "p1", status: "done", createdAt: recent },
      { id: "r4", projectId: "p2", status: "done", createdAt: recent },
    ] });

    const list = await app.inject({ method: "GET", url: "/api/session-results?projectId=p1", headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().map((r: { id: string }) => r.id).sort()).toEqual(["r1", "r2", "r3"]);

    const purge = await app.inject({ method: "DELETE", url: "/api/session-results?projectId=p1&before=2026-06-01T00:00:00Z", headers: { cookie } });
    expect(purge.statusCode).toBe(200);
    expect(purge.json()).toMatchObject({ purged: 2 });

    const after = await app.inject({ method: "GET", url: "/api/session-results?projectId=p1", headers: { cookie } });
    expect(after.json().map((r: { id: string }) => r.id)).toEqual(["r3"]); // hanya yang lebih baru tersisa
    // p2 tak tersentuh
    expect((await app.inject({ method: "GET", url: "/api/session-results?projectId=p2", headers: { cookie } })).json()).toHaveLength(1);
  });
});
