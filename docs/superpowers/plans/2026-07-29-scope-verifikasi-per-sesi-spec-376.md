# Scope Verifikasi Per Sesi (SPEC-376) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat "seberapa luas sesi memverifikasi" jadi properti sesi yang eksplisit (`verifyScope: changed | full`, default `changed`), supaya sesi menguji berkas yang berubah saja alih-alih seluruh project — RAM & CPU mesin tetap terjaga saat beberapa sesi berjalan bersamaan.

**Architecture:** Knob global `Setting.verifyScope` (kolom `Json` → **tanpa migration**) + override opsional saat Start (`POST /terminal/sessions`). Nilai terpilih mewujud di dua tempat: **klausa prompt** yang disisipkan `startPrompt`/`continuePrompt` (hanya flow yang menulis kode), dan **env sesi** `HANOMAN_BASE_SHA` + `HANOMAN_VERIFY_SCOPE` yang membuat klausa itu bisa dieksekusi tanpa menebak. Tidak ada hook deny — ADR-0037 tetap utuh, presedennya ADR-0073.

**Tech Stack:** TypeScript strict · zod (`@hanoman/shared`) · Fastify · Prisma (tanpa perubahan skema) · React + Vite · vitest.

## Global Constraints

- **Tanpa migration & tanpa kolom DB baru.** `Setting.data` adalah `Json`; kunci baru masuk lewat `zSetting` dengan `.default()` supaya baris `Setting` lama tetap parse.
- **ADR-0037 tetap utuh.** Dilarang menambah hook `PreToolUse`/deny apa pun. Klausa mengarahkan, tidak memaksa.
- **Nilai enum persis:** `"changed"` | `"full"`. Default global & fallback: `"changed"`.
- **Nama kunci persis:** `verifyScope` (Setting, body `POST /terminal/sessions`, opts `startSpecSession`).
- **Nama env persis:** `HANOMAN_BASE_SHA`, `HANOMAN_VERIFY_SCOPE`.
- **Nomor ADR:** `0080`. Verifikasi ulang lintas branch **dan** `git worktree list` tepat sebelum push (ADR-0021) — worktree tetangga `spec-377` bisa mengklaim nomor yang sama.
- **Prosa Indonesia** untuk komentar, docs, dan teks UI (konvensi repo).
- **Test dijalankan ber-scope** (dogfood SPEC-376 ini sendiri): `env -u NODE_ENV -u DATABASE_URL pnpm vitest run <path>` per paket, bukan `pnpm test` root.
- **Docs yang tersentuh diperbarui dalam commit yang sama** & ter-link di `internal/docs/README.md`.

---

### Task 1: Kosakata `verifyScope` + knob global (`shared`)

**Files:**
- Modify: `shared/src/enums.ts` (tambah di akhir)
- Modify: `shared/src/entities.ts:187-202` (`zSetting`)
- Modify: `shared/src/dto.ts:258-262` (varian sesi backlog di `zTerminalSession`)
- Test: `shared/test/verify-scope.test.ts` (baru)

**Interfaces:**
- Consumes: —
- Produces: `zVerifyScope` (zod enum), `VERIFY_SCOPES: readonly ["changed","full"]`, `type VerifyScope = "changed" | "full"`, `Setting["verifyScope"]`, field opsional `verifyScope` di body sesi backlog.

- [x] **Step 1: Tulis test yang gagal**

Buat `shared/test/verify-scope.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { zVerifyScope, VERIFY_SCOPES, zSetting, zTerminalSession } from "../src";

// Baris Setting yang lengkap menurut zSetting (autoDefault/autoScaffold/notifyFail tak punya
// .default(), jadi objek parsial gagal parse dan bukan itu yang sedang diuji di sini).
const base = {
  model: "claude-opus-5", effort: "xhigh",
  autoDefault: true, autoScaffold: true, notifyFail: true,
};

describe("verifyScope", () => {
  it("kosakatanya persis changed|full", () => {
    expect(VERIFY_SCOPES).toEqual(["changed", "full"]);
    expect(zVerifyScope.safeParse("changed").success).toBe(true);
    expect(zVerifyScope.safeParse("full").success).toBe(true);
    expect(zVerifyScope.safeParse("sebagian").success).toBe(false);
  });

  // SPEC-376 · baris Setting yang ditulis SEBELUM spec ini tak punya kunci ini sama sekali.
  // Tanpa .default() ia gagal parse dan getSetting diam-diam jatuh ke DEFAULT_SETTING.
  it("baris Setting lama tanpa verifyScope tetap parse dan default ke changed", () => {
    const parsed = zSetting.parse(base);
    expect(parsed.verifyScope).toBe("changed");
  });

  it("nilai eksplisit di Setting dipertahankan", () => {
    expect(zSetting.parse({ ...base, verifyScope: "full" }).verifyScope).toBe("full");
    expect(zSetting.safeParse({ ...base, verifyScope: "sebagian" }).success).toBe(false);
  });

  it("body sesi backlog menerima verifyScope opsional dan menolak nilai asing", () => {
    const ok = zTerminalSession.safeParse({ spec: "SPEC-376", flow: "feature", verifyScope: "full" });
    expect(ok.success).toBe(true);
    const tanpa = zTerminalSession.safeParse({ spec: "SPEC-376", flow: "feature" });
    expect(tanpa.success).toBe(true);
    const salah = zTerminalSession.safeParse({ spec: "SPEC-376", flow: "feature", verifyScope: "semua" });
    expect(salah.success).toBe(false);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run shared/test/verify-scope.test.ts`
Expected: FAIL — `zVerifyScope` / `VERIFY_SCOPES` tidak diekspor (`SyntaxError` atau `undefined`).

- [x] **Step 3: Tambah kosakata di `shared/src/enums.ts`**

Tambahkan di akhir berkas:

```ts
// SPEC-376 · ADR-0080 · scope verifikasi sesi. changed = uji hanya yang berubah (default —
// beberapa sesi berjalan bersamaan di satu mesin); full = perilaku lama (seluruh project).
// Cermin `VerifyScope` di @hanoman/runner (pola Flow/zFlow & Agent/zAgent): zod untuk validasi
// di batas HTTP, union TS untuk lapis runner.
export const VERIFY_SCOPES = ["changed", "full"] as const;
export const zVerifyScope = z.enum(VERIFY_SCOPES);
export type VerifyScope = (typeof VERIFY_SCOPES)[number];
```

- [x] **Step 4: Tambah knob ke `zSetting`** (`shared/src/entities.ts`)

Impor `zVerifyScope` bila belum ada di berkas itu (periksa daftar impor di baris teratas — `enums` sudah diimpor untuk `zAgent`), lalu tambahkan satu baris di dalam `z.object({ … })` `zSetting`, tepat di bawah `codex`:

