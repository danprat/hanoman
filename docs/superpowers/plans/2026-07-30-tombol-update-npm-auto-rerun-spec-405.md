# Tombol update npm + rerun otomatis (SPEC-405) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Satu tombol di dashboard memasang `hanoman@latest` dari npm lalu menjalankan hanoman lagi sendiri — tanpa langkah manual, tanpa membunuh sesi agen.

**Architecture:** Server **tidak pernah** memanggil `npm`. `POST /api/update/apply` hanya membuat proses server keluar dengan kode sentinel **75**; CLI parent `hanoman start` — yang sejak ADR-0087 memang sudah men-`spawn` server sebagai proses anak — membaca kode itu, menjalankan `npm i -g hanoman@latest`, `prisma generate`, `migrate deploy`, lalu men-spawn server lagi dari path yang sama (isinya sudah tertimpa). Pane tmux beserta agennya selamat (ADR-0016); WebSocket dashboard menyambung ulang sendiri.

**Tech Stack:** TypeScript strict · Fastify (server) · React 18 (dashboard) · zod (`@hanoman/shared`) · vitest · node `child_process`.

## Global Constraints

- Spec acuan: `docs/superpowers/specs/2026-07-30-spec-405-tombol-update-npm-auto-rerun-design.md`.
- **Supervised-only.** Tombol & endpoint hanya sah bila `process.env.HANOMAN_SUPERVISOR === "1"`, yang **hanya** disuntikkan `cli/src/commands/start.ts` saat men-spawn server. Di luar itu panel tetap read-only persis seperti hari ini.
- `HANOMAN_SUPERVISOR` **wajib dibaca dari `process.env` langsung**, bukan `effectiveBool()`. `effectiveBool` membaca cache config DB lebih dulu, jadi memakainya berarti siapa pun yang bisa menulis config bisa mengaku disupervisi.
- **Tanpa perubahan skema, tanpa migration, tanpa knob `Setting` baru.**
- Konstanta yang dipakai lintas paket: `UPDATE_RESTART_EXIT = 75` di `@hanoman/shared`. Jangan pernah menulis literal `75` di server atau CLI.
- Prosa/komentar bahasa Indonesia (konvensi repo). Kode & identifier tetap apa adanya.
- Test dijalankan **serial**: `pnpm vitest --run --no-file-parallelism <path…>` bila set-nya menyentuh `server/`.
- Setiap task selesai → centang kotaknya di berkas ini (`- [ ]` → `- [x]`), jalankan test task itu, commit.

---

### Task 1: Kontrak bersama — `canApply`, sentinel exit, body zod

**Files:**
- Modify: `shared/src/dto.ts` (blok `UpdateStatus`, ±baris 375–384)
- Test: `shared/test/update-contract.test.ts` (create)

**Interfaces:**
- Consumes: `z` (sudah diimpor di `dto.ts`), `UpdateRegistryStatus` (sudah ada di berkas yang sama).
- Produces:
  - `UPDATE_RESTART_EXIT: 75` (const)
  - `type UpdateStatus` + field baru `canApply: boolean`
  - `zUpdateApplyBody` → `{ confirm?: boolean }`, `type UpdateApplyBody`

- [x] **Step 1: Tulis test yang gagal**

Buat `shared/test/update-contract.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { UPDATE_RESTART_EXIT, zUpdateApplyBody } from "../src/dto";

describe("kontrak update apply (SPEC-405 · ADR-0088)", () => {
  it("kode keluar sentinel = 75 (EX_TEMPFAIL), non-zero", () => {
    expect(UPDATE_RESTART_EXIT).toBe(75);
    expect(UPDATE_RESTART_EXIT).not.toBe(0);
  });
  it("body kosong sah — confirm opsional", () => {
    expect(zUpdateApplyBody.parse({})).toEqual({});
  });
  it("confirm boolean diterima", () => {
    expect(zUpdateApplyBody.parse({ confirm: true })).toEqual({ confirm: true });
  });
  it("confirm bukan boolean ditolak — 'ya' tak boleh dibaca sebagai persetujuan", () => {
    expect(zUpdateApplyBody.safeParse({ confirm: "ya" }).success).toBe(false);
  });
  it("field tak dikenal dibuang, bukan menggagalkan (konvensi payload repo)", () => {
    expect(zUpdateApplyBody.parse({ confirm: false, wat: 1 })).toEqual({ confirm: false });
  });
});
```

- [x] **Step 2: Jalankan, pastikan GAGAL**

Run: `pnpm vitest --run shared/test/update-contract.test.ts`
Expected: FAIL — `UPDATE_RESTART_EXIT`/`zUpdateApplyBody` tak ada (`does not provide an export named`).

- [x] **Step 3: Implementasi minimal**

Di `shared/src/dto.ts`, ganti blok `UpdateStatus` menjadi:

```ts
// SPEC-398 · ADR-0087 · versi hanoman = semver paket npm (dulu SHA git, SPEC-214).
// SPEC-405 · ADR-0088 · panel tak lagi murni read-only: bila proses server ini anak dari
// `hanoman start`, ia boleh MEMINTA dipasang ulang. `command` tetap ada — ia satu-satunya
// jalan saat tak ada supervisor.
export type UpdateRegistryStatus = "ok" | "unavailable";  // unavailable = offline / opt-out / paket belum terbit
export type UpdateStatus = {
  currentVersion: string;                 // versi yang sedang berjalan (build-info.json → package.json)
  latestVersion: string | null;           // versi terbaru di registry; null bila tak terbaca
  registry: { status: UpdateRegistryStatus; checkedAt: string | null };
  updateAvailable: boolean;               // compareSemver(latest, current) > 0
  command: string;                        // "npm i -g hanoman@latest"; "" bila sudah terkini
  // SPEC-405 · ADR-0088 · true HANYA bila env HANOMAN_SUPERVISOR=1 (disuntik `hanoman start`).
  // Konstan seumur proses, jadi aman ikut frame siar `update` yang di-recompute tiap 300 dtk.
  canApply: boolean;
};

// SPEC-405 · ADR-0088 · kode keluar sentinel: "aku minta dipasang ulang". Server yang keluar,
// supervisor `hanoman start` yang membacanya lalu memasang + menjalankan ulang. 75 = EX_TEMPFAIL —
// non-zero, jadi `Restart=on-failure` di unit systemd yang didokumentasikan tetap masuk akal.
export const UPDATE_RESTART_EXIT = 75;

// Dua langkah sengaja: tanpa `confirm` endpoint hanya melapor (dry-run), dengan `confirm` ia
// benar-benar keluar. Nilai non-boolean DITOLAK — "ya"/1 tak boleh terbaca sebagai persetujuan.
export const zUpdateApplyBody = z.object({ confirm: z.boolean().optional() });
export type UpdateApplyBody = z.infer<typeof zUpdateApplyBody>;
```

- [x] **Step 4: Jalankan, pastikan LULUS**

Run: `pnpm vitest --run shared/test/update-contract.test.ts`
Expected: PASS 5/5.

- [x] **Step 5: Commit**

```bash
git add shared/src/dto.ts shared/test/update-contract.test.ts
git commit -m "feat(405): kontrak update apply — canApply, sentinel exit 75, zUpdateApplyBody"
```

> Catatan: menambah `canApply` **memecah** tiga tempat yang membangun `UpdateStatus` literal
> (`server/src/services/update.ts`, `src/src/api/update.ts`, dua helper `mk()` di test frontend).
> Itu disengaja — TypeScript strict akan menunjukkan semuanya, dan Task 2 & 6 memperbaikinya.
> Jangan menjalankan typecheck paket lain sampai task itu selesai.

---

### Task 2: Server — `supervised()`, `canApply`, dan permintaan restart

**Files:**
- Modify: `server/src/services/update.ts`
- Test: `server/test/update.test.ts` (modify — tambah `canApply`), `server/test/update-restart.test.ts` (create)

**Interfaces:**
- Consumes: `UPDATE_RESTART_EXIT` (Task 1), `effectiveInt`/`effectiveStr`/`effectiveBool` dari `../config`.
- Produces:
  - `supervised(): boolean`
  - `UpdateInputs` + field `canApply: boolean`
  - `requestRestartForUpdate(): void`
  - `__setExiter(fn: (code: number) => void): void` (test-only)
  - `__setRegistrySnapshot(latest: string | null, status: UpdateRegistryStatus): void` (test-only)

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/update.test.ts` — `base` sekarang butuh `canApply`:

```ts
const base = {
  currentVersion: "0.1.0", latestVersion: null,
  registryStatus: "unavailable" as const, checkedAt: null, canApply: false,
};
```

lalu tambah blok baru di akhir berkas:

```ts
describe("canApply (SPEC-405 · ADR-0088)", () => {
  it("diwariskan apa adanya, tak diturunkan dari updateAvailable", () => {
    expect(composeUpdate({ ...base, canApply: true }).canApply).toBe(true);
    expect(composeUpdate({ ...base, latestVersion: "0.2.0", registryStatus: "ok" }).canApply).toBe(false);
  });
  it("tak pernah menyalakan dirinya sendiri saat ada update", () => {
    const u = composeUpdate({ ...base, latestVersion: "0.2.0", registryStatus: "ok", canApply: false });
    expect(u.updateAvailable).toBe(true);
    expect(u.canApply).toBe(false);
  });
});
```

Buat `server/test/update-restart.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { UPDATE_RESTART_EXIT } from "@hanoman/shared";
import { supervised, requestRestartForUpdate, __setExiter } from "../src/services/update";

const saved = process.env.HANOMAN_SUPERVISOR;
afterEach(() => {
  if (saved === undefined) delete process.env.HANOMAN_SUPERVISOR;
  else process.env.HANOMAN_SUPERVISOR = saved;
  __setExiter(null);
  vi.useRealTimers();
});
beforeEach(() => { delete process.env.HANOMAN_SUPERVISOR; });

