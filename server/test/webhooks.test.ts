import { describe, it, expect, beforeAll } from "vitest";
import { createHmac } from "node:crypto";

process.env.GITHUB_APP_ID = "1";
process.env.GITHUB_WEBHOOK_SECRET = "shh";
process.env.GITHUB_APP_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----";

const { buildApp } = await import("../src/app");
const { seed } = await import("../prisma/seed");

const sign = (body: string) => "sha256=" + createHmac("sha256", "shh").update(body).digest("hex");

describe("webhooks", () => {
  beforeAll(async () => { await seed(); });

  it("401 on a bad signature", async () => {
    const app = buildApp();
    const r = await app.inject({
      method: "POST", url: "/api/webhooks/github",
      headers: { "x-github-event": "push", "x-github-delivery": "1", "x-hub-signature-256": "sha256=bad", "content-type": "application/json" },
      payload: JSON.stringify({ zen: "x" }),
    });
    expect(r.statusCode).toBe(401);
  });

  it("accepts a valid ping", async () => {
    const body = JSON.stringify({ zen: "hi", hook_id: 1 });
    const app = buildApp();
    const r = await app.inject({
      method: "POST", url: "/api/webhooks/github",
      headers: { "x-github-event": "ping", "x-github-delivery": "2", "x-hub-signature-256": sign(body), "content-type": "application/json" },
      payload: body,
    });
    expect(r.statusCode).toBe(200);
  });
});
