# SPEC-492 — Setelan runtime/model/effort sesi operator Telegram · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sesi operator Telegram bisa dijalankan dengan runtime, model, dan effort sendiri — disetel
dari kartu Settings **atau** dari chat Telegram, dan berlaku untuk sesi operator berikutnya.

**Architecture:** Blok opt-in `Setting.telegram.engine` (bentuk `zLeadEngine`, kolom `Json` → tanpa
migration) dibaca resolver `telegramAgentDefaults()` **di tiap kelahiran sesi operator** — bukan
hanya saat baris `TelegramChat` lahir, yang selama ini membekukan nilainya selamanya. Permukaan
operatornya dua: kartu Settings (`GET`/`PUT /api/settings`) dan empat command Telegram yang
**dicegat coordinator sebelum menyentuh pane**.

**Tech Stack:** TypeScript strict · zod (shared) · Fastify + Prisma 6/SQLite (server) · React + Vite
(web) · vitest.

**Spec:** `docs/superpowers/specs/2026-08-02-spec-492-telegram-engine-design.md`

## Global Constraints

- **Tanpa migration.** `Setting.data` bertipe `Json`; `TelegramChat` tidak berubah bentuk.
- **Tanpa endpoint baru** dan **tanpa timer/scheduler baru** (ADR-0024).
- **Tanpa ADR baru.** ADR-0096 · ADR-0061 · ADR-0074 · ADR-0081 **ditegakkan**, bukan diamandemen.
- **Default WAJIB `enabled: false`.** Instalasi yang sudah jalan tak boleh berubah perilakunya.
- **Jangan sentuh jalur kredensial** (`TELEGRAM_CONFIG_KEYS` di `RuntimeConfig`).
- **Jangan bikin knob global baru di akar `zSetting`** — `engine` duduk di dalam `telegram`.
- **Jangan bikin bentuk ketiga.** Bentuk `{enabled, agent, model, effort}` hanya boleh punya SATU
  definisi; `zLeadEngine` jadi alias-nya.
- Skema server tetap longgar (`model`/`effort` = `z.string()`); katalog ditegakkan permukaan
  operator (kartu Settings + parser command), bukan zod.
- Model & effort claude dari `MODELS`/`EFFORTS`; codex dari `CODEX_MODELS`/`codexEfforts(model)` —
  katalog `@hanoman/shared` yang sama dengan picker Start.
- Setiap task diakhiri: centang kotaknya di plan ini, jalankan **hanya test yang tersentuh**, commit.
- Perintah test server WAJIB `--no-file-parallelism` **dan** `TEST_DATABASE_URL` sendiri:
  `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"` (mesin ini menjalankan beberapa sesi sekaligus;
  `~/.hanoman/hanoman.test.db` dihapus `global-setup.ts` di awal tiap run).
- Perintah test web WAJIB `env -u NODE_ENV` (env shell menunjuk production → RTL `act` gagal massal).

---

## File Structure

**Dibuat:**

| Berkas | Tanggung jawab |
|---|---|
| `shared/src/agent-engine.ts` | Bentuk `{enabled, agent, model, effort}` sebagai modul **daun** (zod + `./enums` saja). Satu definisi untuk lead & telegram. |
| `shared/src/agent-engine.test.ts` | Default + bukti `zLeadEngine` masih bentuk yang sama. |
| `server/src/services/telegram/engine-command.ts` | **Murni**: parser & formatter empat command runtime. Nol DB, nol IO. |
| `server/src/services/telegram/config.ts` | Baca/tulis `Setting.telegram.engine`, resolver `telegramAgentDefaults()`, gerbang `telegramReloadNeeded()`. Cermin `services/lead/config.ts`. |
| `server/test/telegram-engine-command.test.ts` | Parser: sah, tolak, katalog codex, salah-agen. |
| `server/test/telegram-engine-config.test.ts` | Resolver 4 cabang + gerbang reload. |
| `server/test/telegram-engine-session.test.ts` | Kelahiran sesi memakai nilai segar, `ensureCodexTrust`, cegatan command. |
| `src/test/settings-telegram-engine.test.tsx` | Kartu "Agen operator Telegram". |

**Diubah:**

| Berkas | Perubahan |
|---|---|
| `shared/src/entities.ts` | `zLeadEngine` → alias `zAgentEngine`. |
| `shared/src/telegram.ts` | `+ engine: zAgentEngine.default({})`. |
| `shared/src/index.ts` | `+ export * from "./agent-engine"`. |
| `server/src/services/telegram/store.ts` | `+ setChatEngine()`. |
| `server/src/services/telegram/session.ts` | Resolver di kelahiran sesi + cegatan command + dep `engine`/`killSession`. |
| `server/src/services/telegram/gateway.ts` | Balasan progress generik dilewati untuk hasil `control`; audit `outcome: "control"`. |
| `server/src/services/telegram/bootstrap.ts` | `telegramSessionDeps()` diekstrak; `defaults: telegramAgentDefaults`. |
| `server/src/routes/settings.ts` | Gerbang reload memakai `telegramReloadNeeded()`. |
| `src/src/screens/SettingsScreen.tsx` | Kartu "Agen operator Telegram". |
| `runner/src/telegram-operator.ts` | `COMMANDS` menyebut command runtime. |
| `internal/docs/architecture/api-contract.md` | Blok `telegram.engine` + tabel command runtime. |
| `internal/skills/hanoman/SKILL.md` | Butir SPEC-492 di bagian Telegram. |

---

### Task 1: Bentuk `zAgentEngine` sebagai modul daun + `Setting.telegram.engine`

Menaruh `import { zLeadEngine } from "./entities"` di `telegram.ts` **meledak saat boot**:
`index.ts` mengevaluasi `./entities` dulu → entities meng-import `./telegram` (baris 3) → telegram
mengevaluasi `TELEGRAM_DEFAULTS = zTelegramSettings.parse({})` di top level → `zLeadEngine` (baris
237 entities) masih **TDZ** → `ReferenceError`. Karena itu bentuknya diekstrak ke modul daun.

**Files:**
- Create: `shared/src/agent-engine.ts`
- Create: `shared/src/agent-engine.test.ts`
- Modify: `shared/src/entities.ts:237-243`
- Modify: `shared/src/telegram.ts:6-11`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: `zAgent` dari `shared/src/enums.ts`.
- Produces: `zAgentEngine: ZodObject`, `type AgentEngine = { enabled: boolean; agent: "claude"|"codex"; model: string; effort: string }`, `zTelegramSettings` ber-field `engine`, `TELEGRAM_DEFAULTS.engine`.

- [x] **Step 1: Tulis test yang gagal**

Buat `shared/src/agent-engine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { zAgentEngine, zLeadEngine, zTelegramSettings, TELEGRAM_DEFAULTS, LEAD_DEFAULTS } from "./index";

describe("zAgentEngine (SPEC-492)", () => {
  it("default = override MATI, claude-opus-5 · xhigh", () => {
    expect(zAgentEngine.parse({})).toEqual({
      enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh",
    });
  });

  // Brief SPEC-492: "Tiru bentuk zLeadEngine apa adanya, jangan bikin bentuk ketiga yang beda."
  // Satu definisi, bukan dua yang kebetulan sama — kalau bercabang, ia bercabang diam-diam.
  it("zLeadEngine ADALAH zAgentEngine, bukan salinannya", () => {
    expect(zLeadEngine).toBe(zAgentEngine);
    expect(LEAD_DEFAULTS.engine).toEqual(zAgentEngine.parse({}));
  });

  it("model & effort tetap longgar — katalog ditegakkan permukaan operator, bukan server", () => {
    const v = zAgentEngine.parse({ enabled: true, agent: "codex", model: "gpt-9-belum-ada", effort: "ultra" });
    expect(v.model).toBe("gpt-9-belum-ada");
    expect(zAgentEngine.safeParse({ agent: "gemini" }).success).toBe(false);
  });

  it("telegram punya engine, default MATI supaya instalasi lama tak berubah perilakunya", () => {
    expect(zTelegramSettings.parse({})).toEqual({
      enabled: false, progress: true,
      engine: { enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh" },
    });
    expect(TELEGRAM_DEFAULTS.engine.enabled).toBe(false);
  });

  // Baris Setting lama (pra-SPEC-492) tak punya kunci `engine` sama sekali → wajib tetap parse.
  it("blok telegram lama tanpa engine tetap parse", () => {
    expect(zTelegramSettings.parse({ enabled: true, progress: false }).engine.enabled).toBe(false);
  });
});
```

- [x] **Step 2: Jalankan, pastikan GAGAL**

```bash
./node_modules/.bin/vitest run --dir shared shared/src/agent-engine.test.ts
```
Expected: FAIL — `Failed to resolve import "./index"` tidak muncul, tapi
`zAgentEngine is not exported` / `Cannot read properties of undefined (reading 'engine')`.

- [x] **Step 3: Buat modul daun**

Buat `shared/src/agent-engine.ts`:

```ts
import { z } from "zod";
import { zAgent } from "./enums";

/**
 * SPEC-492 · bentuk BERSAMA "override agen": satu triple (agen + model + effort) di atas satu
 * saklar opt-in. Dipakai `Setting.lead.engine` (SPEC-409/ADR-0091) dan `Setting.telegram.engine`
 * (SPEC-492). Sengaja SATU definisi, bukan dua yang kebetulan sama — dua definisi bercabang
 * diam-diam, dan kartu Settings keduanya memakai kode render yang sama.
 *
 * Ia hidup di modul DAUN (hanya zod + ./enums) karena `entities.ts` sudah meng-import
 * `./telegram`: mendefinisikannya di entities lalu meng-import-nya dari telegram menutup siklus
 * modul, dan `TELEGRAM_DEFAULTS = zTelegramSettings.parse({})` yang jalan di top level akan
 * membaca binding yang masih TDZ → `ReferenceError` sebelum satu route pun terdaftar.
 *
 * `model`/`effort` sengaja `z.string()` longgar seperti di akar `zSetting`: katalog ditegakkan
 * permukaan operator (kartu Settings, parser command Telegram), bukan server.
 */
export const zAgentEngine = z.object({
  enabled: z.boolean().default(false),
  agent: zAgent.default("claude"),
  model: z.string().default("claude-opus-5"),
  effort: z.string().default("xhigh"),
});
export type AgentEngine = z.infer<typeof zAgentEngine>;
```

- [x] **Step 4: Jadikan `zLeadEngine` alias**

Di `shared/src/entities.ts`, tambahkan import di dekat import lain di kepala berkas:

```ts
import { zAgentEngine, type AgentEngine } from "./agent-engine";
```

Ganti blok `zLeadEngine` (baris ~237-243) menjadi:

```ts
// `engine` = agen yang menjalankan lead (OQ-1). Opt-in seperti `zConflict`: selama `enabled`
// mati, lead memakai `sessionAgentDefaults()` — satu setelan agen, bukan dua yang bisa berselisih.
// SPEC-492 · bentuknya pindah ke `./agent-engine` supaya `Setting.telegram.engine` memakai
// definisi yang SAMA, bukan salinan. Nama lama dipertahankan: seluruh pemanggil tetap utuh.
export const zLeadEngine = zAgentEngine;
export type LeadEngine = AgentEngine;
```

- [x] **Step 5: Tambahkan `engine` ke `zTelegramSettings`**

Di `shared/src/telegram.ts`, tambahkan import dan field:

```ts
import { z } from "zod";
import { zAgentEngine } from "./agent-engine";
import { zAgent } from "./enums";

// SPEC-476 · ADR-0096 · Telegram hanya kanal ke sesi operator. Master switch opt-in;
// progress kanal aktif secara default setelah operator menyalakan gateway.
// SPEC-492 · `engine` = runtime/model/effort KHUSUS sesi operator. Opt-in, default MATI →
// instalasi yang sudah jalan tetap mewarisi default global sesi kerja sesudah upgrade.
export const zTelegramSettings = z.object({
  enabled: z.boolean().default(false),
  progress: z.boolean().default(true),
  engine: zAgentEngine.default({}),
});
```

- [x] **Step 6: Ekspor modul baru**

Di `shared/src/index.ts`, tambahkan **sebelum** `export * from "./entities"`:

```ts
export * from "./agent-engine";
```

- [x] **Step 7: Jalankan test shared yang tersentuh**

```bash
./node_modules/.bin/vitest run --dir shared shared/src/agent-engine.test.ts shared/src/telegram.test.ts shared/src/lead.test.ts
```
Expected: PASS semua (13+ test). `lead.test.ts` membuktikan alias tak mengubah `LEAD_DEFAULTS`.

