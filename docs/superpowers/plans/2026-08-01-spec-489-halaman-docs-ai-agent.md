# SPEC-489 — Halaman dokumentasi AI Agent lewat URL · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Satu naskah markdown (`docs/agent-integration.md`) jadi halaman dokumentasi AI Agent yang lengkap, bisa diambil **mentah lewat URL publik** (`GET /api/agent-integration.md`), dirender di dashboard, dan ditaut dari README + index Source of Truth — sehingga agen mana pun cukup diberi **link + agent token**.

**Architecture:** Tak ada salinan naskah. Berkas markdown di repo adalah satu-satunya sumber; server membacanya dari disk lewat resolver murni bergaya `pickWebDir()` (dua layout: paket npm & checkout), menyajikannya sebagai `text/markdown` di endpoint yang masuk daftar `PUBLIC` `app.ts`; dashboard merender respons endpoint yang **sama**. Anti-basi dijaga test kontrak yang mengikat naskah ke katalog `CAPABILITY_DOMAINS`, daftar `COOKIE_ONLY`, dan enum `zSpecSource`.

**Tech Stack:** Fastify 4 · TypeScript strict · vitest · React 18 + Vite · `marked` (via `ds/markdown.tsx`) · esbuild (bundle server) · `hanoman __pack` (rakit paket npm).

## Global Constraints

- **Bahasa Indonesia** untuk seluruh prosa, komentar, dan salinan UI (konsisten dengan seluruh repo & katalog MCP).
- **Satu sumber tulisan.** Dilarang menduplikasi isi naskah ke berkas/komponen lain. Dashboard dan GitHub wajib berasal dari `docs/agent-integration.md` yang sama.
- **Tak pernah memuat token nyata** di naskah — hanya format/placeholder (`hnm_agt_…`). Dijaga test.
- **Tanpa ADR, tanpa migration, tanpa perubahan skema.** ADR-0065/0087/0099 ditegakkan, bukan diamandemen.
- URL kanonik wajib di bawah **`/api`** — `src/vite.config.ts` hanya mem-proxy `/api` ke server saat `pnpm dev`; path lain milik SPA-fallback.
- Ikuti design system `internal/docs/design-system/**` (editorial, bone paper, brass accent) — pakai primitif `ds/` yang sudah ada, jangan CSS ad-hoc.
- Verifikasi **hanya yang berubah** (ADR-0080): sebut path test langsung; **`--no-file-parallelism` wajib** untuk test server; set `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"` karena sesi tetangga menghapus DB test bersama di tengah run (SPEC-479).
- Perbarui `internal/docs` yang tersentuh **dalam commit yang sama** dan tautkan di `internal/docs/README.md`.

## Struktur berkas

| Berkas | Tanggung jawab |
|---|---|
| `docs/agent-integration.md` | **Naskah tunggal.** Seluruh isi halaman. |
| `server/src/guide-file.ts` | Fungsi murni: dari `distDir` → path absolut naskah, dua layout + override env. Nol I/O sendiri (`exists` disuntik). |
| `server/src/routes/agent-doc.ts` | Satu route `GET /agent-integration.md` (di dalam scope `/api`). Menerima path naskah lewat opsi plugin — tak meresolve sendiri. |
| `server/src/app.ts` | Meresolve path naskah sekali saat boot (depth invariannya sama dengan `pickWebDir`), mendaftarkan route, menaruhnya di `PUBLIC`. |
| `cli/src/release/pack.ts` | Naskah ikut terbit di paket npm & jadi artefak wajib. |
| `shared/src/api.ts` | `paths.agentDoc` — satu definisi URL untuk klien. |
| `src/src/api/client.ts` | `api.agentDoc()` — ambil **teks mentah** (bukan JSON). |
| `src/src/screens/AgentDocCard.tsx` | Kartu "Dokumentasi AI Agent" di Settings: URL siap-salin + modal render. |

---

### Task 1: Resolver murni path naskah

**Files:**
- Create: `server/src/guide-file.ts`
- Test: `server/test/guide-file.test.ts`

**Interfaces:**
- Consumes: `EnvLike` dari `@hanoman/runner` (dipakai juga `server/src/web-dir.ts`).
- Produces: `AGENT_DOC_REL: string` (= `"docs/agent-integration.md"`) dan `pickGuideFile(distDir: string, env: EnvLike, exists: (p: string) => boolean): string | null`. Dipakai Task 2 (lewat `app.ts`).

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/guide-file.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pickGuideFile, AGENT_DOC_REL } from "../src/guide-file";

// `exists` disuntik supaya test tak menyentuh filesystem sama sekali (pola web-dir.test.ts).
const only = (...paths: string[]) => (p: string) => paths.includes(p);

