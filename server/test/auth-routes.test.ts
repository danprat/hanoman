import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

// Gate aktif (requireAuth default true) untuk menguji 401/alur nyata.
const app = buildApp();
const clean = async () => { await prisma.session.deleteMany(); await prisma.user.deleteMany(); };
beforeEach(clean);
// Bersihkan setelah suite ini supaya file test lain (yang mem-build tanpa auth) mulai bersih.
afterAll(clean);

const cookieOf = (r: { headers: Record<string, unknown> }) =>
  (r.headers["set-cookie"] as string).split(";")[0];

describe("auth routes", () => {
  it("full flow: setup → login → invite → change-password → delete → logout", async () => {
    // status → needsSetup
    let r = await app.inject({ method: "GET", url: "/api/auth/status" });
    expect(r.json()).toMatchObject({ needsSetup: true, user: null });

    // protected route tanpa sesi → 401
    expect((await app.inject({ method: "GET", url: "/api/projects" })).statusCode).toBe(401);

    // setup user pertama
    r = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "a@b.co", password: "password1" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().user).toMatchObject({ email: "a@b.co" });
    expect(r.json().user).not.toHaveProperty("passwordHash");
    const c1 = cookieOf(r);

    // setup kedua → 409
    expect((await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "x@y.co", password: "password1" } })).statusCode).toBe(409);

    // protected route dengan cookie → 200
    expect((await app.inject({ method: "GET", url: "/api/projects", headers: { cookie: c1 } })).statusCode).toBe(200);

    // status dengan cookie → user terisi
    expect((await app.inject({ method: "GET", url: "/api/auth/status", headers: { cookie: c1 } })).json().user).toMatchObject({ email: "a@b.co" });

    // login salah → 401, benar → 200 + cookie
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "a@b.co", password: "nope" } })).statusCode).toBe(401);
    r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "a@b.co", password: "password1" } });
    expect(r.statusCode).toBe(200);

    // invite user baru (set password langsung)
    r = await app.inject({ method: "POST", url: "/api/auth/users", headers: { cookie: c1 }, payload: { email: "c@d.co", password: "password2" } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).not.toHaveProperty("passwordHash");

    // invite email dipakai → 409
    expect((await app.inject({ method: "POST", url: "/api/auth/users", headers: { cookie: c1 }, payload: { email: "c@d.co", password: "password9" } })).statusCode).toBe(409);

    // list users → 2
    const list = (await app.inject({ method: "GET", url: "/api/auth/users", headers: { cookie: c1 } })).json();
    expect(list).toHaveLength(2);

    // user baru bisa login
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "c@d.co", password: "password2" } })).statusCode).toBe(200);

    // ganti password → sesi lama (c1) mati, cookie baru valid
    r = await app.inject({ method: "POST", url: "/api/auth/change-password", headers: { cookie: c1 }, payload: { currentPassword: "password1", newPassword: "password3" } });
    expect(r.statusCode).toBe(200);
    const c2 = cookieOf(r);
    expect((await app.inject({ method: "GET", url: "/api/projects", headers: { cookie: c1 } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/projects", headers: { cookie: c2 } })).statusCode).toBe(200);

    // password lama salah → 400
    expect((await app.inject({ method: "POST", url: "/api/auth/change-password", headers: { cookie: c2 }, payload: { currentPassword: "wrong", newPassword: "password4" } })).statusCode).toBe(400);

    // hapus user yang di-invite; tak boleh hapus user terakhir
    const users = (await app.inject({ method: "GET", url: "/api/auth/users", headers: { cookie: c2 } })).json() as Array<{ id: string; email: string }>;
    const other = users.find((u) => u.email === "c@d.co")!;
    expect((await app.inject({ method: "DELETE", url: `/api/auth/users/${other.id}`, headers: { cookie: c2 } })).statusCode).toBe(204);
    const me = users.find((u) => u.email === "a@b.co")!;
    expect((await app.inject({ method: "DELETE", url: `/api/auth/users/${me.id}`, headers: { cookie: c2 } })).statusCode).toBe(400);

    // logout → cookie invalid
    expect((await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: c2 } })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/projects", headers: { cookie: c2 } })).statusCode).toBe(401);
  });

  it("rejects invalid bodies", async () => {
    expect((await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "bad", password: "short" } })).statusCode).toBe(400);
    await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "a@b.co", password: "password1" } });
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "a@b.co" } })).statusCode).toBe(400);
  });
});