describe("supervised()", () => {
  it("false tanpa env — instalasi tak tersupervisi tak boleh mengaku bisa restart", () => {
    expect(supervised()).toBe(false);
  });
  it('true untuk "1" dan "true"', () => {
    process.env.HANOMAN_SUPERVISOR = "1";
    expect(supervised()).toBe(true);
    process.env.HANOMAN_SUPERVISOR = "true";
    expect(supervised()).toBe(true);
  });
  it('nilai lain tetap false ("0", kosong, sampah)', () => {
    for (const v of ["0", "", "yes", "supervised"]) {
      process.env.HANOMAN_SUPERVISOR = v;
      expect(supervised()).toBe(false);
    }
  });
});

describe("requestRestartForUpdate()", () => {
  it("memanggil exiter dengan sentinel 75, SESUDAH jeda (bukan seketika)", () => {
    vi.useFakeTimers();
    const calls: number[] = [];
    __setExiter((c) => calls.push(c));
    requestRestartForUpdate();
    expect(calls).toEqual([]);          // respons 202 harus sempat ter-flush dulu
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual([UPDATE_RESTART_EXIT]);
  });
});
```

- [x] **Step 2: Jalankan, pastikan GAGAL**

Run: `pnpm vitest --run --no-file-parallelism server/test/update.test.ts server/test/update-restart.test.ts`
Expected: FAIL — `supervised`/`requestRestartForUpdate`/`__setExiter` tak ada.

- [x] **Step 3: Implementasi minimal**

Di `server/src/services/update.ts`:

1. Perluas import baris 4:

```ts
import { compareSemver, UPDATE_RESTART_EXIT, type UpdateStatus, type UpdateRegistryStatus } from "@hanoman/shared";
import { effectiveStr, effectiveBool, effectiveInt } from "../config";
```

2. Tambah `canApply` ke `UpdateInputs` dan ke hasil `composeUpdate`:

```ts
export type UpdateInputs = {
  currentVersion: string;
  latestVersion: string | null;
  registryStatus: UpdateRegistryStatus;
  checkedAt: string | null;
  canApply: boolean;
};

export function composeUpdate(x: UpdateInputs): UpdateStatus {
  const available = x.registryStatus === "ok" && x.latestVersion != null
    && compareSemver(x.latestVersion, x.currentVersion) > 0;
  return {
    currentVersion: x.currentVersion,
    latestVersion: x.latestVersion,
    registry: { status: x.registryStatus, checkedAt: x.checkedAt },
    updateAvailable: available,
    command: available ? UPDATE_COMMAND : "",
    // Diwariskan apa adanya. Ia fakta tentang cara proses ini dilahirkan, bukan kesimpulan
    // tentang ada-tidaknya update — menurunkannya dari `available` akan menyembunyikan
    // instalasi tak-tersupervisi tepat saat tombolnya paling ingin ditekan.
    canApply: x.canApply,
  };
}
```

3. Tambah di bawah `runningVersion()`:

```ts
/**
 * SPEC-405 · ADR-0088 · apakah proses server ini punya yang akan menghidupkannya lagi?
 *
 * Dibaca LANGSUNG dari `process.env`, BUKAN lewat `effectiveBool()`: ini fakta tentang cara
 * proses ini dilahirkan, bukan setelan. `effectiveBool` membaca cache config DB lebih dulu, jadi
 * memakainya berarti siapa pun yang bisa menulis config bisa mengaku disupervisi — dan tombolnya
 * lalu mematikan instance yang tak akan pernah hidup lagi.
 */
export function supervised(): boolean {
  const v = process.env.HANOMAN_SUPERVISOR;
  return v === "1" || v === "true";
}

let exiter: ((code: number) => void) | null = null;

/** Test-only: ganti (atau `null` untuk mengembalikan) cara proses ini keluar. */
export function __setExiter(fn: ((code: number) => void) | null): void { exiter = fn; }

/**
 * Menjadwalkan keluarnya proses dengan kode sentinel. Jeda kecil supaya respons `202` benar-benar
 * ter-flush sebelum prosesnya hilang.
 *
 * Ini BUKAN graceful shutdown, dan tak perlu: proses ini memang sedang menunggu ditimpa di disk,
 * dan tmux (ADR-0016) adalah daemon terpisah — pane beserta agen di dalamnya tak tersentuh.
 */
export function requestRestartForUpdate(): void {
  const delay = effectiveInt("HANOMAN_UPDATE_RESTART_DELAY_MS") ?? 250;
  setTimeout(() => (exiter ?? ((c: number) => process.exit(c)))(UPDATE_RESTART_EXIT), delay);
}

/** Test-only: pasang snapshot registry tanpa jaringan (fetch tetap ter-gate & tak ditembak). */
export function __setRegistrySnapshot(latest: string | null, status: UpdateRegistryStatus): void {
  lastLatest = latest; lastStatus = status; lastFetchAt = Date.now(); cached = null;
}
```

4. `getUpdateStatus()` meneruskan `canApply`:

```ts
  const value = composeUpdate({
    currentVersion: runningVersion(),
    latestVersion: lastLatest,
    registryStatus: lastStatus,
    checkedAt: lastFetchAt ? new Date(lastFetchAt).toISOString() : null,
    canApply: supervised(),
  });
```

- [x] **Step 4: Jalankan, pastikan LULUS**

Run: `pnpm vitest --run --no-file-parallelism server/test/update.test.ts server/test/update-restart.test.ts`
Expected: PASS (6 lama + 2 baru di `update.test.ts`, 4 di `update-restart.test.ts`).

- [x] **Step 5: Commit**

```bash
git add server/src/services/update.ts server/test/update.test.ts server/test/update-restart.test.ts
git commit -m "feat(405): supervised() + canApply + requestRestartForUpdate di services/update"
```

---

### Task 3: Server — `POST /api/update/apply`

**Files:**
- Modify: `server/src/routes/update.ts`
- Test: `server/test/update.route.test.ts` (modify)

**Interfaces:**
- Consumes: `zUpdateApplyBody` (Task 1); `getUpdateStatus`, `requestRestartForUpdate`, `__setRegistrySnapshot`, `__setExiter` (Task 2); `listSessions` dari `../services/pty`.
- Produces: endpoint `POST /api/update/apply` dengan empat balasan tabel di bawah.

| Keadaan | Status | Body |
| --- | --- | --- |
| body tak valid | 400 | `{ error: "bad-body" }` |
| `canApply` false | 409 | `{ error: "unsupervised" }` |
| `updateAvailable` false | 409 | `{ error: "up-to-date", current }` |
| belum `confirm` | 409 | `{ error: "confirm-required", liveSessions, from, to }` |
| `confirm: true` | 202 | `{ accepted: true, from, to, liveSessions }` |

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/update.route.test.ts` (import diperluas dulu):

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildApp } from "../src/app";
import { _resetUpdateCache, __setRegistrySnapshot, __setExiter } from "../src/services/update";

const savedSup = process.env.HANOMAN_SUPERVISOR;
const savedDelay = process.env.HANOMAN_UPDATE_RESTART_DELAY_MS;
const restoreEnv = () => {
  if (savedSup === undefined) delete process.env.HANOMAN_SUPERVISOR; else process.env.HANOMAN_SUPERVISOR = savedSup;
  if (savedDelay === undefined) delete process.env.HANOMAN_UPDATE_RESTART_DELAY_MS; else process.env.HANOMAN_UPDATE_RESTART_DELAY_MS = savedDelay;
};

describe("POST /api/update/apply (SPEC-405 · ADR-0088)", () => {
  let exits: number[];
  beforeEach(() => {
    _resetUpdateCache();
    exits = [];
    __setExiter((c) => exits.push(c));
    process.env.HANOMAN_UPDATE_RESTART_DELAY_MS = "0";
  });
  afterEach(() => { __setExiter(null); restoreEnv(); _resetUpdateCache(); });

  const post = async (body: unknown, supervised: boolean, latest: string | null) => {
    if (supervised) process.env.HANOMAN_SUPERVISOR = "1"; else delete process.env.HANOMAN_SUPERVISOR;
    _resetUpdateCache();
    __setRegistrySnapshot(latest, latest ? "ok" : "unavailable");
    const app = buildApp({ requireAuth: false });
    return app.inject({ method: "POST", url: "/api/update/apply", payload: body });
  };
  const settle = () => new Promise((r) => setTimeout(r, 20));

  it("tak tersupervisi → 409 unsupervised, TIDAK keluar", async () => {
    const res = await post({ confirm: true }, false, "99.9.9");
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("unsupervised");
    await settle();
    expect(exits).toEqual([]);
  });

  it("sudah terkini → 409 up-to-date, TIDAK keluar", async () => {
    const res = await post({ confirm: true }, true, null);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("up-to-date");
    await settle();
    expect(exits).toEqual([]);
  });

  it("tanpa confirm → 409 confirm-required + jumlah sesi hidup, TIDAK keluar", async () => {
    const res = await post({}, true, "99.9.9");
    expect(res.statusCode).toBe(409);
    const b = res.json();
    expect(b.error).toBe("confirm-required");
    expect(b.to).toBe("99.9.9");
    expect(typeof b.from).toBe("string");
    expect(Number.isInteger(b.liveSessions)).toBe(true);
    expect(b.liveSessions).toBeGreaterThanOrEqual(0);
    await settle();
    expect(exits).toEqual([]);
  });

  it("confirm:true → 202 lalu keluar dengan sentinel 75", async () => {
    const res = await post({ confirm: true }, true, "99.9.9");
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ accepted: true, to: "99.9.9" });
    await settle();
    expect(exits).toEqual([75]);
  });

  it("confirm non-boolean → 400, TIDAK keluar", async () => {
    const res = await post({ confirm: "ya" }, true, "99.9.9");
    expect(res.statusCode).toBe(400);
    await settle();
    expect(exits).toEqual([]);
  });

  it("401 tanpa cookie saat requireAuth", async () => {
    process.env.HANOMAN_SUPERVISOR = "1";
    const app = buildApp({ requireAuth: true });
    const res = await app.inject({ method: "POST", url: "/api/update/apply", payload: { confirm: true } });
    expect(res.statusCode).toBe(401);
    await settle();
    expect(exits).toEqual([]);
  });
});
```

Perbarui juga assertion `GET /api/update` yang sudah ada agar menyebut field baru:

```ts
    expect(b).toMatchObject({ updateAvailable: false, command: "", latestVersion: null, canApply: false });
