import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app";
import { resetDb, makeVps } from "./factory";

const FAKE_SSH = fileURLToPath(new URL("./fixtures/fake-ssh.sh", import.meta.url));
const app = buildApp({ requireAuth: false });
beforeAll(async () => { await resetDb(); });
beforeEach(() => { process.env.HANOMAN_SSH_BIN = FAKE_SSH; delete process.env.FAKE_SSH_MODE; });

const naOf = async (vpsId: string, itemId: string): Promise<boolean> => {
  const cl = (await app.inject({ url: `/api/vps/${vpsId}/checklist` })).json();
  return cl.sections.flatMap((s: { items: { id: string; na: boolean }[] }) => s.items)
    .find((i: { id: string }) => i.id === itemId).na;
};

describe("na-bulk (SPEC-221)", () => {
  it("tandai banyak item N/A sekaligus → semua na true + count", async () => {
    const v = await makeVps({ name: "b1", host: "198.51.100.231" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/items/na-bulk`,
      payload: { itemIds: ["ap-b1", "ap-b2", "ap-i1"], na: true, reason: "tak pakai aaPanel" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().count).toBe(3);
    expect(await naOf(v.id, "ap-b1")).toBe(true);
    expect(await naOf(v.id, "ap-i1")).toBe(true);
  });

  it("batch berisi itemId asing → 400, TAK ada yang berubah", async () => {
    const v = await makeVps({ name: "b2", host: "198.51.100.232" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/items/na-bulk`,
      payload: { itemIds: ["ap-b1", "tidak-ada"], na: true } });
    expect(res.statusCode).toBe(400);
    expect(await naOf(v.id, "ap-b1")).toBe(false); // batch ditolak seluruhnya
  });

  it("batch kosong → 400", async () => {
    const v = await makeVps({ name: "b3", host: "198.51.100.233" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/items/na-bulk`, payload: { itemIds: [], na: true } });
    expect(res.statusCode).toBe(400);
  });

  it("lepas N/A bulk (na:false)", async () => {
    const v = await makeVps({ name: "b4", host: "198.51.100.234" });
    await app.inject({ method: "POST", url: `/api/vps/${v.id}/items/na-bulk`, payload: { itemIds: ["ap-b1"], na: true } });
    await app.inject({ method: "POST", url: `/api/vps/${v.id}/items/na-bulk`, payload: { itemIds: ["ap-b1"], na: false } });
    expect(await naOf(v.id, "ap-b1")).toBe(false);
  });

  it("vps tak dikenal → 404", async () => {
    const res = await app.inject({ method: "POST", url: "/api/vps/hantu/items/na-bulk", payload: { itemIds: ["ap-b1"], na: true } });
    expect(res.statusCode).toBe(404);
  });
});
