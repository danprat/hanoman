# SPEC-477 — Setting integrasi Telegram Bot lewat halaman Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kredensial & opsi Telegram bot dapat diisi, diubah, diuji (Test Connection), dan dihapus sepenuhnya dari halaman Settings — tersimpan terenkripsi di SQLite, berlaku tanpa restart, dan `.env` tidak lagi diperlukan.

**Architecture:** Kredensial Telegram menjadi empat entri `CONFIG_REGISTRY` (ADR-0049) alih-alih store kedua, sehingga resolver `effectiveStr()` = **DB → env → default** memberi fallback `.env` + penanda deprecated (`sourceOf()`) gratis. Nilai `kind: "secret"` dienkripsi at-rest (AES-256-GCM) di `RuntimeConfig` oleh `secret-box.ts`; cache in-memory tetap plaintext sehingga tak satu pun pemakai `effectiveStr` berubah. Bootstrap Telegram membaca resolver (bukan `process.env`) dan mendapat `reloadTelegramGateway()` untuk berlaku-tanpa-restart. Tiga endpoint COOKIE_ONLY baru (`/telegram/settings`, `/telegram/test`, `/telegram/credentials`) menopang kartu Settings.

**Tech Stack:** TypeScript strict · Fastify 5 · Prisma 6 / SQLite · Zod · React 18 + Vite · Vitest · `node:crypto` (AES-256-GCM, bawaan Node — **tanpa dependency baru**)

## Global Constraints

- **Tanpa migration Prisma, tanpa model baru.** Kolom `RuntimeConfig.value` tetap; hanya encoding-nya berubah.
- **Tanpa dependency npm baru.** Kripto memakai `node:crypto`.
- Bot token **tidak pernah** dikembalikan utuh oleh API mana pun, tidak pernah masuk log, pesan error, transcript, memory, atau sesi. ADR-0096 gotcha 4 tetap: sesi operator hanya menerima AgentToken + chat id + base URL.
- Endpoint pengaturan Telegram **hanya sesi cookie admin**, bukan agent token.
- Bahasa komentar & pesan UI: **Indonesia**. Nama simbol kode: Inggris, mengikuti sekitarnya.
- Setiap task diakhiri commit yang **juga** memuat doc `internal/docs` yang tersentuh oleh task itu (Task 8 memuat ADR + index).
- Perintah test **wajib** `--no-file-parallelism` bila menyentuh test server (test server berbagi satu berkas DB).
- Nilai yang datang dari `.env` **tidak** divalidasi pola — validasi adalah gerbang **tulis**, bukan gerbang baca.
- Format ciphertext: `enc:v1:<b64url(iv)>:<b64url(tag)>:<b64url(ciphertext)>`.
- ADR baru = **0097**. Nomor sudah dienumerasi lintas semua branch + worktree (tertinggi terpakai: 0096).

---

### Task 1: `secret-box.ts` — enkripsi at-rest + kunci mesin

**Files:**
- Create: `server/src/services/secret-box.ts`
- Test: `server/test/secret-box.test.ts`

**Interfaces:**
- Consumes: `resolveHome` dari `@hanoman/runner`
- Produces:
  - `ENC_PREFIX = "enc:v1:"`
  - `isEncrypted(value: string): boolean`
  - `encryptWithKey(plain: string, key: Buffer): string`
  - `decryptWithKey(value: string, key: Buffer): string | null` — `null` bila gagal dekripsi; nilai **tanpa** prefix dikembalikan apa adanya
  - `secretKey(): Buffer` — kunci mesin, dibuat sekali bila belum ada
  - `encryptSecret(plain: string): string` / `decryptSecret(value: string): string | null` — pembungkus yang memakai `secretKey()`
  - `resetSecretKeyCache(): void` — untuk test

- [ ] **Step 1: Write the failing test**

Create `server/test/secret-box.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --no-file-parallelism server/test/secret-box.test.ts`
Expected: FAIL — `Failed to resolve import "../src/services/secret-box"`

- [ ] **Step 3: Write minimal implementation**

Create `server/src/services/secret-box.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --no-file-parallelism server/test/secret-box.test.ts`
Expected: PASS — 7 passed

- [ ] **Step 5: Commit**

```bash
git add server/src/services/secret-box.ts server/test/secret-box.test.ts
git commit -m "feat(477): secret-box — enkripsi at-rest AES-256-GCM + kunci mesin di HANOMAN_HOME"
```

---

### Task 2: `RuntimeConfig` menyimpan ciphertext, cache tetap plaintext

**Files:**
- Modify: `server/src/config.ts` (`loadConfig`, `setConfig`)
- Test: `server/test/config-resolver.test.ts` (tambahan)

**Interfaces:**
- Consumes: `encryptSecret`, `decryptSecret`, `isEncrypted` (Task 1); `configEntry` dari `@hanoman/shared`
- Produces: tak ada simbol baru — `effectiveStr`/`effectiveInt`/`effectiveBool`/`rawDbValue`/`sourceOf` **tak berubah tanda tangan maupun semantiknya**

- [ ] **Step 1: Write the failing test**

Append ke `server/test/config-resolver.test.ts` (di dalam file, sebagai `describe` baru di akhir):

```ts
import { ENC_PREFIX } from "../src/services/secret-box";

describe("SPEC-477 · secret at-rest", () => {
  it("kind:secret disimpan sebagai ciphertext di DB tapi terbaca plaintext lewat resolver", async () => {
    await cfg.setConfig("GITHUB_TOKEN", "ghp_rahasia_sekali_123456");
    const row = await prisma.runtimeConfig.findUnique({ where: { key: "GITHUB_TOKEN" } });
    expect(row!.value.startsWith(ENC_PREFIX)).toBe(true);
    expect(row!.value).not.toContain("ghp_rahasia_sekali_123456");
    expect(cfg.effectiveStr("GITHUB_TOKEN")).toBe("ghp_rahasia_sekali_123456");
    expect(cfg.rawDbValue("GITHUB_TOKEN")).toBe("ghp_rahasia_sekali_123456");
    await cfg.loadConfig();
    expect(cfg.effectiveStr("GITHUB_TOKEN")).toBe("ghp_rahasia_sekali_123456");
  });

  it("knob non-secret tetap plaintext (tak ada enkripsi yang tak perlu)", async () => {
    await cfg.setConfig("SYNC_TICK_MS", "5000");
    const row = await prisma.runtimeConfig.findUnique({ where: { key: "SYNC_TICK_MS" } });
    expect(row!.value).toBe("5000");
  });

  // Gotcha 3 · instance yang sudah hidup punya baris plaintext. Ia wajib tetap terbaca.
  it("baris plaintext lama tetap terbaca lewat loadConfig", async () => {
    await prisma.runtimeConfig.create({ data: { key: "GITHUB_TOKEN", value: "ghp_lama_plaintext" } });
    await cfg.loadConfig();
    expect(cfg.effectiveStr("GITHUB_TOKEN")).toBe("ghp_lama_plaintext");
  });

  it("ciphertext tak terbaca (kunci berganti) dianggap ABSEN, bukan melempar", async () => {
    await prisma.runtimeConfig.create({ data: { key: "GITHUB_TOKEN", value: `${ENC_PREFIX}aaa:bbb:ccc` } });
    await expect(cfg.loadConfig()).resolves.toBeUndefined();
    expect(cfg.effectiveStr("GITHUB_TOKEN")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --no-file-parallelism server/test/config-resolver.test.ts`
Expected: FAIL — test pertama gagal di `expect(row!.value.startsWith(ENC_PREFIX)).toBe(true)` (nilai masih plaintext)

- [ ] **Step 3: Write minimal implementation**

Ganti isi `server/src/config.ts` menjadi:

```ts
import { prisma } from "./db";
import { configEntry } from "@hanoman/shared";
import { decryptSecret, encryptSecret } from "./services/secret-box";

// SPEC-215 · ADR-0049 · resolver terpusat: override DB → env → default registry.
// Cache in-memory agar hot-path sinkron; di-refresh saat setConfig/clearConfig.
//
// SPEC-477 · ADR-0097 · nilai ber-`kind: "secret"` disimpan TERENKRIPSI di kolom DB, tapi cache
// memegang PLAINTEXT. Mendekripsi di `effectiveStr` akan memaksa kripto di hot-path sinkron dan
// memutus setiap pemakai `rawDbValue` — batasnya sengaja di `loadConfig`/`setConfig`.
let cache = new Map<string, string>();

const isSecret = (key: string): boolean => configEntry(key)?.kind === "secret";

export async function loadConfig(): Promise<void> {
  const rows = await prisma.runtimeConfig.findMany();
  const next = new Map<string, string>();
  for (const r of rows) {
    if (!isSecret(r.key)) { next.set(r.key, r.value); continue; }
    const plain = decryptSecret(r.value);
    // Kunci hilang/berganti: perlakukan sebagai ABSEN. Boot tak boleh mati karena satu secret
    // tak terbaca — resolver akan jatuh ke env/default seperti saat DB memang kosong.
    if (plain === null) { console.error(`config: nilai '${r.key}' tak bisa didekripsi — diabaikan`); continue; }
    next.set(r.key, plain);
  }
  cache = next;
}

export function rawDbValue(key: string): string | undefined { return cache.get(key); }

export function effectiveStr(key: string): string | undefined {
  return cache.get(key) ?? process.env[key] ?? configEntry(key)?.default;
}
export function effectiveInt(key: string): number | undefined {
  const v = effectiveStr(key);
  return v === undefined ? undefined : Number(v);
}
export function effectiveBool(key: string): boolean {
  const v = effectiveStr(key);
  return v === "1" || v === "true";
}
export function sourceOf(key: string): "db" | "env" | "default" {
  if (cache.has(key)) return "db";
  if (process.env[key] !== undefined) return "env";
  return "default";
}

export async function setConfig(key: string, value: string): Promise<void> {
  const stored = isSecret(key) ? encryptSecret(value) : value;
  await prisma.runtimeConfig.upsert({ where: { key }, create: { key, value: stored }, update: { value: stored } });
  cache.set(key, value);
}
export async function clearConfig(key: string): Promise<void> {
  await prisma.runtimeConfig.deleteMany({ where: { key } });
  cache.delete(key);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --no-file-parallelism server/test/config-resolver.test.ts server/test/config.route.test.ts server/test/config-apply.test.ts`