- [x] **Step 8: Typecheck shared**

```bash
pnpm --filter ./shared typecheck
```
Expected: keluar 0, tanpa output error.

- [x] **Step 9: Commit**

```bash
git add shared/src/agent-engine.ts shared/src/agent-engine.test.ts shared/src/entities.ts shared/src/telegram.ts shared/src/index.ts docs/superpowers/plans/2026-08-02-spec-492-telegram-engine.md
git commit -m "feat(492): zAgentEngine sebagai bentuk bersama + Setting.telegram.engine"
```

---

### Task 2: Resolver `telegramAgentDefaults()` + gerbang reload

**Files:**
- Create: `server/src/services/telegram/config.ts`
- Create: `server/test/telegram-engine-config.test.ts`

**Interfaces:**
- Consumes: `getSetting`, `sessionAgentDefaults` dari `server/src/services/settings.ts`; `coerceCodexEffort`, `AgentEngine`, `TelegramSettings` dari `@hanoman/shared`.
- Produces:
  - `getTelegramEngine(): Promise<AgentEngine>`
  - `setTelegramEngine(next: AgentEngine): Promise<AgentEngine>`
  - `telegramAgentDefaults(): Promise<{ agent: Agent; model: string; effort: string }>`
  - `telegramReloadNeeded(before: TelegramSettings, after: TelegramSettings): boolean`

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/telegram-engine-config.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { resetDb } from "./factory";
import { getSetting } from "../src/services/settings";
import {
  getTelegramEngine, setTelegramEngine, telegramAgentDefaults, telegramReloadNeeded,
} from "../src/services/telegram/config";

const setting = async (over: Record<string, unknown>) => {
  const base = await getSetting();
  await prisma.setting.create({ data: { id: 1, data: { ...base, ...over } as never } });
};

