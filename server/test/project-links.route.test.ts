import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

const app = buildApp({ requireAuth: false });
const clean = async () => {
  await prisma.projectLink.deleteMany();
  await prisma.project.deleteMany();
};

beforeEach(async () => {
  await clean();
  await prisma.project.createMany({ data: [
    { id: "web", name: "Web", desc: "", kind: "existing" },
    { id: "api", name: "API", desc: "", kind: "existing" },
  ] });
});
afterAll(clean);

describe("relasi antar project", () => {
  it("membuat relasi berarah lalu mengembalikannya di kedua project", async () => {
    const r = await app.inject({ method: "POST", url: "/api/projects/web/links",
      payload: { to: "api", kind: "api", note: "web memanggil /api/orders" } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ fromProjectId: "web", toProjectId: "api", kind: "api", direction: "keluar", other: { id: "api", name: "API" } });

    const dariWeb = (await app.inject({ method: "GET", url: "/api/projects/web/links" })).json().links;
    expect(dariWeb).toHaveLength(1);
    expect(dariWeb[0].direction).toBe("keluar");

    const dariApi = (await app.inject({ method: "GET", url: "/api/projects/api/links" })).json().links;
    expect(dariApi).toHaveLength(1);
    expect(dariApi[0].direction).toBe("masuk");
    expect(dariApi[0].other.id).toBe("web");
  });

  it("menolak self-link (400)", async () => {
    const r = await app.inject({ method: "POST", url: "/api/projects/web/links", payload: { to: "web", kind: "api" } });
    expect(r.statusCode).toBe(400);
  });

  it("menolak kind di luar katalog (400)", async () => {
    const r = await app.inject({ method: "POST", url: "/api/projects/web/links", payload: { to: "api", kind: "grpc" } });
    expect(r.statusCode).toBe(400);
  });

  it("404 bila project atau target tak ada", async () => {
    expect((await app.inject({ method: "POST", url: "/api/projects/hantu/links", payload: { to: "api", kind: "api" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/projects/web/links", payload: { to: "hantu", kind: "api" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/projects/hantu/links" })).statusCode).toBe(404);
  });

  it("409 bila pasangan berarah sudah ada", async () => {
    await app.inject({ method: "POST", url: "/api/projects/web/links", payload: { to: "api", kind: "api" } });
    const r = await app.inject({ method: "POST", url: "/api/projects/web/links", payload: { to: "api", kind: "data" } });
    expect(r.statusCode).toBe(409);
  });

  it("mengizinkan arah sebaliknya sebagai relasi terpisah", async () => {
    await app.inject({ method: "POST", url: "/api/projects/web/links", payload: { to: "api", kind: "api" } });
    const r = await app.inject({ method: "POST", url: "/api/projects/api/links", payload: { to: "web", kind: "event" } });
    expect(r.statusCode).toBe(201);
    expect((await app.inject({ method: "GET", url: "/api/projects/web/links" })).json().links).toHaveLength(2);
  });

  it("menghapus relasi dari kedua sisi, 404 bila tak menyentuh project itu", async () => {
    const created = (await app.inject({ method: "POST", url: "/api/projects/web/links", payload: { to: "api", kind: "api" } })).json();
    await prisma.project.create({ data: { id: "lain", name: "Lain", desc: "", kind: "existing" } });
    expect((await app.inject({ method: "DELETE", url: `/api/projects/lain/links/${created.id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/projects/api/links/${created.id}` })).statusCode).toBe(204);
    expect(await prisma.projectLink.count()).toBe(0);
  });
});