```ts
  codex: zCodex.default(CODEX_DEFAULTS),                                  // SPEC-338 · ADR-0074 · model/effort codex
  verifyScope: zVerifyScope.default("changed"),                           // SPEC-376 · ADR-0080 · scope verifikasi sesi
```

- [x] **Step 5: Tambah override per sesi ke `zTerminalSession`** (`shared/src/dto.ts:258-262`)

Ganti varian sesi backlog menjadi:

```ts
  // SPEC-252 · ADR-0061 — model & effort per SESI: override opsional saat Start; kosong → global.
  // SPEC-332 · ADR-0073 — mode goal per SESI: `goal` undefined → ikut Setting.goal.enabled,
  // false → mati walau global nyala; `goalCondition` kosong → template global → default bawaan.
  // SPEC-338 · ADR-0074 — agen per SESI: undefined → ikut Setting.agent (default global).
  // SPEC-376 · ADR-0080 — scope verifikasi per SESI: undefined → ikut Setting.verifyScope.
  z.object({
    spec: z.string(), flow: zFlow, model: z.string().optional(), effort: z.string().optional(),
    goal: z.boolean().optional(), goalCondition: z.string().max(4000).optional(),
    agent: zAgent.optional(),
    verifyScope: zVerifyScope.optional(),
  }),
```

Pastikan `zVerifyScope` ikut diimpor di `dto.ts` (berkas itu sudah mengimpor `zAgent`/`zFlow` dari `./enums` — tambahkan ke daftar yang sama).

- [x] **Step 6: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run shared/test/verify-scope.test.ts`
Expected: PASS — 4 test.

- [x] **Step 7: Typecheck paket yang tersentuh saja**

Run: `pnpm --filter ./shared typecheck`
Expected: exit 0, tanpa output error.

- [x] **Step 8: Commit**

```bash
git add shared/src/enums.ts shared/src/entities.ts shared/src/dto.ts shared/test/verify-scope.test.ts
git commit -m "feat(spec-376): kosakata verifyScope + knob Setting & override sesi"
```

---

### Task 2: Klausa prompt `verifyScopeClause` (`runner`)

**Files:**
- Create: `runner/src/verify-scope.ts`
- Modify: `runner/src/types.ts` (tambah `VerifyScope`)
- Modify: `runner/src/prompt.ts:179-218` (`startPrompt`, `continuePrompt`)
- Modify: `runner/src/index.ts` (ekspor modul baru)
- Test: `runner/test/verify-scope.test.ts` (baru), `runner/test/prompt.test.ts` (tambahan)

**Interfaces:**
- Consumes: `type Flow`, `type SpecBrief`, `type Autonomy` dari `runner/src/types.ts`.
- Produces:
  - `type VerifyScope = "changed" | "full"` (runner/src/types.ts)
  - `verifyScopeClause(scope: VerifyScope): string` — `""` untuk `"full"`
  - `startPrompt(flow, spec, branchTo, autonomy?, verifyScope?)` — parameter kelima baru, opsional
  - `continuePrompt(flow, spec, branchTo, autonomy?, verifyScope?)` — idem

- [x] **Step 1: Tulis test yang gagal**

Buat `runner/test/verify-scope.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { verifyScopeClause } from "../src/verify-scope";

describe("verifyScopeClause", () => {
  it("full tak menghasilkan klausa apa pun (perilaku lama utuh)", () => {
    expect(verifyScopeClause("full")).toBe("");
  });

  it("changed memberi perintah yang bisa langsung dijalankan, berbasis baseSha", () => {
    const c = verifyScopeClause("changed");
    expect(c).toContain("$HANOMAN_BASE_SHA");
    expect(c).toContain("git diff --name-only");
    expect(c).toContain("--changed");
    expect(c).toContain("vitest related");
  });

  it("changed melarang perintah suite penuh secara eksplisit", () => {
    const c = verifyScopeClause("changed");
    expect(c).toContain("pnpm test");        // disebut sebagai yang DILARANG
    expect(c).toContain("pnpm -r typecheck");
    expect(c.toUpperCase()).toContain("JANGAN");
  });

  // Keempat sumbu yang diminta operator (SPEC-376): test, typecheck, lint, build, smoke API.
  it("changed menutup typecheck, lint, build, dan smoke server", () => {
    const c = verifyScopeClause("changed").toLowerCase();
    for (const kata of ["typecheck", "lint", "build", "curl"]) expect(c).toContain(kata);
  });

  // `--changed` menyalakan passWithNoTests di vitest → "0 test" terlihat hijau. Klausa harus
  // menyebutnya, kalau tidak scope sempit justru memproduksi kepercayaan palsu.
  it("changed memperingatkan jebakan passWithNoTests", () => {
    expect(verifyScopeClause("changed")).toContain("passWithNoTests");
  });

  // Scope sempit tak boleh jadi alasan melewatkan verifikasi perubahan berdampak luas.
  it("changed memberi jalan keluar eksplisit untuk perubahan berdampak luas", () => {
    expect(verifyScopeClause("changed").toLowerCase()).toContain("perluas scope");
  });
});
```

Tambahkan ke `runner/test/prompt.test.ts` (di dalam `describe("startPrompt", …)`, sebelum penutupnya):

```ts
  // SPEC-376 · ADR-0080 · scope verifikasi. Default pemanggil lama (parameter absen) harus
  // tetap seperti dulu: tanpa klausa. Klausa hanya muncul saat diminta eksplisit.
  it("tanpa parameter verifyScope, prompt tak memuat klausa scope (kompatibel mundur)", () => {
    const p = startPrompt("feature", spec, "hanoman/spec-162");
    expect(p).not.toContain("$HANOMAN_BASE_SHA");
  });

  it("verifyScope changed menyisipkan klausa scope ke prompt", () => {
    const p = startPrompt("feature", spec, "hanoman/spec-162", undefined, "changed");
    expect(p).toContain("$HANOMAN_BASE_SHA");
    expect(p).toContain("Scope verifikasi");
  });

  it("verifyScope full tak menyisipkan klausa apa pun", () => {
    const p = startPrompt("feature", spec, "hanoman/spec-162", undefined, "full");
    expect(p).not.toContain("$HANOMAN_BASE_SHA");
  });

  // Flow audit-only tak menulis kode → tak ada test untuk dijalankan; klausa di sana hanya
  // menambah token. Sengaja tak disisipkan meski scope-nya `changed`.
  it("flow audit tak membawa klausa scope walau verifyScope changed", () => {
    const p = startPrompt("audit", spec, "hanoman/spec-237", undefined, "changed");
    expect(p).not.toContain("$HANOMAN_BASE_SHA");
  });

  it("continuePrompt ikut membawa klausa scope", () => {
    const p = continuePrompt("feature", spec, "hanoman/spec-162", undefined, "changed");
    expect(p).toContain("$HANOMAN_BASE_SHA");
  });
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run runner/test/verify-scope.test.ts runner/test/prompt.test.ts`
Expected: FAIL — `Cannot find module '../src/verify-scope'`.

- [x] **Step 3: Tambah tipe `VerifyScope`** (`runner/src/types.ts`, sesudah `Agent` di baris 10)

```ts
// SPEC-376 · ADR-0080 · scope verifikasi sesi. Cermin `zVerifyScope` di @hanoman/shared (pola
// yang sama dipakai Flow/zFlow dan Agent/zAgent).
export type VerifyScope = "changed" | "full";
```

- [x] **Step 4: Tulis `runner/src/verify-scope.ts`**

```ts
import type { VerifyScope } from "./types";

