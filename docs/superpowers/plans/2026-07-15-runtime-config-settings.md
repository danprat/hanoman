# Konfigurasi Runtime via Settings (SPEC-215) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Semua env non-bootstrap dapat diatur lewat layar Settings (knob non-kredensial plain + kredensial termask), berlaku live jika didukung; permintaan awal "input device token sisi client" terpenuhi sebagai satu entri secret.

**Architecture:** Resolver terpusat `cfg(key) = override DB → env → default registry`. Registry di `shared/` jadi sumber tunggal metadata untuk validasi (server) & render (web). Store `RuntimeConfig` (Prisma, local-only, tak disync). Side-effect saat set/hapus: kunci sync → re-init sync client live; kredensial warisan → mirror `process.env`.

**Tech Stack:** TypeScript strict, Fastify (server), Prisma/Postgres, React+Vite (web di `src/`), Zod (`@hanoman/shared`), Vitest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-15-runtime-config-settings-spec-215-design.md`.
- **Penomoran:** ADR **0049**, SPEC **215** — verifikasi lintas-branch tepat sebelum commit (memori: tabrakan nomor di worktree sibling). Kalau bentrok, naikkan ke nomor bebas berikutnya di SEMUA file yang menyebutnya.
- **Skema:** setiap perubahan skema = migration + ADR (CLAUDE.md). Migration **ditulis tangan** lalu `migrate deploy` per DB — `migrate dev` mereset saat drift worktree; DB `_test` butuh migrate terpisah (memori).
- **Env sesi menunjuk prod:** jalankan test & prisma dengan override eksplisit: awali perintah dengan `env -u NODE_ENV -u DATABASE_URL …` atau set `DATABASE_URL=` eksplisit; jangan andalkan env shell (memori: shell menunjuk prod).
- **Local-only, tak pernah disync:** `RuntimeConfig` masuk pengecualian whitelist sync bersama `Setting`/`Notification`/`LocalBinding`/`SyncState` (AC-30 SPEC-213).
- **Secret tak pernah balik plaintext** ke browser. Bootstrap (`DATABASE_URL`, `TEST_DATABASE_URL`, `PORT`, `HOST`, `NODE_ENV`) read-only.
- **Docs tersentuh diperbarui dalam commit yang sama** (CLAUDE.md). Setiap task selesai: centang checklist + boot server lokal + curl endpoint tersentuh, bukan hanya unit test.
- **Test repo:** `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- <file>` (server) dan `pnpm --filter ./src test -- <file>` (web). Server suite penuh: `--no-file-parallelism` bila menyentuh DB bersama.

---

### Task 1: ADR-0049 + model `RuntimeConfig` + migration

**Files:**
- Create: `internal/docs/adr/0049-config-runtime-store-registry.md`
- Modify: `server/prisma/schema.prisma` (tambah model dekat `SyncState`)
- Create: `server/prisma/migrations/20260715120000_spec215_runtime_config/migration.sql`

**Interfaces:**
- Produces: tabel `RuntimeConfig(key PK, value, updatedAt)`; klien Prisma `prisma.runtimeConfig`.

- [ ] **Step 1: Tulis ADR-0049**

Buat `internal/docs/adr/0049-config-runtime-store-registry.md`:

```markdown
# ADR-0049 — Config runtime store + registry (settings ⊇ env non-bootstrap)

Status: Accepted · SPEC-215 · 2026-07-15

## Konteks
Env non-bootstrap (sync URL/token/tick, claude bin/config-dir, ssh, tick events, update-fetch,
repo root, tmux socket, kredensial) hanya dapat diubah lewat env + restart. SPEC-213 OQ-4 menaruh
config sync sebagai env-only. Operator butuh mengaturnya runtime dari dashboard (mis. input device
token sisi client) tanpa restart.

## Keputusan
Resolver terpusat `cfg(key) = override DB → env → default registry`. Registry (di `shared/`) jadi
sumber tunggal metadata. Store `RuntimeConfig` (KV, local-only, TAK PERNAH disync). Bootstrap
(`DATABASE_URL`/`TEST_DATABASE_URL`/`PORT`/`HOST`/`NODE_ENV`) tetap env-only (read-only di UI):
menghindari chicken-egg (store ada di dalam DB) & bind/port butuh restart. Kredensial disimpan
plaintext-at-rest (sejajar env; TLS via reverse-proxy ADR-0028), tak pernah balik plaintext ke
browser (GET termask). Ini SEBAGIAN menggantikan OQ-4; env tetap fallback bootstrap (backward-compatible).

