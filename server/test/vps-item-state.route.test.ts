import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app";
import { resetDb, makeVps } from "./factory";
import type { ChecklistView, ChecklistItem } from "@hanoman/shared";

const FAKE_SSH = fileURLToPath(new URL("./fixtures/fake-ssh.sh", import.meta.url));
const app = buildApp({ requireAuth: false });
beforeAll(async () => { await resetDb(); });
beforeEach(() => { process.env.HANOMAN_SSH_BIN = FAKE_SSH; delete process.env.FAKE_SSH_MODE; });

const checklist = async (id: string): Promise<ChecklistView> =>
  (await app.inject({ url: `/api/vps/${id}/checklist` })).json();
const findItem = (cl: ChecklistView, itemId: string): ChecklistItem | undefined =>
  cl.sections.flatMap((s) => s.items).find((i) => i.id === itemId);

describe("mark N/A (SPEC-220 AC-10)", () => {
  it("tandai N/A → tercermin di checklist + alasan tercatat", async () => {
    const v = await makeVps({ name: "na1", host: "198.51.100.81" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/items/ssh-b1/na`,
      payload: { na: true, reason: "tak pakai SSH port custom" } });
    expect(res.statusCode).toBe(200);
    const item = findItem(await checklist(v.id), "ssh-b1")!;
    expect(item.na).toBe(true);
    expect(item.status).toBe("na");
    expect(item.naReason).toBe("tak pakai SSH port custom");
  });

  it("lepas N/A → item kembali applicable", async () => {
    const v = await makeVps({ name: "na2", host: "198.51.100.82" });
    await app.inject({ method: "POST", url: `/api/vps/${v.id}/items/ssh-b1/na`, payload: { na: true } });
    await app.inject({ method: "POST", url: `/api/vps/${v.id}/items/ssh-b1/na`, payload: { na: false } });
    expect(findItem(await checklist(v.id), "ssh-b1")!.na).toBe(false);
  });

  it("itemId asing → 404", async () => {
    const v = await makeVps({ name: "na3", host: "198.51.100.83" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/items/tidak-ada/na`, payload: { na: true } });
    expect(res.statusCode).toBe(404);
  });
});

describe("attest INFO (SPEC-220 AC-11)", () => {
  it("attest item INFO → terhitung terpenuhi + catatan tercatat", async () => {
    const v = await makeVps({ name: "at1", host: "198.51.100.84" });
    const before = (await checklist(v.id)).scoreBySection.ssh ?? 0;
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/items/ssh-a1/attest`,
      payload: { note: "CA internal sudah ada" } });
    expect(res.statusCode).toBe(200);
    const cl = await checklist(v.id);
    const item = findItem(cl, "ssh-a1")!;
    expect(item.attested).toBe(true);
    expect(item.status).toBe("pass");
    expect(item.attestNote).toBe("CA internal sudah ada");
    expect(cl.scoreBySection.ssh).toBeGreaterThan(before); // 1 item ssh terpenuhi
  });

  it("attest item non-INFO (AUDIT/AUTO) → 400", async () => {
    const v = await makeVps({ name: "at2", host: "198.51.100.85" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/items/ssh-b1/attest`, payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("attest itemId asing → 404", async () => {
    const v = await makeVps({ name: "at3", host: "198.51.100.86" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/items/tidak-ada/attest`, payload: {} });
    expect(res.statusCode).toBe(404);
  });
});