// SPEC-376 · ADR-0080 — scope verifikasi sesi.
//
// Sampai spec ini, prompt sesi DIAM soal seberapa luas harus diverifikasi: ia bicara fase,
// otonomi, skill, commit, dan push — tapi tak sekali pun menyebut test. Karena diam, agen jatuh
// ke konvensi repo target (DoD hanoman sendiri dulu berbunyi `vitest run --no-file-parallelism`
// = 258 berkas test) dan ke kebiasaan "kalau ragu, jalankan semuanya". Beberapa sesi berjalan
// bersamaan di satu mesin, jadi biaya itu dikalikan.
//
// Klausa ini MENGARAHKAN, bukan memaksa: tak ada hook deny (ADR-0037 tetap utuh; preseden
// ADR-0073 yang menambah hook Stop tanpa mencabutnya). Karena itu ia harus (a) menyebut
// perintah yang benar-benar bisa dijalankan, bukan imbauan abstrak, dan (b) memberi jalan
// keluar eksplisit untuk perubahan berdampak luas — scope sempit yang dipatuhi membabi buta
// justru melahirkan regresi yang lolos.
const CHANGED = [
  "Scope verifikasi: HANYA yang berubah. Mesin ini menjalankan beberapa sesi sekaligus —",
  "memverifikasi seluruh project menghabiskan RAM & CPU yang sedang dipakai sesi lain.",
  "",
  "Berkas yang berubah di worktree ini:",
  '`git diff --name-only "$HANOMAN_BASE_SHA"...HEAD` (yang sudah di-commit) dan',
  "`git status --porcelain` (yang belum).",
  "",
  "- Test: jalankan HANYA test yang berkaitan dengan berkas itu. Repo vitest:",
  '  `pnpm vitest --run --changed "$HANOMAN_BASE_SHA"` (vitest sendiri menurunkan berkas yang',
  "  berubah dari git, termasuk yang belum di-commit), atau `pnpm vitest related --run <berkas…>`,",
  "  atau sebut path berkas test-nya langsung. Stack lain: `pytest <path>`, `go test ./paket/...`.",
  "  JANGAN `pnpm test` atau `vitest run` polos — itu seluruh suite.",
  "  Jebakan: `--changed` menyalakan `passWithNoTests`, jadi nol test TERLIHAT hijau. Pastikan",
  "  test-nya memang berjalan, jangan menerima \"no test files\" sebagai bukti.",
  "- Typecheck: hanya paket yang tersentuh (mis. `pnpm --filter ./server typecheck`).",
  "  JANGAN `pnpm -r typecheck` — itu menyalakan satu proses tsc per paket sekaligus.",
  "- Lint: hanya berkas yang berubah, bukan seluruh repo.",
  "- Build penuh: hanya bila yang kamu ubah memang soal build/bundling.",
  "- Boot server + curl / smoke end-to-end: hanya bila task ini menyentuh endpoint atau perilaku",
  "  runtime-nya, sekali di akhir — bukan rutin tiap task.",
  "",
  "Suite penuh, lint penuh, dan build penuh adalah tugas MANUSIA sebelum merge, bukan tugas sesi.",
  "Pengecualian yang kamu putuskan sendiri: bila perubahanmu memang berdampak luas (mengubah",
  "tipe/kontrak bersama, skema, atau berkas yang diimpor banyak modul), perluas scope seperlunya",
  "dan katakan alasannya. Ini panduan biaya, bukan larangan.",
].join("\n");

/** Klausa prompt untuk scope verifikasi. `full` = string kosong (prompt persis seperti dulu). */
export const verifyScopeClause = (scope: VerifyScope): string => scope === "changed" ? CHANGED : "";
```

- [x] **Step 5: Sisipkan ke prompt** (`runner/src/prompt.ts`)

Tambahkan impor di baris teratas:

```ts
import type { Flow, SpecBrief, ProjectBrief, PrdBrief, AuditDoc, BreakdownPrd, Autonomy, CrossAuditCtx, CrossAuditProject, VerifyScope } from "./types";
import { verifyScopeClause } from "./verify-scope";
```

Tambahkan helper tepat di atas `startPrompt` (baris 179):

```ts
// SPEC-376 · ADR-0080 — klausa scope verifikasi hanya untuk flow yang MENULIS KODE. Flow
// dokumen (audit, cross-audit, prd, breakdown, reverse, scaffold) tak punya test untuk
// dijalankan, jadi klausanya cuma menambah token. Ditentukan dari kehadiran fase Execute —
// sumber kebenaran yang sama dengan gate plan di phaseInstruction.
const scopeClause = (flow: Flow, scope?: VerifyScope): string =>
  scope && PIPELINES[flow].includes("Execute") ? verifyScopeClause(scope) : "";