```

- [x] **Step 2: Jalankan, pastikan GAGAL**

Run: `pnpm vitest --run --no-file-parallelism server/test/update.route.test.ts`
Expected: FAIL — route `POST /api/update/apply` 404.

- [x] **Step 3: Implementasi minimal**

Ganti isi `server/src/routes/update.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { zUpdateApplyBody } from "@hanoman/shared";
import { getUpdateStatus, requestRestartForUpdate } from "../services/update";
import { listSessions } from "../services/pty";

// GET /api/update — status auto-update (SPEC-214/398). Auth-gated otomatis (bukan anggota PUBLIC
// di app.ts). Realtime lewat WS siar grup "update".
//
// POST /api/update/apply — SPEC-405 · ADR-0088. Server TETAP tak memasang apa pun (ADR-0048 utuh
// di intinya): ia hanya keluar dengan kode sentinel, dan supervisor `hanoman start` yang memasang
// lalu menjalankan ulang. Karena itu ia HANYA sah saat proses ini punya supervisor.
export default async function update(app: FastifyInstance) {
  app.get("/update", async () => getUpdateStatus());

  app.post("/update/apply", async (req, reply) => {
    const parsed = zUpdateApplyBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "bad-body" });

    const u = await getUpdateStatus();
    if (!u.canApply) return reply.code(409).send({ error: "unsupervised" });
    if (!u.updateAvailable) return reply.code(409).send({ error: "up-to-date", current: u.currentVersion });

    // Dihitung SAAT INI, bukan diambil dari frame siar `update`: grup itu di-recompute tiap 300
    // tick, dan angka basi pada dialog risiko lebih buruk daripada tak ada angka.
    const liveSessions = listSessions().filter((s) => !s.exited).length;
    const from = u.currentVersion;
    const to = u.latestVersion;

    // Langkah pertama sengaja hanya MELAPOR. Sesi hidup tak memblokir apa pun di server —
    // manusia yang memutuskan, dan pane tmux memang selamat dari restart (ADR-0016).
    if (!parsed.data.confirm) return reply.code(409).send({ error: "confirm-required", liveSessions, from, to });

    requestRestartForUpdate();
    return reply.code(202).send({ accepted: true, from, to, liveSessions });
  });
}
```

- [x] **Step 4: Jalankan, pastikan LULUS**

Run: `pnpm vitest --run --no-file-parallelism server/test/update.route.test.ts`
Expected: PASS 8/8.

- [x] **Step 5: Commit**

```bash
git add server/src/routes/update.ts server/test/update.route.test.ts
git commit -m "feat(405): POST /api/update/apply — dry-run lalu exit sentinel, supervised-only"
```

---

### Task 4: Tutup lubang capability — agent token tak boleh me-restart instance

**Files:**
- Modify: `server/src/services/agent-capabilities.ts:21`
- Test: `server/test/agent-capabilities.test.ts` (modify)

**Interfaces:**
- Consumes: `capabilityForRoute`, `checkAgentCapability` (sudah ada).
- Produces: perilaku baru — prefix status global menghasilkan `GLOBAL_READ` **hanya** untuk method baca.

> **Kenapa ini bagian dari SPEC-405, bukan task terpisah.** `capabilityForRoute` memetakan
> `top === "update"` ke `GLOBAL_READ` **tanpa melihat method**, dan `checkAgentCapability`
> meloloskan `GLOBAL_READ` tanpa syarat. Menambahkan `POST /update/apply` di bawah prefix itu
> (Task 3) berarti **setiap agent token — capability apa pun — bisa me-restart instance operator.**
> Task 3 tidak boleh berdiri sendiri tanpa task ini.

- [ ] **Step 1: Tulis test yang gagal**

Tambah ke `server/test/agent-capabilities.test.ts`:

```ts
describe("status global read-only tak boleh tembus lewat method tulis (SPEC-405 · ADR-0088)", () => {
  it("GET /api/update tetap lolos tanpa capability apa pun", () => {
    expect(capabilityForRoute("GET", "/api/update")).toBe("GLOBAL_READ");
    expect(checkAgentCapability([], "GET", "/api/update")).toEqual({ ok: true });
  });
  it("POST /api/update/apply DITOLAK — bahkan untuk token ber-capability penuh", () => {
    expect(capabilityForRoute("POST", "/api/update/apply")).toBe("COOKIE_ONLY");
    const caps = ["backlog:write", "sessions:write", "settings:write", "projects:write"];
    expect(checkAgentCapability(caps, "POST", "/api/update/apply")).toMatchObject({ ok: false, status: 403 });
  });
  it("prefix status lain ikut: POST /api/limits & /api/health ditolak", () => {
    expect(capabilityForRoute("POST", "/api/limits")).toBe("COOKIE_ONLY");
    expect(capabilityForRoute("POST", "/api/health")).toBe("COOKIE_ONLY");
  });
  it("HEAD dianggap baca", () => {
    expect(capabilityForRoute("HEAD", "/api/update")).toBe("GLOBAL_READ");
  });
});
```

Kalau berkas itu belum mengimpor `checkAgentCapability`, tambahkan ke import barisnya:

```ts
import { capabilityForRoute, checkAgentCapability } from "../src/services/agent-capabilities";
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `pnpm vitest --run --no-file-parallelism server/test/agent-capabilities.test.ts`
Expected: FAIL — `POST /api/update/apply` masih `"GLOBAL_READ"`.

- [ ] **Step 3: Implementasi minimal**

Di `server/src/services/agent-capabilities.ts`, ganti baris 20–21:

```ts
  // read-only global (status). SPEC-405 · ADR-0088 · `GLOBAL_READ` HANYA untuk method baca:
  // `POST /update/apply` me-restart instance, dan itu tak pernah boleh lolos hanya karena
  // prefix-nya kebetulan sama dengan endpoint status. Cookie = akses penuh, seperti sebelumnya.
  if (top === "limits" || top === "update" || top === "events" || top === "fs" || top === "health")
    return read ? "GLOBAL_READ" : "COOKIE_ONLY";
```

- [ ] **Step 4: Jalankan, pastikan LULUS**

Run: `pnpm vitest --run --no-file-parallelism server/test/agent-capabilities.test.ts server/test/agent-gate.test.ts`
Expected: PASS keduanya.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/agent-capabilities.ts server/test/agent-capabilities.test.ts
git commit -m "fix(405): GLOBAL_READ hanya untuk method baca — agent token tak boleh restart instance"
```

---

### Task 5: CLI — supervisor loop di `hanoman start`

**Files:**
- Modify: `cli/src/commands/start.ts`
- Test: `cli/test/start-args.test.ts` (modify)

**Interfaces:**
- Consumes: `UPDATE_RESTART_EXIT` (Task 1); `INSTALL_ARGS`, `PKG` dari `./update` (sudah ada).
- Produces:
  - `MAX_UPDATE_RESTARTS = 5`
  - `planSupervisorStep(code: number, restartsUsed: number): SupervisorStep`
  - `serverEnv(o: ServerEnvInput): Record<string, string>`
  - `installLatest(): InstallOutcome`

- [ ] **Step 1: Tulis test yang gagal**

Tambah ke `cli/test/start-args.test.ts` (perluas import baris 2):

```ts
import {
  parseStartArgs, migrateFailureHint,
  planSupervisorStep, serverEnv, MAX_UPDATE_RESTARTS,
} from "../src/commands/start";
import { UPDATE_RESTART_EXIT } from "@hanoman/shared";

describe("planSupervisorStep (SPEC-405 · ADR-0088)", () => {
  it("exit 0 → keluar 0 (perilaku hari ini, tak berubah)", () => {
    expect(planSupervisorStep(0, 0)).toEqual({ action: "exit", code: 0 });
  });
  it("exit ≠ sentinel → keluar apa adanya, jangan pernah memasang apa pun", () => {
    for (const c of [1, 2, 130, 143]) expect(planSupervisorStep(c, 0)).toEqual({ action: "exit", code: c });
  });
  it("sentinel 75 → pasang lalu jalankan lagi", () => {
    expect(planSupervisorStep(UPDATE_RESTART_EXIT, 0)).toEqual({ action: "update" });
  });
  it("sentinel tapi jatah habis → keluar, bukan loop tak berujung", () => {
    expect(planSupervisorStep(UPDATE_RESTART_EXIT, MAX_UPDATE_RESTARTS))
      .toEqual({ action: "exit", code: UPDATE_RESTART_EXIT });
  });
  it("jatah masih sisa satu → masih memasang", () => {
    expect(planSupervisorStep(UPDATE_RESTART_EXIT, MAX_UPDATE_RESTARTS - 1)).toEqual({ action: "update" });
  });
});

describe("serverEnv (SPEC-405 · ADR-0088)", () => {
  const base = { dbUrl: "file:/tmp/x.db", port: 8787, host: "127.0.0.1", home: "/home/u/.hanoman", web: null };
  it("menandai proses anak sebagai TERSUPERVISI — tanpa ini tombol update tak muncul", () => {
    expect(serverEnv(base).HANOMAN_SUPERVISOR).toBe("1");
  });
  it("meneruskan env terhitung yang sudah ada", () => {
    expect(serverEnv(base)).toMatchObject({
      NODE_ENV: "production", DATABASE_URL: "file:/tmp/x.db",
      PORT: "8787", HOST: "127.0.0.1", HANOMAN_HOME: "/home/u/.hanoman",
    });
  });
  it("HANOMAN_WEB_DIR hanya bila aset web ketemu", () => {
    expect(serverEnv(base).HANOMAN_WEB_DIR).toBeUndefined();
    expect(serverEnv({ ...base, web: "/pkg/web" }).HANOMAN_WEB_DIR).toBe("/pkg/web");
  });
});
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `pnpm vitest --run cli/test/start-args.test.ts`
Expected: FAIL — `planSupervisorStep`/`serverEnv`/`MAX_UPDATE_RESTARTS` tak ada.

