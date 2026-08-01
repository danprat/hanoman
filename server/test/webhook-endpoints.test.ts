import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import {
  refreshWebhookCache, webhooksActive, activeEndpoints, matchingEndpoints,
  newSecret, secretOf, endpointView,
} from "../src/services/webhooks/endpoints";
import { ENC_PREFIX, encryptSecret } from "../src/services/secret-box";

const clean = async () => {
  await prisma.webhookDelivery.deleteMany();
  await prisma.webhookEndpoint.deleteMany();
};
beforeEach(async () => { await clean(); await refreshWebhookCache(); });
afterAll(async () => { await clean(); await refreshWebhookCache(); });

const mk = (over: Record<string, unknown> = {}) => prisma.webhookEndpoint.create({
  data: {
    name: "n", url: "https://contoh.id/hook", secret: "enc-placeholder",
    events: ["*"] as never, ...over,
  } as never,
});

describe("cache gate", () => {
  it("mati saat tak ada endpoint sama sekali", () => {
    expect(webhooksActive()).toBe(false);
    expect(activeEndpoints()).toEqual([]);
  });

  it("menyala setelah endpoint aktif dibuat DAN cache disegarkan", async () => {
    await mk();
    expect(webhooksActive()).toBe(false);   // belum disegarkan — sengaja, bukan bug
    await refreshWebhookCache();
    expect(webhooksActive()).toBe(true);
  });

  it("endpoint nonaktif tak menyalakan gate", async () => {
    await mk({ enabled: false });
    await refreshWebhookCache();
    expect(webhooksActive()).toBe(false);
  });
});

describe("matchingEndpoints", () => {
  it("menyaring menurut jenis peristiwa", async () => {
    await mk({ name: "a", events: ["spec.*"] as never });
    await mk({ name: "b", events: ["ticket.created"] as never });
    await refreshWebhookCache();
    expect(matchingEndpoints("spec.created", "hanoman").map((e) => e.name)).toEqual(["a"]);
    expect(matchingEndpoints("ticket.created", "hanoman").map((e) => e.name)).toEqual(["b"]);
    expect(matchingEndpoints("lead.decision", "hanoman")).toEqual([]);
  });

  it("menyaring menurut project; null = semua project", async () => {
    await mk({ name: "semua", projectIds: null as never });
    await mk({ name: "khusus", projectIds: ["lain"] as never });
    await refreshWebhookCache();
    expect(matchingEndpoints("spec.created", "hanoman").map((e) => e.name)).toEqual(["semua"]);
    expect(matchingEndpoints("spec.created", "lain").map((e) => e.name).sort()).toEqual(["khusus", "semua"]);
  });

  it("peristiwa tanpa project hanya mengenai endpoint tanpa filter project", async () => {
    await mk({ name: "semua", projectIds: null as never });
    await mk({ name: "khusus", projectIds: ["hanoman"] as never });
    await refreshWebhookCache();
    expect(matchingEndpoints("notification.created", null).map((e) => e.name)).toEqual(["semua"]);
  });
});

describe("secret", () => {
  it("newSecret menghasilkan nilai acak cukup panjang", () => {
    const a = newSecret(), b = newSecret();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
  });

  it("secretOf membuka ciphertext dan mengembalikan null bila rusak", () => {
    const plain = newSecret();
    expect(secretOf({ secret: encryptSecret(plain) })).toBe(plain);
    expect(secretOf({ secret: `${ENC_PREFIX}rusak` })).toBeNull();
  });
});

describe("endpointView", () => {
  it("TIDAK PERNAH mengembalikan secret, hanya empat karakter terakhir", async () => {
    const plain = "rahasia-panjang-sekali-1234";
    const row = await mk({ secret: encryptSecret(plain) });
    const v = endpointView(row as never, 3);
    expect(v.secretHint).toBe("1234");
    expect(v.pending).toBe(3);
    expect(JSON.stringify(v)).not.toContain(plain);
    expect(v.secret).toBeUndefined();
  });

  it("membawa secret plaintext HANYA bila diminta eksplisit (create/rotate)", async () => {
    const row = await mk({ secret: encryptSecret("abcd1234efgh") });
    expect(endpointView(row as never, 0, "abcd1234efgh").secret).toBe("abcd1234efgh");
  });
});