```

Ubah `startPrompt` (baris 179) menjadi:

```ts
export function startPrompt(
  flow: Flow, spec: SpecBrief, branchTo: string, autonomy?: Autonomy, verifyScope?: VerifyScope,
): string {
```

dan sisipkan satu entri array tepat SESUDAH `autonomyClause(autonomy),`:

```ts
    autonomyClause(autonomy),
    scopeClause(flow, verifyScope),
```

Ubah `continuePrompt` (baris 202) dengan pola yang sama:

```ts
export function continuePrompt(
  flow: Flow, spec: SpecBrief, branchTo: string, autonomy?: Autonomy, verifyScope?: VerifyScope,
): string {
```

dan sesudah `autonomyClause(autonomy),`:

```ts
    autonomyClause(autonomy),
    scopeClause(flow, verifyScope),
```

`.filter(Boolean)` yang sudah ada di kedua fungsi membuang string kosong, jadi tak ada baris kosong ekstra saat `full`.

- [x] **Step 6: Ekspor modul baru** (`runner/src/index.ts`)

```ts
export * from "./verify-scope";
```

- [x] **Step 7: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run runner/test/verify-scope.test.ts runner/test/prompt.test.ts`
Expected: PASS — 6 test baru di verify-scope + seluruh test prompt lama tetap hijau (kompatibilitas mundur: pemanggil tanpa parameter kelima).

- [x] **Step 8: Typecheck paket yang tersentuh**

Run: `pnpm --filter ./runner typecheck`
Expected: exit 0.

- [x] **Step 9: Commit**

```bash
git add runner/src/verify-scope.ts runner/src/types.ts runner/src/prompt.ts runner/src/index.ts runner/test/verify-scope.test.ts runner/test/prompt.test.ts
git commit -m "feat(spec-376): klausa scope verifikasi di prompt sesi ber-Execute"
```

---

### Task 3: Server — resolusi scope, env sesi, dan body route

**Files:**
- Modify: `server/src/services/settings.ts:11-21` (`DEFAULT_SETTING`)
- Modify: `server/src/services/session-launch.ts:23-104`
- Modify: `server/src/routes/terminal.ts:70-75`
- Test: `server/test/session-launch.test.ts` (tambahan), `server/test/terminal.route.test.ts` (tambahan)

**Interfaces:**
- Consumes: `verifyScopeClause`/`startPrompt`/`continuePrompt` (Task 2), `zVerifyScope`/`Setting["verifyScope"]` (Task 1), `CreateOpts.env` (`server/src/services/pty.ts:222`, sudah ada).
- Produces: `startSpecSession(spec, opts)` menerima `verifyScope?: VerifyScope`; sesi lahir dengan env `HANOMAN_BASE_SHA=<baseSha>` dan `HANOMAN_VERIFY_SCOPE=<changed|full>`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/session-launch.test.ts` (di dalam `describe("session-launch", …)`, sesudah blok SPEC-338):

```ts
  // SPEC-376 · ADR-0080 · scope verifikasi. Bukti diambil dari argv pane — di situlah env sesi
  // (HANOMAN_BASE_SHA/HANOMAN_VERIFY_SCOPE) dan prompt benar-benar mewujud. HANOMAN_CLAUDE_BIN=
  // /bin/echo mencetak argv utuh; prompt sendiri diserahkan lewat "$(cat <file>)" jadi yang
  // terlihat di layar adalah hasil ekspansinya.
  it("sesi lahir membawa env HANOMAN_BASE_SHA & HANOMAN_VERIFY_SCOPE, default changed", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const spec = await seedRepo("SPEC-V1");
    const r = await startSpecSession(spec, { flow: "feature" });
    const argv = await argvOf(r.id);
    const row = await prisma.spec.findUnique({ where: { id: "SPEC-V1" } });
    expect(row!.baseSha).toBeTruthy();
    expect(argv).toContain("Scope verifikasi");        // klausa masuk ke prompt
    expect(argv).toContain(row!.baseSha!);             // baseSha diteruskan sebagai env
    killSession(r.id);
  });

  it("Setting.verifyScope full → sesi tanpa override tak membawa klausa (jalur scheduler)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    await setSetting({ verifyScope: "full" });
    const spec = await seedRepo("SPEC-V2");
    const r = await startSpecSession(spec, { flow: "feature" });   // governor memanggil persis begini
    expect(await argvOf(r.id)).not.toContain("Scope verifikasi");
    killSession(r.id);
  });

  it("override per sesi menang atas Setting global", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    await setSetting({ verifyScope: "full" });
    const spec = await seedRepo("SPEC-V3");
    const r = await startSpecSession(spec, { flow: "feature", verifyScope: "changed" });
    expect(await argvOf(r.id)).toContain("Scope verifikasi");
    killSession(r.id);
  });
```

Tambahkan ke `server/test/terminal.route.test.ts` (di dalam describe utamanya):

```ts
  // SPEC-376 · ADR-0080 · body verifyScope divalidasi di batas HTTP.
  it("POST /terminal/sessions menolak verifyScope yang tak dikenal", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/terminal/sessions",
      payload: { spec: "SPEC-1", flow: "feature", verifyScope: "sebagian" },
      headers: authHeaders,
    });
    expect(res.statusCode).toBe(400);
  });
```

> Catatan implementer: `authHeaders` / cara autentikasi di `terminal.route.test.ts` sudah ada di berkas itu — pakai persis pola test tetangga di berkas yang sama, jangan mengarang helper baru. Bila spec `SPEC-1` belum di-seed di test itu, seed lewat helper yang sudah dipakai test lain di berkas tersebut; 400 harus datang dari validasi body, jadi ia terjadi **sebelum** lookup spec.

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run server/test/session-launch.test.ts --no-file-parallelism`
Expected: FAIL — argv tak memuat "Scope verifikasi" (klausa belum diteruskan) dan/atau `verifyScope` bukan properti `opts` yang sah.

- [x] **Step 3: Tambah default ke `DEFAULT_SETTING`** (`server/src/services/settings.ts:11-21`)

```ts
  agent: "claude",                 // SPEC-338 · ADR-0074 · mesin sesi default
  codex: CODEX_DEFAULTS,           // SPEC-338 · ADR-0074 · model/effort codex
  verifyScope: "changed",          // SPEC-376 · ADR-0080 · uji hanya yang berubah
```

- [x] **Step 4: Resolusi scope + env di `session-launch.ts`**

Perluas impor tipe di baris 3-4:

```ts
import { realGit, startPrompt, continuePrompt, startCrossAuditPrompt, resolveGoalCondition, type Flow, type Autonomy, type VerifyScope } from "@hanoman/runner";
```

Tambahkan field ke signature `opts` (sesudah `agent?: Agent;`):

```ts
    // SPEC-376 · ADR-0080 · scope verifikasi. undefined → ikut Setting.verifyScope (default
    // "changed"). Governor scheduler tak memasoknya → ikut default global, seperti model/effort.
    verifyScope?: VerifyScope;
```

Sesudah blok resolusi `goal` (baris 57-62), tambahkan:

```ts
  // SPEC-376 · ADR-0080 · scope verifikasi: override sesi → Setting global → "changed".
  const verifyScope: VerifyScope = opts.verifyScope ?? setting.verifyScope;
```

Ganti perakitan prompt (baris 84-86) menjadi:

```ts
  let prompt = isContinue
    ? continuePrompt(opts.flow, brief, `hanoman/${id}`, opts.autonomy, verifyScope)
    : startPrompt(opts.flow, brief, `hanoman/${id}`, opts.autonomy, verifyScope);
```

Ganti perakitan `extra` + `createSession` (baris 87-103) menjadi:

