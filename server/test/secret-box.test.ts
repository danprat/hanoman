import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { ENC_PREFIX, isEncrypted, encryptWithKey, decryptWithKey } from "../src/services/secret-box";

const KEY = randomBytes(32);

describe("secret-box (SPEC-477)", () => {
  it("round-trip mengembalikan plaintext asli", () => {
    const enc = encryptWithKey("123456:AA-bb_CC", KEY);
    expect(enc.startsWith(ENC_PREFIX)).toBe(true);
    expect(enc).not.toContain("123456:AA-bb_CC");
    expect(decryptWithKey(enc, KEY)).toBe("123456:AA-bb_CC");
  });

  it("iv acak: dua enkripsi nilai sama menghasilkan ciphertext berbeda", () => {
    expect(encryptWithKey("sama", KEY)).not.toBe(encryptWithKey("sama", KEY));
  });

  it("tag rusak → null, bukan plaintext palsu", () => {
    const parts = encryptWithKey("rahasia", KEY).split(":");
    parts[3] = Buffer.from(randomBytes(16)).toString("base64url");
    expect(decryptWithKey(parts.join(":"), KEY)).toBeNull();
  });

  it("kunci salah → null", () => {
    expect(decryptWithKey(encryptWithKey("rahasia", KEY), randomBytes(32))).toBeNull();
  });

  // Gotcha 3 · baris RuntimeConfig yang ditulis SEBELUM spec ini plaintext. Melemparkan error
  // di sini akan mematikan setiap instance yang sudah punya SYNC_DEVICE_TOKEN/GITHUB_TOKEN.
  it("nilai tanpa prefix = plaintext lama, dikembalikan apa adanya", () => {
    expect(isEncrypted("ghp_plaintextlama")).toBe(false);
    expect(decryptWithKey("ghp_plaintextlama", KEY)).toBe("ghp_plaintextlama");
  });

  it("bentuk enc: rusak (jumlah segmen salah) → null", () => {
    expect(decryptWithKey(`${ENC_PREFIX}cuma-satu-segmen`, KEY)).toBeNull();
  });

  it("string kosong tetap bisa dienkripsi & dipulihkan", () => {
    expect(decryptWithKey(encryptWithKey("", KEY), KEY)).toBe("");
  });
});