Expected: PASS — semua file hijau (config.route & config-apply membuktikan tak ada regresi pada pemakai lama)

- [ ] **Step 5: Commit**

```bash
git add server/src/config.ts server/test/config-resolver.test.ts
git commit -m "feat(477): RuntimeConfig menyimpan secret terenkripsi; cache tetap plaintext"
```

---

### Task 3: Kategori `credential` tak bisa ditulis agent token

**Files:**
- Modify: `server/src/routes/config.ts` (`PUT /config`, `DELETE /config/:key`)
- Test: `server/test/config.route.test.ts` (tambahan)

**Interfaces:**
- Consumes: `req.agent` (di-set `app.ts` onRequest hook untuk Bearer AgentToken; cookie sesi kembali lebih awal sehingga `req.agent` tetap `undefined`)
- Produces: tak ada simbol baru

- [ ] **Step 1: Write the failing test**

Append ke `server/test/config.route.test.ts` (impor tambahan di atas file: `import { issueAgentToken } from "../src/services/agent-token"; import { DEFAULT_SETTING } from "../src/services/settings";`, dan tambahkan `prisma.agentToken.deleteMany()` + `prisma.setting.deleteMany()` ke `clean()`):

```ts
// SPEC-477 · ADR-0097 · AgentToken gateway Telegram WAJIB memegang `settings:write` (ADR-0096 §2),
// dan capabilityForRoute memetakan /config ke settings:write. Tanpa pagar ini sesi operator
// Telegram bisa menulis ulang bot token & AgentToken-nya SENDIRI lewat percakapan.
describe("SPEC-477 · kategori credential = cookie-only", () => {
  async function agentHeaders() {
    await prisma.setting.upsert({
      where: { id: 1 },
      update: { data: { ...DEFAULT_SETTING, agentAccessEnabled: true } },
      create: { id: 1, data: { ...DEFAULT_SETTING, agentAccessEnabled: true } },
    });
    const { token } = await issueAgentToken({ name: "tg", capabilities: ["settings:read", "settings:write"] });
    return { authorization: `Bearer ${token}` };
  }

  it("agent token ber-settings:write ditolak 403 untuk PUT key credential", async () => {
    const headers = await agentHeaders();
    const r = await app.inject({ method: "PUT", url: "/api/config", headers,
      payload: { key: "HANOMAN_TELEGRAM_BOT_TOKEN", value: "123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" } });
    expect(r.statusCode).toBe(403);
    expect(await prisma.runtimeConfig.findUnique({ where: { key: "HANOMAN_TELEGRAM_BOT_TOKEN" } })).toBeNull();
  });

  it("agent token ditolak 403 untuk DELETE key credential", async () => {
    const headers = await agentHeaders();
    expect((await app.inject({ method: "DELETE", url: "/api/config/GITHUB_TOKEN", headers })).statusCode).toBe(403);
  });

  it("agent token TETAP boleh menulis key knob", async () => {
    const headers = await agentHeaders();
    const r = await app.inject({ method: "PUT", url: "/api/config", headers, payload: { key: "SYNC_TICK_MS", value: "5000" } });
    expect(r.statusCode).toBe(200);
  });

  it("cookie admin lolos untuk key credential", async () => {
    const cookie = await login();
    const r = await app.inject({ method: "PUT", url: "/api/config", headers: { cookie },
      payload: { key: "GITHUB_TOKEN", value: "ghp_dari_admin" } });
    expect(r.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --no-file-parallelism server/test/config.route.test.ts`
Expected: FAIL — dua test pertama dapat `200`/`204`, bukan `403`

- [ ] **Step 3: Write minimal implementation**

Di `server/src/routes/config.ts`, tambahkan helper setelah `const isSecret = ...`:

```ts
// SPEC-477 · ADR-0097 · `capabilityForRoute` hanya melihat method+path dan tak pernah melihat
// `body.key`, jadi ia struktural tak bisa membedakan PUT /config {key:"SYNC_TICK_MS"} dari
// PUT /config {key:"GITHUB_TOKEN"}. Pagarnya karena itu di handler. Ini KONDISI TAMBAHAN untuk
// identitas AgentToken, bukan capability baru — ADR-0065 utuh.
const agentBlocked = (req: { agent?: unknown }, e: ConfigEntry) => Boolean(req.agent) && e.category === "credential";
```

Di handler `PUT /config`, tepat setelah gate `bootstrap read-only`:

```ts
    if (agentBlocked(req, entry)) return reply.code(403).send({ error: "cookie session required" });
```

Di handler `DELETE /config/:key`, tepat setelah gate `bootstrap read-only`:

```ts
    if (agentBlocked(req, entry)) return reply.code(403).send({ error: "cookie session required" });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --no-file-parallelism server/test/config.route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/config.ts server/test/config.route.test.ts
git commit -m "feat(477): kategori config credential hanya bisa ditulis sesi cookie admin"
```

---

### Task 4: Entri registry Telegram + validasi pola

**Files:**
- Modify: `shared/src/telegram.ts` (pola validasi)
- Modify: `shared/src/config-registry.ts` (`ConfigEntry.pattern`, `parseConfigValue`, 4 entri grup `telegram`)
- Test: `shared/src/telegram.test.ts` (tambahan), `server/test/config-registry.test.ts` (tambahan)

**Interfaces:**
- Produces:
  - `TELEGRAM_BOT_TOKEN_PATTERN: RegExp`, `TELEGRAM_CHAT_ID_PATTERN: RegExp`, `TELEGRAM_ALLOWLIST_PATTERN: RegExp` (shared)
  - `TELEGRAM_CONFIG_KEYS: readonly ["HANOMAN_TELEGRAM_BOT_TOKEN", "HANOMAN_TELEGRAM_AGENT_TOKEN", "HANOMAN_TELEGRAM_ALLOWED_USER_IDS", "HANOMAN_TELEGRAM_TARGET_CHAT_ID"]` (shared, dipakai Task 5–7)
  - `ConfigEntry.pattern?: string` + `ConfigEntry.patternError?: string`

- [ ] **Step 1: Write the failing test**

Append ke `shared/src/telegram.test.ts`:

```ts
import { TELEGRAM_BOT_TOKEN_PATTERN, TELEGRAM_CHAT_ID_PATTERN, TELEGRAM_ALLOWLIST_PATTERN, TELEGRAM_CONFIG_KEYS } from "./telegram";

describe("SPEC-477 · pola kredensial Telegram", () => {
  it("bot token BotFather diterima, bentuk lain ditolak", () => {
    expect(TELEGRAM_BOT_TOKEN_PATTERN.test("123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw")).toBe(true);
    expect(TELEGRAM_BOT_TOKEN_PATTERN.test("abc")).toBe(false);
    expect(TELEGRAM_BOT_TOKEN_PATTERN.test("123456789")).toBe(false);          // tanpa ":"
    expect(TELEGRAM_BOT_TOKEN_PATTERN.test("123456789:pendek")).toBe(false);   // secret terlalu pendek
    expect(TELEGRAM_BOT_TOKEN_PATTERN.test(" 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw")).toBe(false);
  });

  // Gotcha 4 · channel & supergroup NEGATIF. Pola ^\d+$ menolak persis kasus "Channel ID"
  // yang diminta brief.
  it("chat id menerima negatif (channel/supergroup)", () => {
    expect(TELEGRAM_CHAT_ID_PATTERN.test("42")).toBe(true);
    expect(TELEGRAM_CHAT_ID_PATTERN.test("-1001234567890")).toBe(true);
    expect(TELEGRAM_CHAT_ID_PATTERN.test("@channel")).toBe(false);
    expect(TELEGRAM_CHAT_ID_PATTERN.test("")).toBe(false);
  });

  it("allowlist user id NON-negatif, boleh banyak, koma atau spasi", () => {
    expect(TELEGRAM_ALLOWLIST_PATTERN.test("7")).toBe(true);
    expect(TELEGRAM_ALLOWLIST_PATTERN.test("7,8 9")).toBe(true);
    expect(TELEGRAM_ALLOWLIST_PATTERN.test("-7")).toBe(false);
    expect(TELEGRAM_ALLOWLIST_PATTERN.test("")).toBe(false);
  });

  it("TELEGRAM_CONFIG_KEYS memuat keempat key", () => {
    expect([...TELEGRAM_CONFIG_KEYS]).toEqual([
      "HANOMAN_TELEGRAM_BOT_TOKEN", "HANOMAN_TELEGRAM_AGENT_TOKEN",
      "HANOMAN_TELEGRAM_ALLOWED_USER_IDS", "HANOMAN_TELEGRAM_TARGET_CHAT_ID",
    ]);
  });
});
```

Append ke `server/test/config-registry.test.ts` (di dalam `describe("config-registry", …)`):

```ts
  // SPEC-477 · ADR-0097 · kredensial Telegram pindah dari .env ke store config.
  it("SPEC-477 · empat entri Telegram terdaftar dengan kind & category yang benar", () => {
    const byKey = (k: string) => CONFIG_REGISTRY.find((e) => e.key === k)!;
    for (const k of ["HANOMAN_TELEGRAM_BOT_TOKEN", "HANOMAN_TELEGRAM_AGENT_TOKEN"]) {
      expect(byKey(k).kind).toBe("secret");
      expect(byKey(k).category).toBe("credential");
      expect(byKey(k).group).toBe("telegram");
      expect(byKey(k).apply).toBe("live");
    }
    // allowlist BUKAN rahasia (operator harus bisa membacanya kembali) tapi ia memutuskan siapa
    // yang boleh memerintah bot → kategori credential agar ikut pagar cookie-only.
    expect(byKey("HANOMAN_TELEGRAM_ALLOWED_USER_IDS").kind).toBe("string");
    expect(byKey("HANOMAN_TELEGRAM_ALLOWED_USER_IDS").category).toBe("credential");
    expect(byKey("HANOMAN_TELEGRAM_TARGET_CHAT_ID").category).toBe("knob");
  });

  it("SPEC-477 · parseConfigValue menegakkan pattern", () => {
    const tok = configEntry("HANOMAN_TELEGRAM_BOT_TOKEN")!;
    expect(parseConfigValue(tok, "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"))
      .toEqual({ ok: true, value: "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw" });
    expect(parseConfigValue(tok, "bukan-token").ok).toBe(false);
    const chat = configEntry("HANOMAN_TELEGRAM_TARGET_CHAT_ID")!;
    expect(parseConfigValue(chat, "-1001234567890")).toEqual({ ok: true, value: "-1001234567890" });
    expect(parseConfigValue(chat, "@kanal").ok).toBe(false);
    // entri tanpa pattern tak berubah perilakunya
    expect(parseConfigValue(configEntry("HANOMAN_CLAUDE_BIN")!, "claude")).toEqual({ ok: true, value: "claude" });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --no-file-parallelism shared/src/telegram.test.ts server/test/config-registry.test.ts`