```ts
  // SPEC-376 · ADR-0080 · env sesi. baseSha SUDAH dihitung di addWorktree di atas — tanpa
  // meneruskannya, klausa "berkas yang berubah" tak bisa dieksekusi tanpa menebak: worktree
  // lahir `--detach`, jadi `main` belum tentu ada dan `HEAD~1` salah.
  const scopeEnv: Record<string, string> = { HANOMAN_BASE_SHA: baseSha, HANOMAN_VERIFY_SCOPE: verifyScope };
  let extra: { audit?: { key: string; projects: string[] }; env?: Record<string, string> } = {};
  if (opts.flow === "cross-audit") {
    const built = await buildCrossAuditCtx(spec.projectId);
    if (built) {
      prompt = startCrossAuditPrompt(
        { ...built.ctx, worktree: `${repoDir}/.worktrees/${id}`, spec: brief, branchTo: `hanoman/${id}` },
        "backlog");
      extra = crossAuditSessionOpts(built.scope);
    }
  }
  const s = createSession(spec.projectId, `${repoDir}/.worktrees/${id}`, {
    specId: spec.id, flow: opts.flow, model, effort, goal, agent,
    phaseFile: phaseFilePath(repoDir, id),
    decisionFile: decisionFilePath(repoDir, id),
    prompt,
    ...extra,
    // Digabung SESUDAH `extra` supaya env audit lintas (SPEC-337) tak terhapus dan sebaliknya.
    env: { ...scopeEnv, ...(extra.env ?? {}) },
  });
```

- [x] **Step 5: Teruskan body di route** (`server/src/routes/terminal.ts:71-75`)

```ts
        const r = await startSpecSession(spec, {
          flow: parsed.data.flow, model: parsed.data.model, effort: parsed.data.effort,
          goal: parsed.data.goal, goalCondition: parsed.data.goalCondition,   // SPEC-332 · ADR-0073
          agent: parsed.data.agent,                                           // SPEC-338 · ADR-0074
          verifyScope: parsed.data.verifyScope,                               // SPEC-376 · ADR-0080
        });
```

- [x] **Step 6: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run server/test/session-launch.test.ts server/test/terminal.route.test.ts --no-file-parallelism`
Expected: PASS — termasuk seluruh test lama di kedua berkas (mode goal SPEC-332, agen SPEC-338).

- [x] **Step 7: Typecheck paket yang tersentuh**

Run: `pnpm --filter ./server typecheck`
Expected: exit 0.

- [x] **Step 8: Commit**

```bash
git add server/src/services/settings.ts server/src/services/session-launch.ts server/src/routes/terminal.ts server/test/session-launch.test.ts server/test/terminal.route.test.ts
git commit -m "feat(spec-376): server meneruskan verifyScope ke prompt + env sesi"
```

---

### Task 4: UI — kartu Settings & picker saat Start

**Files:**
- Modify: `src/src/screens/SettingsScreen.tsx:37-47` (`S_DEFAULTS`) dan tab `sesi` (sesudah kartu "Mode goal", baris ~649)
- Modify: `src/src/App.tsx:47-163` (`StartSessionModal`)
- Modify: `src/src/api/client.ts:214-216` (signature `startSession`)
- Test: `src/test/start-session-verify-scope.test.tsx` (baru)

**Interfaces:**
- Consumes: `Setting["verifyScope"]`, `VerifyScope` dari `@hanoman/shared` (Task 1); `api.startSession({ …, verifyScope })`.
- Produces: `POST /terminal/sessions` dari UI membawa `verifyScope`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/start-session-verify-scope.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../src/api/client", () => ({
  api: { getSettings: vi.fn(), startSession: vi.fn(), getCodexVersion: vi.fn().mockResolvedValue({ version: null, minRequired: "0.144.0", ok: true }) },
  ApiError: class extends Error { status = 0 },
}));

import { StartSessionModal } from "../src/App";
import { api } from "../src/api/client";

const spec: any = { id: "SPEC-376", source: "brief", title: "t", stage: "planned" };
const settings = (verifyScope: string) => ({
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  agentAccessEnabled: false, scheduler: {}, goal: { enabled: false, condition: "" }, verifyScope,
});

beforeEach(() => {
  vi.mocked(api.getSettings).mockResolvedValue(settings("changed") as any);
  vi.mocked(api.startSession).mockResolvedValue({ id: "spec-376" } as any);
});

describe("StartSessionModal · scope verifikasi", () => {
  it("prefill dari Setting global dan mengirim verifyScope", async () => {
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Scope verifikasi")).toHaveValue("changed"));
    fireEvent.click(screen.getByText("Mulai"));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ spec: "SPEC-376", verifyScope: "changed" })));
  });

  it("memilih full mengirim verifyScope full", async () => {
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Scope verifikasi")).toHaveValue("changed"));
    fireEvent.change(screen.getByLabelText("Scope verifikasi"), { target: { value: "full" } });
    fireEvent.click(screen.getByText("Mulai"));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ verifyScope: "full" })));
  });

  // Respons yang di-cache dari server sebelum SPEC-376 tak punya kunci ini; picker tak boleh kosong.
  it("setelan tanpa verifyScope jatuh ke changed", async () => {
    const s: any = settings("changed"); delete s.verifyScope;
    vi.mocked(api.getSettings).mockResolvedValue(s);
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Scope verifikasi")).toHaveValue("changed"));
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run src/test/start-session-verify-scope.test.tsx`
Expected: FAIL — `Unable to find a label with the text of: Scope verifikasi`.

- [ ] **Step 3: Tambah state + picker di `StartSessionModal`** (`src/src/App.tsx`)

Impor tipe di daftar impor `@hanoman/shared` yang sudah ada di berkas itu: tambahkan `type VerifyScope`.

Tambahkan state sesudah `goalCond` (baris 62):

```ts
  // SPEC-376 · ADR-0080 · scope verifikasi per sesi. Prefill dari default global; `?? "changed"`
  // karena respons GET /settings yang ter-cache sebelum SPEC-376 belum punya kunci ini.
  const [verifyScope, setVerifyScope] = React.useState<VerifyScope>("changed");
```

Di dalam `api.getSettings().then(...)` sesudah `setGoalOn(...)` (baris 77):

```ts
      setVerifyScope(s.verifyScope ?? "changed");
```

Di `start()` (baris 103-106) tambahkan field:

```ts
      const { id } = await api.startSession({
        spec: s.id, flow, model, effort, agent,
        goal: goalOn, goalCondition: goalOn && goalCond.trim() ? goalCond.trim() : undefined,
        verifyScope,
      });
```

Tambahkan `Field` sesudah `Field` "Mode goal" (sebelum `</Modal>`, baris 161):