describe("SPEC-492 · resolver agen operator Telegram", () => {
  beforeEach(async () => { await resetDb(); });

  // AC-2 cabang 1: opt-in MATI = warisan penuh, tak sebyte pun berbeda dari sesi kerja.
  it("engine mati → sessionAgentDefaults() persis", async () => {
    await setting({ agent: "codex", codex: { model: "gpt-5.6-terra", effort: "high" } });
    expect(await telegramAgentDefaults()).toEqual({ agent: "codex", model: "gpt-5.6-terra", effort: "high" });
  });

  it("DB tanpa baris Setting sama sekali tetap menjawab default global", async () => {
    expect(await telegramAgentDefaults()).toEqual({ agent: "claude", model: "claude-opus-5", effort: "xhigh" });
  });

  it("engine hidup → nilai engine, bukan default global", async () => {
    await setting({
      model: "claude-opus-5", effort: "xhigh",
      telegram: { enabled: true, progress: true, engine: { enabled: true, agent: "claude", model: "claude-haiku-4-5", effort: "low" } },
    });
    expect(await telegramAgentDefaults()).toEqual({ agent: "claude", model: "claude-haiku-4-5", effort: "low" });
  });

  // SPEC-339 · effort adalah properti MODEL. Luna tak mendukung `ultra`; meneruskannya apa adanya
  // berarti sesi operator lahir dengan pasangan yang ditolak codex.
  it("engine codex → effort dikoersi ke katalog model", async () => {
    await setting({
      telegram: { enabled: true, progress: true, engine: { enabled: true, agent: "codex", model: "gpt-5.6-luna", effort: "ultra" } },
    });
    expect(await telegramAgentDefaults()).toEqual({ agent: "codex", model: "gpt-5.6-luna", effort: "xhigh" });
  });

  it("setTelegramEngine menulis tanpa merusak field Setting lain", async () => {
    await setting({ model: "claude-sonnet-5", telegram: { enabled: true, progress: false, engine: { enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh" } } });
    await setTelegramEngine({ enabled: true, agent: "claude", model: "claude-haiku-4-5", effort: "medium" });
    const s = await getSetting();
    expect(s.model).toBe("claude-sonnet-5");          // blok akar utuh
    expect(s.telegram.enabled).toBe(true);            // saudara sebidang utuh
    expect(s.telegram.progress).toBe(false);
    expect(await getTelegramEngine()).toEqual({ enabled: true, agent: "claude", model: "claude-haiku-4-5", effort: "medium" });
  });

  it("setTelegramEngine tetap bekerja saat baris Setting belum ada", async () => {
    await setTelegramEngine({ enabled: true, agent: "claude", model: "claude-fable-5", effort: "high" });
    expect((await getTelegramEngine()).model).toBe("claude-fable-5");
  });

  // AC-9 · reload menghentikan long-poll lalu memanggil getMe(); menjatuhkan readiness ke `error`
  // gara-gara satu dropdown digeser adalah harga yang tak perlu — `engine` dibaca LAZY tiap sesi lahir.
  it("gerbang reload buta terhadap engine, tapi awas terhadap enabled/progress", () => {
    const eng = (model: string) => ({ enabled: false, agent: "claude" as const, model, effort: "xhigh" });
    const a = { enabled: true, progress: true, engine: eng("claude-opus-5") };
    expect(telegramReloadNeeded(a, { ...a, engine: eng("claude-haiku-4-5") })).toBe(false);
    expect(telegramReloadNeeded(a, { ...a, enabled: false })).toBe(true);
    expect(telegramReloadNeeded(a, { ...a, progress: false })).toBe(true);
    expect(telegramReloadNeeded(a, { ...a })).toBe(false);
  });
});
```

- [x] **Step 2: Jalankan, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/telegram-engine-config.test.ts
```
Expected: FAIL — `Failed to load url ../src/services/telegram/config`.

- [x] **Step 3: Implementasi resolver**

Buat `server/src/services/telegram/config.ts`:

```ts
import type { Prisma } from "@prisma/client";
import { coerceCodexEffort, type Agent, type AgentEngine, type TelegramSettings } from "@hanoman/shared";
import { prisma } from "../../db";
import { getSetting, sessionAgentDefaults } from "../settings";

// SPEC-492 · cermin `services/lead/config.ts`. Blok `telegram.engine` hidup di dalam Setting
// singleton (id=1); `getSetting` sudah mengisi default (zTelegramSettings.engine) untuk baris
// lama tanpa blok ini → tanpa migration.
export async function getTelegramEngine(): Promise<AgentEngine> {
  return (await getSetting()).telegram.engine;
}

/**
 * Ganti blok engine saja; pertahankan seluruh Setting lain. WAJIB read-modify-write dari
 * `getSetting()` SEGAR — blok `telegram` punya penulis kedua (`PUT /settings` dari layar
 * Settings), dan menulis dari snapshot adalah kelas bug SPEC-488 pada blok `lead`.
 */
export async function setTelegramEngine(next: AgentEngine): Promise<AgentEngine> {
  const cur = await getSetting();
  const data = { ...cur, telegram: { ...cur.telegram, engine: next } } as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({ where: { id: 1 }, update: { data }, create: { id: 1, data } });
  return next;
}

/**
 * Agen yang menjalankan SESI OPERATOR Telegram. Sejajar `leadAgentDefaults()`: selama
 * `telegram.engine.enabled` mati ia mendelegasikan penuh ke default sesi global — satu setelan
 * agen, bukan dua yang bisa berselisih diam-diam. Effort codex dikoersi di sini (SPEC-339:
 * effort adalah properti MODEL) supaya blok ini tak bisa melahirkan sesi yang ditolak codex.
 */
export async function telegramAgentDefaults(): Promise<{ agent: Agent; model: string; effort: string }> {
  const e = (await getSetting()).telegram.engine;
  if (!e.enabled) return sessionAgentDefaults();
  return e.agent === "codex"
    ? { agent: "codex", model: e.model, effort: coerceCodexEffort(e.model, e.effort) }
    : { agent: "claude", model: e.model, effort: e.effort };
}

/**
 * `PUT /settings` me-reload gateway bila blok `telegram` berubah — dan reload itu tak gratis:
 * ia menghentikan long-poll lalu memanggil `getMe()`, jadi kegagalan jaringan sesaat menjatuhkan
 * `readiness` ke `error`. `engine` dibaca LAZY oleh `telegramAgentDefaults()` di tiap kelahiran
 * sesi, jadi ia tak pernah butuh reload. Sisa bloknya tetap dibandingkan utuh (bukan field per
 * field) supaya field telegram yang ditambahkan nanti otomatis ikut memicu reload.
 */
export function telegramReloadNeeded(before: TelegramSettings, after: TelegramSettings): boolean {
  const strip = ({ engine: _engine, ...rest }: TelegramSettings) => rest;
  return JSON.stringify(strip(before)) !== JSON.stringify(strip(after));
}
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/telegram-engine-config.test.ts
```
Expected: PASS — 7 test.

- [x] **Step 5: Commit**

```bash
git add server/src/services/telegram/config.ts server/test/telegram-engine-config.test.ts
git commit -m "feat(492): resolver telegramAgentDefaults + gerbang reload buta-engine"
```

---

### Task 3: `productionFactory` memakai resolver + `PUT /settings` tak reload untuk engine

`productionFactory` memanggil `client.getMe()` di baris pertama, jadi ia tak bisa dites langsung
tanpa jaringan. Konstruksi deps coordinator-nya karena itu **diberi nama** (`telegramSessionDeps`)
— seam yang menamai sesuatu yang sudah ada di sana, bukan seam yang diarang untuk test.

**Files:**
- Modify: `server/src/services/telegram/bootstrap.ts:70-100`
- Modify: `server/src/routes/settings.ts:14-18`
- Create: `server/test/telegram-engine-bootstrap.test.ts`

**Interfaces:**
- Consumes: `telegramAgentDefaults`, `telegramReloadNeeded` (Task 2); `TelegramSessionCoordinatorDeps` dari `./session`.
- Produces: `telegramSessionDeps(input: { apiBase: string; agentToken: string; store: TelegramStore }): TelegramSessionCoordinatorDeps`.

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/telegram-engine-bootstrap.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { resetDb } from "./factory";
import { getSetting } from "../src/services/settings";
import { buildApp } from "../src/app";
import { TelegramStore } from "../src/services/telegram/store";
import { telegramSessionDeps } from "../src/services/telegram/bootstrap";

const deps = () => telegramSessionDeps({
  apiBase: "http://127.0.0.1:7777", agentToken: "hnm_agt_X", store: new TelegramStore(prisma),
});

describe("SPEC-492 · bootstrap memakai resolver Telegram", () => {
  beforeEach(async () => { await resetDb(); });

  // AC-3 · sebelum SPEC-492 field ini `sessionAgentDefaults`, jadi sesi operator SELALU mengikuti
  // default global sesi kerja tanpa jalan memisahkannya.
  it("deps.defaults() menuruti Setting.telegram.engine, bukan default global", async () => {
    const base = await getSetting();
    await prisma.setting.create({ data: { id: 1, data: {
      ...base, model: "claude-opus-5", effort: "xhigh",
      telegram: { enabled: true, progress: true, engine: { enabled: true, agent: "claude", model: "claude-haiku-4-5", effort: "low" } },
    } as never } });
    expect(await deps().defaults()).toEqual({ agent: "claude", model: "claude-haiku-4-5", effort: "low" });
  });

  it("engine mati → deps.defaults() kembali mewarisi default global", async () => {
    const base = await getSetting();
    await prisma.setting.create({ data: { id: 1, data: {
      ...base, agent: "codex", codex: { model: "gpt-5.5", effort: "medium" },
    } as never } });
    expect(await deps().defaults()).toEqual({ agent: "codex", model: "gpt-5.5", effort: "medium" });
  });
});

describe("SPEC-492 · engine tersimpan lewat PUT /settings yang sudah ada", () => {
  const app = buildApp();          // `buildApp()` SINKRON (server/src/app.ts:65)
  let headers: { authorization: string };

  beforeEach(async () => {
    await prisma.$transaction([prisma.agentToken.deleteMany(), prisma.setting.deleteMany()]);
    await prisma.setting.create({ data: { id: 1, data: { ...DEFAULT_SETTING, agentAccessEnabled: true } } });
    const { token } = await issueAgentToken({ name: "spec-492", capabilities: ["settings:read", "settings:write"] });
    headers = { authorization: `Bearer ${token}` };
  });
  afterAll(async () => { await app.close(); });

  // AC-5 · tanpa endpoint baru. Gateway tak pernah dipasang di test ini, jadi
  // `reloadTelegramGateway()` no-op — yang diuji di sini adalah route MENYIMPAN engine tanpa 400.
  it("menyimpan telegram.engine lewat PUT /settings", async () => {
    const before = await getSetting();
    const res = await app.inject({
      method: "PUT", url: "/api/settings", headers,
      payload: { ...before, telegram: { ...before.telegram, engine: { enabled: true, agent: "codex", model: "gpt-5.6-sol", effort: "high" } } },
    });
    expect(res.statusCode).toBe(200);
    expect((await getSetting()).telegram.engine).toEqual({ enabled: true, agent: "codex", model: "gpt-5.6-sol", effort: "high" });
  });

  it("GET /settings mengirimkan blok engine", async () => {
    const res = await app.inject({ method: "GET", url: "/api/settings", headers });
    expect(res.json().telegram.engine).toEqual({ enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh" });
  });
});
```

Import tambahan untuk blok kedua:

```ts
import { afterAll } from "vitest";
import { buildApp } from "../src/app";
import { issueAgentToken } from "../src/services/agent-token";
import { DEFAULT_SETTING } from "../src/services/settings";
```

Bila `capabilityForRoute` ternyata memetakan `/settings` ke capability lain, jalankan
`/usr/bin/grep -n "settings" server/src/services/agent-capabilities.ts` dan pakai nama yang benar —
jangan mematikan auth.

- [x] **Step 2: Jalankan, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/telegram-engine-bootstrap.test.ts
```
Expected: FAIL — `telegramSessionDeps is not a function`.

- [x] **Step 3: Ekstrak `telegramSessionDeps` di bootstrap**

Di `server/src/services/telegram/bootstrap.ts`, tambahkan import:

```ts
import { telegramAgentDefaults } from "./config";
import type { TelegramSessionCoordinatorDeps } from "./session";
```

Ganti isi `productionFactory` (baris ~70-100) menjadi:

```ts
/**
 * SPEC-492 · deps coordinator diberi nama supaya `defaults` bisa dibuktikan tanpa jaringan —
 * `productionFactory` memanggil `client.getMe()` di baris pertamanya.
 */
export function telegramSessionDeps(input: {
  apiBase: string; agentToken: string; store: TelegramStore;
}): TelegramSessionCoordinatorDeps {
  return {
    store: input.store,
    port: { getSession, createSession, sendToPane, killSession },
    // SPEC-492 · BUKAN `sessionAgentDefaults`: sesi operator Telegram sebagian besar membaca API
    // lalu merangkum, bukan menulis kode, jadi ia boleh punya runtime/model/effort sendiri.
    defaults: telegramAgentDefaults,
    engine: { read: telegramEngineContext, write: setTelegramEngine },
    personality: async (id, projectId) => {
      if (!id) return null;
      const row = await prisma.customAgent.findUnique({ where: { id } });
      if (!row?.enabled || (row.projectId !== null && row.projectId !== projectId)) return null;
      return { name: row.name, description: row.description, instructions: row.instructions };
    },
    ensureCodexTrust,
    home: resolveHome(),
    apiBase: input.apiBase,
    agentToken: input.agentToken,
    ensureDir: (path) => mkdirSync(path, { recursive: true }),
  };
}

async function productionFactory(input: TelegramGatewayFactoryInput) {
  const client = new TelegramApiClient(input.botToken);
  const me = await client.getMe();
  const store = new TelegramStore(prisma);
  const coordinator = new TelegramSessionCoordinator(telegramSessionDeps({
    apiBase: input.apiBase, agentToken: input.agentToken, store,
  }));
  const gateway = new TelegramGateway({
    client,
    store,
    dispatcher: coordinator,
    allowedUserIds: input.allowedUserIds,
    rateLimit: { limit: 20, windowMs: 60_000 },
    exactSecrets: [input.botToken, input.agentToken],
    progress: input.progress,
  });
  return { gateway, botUsername: me.username ?? null };
}
```

Ubah baris import pty menjadi:

```ts
import { createSession, getSession, killSession, sendToPane } from "../pty";
```

Hapus `sessionAgentDefaults` dari import `../settings` (biarkan `getSetting as getSettingReal`).

> `engine: { read: telegramEngineContext, write: setTelegramEngine }` dan `killSession` di `port`
> baru **dipakai** di Task 6. Sampai Task 4/5 selesai, `telegramEngineContext` belum ada — kerjakan
> task ini **setelah** Task 4 dan 5 bila mengeksekusi berurutan, atau untuk sementara hilangkan dua
> baris itu dan kembalikan di Task 6. Urutan yang disarankan: **Task 1 → 2 → 4 → 5 → 3 → 6 → 7 → 8**.

- [x] **Step 4: Pakai `telegramReloadNeeded` di route settings**

Ganti `server/src/routes/settings.ts` seluruhnya:

```ts
import type { FastifyInstance } from "fastify";
import { zSetting } from "@hanoman/shared";
import { prisma } from "../db";
import { getSetting } from "../services/settings";
import { reloadTelegramGateway } from "../services/telegram/bootstrap";
import { telegramReloadNeeded } from "../services/telegram/config";
export default async function (app: FastifyInstance) {
  app.get("/settings", async () => getSetting());
  app.put("/settings", async (req, reply) => {
    const parsed = zSetting.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const before = await getSetting();
    const row = await prisma.setting.upsert({ where: { id: 1 },
      update: { data: parsed.data }, create: { id: 1, data: parsed.data } });
    // SPEC-477 · ADR-0097 · toggle gateway berlaku LANGSUNG, tanpa restart. Dibandingkan dulu
    // supaya PUT settings yang tak menyentuh Telegram tak memutus long-poll yang sedang jalan.
    // SPEC-492 · `telegram.engine` sengaja DIKECUALIKAN dari perbandingan: ia dibaca lazy tiap
    // sesi operator lahir, jadi menggeser satu dropdown tak boleh memutus long-poll dan
    // mempertaruhkan `readiness` pada satu panggilan `getMe()`.
    if (telegramReloadNeeded(before.telegram, parsed.data.telegram)) {
      await reloadTelegramGateway();
    }
    return row.data;
  });
}
```

- [x] **Step 5: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/telegram-engine-bootstrap.test.ts server/test/telegram-bootstrap-config.test.ts server/test/settings.test.ts
```
Expected: PASS semua.

- [x] **Step 6: Commit**

```bash
git add server/src/services/telegram/bootstrap.ts server/src/routes/settings.ts server/test/telegram-engine-bootstrap.test.ts
git commit -m "feat(492): productionFactory memakai telegramAgentDefaults; PUT /settings buta-engine"
```

---

### Task 4: Sesi operator lahir dari resolver SEGAR, bukan dari baris chat yang beku

Ini inti temuan spec §2. Hari ini `deps.defaults()` dipanggil **hanya saat baris `TelegramChat`
belum ada**; sesudah itu setiap sesi lahir dari `context.agent/model/effort`, kolom yang tak punya
satu pun penulis lain. Instalasi hidup sudah punya barisnya, jadi tanpa task ini AC-3 nol efek.

**Files:**
- Modify: `server/src/services/telegram/store.ts:103-109`
- Modify: `server/src/services/telegram/session.ts:45-97`
- Create: `server/test/telegram-engine-session.test.ts`

**Interfaces:**
- Consumes: `TelegramSessionCoordinatorDeps.defaults()` (sudah ada).
- Produces: `TelegramStore.setChatEngine(chatId, engine: { agent: string; model: string; effort: string }): Promise<void>`.

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/telegram-engine-session.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Agent } from "@hanoman/shared";
import { prisma } from "../src/db";
import { TelegramSessionCoordinator, telegramOperatorSessionId, type TelegramSessionPort } from "../src/services/telegram/session";
import { TelegramStore } from "../src/services/telegram/store";
import type { AcceptedTelegramInput } from "../src/services/telegram/protocol";

const store = new TelegramStore(prisma);
const msg = (over: Partial<AcceptedTelegramInput> = {}): AcceptedTelegramInput => ({
  updateId: 91, chatId: "42", userId: "7", messageId: 3, kind: "text", text: "status proyek", ...over,
});

type Born = { projectId: string; cwd: string; opts: Record<string, unknown> };
function fakePort() {
  const born: Born[] = [];
  const sent: { id: string; text: string }[] = [];
  const killed: string[] = [];
  const live = new Map<string, { id: string; exited: boolean }>();
  const port: TelegramSessionPort = {
    getSession: (id) => live.get(id),
    createSession: (projectId, cwd, opts) => {
      born.push({ projectId, cwd, opts });
      const s = { id: String(opts.id), exited: false };
      live.set(s.id, s);
      return s;
    },
    sendToPane: async (id, text) => { sent.push({ id, text }); return live.get(id)?.exited === false; },
    killSession: (id) => { killed.push(id); live.delete(id); return true; },
  };
  return Object.assign(port, { born, sent, killed, live });
}

function coordinator(port: ReturnType<typeof fakePort>, opts: {
  defaults?: { agent: Agent; model: string; effort: string };
  trusted?: string[];
} = {}) {
  const defaults = opts.defaults ?? { agent: "claude" as Agent, model: "claude-opus-5", effort: "xhigh" };
  return new TelegramSessionCoordinator({
    store, port,
    defaults: async () => defaults,
    engine: {
      read: async () => ({
        enabled: false,
        effective: defaults,
        claude: { model: "claude-opus-5", effort: "xhigh" },
        codex: { model: "gpt-5.6-sol", effort: "xhigh" },
      }),
      write: async () => {},
    },
    personality: async () => null,
    ensureCodexTrust: (cwd) => { opts.trusted?.push(cwd); },
    home: "/tmp/hanoman-test",
    apiBase: "http://127.0.0.1:7777",
    agentToken: "hnm_agt_SECRET",
    ensureDir: () => {},
  });
}

// Outbox WAJIB ikut dibersihkan: `dedupeKey` outbox = `chat:update:kind`, jadi baris sisa test
// sebelumnya membuat `enqueueReply` mengembalikan baris LAMA (bukan mengantre yang baru) dan
// assertion `rows[0]` membaca teks test tetangga.
const clean = async () => {
  await prisma.$transaction([
    prisma.telegramOutbox.deleteMany(), prisma.telegramUpdate.deleteMany(),
    prisma.telegramMemory.deleteMany(), prisma.telegramChat.deleteMany(),
  ]);
};
beforeEach(clean);
afterAll(clean);

describe("SPEC-492 · sesi operator lahir dari resolver segar", () => {
  // Inti temuan: baris chat membekukan nilai saat chat pertama menyapa dan TAK ADA penulis lain.
  it("baris chat lama tak lagi membekukan runtime sesi berikutnya", async () => {
    await store.ensureChat({ chatId: "42", userId: "7", agent: "claude", model: "claude-opus-5", effort: "xhigh" });
    const port = fakePort();
    await coordinator(port, { defaults: { agent: "claude", model: "claude-haiku-4-5", effort: "low" } }).dispatch(msg());
    expect(port.born).toHaveLength(1);
    expect(port.born[0]!.opts).toMatchObject({ agent: "claude", model: "claude-haiku-4-5", effort: "low" });
  });

  it("baris chat ikut diperbarui supaya GET context tak berbohong", async () => {
    await store.ensureChat({ chatId: "42", userId: "7", agent: "claude", model: "claude-opus-5", effort: "xhigh" });
    const port = fakePort();
    await coordinator(port, { defaults: { agent: "claude", model: "claude-fable-5", effort: "medium" } }).dispatch(msg());
    const ctx = await store.chatContext("42");
    expect(ctx).toMatchObject({ agent: "claude", model: "claude-fable-5", effort: "medium" });
  });

  // Gotcha SPEC-377/ADR-0081: trust WAJIB diturunkan dari agen HASIL resolver. Membacanya dari
  // baris chat yang beku membuat sesi codex mentok di layar trust tanpa manusia di pane.
  it("ensureCodexTrust memakai agen hasil resolver, bukan agen baris chat", async () => {
    await store.ensureChat({ chatId: "42", userId: "7", agent: "claude", model: "claude-opus-5", effort: "xhigh" });
    const trusted: string[] = [];
    const port = fakePort();
    await coordinator(port, { defaults: { agent: "codex", model: "gpt-5.6-sol", effort: "high" }, trusted }).dispatch(msg());
    expect(trusted).toHaveLength(1);
    expect(port.born[0]!.opts).toMatchObject({ agent: "codex", model: "gpt-5.6-sol", effort: "high" });
  });

  it("agen claude tak pernah memanggil ensureCodexTrust", async () => {
    const trusted: string[] = [];
    await coordinator(fakePort(), { defaults: { agent: "claude", model: "claude-opus-5", effort: "xhigh" }, trusted }).dispatch(msg());
    expect(trusted).toEqual([]);
  });

  // AC-5 · ADR-0061 · sesi = satu proses, satu model seumur hidup. Steer ke pane hidup tak boleh
  // melahirkan sesi kedua maupun mengubah runtime sesi yang sedang jalan.
  it("steer ke pane hidup tak melahirkan sesi baru", async () => {
    const port = fakePort();
    const c = coordinator(port, { defaults: { agent: "claude", model: "claude-opus-5", effort: "xhigh" } });
    await c.dispatch(msg({ updateId: 1 }));
    await c.dispatch(msg({ updateId: 2, text: "lanjut" }));
    expect(port.born).toHaveLength(1);
    expect(port.sent).toHaveLength(1);
  });
});
```

- [x] **Step 2: Jalankan, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/telegram-engine-session.test.ts
```
Expected: FAIL — test pertama memberi `model: "claude-opus-5"` (nilai beku), bukan `claude-haiku-4-5`;
plus error tipe karena `engine`/`killSession` belum ada di deps.

- [x] **Step 3: Tambahkan `setChatEngine` ke store**

Di `server/src/services/telegram/store.ts`, sisipkan tepat setelah `ensureChat`:

```ts
  /**
   * SPEC-492 · cermin baris chat terhadap runtime yang BENAR-BENAR dipakai sesi operator terakhir.
   * `ensureChat` sengaja tak menyentuh ketiganya (ia hanya menyegarkan `userId`), jadi tanpa ini
   * `GET /telegram/chats/:chatId/context` — yang dibaca agen operator sendiri — melaporkan
   * snapshot dari chat pertama, selamanya.
   */
  async setChatEngine(chatId: string, engine: { agent: string; model: string; effort: string }): Promise<void> {
    await this.db.telegramChat.update({ where: { chatId }, data: engine });
  }
```

- [x] **Step 4: Perluas port & deps, lalu pindahkan resolver ke kelahiran sesi**

Di `server/src/services/telegram/session.ts`, ubah `TelegramSessionPort` dan
`TelegramSessionCoordinatorDeps`:

```ts
export type TelegramSessionPort = {
  getSession(id: string): SessionRef | undefined;
  createSession(projectId: string, cwd: string, opts: SessionCreateOptions): SessionRef;
  sendToPane(id: string, text: string): Promise<boolean>;
  /** SPEC-492 · dipakai `/engine restart`: satu-satunya cara setelan runtime berlaku SEKARANG. */
  killSession(id: string): boolean;
};
```

```ts
export type TelegramSessionCoordinatorDeps = {
  store: TelegramStore;
  port: TelegramSessionPort;
  defaults(): Promise<{ agent: Agent; model: string; effort: string }>;
  /** SPEC-492 · permukaan setelan runtime dari dalam chat. */
  engine: {
    read(): Promise<EngineContext>;
    write(next: AgentEngine): Promise<void>;
  };
  personality(id: string | null, projectId: string | null): Promise<Personality | null>;
  ensureCodexTrust(cwd: string): void;
  home: string;
  apiBase: string;
  agentToken: string;
  ensureDir(path: string): void;
};
```

Tambahkan import di kepala berkas:

```ts
import type { Agent, AgentEngine } from "@hanoman/shared";
import type { EngineContext } from "./engine-command";
```

Ganti badan `dispatch` (bagian sesudah blok `live`) menjadi:

```ts
  async dispatch(input: AcceptedTelegramInput): Promise<{ sessionId: string; created: boolean; control?: true }> {
    let context = await this.deps.store.chatContext(input.chatId);
    if (!context) {
      const seed = await this.deps.defaults();
      await this.deps.store.ensureChat({
        chatId: input.chatId,
        userId: input.userId,
        agent: seed.agent,
        model: seed.model,
        effort: seed.effort,
      });
      context = await this.deps.store.chatContext(input.chatId);
    }
    if (!context) throw new Error("gagal membuat binding chat Telegram");

    const sessionId = telegramOperatorSessionId(input.chatId);
    const live = this.deps.port.getSession(sessionId);
    if (live && !live.exited) {
      if (!await this.deps.port.sendToPane(sessionId, formatTelegramTurn(input))) {
        throw new Error("pane operator tidak menerima steer");
      }
      if (context.sessionId !== sessionId) await this.deps.store.bindSession(input.chatId, sessionId);
      return { sessionId, created: false };
    }

    // SPEC-492 · resolver dibaca ULANG di tiap KELAHIRAN sesi. `TelegramChat.agent/model/effort`
    // ditulis sekali saat chat pertama menyapa (`ensureChat` ber-`update:{userId}`) dan tak punya
    // penulis lain — memakainya di sini membuat setelan runtime nol efek untuk setiap chat yang
    // sudah ada, yaitu semua chat di instalasi yang sudah jalan (kelas bug SPEC-487).
    const engine = await this.deps.defaults();
    await this.deps.store.setChatEngine(input.chatId, engine);

    const hash = chatHash(input.chatId);
    const projectId = `telegram:${hash}`;
    const cwd = `${this.deps.home.replace(/\/$/, "")}/telegram/${hash}`;
    this.deps.ensureDir(cwd);
    // Gotcha SPEC-377/ADR-0081: trust diturunkan dari agen HASIL resolver, bukan dari baris chat.
    if (engine.agent === "codex") this.deps.ensureCodexTrust(cwd);
    const personality = await this.deps.personality(context.personalityAgentId, context.activeProjectId);
    const prompt = buildTelegramOperatorPrompt({
      update: input,
      personality,
      summary: context.summary,
      memories: context.memories,
    });
    const born = this.deps.port.createSession(projectId, cwd, {
      id: sessionId,
      prompt,
      agent: engine.agent,
      model: engine.model,
      effort: engine.effort,
      env: {
        HANOMAN_API_BASE: this.deps.apiBase,
        HANOMAN_TELEGRAM_AGENT_TOKEN: this.deps.agentToken,
        HANOMAN_TELEGRAM_CHAT_ID: input.chatId,
      },
    });
    if (born.id !== sessionId || born.exited) throw new Error("pane operator gagal lahir");
    await this.deps.store.bindSession(input.chatId, sessionId);
    return { sessionId, created: true };
  }
```

- [x] **Step 5: Perbaiki fixture test lama**

`server/test/telegram-session.test.ts` merakit port & deps tanpa `killSession` dan `engine`.
Tambahkan ke `fakePort()`:

```ts
    killSession: (id) => { live.delete(id); return true; },
```

dan ke objek `new TelegramSessionCoordinator({ … })` di helper `coordinator()`:

```ts
    engine: {
      read: async () => ({
        enabled: false,
        effective: defaults,
        claude: { model: "claude-opus-5", effort: "xhigh" },
        codex: { model: "gpt-5.6-sol", effort: "xhigh" },
      }),
      write: async () => {},
    },
```

> Task 5 membuat `EngineContext`. Bila mengeksekusi berurutan sesuai saran (1 → 2 → 4 → 5 → 3 → 6),
> kerjakan Task 5 lebih dulu atau ketik tipe `engine` sementara sebagai
> `{ read(): Promise<never>; write(next: AgentEngine): Promise<void> }` lalu perbaiki di Task 5.
> Cara paling lurus: **kerjakan Task 5 sebelum Task 4**.

- [x] **Step 6: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/telegram-engine-session.test.ts server/test/telegram-session.test.ts server/test/telegram-e2e.test.ts
```
Expected: PASS semua.

- [x] **Step 7: Commit**

```bash
git add server/src/services/telegram/session.ts server/src/services/telegram/store.ts server/test/telegram-engine-session.test.ts server/test/telegram-session.test.ts
git commit -m "feat(492): sesi operator lahir dari resolver segar, bukan baris chat beku"
```

---

### Task 5: Parser command runtime (murni)

**Files:**
- Create: `server/src/services/telegram/engine-command.ts`
- Create: `server/test/telegram-engine-command.test.ts`

**Interfaces:**
- Consumes: `MODELS`, `EFFORTS`, `CODEX_MODELS`, `codexEfforts`, `coerceCodexEffort`, `Agent`, `AgentEngine` dari `@hanoman/shared`.
- Produces:
  - `type EngineTriple = { agent: Agent; model: string; effort: string }`
  - `type EngineContext = { enabled: boolean; effective: EngineTriple; claude: { model: string; effort: string }; codex: { model: string; effort: string } }`
  - `type EngineCommand = { kind: "show" } | { kind: "restart" } | { kind: "set"; engine: AgentEngine; label: string } | { kind: "invalid"; message: string }`
  - `parseEngineCommand(text: string, ctx: EngineContext): EngineCommand | null`
  - `formatEngineStatus(ctx: EngineContext, sessionAlive: boolean): string`
  - `formatEngineApplied(next: AgentEngine, label: string, sessionAlive: boolean): string`
  - `TELEGRAM_CONTROL_KIND = "gateway-control"`

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/telegram-engine-command.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseEngineCommand, formatEngineStatus, formatEngineApplied, type EngineContext,
} from "../src/services/telegram/engine-command";

const ctx = (over: Partial<EngineContext> = {}): EngineContext => ({
  enabled: false,
  effective: { agent: "claude", model: "claude-opus-5", effort: "xhigh" },
  claude: { model: "claude-opus-5", effort: "xhigh" },
  codex: { model: "gpt-5.6-sol", effort: "xhigh" },
  ...over,
});

describe("SPEC-492 · parser command runtime Telegram", () => {
  // Fail-closed: apa pun yang bukan command runtime WAJIB kembali null supaya jalur lama
  // (diteruskan ke pane operator) tetap persis seperti sebelumnya.
  it("teks biasa & command lain kembali null", () => {
    for (const t of ["status proyek", "/help", "/status", "/projects", "/models", "", "runtime codex"]) {
      expect(parseEngineCommand(t, ctx())).toBeNull();
    }
  });

  it("/engine tanpa argumen = tampilkan", () => {
    expect(parseEngineCommand("/engine", ctx())).toEqual({ kind: "show" });
  });

  it("/engine off mematikan override tanpa mengubah triple-nya", () => {
    const cmd = parseEngineCommand("/engine off", ctx({
      enabled: true, effective: { agent: "codex", model: "gpt-5.5", effort: "medium" },
    }));
    expect(cmd).toMatchObject({
      kind: "set", engine: { enabled: false, agent: "codex", model: "gpt-5.5", effort: "medium" },
    });
  });

  it("/engine restart", () => {
    expect(parseEngineCommand("/engine restart", ctx())).toEqual({ kind: "restart" });
  });

  it("/engine kata-asing = invalid yang menerangkan cara pakai", () => {
    const cmd = parseEngineCommand("/engine turbo", ctx());
    expect(cmd?.kind).toBe("invalid");
    expect((cmd as { message: string }).message).toContain("/runtime");
  });

  // Menyetel nilai lalu tak terjadi apa-apa adalah jebakan yang sama dengan bug yang diperbaiki
  // spec ini. Menyebut runtime/model/effort = memilih memakainya.
  it("/runtime codex menyalakan override dan menukar model+effort sekalian", () => {
    expect(parseEngineCommand("/runtime codex", ctx())).toMatchObject({
      kind: "set", engine: { enabled: true, agent: "codex", model: "gpt-5.6-sol", effort: "xhigh" },
    });
  });

  it("/runtime selain claude|codex ditolak", () => {
    expect(parseEngineCommand("/runtime gemini", ctx())?.kind).toBe("invalid");
  });

  it("/model memakai katalog runtime yang sedang berlaku", () => {
    expect(parseEngineCommand("/model claude-haiku-4-5", ctx())).toMatchObject({
      kind: "set", engine: { enabled: true, agent: "claude", model: "claude-haiku-4-5", effort: "xhigh" },
    });
  });

  // SPEC-339 · effort adalah properti MODEL: Luna tak mendukung `ultra`.
  it("/model codex mengoersi effort ke katalog model barunya", () => {
    const c = ctx({ enabled: true, effective: { agent: "codex", model: "gpt-5.6-sol", effort: "ultra" } });
    expect(parseEngineCommand("/model gpt-5.6-luna", c)).toMatchObject({
      kind: "set", engine: { enabled: true, agent: "codex", model: "gpt-5.6-luna", effort: "xhigh" },
    });
  });

  it("/model milik agen SEBERANG menyebut jalan keluarnya, bukan sekadar 'tidak valid'", () => {
    const cmd = parseEngineCommand("/model gpt-5.6-sol", ctx());
    expect(cmd?.kind).toBe("invalid");
    expect((cmd as { message: string }).message).toContain("/runtime codex");
  });

  it("/model asing menolak dan menyebut daftar yang sah", () => {
    const cmd = parseEngineCommand("/model gpt-9-belum-ada", ctx());
    expect(cmd?.kind).toBe("invalid");
    expect((cmd as { message: string }).message).toContain("claude-opus-5");
  });

  it("/effort menerima nilai katalog dan menolak sisanya", () => {
    expect(parseEngineCommand("/effort low", ctx())).toMatchObject({
      kind: "set", engine: { enabled: true, agent: "claude", model: "claude-opus-5", effort: "low" },
    });
    expect(parseEngineCommand("/effort santai", ctx())?.kind).toBe("invalid");
  });

  it("/effort codex hanya menawarkan effort model aktif", () => {
    const c = ctx({ enabled: true, effective: { agent: "codex", model: "gpt-5.6-luna", effort: "xhigh" } });
    expect(parseEngineCommand("/effort ultra", c)?.kind).toBe("invalid");
    expect(parseEngineCommand("/effort max", c)?.kind).toBe("set");
  });

  it("status menyebut sumber nilai dan keadaan sesi", () => {
    expect(formatEngineStatus(ctx(), false)).toContain("default global");
    const on = formatEngineStatus(ctx({ enabled: true }), true);
    expect(on).toContain("setelan sendiri");
    expect(on).toContain("/engine restart");
  });

  // AC-6 · sesi yang sedang jalan TIDAK di-restart diam-diam; balasannya harus mengatakannya.
  it("balasan 'tersimpan' menerangkan kapan berlaku", () => {
    const next = { enabled: true, agent: "claude" as const, model: "claude-haiku-4-5", effort: "low" };
    expect(formatEngineApplied(next, "Model → claude-haiku-4-5", true)).toContain("/engine restart");
    expect(formatEngineApplied(next, "Model → claude-haiku-4-5", false)).toContain("berikutnya");
  });
});
```

- [x] **Step 2: Jalankan, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/telegram-engine-command.test.ts
```
Expected: FAIL — `Failed to load url ../src/services/telegram/engine-command`.

- [x] **Step 3: Implementasi parser murni**

Buat `server/src/services/telegram/engine-command.ts`:

```ts
import {
  CODEX_MODELS, EFFORTS, MODELS, codexEfforts, coerceCodexEffort,
  type Agent, type AgentEngine,
} from "@hanoman/shared";

/**
 * SPEC-492 · empat command runtime yang DICEGAT server, bukan diteruskan ke pane operator.
 * Alasannya bukan selera: (1) ia soal transport, dan agen tak bisa mengubah model proses yang
 * sedang menjalankan dirinya sendiri; (2) giliran agen terukur 14-95 detik — menukar effort tak
 * boleh membayar itu; (3) ia harus bekerja justru saat agennya macet, yaitu keadaan yang paling
 * mungkin membuat orang ingin menurunkan effort. Presedennya sudah ada: gateway mencegat update
 * `callback` konfirmasi sebelum `dispatch`.
 *
 * Berkas ini MURNI: nol DB, nol IO, nol Telegram. Semua keadaan masuk lewat `EngineContext`.
 */

const AGENT_LABEL: Record<Agent, string> = { claude: "Claude Code", codex: "Codex CLI" };

export const TELEGRAM_CONTROL_KIND = "gateway-control";

export type EngineTriple = { agent: Agent; model: string; effort: string };

export type EngineContext = {
  /** `Setting.telegram.engine.enabled` — sedang memakai setelan sendiri atau mewarisi. */
  enabled: boolean;
  /** Yang BERLAKU untuk sesi operator berikutnya (= `telegramAgentDefaults()`). */
  effective: EngineTriple;
  /** Blok global claude — dipakai saat `/runtime claude` (cermin `pickAgent` di UI). */
  claude: { model: string; effort: string };
  /** Blok global codex — dipakai saat `/runtime codex`. */
  codex: { model: string; effort: string };
};

export type EngineCommand =
  | { kind: "show" }
  | { kind: "restart" }
  | { kind: "set"; engine: AgentEngine; label: string }
  | { kind: "invalid"; message: string };

const claudeModels = () => MODELS.map((m) => m.id);
const codexModels = () => CODEX_MODELS.map((m) => m.id);
const effortsFor = (t: EngineTriple): readonly string[] =>
  t.agent === "codex" ? codexEfforts(t.model) : EFFORTS;

const usage = [
  "Setelan runtime sesi operator Telegram:",
  "`/engine` — lihat setelan sekarang",
  "`/runtime claude|codex` — tukar runtime",
  "`/model <id>` — tukar model",
  "`/effort <nilai>` — tukar effort",
  "`/engine off` — kembali ikut default global sesi kerja",
  "`/engine restart` — tutup sesi operator supaya setelan berlaku sekarang",
].join("\n");

/**
 * `null` = BUKAN command runtime → pemanggil melanjutkan jalur lama persis seperti sebelumnya
 * (fail-closed: yang tak dikenali tak pernah ditelan).
 */
export function parseEngineCommand(text: string, ctx: EngineContext): EngineCommand | null {
  const match = text.trim().match(/^\/(engine|runtime|model|effort)(?:\s+([\s\S]+))?$/i);
  if (!match) return null;
  const verb = match[1]!.toLowerCase();
  const arg = (match[2] ?? "").trim();

  if (verb === "engine") {
    if (!arg) return { kind: "show" };
    const word = arg.toLowerCase();
    if (word === "off" || word === "mati") {
      return {
        kind: "set",
        engine: { enabled: false, ...ctx.effective },
        label: "Setelan operator Telegram → ikut default global sesi kerja",
      };
    }
    if (word === "restart" || word === "ulang") return { kind: "restart" };
    return { kind: "invalid", message: usage };
  }

  if (verb === "runtime") {
    const word = arg.toLowerCase();
    if (word !== "claude" && word !== "codex") {
      return { kind: "invalid", message: "Runtime hanya `claude` atau `codex`. Contoh: `/runtime codex`" };
    }
    const agent = word as Agent;
    const base = agent === "codex" ? ctx.codex : ctx.claude;
    const effort = agent === "codex" ? coerceCodexEffort(base.model, base.effort) : base.effort;
    return {
      kind: "set",
      engine: { enabled: true, agent, model: base.model, effort },
      label: `Runtime → ${AGENT_LABEL[agent]}`,
    };
  }

  if (verb === "model") {
    const agent = ctx.effective.agent;
    const own = agent === "codex" ? codexModels() : claudeModels();
    const other = agent === "codex" ? claudeModels() : codexModels();
    if (!own.includes(arg)) {
      if (other.includes(arg)) {
        const swap: Agent = agent === "codex" ? "claude" : "codex";
        return {
          kind: "invalid",
          message: `\`${arg}\` adalah model ${AGENT_LABEL[swap]}, sedangkan runtime aktif `
            + `${AGENT_LABEL[agent]}. Jalankan \`/runtime ${swap}\` dulu.`,
        };
      }
      return { kind: "invalid", message: `Model ${AGENT_LABEL[agent]} yang sah: ${own.join(", ")}.` };
    }
    const effort = agent === "codex" ? coerceCodexEffort(arg, ctx.effective.effort) : ctx.effective.effort;
    return {
      kind: "set",
      engine: { enabled: true, agent, model: arg, effort },
      label: `Model → ${arg}`,
    };
  }

  // verb === "effort"
  const allowed = effortsFor(ctx.effective);
  if (!arg || !allowed.includes(arg)) {
    return {
      kind: "invalid",
      message: `Effort yang sah untuk \`${ctx.effective.model}\`: ${allowed.join(", ")}.`,
    };
  }
  return {
    kind: "set",
    engine: { enabled: true, ...ctx.effective, effort: arg },
    label: `Effort → ${arg}`,
  };
}