describe("pickGuideFile", () => {
  it("layout paket npm: <pkg>/dist → <pkg>/docs/agent-integration.md", () => {
    const hit = `/usr/lib/node_modules/hanoman/${AGENT_DOC_REL}`;
    expect(pickGuideFile("/usr/lib/node_modules/hanoman/dist", {}, only(hit))).toBe(hit);
  });

  it("layout checkout terbangun: <repo>/server/dist → <repo>/docs/agent-integration.md", () => {
    const hit = `/repo/${AGENT_DOC_REL}`;
    expect(pickGuideFile("/repo/server/dist", {}, only(hit))).toBe(hit);
  });

  // tsx menjalankan sumbernya langsung; `server/src` sedalam `server/dist`, jadi satu kandidat
  // yang sama melayani dev DAN build. Kalau invarian ini pecah, dev diam-diam kehilangan dokumen.
  it("layout checkout dev (tsx): <repo>/server/src → <repo>/docs/agent-integration.md", () => {
    const hit = `/repo/${AGENT_DOC_REL}`;
    expect(pickGuideFile("/repo/server/src", {}, only(hit))).toBe(hit);
  });

  it("tak ketemu di mana pun → null (bukan melempar)", () => {
    expect(pickGuideFile("/repo/server/dist", {}, () => false)).toBeNull();
  });

  it("HANOMAN_AGENT_DOC menang atas kedua kandidat", () => {
    const forced = "/tmp/panduan.md";
    expect(pickGuideFile("/repo/server/dist", { HANOMAN_AGENT_DOC: forced }, only(forced, `/repo/${AGENT_DOC_REL}`)))
      .toBe(forced);
  });

  // Cermin HANOMAN_WEB_DIR: "dokumen hilang tanpa pesan" mahal didiagnosis, jadi override yang
  // salah gagal KERAS, bukan diam-diam jatuh ke kandidat.
  it("HANOMAN_AGENT_DOC di-set tapi tak ada → melempar", () => {
    expect(() => pickGuideFile("/repo/server/dist", { HANOMAN_AGENT_DOC: "/tmp/hilang.md" }, () => false))
      .toThrow(/HANOMAN_AGENT_DOC/);
  });

  it("override kosong/spasi diabaikan", () => {
    const hit = `/repo/${AGENT_DOC_REL}`;
    expect(pickGuideFile("/repo/server/dist", { HANOMAN_AGENT_DOC: "  " }, only(hit))).toBe(hit);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-489
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --no-file-parallelism server/test/guide-file.test.ts
```

Expected: FAIL — `Failed to resolve import "../src/guide-file"`.

- [ ] **Step 3: Implementasi minimal**

Buat `server/src/guide-file.ts`:

```ts
// SPEC-489 · naskah panduan AI agent (`docs/agent-integration.md`) disajikan MENTAH lewat
// `GET /api/agent-integration.md`. Ia berada di dua tempat, persis seperti aset dashboard:
// `docs/` di dalam paket npm (bersebelahan dengan `dist`) atau `docs/` di root checkout.
// Murni supaya bisa dites tanpa filesystem; cermin `web-dir.ts`.
import { resolve } from "node:path";
import type { EnvLike } from "@hanoman/runner";

/** Path naskah relatif terhadap root paket / root checkout. Satu definisi untuk server & pack. */
export const AGENT_DOC_REL = "docs/agent-integration.md";

export function pickGuideFile(distDir: string, env: EnvLike, exists: (p: string) => boolean): string | null {
  const forced = env.HANOMAN_AGENT_DOC?.trim();
  if (forced) {
    // Gagal KERAS: override yang salah lebih baik terbaca sebagai galat daripada jadi 404 misterius.
    if (!exists(forced)) throw new Error(`HANOMAN_AGENT_DOC menunjuk berkas yang tak ada: ${forced}`);
    return forced;
  }
  // `..`  → paket npm (<pkg>/dist).
  // `../..` → checkout, melayani `server/dist` (build) DAN `server/src` (tsx dev) sekaligus.
  for (const c of [resolve(distDir, "..", AGENT_DOC_REL), resolve(distDir, "../..", AGENT_DOC_REL)]) {
    if (exists(c)) return c;
  }
  return null;
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --no-file-parallelism server/test/guide-file.test.ts
```

Expected: PASS — 7 test.

- [ ] **Step 5: Commit**

```bash
git add server/src/guide-file.ts server/test/guide-file.test.ts
git commit -m "feat(489): resolver murni path naskah panduan AI agent"
```

---

### Task 2: Endpoint publik `GET /api/agent-integration.md`

**Files:**
- Create: `server/src/routes/agent-doc.ts`
- Modify: `server/src/app.ts` (import, `PUBLIC`, resolusi path, register)
- Test: `server/test/agent-doc.route.test.ts`

**Interfaces:**
- Consumes: `pickGuideFile`, `AGENT_DOC_REL` (Task 1).
- Produces: route `GET /api/agent-integration.md` → `200 text/markdown; charset=utf-8` berisi byte naskah apa adanya; `404 { error }` bila naskah tak ada di instalasi. `buildApp({ requireAuth?, agentDocFile? })` — opsi baru `agentDocFile?: string | null` menimpa resolusi otomatis (dipakai test).

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/agent-doc.route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueAgentToken } from "../src/services/agent-token";

const dir = mkdtempSync(join(tmpdir(), "hanoman-doc-"));
const file = join(dir, "agent-integration.md");
writeFileSync(file, "# hanoman — integrasi AI agent\n\nBearer hnm_agt_…\n");

// requireAuth: true = gerbang produksi. Kalau endpoint ini bocor dari daftar PUBLIC, test
// pertama langsung 401 — itulah gunanya membangun app-nya bergerbang penuh di sini.
const app = buildApp({ agentDocFile: file });
const appTanpaNaskah = buildApp({ agentDocFile: null });

const blob = (agentAccessEnabled: boolean) => ({
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true,
  notifyFail: true, notifyDone: true, notifySound: "short",
  notifyDecision: true, notifyDecisionSound: "alert", agentAccessEnabled,
});
const clean = async () => {
  await prisma.agentToken.deleteMany(); await prisma.setting.deleteMany();
  await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(clean);
afterAll(clean);

describe("GET /api/agent-integration.md", () => {
  it("tanpa auth apa pun → 200 text/markdown", async () => {
    const r = await app.inject({ method: "GET", url: "/api/agent-integration.md" });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("text/markdown");
    expect(r.body).toContain("# hanoman — integrasi AI agent");
  });

  // Justru inilah alasan endpoint ini publik: agen yang tokennya kurang capability tak boleh
  // menerima 403 pada dokumen yang menjelaskan arti 403 itu.
  it("agent token ber-capability KOSONG tetap 200", async () => {
    await prisma.setting.upsert({ where: { id: 1 }, update: { data: blob(true) }, create: { id: 1, data: blob(true) } });
    const { token } = await issueAgentToken({ name: "bot", capabilities: [] });
    const r = await app.inject({
      method: "GET", url: "/api/agent-integration.md",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
  });

  it("token sampah tak mengubah apa pun — tetap 200", async () => {
    const r = await app.inject({
      method: "GET", url: "/api/agent-integration.md",
      headers: { authorization: "Bearer hnm_agt_bukan-token" },
    });
    expect(r.statusCode).toBe(200);
  });

  it("naskah tak ada di instalasi → 404 JSON yang menyebut berkasnya, bukan 500", async () => {
    const r = await appTanpaNaskah.inject({ method: "GET", url: "/api/agent-integration.md" });
    expect(r.statusCode).toBe(404);
    expect(r.json().error).toContain("docs/agent-integration.md");
  });

  // Hanya BACA. Tak ada jalur tulis ke naskah — kalau ada, ia akan publik juga.
  it("method tulis tidak ada", async () => {
    const r = await app.inject({ method: "PUT", url: "/api/agent-integration.md" });
    expect(r.statusCode).not.toBe(200);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --no-file-parallelism server/test/agent-doc.route.test.ts
```

Expected: FAIL — `buildApp` belum menerima `agentDocFile`; route 404/401.

- [ ] **Step 3: Implementasi minimal**

Buat `server/src/routes/agent-doc.ts`:

```ts
// SPEC-489 · satu berkas, satu route. Naskah panduan AI agent disajikan MENTAH supaya agen bisa
// membacanya dengan HTTP client apa pun — bukan hanya lewat dashboard ber-JS. PUBLIC (didaftarkan
// di app.ts): isinya sudah publik di GitHub, dan menggerbanginya berarti agen yang capability-nya
// kurang menerima 403 pada dokumen yang justru menjelaskan arti 403 itu.
// Path naskah TIDAK diresolve di sini: `import.meta.url` berkas ini sedalam `server/src/routes`
// saat dev tapi `server/dist` sesudah dibundel esbuild — dua kedalaman berbeda. app.ts memegang
// satu-satunya titik yang kedalamannya invarian (cermin pickWebDir).
import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { AGENT_DOC_REL } from "../guide-file";

export default async function (app: FastifyInstance, opts: { file: string | null }) {
  app.get("/agent-integration.md", async (_req, reply) => {
    if (!opts.file)
      return reply.code(404).send({
        error: `dokumen panduan tak ada di instalasi ini (${AGENT_DOC_REL}) — pasang ulang paket hanoman atau set HANOMAN_AGENT_DOC`,
      });
    const text = await readFile(opts.file, "utf8");
    return reply.type("text/markdown; charset=utf-8").send(text);
  });
}
```

Ubah `server/src/app.ts`:

1. Tambah import (di dekat import route lain):

```ts
import agentDoc from "./routes/agent-doc";
import { pickGuideFile } from "./guide-file";
```

2. Tambah entri ke `PUBLIC`:

```ts
const PUBLIC = new Set([
  "GET /api/health",
  "GET /api/auth/status",
  "POST /api/auth/login",
  "POST /api/auth/setup",
  // SPEC-489 · panduan AI agent. Sengaja tanpa auth: byte-nya sudah publik di GitHub, dan
  // "cukup diberi link + token" hanya benar bila link-nya terbaca SEBELUM token disetel.
  "GET /api/agent-integration.md",
]);
```

3. Ubah tanda tangan `buildApp` + resolusi path:

```ts
export function buildApp(
  { requireAuth = true, agentDocFile }:
  { requireAuth?: boolean; agentDocFile?: string | null } = {},
): FastifyInstance {
```

Tepat sebelum `const app = Fastify(...)` (atau tepat sesudahnya, sebelum `app.register`):

```ts
  // SPEC-489 · diresolve DI SINI, bukan di route-nya: `import.meta.url` app.ts sedalam
  // `server/src` (tsx) DAN `server/dist` (esbuild) — satu kedalaman, jadi satu kandidat
  // melayani keduanya. Pola & alasan identik dengan pickWebDir di bawah.
  const docFile = agentDocFile !== undefined
    ? agentDocFile
    : pickGuideFile(dirname(fileURLToPath(import.meta.url)), process.env, existsSync);
```

4. Daftarkan di dalam scope `/api`, sesudah `await api.register(health);`:

```ts
    await api.register(agentDoc, { file: docFile });   // SPEC-489 · panduan AI agent (PUBLIC)
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --no-file-parallelism \
  server/test/agent-doc.route.test.ts server/test/agent-gate.test.ts server/test/app.test.ts
```

Expected: PASS semua — 5 test baru + gate lama tak berubah.

- [ ] **Step 5: Typecheck server**

```bash
pnpm --filter ./server typecheck
```

Expected: exit 0, tanpa keluaran.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/agent-doc.ts server/src/app.ts server/test/agent-doc.route.test.ts
git commit -m "feat(489): sajikan naskah panduan AI agent mentah di GET /api/agent-integration.md (publik)"
```

---

### Task 3: Naskah ikut terbit di paket npm

**Files:**
- Modify: `cli/src/release/pack.ts` (`copyPlan`, `REQUIRED_ARTIFACTS`, `packageJsonFor().files`)
- Test: `cli/test/pack.test.ts`

**Interfaces:**
- Consumes: konstanta path literal `"docs/agent-integration.md"` (nilai yang sama dengan `AGENT_DOC_REL`; `cli` tak mengimpor dari `server`, jadi sengaja ditulis literal dan diikat test).
- Produces: paket npm membawa `docs/agent-integration.md` di root paket → dikenali kandidat pertama `pickGuideFile`.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `cli/test/pack.test.ts` — di dalam `describe("packageJsonFor", …)`:

```ts
  // SPEC-489 · tanpa "docs" di files, npm membuang naskah panduan dan `GET /api/agent-integration.md`
  // menjawab 404 di setiap instalasi npm — sementara di checkout dev semuanya terlihat sehat.
  it("files memuat docs (naskah panduan AI agent)", () => {
    expect(pkg.files).toContain("docs");
  });
```

Dan di dalam `describe("copyPlan", …)`:

```ts
  it("menyalin naskah panduan AI agent ke root paket", () => {
    const plan = copyPlan("/repo");
    const doc = plan.find((i) => i.to === "docs/agent-integration.md");
    expect(doc).toBeDefined();
    expect(doc!.from).toBe("/repo/docs/agent-integration.md");
    expect(doc!.dir).toBeUndefined();   // berkas, bukan direktori
  });
```

Dan sebagai `describe` baru di akhir berkas:

```ts
// Gerbang rilis: `hanoman __pack` memeriksa REQUIRED_ARTIFACTS sesudah menyalin. Naskah yang
// hilang harus menggagalkan pack, bukan diam-diam terbit sebagai paket tanpa dokumentasi.
describe("REQUIRED_ARTIFACTS", () => {
  it("menuntut naskah panduan AI agent", () => {
    expect(REQUIRED_ARTIFACTS).toContain("docs/agent-integration.md");
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
./node_modules/.bin/vitest run --no-file-parallelism cli/test/pack.test.ts
```

Expected: FAIL — 3 test baru merah (`files` tanpa `"docs"`, `copyPlan` tanpa entri, `REQUIRED_ARTIFACTS` tanpa entri).

- [ ] **Step 3: Implementasi minimal**

Di `cli/src/release/pack.ts`:

1. `REQUIRED_ARTIFACTS` — tambah satu entri:

```ts
export const REQUIRED_ARTIFACTS = [
  "package.json", "bin/hanoman.mjs", "dist/cli.js", "dist/server.js",
  "prisma/schema.prisma", "web/index.html", "README.md", "LICENSE",
  // SPEC-489 · naskah panduan AI agent — disajikan runtime di GET /api/agent-integration.md.
  "docs/agent-integration.md",
] as const;
```

2. `packageJsonFor().files`:

```ts
    files: ["bin", "dist", "web", "prisma", "docs", "README.md", "LICENSE"],
```

3. `copyPlan()` — tambah sebelum entri `LICENSE`:

```ts
    // SPEC-489 · dibaca runtime oleh pickGuideFile (kandidat `<pkg>/docs/...`). Bukan README:
    // README paket adalah npm-readme.md, sedangkan ini naskah berhadapan-AGEN.
    { from: join(repo, "docs/agent-integration.md"), to: "docs/agent-integration.md" },
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```bash
./node_modules/.bin/vitest run --no-file-parallelism cli/test/pack.test.ts
```

Expected: PASS semua.

- [ ] **Step 5: Typecheck cli**

```bash
pnpm --filter ./cli typecheck
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add cli/src/release/pack.ts cli/test/pack.test.ts
git commit -m "feat(489): naskah panduan AI agent ikut terbit di paket npm"
```

---

### Task 4: Naskah lengkap + test kontrak anti-basi

Ini task terbesar: menulis isinya. Test ditulis **lebih dulu** supaya kelengkapannya jadi kontrak, bukan pendapat.

**Files:**
- Modify: `docs/agent-integration.md`
- Test: `server/test/agent-doc-contract.test.ts`

**Interfaces:**
- Consumes: `CAPABILITY_DOMAINS` (`@hanoman/shared`), `capabilityForRoute` (`server/src/services/agent-capabilities.ts`), `zSpecSource` (`@hanoman/shared`).
- Produces: naskah yang memenuhi struktur §0–§13 di bawah. Task 5 & 6 hanya menautkannya.

- [ ] **Step 1: Tulis test kontrak yang gagal**

Buat `server/test/agent-doc-contract.test.ts`:

```ts
// SPEC-489 · kendala "satu sumber tulisan" memaksa naskah jadi markdown, jadi tabel capability &
// cookie-only tak bisa DI-RENDER dari katalog seperti WebhookDocs (ADR-0100). Gantinya: katalog
// mengikat naskah lewat test. Katalog bertambah → test merah → naskah ikut diperbarui.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { CAPABILITY_DOMAINS, zSpecSource } from "@hanoman/shared";
import { capabilityForRoute } from "../src/services/agent-capabilities";

const DOC = resolve(dirname(fileURLToPath(import.meta.url)), "../../docs/agent-integration.md");
const doc = readFileSync(DOC, "utf8");

describe("naskah panduan AI agent", () => {
  it("menyebut SETIAP domain capability", () => {
    const hilang = CAPABILITY_DOMAINS.map((d) => d.domain).filter((d) => !doc.includes(`\`${d}\``));
    expect(hilang).toEqual([]);
  });

  it("menyebut SETIAP segmen route cookie-only", () => {
    // Segmen teratas yang gate-nya jawab COOKIE_ONLY untuk method BACA (paling ketat).
    const kandidat = ["auth", "agent-tokens", "device-tokens", "sync", "webhooks"];
    for (const seg of kandidat) expect(capabilityForRoute("GET", `/api/${seg}`)).toBe("COOKIE_ONLY");
    const hilang = kandidat.filter((s) => !doc.includes(`/api/${s}`));
    expect(hilang).toEqual([]);
    // Sub-path kredensial Telegram (ADR-0097) juga cookie-only dan wajib disebut.
    expect(capabilityForRoute("GET", "/api/telegram/credentials")).toBe("COOKIE_ONLY");
    expect(doc).toContain("/api/telegram/credentials");
  });

  it("menyebut SETIAP nilai source backlog di tabel payload", () => {
    const hilang = zSpecSource.options.filter((s) => !doc.includes(`\`${s}\``));
    expect(hilang).toEqual([]);
  });

  it("menyebut ketiga tindakan berbahaya yang wajib konfirmasi manusia", () => {
    for (const p of ["POST /api/terminal/sessions", "/api/vps", "POST /api/lead/decisions"])
      expect(doc).toContain(p);
  });

  it("menyebut jebakan yang sudah diketahui", () => {
    for (const j of ["startable", "q", "id", "stage"]) expect(doc).toContain(`\`${j}\``);
    expect(doc).toContain("GET /api/agent-integration.md");
  });

  // Kendala mutlak: dokumen ini terbit publik. Hanya format/placeholder, tak pernah token nyata.
  it("tak memuat token yang terlihat nyata", () => {
    expect(doc).not.toMatch(/hnm_agt_[0-9a-f]{16,}/);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --no-file-parallelism server/test/agent-doc-contract.test.ts
```

Expected: FAIL — minimal pada domain `telegram` (belum disebut), `/api/webhooks` (belum disebut), source `audit`/`help`/`goal`, dan tabel jebakan.

- [ ] **Step 3: Tulis ulang `docs/agent-integration.md`**

Pertahankan judul & isi yang sudah ada; **tambah** bagian baru dan **perbaiki** yang basi. Struktur final:

| § | Judul | Isi |
|---|---|---|
| 0 | Apa itu hanoman & bagaimana ia bekerja | orchestrator + dashboard docs-driven; **backlog item → sesi agen di tmux → git worktree terisolasi per backlog**; fase = giliran dalam satu sesi (`Brainstorm → Objective → Spec → Plan → Execute`), bukan proses terpisah; `internal/docs/**` = Source of Truth; dashboard React hanyalah satu klien REST |
| 1 | Nyalakan akses & buat token (manusia, sekali) | **tak berubah** |
| 2 | Base URL & autentikasi | `HANOMAN_HOST` **tanpa `/` di ekor**; seluruh path berawalan `/api`; `Authorization: Bearer hnm_agt_…`; WS pakai `?agent_token=`; probe `GET /api/health` (PUBLIC) untuk memisahkan "host salah" dari "token salah"; panduan ini sendiri di `GET $HANOMAN_HOST/api/agent-integration.md` |
| 3 | Capability | tabel domain — **tambah baris `telegram`**; aturan `GET`/`HEAD` → `:read`, lainnya → `:write`; write ⊇ read |
| 4 | Gate & kode status | tabel 401/403 + arti field `need` — **tak berubah** |
| 5 | Cookie-only (selalu 403) | `/api/auth*`, `/api/agent-tokens*`, `/api/device-tokens*`, `/api/sync*` — **tambah `/api/webhooks*`** (ADR-0100) dan **`/api/telegram/settings`, `/api/telegram/test`, `/api/telegram/credentials`** (ADR-0097); route tak dikenal default cookie-only |
| 6 | Endpoint yang paling sering dipakai | tabel di Step 3b |
| 7 | `POST /api/specs` — payload per `source` | tabel di Step 3c |
| 8 | Tindakan berbahaya — wajib konfirmasi manusia | tabel di Step 3d |
| 9 | Jebakan yang sudah diketahui | tabel di Step 3e |
| 10 | Contoh alur end-to-end | blok bash di Step 3f |
| 11 | Minta putusan ke hanoman-lead | isi §6b sekarang, dipindah utuh |
| 12 | Keamanan | isi §7 sekarang |
| 13 | MCP server | isi §8 sekarang, utuh |

- [ ] **Step 3b: §6 — tabel endpoint**

```markdown
| Method & path | Capability | Catatan |
|---|---|---|
| `GET /api/health` | — (publik) | probe host. Tanpa auth. |
| `GET /api/agent-integration.md` | — (publik) | panduan ini, markdown mentah. |
| `GET /api/projects` | `projects:read` | daftar project (id = slug yang dipakai `POST /api/specs`). |
| `GET /api/projects/:id` | `projects:read` | detail satu project. |
| `GET /api/specs` | `backlog:read` | backlog. Filter: `project`, `source`, `q`, `stage`, `priority`, `startable=true`, `dateField=created\|started` + `from`/`to` (`YYYY-MM-DD`, inklusif), `page`, `limit`. |
| `POST /api/specs` | `backlog:write` | buat backlog item — bentuk payload di §7. |
| `PATCH /api/specs/:id` | `backlog:write` | ubah item; konten hanya selagi belum dimulai. |
| `GET /api/specs/:id/docs` | `backlog:read` | dokumen yang ditulis sesi item itu. |
| `GET /api/specs/:id/review` | `backlog:read` | diff hasil kerja sesi. |
| `GET /api/projects/:id/docs` | `docs:read` | index Source of Truth project. |
| `GET /api/projects/:id/docs/<path>` | `docs:read` | isi satu dokumen. |
| `GET /api/terminal/sessions` | `sessions:read` | sesi yang sedang hidup. |
| `GET /api/notifications` | `notifications:read` | notifikasi. |
| `GET /api/tickets` | `support:read` | tiket Help Center. |
| `GET /api/lead/decisions` | `lead:read` | jejak keputusan hanoman-lead. |
| `POST /api/lead/decisions` | `lead:write` | minta putusan — **§8**. |
```

- [ ] **Step 3c: §7 — payload per source**

```markdown
`source` dan bentuk `payload` **saling mengikat**. Salah pasang → **400**
`"bentuk payload tak cocok dengan source"` — union saja tak menjaganya, jadi server menegakkannya
di boundary.

| `source` | Bentuk `payload` | Field |
|---|---|---|
| `brief` | brief | `context`, `outcome`, `constraints`, `priority` |
| `audit` | brief | idem — audit-only: hasilnya dokumen temuan, tanpa Execute |
| `help` | brief | idem — item yang lahir dari tiket Help Center |
| `qa` | qa | `severity` (`critical`\|`major`\|`minor`), `steps`, `expected`, `actual`, `env` |
| `goal` | goal | `goal` (wajib), `done`, `constraints`, `priority` |

Body lengkap: `project` (slug), `source`, `title`, `priority`
(`tinggi`\|`sedang`\|`rendah`), `payload`, opsional `branchFrom` dan `dependsOn` (array id backlog).

Turunan yang **tak** kamu kirim: `objective` diturunkan server dari payload (`outcome`/`context`
untuk brief, `actual`/`steps` untuk qa, `goal` untuk goal), dan `priority` untuk `qa` diturunkan
dari `severity`.

​```json
{
  "project": "hanoman",
  "source": "qa",
  "title": "Tombol Lanjutkan diam saat pane mati",
  "priority": "tinggi",
  "payload": {
    "severity": "major",
    "steps": "Buka Terminal → tunggu sesi keluar → klik Lanjutkan",
    "expected": "Sesi dilanjutkan dari fase terakhir",
    "actual": "Tak terjadi apa-apa",
    "env": "hanoman 0.1.13, macOS"
  }
}
​```
```

- [ ] **Step 3d: §8 — tindakan berbahaya**

```markdown
Tiga permukaan ini **wajib** kamu konfirmasikan ke manusia lebih dulu, walaupun token-mu sudah
punya capability-nya. Capability menjawab "boleh?", bukan "sebaiknya?".

| Tindakan | Kenapa |
|---|---|
| `POST /api/terminal/sessions` | melahirkan proses agen `--dangerously-skip-permissions` di sebuah worktree — **RCE efektif**. Batas satu-satunya adalah isolasi git worktree. |
| `POST`/`PUT`/`DELETE` di `/api/vps` | remote exec di server produksi. |
| `POST /api/lead/decisions` | putusannya bisa **menggerakkan sesi** (integrate ke main, menghentikan sesi) dan selalu melahirkan baris jejak permanen. |

Preseden yang mengikat: MCP server resmi (`hanoman mcp`) sengaja **tak punya tool** untuk ketiganya
— juga tidak untuk `integrate`, `DELETE /api/specs/:id`, dan perubahan `stage`. Batasnya ada di
katalog tool, bukan di token. Perlakukan REST dengan disiplin yang sama.
```

- [ ] **Step 3e: §9 — jebakan**

```markdown
| Jebakan | Yang benar |
|---|---|
| `startable` hanya bereaksi pada string **`"true"`**; nilai lain (`false`, `1`, `yes`) diabaikan **senyap** dan kamu mendapat daftar penuh | kirim `?startable=true`, atau jangan kirim sama sekali |
| `q` mencari di `id`, `title`, dan `objective` saja — ia **tak menyentuh `payload`** | untuk mencari isi brief/QA, ambil itemnya lalu baca `payload` sendiri |
| `id` dan `stage` yang kamu kirim ke `POST /api/specs` **dibuang diam-diam** — tak ada galat | id diterbitkan server (`SPEC-nnn` berikutnya), stage selalu mulai `brainstorming`. Untuk mengubah stage pakai `PATCH`, dan ia hanya boleh **mundur** |
| **`GET /api/specs/:id` tidak ada** | `GET /api/specs?q=SPEC-489` lalu cocokkan `id` **persis** — `q` itu substring |
| daftar mengembalikan amplop `{ items, total, page, pageSize }` | jangan perlakukan responsnya sebagai array |
| tanpa `limit`, daftar mengembalikan **seluruh** item dalam satu halaman | kirim `limit` untuk backlog besar |
| `PATCH /api/specs/:id` menolak edit konten begitu item pernah dimulai | ubah judul/payload hanya selagi `startable` & belum ada sesi |
| **401 telanjang** tak memisahkan "host salah" dari "token salah" dari "master switch mati" | probe `GET /api/health` sekali: 200 = host benar → masalahnya token/master switch |
```

- [ ] **Step 3f: §10 — alur end-to-end**

```markdown
​```bash
export HANOMAN_HOST="https://hanoman.example"        # tanpa "/" di ekor
export HANOMAN_AGENT_TOKEN="hnm_agt_…"               # dari Settings → Akses AI Agent
auth=(-H "Authorization: Bearer $HANOMAN_AGENT_TOKEN")

# 0. Host benar? (publik, tanpa auth — memisahkan "host salah" dari "token salah")
curl -fsS "$HANOMAN_HOST/api/health"

# 0b. Baca panduan ini sendiri (publik, markdown mentah)
curl -fsS "$HANOMAN_HOST/api/agent-integration.md"

# 1. Project apa saja yang ada? (projects:read) — `id` di sini yang dipakai langkah berikutnya
curl -fsS "${auth[@]}" "$HANOMAN_HOST/api/projects"

# 2. Backlog yang belum selesai di satu project (backlog:read)
curl -fsS "${auth[@]}" "$HANOMAN_HOST/api/specs?project=hanoman&startable=true&limit=20"

# 3. Ada item tentang "webhook"? (q = substring atas id+title+objective, BUKAN payload)
curl -fsS "${auth[@]}" "$HANOMAN_HOST/api/specs?project=hanoman&q=webhook"

# 4. Filekan temuan sebagai backlog item (backlog:write)
curl -fsS -X POST "$HANOMAN_HOST/api/specs" "${auth[@]}" \
  -H "Content-Type: application/json" \
  -d '{
        "project": "hanoman",
        "source": "qa",
        "title": "Preview docs menggulir ke samping",
        "priority": "sedang",
        "payload": { "severity": "minor", "steps": "Buka Docs → pilih .md panjang",
                     "expected": "Teks membungkus", "actual": "Muncul scrollbar horizontal",
                     "env": "hanoman 0.1.13, Chrome" }
      }'
# → 201 { "id": "SPEC-490", ... }   ← id datang dari server, jangan pernah dikirim

# 5. Ambil satu item (tak ada GET /api/specs/:id — pakai q lalu cocokkan persis)
curl -fsS "${auth[@]}" "$HANOMAN_HOST/api/specs?q=SPEC-490" \
  | python3 -c 'import json,sys; print([s for s in json.load(sys.stdin)["items"] if s["id"]=="SPEC-490"])'

# 6. Baca Source of Truth project sebelum mengusulkan apa pun (docs:read)
curl -fsS "${auth[@]}" "$HANOMAN_HOST/api/projects/hanoman/docs"

# 7. 403? Bacanya bukan "gagal" — bacanya "tambahkan capability ini ke token"
#    → { "error": "capability required", "need": "backlog:write" }
​```

**Yang TIDAK dilakukan tanpa manusia:** menjalankan backlog itu
(`POST /api/terminal/sessions`) — lihat §8.
```

- [ ] **Step 4: Jalankan test kontrak, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --no-file-parallelism \
  server/test/agent-doc-contract.test.ts server/test/agent-doc.route.test.ts
```

Expected: PASS — 6 test kontrak + 5 test route.

- [ ] **Step 5: Commit**

```bash
git add docs/agent-integration.md server/test/agent-doc-contract.test.ts
git commit -m "docs(489): naskah panduan AI agent lengkap + test kontrak katalog"
```

---

### Task 5: Kartu "Dokumentasi AI Agent" di Settings

**Files:**
- Modify: `shared/src/api.ts` (`paths.agentDoc`)
- Modify: `src/src/api/client.ts` (`api.agentDoc()`)
- Create: `src/src/screens/AgentDocCard.tsx`
- Modify: `src/src/screens/SettingsScreen.tsx` (pasang kartu, buang tombol GitHub telanjang lama)
- Test: `src/test/AgentDocCard.test.tsx`

**Interfaces:**
- Consumes: endpoint Task 2.
- Produces: `paths.agentDoc: string` (= `` `${API}/agent-integration.md` ``); `api.agentDoc(): Promise<string>`; komponen `<AgentDocCard onToast={...} />`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/AgentDocCard.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentDocCard } from "../src/screens/AgentDocCard";

const MD = "# hanoman — integrasi AI agent\n\n## 0. Apa itu hanoman\n\nOrchestrator.\n";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(MD, {
    status: 200, headers: { "content-type": "text/markdown" },
  })));
});

describe("AgentDocCard", () => {
  it("menampilkan URL absolut yang bisa disalin agen", () => {
    render(<AgentDocCard />);
    expect(screen.getByText(`${window.location.origin}/api/agent-integration.md`)).toBeTruthy();
  });

  // Kunci "satu sumber": yang dirender di dashboard adalah respons endpoint yang sama dengan
  // yang dibaca agen. Kalau komponen ini pernah menyimpan naskahnya sendiri, test ini merah.
  it("tombol Buka merender isi dari endpoint, bukan salinan lokal", async () => {
    render(<AgentDocCard />);
    await userEvent.click(screen.getByRole("button", { name: /buka/i }));
    await waitFor(() => expect(screen.getByText("Apa itu hanoman")).toBeTruthy());
    expect(fetch).toHaveBeenCalledWith("/api/agent-integration.md", expect.anything());
  });

  it("endpoint gagal → pesan galat, bukan modal kosong", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    render(<AgentDocCard />);
    await userEvent.click(screen.getByRole("button", { name: /buka/i }));
    await waitFor(() => expect(screen.getByText(/gagal memuat/i)).toBeTruthy());
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --dir src src/test/AgentDocCard.test.tsx
```

Expected: FAIL — `Failed to resolve import "../src/screens/AgentDocCard"`.

> `env -u NODE_ENV` wajib: shell mesin ini menunjuk `production`, dan itu membuat RTL `act` gagal massal.

- [ ] **Step 3: Implementasi**

1. `shared/src/api.ts` — tambah di dekat `paths.docs`:

```ts
  // SPEC-489 · panduan AI agent, markdown MENTAH & PUBLIC. Satu definisi URL untuk klien web
  // dan untuk teks yang disalin operator ke agennya.
  agentDoc: `${API}/agent-integration.md`,
```

2. `src/src/api/client.ts` — tambah di objek `api` (dekat `getEscalation`):

```ts
  // SPEC-489 · teks MENTAH, bukan JSON — `j()` akan mencoba mem-parse dan gagal.
  agentDoc: async (): Promise<string> => {
    const res = await fetch(paths.agentDoc, { headers: { accept: "text/markdown" } });
    if (!res.ok) throw new ApiError(res.status, `GET ${paths.agentDoc} → ${res.status}`);
    return res.text();
  },
```

3. Buat `src/src/screens/AgentDocCard.tsx`:

```tsx
/* SPEC-489 · Kartu "Dokumentasi AI Agent" — permukaan manusia untuk naskah yang dibaca AGEN.
   Yang dirender di sini adalah respons `GET /api/agent-integration.md` itu sendiri, bukan salinan:
   kendala fitur ini adalah satu sumber tulisan, jadi dashboard dan GitHub tak boleh bisa berbeda
   (pola WebhookDocs SPEC-481, hanya saja sumbernya berkas markdown, bukan katalog). */
import React from "react";
import { Card, Button } from "../ds";
import { StateBlock } from "../ds/components/state";
import { DocPreviewModal } from "../ds/DocPreviewModal";
import { paths } from "@hanoman/shared";
import { api } from "../api/client";

const GITHUB = "https://github.com/denameidina/hanoman/blob/main/docs/agent-integration.md";

export function AgentDocCard({ onToast }: {
  onToast?: (msg: string, kind?: "ok" | "err" | "warn", icon?: string) => void;
}) {
  const [text, setText] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const [err, setErr] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  // Absolut: nilainya disalin ke agen yang jalan di mesin lain, jadi path relatif tak berguna.
  const url = `${window.location.origin}${paths.agentDoc}`;

  async function buka() {
    setOpen(true);
    if (text || busy) return;
    setBusy(true); setErr(false);
    try { setText(await api.agentDoc()); }
    catch { setErr(true); }
    finally { setBusy(false); }
  }

  return (
    <>
      <Card eyebrow="dokumentasi" title="Dokumentasi AI Agent">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
          Satu halaman yang membuat agen mana pun bisa langsung bekerja — cukup berikan
          <b> tautan ini + satu agent token</b>. Markdown mentah, bisa diambil agen lewat HTTP biasa,
          <b> tanpa auth</b>.
        </div>
        <code style={{ display: "block", wordBreak: "break-all", fontSize: 12, marginBottom: 10 }}>{url}</code>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button size="sm" leftIcon="copy" onClick={() => {
            void navigator.clipboard?.writeText(url); onToast?.("Tautan disalin", "ok", "copy");
          }}>Salin tautan</Button>
          <Button size="sm" variant="ghost" leftIcon="book-open" onClick={() => void buka()}>Buka</Button>
          <a href={GITHUB} target="_blank" rel="noreferrer">
            <Button size="sm" variant="ghost" leftIcon="github">Lihat di GitHub</Button>
          </a>
        </div>
      </Card>

      {open && (err
        ? <Card eyebrow="dokumentasi" title="Dokumentasi AI Agent">
            <StateBlock kind="error" icon="alert-triangle" title="Gagal memuat dokumentasi"
              hint={url} />
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Tutup</Button>
          </Card>
        : <DocPreviewModal path="agent-integration.md" text={text ?? ""}
            eyebrow="hanoman · panduan AI agent" onClose={() => setOpen(false)} />)}
    </>
  );
}
```

4. `src/src/screens/SettingsScreen.tsx`:
   - tambah `import { AgentDocCard } from "./AgentDocCard";` di dekat `import { McpPanel } …`;
   - **buang** blok tombol "Dokumentasi integrasi" di kartu "Akses AI Agent" (`<div style={{ marginBottom: 12 }}> <a href="https://github.com/…"> … </a> </div>`) — kartu baru menggantikannya, dan dua tombol ke dokumen yang sama adalah duplikasi permukaan;
   - render `<AgentDocCard onToast={onToast} />` tepat **sebelum** `<Card eyebrow="ai agent" title="Akses AI Agent">` sehingga "baca panduannya" mendahului "buat token".

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --dir src src/test/AgentDocCard.test.tsx src/src/screens/SettingsScreen.test.tsx
```

Expected: PASS — 3 test baru + SettingsScreen lama tetap hijau.

- [ ] **Step 5: Typecheck paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./src typecheck
```

Expected: exit 0 keduanya.

- [ ] **Step 6: Commit**

```bash
git add shared/src/api.ts src/src/api/client.ts src/src/screens/AgentDocCard.tsx \
        src/src/screens/SettingsScreen.tsx src/test/AgentDocCard.test.tsx
git commit -m "feat(489): kartu Dokumentasi AI Agent di Settings (render dari endpoint yang sama)"
```

---

### Task 6: Tautan dari README & docs Source of Truth + smoke

**Files:**
- Modify: `README.md`
- Modify: `internal/docs/README.md`
- Modify: `internal/docs/architecture/api-contract.md`
- Modify: `internal/skills/hanoman/SKILL.md`

**Interfaces:**
- Consumes: endpoint Task 2 & naskah Task 4.
- Produces: tak ada API baru — hanya tautan. Ini yang membuat "ditautkan dari README repo GitHub dan dari `internal/docs/README.md`" terpenuhi.

- [ ] **Step 1: README repo**

Tambah bagian setelah "Cara kerjanya" (sebelum bagian instalasi):

```markdown
## Untuk AI agent

Panduan lengkap agar agen mana pun bisa langsung memakai hanoman — cukup diberi **tautan + agent
token**: **[docs/agent-integration.md](docs/agent-integration.md)**.

Instance hanoman yang berjalan menyajikan naskah **yang sama** sebagai markdown mentah tanpa auth:

​```bash
curl -fsS https://hanoman.example/api/agent-integration.md
​```
```

- [ ] **Step 2: Index Source of Truth**

Di `internal/docs/README.md`, ganti baris §integrasi yang sekarang dengan:

```markdown
- [Integrasi AI agent — panduan berhadapan-agen](../../docs/agent-integration.md) — halaman dokumentasi AI Agent: model kerja hanoman (backlog → sesi → worktree), auth `Bearer hnm_agt_…`, `HANOMAN_HOST`, endpoint tersering + payload `POST /specs` per source, capability & arti 403 (`need`), route cookie-only, tindakan berbahaya yang wajib konfirmasi manusia, jebakan, dan alur end-to-end siap salin. **Naskah tunggal**: instance berjalan menyajikan byte yang sama di `GET /api/agent-integration.md` (PUBLIC, `text/markdown`) dan dashboard merender respons itu di Settings → Dokumentasi AI Agent — tak ada salinan yang bisa basi (SPEC-257/265/489 · ADR-0065)
```

- [ ] **Step 3: Kontrak API**

Di `internal/docs/architecture/api-contract.md`, di bagian endpoint publik (dekat `GET /api/health`), tambahkan:

```markdown
### `GET /api/agent-integration.md` — panduan AI agent (PUBLIC)

Menyajikan `docs/agent-integration.md` apa adanya sebagai `text/markdown; charset=utf-8`.
**Tanpa auth** (masuk daftar `PUBLIC` di `app.ts`, sejajar `GET /api/health`): byte-nya sudah
publik di repo GitHub, dan menggerbanginya berarti agen yang capability-nya kurang menerima 403
pada dokumen yang justru menjelaskan arti 403 itu. Berkasnya dicari `pickGuideFile()`
(`server/src/guide-file.ts`) di dua layout — `<pkg>/docs/…` untuk paket npm, `<repo>/docs/…` untuk
checkout — dengan override `HANOMAN_AGENT_DOC`; tak ketemu → **404 JSON**, bukan 500. Hanya baca:
tak ada jalur tulis. SPEC-489.
```

Perbarui juga baris rujukan di `api-contract.md:393` agar menyebut URL runtime-nya, bukan hanya path repo.

- [ ] **Step 4: Skill project**

Di `internal/skills/hanoman/SKILL.md`, tambahkan satu butir di bagian Aturan Arsitektur (dekat butir MCP server):

```markdown
- **Panduan AI agent punya URL** (SPEC-489, tanpa ADR — ADR-0065 & ADR-0099 ditegakkan):
  `docs/agent-integration.md` adalah **naskah tunggal**, disajikan mentah di
  **`GET /api/agent-integration.md`** (`text/markdown`, masuk daftar `PUBLIC` `app.ts` — bukan
  kelalaian: byte-nya sudah publik di GitHub, dan menggerbanginya berarti agen yang capability-nya
  kurang menerima 403 pada dokumen yang menjelaskan arti 403). Berkasnya diresolve
  `pickGuideFile()` **di `app.ts`**, bukan di route-nya — `import.meta.url` sebuah route sedalam
  `server/src/routes` saat tsx tapi `server/dist` sesudah dibundel esbuild, dua kedalaman berbeda;
  `app.ts` satu-satunya titik yang kedalamannya invarian (persis alasan `pickWebDir` duduk di
  sana). Ia ikut `copyPlan`/`files`/`REQUIRED_ARTIFACTS` paket npm — tanpa itu setiap instalasi
  npm menjawab 404 sementara checkout dev terlihat sehat. Kartu Settings me-render **respons
  endpoint itu**, bukan salinan. Anti-basi lewat `agent-doc-contract.test.ts` yang mengikat naskah
  ke `CAPABILITY_DOMAINS`, `COOKIE_ONLY`, dan `zSpecSource` — pengganti render-dari-katalog
  (ADR-0100) yang tak mungkin di sini karena kendalanya satu berkas markdown.
```

- [ ] **Step 5: Commit docs**

```bash
git add README.md internal/docs/README.md internal/docs/architecture/api-contract.md internal/skills/hanoman/SKILL.md
git commit -m "docs(489): tautkan halaman dokumentasi AI Agent dari README, index SoT, api-contract & SKILL"
```

- [ ] **Step 6: Smoke nyata — boot server + curl tanpa auth**

Task ini menyentuh endpoint, jadi diuji nyata **sekali di akhir** (bukan tiap task). DB khusus supaya
run tetangga tak menghapusnya di tengah smoke:

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-489
SMOKE_HOME="$(mktemp -d)"
HANOMAN_HOME="$SMOKE_HOME" pnpm --filter ./server exec prisma migrate deploy
HANOMAN_HOME="$SMOKE_HOME" PORT=8799 ./node_modules/.bin/tsx server/src/server.ts &
SRV=$!
sleep 6
curl -isS "http://127.0.0.1:8799/api/agent-integration.md" | head -20
curl -sS  "http://127.0.0.1:8799/api/agent-integration.md" | wc -c
curl -isS -H "Authorization: Bearer hnm_agt_sampah" "http://127.0.0.1:8799/api/agent-integration.md" | head -1
curl -isS "http://127.0.0.1:8799/api/specs" | head -1     # kontrol negatif: harus 401
kill "$SRV"
```

Expected:
- baris pertama `HTTP/1.1 200 OK`, header `content-type: text/markdown; charset=utf-8`;
- `wc -c` > 8000 (naskah lengkap);
- dengan token sampah tetap `HTTP/1.1 200 OK`;
- kontrol negatif `GET /api/specs` **`HTTP/1.1 401 Unauthorized`** — membuktikan gerbangnya masih
  hidup dan yang publik hanya endpoint ini.

**Bunuh per-PID (`kill "$SRV"`), jangan `pkill -f`** — pola seperti `node`/`tsx` mencocoki agen sesi
tetangga di mesin ini dan `pkill` mengecualikan leluhurnya sendiri, jadi yang mati selalu sesi orang lain.

- [ ] **Step 7: Verifikasi akhir — seluruh test yang tersentuh**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --no-file-parallelism \
  server/test/guide-file.test.ts server/test/agent-doc.route.test.ts \
  server/test/agent-doc-contract.test.ts server/test/agent-gate.test.ts \
  server/test/agent-capabilities.test.ts server/test/app.test.ts cli/test/pack.test.ts
env -u NODE_ENV ./node_modules/.bin/vitest run --dir src src/test/AgentDocCard.test.tsx src/src/screens/SettingsScreen.test.tsx
pnpm --filter ./server typecheck && pnpm --filter ./shared typecheck && pnpm --filter ./cli typecheck && pnpm --filter ./src typecheck
```

Expected: semua hijau, semua typecheck exit 0. **Pastikan jumlah test yang berjalan bukan nol** —
`--changed` menyalakan `passWithNoTests`, jadi "no test files" terlihat hijau padahal tak menguji apa pun.

- [ ] **Step 8: Commit akhir & push**

```bash
git add -A
git commit -m "chore(489): centang plan + catatan pelaksanaan"
git push origin HEAD:refs/heads/hanoman/spec-489
```

---

## Self-review

**Cakupan objective SPEC-489 → task:**

| Tuntutan objective | Task |
|---|---|
| satu halaman docs AI Agent lewat URL | 2 (endpoint) + 4 (naskah) |
| mirror di repo GitHub | 4 + 6 (berkas yang sama = mirror; tautan README) |
| apa itu hanoman & model kerja backlog → sesi → worktree | 4 §0 |
| auth Bearer `hnm_agt_` | 4 §2 |
| base URL & cara set `HANOMAN_HOST` | 4 §2 |
| endpoint tersering + payload `POST /specs` per source | 4 §6, §7 |
| capability & arti 403 (`need`) | 4 §3, §4 |
| route cookie-only yang selalu 403 | 4 §5 (+ test kontrak) |
| tindakan berbahaya wajib konfirmasi manusia | 4 §8 (+ test kontrak) |
| jebakan (`startable` hanya true, `q` tak menyentuh payload, jangan kirim `id`/`stage`) | 4 §9 (+ test kontrak) |
| contoh alur end-to-end siap salin | 4 §10 |
| ditautkan dari README GitHub | 6 Step 1 |
| ditautkan dari `internal/docs/README.md` | 6 Step 2 |
| satu sumber tulisan, tak diduplikasi | 2 + 5 (dashboard render respons endpoint) + test Task 5 |
| markdown mentah dapat diambil lewat URL | 2 (+ smoke Task 6 Step 6) |
| tak pernah memuat token nyata | test kontrak Task 4 |
| ikut design system | Task 5 memakai primitif `ds/` |

Tak ada tuntutan tanpa task.

**Konsistensi tipe:** `pickGuideFile(distDir, env, exists)` dipakai Task 1 (definisi) dan Task 2
(`app.ts`) dengan urutan argumen yang sama; `AGENT_DOC_REL` dipakai Task 1 & 2; `opts.file` route
sama dengan `{ file: docFile }` di `app.ts`; `paths.agentDoc` dipakai Task 5 di dua tempat dengan
nama identik; `api.agentDoc()` mengembalikan `Promise<string>` dan dipakai sebagai string.