```tsx
      {/* SPEC-376 · ADR-0080 · scope verifikasi: sesi menguji berkas yang berubah saja supaya
          RAM & CPU tetap tersisa untuk sesi lain di mesin yang sama. */}
      <Field label="Scope verifikasi"
        hint="Hanya yang berubah = test/typecheck/lint hanya menyentuh berkas yang disentuh sesi ini. Suite penuh tetap dijalankan manusia sebelum merge.">
        <Select aria-label="Scope verifikasi" value={verifyScope} style={{ width: "100%" }}
          options={[
            { value: "changed", label: "Hanya yang berubah — hemat RAM & CPU" },
            { value: "full", label: "Seluruh project" },
          ]}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setVerifyScope(e.target.value as VerifyScope)} />
      </Field>
```

- [ ] **Step 4: Perluas signature `api.startSession`** (`src/src/api/client.ts:214-216`)

```ts
  startSession: (b: { spec: string; flow: Flow; model?: string; effort?: string; goal?: boolean; goalCondition?: string;
    agent?: Agent;                    // SPEC-338 · ADR-0074 · mesin sesi; kosong → Setting.agent
    verifyScope?: VerifyScope }) =>   // SPEC-376 · ADR-0080 · scope verifikasi; kosong → Setting.verifyScope
    j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body(b) }),
```

Tambahkan `type VerifyScope` ke impor `@hanoman/shared` di berkas itu.

- [ ] **Step 5: Tambah kartu di Settings** (`src/src/screens/SettingsScreen.tsx`)

Tambahkan ke `S_DEFAULTS` (baris 37-47):

```ts
  codex: CODEX_DEFAULTS,           // SPEC-338 · ADR-0074 · model/effort codex
  verifyScope: "changed",          // SPEC-376 · ADR-0080 · uji hanya yang berubah
```

Tambahkan kartu di tab `sesi`, sesudah kartu "Mode goal" (sesudah baris 649, sebelum `</>`):

```tsx
      {/* SPEC-376 · ADR-0080 · scope verifikasi: default global untuk sesi backlog; tiap Start
          masih bisa meng-override. Bukan gerbang — sesi diarahkan lewat klausa prompt, tak ada
          hook yang menolak perintah (ADR-0037 utuh). */}
      <Card eyebrow="verifikasi" title="Scope verifikasi — sesi backlog">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
          Beberapa sesi berjalan bersamaan di mesin ini. <b>Hanya yang berubah</b> menyuruh sesi menguji
          berkas yang benar-benar ia sentuh (<code>vitest --changed</code>, typecheck per paket, lint per
          berkas) alih-alih seluruh project — RAM & CPU tetap tersisa untuk sesi lain. Suite penuh, lint
          penuh, dan build penuh tetap dijalankan manusia sebelum merge.
        </div>
        <SettingRow title="Scope default" last
          desc="Sesi backlog baru lahir dengan scope ini. Masih bisa diubah per sesi saat Start.">
          <Select size="sm" aria-label="Scope verifikasi default" value={s.verifyScope ?? "changed"} style={{ width: 220 }}
            options={[
              { value: "changed", label: "Hanya yang berubah" },
              { value: "full", label: "Seluruh project" },
            ]}
            onChange={(e) => save({ verifyScope: e.target.value as Setting["verifyScope"] },
              "Scope verifikasi → " + e.target.value)} />
        </SettingRow>
      </Card>
```

- [ ] **Step 6: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run src/test/start-session-verify-scope.test.tsx src/test/start-session-goal.test.tsx src/test/start-session-agent.test.tsx src/test/start-session-model.test.tsx`
Expected: PASS — 3 test baru + seluruh test picker Start yang lama tetap hijau.

- [ ] **Step 7: Typecheck paket yang tersentuh**

Run: `pnpm --filter ./src typecheck`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/src/App.tsx src/src/api/client.ts src/src/screens/SettingsScreen.tsx src/test/start-session-verify-scope.test.tsx
git commit -m "feat(spec-376): picker scope verifikasi di Start + kartu default di Settings"
```

---

### Task 5: Docs Source of Truth + ADR-0080 + DoD hanoman sendiri

**Files:**
- Create: `internal/docs/adr/0080-scope-verifikasi-per-sesi.md`
- Modify: `internal/docs/README.md` (baris ADR teratas, di atas 0079)
- Modify: `internal/docs/architecture/api-contract.md` (bagian `POST /terminal/sessions` + `PUT /settings`)
- Modify: `internal/docs/architecture/nfr.md` (bagian sumber daya / performa)
- Modify: `internal/skills/hanoman/SKILL.md` (aturan sesi + baris DoD 166-167)
- Modify: `AGENTS.md:42-47` (Definition of done)
- Modify: `CLAUDE.md` (bagian Kebiasaan — kewajiban boot server + curl)

**Interfaces:**
- Consumes: nama & nilai dari Task 1-4 (`verifyScope`, `changed`/`full`, `HANOMAN_BASE_SHA`, `HANOMAN_VERIFY_SCOPE`).
- Produces: dokumen SoT yang menjelaskan mekanisme + DoD hanoman yang tak lagi menyuruh suite penuh.

- [ ] **Step 1: Verifikasi nomor ADR masih bebas**

```bash
for r in $(git for-each-ref --format='%(refname)' refs/heads refs/remotes); do git ls-tree -r --name-only "$r" -- internal/docs/adr; done | sed 's#.*/##' | grep -c '^0080' 
git worktree list
ls /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/*/internal/docs/adr/0080-* 2>/dev/null
```
Expected: hitungan `0` dan tak ada berkas `0080-*` di worktree mana pun. Bila ada, naikkan ke nomor bebas berikutnya **dan** ganti semua rujukan `ADR-0080` di kode & docs.

- [ ] **Step 2: Tulis `internal/docs/adr/0080-scope-verifikasi-per-sesi.md`**

Isi wajib memuat (ikuti bentuk ADR tetangga — Status · Konteks · Keputusan · Konsekuensi · Alternatif yang ditolak):
- **Status:** aktif (SPEC-376). Memperluas ADR-0061/0073/0074 (properti per sesi); **TIDAK** membalik ADR-0037.
- **Konteks:** prompt sesi tak pernah menyebut scope verifikasi → agen jatuh ke DoD repo target (hanoman: 258 berkas test) & kebiasaan; sesi paralel di satu mesin 8 core/8 GB.
- **Keputusan:** `verifyScope` (`changed` default | `full`) jadi properti sesi; knob `Setting.verifyScope` (Json, tanpa migration) + override saat Start; mewujud sebagai klausa prompt (flow ber-fase Execute saja) + env `HANOMAN_BASE_SHA`/`HANOMAN_VERIFY_SCOPE`.
- **Konsekuensi:** mengarahkan, bukan memaksa; agen boleh memperluas scope dengan alasan; suite penuh pindah ke manusia sebelum merge; terminal biasa tak punya prompt → hanya menerima env (batas yang disadari); jebakan `--changed` + `passWithNoTests` disebut di klausa.
- **Alternatif yang ditolak:** hook `PreToolUse` deny (butuh ADR yang mencabut 0037 — ditolak operator), dan mengandalkan `AGENTS.md` repo target saja (tak menjangkau project lain yang didorong hanoman).