Expected: FAIL — `TELEGRAM_BOT_TOKEN_PATTERN` tak ter-ekspor; `configEntry("HANOMAN_TELEGRAM_BOT_TOKEN")` `undefined`

- [ ] **Step 3: Write minimal implementation**

Di `shared/src/telegram.ts`, tepat di bawah `export const TELEGRAM_DEFAULTS`:

```ts
/**
 * SPEC-477 · ADR-0097 · pola kredensial. Gerbang TULIS saja — nilai yang datang dari `.env`
 * sengaja tak divalidasi: instance yang hidup hari ini dengan token berbentuk tak terduga harus
 * tetap hidup.
 */
export const TELEGRAM_BOT_TOKEN_PATTERN = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
/** Channel & supergroup NEGATIF — `^\d+$` akan menolak persis kasus "Channel ID". */
export const TELEGRAM_CHAT_ID_PATTERN = /^-?\d+$/;
/** Allowlist adalah numeric USER id: selalu non-negatif, dipisah koma/spasi. */
export const TELEGRAM_ALLOWLIST_PATTERN = /^\d+(?:[\s,]+\d+)*$/;

export const TELEGRAM_CONFIG_KEYS = [
  "HANOMAN_TELEGRAM_BOT_TOKEN",
  "HANOMAN_TELEGRAM_AGENT_TOKEN",
  "HANOMAN_TELEGRAM_ALLOWED_USER_IDS",
  "HANOMAN_TELEGRAM_TARGET_CHAT_ID",
] as const;
export type TelegramConfigKey = (typeof TELEGRAM_CONFIG_KEYS)[number];
```

Di `shared/src/config-registry.ts`, tambahkan dua field ke `ConfigEntry` (setelah `min?`/`max?`):

```ts
  pattern?: string;       // SPEC-477 · regex sumber untuk string|secret|path; ditegakkan parseConfigValue
  patternError?: string;  // pesan yang dilihat operator saat pattern tak cocok
```

Tambahkan grup `telegram` ke `CONFIG_REGISTRY`, tepat setelah blok `// github`:

```ts
  // telegram (SPEC-477 · ADR-0097 · kredensial gateway pindah dari .env ke store config).
  // `.env` lama tetap bekerja: resolver = DB → env → default, dan `sourceOf()` menandainya.
  { key: "HANOMAN_TELEGRAM_BOT_TOKEN", group: "telegram", label: "Bot token", kind: "secret", apply: "live", category: "credential",
    pattern: "^\\d{5,}:[A-Za-z0-9_-]{30,}$", patternError: "format BotFather: <bot_id>:<secret>",
    help: "Token dari BotFather. Disimpan terenkripsi; tak pernah dikembalikan utuh." },
  { key: "HANOMAN_TELEGRAM_AGENT_TOKEN", group: "telegram", label: "AgentToken gateway", kind: "secret", apply: "live", category: "credential",
    pattern: "^\\S{20,}$", patternError: "plaintext AgentToken (hnm_agt_…)",
    help: "Plaintext AgentToken ber-capability Telegram. Dipakai session operator, bukan bot." },
  { key: "HANOMAN_TELEGRAM_ALLOWED_USER_IDS", group: "telegram", label: "Allowlist user id", kind: "string", apply: "live", category: "credential",
    pattern: "^\\d+(?:[\\s,]+\\d+)*$", patternError: "numeric user id, dipisah koma/spasi",
    help: "Siapa yang boleh memerintah bot. Numeric Telegram user id, bukan username." },
  { key: "HANOMAN_TELEGRAM_TARGET_CHAT_ID", group: "telegram", label: "Chat / Channel ID target", kind: "string", apply: "live", category: "knob",
    pattern: "^-?\\d+$", patternError: "numeric chat id (channel/supergroup negatif)",
    help: "Tujuan Test Connection. Kosong = pakai satu-satunya id di allowlist." },
```

Di `parseConfigValue`, ganti cabang `default:`:

```ts
    default: // string | path | secret
      if (v.length === 0) return { ok: false, error: "tak boleh kosong" };
      if (entry.pattern && !new RegExp(entry.pattern).test(v)) {
        return { ok: false, error: entry.patternError ?? "format tidak valid" };
      }
      return { ok: true, value: v };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --no-file-parallelism shared/src/telegram.test.ts server/test/config-registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/src/telegram.ts shared/src/config-registry.ts shared/src/telegram.test.ts server/test/config-registry.test.ts
git commit -m "feat(477): entri config Telegram + validasi pola di parseConfigValue"
```

---

### Task 5: Bootstrap membaca resolver + reload tanpa restart

**Files:**
- Modify: `server/src/services/telegram/bootstrap.ts`
- Modify: `server/src/server.ts` (urutan boot)
- Modify: `server/src/services/config-apply.ts` (side-effect key `telegram`)
- Test: `server/test/telegram-bootstrap-config.test.ts` (create)

**Interfaces:**
- Consumes: `effectiveStr` (Task 2), `TELEGRAM_CONFIG_KEYS` (Task 4), `stopTelegramRuntime` (existing)
- Produces:
  - `installTelegramGateway(app, options)` — `options.read?: (key: string) => string | undefined` (default `effectiveStr`)
  - `reloadTelegramGateway(): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `server/test/telegram-bootstrap-config.test.ts`:

```ts
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { loadConfig, setConfig } from "../src/config";
import { DEFAULT_SETTING } from "../src/services/settings";
import { installTelegramGateway, reloadTelegramGateway } from "../src/services/telegram/bootstrap";
import { clearTelegramRuntime, telegramRuntimeStatus } from "../src/services/telegram/runtime";

const app = buildApp();
const TOKEN_DB = "111111:DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";
const TOKEN_ENV = "222222:EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
const AGENT = "hnm_agt_dummy_token_value_123456";

const clean = async () => {
  clearTelegramRuntime();
  await prisma.runtimeConfig.deleteMany();
  await prisma.setting.deleteMany();
  await loadConfig();
};

beforeEach(async () => {
  await clean();
  await prisma.setting.create({ data: { id: 1, data: { ...DEFAULT_SETTING, agentAccessEnabled: true, telegram: { enabled: true, progress: true } } } });
  for (const k of ["HANOMAN_TELEGRAM_BOT_TOKEN", "HANOMAN_TELEGRAM_AGENT_TOKEN", "HANOMAN_TELEGRAM_ALLOWED_USER_IDS"]) delete process.env[k];
});
afterEach(() => { for (const k of ["HANOMAN_TELEGRAM_BOT_TOKEN", "HANOMAN_TELEGRAM_AGENT_TOKEN", "HANOMAN_TELEGRAM_ALLOWED_USER_IDS"]) delete process.env[k]; });
afterAll(async () => { await clean(); await app.close(); });

// Factory palsu: merekam token yang dipakai, gateway-nya no-op.
function recorder() {
  const seen: { botToken: string; agentToken: string; allowlist: string[] }[] = [];
  const stops: string[] = [];
  const factory = async (input: { botToken: string; agentToken: string; allowedUserIds: ReadonlySet<string> }) => {
    seen.push({ botToken: input.botToken, agentToken: input.agentToken, allowlist: [...input.allowedUserIds] });
    return { gateway: { start: async () => {}, stop: async () => { stops.push(input.botToken); } }, botUsername: "bot_uji" };
  };
  return { seen, stops, factory };
}

const verify = async () => ({ id: "agt1", capabilities: [...(await import("../src/services/telegram/bootstrap")).TELEGRAM_REQUIRED_CAPABILITIES] });