const triple = (t: EngineTriple): string =>
  `${AGENT_LABEL[t.agent]} · \`${t.model}\` · \`${t.effort}\``;

export function formatEngineStatus(ctx: EngineContext, sessionAlive: boolean): string {
  return [
    `Sesi operator berikutnya: ${triple(ctx.effective)}`,
    ctx.enabled
      ? "Sumber: setelan sendiri untuk kanal Telegram."
      : "Sumber: default global sesi kerja (belum pakai setelan sendiri).",
    sessionAlive
      ? "Sesi operator sekarang masih hidup dan tetap memakai setelan lamanya — `/engine restart` untuk menutupnya."
      : "Belum ada sesi operator yang hidup; pesan berikutnya lahir dengan setelan di atas.",
    "",
    usage,
  ].join("\n");
}

export function formatEngineApplied(next: AgentEngine, label: string, sessionAlive: boolean): string {
  const head = next.enabled
    ? `${label}. Sesi operator berikutnya: ${triple(next)}`
    : `${label}. Sesi operator berikutnya mengikuti default global sesi kerja.`;
  return [
    head,
    sessionAlive
      ? "Sesi yang sedang jalan tidak diubah — ia satu proses, satu model seumur hidup. `/engine restart` menutupnya; ringkasan & memory tetap tersimpan."
      : "Berlaku untuk sesi operator berikutnya yang dibuat.",
  ].join("\n");
}
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/telegram-engine-command.test.ts
```
Expected: PASS — 14 test.

- [x] **Step 5: Commit**

```bash
git add server/src/services/telegram/engine-command.ts server/test/telegram-engine-command.test.ts
git commit -m "feat(492): parser murni command runtime Telegram"
```

---

### Task 6: Coordinator mencegat command; gateway tak mengarang balasan ganda

**Files:**
- Modify: `server/src/services/telegram/session.ts` (metode `dispatch` + helper baru)
- Modify: `server/src/services/telegram/gateway.ts:118-130`
- Modify: `server/src/services/telegram/config.ts` (`telegramEngineContext`)
- Modify: `server/test/telegram-engine-session.test.ts` (tambah blok describe)
- Modify: `server/test/telegram-engine-config.test.ts` (tambah test `telegramEngineContext`)

**Interfaces:**
- Consumes: `parseEngineCommand`, `formatEngineStatus`, `formatEngineApplied`, `TELEGRAM_CONTROL_KIND` (Task 5); `store.enqueueReply`, `store.patchChat` (sudah ada); `port.killSession` (Task 4).
- Produces: `telegramEngineContext(): Promise<EngineContext>`; `dispatch()` mengembalikan `control?: true`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/telegram-engine-session.test.ts` (pakai `fakePort`/`coordinator` yang
sudah ada di berkas itu; tambahkan parameter `write` yang merekam):

