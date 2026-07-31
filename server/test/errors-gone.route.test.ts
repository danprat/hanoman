// SPEC-384 · ADR-0092 · permukaan error monitoring & cross-audit dicabut.
//
// Dua app dipakai karena yang dijaga dua hal berbeda:
//
//  1. Gate MATI (`requireAuth: false`) → 404 membuktikan route-nya memang tak terdaftar. Kalau
//     seseorang mendaftarkannya kembali, jawabannya berubah jadi 200/400 dan test ini merah.
//  2. Gate HIDUP → membuktikan gate-nya masih menggerbangi yang tersisa, dan bahwa pengecualian
//     yang SEHARUSNYA bertahan (`/api/help`) memang bertahan.
//
// Yang TIDAK bisa dibuktikan dari luar: apakah `if (path.startsWith("/api/ingest")) return;`
// masih tertinggal di app.ts. `setNotFoundHandler` terpasang di app ROOT, sementara hook
// `onRequest` gate hidup di scope `/api` — untuk path tanpa route, Fastify menjawab dari handler
// root dan hook ber-scope itu tak pernah berjalan. Jadi prefix bypass yatim menghasilkan 404 yang
// identik dengan keadaan yang benar. Penjaga sesungguhnya untuk itu adalah ketiadaan route-nya
// (kasus 1); prefix tanpa route tak punya efek yang bisa diamati.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

const open = buildApp({ requireAuth: false });
const gated = buildApp();

const PID = "p-384-gone";
const clean = async () => { await prisma.project.deleteMany({ where: { id: PID } }); };

beforeAll(async () => {
  await clean();
  await prisma.project.create({ data: { id: PID, name: "Gone", desc: "", kind: "existing" } });
});
afterAll(async () => { await clean(); });

describe("SPEC-384 · permukaan error monitoring & cross-audit dicabut", () => {
  it("POST /api/ingest/:slug — route tak ada (gate mati → 404)", async () => {
    const r = await open.inject({
      method: "POST", url: `/api/ingest/${PID}?key=apa-saja`,
      payload: { type: "Error", message: "x", environment: "production" },
    });
    expect(r.statusCode).toBe(404);
  });

  it("POST /api/ingest/:slug/sourcemaps — route tak ada", async () => {
    const r = await open.inject({
      method: "POST", url: `/api/ingest/${PID}/sourcemaps?key=apa-saja`,
      payload: { release: "1", artifacts: [] },
    });
    expect(r.statusCode).toBe(404);
  });

  it("GET /api/errors — route tak ada", async () => {
    expect((await open.inject({ method: "GET", url: "/api/errors" })).statusCode).toBe(404);
  });

  it("GET /api/projects/:id/ingest-key — endpoint DSN tak ada", async () => {
    const r = await open.inject({ method: "GET", url: `/api/projects/${PID}/ingest-key` });
    expect(r.statusCode).toBe(404);
  });

  it("kontrol negatif: GET /api/projects tetap hidup", async () => {
    expect((await open.inject({ method: "GET", url: "/api/projects" })).statusCode).toBe(200);
  });

  it("GET /api/audit/logs — permukaan cross-audit tak ada", async () => {
    expect((await open.inject({ method: "GET", url: "/api/audit/logs" })).statusCode).toBe(404);
  });

  it("GET /api/projects/:id/links — relasi ProjectLink tak ada", async () => {
    expect((await open.inject({ method: "GET", url: `/api/projects/${PID}/links` })).statusCode).toBe(404);
  });

  it("kontrol positif: gate memang HIDUP di app kedua (route ada, cookie tak ada → 401)", async () => {
    expect((await gated.inject({ method: "GET", url: "/api/projects" })).statusCode).toBe(401);
  });

  it("kontrol negatif: pengecualian gate /api/help TETAP ada (Help Center tak dicabut)", async () => {
    // Project ini tak meng-opt-in Help Center → route menjawab 404 generik. Yang dibuktikan di
    // sini bukan isinya, melainkan bahwa gate MELOLOSKANNYA: 401 berarti prefix help ikut tercabut.
    const r = await gated.inject({ method: "GET", url: `/api/help/${PID}` });
    expect(r.statusCode).not.toBe(401);
  });
});
