# SPEC-362 — History session terminal (+ paginasi) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Setiap sesi terminal hanoman tercatat permanen (metadata + transkrip layar) dan bisa dibuka kembali dari modal Riwayat di Terminal, dengan paginasi server-side.

**Architecture:** Model Prisma baru `SessionHistory` (LOCAL-only, tak disync). `pty.ts` — yang hari ini nol dependensi DB — mengekspos hook `registerSessionHooks({onBirth,onDeath})` yang ditembakkan dari dua titik cekik `createSession()` dan `killSession()`; `services/session-history.ts` mendaftarkan diri di `server.ts` dan menulis ke DB. Transkrip di-`capture-pane` tepat sebelum `tmux kill-session` lalu disimpan sebagai berkas di `services/transcript-store.ts` (cermin `services/uploads.ts`); DB hanya memegang pointer. Endpoint `GET/DELETE /api/terminal/history*` memakai amplop `Paginated<T>`, otomatis tergerbang capability `sessions` yang sudah ada. UI = modal di `TerminalScreen` (pola `BacklogPicker`) dengan muat-lebih `IntersectionObserver` (pola `GitGraph.tsx` SPEC-351).

**Tech Stack:** Node + TypeScript (Fastify), Prisma/Postgres, node-pty + tmux, React + TypeScript (Vite), zod di `@hanoman/shared`, vitest.

## Global Constraints

- Spec doc acuan: `docs/superpowers/specs/2026-07-28-spec-362-history-session-terminal-design.md`. Baca sebelum mulai.
- **ADR baru: 0077** (nomor sudah diverifikasi bebas di semua branch lokal & `origin/*`). Jangan pakai nomor lain.
- **TypeScript strict.** Jangan pernah menjalankan `tsc -p .` tanpa `--noEmit` di `shared/` — ia mengotori `src/`+`test/` dengan `.js`/`.d.ts`.
- Test repo: `env -u NODE_ENV -u DATABASE_URL pnpm test` (env shell menunjuk prod dan membuat ~41 test gagal palsu). Per-paket: `pnpm --filter ./server test`, dsb. Selalu `--no-file-parallelism` (sudah default di `server/vitest.config.ts`).
- **DB unik untuk task ini: `hanoman362`** (test otomatis jadi `hanoman362_test`). Sesi claude lain di worktree tetangga menjalankan vitest pada `hanoman_test` dan akan men-truncate DB di tengah jalan.
- Migration ditulis tangan + `prisma migrate deploy` per DB dengan env override — **bukan** `prisma migrate dev` (ia reset saat ada drift worktree).
- Bahasa komentar & UI: Indonesia, mengikuti gaya berkas sekitarnya (menjelaskan *kenapa*, bukan *apa*).
- Docs SoT (`internal/docs/**`) diperbarui **dalam commit yang sama** dan ter-link di `internal/docs/README.md`.
- Setelah tiap task: centang checkbox task itu di berkas plan ini (`- [ ]` → `- [x]`).

## File Structure

**Dibuat:**
| File | Tanggung jawab |
|---|---|
| `shared/src/session-kind.ts` | Katalog `SessionKind` + label Indonesia + predikat `restartableKind` (satu definisi dipakai server & UI) |
| `shared/src/session-kind.test.ts` | Test murni katalog di atas |
| `server/prisma/migrations/2026072801_spec362_session_history/migration.sql` | Tabel `SessionHistory` (aditif) |
| `server/src/services/transcript-store.ts` | Simpan/baca/hapus berkas transkrip + pemangkasan 1 MiB |
| `server/src/services/session-history.ts` | Semua akses DB riwayat + `installSessionHistory()` yang mendaftarkan hook pty |
| `server/src/routes/session-history.ts` | `GET/DELETE /terminal/history*` |
| `server/test/transcript-store.test.ts` | Test store berkas |
| `server/test/session-history.service.test.ts` | Test begin/finish/reconcile/purge |
| `server/test/session-history.route.test.ts` | Test route + paginasi + filter |
| `src/src/screens/SessionHistoryModal.tsx` | Modal riwayat: filter, daftar, muat-lebih, detail, transkrip, Mulai lagi |
| `src/test/session-history-modal.test.tsx` | Test UI modal |
| `internal/docs/adr/0079-history-sesi-terminal-store-lokal-plus-transkrip.md` | ADR |

**Diubah:**
| File | Perubahan |
|---|---|
| `shared/src/index.ts` | `export * from "./session-kind"` |
| `shared/src/dto.ts` | `zSessionHistory` + `SessionHistoryView` |
| `shared/src/api.ts` | `paths.sessionHistory*` |
| `server/prisma/schema.prisma` | model `SessionHistory` |
| `server/src/services/pty.ts` | `sessionKind()` murni, `registerSessionHooks()`, tembak hook di `createSession`/`killSession`, `captureTranscript()` |
| `server/src/app.ts` | daftarkan route `sessionHistory` |
| `server/src/server.ts` | `installSessionHistory()` + `reconcileHistory()` saat boot |
| `src/src/api/client.ts` | metode `listSessionHistory`/`getSessionHistory`/`sessionTranscript`/`purgeSessionHistory` |
| `src/src/screens/TerminalScreen.tsx` | tombol "Riwayat" + render modal |
| `internal/docs/architecture/data-model.md` · `api-contract.md` · `frontend/frontend-implementation.md` · `security/security-standard.md` · `README.md` · `internal/skills/hanoman/SKILL.md` | dokumentasi |

---

### Task 1: Katalog `SessionKind` di shared

**Files:**
- Create: `shared/src/session-kind.ts`
- Create: `shared/src/session-kind.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: —
- Produces: `SESSION_KINDS: readonly SessionKind[]`, `type SessionKind`, `zSessionKind` (zod enum), `SESSION_KIND_LABEL: Record<SessionKind, string>`, `restartableKind(kind: string): boolean`

- [x] **Step 1: Write the failing test**

Create `shared/src/session-kind.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SESSION_KINDS, SESSION_KIND_LABEL, restartableKind, zSessionKind } from "./session-kind";