```ts
import { TELEGRAM_CONTROL_KIND } from "../src/services/telegram/engine-command";
import type { AgentEngine } from "@hanoman/shared";

function controlCoordinator(port: ReturnType<typeof fakePort>, over: {
  enabled?: boolean; effective?: { agent: Agent; model: string; effort: string };
} = {}) {
  const written: AgentEngine[] = [];
  const effective = over.effective ?? { agent: "claude" as Agent, model: "claude-opus-5", effort: "xhigh" };
  const c = new TelegramSessionCoordinator({
    store, port,
    defaults: async () => effective,
    engine: {
      read: async () => ({
        enabled: over.enabled ?? false,
        effective,
        claude: { model: "claude-opus-5", effort: "xhigh" },
        codex: { model: "gpt-5.6-sol", effort: "xhigh" },
      }),
      write: async (next) => { written.push(next); },
    },
    personality: async () => null,
    ensureCodexTrust: () => {},
    home: "/tmp/hanoman-test",
    apiBase: "http://127.0.0.1:7777",
    agentToken: "hnm_agt_SECRET",
    ensureDir: () => {},
  });
  return { c, written };
}

const outbox = (chatId: string) =>
  prisma.telegramOutbox.findMany({ where: { chatId }, orderBy: { createdAt: "asc" } });

describe("SPEC-492 · command runtime dicegat sebelum menyentuh pane", () => {
  it("/engine menjawab tanpa melahirkan sesi maupun mengetik ke pane", async () => {
    const port = fakePort();
    const { c } = controlCoordinator(port);
    const res = await c.dispatch(msg({ kind: "command", text: "/engine" }));
    expect(res).toMatchObject({ created: false, control: true });
    expect(port.born).toEqual([]);
    expect(port.sent).toEqual([]);
    const rows = await outbox("42");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe(TELEGRAM_CONTROL_KIND);
    expect(rows[0]!.text).toContain("claude-opus-5");
  });

  it("/model menulis engine dan membalas apa yang berubah", async () => {
    const port = fakePort();
    const { c, written } = controlCoordinator(port);
    await c.dispatch(msg({ kind: "command", text: "/model claude-haiku-4-5" }));
    expect(written).toEqual([{ enabled: true, agent: "claude", model: "claude-haiku-4-5", effort: "xhigh" }]);
    expect((await outbox("42"))[0]!.text).toContain("claude-haiku-4-5");
    expect(port.born).toEqual([]);
  });

  it("/model asing menolak TANPA menulis apa pun", async () => {
    const port = fakePort();
    const { c, written } = controlCoordinator(port);
    await c.dispatch(msg({ kind: "command", text: "/model tidak-ada" }));
    expect(written).toEqual([]);
    expect((await outbox("42"))[0]!.text).toContain("claude-opus-5");
  });

  it("/engine restart menutup pane hidup dan melepas binding sesi", async () => {
    const port = fakePort();
    const { c } = controlCoordinator(port);
    await c.dispatch(msg({ updateId: 1 }));                 // lahirkan sesi dulu
    expect(port.born).toHaveLength(1);
    await c.dispatch(msg({ updateId: 2, kind: "command", text: "/engine restart" }));
    expect(port.killed).toEqual([telegramOperatorSessionId("42")]);
    expect((await store.chatContext("42"))?.sessionId).toBeNull();
  });

  it("/engine restart tanpa sesi hidup tetap menjawab, bukan diam", async () => {
    const port = fakePort();
    const { c } = controlCoordinator(port);
    await c.dispatch(msg({ kind: "command", text: "/engine restart" }));
    expect(port.killed).toEqual([]);
    expect((await outbox("42"))[0]!.text.length).toBeGreaterThan(0);
  });

  // Fail-closed: command yang bukan milik kita tetap diteruskan ke pane apa adanya.
  it("/status tetap diteruskan ke sesi operator", async () => {
    const port = fakePort();
    const { c } = controlCoordinator(port);
    await c.dispatch(msg({ updateId: 1 }));
    const res = await c.dispatch(msg({ updateId: 2, kind: "command", text: "/status" }));
    expect(res.control).toBeUndefined();
    expect(port.sent).toHaveLength(1);
  });
});
```

