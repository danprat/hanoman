// SPEC-249 · ADR-0060 · kunci ingest DSN per-project. Hash-at-rest (pola DeviceToken); plaintext
// hanya ditampilkan sekali saat generate/rotate. DSN gaya Sentry: key di query URL ingest.
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateIngestKey(): { key: string; hash: string; prefix: string } {
  const key = "hnm_ing_" + randomBytes(24).toString("hex"); // 48 hex chars
  return { key, hash: hashKey(key), prefix: key.slice(0, 16) };
}

// Bandingkan hash secara timing-safe. Key/hash kosong/null → false.
export function verifyKey(key: string, hash: string | null | undefined): boolean {
  if (!key || !hash) return false;
  const a = Buffer.from(hashKey(key), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function dsnUrl(slug: string, key: string, base: string): string {
  return `${base.replace(/\/$/, "")}/api/ingest/${encodeURIComponent(slug)}?key=${key}`;
}
