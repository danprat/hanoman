import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { issueDeviceToken, verifyDeviceToken, revokeDeviceToken, tokenHash } from "../src/services/device-token";

const clean = async () => { await prisma.deviceToken.deleteMany(); await prisma.user.deleteMany(); };
beforeEach(clean); afterAll(clean);

async function user() { return prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } }); }

describe("device-token service", () => {
  it("issue returns plaintext once; hash stored, not plaintext", async () => {
    const u = await user();
    const t = await issueDeviceToken(u.id, "laptop");
    expect(t.token).toBeTruthy();
    const row = await prisma.deviceToken.findUnique({ where: { id: t.id } });
    expect(row?.tokenHash).toBe(tokenHash(t.token));
    expect(row?.tokenHash).not.toBe(t.token);
  });
  it("verify resolves to userId; revoke makes it fail", async () => {
    const u = await user();
    const t = await issueDeviceToken(u.id, "laptop");
    expect(await verifyDeviceToken(t.token)).toMatchObject({ userId: u.id });
    expect(await revokeDeviceToken(t.id)).toBe(true);
    expect(await verifyDeviceToken(t.token)).toBeNull();
  });
  it("unknown token → null", async () => { expect(await verifyDeviceToken("nope")).toBeNull(); });
});