## Konsekuensi
Pembacaan `process.env.*` non-bootstrap yang tersebar dipindah ke `cfg.*`. Kunci sync berlaku live
(re-init sync client); kredensial warisan di-mirror ke `process.env` agar proses claude baru mewarisi.
`RuntimeConfig` per-mesin, tak ikut sync (konsisten AC-30).
```

- [ ] **Step 2: Tambah model ke schema.prisma**

Di `server/prisma/schema.prisma`, tepat setelah blok `model SyncState { … }`:

```prisma
// SPEC-215 · ADR-0049 · LOCAL-ONLY: override config runtime (env → DB). Tak pernah disync.
model RuntimeConfig {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 3: Tulis migration SQL tangan**

Buat `server/prisma/migrations/20260715120000_spec215_runtime_config/migration.sql`:

```sql
-- SPEC-215 · ADR-0049 · config runtime store (local-only, tak disync)
CREATE TABLE "RuntimeConfig" (
  "key"       TEXT NOT NULL,
  "value"     TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RuntimeConfig_pkey" PRIMARY KEY ("key")
);
```

- [ ] **Step 4: Apply migration ke DB dev + test, lalu generate**

Run (dev DB `hanoman`):
```bash
env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman" \
  pnpm --filter ./server exec prisma migrate deploy
```
Run (test DB `hanoman_test`):
```bash
env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman_test" \
  pnpm --filter ./server exec prisma migrate deploy
```
Run (regenerate client):
```bash
env -u NODE_ENV pnpm --filter ./server exec prisma generate
```
Expected: kedua `migrate deploy` melaporkan migration `20260715120000_spec215_runtime_config` applied; `generate` sukses. Verifikasi tabel ada:
```bash
docker exec hanoman-db-1 psql -U hanoman -d hanoman_test -c '\d "RuntimeConfig"'
```
Expected: kolom `key/value/updatedAt`.

- [ ] **Step 5: Commit**

```bash
git add internal/docs/adr/0049-config-runtime-store-registry.md server/prisma/schema.prisma server/prisma/migrations/20260715120000_spec215_runtime_config
git commit -m "feat(db): RuntimeConfig store + ADR-0049 (SPEC-215)"
```

---

### Task 2: Registry konfigurasi (shared) + validasi

**Files:**
- Create: `shared/src/config-registry.ts`
- Modify: `shared/src/index.ts` (re-export)
- Test: `shared/test/config-registry.test.ts` (buat bila folder `shared/test` ada; kalau tidak, taruh `server/test/config-registry.test.ts` yang meng-import dari `@hanoman/shared`)

**Interfaces:**
- Produces:
  - `type ConfigKind = "url" | "int" | "bool" | "string" | "path" | "secret"`
  - `type ApplyMode = "live" | "new-session" | "restart"`
  - `type ConfigCategory = "knob" | "credential" | "bootstrap"`
  - `interface ConfigEntry { key; group; label; help?; kind; default?; apply; category; min?; max?; inheritEnv?: boolean }`
  - `const CONFIG_REGISTRY: ConfigEntry[]`
  - `configEntry(key: string): ConfigEntry | undefined`
  - `parseConfigValue(entry, raw): { ok: true; value: string } | { ok: false; error: string }`
  - `maskSecret(v: string): string`

- [ ] **Step 1: Tulis registry + helper**

Buat `shared/src/config-registry.ts`:

```ts
// SPEC-215 · ADR-0049 · sumber tunggal metadata config runtime (validasi server + render web).
export type ConfigKind = "url" | "int" | "bool" | "string" | "path" | "secret";
export type ApplyMode = "live" | "new-session" | "restart";
export type ConfigCategory = "knob" | "credential" | "bootstrap";

export interface ConfigEntry {
  key: string; group: string; label: string; help?: string;
  kind: ConfigKind; default?: string; apply: ApplyMode; category: ConfigCategory;
  min?: number; max?: number;
  inheritEnv?: boolean; // true = dikonsumsi via warisan proses anak (mirror ke process.env, bukan dibaca cfg.*)
}

export const CONFIG_REGISTRY: ConfigEntry[] = [
  // sync
  { key: "SYNC_SERVER_URL", group: "sync", label: "URL hub", kind: "url", apply: "live", category: "knob",
    help: "Base URL hub tujuan sync (REST + WS). Kosong = instance ini murni HUB." },
  { key: "SYNC_DEVICE_TOKEN", group: "sync", label: "Device token", kind: "secret", apply: "live", category: "credential",
    help: "Token yang diterbitkan hub (tab Perangkat di hub). Dikirim sebagai Bearer." },
  { key: "SYNC_TICK_MS", group: "sync", label: "Interval sync (ms)", kind: "int", apply: "live", category: "knob",
    default: "15000", min: 1000 },
  // claude
  { key: "CLAUDE_CODE_OAUTH_TOKEN", group: "claude", label: "Claude OAuth token", kind: "secret", apply: "new-session", category: "credential", inheritEnv: true,
    help: "Token `claude setup-token`. Diwarisi proses claude yang di-spawn." },
  { key: "ANTHROPIC_API_KEY", group: "claude", label: "Anthropic API key", kind: "secret", apply: "new-session", category: "credential", inheritEnv: true },
  { key: "HANOMAN_CLAUDE_BIN", group: "claude", label: "Biner claude", kind: "path", apply: "new-session", category: "knob", default: "claude" },
  { key: "CLAUDE_CONFIG_DIR", group: "claude", label: "Dir config Claude", kind: "path", apply: "new-session", category: "knob",
    help: "Default ~/.claude. Sumber .credentials.json untuk panel usage/limit." },
  // vps
  { key: "HANOMAN_SSH_KEY_DIR", group: "vps", label: "Dir key SSH", kind: "path", apply: "new-session", category: "knob", help: "Default ~/.hanoman." },
  { key: "HANOMAN_SSH_BIN", group: "vps", label: "Biner ssh", kind: "path", apply: "new-session", category: "knob", default: "ssh" },
  // runtime
  { key: "HANOMAN_EVENTS_TICK_MS", group: "runtime", label: "Interval events (ms)", kind: "int", apply: "live", category: "knob", default: "1000", min: 100 },
  { key: "HANOMAN_UPDATE_FETCH", group: "runtime", label: "Deteksi update saat boot", kind: "bool", apply: "live", category: "knob", default: "1" },
  { key: "HANOMAN_REPO_ROOT", group: "runtime", label: "Root repo hanoman", kind: "path", apply: "restart", category: "knob", help: "Default cwd proses server." },
  { key: "HANOMAN_TMUX_SOCKET", group: "runtime", label: "Socket tmux", kind: "string", apply: "restart", category: "knob", default: "hanoman",
    help: "Mengubah ini TIDAK memindahkan sesi tmux yang sudah hidup — berlaku setelah restart." },
  // bootstrap (read-only)
  { key: "DATABASE_URL", group: "bootstrap", label: "DATABASE_URL", kind: "secret", apply: "restart", category: "bootstrap" },
  { key: "TEST_DATABASE_URL", group: "bootstrap", label: "TEST_DATABASE_URL", kind: "secret", apply: "restart", category: "bootstrap" },
  { key: "PORT", group: "bootstrap", label: "PORT", kind: "int", apply: "restart", category: "bootstrap", default: "8787" },
  { key: "HOST", group: "bootstrap", label: "HOST", kind: "string", apply: "restart", category: "bootstrap", default: "127.0.0.1" },
  { key: "NODE_ENV", group: "bootstrap", label: "NODE_ENV", kind: "string", apply: "restart", category: "bootstrap" },
];

const BY_KEY = new Map(CONFIG_REGISTRY.map((e) => [e.key, e]));
export function configEntry(key: string): ConfigEntry | undefined { return BY_KEY.get(key); }

export function maskSecret(v: string): string {
  return v.length <= 4 ? "••••" : "••••" + v.slice(-4);
}

// Validasi + normalisasi nilai mentah untuk sebuah entri. bool dinormalkan ke "0"/"1".
export function parseConfigValue(
  entry: ConfigEntry, raw: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const v = raw.trim();
  switch (entry.kind) {
    case "int": {
      if (!/^\d+$/.test(v)) return { ok: false, error: "harus bilangan bulat" };
      const n = Number(v);
      if (entry.min !== undefined && n < entry.min) return { ok: false, error: `min ${entry.min}` };
      if (entry.max !== undefined && n > entry.max) return { ok: false, error: `max ${entry.max}` };
      return { ok: true, value: String(n) };
    }
    case "bool": {
      if (["1", "true"].includes(v.toLowerCase())) return { ok: true, value: "1" };
      if (["0", "false"].includes(v.toLowerCase())) return { ok: true, value: "0" };
      return { ok: false, error: "harus 0/1" };
    }
    case "url": {
      try { const u = new URL(v); if (!/^https?:$/.test(u.protocol)) return { ok: false, error: "harus http(s)" }; }
      catch { return { ok: false, error: "URL tak valid" }; }
      return { ok: true, value: v };
    }
    default: // string | path | secret
      if (v.length === 0) return { ok: false, error: "tak boleh kosong" };
      return { ok: true, value: v };
  }
}
```

- [ ] **Step 2: Re-export dari index**

Di `shared/src/index.ts`, tambahkan baris (ikuti gaya re-export yang ada):

```ts
export * from "./config-registry";
```

- [ ] **Step 3: Tulis test integritas registry**

Buat `server/test/config-registry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CONFIG_REGISTRY, configEntry, parseConfigValue, maskSecret } from "@hanoman/shared";

describe("config-registry", () => {
  it("key unik", () => {
    const keys = CONFIG_REGISTRY.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("parse int honor min", () => {
    const e = configEntry("SYNC_TICK_MS")!;
    expect(parseConfigValue(e, "500")).toEqual({ ok: false, error: "min 1000" });
    expect(parseConfigValue(e, "2000")).toEqual({ ok: true, value: "2000" });
    expect(parseConfigValue(e, "abc")).toEqual({ ok: false, error: "harus bilangan bulat" });
  });
  it("parse url http(s)", () => {
    const e = configEntry("SYNC_SERVER_URL")!;
    expect(parseConfigValue(e, "https://h.co").ok).toBe(true);
    expect(parseConfigValue(e, "ftp://h.co").ok).toBe(false);
    expect(parseConfigValue(e, "bukan url").ok).toBe(false);
  });
  it("parse bool normalisasi", () => {
    const e = configEntry("HANOMAN_UPDATE_FETCH")!;
    expect(parseConfigValue(e, "true")).toEqual({ ok: true, value: "1" });
    expect(parseConfigValue(e, "0")).toEqual({ ok: true, value: "0" });
  });
  it("mask last-4", () => {
    expect(maskSecret("abcdefgh")).toBe("••••efgh");
    expect(maskSecret("ab")).toBe("••••");
  });
});
```

- [ ] **Step 4: Jalankan test**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- config-registry`
Expected: PASS semua.

- [ ] **Step 5: Commit**

```bash
git add shared/src/config-registry.ts shared/src/index.ts server/test/config-registry.test.ts
git commit -m "feat(shared): registry config runtime + validasi (SPEC-215)"
```

---

### Task 3: Resolver terpusat `server/src/config.ts`

**Files:**
- Create: `server/src/config.ts`
- Test: `server/test/config-resolver.test.ts`

**Interfaces:**
- Consumes: `prisma.runtimeConfig` (Task 1); registry (Task 2).
- Produces:
  - `loadConfig(): Promise<void>` — muat cache dari DB.
  - `effectiveStr(key: string): string | undefined`
  - `effectiveInt(key: string): number | undefined`
  - `effectiveBool(key: string): boolean`
  - `rawDbValue(key: string): string | undefined` (hanya cache DB)
  - `sourceOf(key: string): "db" | "env" | "default"`
  - `setConfig(key: string, value: string): Promise<void>` (tulis DB + cache)
  - `clearConfig(key: string): Promise<void>` (hapus DB + cache)

- [ ] **Step 1: Tulis test resolver (gagal dulu)**

Buat `server/test/config-resolver.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import * as cfg from "../src/config";

const clean = async () => { await prisma.runtimeConfig.deleteMany(); };
beforeEach(async () => { await clean(); delete process.env.__CFG_T; await cfg.loadConfig(); });
afterAll(clean);

describe("config resolver (DB → env → default)", () => {
  it("default registry saat DB & env kosong", () => {
    expect(cfg.effectiveInt("SYNC_TICK_MS")).toBe(15000);
    expect(cfg.sourceOf("SYNC_TICK_MS")).toBe("default");
  });
  it("env menang atas default; source=env", () => {
    process.env.SYNC_TICK_MS = "9000";
    // env dibaca point-of-use (bukan cache), jadi tak perlu reload
    expect(cfg.effectiveInt("SYNC_TICK_MS")).toBe(9000);
    expect(cfg.sourceOf("SYNC_TICK_MS")).toBe("env");
    delete process.env.SYNC_TICK_MS;
  });
  it("DB menang atas env; source=db", async () => {
    process.env.SYNC_TICK_MS = "9000";
    await cfg.setConfig("SYNC_TICK_MS", "3000");
    expect(cfg.effectiveInt("SYNC_TICK_MS")).toBe(3000);
    expect(cfg.sourceOf("SYNC_TICK_MS")).toBe("db");
    await cfg.clearConfig("SYNC_TICK_MS");
    expect(cfg.effectiveInt("SYNC_TICK_MS")).toBe(9000); // balik ke env
    delete process.env.SYNC_TICK_MS;
  });
  it("effectiveBool", async () => {
    expect(cfg.effectiveBool("HANOMAN_UPDATE_FETCH")).toBe(true); // default "1"
    await cfg.setConfig("HANOMAN_UPDATE_FETCH", "0");
    expect(cfg.effectiveBool("HANOMAN_UPDATE_FETCH")).toBe(false);
  });
  it("effectiveStr tanpa default → undefined", () => {
    expect(cfg.effectiveStr("SYNC_SERVER_URL")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Jalankan — verifikasi gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- config-resolver`
Expected: FAIL (module `../src/config` belum ada).

- [ ] **Step 3: Implement resolver**

Buat `server/src/config.ts`:

```ts
import { prisma } from "./db";
import { configEntry } from "@hanoman/shared";

// SPEC-215 · ADR-0049 · resolver terpusat: override DB → env → default registry.
// Cache in-memory agar hot-path sinkron; di-refresh saat setConfig/clearConfig.
let cache = new Map<string, string>();

export async function loadConfig(): Promise<void> {
  const rows = await prisma.runtimeConfig.findMany();
  cache = new Map(rows.map((r) => [r.key, r.value]));
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
  await prisma.runtimeConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
  cache.set(key, value);
}
export async function clearConfig(key: string): Promise<void> {
  await prisma.runtimeConfig.deleteMany({ where: { key } });
  cache.delete(key);
}
```

- [ ] **Step 4: Jalankan — verifikasi lulus**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- config-resolver`
Expected: PASS semua.

- [ ] **Step 5: Commit**

```bash
git add server/src/config.ts server/test/config-resolver.test.ts
git commit -m "feat(server): resolver config DB->env->default (SPEC-215)"
```

---

### Task 4: Sync client re-init live + status + boot pakai resolver

**Files:**
- Modify: `server/src/services/sync-client.ts` (tambah `applySyncConfig`, `syncStatus`; `startSyncClient` terima `tickMs`)
- Create: `server/src/services/config-apply.ts`
- Modify: `server/src/server.ts:8,37-42` (pakai resolver + boot apply)
- Test: `server/test/config-apply.test.ts`

**Interfaces:**
- Consumes: `effectiveStr/effectiveInt` (Task 3); `configEntry` (Task 2); `startSyncClient/stopSyncClient` (existing).
- Produces:
  - `syncStatus(): { running: boolean; connected: boolean }` (sync-client.ts)
  - `applySyncConfig(): Promise<void>` (sync-client.ts) — stop lalu start bila `SYNC_SERVER_URL`+`SYNC_DEVICE_TOKEN` efektif ada.
  - `applyConfigSideEffect(key: string): Promise<void>` (config-apply.ts)
  - `applyConfigOnBoot(): Promise<void>` (config-apply.ts)

- [ ] **Step 1: Tambah tickMs arg + status + applySyncConfig ke sync-client.ts**

Di `server/src/services/sync-client.ts`, ganti deklarasi state & `startSyncClient`/`stopSyncClient`, dan tambah fungsi baru. Ubah baris `let timer…`/`let ws…` menjadi:

```ts
let timer: NodeJS.Timeout | undefined;
let ws: import("ws").WebSocket | undefined;
let started = false;

// Status sync client aktif (untuk indikator UI di GET /api/config).
export function syncStatus(): { running: boolean; connected: boolean } {
  return { running: started, connected: ws?.readyState === 1 /* OPEN */ };
}
```

Ubah signature `startSyncClient` agar menerima `tickMs` dan set `started`:

```ts
export async function startSyncClient(base: string, token: string, tickMs?: number): Promise<void> {
  started = true;
  const transport = fetchTransport(base, token);
```

Ganti baris `const tickMs = Number(process.env.SYNC_TICK_MS) || 15_000;` menjadi:

```ts
  const ms = tickMs && tickMs > 0 ? tickMs : 15_000;
```
dan pada `setInterval` ganti `tickMs` → `ms`:
```ts
  timer = setInterval(() => { void tick(); }, ms);
```

Di `stopSyncClient`, tambah `started = false;`:

```ts
export function stopSyncClient(): void {
  started = false;
  if (timer) { clearInterval(timer); timer = undefined; }
  try { ws?.close(); } catch { /* noop */ }
  ws = undefined;
}
```

Tambah `applySyncConfig` di akhir file (import resolver di atas):

```ts
import { effectiveStr, effectiveInt } from "../config";

// SPEC-215 · re-init live saat config sync berubah. Kosong → hanya stop (jadi HUB murni).
export async function applySyncConfig(): Promise<void> {
  stopSyncClient();
  const base = effectiveStr("SYNC_SERVER_URL");
  const token = effectiveStr("SYNC_DEVICE_TOKEN");
  if (base && token) await startSyncClient(base, token, effectiveInt("SYNC_TICK_MS"));
}
```

- [ ] **Step 2: Buat config-apply.ts**

Buat `server/src/services/config-apply.ts`:

```ts
import { configEntry } from "@hanoman/shared";
import { CONFIG_REGISTRY } from "@hanoman/shared";
import { effectiveStr } from "../config";
import { applySyncConfig } from "./sync-client";

const SYNC_KEYS = new Set(["SYNC_SERVER_URL", "SYNC_DEVICE_TOKEN", "SYNC_TICK_MS"]);

// Mirror nilai efektif kredensial warisan ke process.env agar proses claude baru mewarisinya.
function mirrorInheritEnv(key: string): void {
  const v = effectiveStr(key);
  if (v === undefined) delete process.env[key]; else process.env[key] = v;
}

// SPEC-215 · dispatch side-effect untuk satu key yang berubah (set/clear).
export async function applyConfigSideEffect(key: string): Promise<void> {
  if (SYNC_KEYS.has(key)) { await applySyncConfig(); return; }
  if (configEntry(key)?.inheritEnv) mirrorInheritEnv(key);
}

// SPEC-215 · dipanggil saat boot server: mirror semua kredensial warisan + init sync client.
export async function applyConfigOnBoot(): Promise<void> {
  for (const e of CONFIG_REGISTRY) if (e.inheritEnv) mirrorInheritEnv(e.key);
  await applySyncConfig();
}
```

- [ ] **Step 3: Ubah server.ts boot pakai resolver**

Di `server/src/server.ts`: hapus baris `process.env.HANOMAN_UPDATE_FETCH ??= "1";` (default sudah dari registry) **JANGAN dulu** — biarkan sampai Task 7 mengganti pembacanya. Ganti blok boot sync (baris 35-42) menjadi:

```ts
  // SPEC-215 · config runtime: muat override DB lalu terapkan (mirror kredensial + init sync client).
  const { loadConfig } = await import("./config");
  const { applyConfigOnBoot } = await import("./services/config-apply");
  await loadConfig();
  await applyConfigOnBoot();
```
Hapus `import { startSyncClient } from "./services/sync-client";` bila tak lagi dipakai di server.ts (applyConfigOnBoot yang memanggilnya). Verifikasi tak ada referensi `startSyncClient` tersisa di server.ts.

- [ ] **Step 4: Tulis test config-apply (sync re-init)**

Buat `server/test/config-apply.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "../src/db";
import * as cfg from "../src/config";
import { syncStatus } from "../src/services/sync-client";
import { applyConfigSideEffect } from "../src/services/config-apply";

// applySyncConfig memanggil startSyncClient yang membuka fetch/ws nyata — cegah dengan
// men-stub fetch agar tak ada koneksi keluar; kita hanya menguji running flag & mirror env.
const clean = async () => { await prisma.runtimeConfig.deleteMany(); };
beforeEach(async () => { await clean(); await cfg.loadConfig(); });
afterAll(async () => { await clean(); const { stopSyncClient } = await import("../src/services/sync-client"); stopSyncClient(); });

describe("config side-effects", () => {
  it("set SYNC_SERVER_URL+token → sync client running; clear → stop", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ records: [], cursor: "0" }), status: 200 }));
    await cfg.setConfig("SYNC_SERVER_URL", "http://127.0.0.1:9"); await applyConfigSideEffect("SYNC_SERVER_URL");
    await cfg.setConfig("SYNC_DEVICE_TOKEN", "tok"); await applyConfigSideEffect("SYNC_DEVICE_TOKEN");
    expect(syncStatus().running).toBe(true);
    await cfg.clearConfig("SYNC_SERVER_URL"); await applyConfigSideEffect("SYNC_SERVER_URL");
    expect(syncStatus().running).toBe(false);
    vi.unstubAllGlobals();
  });
  it("kredensial inheritEnv di-mirror ke process.env", async () => {
    await cfg.setConfig("ANTHROPIC_API_KEY", "sk-test"); await applyConfigSideEffect("ANTHROPIC_API_KEY");
    expect(process.env.ANTHROPIC_API_KEY).toBe("sk-test");
    await cfg.clearConfig("ANTHROPIC_API_KEY"); await applyConfigSideEffect("ANTHROPIC_API_KEY");
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});
```

- [ ] **Step 5: Jalankan test + typecheck**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- config-apply`
Expected: PASS.
Run: `env -u NODE_ENV pnpm --filter ./server exec tsc --noEmit`
Expected: 0 error (khususnya server.ts tak lagi referensi `startSyncClient` yang di-drop).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/sync-client.ts server/src/services/config-apply.ts server/src/server.ts server/test/config-apply.test.ts
git commit -m "feat(server): sync re-init live + boot pakai resolver config (SPEC-215)"
```

---

### Task 5: API `GET/PUT/DELETE /api/config` + tipe shared

**Files:**
- Modify: `shared/src/api.ts` (tambah `paths.config`, `paths.configKey`, tipe `ConfigEntryView`, `ConfigResponse`)
- Create: `server/src/routes/config.ts`
- Modify: `server/src/app.ts:24,91` (import + register)
- Test: `server/test/config.route.test.ts`

**Interfaces:**
- Consumes: resolver (Task 3), registry (Task 2), `applyConfigSideEffect` (Task 4), `syncStatus` (Task 4).
- Produces:
  - `paths.config = "/api/config"`, `paths.configKey(key) = "/api/config/:key"`
  - `type ConfigEntryView = { key; group; label; help?; kind; apply; category; editable; source: "db"|"env"|"default"; value?: string | null; masked?: string | null; hasValue?: boolean }`
  - `type ConfigResponse = { entries: ConfigEntryView[]; sync: { running: boolean; connected: boolean } }`

- [ ] **Step 1: Tambah paths + tipe di shared/src/api.ts**

Di `shared/src/api.ts`, dalam objek `paths` (setelah baris `deviceToken:`):

```ts
  // SPEC-215 · config runtime
  config: `${API}/config`,
  configKey: (key: string) => `${API}/config/${encodeURIComponent(key)}`,
```

Di akhir `shared/src/api.ts` (setelah penutup `paths`), tambahkan tipe:

```ts
// SPEC-215 · view config untuk UI. Secret: tanpa `value`, pakai `masked` + `hasValue`.
export type ConfigEntryView = {
  key: string; group: string; label: string; help?: string;
  kind: import("./config-registry").ConfigKind;
  apply: import("./config-registry").ApplyMode;
  category: import("./config-registry").ConfigCategory;
  min?: number; max?: number;
  editable: boolean; source: "db" | "env" | "default";
  value?: string | null;        // non-secret
  masked?: string | null;       // secret & bootstrap secret
  hasValue?: boolean;           // secret: apakah ada nilai efektif
};
export type ConfigResponse = { entries: ConfigEntryView[]; sync: { running: boolean; connected: boolean } };
```

- [ ] **Step 2: Tulis test route (gagal dulu)**

Buat `server/test/config.route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { loadConfig } from "../src/config";

const app = buildApp();
const clean = async () => { await prisma.runtimeConfig.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany(); };
beforeEach(async () => { await clean(); await loadConfig(); });
afterAll(clean);

const cookieOf = (r: { headers: Record<string, unknown> }) => (r.headers["set-cookie"] as string).split(";")[0];
async function login() {
  const r = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "a@b.co", password: "password1" } });
  return cookieOf(r);
}

describe("config routes", () => {
  it("401 tanpa cookie", async () => {
    expect((await app.inject({ method: "GET", url: "/api/config" })).statusCode).toBe(401);
  });
  it("GET: entri lengkap + sync status; secret termask tanpa value", async () => {
    const cookie = await login();
    const r = await app.inject({ method: "GET", url: "/api/config", headers: { cookie } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.sync).toMatchObject({ running: expect.any(Boolean), connected: expect.any(Boolean) });
    const token = body.entries.find((e: any) => e.key === "SYNC_DEVICE_TOKEN");
    expect(token.category).toBe("credential");
    expect(token).not.toHaveProperty("value");
    expect(token.hasValue).toBe(false);
    const bootstrap = body.entries.find((e: any) => e.key === "DATABASE_URL");
    expect(bootstrap.editable).toBe(false);
  });
  it("PUT knob valid → tersimpan + source db", async () => {
    const cookie = await login();
    const put = await app.inject({ method: "PUT", url: "/api/config", headers: { cookie }, payload: { key: "SYNC_TICK_MS", value: "3000" } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ key: "SYNC_TICK_MS", value: "3000", source: "db" });
  });
  it("PUT int invalid → 400", async () => {
    const cookie = await login();
    const put = await app.inject({ method: "PUT", url: "/api/config", headers: { cookie }, payload: { key: "SYNC_TICK_MS", value: "5" } });
    expect(put.statusCode).toBe(400);
  });
  it("PUT bootstrap → 400", async () => {
    const cookie = await login();
    const put = await app.inject({ method: "PUT", url: "/api/config", headers: { cookie }, payload: { key: "PORT", value: "9000" } });
    expect(put.statusCode).toBe(400);
  });
  it("PUT unknown key → 400", async () => {
    const cookie = await login();
    const put = await app.inject({ method: "PUT", url: "/api/config", headers: { cookie }, payload: { key: "NOPE", value: "x" } });
    expect(put.statusCode).toBe(400);
  });
  it("PUT secret; GET termask; blank pertahankan; DELETE clear", async () => {
    const cookie = await login();
    await app.inject({ method: "PUT", url: "/api/config", headers: { cookie }, payload: { key: "SYNC_DEVICE_TOKEN", value: "supersecret9999" } });
    let g = await app.inject({ method: "GET", url: "/api/config", headers: { cookie } });
    let tok = g.json().entries.find((e: any) => e.key === "SYNC_DEVICE_TOKEN");
    expect(tok.hasValue).toBe(true);
    expect(tok.masked).toBe("••••9999");
    expect(tok).not.toHaveProperty("value");
    // blank = pertahankan
    await app.inject({ method: "PUT", url: "/api/config", headers: { cookie }, payload: { key: "SYNC_DEVICE_TOKEN", value: "" } });
    g = await app.inject({ method: "GET", url: "/api/config", headers: { cookie } });
    expect(g.json().entries.find((e: any) => e.key === "SYNC_DEVICE_TOKEN").hasValue).toBe(true);
    // DELETE clear
    const del = await app.inject({ method: "DELETE", url: "/api/config/SYNC_DEVICE_TOKEN", headers: { cookie } });
    expect(del.statusCode).toBe(204);
    g = await app.inject({ method: "GET", url: "/api/config", headers: { cookie } });
    expect(g.json().entries.find((e: any) => e.key === "SYNC_DEVICE_TOKEN").hasValue).toBe(false);
  });
});
```

- [ ] **Step 3: Jalankan — verifikasi gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- config.route`
Expected: FAIL (route belum ada / 404).

- [ ] **Step 4: Implement route**

Buat `server/src/routes/config.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { CONFIG_REGISTRY, configEntry, parseConfigValue, maskSecret, type ConfigEntry } from "@hanoman/shared";
import type { ConfigEntryView } from "@hanoman/shared";
import { effectiveStr, rawDbValue, sourceOf, setConfig, clearConfig } from "../config";
import { applyConfigSideEffect } from "../services/config-apply";
import { syncStatus } from "../services/sync-client";

// SPEC-215 · ADR-0049 · kelola config runtime dari dashboard (cookie-authed). Secret & connection
// string tak pernah balik plaintext — hanya masked + hasValue. Bootstrap read-only.
const isSecret = (e: ConfigEntry) => e.kind === "secret";

function view(e: ConfigEntry): ConfigEntryView {
  const eff = effectiveStr(e.key);
  const base = {
    key: e.key, group: e.group, label: e.label, help: e.help, kind: e.kind,
    apply: e.apply, category: e.category, min: e.min, max: e.max,
    editable: e.category !== "bootstrap", source: sourceOf(e.key),
  };
  if (isSecret(e)) return { ...base, masked: eff ? maskSecret(eff) : null, hasValue: eff !== undefined };
  return { ...base, value: eff ?? null };
}

export default async function (app: FastifyInstance) {
  app.get("/config", async () => ({
    entries: CONFIG_REGISTRY.map(view), sync: syncStatus(),
  }));

  app.put("/config", async (req, reply) => {
    const b = req.body as { key?: string; value?: string };
    const entry = b?.key ? configEntry(b.key) : undefined;
    if (!entry) return reply.code(400).send({ error: "key tak dikenal" });
    if (entry.category === "bootstrap") return reply.code(400).send({ error: "bootstrap read-only" });
    const raw = b.value ?? "";
    // secret dengan value kosong = pertahankan yang lama (no-op DB).
    if (isSecret(entry) && raw.trim() === "") {
      if (rawDbValue(entry.key) === undefined) return reply.code(400).send({ error: "tak boleh kosong" });
      return view(entry);
    }
    const parsed = parseConfigValue(entry, raw);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    await setConfig(entry.key, parsed.value);
    await applyConfigSideEffect(entry.key);
    return view(entry);
  });

  app.delete("/config/:key", async (req, reply) => {
    const { key } = req.params as { key: string };
    const entry = configEntry(key);
    if (!entry) return reply.code(400).send({ error: "key tak dikenal" });
    if (entry.category === "bootstrap") return reply.code(400).send({ error: "bootstrap read-only" });
    await clearConfig(key);
    await applyConfigSideEffect(key);
    return reply.code(204).send();
  });
}
```

- [ ] **Step 5: Register route di app.ts**

Di `server/src/app.ts`: tambah import setelah baris 23 (`import authRoutes …`) — atau dekat `sessionResults`:

```ts
import config from "./routes/config";
```
Dan register di dalam blok `{ prefix: "/api" }` (setelah `await api.register(sessionResults);`):

```ts
    await api.register(config);
```

- [ ] **Step 6: Jalankan test + typecheck**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- config.route`
Expected: PASS semua.
Run: `env -u NODE_ENV pnpm --filter ./server exec tsc --noEmit`
Expected: 0 error.

- [ ] **Step 7: Boot server + curl (per CLAUDE.md)**

Boot di DB throwaway (memori: jangan pakai hanoman_test untuk smoke; port bukan 8787). Contoh:
```bash
env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman" PORT=8899 HOST=127.0.0.1 \
  node server/dist/server.js &   # setelah `pnpm --filter ./server build`
```
Lalu (butuh cookie — pakai flow setup/login atau uji 401):
```bash
curl -s http://127.0.0.1:8899/api/config | head   # → {"error":"unauthorized"} (401 gate cookie)
```
Expected: 401 JSON (membuktikan route terpasang di bawah gate). Hentikan server setelah verifikasi.

- [ ] **Step 8: Commit**

```bash
git add shared/src/api.ts server/src/routes/config.ts server/src/app.ts server/test/config.route.test.ts
git commit -m "feat(server): API GET/PUT/DELETE /api/config (SPEC-215)"
```

---

### Task 6: Frontend — api client + tab "Konfigurasi"

**Files:**
- Modify: `src/src/api/client.ts` (tambah `getConfig/putConfig/deleteConfig`)
- Modify: `src/src/screens/SettingsScreen.tsx` (import tipe, tambah tab `konfigurasi`, komponen `ConfigPanel`)
- Test: `src/test/config-panel.test.tsx`

**Interfaces:**
- Consumes: `paths.config/configKey`, `ConfigResponse`, `ConfigEntryView` (Task 5); registry helper `maskSecret` bila perlu.
- Produces: `api.getConfig()`, `api.putConfig(key, value)`, `api.deleteConfig(key)`.

- [ ] **Step 1: Tambah metode api client**

Di `src/src/api/client.ts`, tambah `ConfigResponse, ConfigEntryView` ke import `@hanoman/shared` di baris 1, lalu tambah di objek `api` (dekat `putSettings`):

```ts
  // SPEC-215 · config runtime
  getConfig: () => j<ConfigResponse>(paths.config),
  putConfig: (key: string, value: string) => j<ConfigEntryView>(paths.config, { method: "PUT", ...body({ key, value }) }),
  deleteConfig: (key: string) => j<void>(paths.configKey(key), { method: "DELETE" }),
```

- [ ] **Step 2: Tulis test komponen (gagal dulu)**

Buat `src/test/config-panel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { SettingsScreen } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";

const me = { id: "u1", email: "a@b.co", createdAt: "", name: null } as any;

const cfgResponse = {
  sync: { running: false, connected: false },
  entries: [
    { key: "SYNC_SERVER_URL", group: "sync", label: "URL hub", kind: "url", apply: "live", category: "knob", editable: true, source: "default", value: null },
    { key: "SYNC_DEVICE_TOKEN", group: "sync", label: "Device token", kind: "secret", apply: "live", category: "credential", editable: true, source: "default", masked: null, hasValue: false },
    { key: "DATABASE_URL", group: "bootstrap", label: "DATABASE_URL", kind: "secret", apply: "restart", category: "bootstrap", editable: false, source: "env", masked: "••••_dev", hasValue: true },
  ],
};

beforeEach(() => {
  vi.spyOn(api, "getConfig").mockResolvedValue(cfgResponse as any);
  vi.spyOn(api, "getSettings").mockResolvedValue({} as any);
  vi.spyOn(api, "putConfig").mockResolvedValue({ key: "SYNC_SERVER_URL", value: "https://h.co", source: "db" } as any);
});

describe("ConfigPanel (tab Konfigurasi)", () => {
  it("render entri per grup; bootstrap read-only; secret termask", async () => {
    render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
    fireEvent.click(screen.getByText("Konfigurasi"));
    await waitFor(() => expect(screen.getByText("URL hub")).toBeInTheDocument());
    expect(screen.getByText("Device token")).toBeInTheDocument();
    // bootstrap read-only: tampil masked, tak ada input editable untuk DATABASE_URL
    expect(screen.getByText("••••_dev")).toBeInTheDocument();
  });
  it("simpan knob memanggil putConfig", async () => {
    render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
    fireEvent.click(screen.getByText("Konfigurasi"));
    await waitFor(() => screen.getByText("URL hub"));
    const input = screen.getByLabelText("URL hub") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "https://h.co" } });
    fireEvent.click(screen.getAllByText("Simpan")[0]);
    await waitFor(() => expect(api.putConfig).toHaveBeenCalledWith("SYNC_SERVER_URL", "https://h.co"));
  });
});
```

> Catatan: sesuaikan `getByLabelText`/label & tombol dengan markup final; test ini mendikte kontrak minimal (render per grup, bootstrap read-only, secret masked, Simpan→putConfig). Cek satu file test SettingsScreen lain (mis. `src/test/settings-nav.test.tsx`) untuk pola render/props yang benar sebelum menulis.

- [ ] **Step 3: Jalankan — verifikasi gagal**

Run: `pnpm --filter ./src test -- config-panel`
Expected: FAIL (tab "Konfigurasi" belum ada).

- [ ] **Step 4: Tambah entri tab + komponen ConfigPanel**

Di `src/src/screens/SettingsScreen.tsx`:

(a) Tambah ke `S_SECTIONS` (setelah `perangkat`/`aktivitas`, sebelum `umum`):
```tsx
  { key: "konfigurasi", label: "Konfigurasi", icon: "sliders" },  // SPEC-215 · env runtime
```

(b) Tambah `ConfigResponse, ConfigEntryView` ke import `@hanoman/shared` (baris 6).

(c) Tambah komponen sebelum `export function SettingsScreen`:
```tsx
// SPEC-215 · atur env non-bootstrap via Settings. Secret: mask + "Ganti"; bootstrap read-only.
const GROUP_LABEL: Record<string, string> = {
  sync: "Sync", claude: "Claude", vps: "VPS", runtime: "Runtime", bootstrap: "Bootstrap (read-only)",
};
function ConfigPanel({ onToast }: { onToast?: ShowToast }) {
  const [data, setData] = React.useState<ConfigResponse | null>(null);
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const load = React.useCallback(() => { api.getConfig().then(setData).catch(() => setData(null)); }, []);
  React.useEffect(() => { load(); }, [load]);
  if (!data) return <StateBlock kind="loading" title="Memuat konfigurasi…" />;

  const save = async (e: ConfigEntryView) => {
    const v = drafts[e.key] ?? "";
    try { await api.putConfig(e.key, v); setDrafts((d) => { const n = { ...d }; delete n[e.key]; return n; }); load();
      onToast?.(`${e.label} disimpan`, "ok", "check-circle-2"); }
    catch { onToast?.(`Gagal menyimpan ${e.label}`, "err", "x-circle"); }
  };
  const reset = async (e: ConfigEntryView) => {
    try { await api.deleteConfig(e.key); load(); onToast?.(`${e.label} direset`, "warn", "rotate-ccw"); }
    catch { onToast?.("Gagal reset", "err", "x-circle"); }
  };

  const groups = [...new Set(data.entries.map((e) => e.group))];
  return (
    <>
      {groups.map((g) => (
        <Card key={g} eyebrow={g} title={GROUP_LABEL[g] ?? g}>
          {g === "sync" && (
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 8 }}>
              {data.sync.running ? (data.sync.connected ? "● Tersambung ke hub" : "◐ Sync aktif, menyambung…") : "○ Tidak sync (HUB murni)"}
            </div>
          )}
          {data.entries.filter((e) => e.group === g).map((e) => (
            <SettingRow key={e.key} title={e.label} desc={e.help}>
              <ConfigField entry={e} draft={drafts[e.key]}
                onDraft={(v) => setDrafts((d) => ({ ...d, [e.key]: v }))}
                onSave={() => save(e)} onReset={() => reset(e)} />
            </SettingRow>
          ))}
        </Card>
      ))}
    </>
  );
}

function ConfigField({ entry, draft, onDraft, onSave, onReset }: {
  entry: ConfigEntryView; draft?: string; onDraft: (v: string) => void; onSave: () => void; onReset: () => void;
}) {
  const badge = <span style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", color: "var(--text-subtle)", marginRight: 8 }}>{entry.source} · {entry.apply}</span>;
  if (!entry.editable) { // bootstrap read-only
    return <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{badge}
      <code style={{ fontSize: 12 }}>{entry.masked ?? entry.value ?? "—"}</code></div>;
  }
  if (entry.kind === "secret") {
    return <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{badge}
      {entry.hasValue && draft === undefined
        ? <><code style={{ fontSize: 12 }}>{entry.masked}</code>
            <Button size="sm" variant="ghost" leftIcon="pencil" onClick={() => onDraft("")}>Ganti</Button>
            <Button size="sm" variant="ghost" leftIcon="trash-2" onClick={onReset}>Hapus</Button></>
        : <><Input aria-label={entry.label} type="password" placeholder={entry.hasValue ? "biarkan kosong = pertahankan" : "tempel token…"}
              value={draft ?? ""} onChange={(ev) => onDraft(ev.target.value)} style={{ width: 240 }} />
            <Button size="sm" leftIcon="save" onClick={onSave}>Simpan</Button></>}
    </div>;
  }
  if (entry.kind === "bool") {
    const on = (draft ?? entry.value) === "1";
    return <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{badge}
      <Switch checked={on} onChange={(v: boolean) => { onDraft(v ? "1" : "0"); }} />
      {draft !== undefined && <Button size="sm" leftIcon="save" onClick={onSave}>Simpan</Button>}</div>;
  }
  // url | int | string | path
  return <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{badge}
    <Input aria-label={entry.label} type={entry.kind === "int" ? "number" : "text"}
      value={draft ?? entry.value ?? ""} onChange={(ev) => onDraft(ev.target.value)} style={{ width: 240 }} />
    <Button size="sm" leftIcon="save" onClick={onSave}>Simpan</Button>
    {entry.source === "db" && <Button size="sm" variant="ghost" leftIcon="rotate-ccw" onClick={onReset}>Reset</Button>}</div>;
}
```

(d) Tambah ke dispatcher `content` (dekat baris 350-354):
```tsx
    : tab === "konfigurasi" ? <ConfigPanel onToast={onToast} />
```

- [ ] **Step 5: Jalankan test web**

Run: `pnpm --filter ./src test -- config-panel`
Expected: PASS. (Sesuaikan markup/label bila assertion meleset — cek `Input`/`Switch`/`Button` di `src/src/ds`.)

- [ ] **Step 6: Typecheck web**

Run: `pnpm --filter ./src exec tsc --noEmit`
Expected: 0 error.

- [ ] **Step 7: Commit**

```bash
git add src/src/api/client.ts src/src/screens/SettingsScreen.tsx src/test/config-panel.test.tsx
git commit -m "feat(web): tab Konfigurasi — atur env runtime dari Settings (SPEC-215)"
```

---

### Task 7: Refactor pembacaan `process.env.*` non-bootstrap → `cfg.*`

**Files (ganti pembacaan, satu per satu):**
- Modify: `server/src/services/events.ts:20`
- Modify: `server/src/services/pty.ts:16,51`
- Modify: `server/src/services/limits.ts:26,32`
- Modify: `server/src/services/vps-key.ts:8`
- Modify: `server/src/services/vps-ssh.ts:7`
- Modify: `server/src/services/update.ts:51,70`
- Modify: `server/src/server.ts:8` (hapus `process.env.HANOMAN_UPDATE_FETCH ??= "1"` — default kini dari registry)

**Interfaces:**
- Consumes: `effectiveStr/effectiveInt/effectiveBool` (Task 3).

> Semua situs baca sudah **point-of-use** (fungsi/getter), jadi swap ke `cfg.*` otomatis live. `SYNC_TICK_MS` & `SYNC_SERVER_URL/TOKEN` sudah lewat resolver di Task 4 — tak diulang di sini.

- [ ] **Step 1: events.ts — TICK_MS live**

Ganti baris 20 `const TICK_MS = Number(process.env.HANOMAN_EVENTS_TICK_MS) || 1000;` dan pemakaiannya. Tambah import `import { effectiveInt } from "../config";`. Ubah pembaca interval agar membaca per-pakai:
```ts
const tickMs = () => effectiveInt("HANOMAN_EVENTS_TICK_MS") ?? 1000;
```
Ganti setiap pemakaian `TICK_MS` menjadi `tickMs()`. Cari referensi: `grep -n "TICK_MS" server/src/services/events.ts`.

- [ ] **Step 2: pty.ts — socket + claudeBin live**

Tambah `import { effectiveStr } from "../config";`. Ganti:
```ts
const socket = () => effectiveStr("HANOMAN_TMUX_SOCKET") ?? "hanoman";
const claudeBin = () => effectiveStr("HANOMAN_CLAUDE_BIN") ?? "claude";
```

- [ ] **Step 3: limits.ts — CLAUDE_CONFIG_DIR**

Tambah `import { effectiveStr } from "../config";`. Ganti baris 26 & 32 pembacaan `process.env.CLAUDE_CONFIG_DIR` → `effectiveStr("CLAUDE_CONFIG_DIR")`. Contoh baris 26:
```ts
  return join(effectiveStr("CLAUDE_CONFIG_DIR") ?? join(homedir(), ".claude"), ".credentials.json");
```
dan baris 32:
```ts
  if (process.platform === "darwin" && !effectiveStr("CLAUDE_CONFIG_DIR")) {
```

- [ ] **Step 4: vps-key.ts & vps-ssh.ts**

`vps-key.ts` tambah import + ganti baris 8:
```ts
export const keyDir = (): string => effectiveStr("HANOMAN_SSH_KEY_DIR") ?? join(homedir(), ".hanoman");
```
`vps-ssh.ts` tambah import + ganti baris 7:
```ts
export const sshBin = () => effectiveStr("HANOMAN_SSH_BIN") ?? "ssh";
```

- [ ] **Step 5: update.ts — repoRoot + update-fetch**

Tambah `import { effectiveStr, effectiveBool } from "../config";`. Ganti baris 51 & 70:
```ts
function repoRoot(): string { return effectiveStr("HANOMAN_REPO_ROOT") ?? process.cwd(); }
```
```ts
  if (!effectiveBool("HANOMAN_UPDATE_FETCH")) return;
```

- [ ] **Step 6: server.ts — hapus default env HANOMAN_UPDATE_FETCH**

Hapus baris 8 `process.env.HANOMAN_UPDATE_FETCH ??= "1";` (default "1" kini dari registry via `effectiveBool`).

- [ ] **Step 7: Typecheck + suite server penuh (parity — tak ada regresi)**

Run: `env -u NODE_ENV pnpm --filter ./server exec tsc --noEmit`
Expected: 0 error.
Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- --no-file-parallelism`
Expected: seluruh suite server hijau (termasuk events/pty/limits/vps/update yang tersentuh).

- [ ] **Step 8: Commit**

```bash
git add server/src/services/events.ts server/src/services/pty.ts server/src/services/limits.ts server/src/services/vps-key.ts server/src/services/vps-ssh.ts server/src/services/update.ts server/src/server.ts
git commit -m "refactor(server): baca env non-bootstrap via resolver config (SPEC-215)"
```

---

### Task 8: Docs — .env examples, spec SPEC-213, parity

**Files:**
- Modify: `.env.example` (tandai knob "juga via Settings")
- Modify: `.env.production.example`
- Modify: `internal/docs/specs/2026-07-14-server-client-sync-spec-213-design.md` (catatan OQ-4 sebagian digantikan)
- Modify: `internal/docs/operations/production.md` (bila menyebut SYNC_* env; tambah catatan Settings) — cek keberadaan dulu.

- [ ] **Step 1: Update .env.example**

Di blok "Peran sync CLIENT" dan knob opsional, tambah catatan singkat pada tiap knob non-bootstrap, mis. di atas `# SYNC_SERVER_URL=`:
```
# Knob di bawah (non-kredensial + device token) JUGA dapat diatur runtime lewat
# Settings → Konfigurasi (SPEC-215): override DB menang atas env. Bootstrap (DATABASE_URL,
# PORT, HOST, NODE_ENV) tetap env-only.
```

- [ ] **Step 2: Update .env.production.example**

Tambah satu baris catatan serupa di header (setelah paragraf pembuka) menyebut Settings → Konfigurasi untuk knob non-bootstrap.

- [ ] **Step 3: Catatan di spec SPEC-213**

Di `internal/docs/specs/2026-07-14-server-client-sync-spec-213-design.md`, pada baris tabel OQ-4, tambahkan catatan inline:
```
> Catatan (SPEC-215/ADR-0049): OQ-4 sebagian digantikan — config sync kini dapat diatur runtime
> via Settings (override DB → env → default). Env tetap fallback bootstrap.
```

- [ ] **Step 4: Cek operations doc**

Run: `grep -rn "SYNC_SERVER_URL\|SYNC_DEVICE_TOKEN" internal/docs/operations 2>/dev/null`
Bila ada penyebutan, tambah kalimat: "Sejak SPEC-215 knob ini juga dapat diatur dari Settings → Konfigurasi (override DB menang)." Bila tak ada, lewati langkah ini.

- [ ] **Step 5: Verifikasi build web + server (deliverable bisa dijalankan)**

Run: `pnpm --filter ./src build && pnpm --filter ./server build`
Expected: keduanya sukses (memastikan tipe shared/registry ikut ter-build).

- [ ] **Step 6: Commit**

```bash
git add .env.example .env.production.example internal/docs
git commit -m "docs: env non-bootstrap dapat diatur via Settings; catatan OQ-4 (SPEC-215)"
```

---

## Self-Review (diisi penulis plan)

**Spec coverage:**
- Resolver DB→env→default → Task 3. Registry sumber tunggal → Task 2. Store RuntimeConfig local-only → Task 1. API GET/PUT/DELETE + mask + source + bootstrap-reject + secret-blank-keeps → Task 5. Side-effect sync re-apply live + kredensial mirror → Task 4. Refactor pembacaan env → Task 7. UI tab Konfigurasi + device token sisi client (entri secret grup sync) → Task 6. `sync.running/connected` di GET → Task 5 (dari `syncStatus` Task 4). Docs + parity → Task 8. **Semua bagian spec tercakup.**

**Placeholder scan:** tak ada TBD/TODO; setiap step berisi kode nyata / perintah + expected. Test komponen (Task 6) memberi disclaimer eksplisit untuk menyesuaikan markup — kontraknya tetap konkret.

**Type consistency:** `ConfigEntry`/`ConfigEntryView`/`ConfigResponse` konsisten lintas Task 2/5/6. `effectiveStr/Int/Bool`, `rawDbValue`, `sourceOf`, `setConfig`, `clearConfig` dipakai sama di Task 4/5. `applySyncConfig`/`syncStatus`/`applyConfigSideEffect`/`applyConfigOnBoot` konsisten Task 4→5. `inheritEnv` didefinisikan Task 2, dipakai Task 4.
