import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { recordSessionResult } from "../src/services/session-result";
import { listOutbox } from "../src/services/outbox";
import { setConfig, clearConfig } from "../src/config";

const clean = async () => {
  await prisma.syncOutbox.deleteMany(); await prisma.sessionResult.deleteMany();
};
// SPEC-330 · outbox = antrean push khusus CLIENT; set hub tujuan agar peran instance = client.
beforeEach(async () => { await clean(); await setConfig("SYNC_SERVER_URL", "http://hub.example"); });
afterAll(async () => { await clearConfig("SYNC_SERVER_URL"); await clean(); });

describe("session-result service (SPEC-213 AC-20/21)", () => {
  it("stores only whitelisted fields; wild fields (transcript/token) dropped", async () => {
    const { id } = await recordSessionResult({
      projectId: "p1", specId: "SPEC-1", oldStage: "planned", newStage: "executing",
      commitSha: "abc123", branch: "hanoman/spec-1", prUrl: "https://gh/pr/1", status: "done",
      deviceId: "dev-1", author: "a@b.co",
      // field liar yang TIDAK boleh tersimpan:
      transcript: "SECRET PTY OUTPUT", token: "sk-leak", blob: { x: 1 },
    } as Record<string, unknown>);

    const row = await prisma.sessionResult.findUnique({ where: { id } });
    expect(row).toMatchObject({
      projectId: "p1", specId: "SPEC-1", oldStage: "planned", newStage: "executing",
      commitSha: "abc123", branch: "hanoman/spec-1", prUrl: "https://gh/pr/1", status: "done", author: "a@b.co",
    });
    expect(row).not.toHaveProperty("transcript");
    expect(row).not.toHaveProperty("token");
    expect(JSON.stringify(row)).not.toContain("SECRET PTY OUTPUT");
    expect(JSON.stringify(row)).not.toContain("sk-leak");
  });

  it("enqueues outbox(sessionResult) for push", async () => {
    const { id } = await recordSessionResult({ projectId: "p1", status: "done" });
    expect((await listOutbox()).find((o) => o.entity === "sessionResult" && o.recordId === id)).toBeTruthy();
  });
});