Tambahkan ke `server/test/telegram-engine-config.test.ts`:

```ts
import { telegramEngineContext } from "../src/services/telegram/config";

describe("SPEC-492 · konteks command runtime", () => {
  beforeEach(async () => { await resetDb(); });

  it("mati → effective = default global, blok claude & codex ikut disodorkan", async () => {
    await setting({ agent: "claude", model: "claude-sonnet-5", effort: "high", codex: { model: "gpt-5.5", effort: "medium" } });
    expect(await telegramEngineContext()).toEqual({
      enabled: false,
      effective: { agent: "claude", model: "claude-sonnet-5", effort: "high" },
      claude: { model: "claude-sonnet-5", effort: "high" },
      codex: { model: "gpt-5.5", effort: "medium" },
    });
  });

  it("hidup → effective = nilai engine", async () => {
    await setting({
      telegram: { enabled: true, progress: true, engine: { enabled: true, agent: "codex", model: "gpt-5.6-luna", effort: "max" } },
    });
    const ctx = await telegramEngineContext();
    expect(ctx.enabled).toBe(true);
    expect(ctx.effective).toEqual({ agent: "codex", model: "gpt-5.6-luna", effort: "max" });
  });
});
```

- [x] **Step 2: Jalankan, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/telegram-engine-session.test.ts server/test/telegram-engine-config.test.ts
```
Expected: FAIL — `telegramEngineContext is not a function` dan `res.control` `undefined`.

- [x] **Step 3: Tambahkan `telegramEngineContext` ke config**

Di `server/src/services/telegram/config.ts`, tambahkan import dan fungsi:

```ts
import type { EngineContext } from "./engine-command";
```

```ts
/**
 * SPEC-492 · seluruh keadaan yang dibutuhkan parser command, dalam satu bacaan Setting.
 * `effective` sengaja diambil dari `telegramAgentDefaults()` — satu definisi "apa yang berlaku",
 * bukan dua yang bisa berselisih.
 */
export async function telegramEngineContext(): Promise<EngineContext> {
  const s = await getSetting();
  return {
    enabled: s.telegram.engine.enabled,
    effective: await telegramAgentDefaults(),
    claude: { model: s.model, effort: s.effort },
    codex: { model: s.codex.model, effort: s.codex.effort },
  };
}
```

- [x] **Step 4: Cegat command di coordinator**

Di `server/src/services/telegram/session.ts`, tambahkan import:

```ts
import {
  TELEGRAM_CONTROL_KIND, formatEngineApplied, formatEngineStatus, parseEngineCommand,
  type EngineContext,
} from "./engine-command";
```

Sisipkan di awal `dispatch`, **sebelum** `chatContext` dibaca:

```ts
    if (input.kind === "command") {
      const handled = await this.control(input);
      if (handled) return handled;
    }
```

Tambahkan metode privat di kelas:

```ts
  /**
   * SPEC-492 · empat command runtime tak pernah menyentuh pane: ia soal transport, bukan isi
   * hanoman, dan harus tetap bekerja saat agennya justru macet. `null` = bukan command runtime →
   * pemanggil melanjutkan jalur lama persis seperti sebelumnya.
   *
   * Sengaja TIDAK mengetik `/model`/`/effort` ke pane hidup: ADR-0061 mencabut matrix per-fase
   * karena mekanisme itu tak andal, dan SPEC-487 mengukur kelasnya (ketikan ke pane yang sedang
   * menjalankan giliran mendarat sebagai pesan liar). Jalur yang dijanjikan ke operator adalah
   * `/engine restart` — deterministik, dan konteksnya selamat lewat ringkasan + curated memory.
   */
  private async control(
    input: AcceptedTelegramInput,
  ): Promise<{ sessionId: string; created: false; control: true } | null> {
    const ctx: EngineContext = await this.deps.engine.read();
    const cmd = parseEngineCommand(input.text, ctx);
    if (!cmd) return null;

    const sessionId = telegramOperatorSessionId(input.chatId);
    const live = this.deps.port.getSession(sessionId);
    const alive = Boolean(live && !live.exited);

    let text: string;
    if (cmd.kind === "show") {
      text = formatEngineStatus(ctx, alive);
    } else if (cmd.kind === "invalid") {
      text = cmd.message;
    } else if (cmd.kind === "restart") {
      if (alive) {
        this.deps.port.killSession(sessionId);
        await this.deps.store.patchChat(input.chatId, { sessionId: null });
        text = "Sesi operator ditutup. Pesan berikutnya lahir dengan setelan sekarang — "
          + "ringkasan & curated memory tetap tersimpan.";
      } else {
        text = "Tak ada sesi operator yang sedang hidup. Pesan berikutnya lahir dengan setelan sekarang.";
      }
    } else {
      await this.deps.engine.write(cmd.engine);
      text = formatEngineApplied(cmd.engine, cmd.label, alive);
    }

    await this.deps.store.enqueueReply({
      chatId: input.chatId, updateId: input.updateId, kind: TELEGRAM_CONTROL_KIND, text,
    });
    return { sessionId, created: false, control: true };
  }
```

> `patchChat` melempar bila baris chat belum ada — di sini ia hanya dipanggil saat `alive`, dan
> pane hidup selalu berarti barisnya ada.

- [x] **Step 5: Gateway berhenti mengarang balasan ganda**

Di `server/src/services/telegram/gateway.ts`, ganti blok sesudah `dispatch` berhasil:

```ts
      const target = await this.deps.dispatcher.dispatch(input);
      await this.deps.store.markDispatched(input.updateId);
      await this.deps.store.audit({
        chatId: input.chatId, userId: input.userId, updateId: input.updateId,
        action: "dispatch",
        // SPEC-492 · command runtime dijawab gateway sendiri; jejaknya harus bisa dibedakan dari
        // pesan yang benar-benar sampai ke sesi operator.
        outcome: target.control ? "control" : target.created ? "session-created" : "session-reused",
        correlationId: `tg:${input.updateId}`,
      });
      // Fakta server, bukan layar PTY (ADR-0096 §5). Punya `catch` sendiri: dispatch SUDAH
      // berhasil, jadi gagalnya mengantre pemberitahuan tak boleh mengubahnya jadi kegagalan.
      // SPEC-492 · dilewati untuk command runtime: jawabannya sudah diantre coordinator, dan
      // "Diterima. Diteruskan ke sesi operator." di belakangnya adalah kebohongan kecil.
      if (this.deps.progress && !target.control) {
        await this.deps.store.enqueueReply({
          chatId: input.chatId, updateId: input.updateId, kind: GATEWAY_PROGRESS_KIND,
          text: target.created
            ? "Diterima. Sesi operator Hanoman untuk chat ini sedang dijalankan — jawabannya menyusul."
            : "Diterima. Diteruskan ke sesi operator.",
        }).catch(() => {});
      }
```

Perluas tipe `TelegramInputDispatcher`:

```ts
export type TelegramInputDispatcher = {
  dispatch(input: AcceptedTelegramInput): Promise<{ sessionId: string; created: boolean; control?: true }>;
};
```

- [x] **Step 6: Kembalikan dua baris dep di bootstrap**

Pastikan `telegramSessionDeps` (Task 3) memuat:

```ts
    engine: { read: telegramEngineContext, write: setTelegramEngine },
```

dan importnya:

```ts
import { setTelegramEngine, telegramAgentDefaults, telegramEngineContext } from "./config";
```

- [x] **Step 7: Jalankan test yang tersentuh**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --dir server --no-file-parallelism \
  server/test/telegram-engine-session.test.ts server/test/telegram-engine-config.test.ts \
  server/test/telegram-engine-command.test.ts server/test/telegram-engine-bootstrap.test.ts \
  server/test/telegram-gateway.test.ts server/test/telegram-e2e.test.ts server/test/telegram-session.test.ts
```
Expected: PASS semua.

- [x] **Step 8: Typecheck server**

```bash
pnpm --filter ./server typecheck
```
Expected: keluar 0.

- [x] **Step 9: Commit**

```bash
git add server/src/services/telegram/session.ts server/src/services/telegram/gateway.ts server/src/services/telegram/config.ts server/src/services/telegram/bootstrap.ts server/test/telegram-engine-session.test.ts server/test/telegram-engine-config.test.ts
git commit -m "feat(492): command runtime Telegram dicegat coordinator, gateway tak berbalasan ganda"
```

---

### Task 7: Kartu "Agen operator Telegram" di Settings

**Files:**
- Modify: `src/src/screens/SettingsScreen.tsx` (tab `model`, sesudah kartu "Agen hanoman-lead" ~baris 962)
- Create: `src/test/settings-telegram-engine.test.tsx`

**Interfaces:**
- Consumes: `api.getSettings`, `api.putSettings`, `TELEGRAM_DEFAULTS`, `MODELS`/`EFFORTS`/`CODEX_MODELS`/`codexEfforts`/`coerceCodexEffort`, helper lokal `codexNote`/`codexOptions`/`inherited`/`AGENT_LABEL` yang sudah ada di berkas.
- Produces: label a11y `Override agen Telegram`, `Runtime Telegram`, `Model Telegram`, `Effort Telegram`; testid `telegram-engine-inherited`.

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/settings-telegram-engine.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

// SPEC-492 · runtime/model/effort KHUSUS sesi operator Telegram. Sebelum ini sesi operator selalu
// mengikuti default global sesi kerja, padahal bebannya beda jauh (baca API + rangkum vs tulis kode).
vi.mock("../src/api/client", () => ({
  api: {
    getSettings: vi.fn(), putSettings: vi.fn(), getCodexVersion: vi.fn(),
    getLeadConfig: vi.fn(), putLeadConfig: vi.fn(),
  },
  ApiError: class extends Error { status = 0 },
}));

import { SettingsScreen } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";