- [ ] **Step 3: Implementasi**

Di `cli/src/commands/start.ts`:

1. Perluas import baris 10–12:

```ts
import { resolveHome, resolveDbUrl, dbFilePath, prismaCliPath, dbUrlNotice } from "@hanoman/runner";
import { UPDATE_RESTART_EXIT } from "@hanoman/shared";
import type { Ctx } from "../router";
import { resolveLayout } from "../layout";
import { INSTALL_ARGS } from "./update";
```

2. Tambah blok berikut tepat di atas `export default async function start`:

```ts
/**
 * SPEC-405 · ADR-0088 · `hanoman start` adalah SUPERVISOR-nya, bukan sekadar peluncur.
 *
 * Server tak pernah memanggil `npm`; ia hanya keluar dengan kode sentinel saat operator menekan
 * "Pasang & mulai ulang" di dashboard. Yang memasang lalu menjalankan ulang adalah proses ini —
 * itulah kenapa ADR-0048 tetap benar di intinya: server tak memasang perangkat lunak apa pun.
 */
export const MAX_UPDATE_RESTARTS = 5;

export type SupervisorStep = { action: "exit"; code: number } | { action: "update" };

/**
 * Murni. HANYA kode sentinel yang berarti "pasang lalu jalankan lagi" — kode lain diteruskan apa
 * adanya, jadi `hanoman start` yang tak pernah diminta update berperilaku byte-identik dengan
 * sebelum SPEC-405.
 *
 * Jatah `MAX_UPDATE_RESTARTS` adalah pagar terhadap rilis yang meminta restart berulang: aksinya
 * dipicu manusia, jadi loop tak berujung bukan mode kegagalan otomatis — tapi batasnya murah dan
 * pemanggil WAJIB mencetak alasannya saat jatah habis (jangan pernah membatasi diam-diam).
 */
export function planSupervisorStep(code: number, restartsUsed: number): SupervisorStep {
  if (code !== UPDATE_RESTART_EXIT) return { action: "exit", code };
  if (restartsUsed >= MAX_UPDATE_RESTARTS) return { action: "exit", code };
  return { action: "update" };
}

export type ServerEnvInput = {
  dbUrl: string; port: number; host: string; home: string; web: string | null;
};

/**
 * Env proses anak. `HANOMAN_SUPERVISOR=1` disuntik DI SINI dan hanya di sini — ia satu-satunya
 * bukti bahwa ada yang akan menghidupkan server lagi, dan server memakainya untuk memutuskan
 * apakah tombol update boleh ada.
 */
export function serverEnv(o: ServerEnvInput): Record<string, string> {
  return {
    NODE_ENV: "production",
    DATABASE_URL: o.dbUrl,
    PORT: String(o.port),
    HOST: o.host,
    HANOMAN_HOME: o.home,
    HANOMAN_SUPERVISOR: "1",
    ...(o.web ? { HANOMAN_WEB_DIR: o.web } : {}),
  };
}

export type InstallOutcome = { ok: true } | { ok: false; reason: string };

/** `npm i -g hanoman@latest`. Tak pernah melempar — kegagalannya data, bukan crash. */
export function installLatest(): InstallOutcome {
  try { execFileSync("npm", [...INSTALL_ARGS], { stdio: "inherit" }); return { ok: true }; }
  catch (e) { return { ok: false, reason: (e as Error).message || "npm i -g gagal" }; }
}

/**
 * Satu putaran hidup server anak. Listener sinyal DIPASANG DAN DILEPAS per putaran: di dalam loop
 * supervisor, memasangnya tanpa melepas akan menumpuk listener tiap restart sampai node
 * memperingatkan kebocoran.
 */
function runServer(serverJs: string, env: Record<string, string>): Promise<number> {
  const child = spawn(process.execPath, [serverJs], { stdio: "inherit", env: { ...process.env, ...env } });
  const fwd = (sig: NodeJS.Signals) => () => child.kill(sig);
  const handlers = (["SIGINT", "SIGTERM"] as const).map((sig) => [sig, fwd(sig)] as const);
  for (const [sig, h] of handlers) process.on(sig, h);
  return new Promise<number>((res) => child.on("exit", (code) => {
    for (const [sig, h] of handlers) process.off(sig, h);
    res(code ?? 0);
  }));
}
```

3. Ganti ekor `start()` (mulai dari `const child = spawn(...)`, baris 226–235) dengan loop:

```ts
  const env = serverEnv({ dbUrl, port, host, home, web: layout.web ?? null });

  let restartsUsed = 0;
  for (;;) {
    const code = await runServer(layout.server, env);
    const step = planSupervisorStep(code, restartsUsed);
    if (step.action === "exit") {
      if (code === UPDATE_RESTART_EXIT) {
        ctx.stderr(`hanoman: jatah update-restart (${MAX_UPDATE_RESTARTS}) habis — keluar tanpa memasang\n`);
      }
      return step.code;
    }

    restartsUsed++;
    ctx.stdout(`hanoman · memasang versi terbaru dari npm (${restartsUsed}/${MAX_UPDATE_RESTARTS})\n`);
    const res = installLatest();
    if (!res.ok) {
      // Instance tak boleh mati permanen gara-gara registry down atau izin `sudo`: kembalikan
      // versi yang sudah ada dan katakan kenapa.
      ctx.stderr(`hanoman: update gagal — ${res.reason}\n`);
      ctx.stdout("hanoman · menjalankan ulang versi yang ada\n");
      continue;
    }

    // `prisma generate` TANPA cek dulu. `ensurePrismaClient` memeriksa dengan
    // `await import("@prisma/client")`, dan modul itu sudah ter-cache di proses ini sejak boot —
    // pemeriksaan kedua akan menjawab "siap" memakai modul LAMA sekalipun paketnya baru saja
    // diganti di disk. Kelas jebakan yang sama dengan `existsSync` di ADR-0087.
    try { runPrisma(["generate", "--schema", layout.schema], dbUrl); }
    catch { ctx.stderr("hanoman: `prisma generate` sesudah update gagal — lanjut; server anak yang akan mengeluh\n"); }

    if (opts.migrate) {
      // Migrasi gagal DITANGGAPI KERAS (beda dari install gagal): menjalankan bundle baru di atas
      // skema lama menukar downtime dengan kesalahan data, dan itu pertukaran yang buruk.
      try { applyMigrations(layout.schema, dbUrl); }
      catch (e) {
        const hint = migrateFailureHint(String((e as { output?: string }).output ?? ""), dbFilePath(dbUrl));
        ctx.stderr(hint ? `\n${hint}\n` : "hanoman: migrasi sesudah update gagal — lihat keluaran di atas\n");
        return 1;
      }
    }
    ctx.stdout("hanoman · terpasang; menjalankan ulang\n");
  }
```

> `layout.server` sengaja dipakai ulang apa adanya: `npm i -g` menimpa isi direktori paket global
> **di tempat**, jadi path yang sama kini menunjuk bundle baru. Batas yang diterima sadar: proses
> CLI ini sendiri tetap kode lama sampai `hanoman` dijalankan ulang manusia — lihat ADR-0088.

- [ ] **Step 4: Jalankan, pastikan LULUS**

Run: `pnpm vitest --run cli/test/start-args.test.ts && pnpm --filter ./cli typecheck`
Expected: PASS semua; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/start.ts cli/test/start-args.test.ts
git commit -m "feat(405): loop supervisor di hanoman start — exit 75 → npm i -g → generate → migrate → respawn"
```

---

### Task 6: Dashboard — tombol "Pasang & mulai ulang" dengan konfirmasi

**Files:**
- Modify: `src/src/api/update.ts`, `src/src/screens/UpdateIndicator.tsx`
- Test: `src/test/update.test.ts` (modify), `src/test/update-indicator.test.tsx` (modify)

**Interfaces:**
- Consumes: `UpdateStatus.canApply` (Task 1); endpoint Task 3.
- Produces:
  - `type ApplyOutcome = { kind: "confirm"; liveSessions: number; from: string; to: string | null } | { kind: "accepted"; from: string; to: string | null; liveSessions: number } | { kind: "error"; message: string }`
  - `applyUpdate(confirm: boolean): Promise<ApplyOutcome>`
  - `applyConfirmMessage(liveSessions: number): string`
  - `applyErrorMessage(code: string): string`

- [ ] **Step 1: Tulis test yang gagal**

Tambah ke `src/test/update.test.ts` (perluas import baris 2):

```ts
import {
  updateHeadline, updateBadgeLabel, updateVersionLine,
  applyConfirmMessage, applyErrorMessage,
} from "../src/api/update";

describe("applyConfirmMessage (SPEC-405 · ADR-0088)", () => {
  it("tanpa sesi hidup: menyebut tak ada yang berjalan", () => {
    expect(applyConfirmMessage(0)).toMatch(/tak ada sesi/i);
  });
  it("ada sesi: menyebut jumlahnya DAN bahwa sesi selamat", () => {
    const s = applyConfirmMessage(3);
    expect(s).toContain("3");
    expect(s).toMatch(/tetap hidup/i);
    expect(s).toMatch(/tmux/i);
  });
  it("satu sesi tetap menyebut angkanya", () => {
    expect(applyConfirmMessage(1)).toContain("1");
  });
});