describe("SessionKind (SPEC-362)", () => {
  it("mencakup setiap jenis sesi yang bisa lahir dari createSession", () => {
    expect([...SESSION_KINDS].sort()).toEqual([
      "breakdown", "cross-audit", "prd", "reverse", "scaffold", "shell",
      "spec", "terminal", "vps", "worktree",
    ]);
  });

  it("tiap kind punya label manusia — UI tak pernah merender slug mentah", () => {
    for (const k of SESSION_KINDS) expect(SESSION_KIND_LABEL[k].length).toBeGreaterThan(0);
  });

  it("restartable hanya untuk sesi yang konteksnya bisa dibangun ulang dari riwayat", () => {
    for (const k of ["spec", "terminal", "shell", "reverse", "scaffold", "cross-audit"] as const)
      expect(restartableKind(k)).toBe(true);
    // prd/breakdown butuh brief/prdPath yang tak tersimpan; vps/worktree tak punya arti "mulai lagi".
    for (const k of ["prd", "breakdown", "vps", "worktree"] as const)
      expect(restartableKind(k)).toBe(false);
  });

  it("kind tak dikenal tak pernah restartable", () => {
    expect(restartableKind("apa-pun")).toBe(false);
  });

  it("zSessionKind menolak nilai di luar katalog", () => {
    expect(zSessionKind.safeParse("spec").success).toBe(true);
    expect(zSessionKind.safeParse("apa-pun").success).toBe(false);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd shared && env -u NODE_ENV -u DATABASE_URL npx vitest run src/session-kind.test.ts`
Expected: FAIL — `Failed to resolve import "./session-kind"`.

- [x] **Step 3: Write minimal implementation**

Create `shared/src/session-kind.ts`:

```ts
import { z } from "zod";

// SPEC-362 · ADR-0079 · jenis sesi terminal, diturunkan saat sesi LAHIR (pty.sessionKind) dan
// disimpan di SessionHistory.kind. Label ikut di sini, bukan di UI: SPEC-262/264 sudah membuktikan
// grid yang merender slug mentah membuat fiturnya tak ketemu saat dicari manusia.
export const SESSION_KINDS = [
  "spec", "reverse", "prd", "scaffold", "breakdown", "cross-audit", "vps", "shell", "worktree", "terminal",
] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];
export const zSessionKind = z.enum(SESSION_KINDS);

export const SESSION_KIND_LABEL: Record<SessionKind, string> = {
  spec: "Backlog",
  reverse: "Reverse docs",
  prd: "PRD",
  scaffold: "Scaffold",
  breakdown: "Breakdown PRD",
  "cross-audit": "Audit lintas",
  vps: "VPS",
  shell: "Terminal biasa",
  worktree: "Worktree (konflik)",
  terminal: "Sesi agen",
};

// "Mulai lagi" tak pernah menghidupkan proses lama (tmux sudah membunuhnya) — ia men-spawn sesi
// baru dengan konteks sama. Hanya sah bila konteks itu bisa dibangun ulang dari baris riwayat:
// prd/breakdown butuh brief/prdPath yang tak tersimpan, vps & worktree konflik tak punya artinya.
const RESTARTABLE: ReadonlySet<string> = new Set<SessionKind>([
  "spec", "terminal", "shell", "reverse", "scaffold", "cross-audit",
]);
export const restartableKind = (kind: string): boolean => RESTARTABLE.has(kind);
```

Append to `shared/src/index.ts` (setelah baris `export * from "./ticket-status";`):

```ts
export * from "./session-kind";
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd shared && env -u NODE_ENV -u DATABASE_URL npx vitest run src/session-kind.test.ts`
Expected: PASS, 5 test.

- [x] **Step 5: Commit**

```bash
git add shared/src/session-kind.ts shared/src/session-kind.test.ts shared/src/index.ts
git commit -m "feat(spec-362): katalog SessionKind + restartableKind di shared"
```

---

### Task 2: Model `SessionHistory` + migration

**Files:**
- Modify: `server/prisma/schema.prisma` (tambah di bawah model `SessionResult`)
- Create: `server/prisma/migrations/2026072801_spec362_session_history/migration.sql`

**Interfaces:**
- Consumes: —
- Produces: `prisma.sessionHistory` dengan kolom `id, sessionId, projectId, specId, title, kind, flow, agent, model, effort, branch, cwd, startedAt, endedAt, exitCode, transcriptKey, transcriptBytes, createdAt, updatedAt`

- [x] **Step 1: Tambahkan model ke schema.prisma**

Sisipkan setelah blok `model SessionResult { … }` (`server/prisma/schema.prisma:205`):

```prisma
// SPEC-362 · ADR-0079 · riwayat sesi terminal. LOCAL-only: sesi hidup di tmux mesin ini dan
// transkripnya berkas di disk mesin ini — menyiarkannya ke hub akan mengirim baris yang menunjuk
// berkas yang tak ada di sana (cermin LocalBinding & SchedulerQueueItem). Tanpa `version`/`notifySynced`.
model SessionHistory {
  id              String    @id
  // id tmux sesi. BUKAN primary key: sessionIdForSpec() deterministik, jadi satu backlog yang
  // dibuka-tutup lima kali menghasilkan lima baris dengan sessionId yang sama.
  sessionId       String
  // Tanpa FK: sesi VPS memakai projectId sintetis "vps:<id>"/"vps-console:<id>" (routes/vps.ts).
  // Konvensi yang sama dipakai SessionResult.
  projectId       String
  specId          String?
  title           String?
  kind            String
  flow            String?
  agent           String
  model           String?
  effort          String?
  branch          String?
  cwd             String
  startedAt       DateTime  @default(now())
  endedAt         DateTime?
  exitCode        Int?
  transcriptKey   String?
  transcriptBytes Int?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([projectId, startedAt])
  @@index([specId])
  @@index([sessionId])
}
```

- [x] **Step 2: Tulis migration.sql**

Create `server/prisma/migrations/2026072801_spec362_session_history/migration.sql`:

```sql
-- SPEC-362 · ADR-0079 · riwayat sesi terminal (LOCAL-only, tak disync).
-- Aditif: satu tabel baru. Tak menyentuh kolom mana pun yang sudah ada.
CREATE TABLE "SessionHistory" (
  "id"              TEXT NOT NULL,
  "sessionId"       TEXT NOT NULL,
  "projectId"       TEXT NOT NULL,
  "specId"          TEXT,
  "title"           TEXT,
  "kind"            TEXT NOT NULL,
  "flow"            TEXT,
  "agent"           TEXT NOT NULL,
  "model"           TEXT,
  "effort"          TEXT,
  "branch"          TEXT,
  "cwd"             TEXT NOT NULL,
  "startedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt"         TIMESTAMP(3),
  "exitCode"        INTEGER,
  "transcriptKey"   TEXT,
  "transcriptBytes" INTEGER,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SessionHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SessionHistory_projectId_startedAt_idx" ON "SessionHistory"("projectId", "startedAt");
CREATE INDEX "SessionHistory_specId_idx" ON "SessionHistory"("specId");
CREATE INDEX "SessionHistory_sessionId_idx" ON "SessionHistory"("sessionId");
```

- [x] **Step 3: Buat DB task ini + terapkan migration ke DB kerja dan DB test**

```bash
docker exec hanoman-db-1 psql -U hanoman -d postgres -c 'CREATE DATABASE hanoman362;'
docker exec hanoman-db-1 psql -U hanoman -d postgres -c 'CREATE DATABASE hanoman362_test;'
cd server
DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman362' npx prisma migrate deploy
DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman362_test' npx prisma migrate deploy
npx prisma generate
```

Expected: dua kali `All migrations have been successfully applied`, lalu `Generated Prisma Client`.
Catatan: kredensial/port persis ada di `.env` root — pakai nilai dari sana bila berbeda.

- [x] **Step 4: Verifikasi klien Prisma mengenal model baru**

Run:
```bash
cd server && DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman362_test' \
  node -e "import('./src/db.ts')" 2>/dev/null; \
  node --experimental-strip-types -e "
import {PrismaClient} from '@prisma/client';
const p=new PrismaClient({datasources:{db:{url:'postgresql://hanoman:hanoman@localhost:5432/hanoman362_test'}}});
p.sessionHistory.count().then(n=>{console.log('rows',n);return p.\$disconnect();});"
```
Expected: `rows 0`.

- [x] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/2026072801_spec362_session_history
git commit -m "feat(spec-362): model SessionHistory (LOCAL-only) + migration aditif"
```

---

### Task 3: Store transkrip di disk

**Files:**
- Create: `server/src/services/transcript-store.ts`
- Create: `server/test/transcript-store.test.ts`

**Interfaces:**
- Consumes: `effectiveStr` dari `../config`
- Produces: `MAX_TRANSCRIPT_BYTES: number`, `transcriptDir(): string`, `saveTranscript(text: string): Promise<{ key: string; bytes: number; truncated: boolean }>`, `readTranscript(key: string): Promise<string | null>`, `deleteTranscript(key: string): Promise<void>`

- [x] **Step 1: Write the failing test**

Create `server/test/transcript-store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_TRANSCRIPT_BYTES, transcriptDir, saveTranscript, readTranscript, deleteTranscript,
} from "../src/services/transcript-store";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hanoman-transcript-"));
  process.env.HANOMAN_TRANSCRIPT_DIR = dir;
});
afterAll(() => { delete process.env.HANOMAN_TRANSCRIPT_DIR; });

describe("transcript-store (SPEC-362)", () => {
  it("menyimpan lalu membaca kembali teks apa adanya", async () => {
    const { key, bytes, truncated } = await saveTranscript("halo\nsesi\n");
    expect(truncated).toBe(false);
    expect(bytes).toBe(Buffer.byteLength("halo\nsesi\n"));
    expect(await readTranscript(key)).toBe("halo\nsesi\n");
    expect(transcriptDir()).toBe(dir);
  });

  it("memangkas transkrip raksasa dengan MENYIMPAN EKOR + penanda", async () => {
    // Ekor adalah bagian yang berarti saat membaca ulang sesi; kepala yang dibuang.
    const huge = "x".repeat(MAX_TRANSCRIPT_BYTES) + "\nBARIS-TERAKHIR\n";
    const { key, bytes, truncated } = await saveTranscript(huge);
    expect(truncated).toBe(true);
    expect(bytes).toBeLessThanOrEqual(MAX_TRANSCRIPT_BYTES + 200);
    const back = await readTranscript(key);
    expect(back).toContain("BARIS-TERAKHIR");
    expect(back).toContain("dipangkas");
  });

  it("kunci tak dikenal → null, bukan lempar", async () => {
    expect(await readTranscript("tidak-ada.log")).toBeNull();
  });

  it("kunci dengan path traversal di-basename-kan sebelum menyentuh disk", async () => {
    expect(await readTranscript("../../../etc/passwd")).toBeNull();
  });

  it("hapus membuang berkasnya; hapus dua kali tidak melempar", async () => {
    const { key } = await saveTranscript("isi");
    expect(existsSync(join(dir, key))).toBe(true);
    await deleteTranscript(key);
    expect(existsSync(join(dir, key))).toBe(false);
    await deleteTranscript(key);
  });

  it("teks kosong tak menghasilkan berkas", async () => {
    const r = await saveTranscript("   \n  ");
    expect(r.key).toBe("");
    expect(r.bytes).toBe(0);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run test/transcript-store.test.ts`
Expected: FAIL — `Failed to resolve import "../src/services/transcript-store"`.

- [x] **Step 3: Write minimal implementation**

Create `server/src/services/transcript-store.ts`:

```ts
// SPEC-362 · ADR-0079 · transkrip layar sesi yang sudah ditutup. Berkas hidup di
// HANOMAN_TRANSCRIPT_DIR — server-local, DI LUAR repoDir, TAK disync (cermin services/uploads.ts
// dan Vps.keyPath). DB hanya memegang nama berkasnya.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { effectiveStr } from "../config";

// Sesi berhari-hari bisa meninggalkan puluhan MB scrollback. 1 MiB menampung ribuan baris —
// cukup untuk membaca ulang apa yang terjadi, tanpa menjadikan riwayat pengisi disk diam-diam.
export const MAX_TRANSCRIPT_BYTES = 1024 * 1024;

export function transcriptDir(): string {
  return resolve(effectiveStr("HANOMAN_TRANSCRIPT_DIR") ?? join(process.cwd(), "data", "transcripts"));
}

// Memangkas KEPALA, menyimpan EKOR: saat membaca ulang sesi, yang dicari hampir selalu apa yang
// terjadi menjelang akhir. Potongan disejajarkan ke newline pertama supaya tak memulai di tengah
// karakter multi-byte (dan tak menyisakan setengah baris yang membingungkan).
function clamp(text: string): { body: string; truncated: boolean } {
  const buf = Buffer.from(text, "utf8");
  if (buf.byteLength <= MAX_TRANSCRIPT_BYTES) return { body: text, truncated: false };
  const cut = buf.byteLength - MAX_TRANSCRIPT_BYTES;
  let tail = buf.subarray(cut).toString("utf8");
  const nl = tail.indexOf("\n");
  if (nl >= 0) tail = tail.slice(nl + 1);
  return { body: `… ${cut} byte awal dipangkas (batas ${MAX_TRANSCRIPT_BYTES} byte) …\n${tail}`, truncated: true };
}

export async function saveTranscript(text: string): Promise<{ key: string; bytes: number; truncated: boolean }> {
  if (!text.trim()) return { key: "", bytes: 0, truncated: false };
  const { body, truncated } = clamp(text);
  const dir = transcriptDir();
  await mkdir(dir, { recursive: true });
  const key = `${randomUUID()}.log`;
  await writeFile(join(dir, key), body, "utf8");
  return { key, bytes: Buffer.byteLength(body, "utf8"), truncated };
}

// key selalu dari saveTranscript (uuid+ext, bukan input pengguna); basename tetap dipasang sebagai
// jaring pengaman agar nilai DB yang rusak pun tak pernah keluar dari transcriptDir().
export async function readTranscript(key: string): Promise<string | null> {
  if (!key) return null;
  try { return await readFile(join(transcriptDir(), basename(key)), "utf8"); }
  catch { return null; }
}

export async function deleteTranscript(key: string): Promise<void> {
  if (!key) return;
  await unlink(join(transcriptDir(), basename(key))).catch(() => { /* sudah tak ada */ });
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run test/transcript-store.test.ts`
Expected: PASS, 6 test.

- [x] **Step 5: Commit**

```bash
git add server/src/services/transcript-store.ts server/test/transcript-store.test.ts
git commit -m "feat(spec-362): store transkrip sesi di disk (cap 1 MiB, simpan ekor)"
```

---

### Task 4: Hook lahir & mati sesi di `pty.ts`

**Files:**
- Modify: `server/src/services/pty.ts`
- Modify: `server/test/pty.test.ts` (tambah blok `describe` baru di akhir berkas)

**Interfaces:**
- Consumes: `SessionKind` dari `@hanoman/shared`
- Produces:
  - `sessionKind(opts: { id: string; specId?: string; flow?: string; command?: string[] }, projectId: string, cwd: string): SessionKind`
  - `type SessionBirth = { sessionId: string; projectId: string; specId?: string; flow?: string; kind: SessionKind; agent: Agent; model?: string; effort?: string; branch?: string; cwd: string }`
  - `type SessionDeath = { sessionId: string; exitCode: number | null; transcript: string | null }`
  - `registerSessionHooks(h: { onBirth?: (b: SessionBirth) => void; onDeath?: (d: SessionDeath) => void }): void`

- [x] **Step 1: Write the failing test**

Append to `server/test/pty.test.ts` (impor `sessionKind`, `registerSessionHooks`, `type SessionBirth`, `type SessionDeath` ke daftar impor `../src/services/pty` di atas berkas):

```ts
describe("hook riwayat sesi (SPEC-362)", () => {
  it("sessionKind menurunkan jenis dari opsi kelahiran, bukan dari tebakan belakangan", () => {
    expect(sessionKind({ id: "spec-1", specId: "SPEC-1" }, "p1", "/r/.worktrees/spec-1")).toBe("spec");
    expect(sessionKind({ id: "prd-x", flow: "prd" }, "p1", "/r/.worktrees/prd-x")).toBe("prd");
    expect(sessionKind({ id: "reverse-p1", flow: "reverse" }, "p1", "/r/.worktrees/reverse-p1")).toBe("reverse");
    expect(sessionKind({ id: "xaudit-p1" }, "p1", "/r/.worktrees/xaudit-p1")).toBe("cross-audit");
    expect(sessionKind({ id: "vpsc-1", command: ["ssh"] }, "vps-console:1", "/home/x")).toBe("vps");
    expect(sessionKind({ id: "abc", command: ["/bin/bash"] }, "p1", "/r")).toBe("shell");
    expect(sessionKind({ id: "merge-x" }, "p1", "/r/.worktrees/merge-x")).toBe("worktree");
    expect(sessionKind({ id: "abc" }, "p1", "/r")).toBe("terminal");
  });

  it("onBirth menembak sekali saat sesi lahir dan TIDAK menembak saat Start kedua (re-attach)", async () => {
    const births: SessionBirth[] = [];
    registerSessionHooks({ onBirth: (b) => { births.push(b); } });
    const id = "hook-birth";
    createSession("p-hook", process.cwd(), { id, command: ["/bin/sh", "-c", "sleep 30"] });
    createSession("p-hook", process.cwd(), { id, command: ["/bin/sh", "-c", "sleep 30"] }); // re-attach
    expect(births.filter((b) => b.sessionId === id)).toHaveLength(1);
    expect(births[births.length - 1]).toMatchObject({ sessionId: id, projectId: "p-hook", kind: "shell", agent: "claude" });
    killSession(id);
  });

  it("onDeath membawa transkrip yang di-capture SEBELUM pane dibunuh", async () => {
    const deaths: SessionDeath[] = [];
    registerSessionHooks({ onDeath: (d) => { deaths.push(d); } });
    const id = "hook-death";
    createSession("p-hook", process.cwd(), { id, command: ["/bin/sh", "-c", "echo PENANDA-RIWAYAT; sleep 30"] });
    await waitFor(() => (tmuxCapture(id) ?? "").includes("PENANDA-RIWAYAT"));
    killSession(id);
    const d = deaths.find((x) => x.sessionId === id);
    expect(d).toBeDefined();
    expect(d!.transcript).toContain("PENANDA-RIWAYAT");
  });
});
```

Tambahkan helper di dekat `waitFor` (bagian atas berkas test) supaya test bisa mengintip pane:

```ts
import { execFileSync } from "node:child_process";
const tmuxCapture = (id: string): string | null => {
  try {
    return execFileSync("tmux", ["-L", process.env.HANOMAN_TMUX_SOCKET ?? "hanoman-test",
      "-f", "/dev/null", "capture-pane", "-p", "-t", `hanoman-${id}`], { encoding: "utf8" });
  } catch { return null; }
};
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run test/pty.test.ts -t "riwayat sesi"`
Expected: FAIL — `sessionKind is not exported` / `registerSessionHooks is not a function`.

- [x] **Step 3: Write minimal implementation**

Di `server/src/services/pty.ts`:

(a) Tambah impor tipe (gabungkan ke impor `@hanoman/shared` yang sudah ada di baris 8):

```ts
import { coerceCodexEffort, type SessionKind } from "@hanoman/shared";
```

(b) Sisipkan setelah blok `export const getSession = …` (sekitar baris 160):

```ts
// SPEC-362 · ADR-0079 · riwayat sesi. pty.ts sengaja TETAP nol dependensi DB: ia hanya menembakkan
// dua peristiwa, dan services/session-history.ts yang mendaftarkan diri lewat server.ts (pola
// registerSchedulerSource, SPEC-294). createSession & killSession adalah SATU-SATUNYA pintu lahir
// & mati sesi — seluruh pemanggil (routes/terminal, session-launch, specs, ide, vps) lewat sini,
// jadi dua titik ini menangkap semuanya tanpa menyentuh 12 call site.
export type SessionBirth = {
  sessionId: string; projectId: string; specId?: string; flow?: string; kind: SessionKind;
  agent: Agent; model?: string; effort?: string; branch?: string; cwd: string;
};
export type SessionDeath = { sessionId: string; exitCode: number | null; transcript: string | null };
type SessionHooks = { onBirth?: (b: SessionBirth) => void; onDeath?: (d: SessionDeath) => void };
let hooks: SessionHooks = {};
export function registerSessionHooks(h: SessionHooks): void { hooks = h; }
// Fire-and-forget: riwayat tak boleh memblokir atau menggagalkan kelahiran/penutupan sesi.
const emitBirth = (b: SessionBirth): void => { try { hooks.onBirth?.(b); } catch { /* riwayat opsional */ } };
const emitDeath = (d: SessionDeath): void => { try { hooks.onDeath?.(d); } catch { /* riwayat opsional */ } };

// Jenis sesi diturunkan saat LAHIR, saat opsinya masih di tangan — sesudah itu tmux hanya menyimpan
// sebagian (tak ada jejak `command` maupun `prompt`). Fungsi murni supaya bisa diuji tanpa tmux.
export function sessionKind(
  o: { id: string; specId?: string; flow?: string; command?: string[] }, projectId: string, cwd: string,
): SessionKind {
  if (o.specId) return "spec";
  if (o.flow === "reverse" || o.flow === "prd" || o.flow === "scaffold" || o.flow === "breakdown") return o.flow;
  if (o.id.startsWith("xaudit-")) return "cross-audit";
  if (projectId.startsWith("vps")) return "vps";           // routes/vps.ts: "vps:<id>" & "vps-console:<id>"
  if (o.command) return "shell";
  if (cwd.includes("/.worktrees/")) return "worktree";     // sesi konflik merge/integrate
  return "terminal";
}

// Scrollback lenyap bersama pane: ini WAJIB dipanggil sebelum `tmux kill-session`. Tanpa `-e`
// (kebalikan attach() untuk pane mati) — arsip disimpan sebagai teks polos: bisa dicari, aman
// dirender di <pre>, tak menyuntikkan ANSI ke DOM.
function captureTranscript(id: string): string | null {
  try {
    const out = tmux("capture-pane", "-p", "-J", "-S", "-50000", "-t", name(id));
    return out.trim() ? out : null;
  } catch { return null; }
}
```

(c) Di `createSession`, tepat sebelum `return { id, projectId, … }` di akhir fungsi (setelah baris `if (opts.goal && … armGoalInTui …)`), sisipkan:

```ts
  // SPEC-362 · sesi benar-benar BARU (cabang `existing` di atas sudah return lebih dulu — re-attach
  // ADR-0015 bukan sesi baru dan tak boleh melahirkan baris riwayat kedua).
  emitBirth({
    sessionId: id, projectId, specId: opts.specId, flow: opts.flow,
    kind: sessionKind({ id, specId: opts.specId, flow: opts.flow, command: opts.command }, projectId, cwd),
    agent, model: opts.model, effort: opts.effort, branch: opts.branch, cwd,
  });
```

(d) Ganti `killSession` seluruhnya:

```ts
export function killSession(id: string): boolean {
  const p = getSession(id);
  if (!p) return false;
  // SPEC-362 · capture SEBELUM kill: sesudah `kill-session` scrollback-nya tak ada lagi.
  const transcript = captureTranscript(id);
  drop(id);
  tmux("kill-session", "-t", name(id));
  emitDeath({ sessionId: id, exitCode: p.exited ? p.code : null, transcript });
  return true;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run test/pty.test.ts`
Expected: PASS — seluruh test pty lama tetap hijau + 3 test baru.

- [x] **Step 5: Commit**

```bash
git add server/src/services/pty.ts server/test/pty.test.ts
git commit -m "feat(spec-362): hook lahir/mati sesi + sessionKind di pty (pty tetap nol dep DB)"
```

---

### Task 5: Service `session-history`

**Files:**
- Create: `server/src/services/session-history.ts`
- Create: `server/test/session-history.service.test.ts`

**Interfaces:**
- Consumes: `SessionBirth`/`SessionDeath`/`registerSessionHooks`/`listSessions` dari `./pty`; `saveTranscript`/`deleteTranscript`/`readTranscript` dari `./transcript-store`; `SessionHistoryView` dari `@hanoman/shared` (didefinisikan di Task 6 — buat dulu di Task 6 bila mengerjakan berurutan, atau salin definisinya dari sana)
- Produces:
  - `beginSession(b: SessionBirth): Promise<void>`
  - `finishSession(d: SessionDeath): Promise<void>`
  - `listHistory(q: { projectId?: string; specId?: string; kind?: string; q?: string; page?: string; limit?: string }): Promise<Paginated<SessionHistoryView>>`
  - `getHistory(id: string): Promise<(SessionHistoryView & { hasTranscript: boolean }) | null>`
  - `transcriptOf(id: string): Promise<{ text: string; bytes: number } | null>`
  - `purgeHistory(q: { projectId?: string; before?: Date }): Promise<number>`
  - `reconcileHistory(liveSessionIds: string[]): Promise<number>`
  - `installSessionHistory(): void`

> **Catatan urutan:** Task 6 mendefinisikan `SessionHistoryView` di `shared/src/dto.ts`. Kerjakan **Step 1 Task 6** (DTO) lebih dulu bila TypeScript mengeluh, lalu kembali ke sini.

- [x] **Step 1: Write the failing test**

Create `server/test/session-history.service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../src/db";
import {
  beginSession, finishSession, listHistory, getHistory, transcriptOf, purgeHistory, reconcileHistory,
} from "../src/services/session-history";

const clean = () => prisma.sessionHistory.deleteMany();
beforeEach(async () => {
  process.env.HANOMAN_TRANSCRIPT_DIR = mkdtempSync(join(tmpdir(), "hanoman-th-"));
  await clean();
});
afterAll(async () => { await clean(); delete process.env.HANOMAN_TRANSCRIPT_DIR; });

const birth = (over: Partial<Parameters<typeof beginSession>[0]> = {}) => ({
  sessionId: "spec-362", projectId: "p1", specId: "SPEC-362", flow: "feature",
  kind: "spec" as const, agent: "claude" as const, model: "claude-opus-5", effort: "xhigh",
  branch: undefined, cwd: "/repo/.worktrees/spec-362", ...over,
});

describe("session-history service (SPEC-362)", () => {
  it("beginSession menulis baris yang langsung terbaca sebagai 'berjalan'", async () => {
    await beginSession(birth());
    const { items, total } = await listHistory({});
    expect(total).toBe(1);
    expect(items[0]).toMatchObject({ sessionId: "spec-362", specId: "SPEC-362", kind: "spec", endedAt: null });
  });

  it("sessionId yang sama dua kali menghasilkan DUA baris — reopen tak menimpa riwayat", async () => {
    await beginSession(birth());
    await finishSession({ sessionId: "spec-362", exitCode: 0, transcript: "sesi pertama" });
    await beginSession(birth());
    const { total } = await listHistory({});
    expect(total).toBe(2);
  });

  it("finishSession mengisi baris BERJALAN terbaru, bukan yang sudah selesai", async () => {
    await beginSession(birth());
    await finishSession({ sessionId: "spec-362", exitCode: 0, transcript: "pertama" });
    await beginSession(birth());
    await finishSession({ sessionId: "spec-362", exitCode: 2, transcript: "kedua" });
    const { items } = await listHistory({});
    expect(items.map((r) => r.exitCode)).toEqual([2, 0]); // urut startedAt desc
    expect(items.every((r) => r.endedAt !== null)).toBe(true);
  });

  it("transkrip tersimpan sebagai berkas & terbaca lewat transcriptOf", async () => {
    await beginSession(birth());
    await finishSession({ sessionId: "spec-362", exitCode: 0, transcript: "isi transkrip" });
    const { items } = await listHistory({});
    const row = await getHistory(items[0]!.id);
    expect(row?.hasTranscript).toBe(true);
    expect((await transcriptOf(items[0]!.id))?.text).toBe("isi transkrip");
  });

  it("tanpa transkrip → hasTranscript false, transcriptOf null", async () => {
    await beginSession(birth({ sessionId: "kosong" }));
    await finishSession({ sessionId: "kosong", exitCode: 0, transcript: null });
    const { items } = await listHistory({});
    expect((await getHistory(items[0]!.id))?.hasTranscript).toBe(false);
    expect(await transcriptOf(items[0]!.id)).toBeNull();
  });

  it("finishSession untuk sessionId tanpa baris berjalan = no-op (tak melempar)", async () => {
    await finishSession({ sessionId: "hantu", exitCode: 0, transcript: "x" });
    expect((await listHistory({})).total).toBe(0);
  });

  it("paginasi memotong respons & melaporkan total penuh", async () => {
    for (let i = 0; i < 5; i++) await beginSession(birth({ sessionId: `s${i}`, specId: `SPEC-${i}` }));
    const p1 = await listHistory({ page: "1", limit: "2" });
    expect(p1.items).toHaveLength(2);
    expect(p1.total).toBe(5);
    expect(p1.pageSize).toBe(2);
    const p3 = await listHistory({ page: "3", limit: "2" });
    expect(p3.items).toHaveLength(1);
  });

  it("filter projectId/specId/kind/q", async () => {
    await beginSession(birth({ sessionId: "a", projectId: "p1", specId: "SPEC-1", kind: "spec" }));
    await beginSession(birth({ sessionId: "b", projectId: "p2", specId: undefined, kind: "shell" }));
    expect((await listHistory({ projectId: "p2" })).total).toBe(1);
    expect((await listHistory({ specId: "SPEC-1" })).total).toBe(1);
    expect((await listHistory({ kind: "shell" })).total).toBe(1);
    expect((await listHistory({ q: "SPEC-1" })).total).toBe(1);
    expect((await listHistory({ q: "tidak-ada" })).total).toBe(0);
  });

  it("reconcileHistory menutup baris berjalan yang panenya sudah lenyap, membiarkan yang hidup", async () => {
    await beginSession(birth({ sessionId: "hidup" }));
    await beginSession(birth({ sessionId: "mati" }));
    const closed = await reconcileHistory(["hidup"]);
    expect(closed).toBe(1);
    const { items } = await listHistory({});
    const byId = Object.fromEntries(items.map((r) => [r.sessionId, r]));
    expect(byId["mati"]!.endedAt).not.toBeNull();
    expect(byId["hidup"]!.endedAt).toBeNull();
  });

  it("purge menghapus baris ber-scope dan berkas transkripnya", async () => {
    await beginSession(birth({ sessionId: "x", projectId: "p9" }));
    await finishSession({ sessionId: "x", exitCode: 0, transcript: "akan dihapus" });
    const { items } = await listHistory({ projectId: "p9" });
    const id = items[0]!.id;
    expect(await purgeHistory({ projectId: "p9" })).toBe(1);
    expect((await listHistory({ projectId: "p9" })).total).toBe(0);
    expect(await transcriptOf(id)).toBeNull();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman362' npx vitest run test/session-history.service.test.ts`
Expected: FAIL — `Failed to resolve import "../src/services/session-history"`.

- [x] **Step 3: Write minimal implementation**

Create `server/src/services/session-history.ts`:

```ts
// SPEC-362 · ADR-0079 · riwayat sesi terminal. Satu-satunya tempat yang menyentuh tabel
// SessionHistory; pty.ts tetap bebas DB dan hanya menembakkan peristiwa ke sini.
import { randomUUID } from "node:crypto";
import type { Paginated, SessionHistoryView } from "@hanoman/shared";
import { prisma } from "../db";
import { registerSessionHooks, type SessionBirth, type SessionDeath } from "./pty";
import { saveTranscript, readTranscript, deleteTranscript } from "./transcript-store";

type Row = {
  id: string; sessionId: string; projectId: string; specId: string | null; title: string | null;
  kind: string; flow: string | null; agent: string; model: string | null; effort: string | null;
  branch: string | null; cwd: string; startedAt: Date; endedAt: Date | null; exitCode: number | null;
  transcriptKey: string | null; transcriptBytes: number | null;
};

const view = (r: Row): SessionHistoryView => ({
  id: r.id, sessionId: r.sessionId, projectId: r.projectId, specId: r.specId, title: r.title,
  kind: r.kind, flow: r.flow, agent: r.agent, model: r.model, effort: r.effort, branch: r.branch,
  cwd: r.cwd, startedAt: r.startedAt.toISOString(), endedAt: r.endedAt?.toISOString() ?? null,
  exitCode: r.exitCode, transcriptBytes: r.transcriptBytes,
});

// Judul spec ikut disalin sebagai SNAPSHOT: riwayat harus tetap terbaca setelah spec-nya dihapus,
// dan judul saat sesi berjalan itulah konteks yang benar — bukan judul hari ini.
async function titleFor(specId?: string): Promise<string | null> {
  if (!specId) return null;
  const s = await prisma.spec.findUnique({ where: { id: specId }, select: { title: true } });
  return s?.title ?? null;
}

export async function beginSession(b: SessionBirth): Promise<void> {
  await prisma.sessionHistory.create({
    data: {
      id: randomUUID(), sessionId: b.sessionId, projectId: b.projectId, specId: b.specId ?? null,
      title: await titleFor(b.specId), kind: b.kind, flow: b.flow ?? null, agent: b.agent,
      model: b.model ?? null, effort: b.effort ?? null, branch: b.branch ?? null, cwd: b.cwd,
    },
  });
}

export async function finishSession(d: SessionDeath): Promise<void> {
  // Baris BERJALAN terbaru untuk sessionId itu. Sesi spec memakai id deterministik yang berulang,
  // jadi mencocokkan hanya lewat sessionId akan menimpa riwayat lama.
  const open = await prisma.sessionHistory.findFirst({
    where: { sessionId: d.sessionId, endedAt: null }, orderBy: { startedAt: "desc" },
  });
  if (!open) return;  // sesi lahir sebelum fitur ini ada, atau sudah direkonsiliasi
  const t = d.transcript ? await saveTranscript(d.transcript) : { key: "", bytes: 0 };
  await prisma.sessionHistory.update({
    where: { id: open.id },
    data: {
      endedAt: new Date(), exitCode: d.exitCode,
      transcriptKey: t.key || null, transcriptBytes: t.key ? t.bytes : null,
    },
  });
}

export async function listHistory(q: {
  projectId?: string; specId?: string; kind?: string; q?: string; page?: string; limit?: string;
}): Promise<Paginated<SessionHistoryView>> {
  const term = q.q?.trim();
  const where = {
    ...(q.projectId ? { projectId: q.projectId } : {}),
    ...(q.specId ? { specId: q.specId } : {}),
    ...(q.kind ? { kind: q.kind } : {}),
    ...(term
      ? {
        OR: [
          { sessionId: { contains: term, mode: "insensitive" as const } },
          { specId: { contains: term, mode: "insensitive" as const } },
          { title: { contains: term, mode: "insensitive" as const } },
          { branch: { contains: term, mode: "insensitive" as const } },
        ],
      }
      : {}),
  };
  const total = await prisma.sessionHistory.count({ where });
  // skip/take di query DB SAH di sini: berbeda dari GET /specs (ADR-0038) yang butuh set penuh untuk
  // overlay stage live + write-through, riwayat adalah baris mati tanpa overlay apa pun.
  const pageSize = q.limit ? Math.min(Math.max(Math.floor(+q.limit) || 1, 1), 200) : (total || 1);
  const page = Math.max(Math.floor(+(q.page ?? 1)) || 1, 1);
  const rows = await prisma.sessionHistory.findMany({
    where, orderBy: { startedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize,
  });
  return { items: rows.map(view), total, page, pageSize };
}

export async function getHistory(id: string): Promise<(SessionHistoryView & { hasTranscript: boolean }) | null> {
  const r = await prisma.sessionHistory.findUnique({ where: { id } });
  return r ? { ...view(r), hasTranscript: !!r.transcriptKey } : null;
}

export async function transcriptOf(id: string): Promise<{ text: string; bytes: number } | null> {
  const r = await prisma.sessionHistory.findUnique({ where: { id }, select: { transcriptKey: true } });
  if (!r?.transcriptKey) return null;
  const text = await readTranscript(r.transcriptKey);
  return text === null ? null : { text, bytes: Buffer.byteLength(text, "utf8") };
}

export async function purgeHistory(q: { projectId?: string; before?: Date }): Promise<number> {
  const where = {
    ...(q.projectId ? { projectId: q.projectId } : {}),
    ...(q.before ? { startedAt: { lt: q.before } } : {}),
  };
  // Berkas transkrip dihapus lebih dulu: baris yang hilang tanpa berkasnya akan meninggalkan
  // sampah di disk yang tak seorang pun bisa menemukan lagi.
  const doomed = await prisma.sessionHistory.findMany({ where, select: { transcriptKey: true } });
  for (const d of doomed) if (d.transcriptKey) await deleteTranscript(d.transcriptKey);
  const { count } = await prisma.sessionHistory.deleteMany({ where });
  return count;
}

// tmux bisa mati di luar hanoman (kill-server, reboot). Tanpa ini, baris tanpa pane akan selamanya
// terbaca "berjalan". Dipanggil sekali saat boot — cermin backfillFeed saat hub boot (ADR-0067).
export async function reconcileHistory(liveSessionIds: string[]): Promise<number> {
  const open = await prisma.sessionHistory.findMany({ where: { endedAt: null }, select: { id: true, sessionId: true, updatedAt: true } });
  const live = new Set(liveSessionIds);
  let closed = 0;
  for (const r of open) {
    if (live.has(r.sessionId)) continue;
    // updatedAt = waktu terbaik yang tersedia; exitCode tetap null karena memang tak diketahui.
    await prisma.sessionHistory.update({ where: { id: r.id }, data: { endedAt: r.updatedAt } });
    closed++;
  }
  return closed;
}

// Dipanggil server.ts sebelum request pertama. Hook fire-and-forget di pty menelan error, jadi
// promise yang gagal di sini tak boleh menggantung sebagai unhandled rejection.
export function installSessionHistory(): void {
  registerSessionHooks({
    onBirth: (b) => { void beginSession(b).catch((e) => console.error("riwayat sesi (lahir):", e)); },
    onDeath: (d) => { void finishSession(d).catch((e) => console.error("riwayat sesi (tutup):", e)); },
  });
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman362' npx vitest run test/session-history.service.test.ts`
Expected: PASS, 10 test.

- [x] **Step 5: Commit**

```bash
git add server/src/services/session-history.ts server/test/session-history.service.test.ts
git commit -m "feat(spec-362): service session-history (begin/finish/list/purge/reconcile)"
```

---

### Task 6: DTO shared, paths, dan route `/terminal/history`

**Files:**
- Modify: `shared/src/dto.ts`
- Modify: `shared/src/api.ts`
- Create: `server/src/routes/session-history.ts`
- Modify: `server/src/app.ts`
- Create: `server/test/session-history.route.test.ts`

**Interfaces:**
- Consumes: service dari Task 5
- Produces: `SessionHistoryView` (shared), `paths.sessionHistory(qs)`, `paths.sessionHistoryItem(id)`, `paths.sessionTranscript(id)`, endpoint `GET /api/terminal/history`, `GET /api/terminal/history/:id`, `GET /api/terminal/history/:id/transcript`, `DELETE /api/terminal/history`

- [x] **Step 1: Tambahkan DTO di shared**

Sisipkan di `shared/src/dto.ts` tepat setelah blok `zSessionResult`/`SessionResultView`:

```ts
// SPEC-362 · ADR-0079 · satu baris riwayat sesi terminal. `transcriptBytes` non-null = transkrip
// tersedia; isinya sendiri diambil terpisah lewat endpoint transcript (bisa sampai 1 MiB).
export const zSessionHistory = z.object({
  id: z.string(), sessionId: z.string(), projectId: z.string(), specId: z.string().nullable(),
  title: z.string().nullable(), kind: z.string(), flow: z.string().nullable(), agent: z.string(),
  model: z.string().nullable(), effort: z.string().nullable(), branch: z.string().nullable(),
  cwd: z.string(), startedAt: z.string(), endedAt: z.string().nullable(),
  exitCode: z.number().nullable(), transcriptBytes: z.number().nullable(),
});
export type SessionHistoryView = z.infer<typeof zSessionHistory>;
```

Tambahkan di `shared/src/api.ts`, tepat setelah baris `terminalWs: (id: string) => …`:

```ts
  // SPEC-362 · ADR-0079 · riwayat sesi. Di bawah prefix /terminal supaya ikut capability
  // `sessions` yang sudah ada (services/agent-capabilities.ts) tanpa menambah domain baru.
  sessionHistory: (qs = "") => `${API}/terminal/history${qs}`,
  sessionHistoryItem: (id: string) => `${API}/terminal/history/${encodeURIComponent(id)}`,
  sessionTranscript: (id: string) => `${API}/terminal/history/${encodeURIComponent(id)}/transcript`,
```

- [x] **Step 2: Write the failing test**

Create `server/test/session-history.route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { beginSession, finishSession } from "../src/services/session-history";

const app = buildApp();
const clean = async () => {
  await prisma.sessionHistory.deleteMany();
  await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(async () => {
  process.env.HANOMAN_TRANSCRIPT_DIR = mkdtempSync(join(tmpdir(), "hanoman-thr-"));
  await clean();
});
afterAll(async () => { await clean(); delete process.env.HANOMAN_TRANSCRIPT_DIR; });

const cookieOf = (r: { headers: Record<string, unknown> }) => (r.headers["set-cookie"] as string).split(";")[0];
const login = async () => cookieOf(await app.inject({
  method: "POST", url: "/api/auth/setup", payload: { email: "a@b.co", password: "password1" } }));

const seed = (n: number) => Promise.all(Array.from({ length: n }, (_, i) =>
  beginSession({
    sessionId: `s${i}`, projectId: i % 2 ? "p2" : "p1", specId: `SPEC-${i}`, flow: "feature",
    kind: "spec", agent: "claude", model: "claude-opus-5", effort: "xhigh", cwd: `/r/.worktrees/s${i}`,
  })));

describe("GET/DELETE /api/terminal/history (SPEC-362)", () => {
  it("401 tanpa cookie", async () => {
    expect((await app.inject({ method: "GET", url: "/api/terminal/history" })).statusCode).toBe(401);
  });

  it("amplop paginasi: items dipotong, total tetap penuh", async () => {
    const cookie = await login();
    await seed(5);
    const r = await app.inject({ method: "GET", url: "/api/terminal/history?page=1&limit=2", headers: { cookie } });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.items).toHaveLength(2);
    expect(b.total).toBe(5);
    expect(b.page).toBe(1);
    expect(b.pageSize).toBe(2);
  });

  it("filter projectId mempersempit total, bukan cuma halaman", async () => {
    const cookie = await login();
    await seed(4);
    const b = (await app.inject({ method: "GET", url: "/api/terminal/history?projectId=p2", headers: { cookie } })).json();
    expect(b.total).toBe(2);
    expect(b.items.every((r: { projectId: string }) => r.projectId === "p2")).toBe(true);
  });

  it("detail + transkrip; tanpa transkrip → 404", async () => {
    const cookie = await login();
    await beginSession({ sessionId: "t1", projectId: "p1", kind: "shell", agent: "claude", cwd: "/r" });
    await finishSession({ sessionId: "t1", exitCode: 0, transcript: "PENANDA-TRANSKRIP" });
    await beginSession({ sessionId: "t2", projectId: "p1", kind: "shell", agent: "claude", cwd: "/r" });
    await finishSession({ sessionId: "t2", exitCode: 0, transcript: null });
    const list = (await app.inject({ method: "GET", url: "/api/terminal/history", headers: { cookie } })).json();
    const withT = list.items.find((r: { sessionId: string }) => r.sessionId === "t1");
    const noT = list.items.find((r: { sessionId: string }) => r.sessionId === "t2");

    const d = await app.inject({ method: "GET", url: `/api/terminal/history/${withT.id}`, headers: { cookie } });
    expect(d.json().hasTranscript).toBe(true);

    const t = await app.inject({ method: "GET", url: `/api/terminal/history/${withT.id}/transcript`, headers: { cookie } });
    expect(t.statusCode).toBe(200);
    expect(t.json().text).toContain("PENANDA-TRANSKRIP");

    expect((await app.inject({ method: "GET", url: `/api/terminal/history/${noT.id}/transcript`, headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/terminal/history/tidak-ada", headers: { cookie } })).statusCode).toBe(404);
  });

  it("purge menolak tanpa parameter, lalu menghapus ber-scope", async () => {
    const cookie = await login();
    await seed(4);
    expect((await app.inject({ method: "DELETE", url: "/api/terminal/history", headers: { cookie } })).statusCode).toBe(400);
    const r = await app.inject({ method: "DELETE", url: "/api/terminal/history?projectId=p1", headers: { cookie } });
    expect(r.json().purged).toBe(2);
    expect((await app.inject({ method: "GET", url: "/api/terminal/history", headers: { cookie } })).json().total).toBe(2);
  });

  it("before bukan tanggal valid → 400", async () => {
    const cookie = await login();
    expect((await app.inject({ method: "DELETE", url: "/api/terminal/history?before=bukan-tanggal", headers: { cookie } })).statusCode).toBe(400);
  });
});
```

- [x] **Step 3: Run test to verify it fails**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman362' npx vitest run test/session-history.route.test.ts`
Expected: FAIL — semua request riwayat balas 404 (route belum terdaftar).

- [x] **Step 4: Write minimal implementation**

Create `server/src/routes/session-history.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { listHistory, getHistory, transcriptOf, purgeHistory } from "../services/session-history";

// SPEC-362 · ADR-0079 · baca & purge riwayat sesi terminal. Path sengaja di bawah /terminal:
// capabilityForRoute() sudah memetakan seluruh top-level `terminal` ke sessions:read|write, jadi
// endpoint ini tergerbang tanpa menambah domain capability baru (ADR-0065).
export default async function (app: FastifyInstance) {
  app.get("/terminal/history", async (req) => {
    const q = req.query as { projectId?: string; specId?: string; kind?: string; q?: string; page?: string; limit?: string };
    return listHistory(q);
  });

  app.get("/terminal/history/:id", async (req, reply) => {
    const r = await getHistory((req.params as { id: string }).id);
    return r ?? reply.code(404).send({ error: "not found" });
  });

  app.get("/terminal/history/:id/transcript", async (req, reply) => {
    const t = await transcriptOf((req.params as { id: string }).id);
    // Tak ada transkrip dan riwayat tak ada sama-sama 404: dari sisi pemanggil keduanya berarti
    // "tak ada yang bisa ditampilkan", dan membedakannya tak mengubah apa pun di UI.
    return t ?? reply.code(404).send({ error: "not found" });
  });

  app.delete("/terminal/history", async (req, reply) => {
    const { projectId, before } = req.query as { projectId?: string; before?: string };
    // Cermin DELETE /session-results (ADR-0047): append-only, purge WAJIB ber-scope — tanpa
    // parameter, satu request salah ketik akan menghapus seluruh riwayat.
    if (!projectId && !before) return reply.code(400).send({ error: "purge butuh projectId dan/atau before" });
    let cut: Date | undefined;
    if (before) {
      cut = new Date(before);
      if (Number.isNaN(cut.getTime())) return reply.code(400).send({ error: "before bukan tanggal valid" });
    }
    return { purged: await purgeHistory({ projectId, before: cut }) };
  });
}
```

Di `server/src/app.ts`: tambah impor di dekat `import sessionResults from "./routes/session-results";`

```ts
import sessionHistory from "./routes/session-history";
```

dan registrasi tepat setelah `await api.register(sessionResults);`:

```ts
    await api.register(sessionHistory);  // SPEC-362 · riwayat sesi terminal (di belakang gate cookie)
```

- [x] **Step 5: Run test to verify it passes**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman362' npx vitest run test/session-history.route.test.ts`
Expected: PASS, 6 test.

- [x] **Step 6: Commit**

```bash
git add shared/src/dto.ts shared/src/api.ts server/src/routes/session-history.ts server/src/app.ts server/test/session-history.route.test.ts
git commit -m "feat(spec-362): endpoint GET/DELETE /terminal/history + DTO SessionHistoryView"
```

---

### Task 7: Pasang hook & reconcile saat boot

**Files:**
- Modify: `server/src/server.ts`

**Interfaces:**
- Consumes: `installSessionHistory`, `reconcileHistory` (Task 5); `listSessions` dari `./services/pty`
- Produces: —

- [x] **Step 1: Pasang di server.ts**

Tambah impor di dekat impor scheduler:

```ts
import { installSessionHistory, reconcileHistory } from "./services/session-history";
import { listSessions } from "./services/pty";
```

Di dalam `app.listen(...).then(() => { … })`, sisipkan **sebelum** `startVpsMonitor()`:

```ts
  // SPEC-362 · ADR-0079 · pasang hook riwayat SEBELUM apa pun bisa melahirkan sesi, lalu tutup
  // baris "berjalan" yang panenya sudah lenyap (tmux mati di luar hanoman: kill-server, reboot).
  installSessionHistory();
  void reconcileHistory(listSessions().map((s) => s.id))
    .then((n) => { if (n) console.log(`riwayat sesi: ${n} baris berjalan direkonsiliasi`); })
    .catch((e) => console.error("rekonsiliasi riwayat sesi:", e));
```

- [x] **Step 2: Verifikasi build server**

Run: `cd server && npm run build`
Expected: exit 0, tanpa error TypeScript.

- [x] **Step 3: Verifikasi seluruh suite server masih hijau**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman362' npx vitest run --no-file-parallelism`
Expected: seluruh test PASS.

- [x] **Step 4: Commit**

```bash
git add server/src/server.ts
git commit -m "feat(spec-362): pasang hook riwayat sesi + rekonsiliasi saat boot"
```

---

### Task 8: Klien API frontend

**Files:**
- Modify: `src/src/api/client.ts`

**Interfaces:**
- Consumes: `paths.sessionHistory*` (Task 6), `SessionHistoryView` (Task 6)
- Produces:
  - `api.listSessionHistory(p: { projectId?: string; kind?: string; q?: string; page?: number; limit?: number }): Promise<Paginated<SessionHistoryView>>`
  - `api.sessionTranscript(id: string): Promise<{ text: string; bytes: number }>`

- [x] **Step 1: Tambahkan metode klien**

Di `src/src/api/client.ts`, tambahkan `SessionHistoryView` ke daftar `import type … from "@hanoman/shared"` di baris 1, lalu sisipkan tepat setelah `sessionResults: …` (sekitar baris 278):

```ts
  // SPEC-362 · ADR-0079 · riwayat sesi terminal. Paginasi di server (amplop Paginated); UI memakai
  // muat-lebih, jadi ia menaikkan `page` dan MENAMBAH item, bukan menggantinya.
  listSessionHistory: (p: { projectId?: string; kind?: string; q?: string; page?: number; limit?: number } = {}) =>
    j<Paginated<SessionHistoryView>>(paths.sessionHistory(qs(p))),
  sessionTranscript: (id: string) => j<{ text: string; bytes: number }>(paths.sessionTranscript(id)),
```

- [x] **Step 2: Verifikasi typecheck frontend**

Run: `cd src && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [x] **Step 3: Commit**

```bash
git add src/src/api/client.ts
git commit -m "feat(spec-362): klien API riwayat sesi + transkrip"
```

---

### Task 9: Modal riwayat — daftar, filter, muat lebih

**Files:**
- Create: `src/src/screens/SessionHistoryModal.tsx`
- Create: `src/test/session-history-modal.test.tsx`

**Interfaces:**
- Consumes: `api.listSessionHistory`, `SESSION_KIND_LABEL`, `SESSION_KINDS`
- Produces: `export function SessionHistoryModal({ projects, onClose, onRestart }: { projects: { id: string; name: string }[]; onClose: () => void; onRestart: (row: SessionHistoryView) => void })`

- [x] **Step 1: Write the failing test**

Create `src/test/session-history-modal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const listSessionHistory = vi.fn();
const sessionTranscript = vi.fn();
vi.mock("../src/api/client", () => ({
  api: {
    listSessionHistory: (...a: unknown[]) => listSessionHistory(...a),
    sessionTranscript: (...a: unknown[]) => sessionTranscript(...a),
  },
  ApiError: class extends Error {},
}));
import { SessionHistoryModal } from "../src/screens/SessionHistoryModal";

const row = (over: Record<string, unknown> = {}) => ({
  id: "h1", sessionId: "spec-362", projectId: "p1", specId: "SPEC-362", title: "History session terminal",
  kind: "spec", flow: "feature", agent: "claude", model: "claude-opus-5", effort: "xhigh",
  branch: null, cwd: "/r/.worktrees/spec-362", startedAt: "2026-07-28T01:00:00.000Z",
  endedAt: "2026-07-28T02:00:00.000Z", exitCode: 0, transcriptBytes: 42, ...over,
});

beforeEach(() => {
  listSessionHistory.mockReset(); sessionTranscript.mockReset();
});

const projects = [{ id: "p1", name: "hanoman" }];

describe("SessionHistoryModal (SPEC-362)", () => {
  it("merender baris riwayat dengan label kind manusia, bukan slug", async () => {
    listSessionHistory.mockResolvedValue({ items: [row()], total: 1, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    expect(await screen.findByText("History session terminal")).toBeTruthy();
    expect(screen.getByText("Backlog")).toBeTruthy();     // SESSION_KIND_LABEL.spec
    expect(screen.queryByText("spec")).toBeNull();
  });

  it("sesi yang belum ditutup terbaca 'berjalan'", async () => {
    listSessionHistory.mockResolvedValue({
      items: [row({ endedAt: null, exitCode: null })], total: 1, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    expect(await screen.findByText("berjalan")).toBeTruthy();
  });

  it("Muat lebih MENAMBAH halaman berikutnya, bukan menggantinya", async () => {
    listSessionHistory
      .mockResolvedValueOnce({ items: [row({ id: "h1", title: "Pertama" })], total: 2, page: 1, pageSize: 1 })
      .mockResolvedValueOnce({ items: [row({ id: "h2", title: "Kedua" })], total: 2, page: 2, pageSize: 1 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    expect(await screen.findByText("Pertama")).toBeTruthy();
    fireEvent.click(screen.getByText("Muat lebih"));
    await waitFor(() => expect(screen.getByText("Kedua")).toBeTruthy());
    expect(screen.getByText("Pertama")).toBeTruthy();   // yang lama tetap ada
  });

  it("baris penutup membedakan 'masih ada' dari 'seluruh riwayat'", async () => {
    listSessionHistory.mockResolvedValue({ items: [row()], total: 1, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    expect(await screen.findByText(/seluruh riwayat/)).toBeTruthy();
    expect(screen.queryByText("Muat lebih")).toBeNull();
  });

  it("filter project memanggil ulang API dengan projectId", async () => {
    listSessionHistory.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    await waitFor(() => expect(listSessionHistory).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Filter project"), { target: { value: "p1" } });
    await waitFor(() =>
      expect(listSessionHistory.mock.calls.at(-1)?.[0]).toMatchObject({ projectId: "p1", page: 1 }));
  });

  it("riwayat kosong menampilkan StateBlock, bukan daftar kosong tanpa penjelasan", async () => {
    listSessionHistory.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    expect(await screen.findByText("Belum ada riwayat sesi")).toBeTruthy();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL npx vitest run test/session-history-modal.test.tsx`
Expected: FAIL — `Failed to resolve import "../src/screens/SessionHistoryModal"`.

- [x] **Step 3: Write minimal implementation**

Create `src/src/screens/SessionHistoryModal.tsx`:

```tsx
import React from "react";
import { Modal, Input, Select, Button, Badge, StateBlock, Icon } from "../ds";
import { api } from "../api/client";
import { SESSION_KINDS, SESSION_KIND_LABEL, type SessionHistoryView } from "@hanoman/shared";

const PAGE = 20;

// Durasi manusiawi. Sesi yang belum ditutup tak punya durasi — jangan mengarang "0 dtk".
export function humanDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return "—";
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} dtk`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} mnt`;
  const h = Math.floor(m / 60);
  return `${h} jam ${m % 60} mnt`;
}

export function statusOf(r: SessionHistoryView): { label: string; tone: "ok" | "err" | "neutral" } {
  if (!r.endedAt) return { label: "berjalan", tone: "neutral" };
  if (r.exitCode === null) return { label: "selesai", tone: "ok" };
  return r.exitCode === 0 ? { label: "selesai", tone: "ok" } : { label: `exit ${r.exitCode}`, tone: "err" };
}

// SPEC-362 · ADR-0079 · riwayat sesi sebagai MODAL, bukan panel tetap: grid terminal di belakangnya
// tak berubah ukuran sama sekali (syarat "tidak menghalangi UI terminal"). Pola sama dengan
// BacklogPicker di TerminalScreen.
export function SessionHistoryModal({ projects, onClose, onRestart }: {
  projects: { id: string; name: string }[];
  onClose: () => void;
  onRestart: (row: SessionHistoryView) => void;
}) {
  const [items, setItems] = React.useState<SessionHistoryView[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(false);
  const [project, setProject] = React.useState("");
  const [kind, setKind] = React.useState("");
  const [q, setQ] = React.useState("");
  const [dq, setDq] = React.useState("");
  const [selected, setSelected] = React.useState<SessionHistoryView | null>(null);

  React.useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  // Ganti penyaring = jendela riwayat dimulai ulang dari halaman 1; tanpa reset, item halaman lama
  // dari filter sebelumnya akan menempel di bawah hasil baru.
  React.useEffect(() => { setItems([]); setPage(1); }, [project, kind, dq]);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    api.listSessionHistory({
      projectId: project || undefined, kind: kind || undefined, q: dq || undefined, page, limit: PAGE,
    })
      .then((r) => {
        if (!alive) return;
        setTotal(r.total);
        // page 1 = ganti (filter baru), page > 1 = tambah (muat lebih).
        setItems((prev) => (r.page > 1 ? [...prev, ...r.items] : r.items));
      })
      .catch(() => { if (alive) { setItems([]); setTotal(0); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [project, kind, dq, page]);

  const hasMore = items.length < total;
  const sentinel = React.useRef<HTMLDivElement | null>(null);
  // Auto-load saat penutup daftar terlihat; tombol manual tetap ada sebagai fallback (jsdom &
  // browser tanpa IntersectionObserver tak boleh kehilangan aksesnya) — pola SPEC-351.
  React.useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || loading || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setPage((p) => p + 1); });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, items.length]);

  const nameOf = (pid: string) => projects.find((p) => p.id === pid)?.name ?? pid;

  return (
    <Modal open title="Riwayat sesi" icon="history" onClose={onClose} width={900}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <Input size="sm" leftIcon="search" placeholder="Cari sesi…" aria-label="Cari riwayat sesi"
          value={q} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
          style={{ flex: "1 1 200px" }} />
        <Select size="sm" aria-label="Filter project" value={project} onChange={(e) => setProject(e.target.value)}
          options={[{ value: "", label: "Semua project" }].concat(projects.map((p) => ({ value: p.id, label: p.name })))} />
        <Select size="sm" aria-label="Filter jenis" value={kind} onChange={(e) => setKind(e.target.value)}
          options={[{ value: "", label: "Semua jenis" }].concat(
            SESSION_KINDS.map((k) => ({ value: k, label: SESSION_KIND_LABEL[k] })))} />
      </div>

      {items.length === 0 && !loading ? (
        <StateBlock kind="empty" icon="history" title="Belum ada riwayat sesi"
          hint="Riwayat terisi sendiri saat sesi terminal dibuka lalu ditutup — termasuk sesi backlog, terminal biasa, dan sesi project-level." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", maxHeight: "60vh", overflowY: "auto" }}>
          {items.map((r) => {
            const st = statusOf(r);
            return (
              <button key={r.id} onClick={() => setSelected(r)} style={{
                all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                padding: "9px 8px", borderBottom: "1px solid var(--border-hair)",
              }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)", flex: "0 0 132px" }}>
                  {new Date(r.startedAt).toLocaleString("id-ID")}
                </span>
                <Badge size="sm" tone="neutral">{SESSION_KIND_LABEL[r.kind as keyof typeof SESSION_KIND_LABEL] ?? r.kind}</Badge>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--text-strong)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.title ?? r.specId ?? nameOf(r.projectId)}
                </span>
                {r.transcriptBytes !== null && <Icon name="file-text" size={12} color="var(--text-subtle)" />}
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", flex: "0 0 72px" }}>
                  {humanDuration(r.startedAt, r.endedAt)}
                </span>
                <Badge size="sm" tone={st.tone}>{st.label}</Badge>
              </button>
            );
          })}
          {/* Baris penutup: daftar yang HABIS harus terbaca berbeda dari daftar yang terpotong —
              pelajaran SPEC-351, di mana keduanya tak terbedakan dan terbaca sebagai bug. */}
          <div ref={sentinel} style={{ padding: "10px 8px", textAlign: "center", fontSize: 11, color: "var(--text-subtle)" }}>
            {loading ? "memuat…"
              : hasMore
                ? <Button size="sm" variant="ghost" onClick={() => setPage((p) => p + 1)}>Muat lebih</Button>
                : `${items.length} dari ${total} — seluruh riwayat`}
          </div>
        </div>
      )}

      {selected && <SessionHistoryDetail row={selected} projectName={nameOf(selected.projectId)}
        onBack={() => setSelected(null)} onRestart={onRestart} />}
    </Modal>
  );
}
```

Untuk sementara, tambahkan stub `SessionHistoryDetail` di bawah berkas yang sama (diisi penuh di Task 10):

```tsx
function SessionHistoryDetail(_: {
  row: SessionHistoryView; projectName: string; onBack: () => void; onRestart: (r: SessionHistoryView) => void;
}) { return null; }
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL npx vitest run test/session-history-modal.test.tsx`
Expected: PASS, 6 test.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/SessionHistoryModal.tsx src/test/session-history-modal.test.tsx
git commit -m "feat(spec-362): modal riwayat sesi — filter, daftar, muat lebih"
```

---

### Task 10: Detail riwayat — transkrip + Mulai lagi

**Files:**
- Modify: `src/src/screens/SessionHistoryModal.tsx` (ganti stub `SessionHistoryDetail`)
- Modify: `src/test/session-history-modal.test.tsx` (tambah `describe` baru)

**Interfaces:**
- Consumes: `api.sessionTranscript`, `restartableKind` dari `@hanoman/shared`
- Produces: panel detail di dalam modal yang sama

- [x] **Step 1: Write the failing test**

Tambahkan di akhir `src/test/session-history-modal.test.tsx`:

```tsx
describe("SessionHistoryModal — detail (SPEC-362)", () => {
  it("klik baris memuat transkrip dan menampilkannya", async () => {
    listSessionHistory.mockResolvedValue({ items: [row()], total: 1, page: 1, pageSize: 20 });
    sessionTranscript.mockResolvedValue({ text: "PENANDA-TRANSKRIP", bytes: 17 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    fireEvent.click(await screen.findByText("History session terminal"));
    expect(await screen.findByText(/PENANDA-TRANSKRIP/)).toBeTruthy();
  });

  it("baris tanpa transkrip tak memanggil endpoint transkrip", async () => {
    listSessionHistory.mockResolvedValue({ items: [row({ transcriptBytes: null })], total: 1, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    fireEvent.click(await screen.findByText("History session terminal"));
    expect(await screen.findByText(/Tanpa transkrip/)).toBeTruthy();
    expect(sessionTranscript).not.toHaveBeenCalled();
  });

  it("'Mulai lagi' memanggil onRestart dengan barisnya (kind restartable)", async () => {
    const onRestart = vi.fn();
    listSessionHistory.mockResolvedValue({ items: [row()], total: 1, page: 1, pageSize: 20 });
    sessionTranscript.mockResolvedValue({ text: "x", bytes: 1 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={onRestart} />);
    fireEvent.click(await screen.findByText("History session terminal"));
    fireEvent.click(await screen.findByText("Mulai lagi"));
    expect(onRestart).toHaveBeenCalledWith(expect.objectContaining({ id: "h1" }));
  });

  it("kind tak restartable tak menawarkan 'Mulai lagi'", async () => {
    listSessionHistory.mockResolvedValue({
      items: [row({ kind: "prd", title: "PRD sesuatu", transcriptBytes: null })], total: 1, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    fireEvent.click(await screen.findByText("PRD sesuatu"));
    expect(await screen.findByText(/Tanpa transkrip/)).toBeTruthy();
    expect(screen.queryByText("Mulai lagi")).toBeNull();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL npx vitest run test/session-history-modal.test.tsx -t "detail"`
Expected: FAIL — teks transkrip / tombol tak ditemukan (stub mengembalikan null).

- [x] **Step 3: Write minimal implementation**

Ganti stub `SessionHistoryDetail` di `src/src/screens/SessionHistoryModal.tsx` dengan:

```tsx
// Detail satu baris riwayat: metadata + transkrip read-only. Transkrip dirender sebagai TEKS POLOS
// di <pre> — server menyimpannya tanpa `capture-pane -e`, jadi tak ada ANSI yang perlu (atau boleh)
// ditafsirkan jadi HTML.
function SessionHistoryDetail({ row, projectName, onBack, onRestart }: {
  row: SessionHistoryView; projectName: string; onBack: () => void; onRestart: (r: SessionHistoryView) => void;
}) {
  const [text, setText] = React.useState<string | null>(null);
  const [state, setState] = React.useState<"idle" | "loading" | "none" | "error">("idle");

  React.useEffect(() => {
    // Baris tanpa transkrip tak perlu request — 404-nya sudah bisa diprediksi dari metadata.
    if (row.transcriptBytes === null) { setState("none"); setText(null); return; }
    let alive = true;
    setState("loading");
    api.sessionTranscript(row.id)
      .then((r) => { if (alive) { setText(r.text); setState("idle"); } })
      .catch(() => { if (alive) { setText(null); setState("error"); } });
    return () => { alive = false; };
  }, [row.id, row.transcriptBytes]);

  const meta: [string, string][] = [
    ["Project", projectName],
    ["Sesi", row.sessionId],
    ["Jenis", SESSION_KIND_LABEL[row.kind as keyof typeof SESSION_KIND_LABEL] ?? row.kind],
    ["Agen", [row.agent, row.model, row.effort].filter(Boolean).join(" · ")],
    ["Mulai", new Date(row.startedAt).toLocaleString("id-ID")],
    ["Selesai", row.endedAt ? new Date(row.endedAt).toLocaleString("id-ID") : "berjalan"],
    ["Durasi", humanDuration(row.startedAt, row.endedAt)],
    ["Direktori", row.cwd],
  ];
  if (row.specId) meta.splice(1, 0, ["Backlog", `${row.specId}${row.title ? ` · ${row.title}` : ""}`]);
  if (row.branch) meta.push(["Branch", row.branch]);

  return (
    <Modal open title={row.title ?? row.specId ?? row.sessionId} icon="history" onClose={onBack} width={1000}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <Button size="sm" variant="ghost" leftIcon="arrow-left" onClick={onBack}>Kembali</Button>
        <div style={{ flex: 1 }} />
        {text && (
          <Button size="sm" variant="secondary" leftIcon="copy"
            onClick={() => void navigator.clipboard?.writeText(text)}>Salin transkrip</Button>
        )}
        {/* Sesi lama tak pernah "hidup lagi" — tmux sudah membunuhnya. Ini men-spawn sesi BARU
            dengan konteks yang sama, dan hanya untuk kind yang konteksnya bisa dibangun ulang. */}
        {restartableKind(row.kind) && (
          <Button size="sm" leftIcon="play" onClick={() => onRestart(row)}>Mulai lagi</Button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", marginBottom: 12,
        fontSize: 12 }}>
        {meta.map(([k, v]) => (
          <React.Fragment key={k}>
            <span style={{ color: "var(--text-subtle)" }}>{k}</span>
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-body)", wordBreak: "break-all" }}>{v}</span>
          </React.Fragment>
        ))}
      </div>

      {state === "loading" && <div style={{ fontSize: 12, color: "var(--text-subtle)" }}>memuat transkrip…</div>}
      {state === "none" && (
        <div style={{ fontSize: 12, color: "var(--text-subtle)" }}>
          Tanpa transkrip — sesi ini ditutup sebelum fitur riwayat ada, atau panenya tak menyisakan keluaran.
        </div>
      )}
      {state === "error" && (
        <div style={{ fontSize: 12, color: "var(--clay-600)" }}>Transkrip tak terbaca lagi di server.</div>
      )}
      {text !== null && (
        <pre style={{
          maxHeight: "52vh", overflow: "auto", margin: 0, padding: 10,
          background: "var(--bone-200)", border: "1px solid var(--border-hair)",
          borderRadius: "var(--radius-sm)", fontFamily: "var(--font-mono)", fontSize: 11,
          whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--text-body)",
        }}>{text}</pre>
      )}
    </Modal>
  );
}
```

Tambahkan `restartableKind` ke impor `@hanoman/shared` di atas berkas:

```tsx
import { SESSION_KINDS, SESSION_KIND_LABEL, restartableKind, type SessionHistoryView } from "@hanoman/shared";
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL npx vitest run test/session-history-modal.test.tsx`
Expected: PASS, 10 test.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/SessionHistoryModal.tsx src/test/session-history-modal.test.tsx
git commit -m "feat(spec-362): detail riwayat — transkrip read-only + Mulai lagi"
```

---

### Task 11: Tombol Riwayat di Terminal + aksi Mulai lagi

**Files:**
- Modify: `src/src/screens/TerminalScreen.tsx`
- Create: `src/test/terminal-history-button.test.tsx`

**Interfaces:**
- Consumes: `SessionHistoryModal` (Task 9/10), `api.startSession`/`api.createTerminal`/`api.createShell`
- Produces: —

- [x] **Step 1: Write the failing test**

Create `src/test/terminal-history-button.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const listSessionHistory = vi.fn();
const sessionTranscript = vi.fn();
const startSession = vi.fn();
const createShell = vi.fn();
const createTerminal = vi.fn();
vi.mock("../src/api/client", () => ({
  api: {
    listTerminals: vi.fn(async () => []),
    listSpecs: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 0 })),
    listSessionHistory: (...a: unknown[]) => listSessionHistory(...a),
    sessionTranscript: (...a: unknown[]) => sessionTranscript(...a),
    startSession: (...a: unknown[]) => startSession(...a),
    createShell: (...a: unknown[]) => createShell(...a),
    createTerminal: (...a: unknown[]) => createTerminal(...a),
    deleteTerminal: vi.fn(async () => {}),
  },
  ApiError: class extends Error {},
}));
vi.mock("../src/api/events", () => ({ subscribe: () => () => {} }));
vi.mock("../src/screens/TerminalPane", () => ({ TerminalPane: () => <div data-testid="pane" /> }));
import { TerminalScreen } from "../src/screens/TerminalScreen";

const row = (over: Record<string, unknown> = {}) => ({
  id: "h1", sessionId: "spec-362", projectId: "p1", specId: "SPEC-362", title: "History session terminal",
  kind: "spec", flow: "feature", agent: "claude", model: null, effort: null, branch: null,
  cwd: "/r", startedAt: "2026-07-28T01:00:00.000Z", endedAt: "2026-07-28T02:00:00.000Z",
  exitCode: 0, transcriptBytes: null, ...over,
});

beforeEach(() => {
  [listSessionHistory, sessionTranscript, startSession, createShell, createTerminal].forEach((m) => m.mockReset());
  startSession.mockResolvedValue({ id: "spec-362" });
  createShell.mockResolvedValue({ id: "sh1" });
  createTerminal.mockResolvedValue({ id: "t1" });
});

const projects = [{ id: "p1", name: "hanoman" }];

describe("Riwayat di Terminal (SPEC-362)", () => {
  it("riwayat TIDAK dirender sebelum diminta — grid terminal tak terhalangi", async () => {
    render(<TerminalScreen projects={projects} backlog={[]} />);
    await waitFor(() => expect(screen.getByTestId("terminal-root")).toBeTruthy());
    expect(screen.queryByText("Riwayat sesi")).toBeNull();
    expect(listSessionHistory).not.toHaveBeenCalled();
  });

  it("tombol Riwayat membuka modal & memuat halaman pertama", async () => {
    listSessionHistory.mockResolvedValue({ items: [row()], total: 1, page: 1, pageSize: 20 });
    render(<TerminalScreen projects={projects} backlog={[]} />);
    fireEvent.click(await screen.findByText("Riwayat"));
    expect(await screen.findByText("Riwayat sesi")).toBeTruthy();
    await waitFor(() => expect(listSessionHistory).toHaveBeenCalled());
  });

  it("Mulai lagi sesi backlog memanggil startSession dengan spec + flow tersimpan", async () => {
    listSessionHistory.mockResolvedValue({ items: [row()], total: 1, page: 1, pageSize: 20 });
    render(<TerminalScreen projects={projects} backlog={[]} />);
    fireEvent.click(await screen.findByText("Riwayat"));
    fireEvent.click(await screen.findByText("History session terminal"));
    fireEvent.click(await screen.findByText("Mulai lagi"));
    await waitFor(() => expect(startSession).toHaveBeenCalledWith({ spec: "SPEC-362", flow: "feature" }));
  });

  it("Mulai lagi terminal biasa memanggil createShell dengan projectnya", async () => {
    listSessionHistory.mockResolvedValue({
      items: [row({ kind: "shell", specId: null, title: null, flow: null })], total: 1, page: 1, pageSize: 20 });
    render(<TerminalScreen projects={projects} backlog={[]} />);
    fireEvent.click(await screen.findByText("Riwayat"));
    fireEvent.click(await screen.findByText("hanoman"));
    fireEvent.click(await screen.findByText("Mulai lagi"));
    await waitFor(() => expect(createShell).toHaveBeenCalledWith("p1"));
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL npx vitest run test/terminal-history-button.test.tsx`
Expected: FAIL — `Unable to find an element with the text: Riwayat`.

- [x] **Step 3: Write minimal implementation**

Di `src/src/screens/TerminalScreen.tsx`:

(a) Tambah impor:

```tsx
import { SessionHistoryModal } from "./SessionHistoryModal";
import type { SessionHistoryView } from "@hanoman/shared";
```

(b) Tambah state di dekat `const [picking, setPicking] = React.useState(false);`:

```tsx
  // SPEC-362 · riwayat sesi. State-nya sekadar boolean: modal baru dirender saat diminta, jadi
  // tak ada request riwayat maupun elemen tambahan selama operator tak membukanya.
  const [historyOpen, setHistoryOpen] = React.useState(false);
```

(c) Tambah handler di dekat `pickBacklog`:

```tsx
  // SPEC-362 · "Mulai lagi" = sesi BARU dengan konteks yang sama; sesi lamanya sudah mati bersama
  // panenya. Endpoint yang dipakai persis endpoint yang melahirkan sesi jenis itu pertama kali.
  async function restartFromHistory(r: SessionHistoryView) {
    try {
      const born = r.specId
        ? await api.startSession({ spec: r.specId, flow: (r.flow ?? "feature") as Flow })
        : r.kind === "shell"
          ? await api.createShell(r.projectId)
          : r.kind === "terminal"
            ? await api.createTerminal(r.projectId)
            : await api.createTerminalFlow(r.projectId, r.kind as Flow);
      setSessions((s) => (s.some((x) => x.id === born.id)
        ? s
        : [...s, { id: born.id, projectId: r.projectId, specId: r.specId ?? undefined, cwd: "", exited: false }]));
      setWs((w) => W.placeFirstEmptyInActive(w, born.id));
      setHistoryOpen(false);
    } catch {
      // Gagal (project tak ter-bind, worktree tak bisa dibuat) — biarkan modal terbuka; pesan
      // detailnya sudah muncul di jalur Start biasa, riwayat tak perlu menduplikasinya.
    }
  }
```

(d) Tambah tombol di toolbar, tepat sebelum `<Button … leftIcon="terminal" …>Terminal biasa</Button>`:

```tsx
          <Button size="sm" variant="secondary" leftIcon="history"
            title="Riwayat sesi yang sudah berlalu — buka kembali atau baca transkripnya"
            onClick={() => setHistoryOpen(true)}>Riwayat</Button>
```

(e) Render modal, tepat setelah blok `{picking && (…)}`:

```tsx
      {historyOpen && (
        <SessionHistoryModal projects={projects} onClose={() => setHistoryOpen(false)}
          onRestart={(r) => void restartFromHistory(r)} />
      )}
```

(f) Tambahkan helper klien yang dipakai cabang `reverse`/`scaffold`/`cross-audit` di
`src/src/api/client.ts`, tepat setelah `scaffoldDocs`:

```ts
  // SPEC-362 · "Mulai lagi" sesi project-level dari riwayat (reverse/scaffold/cross-audit): bentuk
  // body-nya identik dengan reverseDocs/scaffoldDocs, hanya flow-nya yang datang dari baris riwayat.
  createTerminalFlow: (project: string, flow: Flow) =>
    j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body({ project, flow }) }),
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL npx vitest run test/terminal-history-button.test.tsx`
Expected: PASS, 4 test.

- [x] **Step 5: Verifikasi seluruh suite frontend hijau**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL npx vitest run`
Expected: seluruh test PASS (termasuk `terminal-screen.test.tsx` yang lama).

- [x] **Step 6: Commit**

```bash
git add src/src/screens/TerminalScreen.tsx src/src/api/client.ts src/test/terminal-history-button.test.tsx
git commit -m "feat(spec-362): tombol Riwayat di Terminal + Mulai lagi dari riwayat"
```

---

### Task 12: ADR-0079 + docs Source of Truth

**Files:**
- Create: `internal/docs/adr/0079-history-sesi-terminal-store-lokal-plus-transkrip.md`
- Modify: `internal/docs/README.md`
- Modify: `internal/docs/architecture/data-model.md`
- Modify: `internal/docs/architecture/api-contract.md`
- Modify: `internal/docs/frontend/frontend-implementation.md`
- Modify: `internal/docs/security/security-standard.md`
- Modify: `internal/skills/hanoman/SKILL.md`

**Interfaces:**
- Consumes: seluruh keputusan Task 1–11
- Produces: —

- [x] **Step 1: Tulis ADR-0079**

Create `internal/docs/adr/0079-history-sesi-terminal-store-lokal-plus-transkrip.md` dengan bagian:

- **Judul:** `# ADR-0079 — Riwayat sesi terminal: store LOCAL-only + transkrip berkas, hook di dua titik cekik pty`
- **Status:** `aktif (SPEC-362). Memperluas 0016 (tmux sumber kebenaran sesi HIDUP) & 0047 (activity log stage); membuka pengecualian TERBATAS atas larangan transkrip di 0047. Terkait 0002/0015/0028/0038/0065.`
- **Konteks:** tmux satu-satunya sumber kebenaran → `DELETE /terminal/sessions/:id` menghapus sesi + worktree tanpa jejak; `SessionResult` hanya lahir saat transisi stage spec sehingga shell/PRD/reverse/scaffold/breakdown/cross-audit/VPS tak pernah tercatat, dan whitelist-nya melarang transkrip.
- **Keputusan (enam poin):**
  1. Tabel `SessionHistory` LOCAL-only, PK uuid (bukan `sessionId`, yang berulang untuk sesi spec), tanpa FK ke `Project` (sesi VPS memakai projectId sintetis).
  2. Baris lahir saat sesi lahir (bukan saat ditutup) → sesi berjalan pun sudah ada di riwayat.
  3. Hook `registerSessionHooks` di `createSession`/`killSession`; `pty.ts` tetap nol dependensi DB.
  4. Transkrip = `capture-pane -p -J -S -50000` **tanpa `-e`**, disimpan sebagai berkas (cap 1 MiB, menyimpan ekor) di `HANOMAN_TRANSCRIPT_DIR`.
  5. `GET /api/terminal/history*` — di bawah prefix `/terminal` agar mewarisi capability `sessions`; `skip`/`take` DB sah karena tak ada overlay (beda dari larangan ADR-0038 untuk `GET /specs`).
  6. UI = modal di Terminal, muat-lebih; "Mulai lagi" men-spawn sesi baru lewat endpoint yang sudah ada, dibatasi `restartableKind`.
- **Konsekuensi:** riwayat tumbuh → purge manual ber-scope (cermin ADR-0047); transkrip sekelas isi repo → LOCAL-only, tak pernah ke hub; **ponytail:** sesi yang panenya lenyap tanpa lewat `killSession` (tmux `kill-server`, reboot) kehilangan transkripnya — `reconcileHistory()` saat boot hanya menutup barisnya, tak bisa memulihkan isi.

- [x] **Step 2: Tautkan di index**

Di `internal/docs/README.md`, di bagian `## adr` **paling atas** (di atas baris 0076):

```markdown
- [0077 — Riwayat sesi terminal: store LOCAL-only + transkrip berkas, hook di dua titik cekik pty](adr/0079-history-sesi-terminal-store-lokal-plus-transkrip.md) — **memperluas 0016/0047**, membuka pengecualian terbatas atas larangan transkrip di 0047, terkait 0002/0015/0028/0038/0065 (SPEC-362): `SessionHistory` LOCAL-only (PK uuid — `sessionId` sesi spec berulang tiap reopen), baris lahir saat sesi LAHIR sehingga sesi berjalan pun tercatat; `registerSessionHooks` ditembak dari `createSession`/`killSession` sehingga `pty.ts` tetap nol dependensi DB dan 12 call site tak tersentuh; transkrip `capture-pane` tanpa `-e` (teks polos, cap 1 MiB menyimpan ekor) jadi berkas di `HANOMAN_TRANSCRIPT_DIR`, DB hanya pointer; `GET/DELETE /api/terminal/history*` mewarisi capability `sessions`, `skip`/`take` DB sah karena tak ada overlay live; UI modal di Terminal (muat-lebih) + "Mulai lagi" ber-`restartableKind`
```

- [x] **Step 3: Perbarui data-model, api-contract, frontend, security**

- `architecture/data-model.md`: tambah bagian `SessionHistory` (kolom + kenapa PK uuid + kenapa tanpa FK + LOCAL-only, tak masuk `SYNCED`).
- `architecture/api-contract.md`: tambah keempat endpoint dengan parameter, bentuk respons `Paginated<SessionHistoryView>`, dan aturan purge wajib ber-scope.
- `frontend/frontend-implementation.md`: tambah `SessionHistoryModal` (pola modal seperti `BacklogPicker`, muat-lebih `IntersectionObserver` seperti `GitGraph`, tombol "Riwayat" di toolbar Terminal).
- `security/security-standard.md`: tambah paragraf transkrip — apa yang tersimpan, di mana, kenapa tak disync, dan bahwa purge manual adalah satu-satunya penghapusan.

- [x] **Step 4: Perbarui SKILL project**

Di `internal/skills/hanoman/SKILL.md`, bagian "Aturan Sesi & Eksekusi", tambahkan butir:

```markdown
- **Riwayat sesi** (SPEC-362/ADR-0079): tmux tetap sumber kebenaran sesi **hidup**, tapi setiap sesi
  kini meninggalkan baris `SessionHistory` (LOCAL-only, tak disync) yang lahir bersama sesinya dan
  ditutup saat `killSession`. `pty.ts` tetap **nol dependensi DB** — ia hanya menembakkan
  `registerSessionHooks({onBirth,onDeath})` dari dua titik cekik `createSession`/`killSession`; jangan
  menambahkan pencatatan di call site (ada 12, dan ADR-0075 dst. akan menambah lagi). Transkrip
  di-`capture-pane` **tanpa `-e`** SEBELUM pane dibunuh (sesudah itu scrollback lenyap), disimpan
  sebagai berkas di `HANOMAN_TRANSCRIPT_DIR` dengan cap 1 MiB **menyimpan ekor**. PK baris = uuid,
  **bukan** `sessionId`: id sesi spec deterministik dan berulang tiap reopen. `GET/DELETE
  /api/terminal/history*` mewarisi capability `sessions` karena berada di bawah prefix `/terminal`.
```

- [x] **Step 5: Verifikasi index konsisten**

Run: `node cli/dist/index.js docs index --check 2>/dev/null || npx hanoman docs index --check`
Expected: laporan tanpa dokumen yatim. Bila CLI belum ter-build, cukup pastikan setiap berkas baru di `internal/docs/**` muncul di `internal/docs/README.md`.

- [x] **Step 6: Commit**

```bash
git add internal/docs internal/skills
git commit -m "docs(spec-362): ADR-0079 + data-model/api-contract/frontend/security + index"
```

---

### Task 13: Verifikasi menyeluruh — suite penuh + smoke API nyata

**Files:**
- Tidak ada berkas produk yang berubah (kecuali perbaikan yang ditemukan smoke)

**Interfaces:**
- Consumes: seluruh task sebelumnya
- Produces: bukti bahwa endpoint bekerja di server yang benar-benar berjalan

- [x] **Step 1: Jalankan seluruh suite repo**

Run:
```bash
env -u NODE_ENV -u DATABASE_URL DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman362' \
  pnpm test -- --no-file-parallelism
```
Expected: seluruh paket (`shared`, `server`, `src`, `runner`, `cli`, `sdk`) PASS. Perbaiki apa pun yang merah sebelum lanjut.

- [x] **Step 2: Boot server nyata di port terpisah**

Port 8787 dipakai sesi dev lain (kode lama + DB dev) — pakai port & DB sendiri.

```bash
cd server && npm run build
HANOMAN_TRANSCRIPT_DIR=/tmp/hanoman362-transcripts \
DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman362' \
HANOMAN_TMUX_SOCKET=hanoman362 PORT=8799 HANOMAN_UPDATE_FETCH=0 \
  node dist/server.js &
```
Expected: `hanoman api 127.0.0.1:8799`.

- [x] **Step 3: Smoke — auth, sesi shell nyata, tutup, riwayat, transkrip**

```bash
BASE=http://127.0.0.1:8799
curl -s -X POST $BASE/api/auth/setup -H 'content-type: application/json' \
  -d '{"email":"smoke@362.local","password":"password1"}' -D /tmp/h362.headers -o /dev/null
COOKIE=$(grep -i '^set-cookie:' /tmp/h362.headers | head -1 | sed 's/^[Ss]et-[Cc]ookie: //' | cut -d';' -f1)

# project + binding ke checkout ini supaya shell punya repoDir
curl -s -X POST $BASE/api/projects -H "cookie: $COOKIE" -H 'content-type: application/json' \
  -d '{"name":"smoke362","kind":"existing","repoDir":"'"$PWD"'","desc":"smoke"}'

# riwayat masih kosong
curl -s "$BASE/api/terminal/history" -H "cookie: $COOKIE"

# lahirkan sesi shell nyata, tulis penanda ke pane, lalu tutup
SID=$(curl -s -X POST $BASE/api/terminal/sessions -H "cookie: $COOKIE" -H 'content-type: application/json' \
  -d '{"project":"smoke362","shell":true}' | sed 's/.*"id":"\([^"]*\)".*/\1/')
tmux -L hanoman362 -f /dev/null send-keys -t "hanoman-$SID" -l 'echo PENANDA-SMOKE-362'
tmux -L hanoman362 -f /dev/null send-keys -t "hanoman-$SID" Enter
sleep 2
curl -s -X DELETE "$BASE/api/terminal/sessions/$SID" -H "cookie: $COOKIE" -o /dev/null -w '%{http_code}\n'

# riwayat + transkrip
curl -s "$BASE/api/terminal/history?limit=5" -H "cookie: $COOKIE"
HID=$(curl -s "$BASE/api/terminal/history?limit=1" -H "cookie: $COOKIE" | sed 's/.*"id":"\([^"]*\)".*/\1/')
curl -s "$BASE/api/terminal/history/$HID" -H "cookie: $COOKIE"
curl -s "$BASE/api/terminal/history/$HID/transcript" -H "cookie: $COOKIE" | head -c 400
```

Expected:
- riwayat awal `{"items":[],"total":0,...}`
- `DELETE` → `204`
- riwayat memuat satu baris `kind: "shell"`, `endedAt` terisi, `transcriptBytes` > 0
- transkrip memuat `PENANDA-SMOKE-362`

- [x] **Step 4: Smoke — paginasi & purge**

```bash
# tiga sesi shell lagi supaya paginasi punya bahan
for i in 1 2 3; do
  S=$(curl -s -X POST $BASE/api/terminal/sessions -H "cookie: $COOKIE" -H 'content-type: application/json' \
    -d '{"project":"smoke362","shell":true}' | sed 's/.*"id":"\([^"]*\)".*/\1/')
  curl -s -X DELETE "$BASE/api/terminal/sessions/$S" -H "cookie: $COOKIE" -o /dev/null
done
curl -s "$BASE/api/terminal/history?page=1&limit=2" -H "cookie: $COOKIE"
curl -s "$BASE/api/terminal/history?page=2&limit=2" -H "cookie: $COOKIE"
curl -s -X DELETE "$BASE/api/terminal/history" -H "cookie: $COOKIE" -w '\n%{http_code}\n'
curl -s -X DELETE "$BASE/api/terminal/history?projectId=smoke362" -H "cookie: $COOKIE"
curl -s "$BASE/api/terminal/history" -H "cookie: $COOKIE"
```

Expected:
- halaman 1 & 2 memuat item berbeda, `total` sama (4) di keduanya
- `DELETE` tanpa parameter → `400`
- `DELETE ?projectId=smoke362` → `{"purged":4}`, riwayat jadi `total: 0`
- berkas transkrip di `/tmp/hanoman362-transcripts` ikut hilang: `ls /tmp/hanoman362-transcripts` kosong

- [x] **Step 5: Bereskan server smoke & tmux socket**

```bash
kill %1
tmux -L hanoman362 kill-server 2>/dev/null || true
rm -rf /tmp/hanoman362-transcripts
```

- [x] **Step 6: Verifikasi diff bersih & commit sisa**

```bash
git status --short
git add -A && git commit -m "chore(spec-362): hasil verifikasi smoke" || echo "tak ada sisa perubahan"
```

---

## Self-Review

**Spec coverage:**

| Bagian spec | Task |
|---|---|
| Model `SessionHistory` (PK uuid, tanpa FK, LOCAL-only) | 2 |
| Baris lahir saat sesi lahir | 4 (emit) + 5 (`beginSession`) |
| Dua titik cekik, `pty.ts` nol dep DB | 4 |
| `sessionKind` tujuh cabang | 1 (katalog) + 4 (derivasi) |
| Transkrip capture sebelum kill, tanpa `-e`, cap 1 MiB simpan ekor | 3 + 4 |
| API + paginasi + filter + purge | 6 |
| Reconcile saat boot | 5 (`reconcileHistory`) + 7 (pemanggilan) |
| UI modal tak menghalangi + muat lebih + baris penutup | 9 + 11 |
| Detail + transkrip read-only + Mulai lagi ber-`restartableKind` | 1 (`restartableKind`) + 10 + 11 |
| Keamanan (gate, LOCAL-only, `<pre>` teks polos) | 6 (prefix `/terminal`) + 10 + 12 (dokumentasi) |
| Docs + ADR-0079 | 12 |
| Smoke nyata | 13 |

**Type consistency:** `SessionBirth`/`SessionDeath` (Task 4) dipakai apa adanya oleh `beginSession`/`finishSession` (Task 5). `SessionHistoryView` (Task 6) dipakai service (Task 5), klien (Task 8), dan UI (Task 9/10) dengan nama field identik. `restartableKind` (Task 1) dipakai Task 10; `SESSION_KIND_LABEL` dipakai Task 9 & 10. `paths.sessionHistory(qs)` menerima string query siap pakai — `qs()` di klien menghasilkan `"?a=b"`.

**Placeholder scan:** tak ada TBD/TODO; setiap step yang mengubah kode memuat kodenya.