const me: any = { id: "u1", email: "dena@nafanesia.id", createdAt: "x" };
const ENGINE = { enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh" };
const LEAD = { enabled: false, paused: false, pausedProjects: [], everyMin: 5, timeoutSec: 600,
  maxAutoAnswers: 3, maxConcurrent: 2, queueWaitSec: 120, flowTtlMin: 60,
  requireGreenBeforeIntegrate: true, engine: { ...ENGINE } };
const settings = (over: object = {}) => ({
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  agentAccessEnabled: false, scheduler: {}, goal: { enabled: false, condition: "" },
  agent: "claude", codex: { model: "gpt-5.6-sol", effort: "xhigh" }, verifyScope: "changed",
  conflict: { ...ENGINE }, lead: LEAD,
  telegram: { enabled: true, progress: true, engine: { ...ENGINE } },
  ...over,
});
const tg = (engine: object, over: object = {}) =>
  settings({ telegram: { enabled: true, progress: true, engine }, ...over });

beforeEach(() => {
  vi.mocked(api.getSettings).mockResolvedValue(settings() as any);
  vi.mocked(api.putSettings).mockImplementation(async (b: any) => b);
  vi.mocked(api.getCodexVersion).mockResolvedValue({ version: "0.145.0", minRequired: "0.144.0", ok: true } as any);
  vi.mocked(api.getLeadConfig).mockResolvedValue(LEAD as any);
  vi.mocked(api.putLeadConfig).mockImplementation(async (c: any) => c);
});

const openModel = () => {
  render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Model sesi" }));
};

describe("SPEC-492 · kartu agen operator Telegram", () => {
  it("kartu ada di tab Model sesi, bersebelahan dengan kartu lead", async () => {
    openModel();
    expect(await screen.findByText("Agen operator Telegram")).toBeInTheDocument();
    expect(screen.getByText("Agen hanoman-lead")).toBeInTheDocument();
  });

  // Opt-in mati = warisan penuh, dan kartunya HARUS menyebut nilai warisannya (pelajaran SPEC-383).
  it("mati → tak ada picker, nilai warisan ditampilkan", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(
      tg({ ...ENGINE }, { agent: "codex", codex: { model: "gpt-5.6-terra", effort: "high" } }) as any);
    openModel();
    const inh = await screen.findByTestId("telegram-engine-inherited");
    expect(inh).toHaveTextContent("Codex CLI");
    expect(inh).toHaveTextContent("gpt-5.6-terra");
    expect(screen.queryByLabelText("Runtime Telegram")).toBeNull();
  });

  // AC-6 · deskripsi kartu wajib menyatakan kapan perubahan berlaku — sesi yang sedang jalan tidak
  // di-restart diam-diam.
  it("deskripsi kartu menyatakan bahwa sesi berjalan tidak di-restart", async () => {
    openModel();
    const card = (await screen.findByText("Agen operator Telegram")).closest("section, div") as HTMLElement;
    expect(card).toHaveTextContent(/berikutnya/i);
  });

  it("menyalakan override → PUT /settings dengan telegram.engine.enabled true", async () => {
    openModel();
    const wrap = await screen.findByLabelText("Override agen Telegram");
    fireEvent.click(within(wrap).getByRole("switch"));
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ telegram: expect.objectContaining({
        engine: expect.objectContaining({ enabled: true }) }) })));
  });

  // Blok `telegram` punya penulis KEDUA sejak SPEC-492: command `/runtime|/model|/effort` dari chat.
  // Menulis dari snapshot yang dimuat saat mount akan mengembalikannya tanpa satu klik pun.
  it("menulis dari GET yang segar, bukan snapshot saat mount", async () => {
    openModel();
    await screen.findByText("Agen operator Telegram");
    vi.mocked(api.getSettings).mockResolvedValue(
      tg({ enabled: true, agent: "codex", model: "gpt-5.5", effort: "medium" }) as any);
    const wrap = screen.getByLabelText("Override agen Telegram");
    fireEvent.click(within(wrap).getByRole("switch"));
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ telegram: expect.objectContaining({
        engine: expect.objectContaining({ agent: "codex", model: "gpt-5.5" }) }) })));
  });

  it("menukar runtime ke codex → model & effort ikut bertukar ke katalog codex", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(tg({ ...ENGINE, enabled: true }) as any);
    openModel();
    fireEvent.change(await screen.findByLabelText("Runtime Telegram"), { target: { value: "codex" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ telegram: expect.objectContaining({
        engine: { enabled: true, agent: "codex", model: "gpt-5.6-sol", effort: "xhigh" } }) })));
  });

  it("memilih model codex yang tak mendukung effort tersimpan → effort dikoersi", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(
      tg({ enabled: true, agent: "codex", model: "gpt-5.6-sol", effort: "ultra" }) as any);
    openModel();
    fireEvent.change(await screen.findByLabelText("Model Telegram"), { target: { value: "gpt-5.6-luna" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ telegram: expect.objectContaining({
        engine: expect.objectContaining({ model: "gpt-5.6-luna", effort: "xhigh" }) }) })));
  });

  it("picker effort codex hanya menawarkan effort yang didukung model terpilih", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(
      tg({ enabled: true, agent: "codex", model: "gpt-5.6-luna", effort: "xhigh" }) as any);
    openModel();
    const sel = await screen.findByLabelText("Effort Telegram");
    const values = Array.from(sel.querySelectorAll("option")).map((o) => o.getAttribute("value"));
    expect(values).not.toContain("ultra");
    expect(values).toContain("max");
  });
});
```

- [x] **Step 2: Jalankan, pastikan GAGAL**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --dir src src/test/settings-telegram-engine.test.tsx
```
Expected: FAIL — `Unable to find an element with the text: Agen operator Telegram`.

- [x] **Step 3: Tambahkan helper penulis di dalam `if (tab === "model")`**

Sisipkan tepat sesudah `saveEngine` (sekitar baris 786), sebelum `return (`:

```tsx
      // SPEC-492 · blok `Setting.telegram.engine`. `?? TELEGRAM_DEFAULTS` sama alasannya dengan
      // `?? CONFLICT_DEFAULTS`: respons GET /settings ter-cache dari instance lama belum punya
      // kuncinya, dan layar tak boleh mati `undefined.engine`.
      const telegram = s.telegram ?? TELEGRAM_DEFAULTS;
      const tgEngine = telegram.engine ?? TELEGRAM_DEFAULTS.engine;
      // Membaca ULANG sebelum menulis, bukan mengirim snapshot `s` — sejak SPEC-492 blok
      // `telegram` punya penulis KEDUA di luar browser: command `/runtime|/model|/effort` dari
      // chat Telegram. Mengirim snapshot yang dimuat saat mount akan mengembalikan setelan yang
      // baru saja diubah dari ponsel, tanpa satu klik pun yang mengatakannya (kelas SPEC-488).
      const saveTgEngine = async (patch: Partial<Setting["telegram"]["engine"]>, msg: string) => {
        const prev = s;
        setS({ ...s, telegram: { ...telegram, engine: { ...tgEngine, ...patch } } });   // optimistis
        try {
          const fresh = await api.getSettings();
          const freshTg = fresh.telegram ?? TELEGRAM_DEFAULTS;
          const next = {
            ...fresh,
            telegram: { ...freshTg, engine: { ...(freshTg.engine ?? TELEGRAM_DEFAULTS.engine), ...patch } },
          };
          const saved = await api.putSettings(next);
          setS(saved ?? next);
          onToast?.(msg, "ok", "check-circle-2");
        } catch {
          setS(prev);
          onToast?.("Gagal menyimpan setelan operator Telegram", "err", "alert-triangle");
        }
      };
```

- [x] **Step 4: Tambahkan kartunya**

Sisipkan tepat sesudah `</Card>` penutup kartu "Agen hanoman-lead" (sekitar baris 962), sebelum
`</>`:

```tsx
      {/* SPEC-492 · sesi operator Telegram boleh punya runtime/model/effort sendiri. Bebannya beda
          jauh dari sesi kerja: ia sebagian besar membaca API lalu merangkum, bukan menulis kode —
          terukur 95 dtk untuk satu giliran `/start` pada effort xhigh, sementara ongkos kirim ke
          Telegram sendiri 0,4 dtk. Opt-in seperti kartu konflik & lead: mati = mewarisi. */}
      <Card eyebrow="telegram" title="Agen operator Telegram">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
          Mesin yang menjalankan sesi operator Telegram — satu sesi persisten per chat, yang membaca
          API hanoman lalu merangkum. Berlaku untuk sesi operator <b>berikutnya</b> yang dibuat; sesi
          yang sedang jalan tetap memakai setelan lamanya (satu proses, satu model seumur hidup) dan
          tidak di-restart diam-diam — tutup dari chat dengan <code>/engine restart</code>. Setelan
          yang sama juga bisa diubah dari chat: <code>/engine</code>, <code>/runtime</code>,
          <code>/model</code>, <code>/effort</code>. Berlaku global untuk semua chat.
        </div>
        <SettingRow title="Pakai setelan sendiri"
          desc="Mati = ikut default global di atas. Hidup = sesi operator Telegram memakai pilihan di bawah.">
          <Switch aria-label="Override agen Telegram" checked={tgEngine.enabled}
            onChange={(v: boolean) => saveTgEngine({ enabled: v },
              "Setelan operator Telegram" + (v ? " · aktif" : " · ikut default global"))} />
        </SettingRow>
        {!tgEngine.enabled ? (
          <div data-testid="telegram-engine-inherited" style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "12px 0 2px", lineHeight: 1.5 }}>
            Sesi operator Telegram memakai default global: <b>{AGENT_LABEL[inherited.agent]}</b> ·{" "}
            <code>{inherited.model}</code> · <code>{inherited.effort}</code>.
          </div>
        ) : (
          <>
            <SettingRow title="Runtime" desc="Mesin yang menjalankan sesi operator. Bisa beda dari agen sesi kerja.">
              <Select size="sm" aria-label="Runtime Telegram" value={tgEngine.agent} style={{ width: 190 }}
                options={[{ value: "claude", label: AGENT_LABEL.claude }, { value: "codex", label: AGENT_LABEL.codex }]}
                onChange={(e) => {
                  // Cermin `pickAgent`/kartu konflik/kartu lead: menukar runtime HARUS menukar
                  // model+effort sekalian, kalau tidak sesi lahir `codex -m claude-opus-5`.
                  const a = e.target.value as "claude" | "codex";
                  const d = a === "codex" ? codex : { model: s.model, effort: s.effort };
                  saveTgEngine({ agent: a, model: d.model,
                    effort: a === "codex" ? coerceCodexEffort(d.model, d.effort) : d.effort },
                    "Runtime operator Telegram → " + a);
                }} />
            </SettingRow>
            {tgEngine.agent === "codex" && codexNote(tgEngine.model)}
            <SettingRow title="Model">
              <Select size="sm" aria-label="Model Telegram" value={tgEngine.model} style={{ width: 190 }}
                options={tgEngine.agent === "codex" ? codexOptions(tgEngine.model) : S_MODELS}
                onChange={(e) => {
                  const model = e.target.value;
                  saveTgEngine({ model, ...(tgEngine.agent === "codex"
                    ? { effort: coerceCodexEffort(model, tgEngine.effort) } : {}) },
                    "Model operator Telegram → " + model);
                }} />
            </SettingRow>
            <SettingRow title="Effort" last
              desc="Operator Telegram jarang menulis kode — effort rendah memangkas latensi balasan secara langsung.">
              <Select size="sm" aria-label="Effort Telegram" value={tgEngine.effort} style={{ width: 130 }}
                options={tgEngine.agent === "codex"
                  ? codexEfforts(tgEngine.model).map((v) => ({ value: v, label: v }))
                  : S_EFFORT}
                onChange={(e) => saveTgEngine({ effort: e.target.value }, "Effort operator Telegram → " + e.target.value)} />
            </SettingRow>
          </>
        )}
      </Card>
```

- [x] **Step 5: Jalankan test web yang tersentuh**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --dir src \
  src/test/settings-telegram-engine.test.tsx src/test/settings-lead-engine.test.tsx \
  src/test/settings-conflict.test.tsx src/test/settings-model-tab.test.tsx
```
Expected: PASS semua.

- [x] **Step 6: Typecheck web**

```bash
pnpm --filter ./src typecheck
```
Expected: keluar 0. (Bila nama paket berbeda, lihat `src/package.json` dan pakai nama itu.)

- [x] **Step 7: Commit**

```bash
git add src/src/screens/SettingsScreen.tsx src/test/settings-telegram-engine.test.tsx
git commit -m "feat(492): kartu Agen operator Telegram di Settings"
```

---

### Task 8: `/help` operator jujur + docs Source of Truth

**Files:**
- Modify: `runner/src/telegram-operator.ts:17-21`
- Modify: `runner/src/telegram-operator.test.ts`
- Modify: `internal/docs/architecture/api-contract.md` (blok Settings ~baris 314-345; bagian Telegram ~baris 984)
- Modify: `internal/skills/hanoman/SKILL.md` (butir Telegram, sesudah butir SPEC-477/ADR-0097)

**Interfaces:**
- Consumes: daftar command dari Task 5.
- Produces: —

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `runner/src/telegram-operator.test.ts`:

```ts
  // SPEC-492 · empat command ini DICEGAT server dan tak pernah sampai ke agen — tapi `/help`
  // ditulis agen, jadi tanpa baris ini ia menjanjikan daftar yang tidak lengkap.
  it("menyebut command runtime yang ditangani server", () => {
    const prompt = buildTelegramOperatorPrompt(input);
    for (const c of ["/engine", "/runtime", "/model", "/effort"]) expect(prompt).toContain(c);
    expect(prompt).toMatch(/ditangani server|dicegat server/i);
  });