- [ ] **Step 3: Tautkan ADR di index** (`internal/docs/README.md`, sisipkan sebagai butir pertama di bawah `## adr`)

```markdown
- [0080 — Scope verifikasi per sesi: klausa prompt + env, bukan hook deny](adr/0080-scope-verifikasi-per-sesi.md) — **memperluas 0061/0073/0074** (properti per sesi), **TIDAK membalik 0037**, terkait 0002/0029/0072 (SPEC-376): `verifyScope` (`changed` default | `full`) menyuruh sesi menguji berkas yang berubah saja — `vitest --changed "$HANOMAN_BASE_SHA"` / `vitest related`, typecheck per paket, lint per berkas, build & smoke server hanya bila relevan — supaya RAM & CPU tersisa untuk sesi lain di mesin yang sama. Knob `Setting.verifyScope` (kolom `Json` → **tanpa migration**) + override di `POST /terminal/sessions`; mewujud sebagai klausa prompt (hanya flow ber-fase `Execute` — flow dokumen tak punya test) + env `HANOMAN_BASE_SHA`/`HANOMAN_VERIFY_SCOPE`. **Mengarahkan, bukan memaksa:** tak ada hook deny (preseden ADR-0073), dan klausanya memberi jalan keluar eksplisit untuk perubahan berdampak luas. **Gotcha wajib:** `vitest --changed` menyalakan `passWithNoTests`, jadi nol test **terlihat hijau** — klausa menyebutnya terang-terangan; dan `baseSha` HARUS diteruskan lewat env karena worktree lahir `--detach` (tak ada `main`, `HEAD~1` salah)
```

- [ ] **Step 4: Perbarui `internal/docs/architecture/api-contract.md`**

Di entri `POST /terminal/sessions`, tambahkan `verifyScope` ke daftar field body varian backlog dengan penjelasan presedens (`override → Setting.verifyScope → "changed"`). Di entri `GET/PUT /settings`, tambahkan kunci `verifyScope` ke bentuk `Setting`. Cari heading-nya dengan `grep -n "terminal/sessions" internal/docs/architecture/api-contract.md`.

- [ ] **Step 5: Perbarui `internal/docs/architecture/nfr.md`**

Tambahkan satu butir di bagian sumber daya/performa: sesi memverifikasi ber-scope secara default (`verifyScope=changed`) supaya N sesi paralel tak melipatgandakan suite penuh; suite penuh dipindahkan ke manusia sebelum merge. Cari bagiannya dengan `grep -n "^##" internal/docs/architecture/nfr.md`.

- [ ] **Step 6: Perbarui `internal/skills/hanoman/SKILL.md`**

Tambahkan butir baru di "Aturan Sesi & Eksekusi" (sesudah butir mode goal SPEC-332):

```markdown
- **Scope verifikasi per sesi** (SPEC-376/ADR-0080): `verifyScope` (`changed` default | `full`) —
  knob `Setting.verifyScope` (kolom `Json`, **tanpa migration**) + override saat Start. Sesi
  `changed` menguji **berkas yang berubah saja**: `pnpm vitest --run --changed "$HANOMAN_BASE_SHA"`
  atau `vitest related`, typecheck **per paket** (bukan `pnpm -r typecheck`), lint per berkas, dan
  build penuh / boot-server+curl hanya bila memang relevan. Alasannya sumber daya: beberapa sesi
  berjalan bersamaan di satu mesin. Mewujud lewat **klausa prompt** (hanya flow ber-fase `Execute`
  — flow dokumen tak punya test) + **env** `HANOMAN_BASE_SHA`/`HANOMAN_VERIFY_SCOPE`; `baseSha`
  wajib lewat env karena worktree lahir `--detach` (tak ada `main`, `HEAD~1` salah). **Bukan**
  guardrail deny — ADR-0037 tetap utuh, dan agen boleh memperluas scope untuk perubahan berdampak
  luas asal menyebut alasannya. **Gotcha:** `--changed` menyalakan `passWithNoTests`, jadi nol test
  **terlihat hijau**.
```

Ubah baris DoD (166-167) menjadi:

```markdown
- TypeScript strict; test untuk setiap logika orchestrasi (trigger, queue, worktree, guardrail).
  Sesi menjalankan test **yang tersentuh perubahannya** (`pnpm vitest --run --changed "$HANOMAN_BASE_SHA"`,
  atau sebut path test-nya) dan typecheck **paket yang tersentuh** — bukan suite penuh (SPEC-376/ADR-0080).
  Suite penuh (`vitest run --no-file-parallelism`) adalah langkah MANUSIA sebelum merge. Hindari env
  prod bocor (`env -u NODE_ENV -u DATABASE_URL`).
- Definition of done: test yang tersentuh hijau · docs tersentuh diperbarui + ter-link · diff bersih di worktree, siap push ke target branch.
```

- [ ] **Step 7: Perbarui `AGENTS.md`** (bagian "Definition of done", baris 42-47)

```markdown
## Definition of done

- **Test yang tersentuh** hijau — `pnpm vitest --run --changed "$HANOMAN_BASE_SHA"` (atau sebut path
  test-nya langsung) dan typecheck paket yang tersentuh. Sesi hanoman default `verifyScope=changed`
  (SPEC-376/ADR-0080): jangan menjalankan suite penuh, `pnpm -r typecheck`, atau build penuh sebagai
  rutinitas — mesin ini menjalankan beberapa sesi sekaligus. Perluas scope hanya bila perubahannya
  memang berdampak luas, dan katakan alasannya.
- Suite penuh (`vitest run --no-file-parallelism`) dijalankan **manusia** sebelum merge, bukan sesi.
- Docs yang tersentuh diperbarui + ter-link di `internal/docs/README.md`.
- Endpoint yang tersentuh diuji nyata di local (boot server + curl) **bila task menyentuh endpoint** —
  sekali di akhir, bukan tiap task.
- Diff bersih di worktree; siap push ke target branch.
```

- [ ] **Step 8: Perbarui `CLAUDE.md`** (butir terakhir bagian "Kebiasaan")