describe("applyErrorMessage (SPEC-405 · ADR-0088)", () => {
  it("unsupervised menjelaskan sebabnya, bukan kode mentah", () => {
    expect(applyErrorMessage("unsupervised")).toMatch(/hanoman start/);
  });
  it("up-to-date terbaca manusia", () => {
    expect(applyErrorMessage("up-to-date")).toMatch(/terkini/i);
  });
  it("kode tak dikenal tetap tampil, jangan ditelan", () => {
    expect(applyErrorMessage("bad-body")).toContain("bad-body");
  });
});
```

Perbarui `mk()` di berkas itu agar memuat `canApply: false` (TS strict akan menuntutnya):

```ts
const mk = (o: Partial<UpdateStatus>): UpdateStatus => ({
  currentVersion: "0.1.0", latestVersion: "0.1.0",
  registry: { status: "ok", checkedAt: null }, updateAvailable: false, command: "", canApply: false, ...o,
});
```

Ganti isi `src/test/update-indicator.test.tsx` dengan versi yang menguji mesin keadaan:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UpdateStatus } from "@hanoman/shared";

// Badge self-fetch via useUpdate(); pakai nilai tetap agar render deterministik (pola limit-indicator).
let hook: UpdateStatus;
const applySpy = vi.fn();
vi.mock("../src/api/update", async (orig) => ({
  ...(await orig<typeof import("../src/api/update")>()),
  useUpdate: () => hook,
  applyUpdate: (confirm: boolean) => applySpy(confirm),
}));
import { UpdateBadge } from "../src/screens/UpdateIndicator";

const mk = (o: Partial<UpdateStatus>): UpdateStatus => ({
  currentVersion: "0.1.0", latestVersion: "0.1.0",
  registry: { status: "ok", checkedAt: null }, updateAvailable: false, command: "", canApply: false, ...o,
});
const avail = (o: Partial<UpdateStatus> = {}) =>
  mk({ updateAvailable: true, latestVersion: "0.2.0", command: "npm i -g hanoman@latest", ...o });

beforeEach(() => applySpy.mockReset());

describe("UpdateBadge", () => {
  it("tak render saat up-to-date", () => {
    hook = mk({});
    const { container } = render(<UpdateBadge />);
    expect(container.firstChild).toBeNull();
  });

  it("render pill + popover + perintah npm saat versi baru terbit", () => {
    hook = avail();
    render(<UpdateBadge />);
    const btn = screen.getByTitle("Update tersedia");
    expect(btn.textContent).toContain("Update · 0.2.0");
    fireEvent.click(btn);
    expect(screen.getByText(/hanoman 0\.2\.0 tersedia/)).toBeTruthy();
    expect(screen.getByText(/npm i -g hanoman@latest/)).toBeTruthy();
    expect(screen.getByText(/terpasang 0\.1\.0 · tersedia 0\.2\.0/)).toBeTruthy();
  });

  it("canApply false → tombol pasang TIDAK ada, perintah salin tetap ada", () => {
    hook = avail({ canApply: false });
    render(<UpdateBadge />);
    fireEvent.click(screen.getByTitle("Update tersedia"));
    expect(screen.queryByText("Pasang & mulai ulang")).toBeNull();
    expect(screen.getByText(/npm i -g hanoman@latest/)).toBeTruthy();
  });

  it("klik pertama TIDAK pernah mengirim confirm — ia meminta jumlah sesi dulu", async () => {
    hook = avail({ canApply: true });
    applySpy.mockResolvedValueOnce({ kind: "confirm", liveSessions: 2, from: "0.1.0", to: "0.2.0" });
    render(<UpdateBadge />);
    fireEvent.click(screen.getByTitle("Update tersedia"));
    fireEvent.click(screen.getByText("Pasang & mulai ulang"));
    await waitFor(() => expect(screen.getByText(/2 sesi sedang berjalan/)).toBeTruthy());
    expect(applySpy).toHaveBeenCalledWith(false);
  });

  it("klik kedua mengirim confirm lalu masuk keadaan memasang", async () => {
    hook = avail({ canApply: true });
    applySpy
      .mockResolvedValueOnce({ kind: "confirm", liveSessions: 0, from: "0.1.0", to: "0.2.0" })
      .mockResolvedValueOnce({ kind: "accepted", liveSessions: 0, from: "0.1.0", to: "0.2.0" });
    render(<UpdateBadge />);
    fireEvent.click(screen.getByTitle("Update tersedia"));
    fireEvent.click(screen.getByText("Pasang & mulai ulang"));
    await waitFor(() => expect(screen.getByText("Ya, pasang")).toBeTruthy());
    fireEvent.click(screen.getByText("Ya, pasang"));
    await waitFor(() => expect(screen.getByText(/Memasang/)).toBeTruthy());
    expect(applySpy).toHaveBeenNthCalledWith(2, true);
  });

  it("Batal kembali ke keadaan awal tanpa mengirim apa pun lagi", async () => {
    hook = avail({ canApply: true });
    applySpy.mockResolvedValueOnce({ kind: "confirm", liveSessions: 1, from: "0.1.0", to: "0.2.0" });
    render(<UpdateBadge />);
    fireEvent.click(screen.getByTitle("Update tersedia"));
    fireEvent.click(screen.getByText("Pasang & mulai ulang"));
    await waitFor(() => expect(screen.getByText("Batal")).toBeTruthy());
    fireEvent.click(screen.getByText("Batal"));
    expect(screen.getByText("Pasang & mulai ulang")).toBeTruthy();
    expect(applySpy).toHaveBeenCalledTimes(1);
  });

  it("error dari server ditampilkan apa adanya", async () => {
    hook = avail({ canApply: true });
    applySpy.mockResolvedValueOnce({ kind: "error", message: "Versi terpasang ternyata sudah terkini." });
    render(<UpdateBadge />);
    fireEvent.click(screen.getByTitle("Update tersedia"));
    fireEvent.click(screen.getByText("Pasang & mulai ulang"));
    await waitFor(() => expect(screen.getByText(/sudah terkini/)).toBeTruthy());
  });
});
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `env -u NODE_ENV pnpm vitest --run src/test/update.test.ts src/test/update-indicator.test.tsx`
Expected: FAIL — `applyConfirmMessage`/`applyErrorMessage`/tombol belum ada.

> `env -u NODE_ENV` wajib: `NODE_ENV=production` di shell membuat RTL `act` gagal (memory repo).

- [ ] **Step 3a: `src/src/api/update.ts`**

Perbarui literal default dan tambahkan blok apply di akhir berkas:

```ts
const UP_TO_DATE: UpdateStatus = {
  currentVersion: "", latestVersion: null,
  registry: { status: "unavailable", checkedAt: null },
  updateAvailable: false, command: "", canApply: false,
};
```

```ts
// ── SPEC-405 · ADR-0088 · memasang lalu menjalankan ulang dari dashboard ────────────────────────
export type ApplyOutcome =
  | { kind: "confirm"; liveSessions: number; from: string; to: string | null }
  | { kind: "accepted"; liveSessions: number; from: string; to: string | null }
  | { kind: "error"; message: string };

/**
 * Sengaja TIDAK lewat `api` client: helper `j<T>` di sana melempar untuk setiap non-2xx, sedangkan
 * `409 confirm-required` di sini BUKAN kegagalan — ia langkah pertama alur konfirmasi, dan isinya
 * (jumlah sesi hidup) justru yang dibutuhkan untuk memutuskan.
 */
export async function applyUpdate(confirm: boolean): Promise<ApplyOutcome> {
  let res: Response;
  try {
    res = await fetch("/api/update/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm }),
    });
  } catch { return { kind: "error", message: "Server tak terjangkau." }; }

  let b: Record<string, unknown> = {};
  try { b = (await res.json()) as Record<string, unknown>; } catch { /* body kosong: pakai status */ }

  const from = String(b.from ?? "");
  const to = (b.to as string | null | undefined) ?? null;
  const live = Number(b.liveSessions ?? 0);

  if (res.status === 202) return { kind: "accepted", liveSessions: live, from, to };
  if (res.status === 409 && b.error === "confirm-required")
    return { kind: "confirm", liveSessions: live, from, to };
  return { kind: "error", message: applyErrorMessage(String(b.error ?? res.status)) };
}

/** Kode error server → kalimat yang bisa ditindaklanjuti. Kode tak dikenal tetap ditampilkan. */
export function applyErrorMessage(code: string): string {
  if (code === "unsupervised")
    return "Instance ini tidak dijalankan lewat `hanoman start`, jadi tak ada yang akan menghidupkannya lagi — pasang manual dengan perintah di atas.";
  if (code === "up-to-date") return "Versi terpasang ternyata sudah terkini.";
  return `Gagal memulai update (${code}).`;
}

/**
 * Kalimat konfirmasi. Ia menyebut fakta yang menenangkan sekaligus benar: pane tmux beserta agen di
 * dalamnya SELAMAT dari restart (ADR-0016) — yang terputus hanya jembatan terminalnya, beberapa
 * detik, dan dashboard menyambung ulang sendiri.
 */
export function applyConfirmMessage(liveSessions: number): string {
  if (liveSessions <= 0) return "Pasang versi baru lalu jalankan ulang hanoman? Tak ada sesi yang sedang berjalan.";
  return `${liveSessions} sesi sedang berjalan. Sesi itu tetap hidup di tmux dan terminalnya tersambung lagi sendiri. Lanjutkan?`;
}
```

- [ ] **Step 3b: `src/src/screens/UpdateIndicator.tsx`**

Perluas import baris 3 dan sisipkan mesin keadaan. Ganti seluruh isi berkas:

```tsx
import React from "react";
import { Icon } from "../ds/icon";
import {
  useUpdate, updateHeadline, updateBadgeLabel, updateVersionLine,
  applyUpdate, applyConfirmMessage, type ApplyOutcome,
} from "../api/update";