```

(`input` = fixture yang sudah ada di berkas itu.)

- [ ] **Step 2: Jalankan, pastikan GAGAL**

```bash
./node_modules/.bin/vitest run --dir runner runner/src/telegram-operator.test.ts
```
Expected: FAIL — `expected '…' to contain '/engine'`.

- [ ] **Step 3: Perbarui prompt operator**

Di `runner/src/telegram-operator.ts`, ganti blok `COMMANDS` dan tambahkan satu baris kontrak:

```ts
const COMMANDS = [
  "/help", "/status", "/projects", "/project <id>", "/backlog [query]", "/sessions",
  "/use <session-id>", "/new <brief>", "/stop [session-id]", "/memory [forget <id>|reset]",
  "/personality [nama|reset]", "/skills",
];

// SPEC-492 · empat command runtime DICEGAT server sebelum menyentuh pane ini — kamu tak akan
// pernah menerimanya. Ia disebut di sini semata supaya `/help` yang KAMU tulis tidak berbohong.
const SERVER_COMMANDS = [
  "/engine", "/runtime claude|codex", "/model <id>", "/effort <nilai>",
];
```

Di array `return [...]`, tepat sesudah baris `` `- Command minimum: ${COMMANDS.join(", ")}.` ``:

```ts
    `- Command runtime sesi ini ditangani server, bukan kamu: ${SERVER_COMMANDS.join(", ")}. `
      + "Sebutkan di /help apa adanya; jangan pernah mencoba menjawabnya sendiri.",
```

- [ ] **Step 4: Jalankan test runner**

```bash
./node_modules/.bin/vitest run --dir runner runner/src/telegram-operator.test.ts
```
Expected: PASS.

- [ ] **Step 5: Perbarui `api-contract.md`**

Di blok `GET/PUT /settings` (sesudah keterangan `conflict { … }`), tambahkan:

```
#                                         telegram { enabled:false, progress:true,
#                                           engine:{ enabled:false, agent:"claude",
#                                                    model:"claude-opus-5", effort:"xhigh" } }
#                                           SPEC-476/ADR-0096 + SPEC-492 · `engine` = runtime/model/effort
#                                           KHUSUS sesi operator Telegram. OPT-IN: enabled:false →
#                                           mewarisi default global persis (sessionAgentDefaults).
#                                           Bentuknya SAMA dengan lead.engine (zAgentEngine, satu
#                                           definisi di shared/src/agent-engine.ts). Effort codex
#                                           dikoersi saat dibaca (coerceCodexEffort). Blok selalu ADA
#                                           di response (zod .default()) → baris Setting lama tetap
#                                           parse, TANPA migration. Dibaca ULANG tiap sesi operator
#                                           LAHIR (bukan tiap chat lahir), jadi ia berlaku untuk sesi
#                                           berikutnya; sesi yang sedang jalan tak pernah di-restart.
#                                           Perubahan `engine` SAJA TIDAK memicu reloadTelegramGateway().
```

Di bagian "Telegram gateway", sesudah blok `text` daftar endpoint, tambahkan:

```
### Command runtime — dicegat server (SPEC-492)

Empat command di bawah **tidak pernah** sampai ke pane sesi operator: coordinator mencegatnya di
`dispatch()` lalu menjawab lewat outbox (`kind: "gateway-control"`), dan gateway melewati balasan
progress generiknya (audit `outcome: "control"`). Alasannya: ia soal transport, bukan isi hanoman;
agen tak bisa mengubah model proses yang menjalankan dirinya sendiri; giliran agen 14–95 detik;
dan ia harus bekerja justru saat agennya macet.

| Command | Arti |
|---|---|
| `/engine` | Tampilkan sumber nilai, runtime · model · effort, dan keadaan sesi operator |
| `/engine off` | `enabled:false` → kembali mewarisi default global sesi kerja |
| `/engine restart` | Tutup sesi operator; pesan berikutnya lahir dengan setelan baru |
| `/runtime claude\|codex` | Tukar runtime — model & effort ikut ke default agen itu |
| `/model <id>` | Tukar model (divalidasi katalog agen aktif; effort dikoersi bila codex) |
| `/effort <nilai>` | Tukar effort (divalidasi `codexEfforts(model)` / `EFFORTS`) |

Ketiganya yang menulis (`/runtime`, `/model`, `/effort`) **menyalakan `enabled` secara implisit** —
menyetel nilai lalu tak terjadi apa-apa adalah jebakan yang justru diperbaiki SPEC-492. Setelannya
**global untuk semua chat**, bukan per-chat. Nilai di luar katalog **ditolak** dengan balasan yang
menyebut daftar yang sah; setelan tersimpan tak berubah.
```

- [ ] **Step 6: Perbarui `SKILL.md`**

Sisipkan butir baru sesudah butir "Kredensial Telegram = entri config terenkripsi" (sekitar
baris 899-920):

```md
- **Sesi operator Telegram punya runtime/model/effort sendiri** (SPEC-492, tanpa ADR — ADR-0096,
  ADR-0061, ADR-0074, ADR-0081 **ditegakkan**): blok opt-in `Setting.telegram.engine` bertipe
  **`zAgentEngine`** — bentuk `{enabled, agent, model, effort}` yang kini punya **satu** definisi di
  `shared/src/agent-engine.ts` dan dipakai `lead.engine` sekaligus (`zLeadEngine` = alias). Bentuknya
  **wajib** hidup di modul daun: `entities.ts` sudah meng-import `./telegram`, jadi mendefinisikannya
  di entities lalu meng-import balik menutup siklus modul dan `TELEGRAM_DEFAULTS =
  zTelegramSettings.parse({})` (top level) membaca binding yang masih **TDZ** → `ReferenceError`
  sebelum satu route pun terdaftar. Resolvernya `telegramAgentDefaults()` (cermin
  `leadAgentDefaults()`): mati → `sessionAgentDefaults()`, hidup → nilai engine + `coerceCodexEffort`.
  **Gotcha yang menentukan seluruh spec:** `TelegramChat.agent/model/effort` **membekukan** default
  saat chat pertama menyapa — `ensureChat` ber-`update:{userId}` dan **tak ada penulis lain**
  (`patchChat`/`PATCH …/context` hanya menerima empat field lain), jadi menukar `defaults` di
  `productionFactory` SENDIRIAN memberi setelan ber-nol-efek untuk setiap chat yang sudah ada
  (terukur: instalasi hidup punya 1 baris, sudah beku di `claude · claude-opus-5 · xhigh`) — kelas
  SPEC-487. Resolver karena itu dibaca ulang di **tiap kelahiran sesi**, dipakai juga untuk
  **`ensureCodexTrust`** (gotcha SPEC-377/ADR-0081), lalu dicerminkan ke baris chat
  (`setChatEngine`). Permukaan keduanya **command yang dicegat coordinator** — `/engine`,
  `/engine off`, `/engine restart`, `/runtime`, `/model`, `/effort` — yang **tak pernah** menyentuh
  pane: ia soal transport, agen tak bisa mengubah model proses yang menjalankan dirinya sendiri,
  giliran agen terukur 14–95 dtk, dan ia harus bekerja justru saat agennya macet; balasannya
  diantre `kind: "gateway-control"` (di luar enum reply — `dedupeKey` outbox `chat:update:kind`)
  dan gateway melewati progress generiknya. **Sengaja TIDAK mengetik `/model` ke pane hidup**
  (ADR-0061 mencabut matrix per-fase karena itu; SPEC-487 mengukur pesan liarnya) — jalurnya
  `/engine restart`, dan konteks selamat lewat ringkasan + curated memory. `PUT /settings`
  **tak lagi** me-reload gateway bila hanya `engine` yang berubah (`telegramReloadNeeded`): reload
  memanggil `getMe()` dan bisa menjatuhkan `readiness` ke `error` gara-gara satu dropdown.
```

- [ ] **Step 7: Verifikasi index docs**

Kedua berkas sudah ter-link di `internal/docs/README.md` (`architecture` dan skill di `AGENTS.md`),
jadi tak ada entri index baru. Buktikan:

```bash
./node_modules/.bin/tsx cli/src/index.ts docs index --check 2>/dev/null || \
  /usr/bin/grep -n "architecture/api-contract" internal/docs/README.md
```
Expected: baris index untuk `api-contract` muncul.

- [ ] **Step 8: Commit**

```bash
git add runner/src/telegram-operator.ts runner/src/telegram-operator.test.ts internal/docs/architecture/api-contract.md internal/skills/hanoman/SKILL.md
git commit -m "docs(492): kontrak command runtime Telegram + blok telegram.engine"
```

---

### Task 9: Verifikasi akhir & smoke nyata

**Files:** —

- [ ] **Step 1: Jalankan seluruh test yang tersentuh perubahan ini**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --no-file-parallelism \
  shared/src/agent-engine.test.ts shared/src/telegram.test.ts shared/src/lead.test.ts \
  runner/src/telegram-operator.test.ts \
  server/test/telegram-engine-command.test.ts server/test/telegram-engine-config.test.ts \
  server/test/telegram-engine-session.test.ts server/test/telegram-engine-bootstrap.test.ts \
  server/test/telegram-session.test.ts server/test/telegram-gateway.test.ts \
  server/test/telegram-e2e.test.ts server/test/telegram-bootstrap-config.test.ts \
  server/test/settings.test.ts
```
Expected: PASS, dan **jumlah berkas test > 0** — `--changed` menyalakan `passWithNoTests`, jadi
"no test files" **bukan** hijau.

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --dir src \
  src/test/settings-telegram-engine.test.tsx src/test/settings-lead-engine.test.tsx \
  src/test/settings-conflict.test.tsx src/test/settings-model-tab.test.tsx src/test/settings-agent.test.tsx
```
Expected: PASS.

- [ ] **Step 2: Typecheck paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./runner typecheck && pnpm --filter ./server typecheck
```
Expected: keluar 0 ketiganya. (Jangan `pnpm -r typecheck` — mesin ini menjalankan beberapa sesi.)

- [ ] **Step 3: Smoke nyata endpoint yang tersentuh (sekali, di akhir)**

Task ini menyentuh `GET`/`PUT /api/settings`, jadi endpoint-nya diuji nyata — DB khusus, port
bukan 8787 (dipakai instance dev):

```bash
export HANOMAN_HOME="$(mktemp -d)"
pnpm --filter ./server exec prisma migrate deploy
PORT=8799 HANOMAN_HOME="$HANOMAN_HOME" ./node_modules/.bin/tsx server/src/server.ts &
sleep 6
curl -s localhost:8799/api/health
```

Lalu (ikuti mekanisme auth `server/test/telegram-routes.test.ts` bila `/api/settings` menuntut
cookie; bila `agentAccessEnabled` mati, jalur cookie adalah satu-satunya):

```bash
curl -s localhost:8799/api/settings | python3 -m json.tool | grep -A 6 '"telegram"'
```
Expected: blok `telegram` memuat `engine` dengan `enabled: false`, `agent: "claude"`,
`model: "claude-opus-5"`, `effort: "xhigh"`.

Matikan server **per-PID** (JANGAN `pkill -f`):

```bash
lsof -ti:8799 | xargs -r kill
```

- [ ] **Step 4: Pastikan semua kotak plan tercentang**

```bash
/usr/bin/grep -c '^\- \[ \]' docs/superpowers/plans/2026-08-02-spec-492-telegram-engine.md
```
Expected: `0`. hanoman menahan backlog di `executing` selama masih ada `- [ ]`.

- [ ] **Step 5: Commit & push**

```bash
git add -A docs/superpowers/plans/2026-08-02-spec-492-telegram-engine.md
git commit -m "chore(492): centang plan + catatan verifikasi"
git push origin HEAD:refs/heads/hanoman/spec-492
```

---

## Urutan eksekusi yang disarankan

`Task 1 → 2 → 5 → 4 → 3 → 6 → 7 → 8 → 9`

Task 5 (parser murni) mendahului Task 4 karena `TelegramSessionCoordinatorDeps.engine` memakai
tipe `EngineContext` miliknya; Task 3 sesudah Task 4/5 karena `telegramSessionDeps` menyebut
`telegramEngineContext` dan `killSession`.