describe("SPEC-477 · bootstrap Telegram membaca store config", () => {
  it("nilai DB MENANG atas .env", async () => {
    process.env.HANOMAN_TELEGRAM_BOT_TOKEN = TOKEN_ENV;
    await setConfig("HANOMAN_TELEGRAM_BOT_TOKEN", TOKEN_DB);
    await setConfig("HANOMAN_TELEGRAM_AGENT_TOKEN", AGENT);
    await setConfig("HANOMAN_TELEGRAM_ALLOWED_USER_IDS", "7 8");
    const { seen, factory } = recorder();
    await installTelegramGateway(app, { apiBase: "http://127.0.0.1:1", factory, verifyAgentToken: verify });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.botToken).toBe(TOKEN_DB);
    expect(seen[0]!.allowlist).toEqual(["7", "8"]);
    expect(telegramRuntimeStatus().running).toBe(true);
  });

  // Backward compatible: instance yang hari ini hidup dari .env tak boleh mati karena spec ini.
  it("DB kosong → .env dipakai apa adanya", async () => {
    process.env.HANOMAN_TELEGRAM_BOT_TOKEN = TOKEN_ENV;
    process.env.HANOMAN_TELEGRAM_AGENT_TOKEN = AGENT;
    process.env.HANOMAN_TELEGRAM_ALLOWED_USER_IDS = "9";
    const { seen, factory } = recorder();
    await installTelegramGateway(app, { apiBase: "http://127.0.0.1:1", factory, verifyAgentToken: verify });
    expect(seen[0]!.botToken).toBe(TOKEN_ENV);
  });

  it("reload MENGHENTIKAN gateway lama sebelum memulai yang baru", async () => {
    await setConfig("HANOMAN_TELEGRAM_BOT_TOKEN", TOKEN_DB);
    await setConfig("HANOMAN_TELEGRAM_AGENT_TOKEN", AGENT);
    await setConfig("HANOMAN_TELEGRAM_ALLOWED_USER_IDS", "7");
    const { seen, stops, factory } = recorder();
    await installTelegramGateway(app, { apiBase: "http://127.0.0.1:1", factory, verifyAgentToken: verify });
    await setConfig("HANOMAN_TELEGRAM_BOT_TOKEN", TOKEN_ENV);
    await reloadTelegramGateway();
    expect(stops).toEqual([TOKEN_DB]);
    expect(seen.map((s) => s.botToken)).toEqual([TOKEN_DB, TOKEN_ENV]);
  });

  it("kredensial dihapus → reload berhenti dengan readiness misconfigured", async () => {
    await setConfig("HANOMAN_TELEGRAM_BOT_TOKEN", TOKEN_DB);
    await setConfig("HANOMAN_TELEGRAM_AGENT_TOKEN", AGENT);
    await setConfig("HANOMAN_TELEGRAM_ALLOWED_USER_IDS", "7");
    const { stops, factory } = recorder();
    await installTelegramGateway(app, { apiBase: "http://127.0.0.1:1", factory, verifyAgentToken: verify });
    const { clearConfig } = await import("../src/config");
    for (const k of ["HANOMAN_TELEGRAM_BOT_TOKEN", "HANOMAN_TELEGRAM_AGENT_TOKEN", "HANOMAN_TELEGRAM_ALLOWED_USER_IDS"]) await clearConfig(k);
    await reloadTelegramGateway();
    expect(stops).toEqual([TOKEN_DB]);
    expect(telegramRuntimeStatus().readiness).toBe("misconfigured");
    expect(telegramRuntimeStatus().running).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --no-file-parallelism server/test/telegram-bootstrap-config.test.ts`
Expected: FAIL — `reloadTelegramGateway is not a function`; test pertama juga gagal karena `botToken` masih `TOKEN_ENV`

- [ ] **Step 3: Write minimal implementation**

Di `server/src/services/telegram/bootstrap.ts`:

Tambahkan impor:

```ts
import { effectiveStr } from "../../config";
```

Ganti tipe `BootstrapOptions` (tambah `read`; **`env` DIPERTAHANKAN** — empat call site di
`server/test/telegram-lifecycle.test.ts` memakainya sebagai seam, dan mencabutnya menukar fitur ini
dengan empat test merah yang tak ada hubungannya):

```ts
type BootstrapOptions = {
  apiBase: string;
  /**
   * SPEC-477 · ADR-0097 · kredensial datang dari resolver config (DB → env → default), BUKAN
   * `process.env` langsung. Itulah yang membuat Settings menang atas `.env` sekaligus menjaga
   * instance lama tetap hidup. `env` (seam lama SPEC-476) tetap didukung dan berarti
   * "baca dari peta ini".
   */
  read?: (key: string) => string | undefined;
  env?: Record<string, string | undefined>;
  getSetting?: () => Promise<Setting>;
  verifyAgentToken?: (token: string) => Promise<RuntimeAgent | null>;
  factory?: TelegramGatewayFactory;
};
```

Ganti `configuredFrom`:

```ts
type ReadConfig = (key: string) => string | undefined;

const configuredFrom = (read: ReadConfig): boolean =>
  Boolean(read("HANOMAN_TELEGRAM_BOT_TOKEN")?.trim()
    && read("HANOMAN_TELEGRAM_ALLOWED_USER_IDS")?.trim()
    && read("HANOMAN_TELEGRAM_AGENT_TOKEN")?.trim());
```

Di `installTelegramGateway`, ganti empat baris pembacaan env:

```ts
export async function installTelegramGateway(_app: FastifyInstance, options: BootstrapOptions): Promise<void> {
  lastBootstrap = { app: _app, options };            // untuk reload (di bawah)
  const env = options.env;
  const read = options.read ?? (env ? (key: string) => env[key] : effectiveStr);
  const setting = await (options.getSetting ?? getSettingReal)();
  const configured = configuredFrom(read);
  const base = {
    configured,
    enabled: setting.telegram.enabled,
    running: false,
    botUsername: null,
    allowlistCount: 0,
    agentTokenConfigured: Boolean(read("HANOMAN_TELEGRAM_AGENT_TOKEN")?.trim()),
    missingCapabilities: [] as string[],
    lastUpdateAt: null,
    lastError: null,
  };
```

…lalu ganti tiga pemakaian `env.X!` yang tersisa dengan `read("X")!`:

```ts
    allowedUserIds = parseTelegramAllowedUserIds(read("HANOMAN_TELEGRAM_ALLOWED_USER_IDS")!);
```
```ts
  const agent = setting.agentAccessEnabled ? await verify(read("HANOMAN_TELEGRAM_AGENT_TOKEN")!) : null;
```
```ts
      botToken: read("HANOMAN_TELEGRAM_BOT_TOKEN")!,
      agentToken: read("HANOMAN_TELEGRAM_AGENT_TOKEN")!,
```

Hapus baris lama `const env = options.env ?? process.env;` — **fallback ke `process.env` dicabut**;
tanpa `env` maupun `read` eksplisit, sumbernya kini resolver config.

Tambahkan di akhir berkas:

```ts
// Pemasangan terakhir, supaya reload bisa memakai apiBase & port yang sama tanpa server.ts
// menyimpannya sendiri.
let lastBootstrap: { app: FastifyInstance; options: BootstrapOptions } | null = null;

/**
 * SPEC-477 · ADR-0097 · terapkan perubahan kredensial/toggle TANPA restart proses.
 * Menghentikan gateway lama dulu: satu bot hanya boleh dipoll satu proses (ADR-0096 konsekuensi 1),
 * dan dua loop `getUpdates` atas token yang sama akan saling mencuri update (Telegram 409).
 */
export async function reloadTelegramGateway(): Promise<void> {
  if (!lastBootstrap) return;
  await stopTelegramRuntime();
  await installTelegramGateway(lastBootstrap.app, lastBootstrap.options);
}
```

…dan tambahkan `stopTelegramRuntime` ke impor `./runtime`:

```ts
import { registerTelegramRuntimeStop, setTelegramRuntime, stopTelegramRuntime } from "./runtime";
```

Di `server/src/services/config-apply.ts`, tambahkan di `applyConfigSideEffect` sebelum baris `if (configEntry(key)?.inheritEnv)`:

```ts
  // SPEC-477 · ADR-0097 · kredensial Telegram berlaku langsung: gateway dipasang ulang in-process.
  if (configEntry(key)?.group === "telegram") {
    const { reloadTelegramGateway } = await import("./telegram/bootstrap");
    await reloadTelegramGateway();
    return;
  }
```

Di `server/src/server.ts`, **naikkan** blok config ke atas `installTelegramGateway` dan `await`-kan:

```ts
  // SPEC-477 · ADR-0097 · WAJIB sebelum installTelegramGateway: gateway kini membaca kredensialnya
  // lewat resolver config, dan cache config yang masih kosong membuatnya diam-diam jatuh ke env
  // saja — kegagalan yang SENYAP dan tampak benar.
  {
    const { loadConfig } = await import("./config");
    const { applyConfigOnBoot } = await import("./services/config-apply");
    await loadConfig();
    await applyConfigOnBoot();
  }
  const boundPort = (app.server.address() as AddressInfo).port;
  await installTelegramGateway(app, { apiBase: `http://127.0.0.1:${boundPort}` });
```

…dan **hapus** blok `void (async () => { … loadConfig … applyConfigOnBoot … })()` yang lama di akhir.

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --no-file-parallelism server/test/telegram-bootstrap-config.test.ts server/test/telegram-lifecycle.test.ts server/test/config-apply.test.ts`
Expected: PASS — semua hijau

- [ ] **Step 5: Commit**

```bash
git add server/src/services/telegram/bootstrap.ts server/src/services/config-apply.ts server/src/server.ts server/test/telegram-bootstrap-config.test.ts
git commit -m "feat(477): gateway Telegram membaca store config + reload tanpa restart"
```

---

### Task 6: Endpoint kredensial + Test Connection + hapus (COOKIE_ONLY)

**Files:**
- Create: `server/src/services/telegram/credentials.ts`
- Modify: `server/src/routes/telegram.ts`
- Modify: `server/src/services/agent-capabilities.ts`
- Modify: `server/src/routes/settings.ts` (reload saat blok `telegram` berubah)
- Modify: `shared/src/api.ts` (paths + tipe view)
- Test: `server/test/telegram-credentials.test.ts` (create), `server/test/agent-capabilities.test.ts` (tambahan)

**Interfaces:**
- Consumes: `effectiveStr`/`rawDbValue`/`sourceOf`/`setConfig`/`clearConfig` (Task 2), `configEntry`/`parseConfigValue`/`maskSecret`/`TELEGRAM_CONFIG_KEYS` (Task 4), `reloadTelegramGateway` (Task 5), `sanitizeTelegramOutput` (existing), `TelegramApiClient` (existing)
- Produces:
  - `telegramCredentialView(): TelegramCredentialsView`
  - `saveTelegramCredentials(patch: Record<string, string>): { ok: true } | { ok: false; key: string; error: string }`
  - `clearTelegramCredentials(): { cleared: string[]; envFallback: string[] }`
  - `testTelegramConnection(deps): Promise<TelegramTestResult>`
  - shared: `paths.telegramSettings`, `paths.telegramTest`, `paths.telegramCredentials`, tipe `TelegramCredentialField`, `TelegramCredentialsView`, `TelegramTestResult`

- [ ] **Step 1: Write the failing test**

Create `server/test/telegram-credentials.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { clearConfig, loadConfig, setConfig } from "../src/config";
import { DEFAULT_SETTING } from "../src/services/settings";
import { issueAgentToken } from "../src/services/agent-token";
import { clearTelegramRuntime } from "../src/services/telegram/runtime";
import { testTelegramConnection } from "../src/services/telegram/credentials";

const app = buildApp();
const TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";
const AGENT = "hnm_agt_dummy_token_value_123456";

const cookieOf = (r: { headers: Record<string, unknown> }) => (r.headers["set-cookie"] as string).split(";")[0];
async function login() {
  return cookieOf(await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "a@b.co", password: "password1" } }));
}

const clean = async () => {
  clearTelegramRuntime();
  await prisma.runtimeConfig.deleteMany();
  await prisma.agentToken.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.setting.deleteMany();
  for (const k of ["HANOMAN_TELEGRAM_BOT_TOKEN", "HANOMAN_TELEGRAM_TARGET_CHAT_ID"]) delete process.env[k];
  await loadConfig();
};
beforeEach(clean);
afterAll(async () => { await clean(); await app.close(); });

describe("SPEC-477 · GET/PUT/DELETE kredensial Telegram", () => {
  it("GET memasked bot token dan TAK PERNAH memuat plaintext-nya", async () => {
    const cookie = await login();
    await setConfig("HANOMAN_TELEGRAM_BOT_TOKEN", TOKEN);
    const r = await app.inject({ method: "GET", url: "/api/telegram/settings", headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain(TOKEN);
    const field = r.json().fields.find((f: { key: string }) => f.key === "HANOMAN_TELEGRAM_BOT_TOKEN");
    expect(field.masked).toBe("••••Dsaw");
    expect(field.hasValue).toBe(true);
    expect(field.value).toBeUndefined();
    expect(field.source).toBe("db");
  });

  it("GET menandai nilai yang masih datang dari .env sebagai deprecated", async () => {
    const cookie = await login();
    process.env.HANOMAN_TELEGRAM_BOT_TOKEN = TOKEN;
    const r = await app.inject({ method: "GET", url: "/api/telegram/settings", headers: { cookie } });
    const field = r.json().fields.find((f: { key: string }) => f.key === "HANOMAN_TELEGRAM_BOT_TOKEN");
    expect(field.source).toBe("env");
    expect(field.hasValue).toBe(true);
  });

  it("PUT menyimpan, dan secret kosong = pertahankan nilai lama", async () => {
    const cookie = await login();
    await app.inject({ method: "PUT", url: "/api/telegram/settings", headers: { cookie },
      payload: { HANOMAN_TELEGRAM_BOT_TOKEN: TOKEN, HANOMAN_TELEGRAM_ALLOWED_USER_IDS: "7" } });
    await app.inject({ method: "PUT", url: "/api/telegram/settings", headers: { cookie },
      payload: { HANOMAN_TELEGRAM_BOT_TOKEN: "", HANOMAN_TELEGRAM_TARGET_CHAT_ID: "-1001234567890" } });
    const r = await app.inject({ method: "GET", url: "/api/telegram/settings", headers: { cookie } });
    const fields = r.json().fields as { key: string; hasValue?: boolean; value?: string }[];
    expect(fields.find((f) => f.key === "HANOMAN_TELEGRAM_BOT_TOKEN")!.hasValue).toBe(true);
    expect(fields.find((f) => f.key === "HANOMAN_TELEGRAM_TARGET_CHAT_ID")!.value).toBe("-1001234567890");
  });

  it("PUT format salah → 400 dan DB tak tersentuh", async () => {
    const cookie = await login();
    const r = await app.inject({ method: "PUT", url: "/api/telegram/settings", headers: { cookie },
      payload: { HANOMAN_TELEGRAM_BOT_TOKEN: "bukan-token" } });
    expect(r.statusCode).toBe(400);
    expect(await prisma.runtimeConfig.findUnique({ where: { key: "HANOMAN_TELEGRAM_BOT_TOKEN" } })).toBeNull();
  });

  it("PUT key di luar daftar Telegram ditolak", async () => {
    const cookie = await login();
    const r = await app.inject({ method: "PUT", url: "/api/telegram/settings", headers: { cookie },
      payload: { GITHUB_TOKEN: "ghp_x" } });
    expect(r.statusCode).toBe(400);
  });

  it("DELETE mengosongkan DB dan melaporkan envFallback yang tersisa", async () => {
    const cookie = await login();
    await setConfig("HANOMAN_TELEGRAM_BOT_TOKEN", TOKEN);
    process.env.HANOMAN_TELEGRAM_TARGET_CHAT_ID = "42";
    const r = await app.inject({ method: "DELETE", url: "/api/telegram/credentials", headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json().cleared).toContain("HANOMAN_TELEGRAM_BOT_TOKEN");
    expect(r.json().envFallback).toEqual(["HANOMAN_TELEGRAM_TARGET_CHAT_ID"]);
    expect(await prisma.runtimeConfig.count()).toBe(0);
  });

  it("agent token ber-telegram:write ditolak di ketiga endpoint", async () => {
    await prisma.setting.create({ data: { id: 1, data: { ...DEFAULT_SETTING, agentAccessEnabled: true } } });
    const { token } = await issueAgentToken({ name: "tg", capabilities: ["telegram:read", "telegram:write", "settings:write"] });
    const headers = { authorization: `Bearer ${token}` };
    for (const [method, url] of [["GET", "/api/telegram/settings"], ["PUT", "/api/telegram/settings"], ["POST", "/api/telegram/test"], ["DELETE", "/api/telegram/credentials"]] as const) {
      expect((await app.inject({ method, url, headers, payload: {} })).statusCode).toBe(403);
    }
  });
});

describe("SPEC-477 · Test Connection", () => {
  const base = { botToken: TOKEN, chatId: "42" };

  it("sukses mengembalikan username bot & chat tujuan", async () => {
    const transport = async (url: string) => new Response(JSON.stringify(
      url.includes("/getMe") ? { ok: true, result: { id: 1, is_bot: true, first_name: "H", username: "bot_uji" } }
        : { ok: true, result: { message_id: 5, date: 0, chat: { id: 42, type: "private" } } },
    ), { status: 200 });
    await expect(testTelegramConnection({ ...base, transport })).resolves.toEqual({
      ok: true, botUsername: "bot_uji", chatId: "42",
    });
  });

  it("401 → ok:false TANPA token di pesan galat", async () => {
    const transport = async () => new Response(JSON.stringify({ ok: false, error_code: 401, description: `bad token ${TOKEN}` }), { status: 200 });
    const result = await testTelegramConnection({ ...base, transport });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  // "Test Connection harus punya timeout dan tidak boleh menggantung UI."
  it("transport yang tak pernah selesai dibatalkan, bukan menggantung", async () => {
    const transport = (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, rejectFn) => {
      init?.signal?.addEventListener("abort", () => rejectFn(new Error("aborted")));
    });
    const result = await testTelegramConnection({ ...base, transport, timeoutMs: 20 });
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty("error");
  }, 2_000);
});
```

Append ke `server/test/agent-capabilities.test.ts`:

```ts
  // SPEC-477 · ADR-0097 · permukaan kredensial BUKAN permukaan kerja sesi operator.
  it("SPEC-477 · settings/test/credentials Telegram = COOKIE_ONLY, sisanya tetap domain telegram", () => {
    expect(capabilityForRoute("GET", "/api/telegram/settings")).toBe("COOKIE_ONLY");
    expect(capabilityForRoute("PUT", "/api/telegram/settings")).toBe("COOKIE_ONLY");
    expect(capabilityForRoute("POST", "/api/telegram/test")).toBe("COOKIE_ONLY");
    expect(capabilityForRoute("DELETE", "/api/telegram/credentials")).toBe("COOKIE_ONLY");
    expect(capabilityForRoute("GET", "/api/telegram/status")).toBe("telegram:read");
    expect(capabilityForRoute("POST", "/api/telegram/replies")).toBe("telegram:write");
    expect(capabilityForRoute("GET", "/api/telegram/audit")).toBe("telegram:read");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --no-file-parallelism server/test/telegram-credentials.test.ts server/test/agent-capabilities.test.ts`
Expected: FAIL — `Failed to resolve import ".../telegram/credentials"`; route `404`

- [ ] **Step 3: Write minimal implementation**

**3a.** Create `server/src/services/telegram/credentials.ts`:

```ts
import { configEntry, maskSecret, parseConfigValue, TELEGRAM_CONFIG_KEYS, type TelegramConfigKey } from "@hanoman/shared";
import { clearConfig, effectiveStr, setConfig, sourceOf } from "../../config";
import { TelegramApiClient, type TelegramTransport } from "./client";
import { sanitizeTelegramOutput } from "./protocol";

export type TelegramCredentialField = {
  key: TelegramConfigKey;
  label: string;
  help?: string;
  kind: "secret" | "string";
  source: "db" | "env" | "default";
  hasValue: boolean;
  masked?: string | null;   // hanya kind secret
  value?: string | null;    // hanya kind non-secret
};
export type TelegramCredentialsView = { fields: TelegramCredentialField[] };
export type TelegramTestResult =
  | { ok: true; botUsername: string | null; chatId: string }
  | { ok: false; error: string };

const KEYS = TELEGRAM_CONFIG_KEYS;

/** Bot token & AgentToken TAK PERNAH keluar utuh — hanya `masked` + `hasValue`. */
export function telegramCredentialView(): TelegramCredentialsView {
  return {
    fields: KEYS.map((key) => {
      const entry = configEntry(key)!;
      const eff = effectiveStr(key);
      const base = {
        key, label: entry.label, help: entry.help,
        source: sourceOf(key), hasValue: eff !== undefined && eff !== "",
      };
      return entry.kind === "secret"
        ? { ...base, kind: "secret" as const, masked: eff ? maskSecret(eff) : null }
        : { ...base, kind: "string" as const, value: eff ?? null };
    }),
  };
}

/**
 * Secret dengan string kosong = PERTAHANKAN nilai lama (cermin `PUT /config`), sehingga form
 * bisa dikirim ulang tanpa mengetik ulang token. Validasi lewat `parseConfigValue` — satu jalur
 * dengan `PUT /config`, jadi tak ada dua definisi "token yang sah".
 */
export async function saveTelegramCredentials(
  patch: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; key: string; error: string }> {
  const writes: [TelegramConfigKey, string][] = [];
  for (const [key, raw] of Object.entries(patch)) {
    if (!(KEYS as readonly string[]).includes(key)) return { ok: false, key, error: "key bukan kredensial Telegram" };
    if (typeof raw !== "string") return { ok: false, key, error: "nilai harus string" };
    const entry = configEntry(key)!;
    if (raw.trim() === "") {
      if (entry.kind === "secret") continue;                       // pertahankan yang lama
      return { ok: false, key, error: "tak boleh kosong" };
    }
    const parsed = parseConfigValue(entry, raw);
    if (!parsed.ok) return { ok: false, key, error: parsed.error };
    writes.push([key as TelegramConfigKey, parsed.value]);
  }
  // Validasi SELURUH patch dulu, baru tulis: satu field salah tak boleh meninggalkan
  // separuh kredensial tersimpan.
  for (const [key, value] of writes) await setConfig(key, value);
  return { ok: true };
}

/**
 * Nilai `.env` lama, bila ada, akan dipakai KEMBALI oleh resolver sesudah baris DB dihapus —
 * itu memang semantik ADR-0049. Dilaporkan eksplisit supaya tak jadi kejutan diam.
 */
export async function clearTelegramCredentials(): Promise<{ cleared: string[]; envFallback: string[] }> {
  const cleared: string[] = [];
  for (const key of KEYS) {
    if (sourceOf(key) === "db") { await clearConfig(key); cleared.push(key); }
  }
  return { cleared, envFallback: KEYS.filter((k) => sourceOf(k) === "env") };
}

export type TestConnectionDeps = {
  botToken?: string;
  chatId?: string;
  transport?: TelegramTransport;
  timeoutMs?: number;
  now?: () => Date;
};

/**
 * Klien SEKALI PAKAI — bukan klien gateway yang sedang long-poll. Klien itu memegang
 * `AbortController` loop-nya; menumpang di sana menukar "uji koneksi" dengan "putuskan polling".
 */
export async function testTelegramConnection(deps: TestConnectionDeps = {}): Promise<TelegramTestResult> {
  const botToken = deps.botToken ?? effectiveStr("HANOMAN_TELEGRAM_BOT_TOKEN");
  if (!botToken) return { ok: false, error: "Bot token belum diisi." };
  const chatId = deps.chatId ?? resolveTestChatId();
  if (!chatId) {
    return { ok: false, error: "Isi Chat / Channel ID target — atau isi allowlist dengan tepat satu user id." };
  }
  const timeoutMs = deps.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const transport: TelegramTransport = (url, init) =>
    (deps.transport ?? ((u, i) => fetch(u, i)))(url, { ...init, signal: controller.signal });
  const client = new TelegramApiClient(botToken, transport);
  try {
    const me = await client.getMe();
    const stamp = (deps.now?.() ?? new Date()).toISOString();
    await client.sendMessage({ chatId, text: `hanoman: uji koneksi Telegram berhasil (${stamp}).` });
    return { ok: true, botUsername: me.username ?? null, chatId };
  } catch (error) {
    const raw = (error as Error).message || "gagal menghubungi Telegram";
    const message = controller.signal.aborted ? `Timeout ${timeoutMs} ms — Telegram tidak menjawab.` : raw;
    // Lapis kedua di atas `TelegramApiClient.safe()`: token & pola credential dibuang total.
    return { ok: false, error: sanitizeTelegramOutput(message, [botToken]).slice(0, 500) };
  } finally {
    clearTimeout(timer);
  }
}

/** Target = field khusus, atau — bila kosong — satu-satunya id di allowlist. */
function resolveTestChatId(): string | null {
  const target = effectiveStr("HANOMAN_TELEGRAM_TARGET_CHAT_ID")?.trim();
  if (target) return target;
  const ids = (effectiveStr("HANOMAN_TELEGRAM_ALLOWED_USER_IDS") ?? "").split(/[\s,]+/).filter(Boolean);
  return ids.length === 1 ? ids[0]! : null;
}
```

**3b.** Di `server/src/routes/telegram.ts`, tambahkan impor & empat handler **di awal** `telegramRoutes` (sebelum `/telegram/status`):

```ts
import {
  clearTelegramCredentials, saveTelegramCredentials, telegramCredentialView, testTelegramConnection,
} from "../services/telegram/credentials";
import { reloadTelegramGateway } from "../services/telegram/bootstrap";
```

```ts
  // SPEC-477 · ADR-0097 · permukaan kredensial: COOKIE_ONLY (lihat capabilityForRoute).
  app.get("/telegram/settings", async () => telegramCredentialView());

  app.put("/telegram/settings", async (req, reply) => {
    const body = typeof req.body === "object" && req.body !== null ? req.body as Record<string, unknown> : {};
    const saved = await saveTelegramCredentials(body);
    if (!saved.ok) return reply.code(400).send({ error: saved.error, key: saved.key });
    await reloadTelegramGateway();
    return telegramCredentialView();
  });

  app.post("/telegram/test", async () => testTelegramConnection());

  app.delete("/telegram/credentials", async () => {
    const result = await clearTelegramCredentials();
    await reloadTelegramGateway();
    return result;
  });
```

**3c.** Di `server/src/services/agent-capabilities.ts`, ganti baris `if (top === "telegram") return rw("telegram");`:

```ts
  // SPEC-477 · ADR-0097 · permukaan KREDENSIAL bukan permukaan kerja sesi operator: ia menyimpan
  // bot token & AgentToken, jadi agent token mana pun (termasuk milik gateway itu sendiri) tak
  // boleh menyentuhnya. Sub-path lain `/telegram/*` tetap domain `telegram` seperti ADR-0096.
  if (top === "telegram") {
    const sub = seg[1] ?? "";
    if (sub === "settings" || sub === "test" || sub === "credentials") return "COOKIE_ONLY";
    return rw("telegram");
  }
```

**3d.** Di `server/src/routes/settings.ts`, reload saat blok `telegram` berubah:

```ts
import type { FastifyInstance } from "fastify";
import { zSetting } from "@hanoman/shared";
import { prisma } from "../db";
import { getSetting } from "../services/settings";
import { reloadTelegramGateway } from "../services/telegram/bootstrap";

export default async function (app: FastifyInstance) {
  app.get("/settings", async () => getSetting());
  app.put("/settings", async (req, reply) => {
    const parsed = zSetting.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const before = await getSetting();
    const row = await prisma.setting.upsert({ where: { id: 1 },
      update: { data: parsed.data }, create: { id: 1, data: parsed.data } });
    // SPEC-477 · ADR-0097 · toggle gateway berlaku LANGSUNG. Dibandingkan dulu supaya PUT
    // settings yang tak menyentuh Telegram tak memutus long-poll yang sedang berjalan.
    if (JSON.stringify(before.telegram) !== JSON.stringify(parsed.data.telegram)) {
      await reloadTelegramGateway();
    }
    return row.data;
  });
}
```

**3e.** Di `shared/src/api.ts`, tambahkan di objek `paths` setelah `telegramAudit`:

```ts
  telegramSettings: `${API}/telegram/settings`,
  telegramTest: `${API}/telegram/test`,
  telegramCredentials: `${API}/telegram/credentials`,
```

…dan tipe view setelah `ConfigResponse`:

```ts
// SPEC-477 · ADR-0097 · view kredensial Telegram. Secret: tanpa `value`, pakai `masked`+`hasValue`.
export type TelegramCredentialFieldView = {
  key: string; label: string; help?: string;
  kind: "secret" | "string";
  source: "db" | "env" | "default";
  hasValue: boolean;
  masked?: string | null;
  value?: string | null;
};
export type TelegramCredentialsView = { fields: TelegramCredentialFieldView[] };
export type TelegramTestResult =
  | { ok: true; botUsername: string | null; chatId: string }
  | { ok: false; error: string };
export type TelegramClearResult = { cleared: string[]; envFallback: string[] };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --no-file-parallelism server/test/telegram-credentials.test.ts server/test/agent-capabilities.test.ts server/test/telegram-routes.test.ts server/test/settings.route.test.ts`
Expected: PASS (bila `settings.route.test.ts` tak ada, hilangkan dari daftar)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/telegram/credentials.ts server/src/routes/telegram.ts server/src/routes/settings.ts server/src/services/agent-capabilities.ts shared/src/api.ts server/test/telegram-credentials.test.ts server/test/agent-capabilities.test.ts
git commit -m "feat(477): endpoint kredensial Telegram + Test Connection + hapus (cookie-only)"
```

---

### Task 7: Tab Telegram di Settings — isi, uji, hapus

**Files:**
- Modify: `src/src/api/client.ts`
- Modify: `src/src/screens/SettingsScreen.tsx` (blok `if (tab === "telegram")`)
- Test: `src/src/screens/SettingsScreen.test.tsx` (**ganti** test SPEC-476 yang mengunci perilaku lama)

**Interfaces:**
- Consumes: `paths.telegramSettings|telegramTest|telegramCredentials`, `TelegramCredentialsView`, `TelegramTestResult`, `TelegramClearResult` (Task 6)
- Produces: `api.getTelegramCredentials()`, `api.putTelegramCredentials(patch)`, `api.testTelegramConnection()`, `api.deleteTelegramCredentials()`

- [ ] **Step 1: Write the failing test**

Di `src/src/screens/SettingsScreen.test.tsx`, **hapus** `describe("SettingsScreen Telegram onboarding (SPEC-476)", …)` seluruhnya dan ganti dengan:

> Test SPEC-476 itu mengunci bug-nya sebagai kontrak (`queryByRole("textbox", {name:/token/i})` **tak boleh** ada, dan teks "credential disimpan di env" **harus** ada). Persis pola SPEC-433/475: memperbaiki fitur tanpa mengganti test-nya akan membuat merah yang benar terlihat seperti regresi.

```tsx
const credentials = {
  fields: [
    { key: "HANOMAN_TELEGRAM_BOT_TOKEN", label: "Bot token", kind: "secret", source: "db", hasValue: true, masked: "••••Dsaw" },
    { key: "HANOMAN_TELEGRAM_AGENT_TOKEN", label: "AgentToken gateway", kind: "secret", source: "env", hasValue: true, masked: "••••3456" },
    { key: "HANOMAN_TELEGRAM_ALLOWED_USER_IDS", label: "Allowlist user id", kind: "string", source: "db", hasValue: true, value: "7" },
    { key: "HANOMAN_TELEGRAM_TARGET_CHAT_ID", label: "Chat / Channel ID target", kind: "string", source: "default", hasValue: false, value: null },
  ],
};

function telegramFetch(extra: (path: string, init?: RequestInit) => Promise<Response> | null = () => null) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
    const path = String(url);
    const custom = extra(path, init as RequestInit | undefined);
    if (custom) return custom;
    if (path === "/api/settings" && init?.method === "PUT") return json(setting);
    if (path === "/api/settings") return json(setting);
    if (path === "/api/codex/version") return json({ version: null, minRequired: "0.0.0", ok: true });
    if (path === "/api/telegram/status") return json(status);
    if (path === "/api/telegram/settings") return json(credentials);
    throw new Error(`unexpected fetch ${path}`);
  });
}

async function openTelegramTab() {
  render(<SettingsScreen
    me={{ id: "u1", email: "dena@example.test", createdAt: "2026-08-01T00:00:00.000Z" }}
    onLoggedOut={() => {}}
  />);
  fireEvent.click(screen.getByRole("button", { name: "Telegram" }));
  expect(await screen.findByText("Kredensial Telegram")).toBeInTheDocument();
}

describe("SettingsScreen Telegram kredensial (SPEC-477)", () => {
  it("merender empat field; secret masked & tak pernah menampilkan nilai utuh", async () => {
    telegramFetch();
    await openTelegramTab();
    expect(screen.getByLabelText("Bot token")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Bot token")).toHaveAttribute("placeholder", "••••Dsaw");
    expect(screen.getByLabelText("AgentToken gateway")).toBeInTheDocument();
    expect((screen.getByLabelText("Allowlist user id") as HTMLInputElement).value).toBe("7");
    expect(screen.getByLabelText("Chat / Channel ID target")).toBeInTheDocument();
  });

  it("menandai field yang masih datang dari .env sebagai deprecated", async () => {
    telegramFetch();
    await openTelegramTab();
    expect(screen.getByText(/dari \.env · deprecated/i)).toBeInTheDocument();
  });

  it("Simpan mengirim hanya field yang diisi", async () => {
    let sent: unknown = null;
    const fetchMock = telegramFetch((path, init) => {
      if (path === "/api/telegram/settings" && init?.method === "PUT") {
        sent = JSON.parse(String(init.body));
        return json(credentials);
      }
      return null;
    });
    await openTelegramTab();
    fireEvent.change(screen.getByLabelText("Chat / Channel ID target"), { target: { value: "-1001234567890" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan kredensial" }));
    await waitFor(() => expect(sent).toEqual({ HANOMAN_TELEGRAM_TARGET_CHAT_ID: "-1001234567890" }));
    expect(fetchMock).toHaveBeenCalled();
  });

  it("Test Connection menampilkan hasil sukses", async () => {
    telegramFetch((path, init) =>
      path === "/api/telegram/test" && init?.method === "POST"
        ? json({ ok: true, botUsername: "bot_uji", chatId: "42" }) : null);
    await openTelegramTab();
    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));
    expect(await screen.findByText(/@bot_uji/)).toBeInTheDocument();
    expect(screen.getByText(/42/)).toBeInTheDocument();
  });

  it("Test Connection menampilkan galat apa adanya", async () => {
    telegramFetch((path, init) =>
      path === "/api/telegram/test" && init?.method === "POST"
        ? json({ ok: false, error: "Telegram getMe gagal (401): Unauthorized" }) : null);
    await openTelegramTab();
    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));
    expect(await screen.findByText(/401/)).toBeInTheDocument();
  });

  it("Hapus kredensial meminta konfirmasi lalu memanggil DELETE", async () => {
    let deleted = false;
    telegramFetch((path, init) => {
      if (path === "/api/telegram/credentials" && init?.method === "DELETE") {
        deleted = true;
        return json({ cleared: ["HANOMAN_TELEGRAM_BOT_TOKEN"], envFallback: [] });
      }
      return null;
    });
    await openTelegramTab();
    fireEvent.click(screen.getByRole("button", { name: "Hapus kredensial" }));
    fireEvent.click(await screen.findByRole("button", { name: "Hapus" }));
    await waitFor(() => expect(deleted).toBe(true));
  });

  it("toggle gateway & progress tetap ada", async () => {
    telegramFetch();
    await openTelegramTab();
    expect(screen.getAllByRole("switch")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV ./node_modules/.bin/vitest run --dir src src/src/screens/SettingsScreen.test.tsx`
Expected: FAIL — `Unable to find an element with the text: Kredensial Telegram`

> `env -u NODE_ENV` wajib: `NODE_ENV=production` di env sesi membuat RTL `act` gagal massal.

- [ ] **Step 3: Write minimal implementation**

**3a.** Di `src/src/api/client.ts`, tambahkan setelah `getTelegramStatus`:

```ts
  getTelegramCredentials: () => j<TelegramCredentialsView>(paths.telegramSettings),
  putTelegramCredentials: (patch: Record<string, string>) =>
    j<TelegramCredentialsView>(paths.telegramSettings, { method: "PUT", ...body(patch) }),
  testTelegramConnection: () => j<TelegramTestResult>(paths.telegramTest, { method: "POST", ...body({}) }),
  deleteTelegramCredentials: () => j<TelegramClearResult>(paths.telegramCredentials, { method: "DELETE" }),
```

…dan tambahkan `TelegramCredentialsView, TelegramTestResult, TelegramClearResult` ke impor tipe `@hanoman/shared` di berkas itu.

**3b.** Di `src/src/screens/SettingsScreen.tsx`, tambahkan state + loader di dekat `telegramStatus` (di dalam `SettingsScreen`):

```tsx
  // SPEC-477 · ADR-0097 · kredensial Telegram kini hidup di store config, bukan .env.
  const [tgCreds, setTgCreds] = React.useState<TelegramCredentialsView | null>(null);
  const [tgDraft, setTgDraft] = React.useState<Record<string, string>>({});
  const [tgTest, setTgTest] = React.useState<TelegramTestResult | "sending" | null>(null);
  const [tgConfirm, setTgConfirm] = React.useState(false);
  const loadTgCreds = React.useCallback(() => {
    api.getTelegramCredentials().then((v) => { setTgCreds(v); setTgDraft({}); }).catch(() => setTgCreds(null));
  }, []);
  React.useEffect(() => { if (tab === "telegram") loadTgCreds(); }, [tab, loadTgCreds]);
```

Tambahkan impor tipe di baris impor `@hanoman/shared` berkas itu:
`TelegramCredentialsView, TelegramTestResult`.

Ganti seluruh blok `if (tab === "telegram") { … }` dengan:

```tsx
    if (tab === "telegram") {
      const telegram = s.telegram ?? TELEGRAM_DEFAULTS;
      const readiness = telegramStatus?.readiness ?? "memuat";
      const sourceBadge = (src: "db" | "env" | "default") =>
        src === "db" ? <Badge tone="ok">tersimpan</Badge>
          : src === "env" ? <Badge tone="warn">dari .env · deprecated</Badge>
            : <Badge>belum diisi</Badge>;
      const saveCreds = () => {
        const patch = Object.fromEntries(Object.entries(tgDraft).filter(([, v]) => v !== ""));
        if (!Object.keys(patch).length) { onToast?.("Tak ada perubahan", "info", "info"); return; }
        api.putTelegramCredentials(patch)
          .then((v) => { setTgCreds(v); setTgDraft({}); onToast?.("Kredensial Telegram disimpan", "ok", "check-circle-2"); loadTelegram(); })
          .catch((e: Error) => onToast?.(e.message || "Gagal menyimpan", "err", "alert-triangle"));
      };
      const runTest = () => {
        setTgTest("sending");
        api.testTelegramConnection().then(setTgTest)
          .catch((e: Error) => setTgTest({ ok: false, error: e.message || "Gagal menghubungi server" }));
      };
      const removeCreds = () => {
        setTgConfirm(false);
        api.deleteTelegramCredentials().then((r) => {
          onToast?.(r.envFallback.length
            ? `Kredensial dihapus — ${r.envFallback.length} nilai masih datang dari .env`
            : "Kredensial Telegram dihapus", "ok", "check-circle-2");
          loadTgCreds(); loadTelegram();
        }).catch((e: Error) => onToast?.(e.message || "Gagal menghapus", "err", "alert-triangle"));
      };
      return (
        <>
          <Card eyebrow="telegram" title="Kredensial Telegram">
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
              Disimpan terenkripsi di database dan berlaku langsung — tanpa mengedit <code>.env</code>,
              tanpa restart. Nilai <code>.env</code> lama tetap dipakai selama field-nya masih kosong.
            </div>
            {!tgCreds ? <StateBlock kind="loading" compact title="Memuat kredensial…" />
              : <>
                {tgCreds.fields.map((f, i) => (
                  <SettingRow key={f.key} title={f.label} desc={f.help} last={i === tgCreds.fields.length - 1}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {sourceBadge(f.source)}
                      <Input
                        aria-label={f.label}
                        mono
                        type={f.kind === "secret" ? "password" : "text"}
                        placeholder={f.kind === "secret" ? (f.masked ?? "belum diisi") : "belum diisi"}
                        value={tgDraft[f.key] ?? (f.kind === "secret" ? "" : (f.value ?? ""))}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setTgDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                        style={{ width: 300 }}
                      />
                    </div>
                  </SettingRow>
                ))}
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <Button size="sm" leftIcon="save" onClick={saveCreds}>Simpan kredensial</Button>
                </div>
              </>}
          </Card>

          <Card eyebrow="uji" title="Uji koneksi & hapus"
            actions={<Button size="sm" variant="ghost" leftIcon="refresh-cw" onClick={loadTgCreds}>Refresh</Button>}>
            <SettingRow title="Test Connection"
              desc="Mengirim satu pesan percobaan ke chat tujuan. Batas 10 detik — tak pernah menggantung.">
              <Button size="sm" leftIcon="send" disabled={tgTest === "sending"} onClick={runTest}>Test Connection</Button>
            </SettingRow>
            {tgTest && tgTest !== "sending" && (
              <div style={{ marginTop: 10 }}>
                {tgTest.ok
                  ? <Callout tone="ok">Berhasil — bot @{tgTest.botUsername ?? "?"} mengirim ke chat {tgTest.chatId}.</Callout>
                  : <Callout tone="err">{tgTest.error}</Callout>}
              </div>
            )}
            <SettingRow title="Hapus kredensial" last
              desc="Menghapus keempat nilai dari database. Bila .env lama masih terisi, nilainya kembali dipakai.">
              <Button size="sm" variant="danger" leftIcon="trash-2" onClick={() => setTgConfirm(true)}>Hapus kredensial</Button>
            </SettingRow>
            <ConfirmDialog
              open={tgConfirm}
              title="Hapus kredensial Telegram?"
              message="Gateway berhenti kecuali nilai .env lama masih tersedia."
              confirmLabel="Hapus"
              onConfirm={removeCreds}
              onCancel={() => setTgConfirm(false)}
            />
          </Card>

          <Card eyebrow="gateway" title="Gateway Telegram"
            actions={<Button size="sm" variant="ghost" leftIcon="refresh-cw" onClick={loadTelegram}>Refresh</Button>}>
            <SettingRow title="Gateway aktif"
              desc="Menyalakan long polling in-process seketika. Mematikan tidak membunuh session tmux atau memory.">
              <Switch label="Gateway aktif" checked={telegram.enabled} onChange={(enabled: boolean) => {
                persist({ ...s, telegram: { ...telegram, enabled } }, `Gateway Telegram · ${enabled ? "aktif" : "nonaktif"}`);
                setTimeout(loadTelegram, 300);
              }} />
            </SettingRow>
            <SettingRow title="Kirim progress ringkas"
              desc="Hanya progress eksplisit dan fakta status Hanoman; layar PTY/reasoning tidak pernah diteruskan.">
              <Switch label="Kirim progress ringkas" checked={telegram.progress} onChange={(progress: boolean) => {
                persist({ ...s, telegram: { ...telegram, progress } }, `Progress Telegram · ${progress ? "aktif" : "nonaktif"}`);
              }} />
            </SettingRow>
            {telegramFailed ? <StateBlock kind="error" compact title="Gagal membaca status Telegram" action={loadTelegram} />
              : !telegramStatus ? <StateBlock kind="loading" compact title="Memuat status Telegram…" />
              : <>
                <SettingRow title={`Readiness · ${readiness}`}
                  desc={telegramStatus.running ? "Long poll aktif." : telegramStatus.lastError ?? "Gateway belum polling."}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    {telegramStatus.botUsername ? `@${telegramStatus.botUsername}` : "bot belum terverifikasi"}
                  </span>
                </SettingRow>
                <SettingRow title="Allowlist" last={!telegramStatus.missingCapabilities.length}
                  desc={`${telegramStatus.allowlistCount} Telegram numeric user id diizinkan.`}>
                  <span>{telegramStatus.configured ? "kredensial lengkap" : "kredensial belum lengkap"}</span>
                </SettingRow>
                {telegramStatus.missingCapabilities.length > 0 && <SettingRow title="Capability kurang" last
                  desc={telegramStatus.missingCapabilities.join(", ")} />}
              </>}
            <div style={{ marginTop: 14, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.7 }}>
              <b>Onboarding</b>
              <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                <li>Buat satu bot private-chat lewat BotFather, salin token-nya.</li>
                <li>Di Akses AI Agent, aktifkan master switch dan buat AgentToken dengan capability yang ditampilkan status.</li>
                <li>Isi keempat field di kartu Kredensial lalu Simpan.</li>
                <li>Tekan Test Connection sampai hijau.</li>
                <li>Nyalakan gateway di atas dan kirim <code>/status</code> dari Telegram.</li>
              </ol>
            </div>
          </Card>
        </>
      );
    }
```

Pastikan `Badge`, `Callout`, `Input`, dan `ConfirmDialog` ada di impor `../ds` berkas ini (tambahkan yang belum).

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u NODE_ENV ./node_modules/.bin/vitest run --dir src src/src/screens/SettingsScreen.test.tsx`
Expected: PASS — 7 passed

- [ ] **Step 5: Commit**

```bash
git add src/src/api/client.ts src/src/screens/SettingsScreen.tsx src/src/screens/SettingsScreen.test.tsx
git commit -m "feat(477): tab Settings Telegram — isi, uji, dan hapus kredensial dari UI"
```

---

### Task 8: ADR-0097 + docs Source of Truth + verifikasi akhir

**Files:**
- Create: `internal/docs/adr/0097-kredensial-telegram-di-settings-terenkripsi.md`
- Modify: `internal/docs/README.md` (baris ADR + tak ada lagi klaim env-only)
- Modify: `internal/docs/adr/README.md` (narasi ADR-0097)
- Modify: `internal/docs/architecture/api-contract.md` (3 endpoint baru)
- Modify: `internal/docs/security/security-standard.md` (secret at-rest + pagar `credential`)
- Modify: `internal/docs/frontend/frontend-implementation.md` (tab Telegram)
- Modify: `internal/docs/product/onboarding.md` (langkah tanpa `.env`)
- Modify: `internal/skills/hanoman/SKILL.md` (butir permanen)

**Interfaces:**
- Consumes: seluruh keputusan Task 1–7
- Produces: dokumentasi; tak ada simbol kode

- [ ] **Step 1: Tulis ADR-0097**

Create `internal/docs/adr/0097-kredensial-telegram-di-settings-terenkripsi.md` dengan bagian: Status/Tanggal/SPEC/Terkait · Konteks · Keputusan (7 butir, cermin bagian "Keputusan" di
`docs/superpowers/specs/2026-08-01-spec-477-telegram-settings-kredensial-design.md`) · Konsekuensi · Gotcha (8 butir dari design doc) · Alternatif yang ditolak (tabel terenkripsi terpisah; `Setting.telegram.botToken`; enkripsi hanya bot token).

Header wajib:

```markdown
# ADR-0097 — Kredensial Telegram di Settings: entri config terenkripsi, bukan `.env`

- Status: Accepted
- Tanggal: 2026-08-01
- SPEC: SPEC-477
- Terkait: **mengamandemen** [0096](0096-telegram-gateway-session-operator-persisten.md)
  (kredensial tak lagi env-only); **memperluas** [0049](0049-config-runtime-store-registry.md)
  (nilai `kind: "secret"` kini terenkripsi at-rest) dan [0065](0065-ai-agent-capability-agent-token.md)
  (kategori `credential` = cookie-only); **tidak mencabut** keputusan mana pun.
  ADR-0037 & ADR-0086 utuh.
```

- [ ] **Step 2: Tautkan di kedua index**

Di `internal/docs/README.md`, tambahkan **di atas** baris 0096 pada bagian `## adr`:

```markdown
- [0097 — Kredensial Telegram di Settings: entri config terenkripsi, bukan `.env`](adr/0097-kredensial-telegram-di-settings-terenkripsi.md)
```

Di `internal/docs/adr/README.md`, tambahkan narasi ADR-0097 di posisi yang sama (paling atas daftar), memuat: apa yang diamandemen, mengapa store config dipilih ketimbang tabel kedua, dan tiga gotcha terpenting (urutan boot `loadConfig`, cache plaintext vs DB ciphertext, chat id negatif).

- [ ] **Step 3: Perbarui doc SoT yang tersentuh**

`internal/docs/architecture/api-contract.md` — tambahkan di bagian Telegram:

```markdown
| `GET`    | `/api/telegram/settings`    | cookie | View kredensial (secret **masked**), `source` per field (`db`/`env`/`default`) |
| `PUT`    | `/api/telegram/settings`    | cookie | Simpan sebagian/semua field; secret kosong = pertahankan; reload gateway |
| `POST`   | `/api/telegram/test`        | cookie | Kirim pesan percobaan, timeout 10 dtk, galat sudah diredaksi |
| `DELETE` | `/api/telegram/credentials` | cookie | Hapus keempat key; balas `{cleared, envFallback}` |
```

`internal/docs/security/security-standard.md` — tambahkan dua butir: (a) nilai `RuntimeConfig` ber-`kind: "secret"` terenkripsi AES-256-GCM dengan kunci `<HANOMAN_HOME>/secret.key` mode `0600`; (b) `PUT`/`DELETE /config` kategori `credential` dan seluruh `/api/telegram/{settings,test,credentials}` **cookie-only** — agent token ditolak 403 meski memegang `settings:write`/`telegram:write`.

`internal/docs/frontend/frontend-implementation.md` — tab Telegram di Settings: tiga kartu (Kredensial · Uji & hapus · Gateway), secret memakai `type="password"` + placeholder masked, badge sumber `tersimpan`/`dari .env · deprecated`/`belum diisi`.

`internal/docs/product/onboarding.md` — ganti langkah yang menyuruh mengisi `.env` + restart dengan langkah mengisi Settings + Test Connection.

`internal/skills/hanoman/SKILL.md` — tambahkan satu butir permanen di bagian "Aturan Arsitektur", setelah butir ADR-0096, memuat: entri config Telegram, enkripsi at-rest untuk semua `kind:"secret"`, pagar `credential` cookie-only, reload tanpa restart, dan **gotcha urutan `loadConfig` sebelum `installTelegramGateway`**.

- [ ] **Step 4: Verifikasi akhir — test yang tersentuh + typecheck paket tersentuh**

```bash
./node_modules/.bin/vitest run --no-file-parallelism \
  server/test/secret-box.test.ts \
  server/test/config-resolver.test.ts \
  server/test/config.route.test.ts \
  server/test/config-apply.test.ts \
  server/test/config-registry.test.ts \
  server/test/telegram-bootstrap-config.test.ts \
  server/test/telegram-credentials.test.ts \
  server/test/telegram-routes.test.ts \
  server/test/telegram-lifecycle.test.ts \
  server/test/agent-capabilities.test.ts \
  shared/src/telegram.test.ts
env -u NODE_ENV ./node_modules/.bin/vitest run --dir src src/src/screens/SettingsScreen.test.tsx
pnpm --filter ./shared typecheck
pnpm --filter ./server typecheck
pnpm --filter ./src typecheck
```

Expected: seluruh test PASS (bukan "no test files"), tiga typecheck exit 0.
**Jangan** jalankan `pnpm -r typecheck`, suite penuh, atau build penuh.

- [ ] **Step 5: Smoke endpoint nyata (sekali di akhir — task ini menyentuh endpoint)**

```bash
# DB khusus smoke, bukan DB test bersama (run tetangga menghapusnya di tengah jalan).
export HANOMAN_HOME="$(mktemp -d)/hanoman-smoke"
mkdir -p "$HANOMAN_HOME"
env -u DATABASE_URL pnpm --filter ./server exec prisma migrate deploy
PORT=8799 env -u DATABASE_URL node server/dist/server.js &
SMOKE_PID=$!
# login → GET /api/telegram/settings → PUT token → GET lagi (harus masked) → DELETE
# lalu: kill $SMOKE_PID   (per-PID, JANGAN pkill -f)
```

Verifikasi manual yang wajib terlihat:
1. `GET /api/telegram/settings` tanpa cookie → `401`.
2. Sesudah `PUT` bot token, `GET` **tak memuat** token plaintext di body mana pun.
3. `sqlite3 "$HANOMAN_HOME/hanoman.db" "select value from RuntimeConfig where key='HANOMAN_TELEGRAM_BOT_TOKEN'"` → berawalan `enc:v1:`.
4. `ls -l "$HANOMAN_HOME/secret.key"` → `-rw-------`.
5. `POST /api/telegram/test` dengan token palsu → `{"ok":false,…}` dalam < 11 detik, **tanpa** token di `error`.

- [ ] **Step 6: Commit**

```bash
git add internal/docs internal/skills docs/superpowers
git commit -m "docs(477): ADR-0097 kredensial Telegram di Settings + docs SoT tersentuh"
```

- [ ] **Step 7: Push**

```bash
git push origin HEAD:refs/heads/hanoman/spec-477
```
