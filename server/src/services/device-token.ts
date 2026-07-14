import { randomBytes, createHash } from "node:crypto";
import { prisma } from "../db";

// SPEC-213 · ADR-0044 · identitas mesin. Plaintext token hanya lahir & ditampilkan sekali;
// DB simpan sha256(token). Cermin pola Session (services/auth.ts): id/hash ≠ rahasia.
export const newDeviceToken = () => randomBytes(32).toString("base64url");
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function issueDeviceToken(userId: string, name: string): Promise<{ id: string; name: string; token: string }> {
  const token = newDeviceToken();
  const row = await prisma.deviceToken.create({ data: { userId, name, tokenHash: tokenHash(token) } });
  return { id: row.id, name: row.name, token };
}

export async function verifyDeviceToken(token: string): Promise<{ id: string; userId: string } | null> {
  const row = await prisma.deviceToken.findUnique({ where: { tokenHash: tokenHash(token) } });
  if (!row || row.revokedAt) return null;
  // best-effort lastSeenAt; jangan gagalkan auth kalau update kedip.
  await prisma.deviceToken.update({ where: { id: row.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  return { id: row.id, userId: row.userId };
}

export async function revokeDeviceToken(id: string): Promise<boolean> {
  const row = await prisma.deviceToken.findUnique({ where: { id } });
  if (!row) return false;
  await prisma.deviceToken.update({ where: { id }, data: { revokedAt: new Date() } });
  return true;
}