// Badge topbar — muncul HANYA saat updateAvailable (up-to-date: tanpa noise). Klik → popover berisi
// versi baru + perintah update (Salin).
// SPEC-405 · ADR-0088 · bila proses server ini punya supervisor (`canApply`), popover juga membawa
// tombol "Pasang & mulai ulang": dua langkah, karena klik pertama hanya MEMINTA laporan berapa sesi
// yang sedang berjalan. Perintah salin tetap ada di semua keadaan — ia satu-satunya jalan saat
// `canApply` false.
type Phase =
  | { t: "idle" }
  | { t: "asking" }
  | { t: "confirming"; message: string }
  | { t: "applying" }
  | { t: "failed"; message: string };

const btn: React.CSSProperties = {
  padding: "5px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-hair)",
  background: "var(--bone-100)", cursor: "pointer", fontSize: 11,
};
const btnPrimary: React.CSSProperties = {
  ...btn, background: "var(--brass-100)", color: "var(--brass-700)",
  border: "1px solid var(--brass-300, var(--border-hair))",
};

export function UpdateBadge() {
  const u = useUpdate();
  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [phase, setPhase] = React.useState<Phase>({ t: "idle" });
  if (!u.updateAvailable) return null;
  const copy = () => {
    try { void navigator.clipboard?.writeText(u.command); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard tak tersedia */ }
  };
  const send = async (confirm: boolean) => {
    setPhase({ t: confirm ? "applying" : "asking" });
    const r: ApplyOutcome = await applyUpdate(confirm);
    if (r.kind === "confirm") setPhase({ t: "confirming", message: applyConfirmMessage(r.liveSessions) });
    else if (r.kind === "accepted") setPhase({ t: "applying" });
    else setPhase({ t: "failed", message: r.message });
  };
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((v) => !v)} title="Update tersedia"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px",
          borderRadius: "var(--radius-pill, 999px)", border: "1px solid var(--brass-300, var(--border-hair))",
          background: "var(--brass-100)", color: "var(--brass-700)", cursor: "pointer",
          fontFamily: "var(--font-mono)", fontSize: 12 }}>
        <Icon name="arrow-up-circle" size={13} color="var(--brass-700)" />
        {updateBadgeLabel(u)}
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 40, width: 320,
          background: "var(--surface-card)", border: "1px solid var(--border-hair)",
          borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-pop, 0 8px 24px rgba(0,0,0,.12))", padding: 14 }}>
          <div className="hn-eyebrow" style={{ marginBottom: 8 }}>Update tersedia</div>
          <div style={{ fontSize: "var(--text-sm)", color: "var(--text-body)", marginBottom: 10 }}>{updateHeadline(u)}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <code style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 11, background: "var(--bone-100)",
              padding: "6px 8px", borderRadius: "var(--radius-sm)", overflowX: "auto", whiteSpace: "nowrap" }}>{u.command}</code>
            <button onClick={copy} title="Salin perintah" style={btn}>{copied ? "Tersalin" : "Salin"}</button>
          </div>
          {u.canApply && (
            <div style={{ marginBottom: 8 }}>
              {phase.t === "idle" && (
                <button onClick={() => void send(false)} style={btnPrimary}>Pasang & mulai ulang</button>
              )}
              {phase.t === "asking" && (
                <div style={{ fontSize: 11, color: "var(--text-subtle)" }}>Memeriksa sesi yang berjalan…</div>
              )}
              {phase.t === "confirming" && (
                <>
                  <div style={{ fontSize: 11, color: "var(--text-body)", marginBottom: 8 }}>{phase.message}</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => void send(true)} style={btnPrimary}>Ya, pasang</button>
                    <button onClick={() => setPhase({ t: "idle" })} style={btn}>Batal</button>
                  </div>
                </>
              )}
              {phase.t === "applying" && (
                <div style={{ fontSize: 11, color: "var(--text-body)" }}>
                  Memasang dari npm lalu menjalankan ulang — dashboard tersambung lagi sendiri.
                </div>
              )}
              {phase.t === "failed" && (
                <>
                  <div style={{ fontSize: 11, color: "var(--status-err-text, var(--text-body))", marginBottom: 8 }}>{phase.message}</div>
                  <button onClick={() => setPhase({ t: "idle" })} style={btn}>Coba lagi</button>
                </>
              )}
            </div>
          )}
          <div style={{ fontSize: 11, color: "var(--text-subtle)" }}>{updateVersionLine(u)}</div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Jalankan, pastikan LULUS**

Run: `env -u NODE_ENV pnpm vitest --run src/test/update.test.ts src/test/update-indicator.test.tsx && pnpm --filter ./src typecheck`
Expected: PASS semua; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/src/api/update.ts src/src/screens/UpdateIndicator.tsx src/test/update.test.ts src/test/update-indicator.test.tsx
git commit -m "feat(405): tombol Pasang & mulai ulang di UpdateBadge — dua langkah, digerbangi canApply"
```

---

### Task 7: Docs — ADR-0088 + index + kontrak API + runbook

**Files:**
- Create: `internal/docs/adr/0088-tombol-update-npm-restart-tersupervisi.md`
- Modify: `internal/docs/README.md`, `internal/docs/adr/README.md`, `internal/docs/architecture/api-contract.md`, `internal/docs/operations/npm-readme.md`, `internal/docs/operations/deploy-vps.md`, `internal/skills/hanoman/SKILL.md`

**Interfaces:**
- Consumes: keputusan Task 1–6 (nama endpoint, env, exit code — kutip persis).
- Produces: ADR-0088 sebagai rujukan permanen; entri index di **dua** tempat (index utama + sub-index — SPEC-386 menuntut keduanya).

- [ ] **Step 1: Tulis ADR-0088**

Buat `internal/docs/adr/0088-tombol-update-npm-restart-tersupervisi.md` dengan isi berikut:

```markdown
# ADR-0088 — Tombol update dari dashboard: server keluar, supervisor memasang

- Status: Accepted
- Tanggal: 2026-07-30
- SPEC: SPEC-405
- Terkait: **mengamandemen [0048](0048-auto-update-deteksi-read-only.md)** (memenuhi syarat yang
  ADR itu sendiri tetapkan: "butuh ADR baru + supervisor") dan **membalik satu alternatif yang
  ditolak [0087](0087-distribusi-npm-global-satu-perintah.md)**; bersandar pada
  [0016](0016-sesi-terminal-hidup-di-tmux.md) (tmux menahan sesi lintas restart API); mempersempit
  permukaan [0065](0065-ai-agent-capability-agent-token.md); **tidak menyentuh**
  [0037](0037-cabut-guardrail-safety.md) maupun skema apa pun.

## Konteks

ADR-0048 memutuskan panel update **read-only**: server mendeteksi, tak pernah memasang. ADR-0087
mengulanginya untuk distribusi npm dan menolak `POST /api/update/apply` secara eksplisit sebagai
alternatif, dengan alasan server yang memasang paket di bawah dirinya sendiri "harus mematikan
dirinya untuk memakainya — sementara sesi agen berjalan di tmux".

Dua premis itu sudah berubah, dan keduanya bisa diperiksa di kode:

1. **Supervisornya sudah ada, dibawa ADR-0087 sendiri.** `hanoman start` men-`spawn`
   `node dist/server.js` sebagai proses **anak** lalu `await` exit-nya. ADR-0048 menutup pintunya
   dengan syarat — "butuh ADR baru **+ supervisor (systemd/pm2/wrapper)**" — dan wrapper itu kini
   bagian dari produk.
2. **"Akan memutus sesi tmux" tidak akurat.** `pty.ts` memakai `tmux new-session -d` di socket
   `hanoman`: tmux adalah **daemon**, bukan anak proses server. Itu persis janji ADR-0016. Yang
   putus saat restart hanyalah jembatan `tmux attach` di atas node-pty dan WebSocket-nya, dan
   klien sudah menyambung ulang dengan backoff.

## Keputusan

**`POST /api/update/apply` sah — dan server tetap tidak memasang apa pun.** Server hanya **keluar
dengan kode sentinel `UPDATE_RESTART_EXIT = 75`**. Yang menjalankan `npm i -g hanoman@latest`,
`prisma generate`, `migrate deploy`, lalu men-spawn server lagi adalah CLI parent.

Pembagian ini menjaga ADR-0048 pada intinya: server menyatakan "aku minta diganti"; pemasangnya
proses lain, yang memang hidup justru untuk itu.

1. **Supervised-only.** Endpoint & tombol hanya sah bila `process.env.HANOMAN_SUPERVISOR === "1"`,
   yang **hanya** disuntikkan `serverEnv()` di `cli/src/commands/start.ts`. Diekspor ke klien
   sebagai `UpdateStatus.canApply`. Di `pnpm dev`, bundle server telanjang, atau supervisor pihak
   ketiga yang memanggil `dist/server.js` langsung, panel tetap read-only persis seperti sebelumnya.
   **Dibaca dari `process.env` langsung, bukan `effectiveBool()`** — `effectiveBool` membaca cache
   config DB lebih dulu, jadi memakainya berarti siapa pun yang bisa menulis config bisa mengaku
   disupervisi, dan tombolnya lalu mematikan instance yang tak akan pernah hidup lagi.
2. **Dua langkah, satu endpoint.** Tanpa `confirm` ia **dry-run**: `409 confirm-required` +
   jumlah sesi hidup + `from`/`to`. Dengan `confirm: true` ia `202` lalu keluar. Sesi hidup **tidak
   memblokir** apa pun di server — manusia yang memutuskan (aturan produk hanoman); server hanya
   menyatakan berapa banyak. Jumlah itu **tidak** ditaruh di `UpdateStatus`: grup siar `update`
   di-recompute tiap 300 tick, dan angka basi pada dialog risiko lebih buruk daripada tak ada angka.
   `canApply` sebaliknya konstan seumur proses, jadi ia aman di frame siar.
3. **Urutan supervisor yang mengikat.** Install gagal → **tidak fatal**: alasan dicetak dan versi
   yang ada dijalankan ulang; instance tak pernah mati permanen gara-gara registry down atau izin
   `sudo`. Install sukses → `prisma generate` **tanpa cek dulu**, lalu `migrate deploy`, lalu spawn.
   Migrasi gagal **ditanggapi keras** (keluar 1): menjalankan bundle baru di atas skema lama menukar
   downtime dengan kesalahan data.