```markdown
- **Setiap selesai satu task execute:** centang checklist task/step yang selesai di file plan
  (`docs/superpowers/plans/**`, `- [ ]` → `- [x]`), lalu jalankan **test yang tersentuh perubahan itu**
  (`pnpm vitest --run --changed "$HANOMAN_BASE_SHA"` atau sebut path test-nya) — bukan suite penuh
  (SPEC-376/ADR-0080). Bila task menyentuh endpoint, **test API-nya secara nyata di local** sekali di
  akhir: boot server (`pnpm dev` atau `node server/dist/server.js`) dan curl endpoint yang tersentuh.
  Kalau masih ada issue, fixing dulu sampai hijau sebelum lanjut ke task berikutnya.
```

- [ ] **Step 9: Verifikasi integritas index docs**

Run: `node cli/dist/index.js docs index --check 2>/dev/null || npx tsx cli/src/index.ts docs index --check`
Expected: index konsisten (semua doc ter-link). Bila CLI belum ter-build, cukup pastikan tautan ADR baru ada di `internal/docs/README.md` dengan `grep -n "0080" internal/docs/README.md`.

- [ ] **Step 10: Commit**

```bash
git add internal/docs/adr/0080-scope-verifikasi-per-sesi.md internal/docs/README.md internal/docs/architecture/api-contract.md internal/docs/architecture/nfr.md internal/skills/hanoman/SKILL.md AGENTS.md CLAUDE.md
git commit -m "docs(spec-376): ADR-0080 scope verifikasi per sesi + DoD hanoman tak lagi suite penuh"
```

---

### Task 6: Verifikasi nyata di local (boot server + curl)

Task ini menyentuh dua endpoint (`POST /terminal/sessions`, `PUT/GET /settings`), jadi smoke nyata memang berlaku menurut aturan baru — sekali di akhir, bukan tiap task.

**Files:**
- Test: tak ada berkas baru; ini verifikasi runtime.

**Interfaces:**
- Consumes: seluruh Task 1-5.
- Produces: bukti bahwa knob & override benar-benar bekerja lewat HTTP.

- [ ] **Step 1: Siapkan DB sekali-pakai untuk smoke**

Jangan pakai `hanoman_test` (run vitest tetangga men-truncate di tengah smoke) maupun `hanoman`/`hanoman_prod`.

```bash
docker exec hanoman-db-1 psql -U hanoman -d postgres -c 'CREATE DATABASE hanoman376_smoke'
export SMOKE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman376_smoke?schema=public'
env -u NODE_ENV DATABASE_URL="$SMOKE_URL" pnpm --filter ./server exec prisma migrate deploy
```
Expected: `migrate deploy` selesai tanpa error.

- [ ] **Step 2: Boot server di port non-8787**

```bash
env -u NODE_ENV DATABASE_URL="$SMOKE_URL" PORT=8791 pnpm --filter ./server dev
```
Jalankan di background; tunggu sampai `curl -s localhost:8791/api/health` membalas.

- [ ] **Step 3: Bootstrap akun & login**

```bash
curl -s -X POST localhost:8791/api/auth/setup -H 'content-type: application/json' \
  -d '{"email":"smoke@local","password":"smoke-pass-376"}' -c /tmp/hnm376.jar
```
Expected: 200/201 (akun pertama). Cookie tersimpan di jar.

- [ ] **Step 4: Buktikan default `verifyScope` = `changed`**

```bash
curl -s -b /tmp/hnm376.jar localhost:8791/api/settings | python3 -m json.tool | grep -i verifyscope
```
Expected: `"verifyScope": "changed"` — datang dari `.default()` zod tanpa baris `Setting` apa pun di DB.

- [ ] **Step 5: Buktikan knob tersimpan lewat PUT**

```bash
curl -s -b /tmp/hnm376.jar localhost:8791/api/settings > /tmp/s376.json
python3 -c "import json;d=json.load(open('/tmp/s376.json'));d['verifyScope']='full';json.dump(d,open('/tmp/s376b.json','w'))"
curl -s -X PUT -b /tmp/hnm376.jar localhost:8791/api/settings -H 'content-type: application/json' -d @/tmp/s376b.json
curl -s -b /tmp/hnm376.jar localhost:8791/api/settings | grep -o '"verifyScope":"[a-z]*"'
```
Expected: `"verifyScope":"full"` bertahan sesudah PUT.

- [ ] **Step 6: Buktikan body sesi memvalidasi `verifyScope`**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST -b /tmp/hnm376.jar localhost:8791/api/terminal/sessions \
  -H 'content-type: application/json' -d '{"spec":"SPEC-X","flow":"feature","verifyScope":"sebagian"}'
curl -s -o /dev/null -w '%{http_code}\n' -X POST -b /tmp/hnm376.jar localhost:8791/api/terminal/sessions \
  -H 'content-type: application/json' -d '{"spec":"SPEC-X","flow":"feature","verifyScope":"changed"}'
```
Expected: `400` (nilai tak dikenal, ditolak zod **sebelum** lookup spec) lalu `404` (bentuk body sah, spec-nya yang tak ada).
JANGAN mengirim `spec` yang benar-benar ada — itu men-spawn sesi `claude` sungguhan.

- [ ] **Step 7: Bereskan**

```bash
# hentikan proses server background
docker exec hanoman-db-1 psql -U hanoman -d postgres -c 'DROP DATABASE hanoman376_smoke'
rm -f /tmp/hnm376.jar /tmp/s376.json /tmp/s376b.json
```

- [ ] **Step 8: Catat hasil smoke di plan ini**

Tambahkan bagian "## Hasil smoke" di akhir berkas plan ini berisi kode status & nilai yang benar-benar diamati (bukan yang diharapkan), lalu commit:

```bash
git add docs/superpowers/plans/2026-07-29-scope-verifikasi-per-sesi-spec-376.md
git commit -m "docs(spec-376): catat hasil smoke endpoint settings & terminal/sessions"
```

---

## Self-review

**Cakupan spec → task:**

| Bagian spec | Task |
| --- | --- |
| Kosakata `VerifyScope` + `zVerifyScope` | 1 |
| Knob `Setting.verifyScope` tanpa migration | 1 (+3 untuk `DEFAULT_SETTING`) |
| Override per sesi di `zTerminalSession` | 1 (+3 untuk route) |
| `verifyScopeClause` murni & bertest | 2 |
| Penyisipan ke `startPrompt`/`continuePrompt` saja | 2 |
| Env `HANOMAN_BASE_SHA` + `HANOMAN_VERIFY_SCOPE` | 3 |
| Presedens override → global → `changed` | 3 |
| UI Settings + picker Start | 4 |
| ADR-0080 + docs SoT + DoD hanoman | 5 |
| Smoke nyata endpoint tersentuh | 6 |
| Non-goal: tanpa hook deny | ditegakkan di Global Constraints & ADR |

**Konsistensi tipe:** `verifyScope` dipakai dengan nama & tipe yang sama di keenam lapis (`zSetting` → `Setting["verifyScope"]` → `startSpecSession` opts → `startPrompt` param kelima → `verifyScopeClause` argumen → body `api.startSession`). Nilai selalu `"changed"`/`"full"`. Env selalu `HANOMAN_BASE_SHA`/`HANOMAN_VERIFY_SCOPE`.
