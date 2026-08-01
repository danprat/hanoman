import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { resolveHome } from "@hanoman/runner";

/**
 * SPEC-477 · ADR-0097 · enkripsi at-rest untuk nilai `RuntimeConfig` ber-`kind: "secret"`.
 *
 * Ber-versi di prefix supaya rotasi algoritma kelak tak menuntut membaca-tebak. Nilai TANPA
 * prefix adalah baris plaintext yang ditulis sebelum spec ini — ia dikembalikan apa adanya dan
 * naik kelas jadi ciphertext saat ditulis ulang. Karena kolomnya sama dan hanya encoding-nya
 * berubah, tak ada migration Prisma.
 */
export const ENC_PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12;   // ukuran nonce yang direkomendasikan GCM
const KEY_BYTES = 32;

export function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}

export function encryptWithKey(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${body.toString("base64url")}`;
}

/** `null` HANYA untuk ciphertext yang tak bisa dibuka; plaintext lama lolos apa adanya. */
export function decryptWithKey(value: string, key: Buffer): string | null {
  if (!isEncrypted(value)) return value;
  const parts = value.slice(ENC_PREFIX.length).split(":");
  if (parts.length !== 3) return null;
  const [ivRaw, tagRaw, bodyRaw] = parts as [string, string, string];
  try {
    const decipher = createDecipheriv(ALGO, key, Buffer.from(ivRaw, "base64url"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(bodyRaw, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// Kunci dibaca sekali per proses. `secret.key` hidup di HANOMAN_HOME (bukan repo, bukan .env):
// itulah syarat "`.env` tidak lagi diperlukan".
let cached: Buffer | null = null;
export function resetSecretKeyCache(): void { cached = null; }

function fromEnv(raw: string): Buffer | null {
  for (const enc of ["base64url", "base64", "hex"] as const) {
    const buf = Buffer.from(raw, enc);
    if (buf.length === KEY_BYTES) return buf;
  }
  return null;
}

export function secretKeyPath(): string {
  return join(resolveHome(), "secret.key");
}

export function secretKey(): Buffer {
  if (cached) return cached;
  const override = process.env.HANOMAN_SECRET_KEY?.trim();
  if (override) {
    const key = fromEnv(override);
    if (!key) throw new Error(`HANOMAN_SECRET_KEY harus 32 byte (hex/base64), dapat ${override.length} karakter`);
    cached = key;
    return key;
  }
  const path = secretKeyPath();
  if (existsSync(path)) {
    const key = Buffer.from(readFileSync(path, "utf8").trim(), "base64url");
    if (key.length !== KEY_BYTES) throw new Error(`kunci di ${path} rusak — panjangnya bukan 32 byte`);
    cached = key;
    return key;
  }
  const key = randomBytes(KEY_BYTES);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, key.toString("base64url"), { mode: 0o600 });
  chmodSync(path, 0o600);   // writeFile `mode` tak berlaku bila berkasnya sudah ada
  cached = key;
  return key;
}

export function encryptSecret(plain: string): string { return encryptWithKey(plain, secretKey()); }
export function decryptSecret(value: string): string | null { return decryptWithKey(value, secretKey()); }