4. **Jatah `MAX_UPDATE_RESTARTS = 5`** per proses `hanoman start`. Aksinya dipicu manusia, jadi loop
   tak berujung bukan mode kegagalan otomatis — tapi batasnya murah, dan saat habis alasannya
   **dicetak** (jangan pernah membatasi diam-diam).
5. **Lubang capability ditutup bersamaan.** `capabilityForRoute` memetakan `top === "update"` ke
   `GLOBAL_READ` **tanpa melihat method**, dan `checkAgentCapability` meloloskan `GLOBAL_READ` tanpa
   syarat. Tanpa perbaikan, `POST /update/apply` berarti **setiap agent token — capability apa pun —
   bisa me-restart instance operator**. Kini prefix status (`update`/`limits`/`events`/`fs`/`health`)
   menghasilkan `GLOBAL_READ` hanya untuk method baca; selain itu `COOKIE_ONLY` → 403.

## Gotcha yang dijaga kode, bukan disiplin

- **`prisma generate` dijalankan tanpa cek dulu.** `ensurePrismaClient` memeriksa dengan
  `await import("@prisma/client")`, dan modul itu sudah ter-cache di proses supervisor sejak boot —
  pemeriksaan kedua akan menjawab "siap" memakai modul **lama** sekalipun paketnya baru saja diganti
  di disk. Kelas jebakan yang sama dengan `existsSync` di ADR-0087: cek yang tak bisa membedakan
  berhasil dari gagal.
- **Listener sinyal dilepas tiap putaran.** Loop yang memasang `SIGINT`/`SIGTERM` tanpa `process.off`
  menumpuk listener tiap restart sampai node memperingatkan kebocoran.
- **`confirm` wajib boolean.** `zUpdateApplyBody` menolak `"ya"`/`1` — string non-kosong yang
  terbaca truthy adalah cara paling murah untuk kehilangan langkah konfirmasi tanpa sadar.

## Konsekuensi

- Update jadi satu klik: badge → "Pasang & mulai ulang" → konfirmasi → instance kembali dengan versi
  baru. `hanoman update` di CLI tetap ada dan tak berubah.
- **Proses CLI supervisor tetap kode versi lama** sampai `hanoman` dijalankan ulang manusia. Semua
  fitur produk hidup di server/web/migrasi, jadi ini tak berpengaruh dalam pemakaian normal; yang
  tak ikut ter-update hanyalah supervisor itu sendiri (parse argumen, `resolveLayout`, loop).
  Bila rilis baru memindahkan tata letak paket, parent lama gagal menemukan `layout.server` dan
  **mengatakannya** — bukan gagal senyap. Alternatif "parent men-spawn `hanoman` baru lewat PATH lalu
  memproksikan sinyal" ditolak: ia menumpuk satu proses node per update dan menggandakan jalur
  penanganan sinyal.
- Di bawah systemd, `ExecStart=/usr/bin/env hanoman` berarti supervisornya CLI ini — systemd tak
  pernah melihat exit 75, dan unit yang sudah didokumentasikan tak perlu diubah.
- Tanpa perubahan skema, tanpa migration, tanpa knob `Setting` baru, tanpa menyentuh mesin sesi.

## Alternatif yang ditolak

- **Server memanggil `npm i -g` sendiri lalu keluar.** Menjadikan server pemasang perangkat lunak
  (persis yang ADR-0048 tolak) dan membuat kegagalan install terjadi di proses yang sedang bunuh
  diri — tak ada yang tersisa untuk melaporkannya.
- **Tombol tanpa syarat supervisi.** Di `pnpm dev` atau bundle telanjang ia mematikan instance yang
  tak akan pernah hidup lagi.
- **Blokir tombol selama ada sesi hidup.** Premisnya salah — sesi memang selamat — dan di mesin yang
  menjalankan beberapa sesi sekaligus artinya tombolnya nyaris tak pernah bisa dipakai.
- **`liveSessions` di `UpdateStatus`.** Frame siarnya 300 detik sekali; angka basi pada dialog risiko
  lebih buruk daripada tak ada angka.
```

- [ ] **Step 2: Taut di KEDUA index (SPEC-386)**

Di `internal/docs/README.md`, sisipkan sebagai baris pertama daftar `## adr` (di atas 0087):

```markdown
- [0088 — Tombol update dari dashboard: server keluar dengan sentinel, supervisor `hanoman start` yang memasang](adr/0088-tombol-update-npm-restart-tersupervisi.md)
```

Di `internal/docs/adr/README.md`, sisipkan sebagai entri pertama daftar (di atas 0087):

```markdown
- [0088 — Tombol update dari dashboard: server keluar, supervisor memasang](0088-tombol-update-npm-restart-tersupervisi.md) — **mengamandemen 0048** (memenuhi syarat yang ADR itu sendiri tetapkan: "butuh ADR baru + supervisor") dan **membalik satu alternatif yang ditolak 0087**, bersandar pada **0016**, mempersempit permukaan **0065** (SPEC-405): `POST /api/update/apply` sah, tapi **server tetap tak memasang apa pun** — ia hanya keluar dengan `UPDATE_RESTART_EXIT = 75`, dan CLI parent `hanoman start` (yang sejak 0087 memang sudah men-spawn server sebagai proses ANAK) yang menjalankan `npm i -g hanoman@latest` → `prisma generate` → `migrate deploy` → spawn lagi dari path yang sama (isinya sudah tertimpa `npm i -g` di tempat). **Supervised-only**: digerbangi `process.env.HANOMAN_SUPERVISOR === "1"` yang HANYA disuntik `serverEnv()` di `cli/src/commands/start.ts`, diekspor sebagai `UpdateStatus.canApply` — dibaca dari `process.env` LANGSUNG, bukan `effectiveBool()` (yang membaca cache config DB lebih dulu, sehingga siapa pun yang bisa menulis config bisa mengaku disupervisi). **Dua langkah, satu endpoint**: tanpa `confirm` ia dry-run `409 confirm-required` + jumlah sesi hidup yang dihitung SAAT ITU (bukan dari frame siar `update` yang di-recompute tiap 300 tick — angka basi pada dialog risiko lebih buruk daripada tak ada angka); sesi hidup tak memblokir apa pun di server. Premis penolakan 0087 ("akan memutus sesi tmux") **tidak akurat**: `pty.ts` memakai `tmux new-session -d`, tmux adalah daemon — yang putus hanya jembatan `tmux attach` + WebSocket, dan klien sudah reconnect ber-backoff. **Install gagal tidak fatal** (respawn versi lama + cetak alasan); **migrasi gagal fatal** (bundle baru di atas skema lama = menukar downtime dengan kesalahan data); jatah `MAX_UPDATE_RESTARTS = 5` dengan alasan **dicetak** saat habis. **Lubang capability ditutup bersamaan**: `capabilityForRoute` dulu memetakan `update`/`limits`/`events`/`fs`/`health` ke `GLOBAL_READ` **tanpa melihat method**, jadi `POST /update/apply` akan lolos untuk **setiap** agent token — kini `GLOBAL_READ` hanya untuk method baca, selain itu `COOKIE_ONLY` → 403. **Gotcha:** `prisma generate` dijalankan **tanpa cek dulu** karena `@prisma/client` sudah ter-cache di proses supervisor sejak boot (pemeriksaan kedua menjawab "siap" memakai modul LAMA — kelas jebakan `existsSync` di 0087); listener sinyal wajib `process.off` tiap putaran; `confirm` wajib **boolean** (`"ya"` truthy = kehilangan langkah konfirmasi tanpa sadar). Konsekuensi yang diterima sadar: proses CLI supervisor sendiri tetap kode lama sampai `hanoman` dijalankan ulang manusia. Tanpa skema/migration/knob baru
```

- [ ] **Step 3: Perbaiki `api-contract.md`**

Entri `/update` di sana **masih berbentuk SHA milik SPEC-214** (`currentSha`, `checkoutSha`,
`behind`, `newCommits`) — usang sejak ADR-0087. Ganti empat baris itu:

```
GET      /update                        # UpdateStatus — status update dari registry npm. SPEC-214/398/405
#   UpdateStatus = { currentVersion, latestVersion|null, registry:{status:"ok"|"unavailable",checkedAt},
#                    updateAvailable, command, canApply }
#   updateAvailable = compareSemver(latest, current) > 0, sesudah GET <registry>/hanoman/latest (ter-gate HANOMAN_UPDATE_FETCH=1, TTL 5 mnt)
#   canApply        = proses server ini anak dari `hanoman start` (env HANOMAN_SUPERVISOR=1) — SPEC-405/ADR-0088
POST     /update/apply                  # { confirm?: boolean } — SPEC-405 · ADR-0088. Server TAK memasang apa pun:
#   ia keluar dengan UPDATE_RESTART_EXIT=75 dan supervisor `hanoman start` yang `npm i -g` lalu menjalankan ulang.
#   409 { error:"unsupervised" }                             — canApply false
#   409 { error:"up-to-date", current }                      — tak ada versi lebih baru
#   409 { error:"confirm-required", liveSessions, from, to } — dry-run; sesi hidup dihitung SAAT ITU, tak memblokir
#   202 { accepted:true, from, to, liveSessions }            — lalu proses keluar
#   agent token DITOLAK (403): prefix status hanya GLOBAL_READ untuk method baca
```

- [ ] **Step 4: Perbarui runbook & skill**

`internal/docs/operations/npm-readme.md` — ganti seluruh bagian `## Update` (baris 38–46):

```markdown
## Update

Dari dashboard: badge **Update** di kanan atas → **Pasang & mulai ulang** → konfirmasi. hanoman
memasang versi baru dari npm lalu menjalankan dirinya lagi; sesi agen yang sedang berjalan tetap
hidup di tmux dan terminalnya tersambung lagi sendiri (SPEC-405 · ADR-0088).

Tombol itu hanya muncul bila instance dijalankan lewat `hanoman` / `hanoman start` — proses itulah
yang memasang dan menghidupkannya kembali. Dijalankan dengan cara lain (mis. `node dist/server.js`
langsung), panel tetap hanya menampilkan perintah untuk disalin.

Dari terminal:

```bash
hanoman update            # npm i -g hanoman@latest
```

Sesudah `hanoman update`, instance yang berjalan perlu di-restart (mis. `systemctl restart hanoman`).
```

`internal/docs/operations/deploy-vps.md` — sisipkan sesudah paragraf penutup §4 (baris 125–127):

```markdown
`ExecStart=/usr/bin/env hanoman` berarti **supervisornya CLI hanoman itu sendiri**. Tombol
"Pasang & mulai ulang" di dashboard (SPEC-405 · ADR-0088) karena itu bekerja apa adanya di unit ini:
server keluar dengan kode 75, CLI memasang versi baru dari npm lalu men-spawn server lagi — systemd
tak pernah melihat restart itu dan tak perlu diubah. `Restart=on-failure` tetap jadi jaring pengaman
untuk kegagalan yang sebenarnya.
```

`internal/skills/hanoman/SKILL.md` — sisipkan butir baru di **Aturan Arsitektur**, tepat sesudah
butir "**Distribusi = paket npm global**":

```markdown
- **Update sekali klik, tapi server tetap tak memasang apa pun** (SPEC-405/ADR-0088, mengamandemen
  ADR-0048 & membalik satu alternatif yang ditolak ADR-0087): `POST /api/update/apply` hanya membuat
  proses server **keluar dengan `UPDATE_RESTART_EXIT = 75`**; yang menjalankan `npm i -g hanoman@latest`
  → `prisma generate` → `migrate deploy` → spawn lagi adalah **CLI parent `hanoman start`**, yang sejak
  ADR-0087 memang sudah men-spawn server sebagai proses ANAK. **Supervised-only**: digerbangi
  `process.env.HANOMAN_SUPERVISOR === "1"` yang HANYA disuntik `serverEnv()` di
  `cli/src/commands/start.ts` dan diekspor sebagai `UpdateStatus.canApply` — **dibaca dari
  `process.env` langsung, bukan `effectiveBool()`**, karena helper itu membaca cache config DB lebih
  dulu sehingga siapa pun yang bisa menulis config bisa mengaku disupervisi. Endpoint punya **dua
  langkah**: tanpa `confirm` ia dry-run `409 confirm-required` + jumlah sesi hidup yang dihitung saat
  itu juga (jumlah itu sengaja **tidak** masuk `UpdateStatus` — grup siar `update` di-recompute tiap
  300 tick); sesi hidup **tak memblokir** apa pun di server. Premis "restart memutus sesi tmux"
  **tidak akurat**: `pty.ts` memakai `tmux new-session -d`, tmux daemon terpisah — yang putus hanya
  jembatan `tmux attach` + WebSocket, dan klien sudah reconnect ber-backoff (ADR-0016). **Install
  gagal tak fatal** (respawn versi lama + cetak alasan), **migrasi gagal fatal**, jatah
  `MAX_UPDATE_RESTARTS = 5` dengan alasan dicetak saat habis. **Dua gotcha wajib:** `prisma generate`
  dijalankan **tanpa cek dulu** karena `@prisma/client` sudah ter-cache di proses supervisor sejak
  boot (`ensurePrismaClient` akan menjawab "siap" memakai modul LAMA — kelas jebakan `existsSync` di
  ADR-0087); dan `capabilityForRoute` dulu memetakan prefix status (`update`/`limits`/`events`/`fs`/
  `health`) ke `GLOBAL_READ` **tanpa melihat method**, jadi menambah endpoint tulis di bawahnya
  berarti setiap agent token bisa me-restart instance — kini `GLOBAL_READ` hanya untuk method baca.
```

- [ ] **Step 5: Verifikasi index & commit**

```bash
node cli/dist/hanoman.js docs index --check 2>/dev/null || pnpm --filter ./cli build && node cli/dist/hanoman.js docs index --check
git add internal/docs internal/skills
git commit -m "docs(405): ADR-0088 + index/sub-index + kontrak /update (perbaiki bentuk SHA usang) + runbook"
```

Expected: `docs index --check` exit 0 (semua doc ter-link).

---

### Task 8: Verifikasi akhir — test tersentuh, typecheck, dan smoke endpoint nyata

**Files:** tidak ada perubahan kode; task ini menutup Definition of Done.

**Interfaces:**
- Consumes: seluruh Task 1–7.

> **Kenapa scope-nya lebih luas dari biasa (ADR-0080).** `shared/src/dto.ts` diimpor hampir seluruh
> repo, jadi `vitest --changed` di sini mendekati suite penuh (terukur di SPEC-376: 217 berkas /
> 1589 test / 177 dtk). Itu blast radius yang **sebenarnya**, bukan pemborosan — dan karena set-nya
> menyentuh test server, `--no-file-parallelism` **wajib** (SPEC-397: set yang sama memberi 181 gagal
> palsu paralel vs 736 lulus serial).

- [ ] **Step 1: Test yang tersentuh, SERIAL**

Run:
```bash
env -u NODE_ENV -u DATABASE_URL pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism
```
Expected: PASS. **Jangan menerima "no test files" sebagai bukti** — `--changed` menyalakan
`passWithNoTests`. Pastikan jumlah berkas test yang berjalan > 0 dan memuat
`update.route.test.ts`, `update-restart.test.ts`, `start-args.test.ts`, `update-indicator.test.tsx`,
`agent-capabilities.test.ts`.

- [ ] **Step 2: Typecheck paket yang tersentuh (berurutan, bukan `-r`)**

Run:
```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck && pnpm --filter ./cli typecheck && pnpm --filter ./src typecheck
```
Expected: keempatnya exit 0.

- [ ] **Step 3: Smoke endpoint nyata — keempat balasan**

Task ini menyentuh endpoint, jadi uji sungguhan sekali di akhir. Boot server dari worktree ini
dengan DB & port khusus supaya tak menabrak instance atau sesi tetangga:

```bash
pnpm build
SMOKE_DB="$PWD/.smoke-405.db"
env -u NODE_ENV DATABASE_URL="file:$SMOKE_DB" HANOMAN_HOME="$PWD/.smoke-405-home" \
  npx prisma migrate deploy --schema server/prisma/schema.prisma
env HANOMAN_AUTH_DISABLED=1 HANOMAN_SUPERVISOR=1 PORT=8799 \
  DATABASE_URL="file:$SMOKE_DB" HANOMAN_HOME="$PWD/.smoke-405-home" \
  node server/dist/server.js &
sleep 3
curl -s localhost:8799/api/update | head -c 400 ; echo
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:8799/api/update/apply \
  -H 'content-type: application/json' -d '{}'
```

Expected:
- `GET /api/update` → JSON memuat `"canApply":true`.
- `POST /api/update/apply` `{}` → **409** (`up-to-date`, karena registry tak dihubungi tanpa
  `HANOMAN_UPDATE_FETCH=1` — itu balasan yang benar, dan membuktikan endpoint terpasang & bergerbang).

Lalu ulangi tanpa `HANOMAN_SUPERVISOR` untuk membuktikan gerbangnya:

```bash
lsof -ti:8799 | xargs -r kill        # per-PID, JANGAN pkill -f
env HANOMAN_AUTH_DISABLED=1 PORT=8799 DATABASE_URL="file:$SMOKE_DB" \
  HANOMAN_HOME="$PWD/.smoke-405-home" node server/dist/server.js &
sleep 3
curl -s localhost:8799/api/update | grep -o '"canApply":[a-z]*'
curl -s -X POST localhost:8799/api/update/apply -H 'content-type: application/json' -d '{"confirm":true}'
lsof -ti:8799 | xargs -r kill
rm -rf "$SMOKE_DB" "$PWD/.smoke-405-home"
```

Expected: `"canApply":false` dan `{"error":"unsupervised"}`.

> **Jangan `pkill -f node`/`pkill -f vitest`** (SPEC-402/AGENTS.md): pola itu mencocoki agen sesi
> tetangga di mesin ini dan `pkill` mengecualikan leluhurnya sendiri, jadi yang mati selalu sesi
> orang lain. Bunuh per-PID lewat `lsof -ti:<port>`.

- [ ] **Step 4: Pastikan diff bersih & tak ada artefak smoke tertinggal**

```bash
git status --porcelain
```
Expected: kosong (semua sudah ter-commit; `.smoke-405*` sudah dihapus di Step 3).

- [ ] **Step 5: Push**

```bash
git push origin HEAD:refs/heads/hanoman/spec-405
```
Expected: branch terdorong (worktree ini detached HEAD — memang disengaja).

---

## Self-Review

**Spec coverage:** §1 sentinel & penanda supervisi → Task 1 + 2 + 5. §2 endpoint dua langkah →
Task 3. §3 lubang capability → Task 4. §4 loop supervisor → Task 5. §5 UI → Task 6. Tabel "Yang
berubah" → Task 1–6, docs → Task 7. Pengujian → tersebar di tiap task + Task 8.

**Type consistency:** `UPDATE_RESTART_EXIT` (shared) dipakai identik di Task 2/3/5. `canApply`
dipakai identik di Task 1/2/3/6. `applyUpdate`/`applyConfirmMessage`/`applyErrorMessage`/
`ApplyOutcome` didefinisikan di Task 6 Step 3a dan dipakai di Step 3b dengan nama yang sama.
`serverEnv`/`planSupervisorStep`/`MAX_UPDATE_RESTARTS`/`installLatest` didefinisikan dan dipakai
seluruhnya di Task 5. `__setExiter(null)` menerima `null` di Task 2 dan dipakai begitu di Task 3.
