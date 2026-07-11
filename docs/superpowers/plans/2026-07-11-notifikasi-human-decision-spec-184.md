# Notifikasi Human Decision (SPEC-184) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Menotifikasi (sound berbeda + toast + entri lonceng) ketika sebuah sesi Claude berhenti menunggu keputusan manusia, dengan setting nada tersendiri dan aksi item yang mengarahkan ke terminal/backlog.

**Architecture:** Sinyal berasal dari hook `Notification` Claude yang menandai marker file per-sesi (`.worktrees/.decisions/<id>`), dikosongkan oleh hook `UserPromptSubmit` saat manusia menjawab. Server memindai marker tiap poll `GET /notifications` (reaktif, seperti `recordCompletion`) dan membuat baris `Notification` bertipe `decision`. Frontend mencabang toast/sound per tipe dan menambah tombol aksi.

**Tech Stack:** TypeScript strict · Prisma/Postgres · Fastify · React · Vitest · tmux (node-pty) · Claude Code hooks (`--settings` merge).

## Global Constraints

- **TypeScript strict.** Test untuk tiap logika orkestrasi (queue/worktree/guardrail/trigger).
- **Skema:** jangan ubah tanpa **migration + ADR**. Migration **hand-written** + `prisma migrate deploy` per DB dengan override env eksplisit — JANGAN `migrate dev` (me-reset saat ada drift worktree tetangga).
- **Worktree ini** butuh `pnpm install` + `prisma generate` sebelum test/boot; `@prisma/client` tak resolve tanpa itu.
- **DB test terpisah:** `hanoman_test` perlu `migrate deploy` sendiri; env sesi bisa menunjuk prod → jalankan test dengan `env -u NODE_ENV -u DATABASE_URL`.
- **Test repo:** `vitest run --no-file-parallelism` (server DB sekuensial).
- **Shared worktree:** JANGAN `git stash`, JANGAN `git add -A` — selalu `git add <path eksplisit>`.
- **SoT:** perbarui `internal/docs/**` yang tersentuh **dalam commit yang sama** + link-nya di index.
- **Prosa bahasa Indonesia** (komentar kode ikut gaya sekitarnya); kode & output apa adanya.
- **Nada decision wajib berbeda** dari nada selesai (default `alert` vs `short`).

## File Structure

- `server/prisma/schema.prisma` — model `Notification`: +`type`,+`key`,+`sessionId`; `specId` nullable.
- `server/prisma/migrations/20260711160000_notification_decision/migration.sql` — hand-written.
- `shared/src/entities.ts` — `zNotification` (+type,+sessionId, specId nullable) & `zSetting` (+notifyDecision,+notifyDecisionSound).
- `server/src/services/notifications.ts` — `recordCompletion` (key+sessionId) & `scanDecisions()`.
- `server/src/services/settings.ts` — `DEFAULT_SETTING` (+2 kunci).
- `server/src/services/session-phases.ts` — `decisionFilePath()`.
- `server/src/services/pty.ts` — `CreateOpts.decisionFile`, plumbing tmux option, `liveDecisions()`.
- `server/src/routes/terminal.ts` — teruskan `decisionFile` untuk sesi spec & reverse.
- `server/src/routes/notifications.ts` — panggil `scanDecisions()` di `GET`.
- `runner/src/settings.ts` — `guardSettings(cmd, decisionFile?)`.
- `src/src/notifications/NotificationsContext.tsx` — `toastFor()`, cabang tick, `onOpen` di context.
- `src/src/notifications/NotificationBell.tsx` — ikon per tipe + tombol aksi.
- `src/src/notifications/target.ts` — `notifTarget()` (pure) untuk arah aksi.
- `src/src/screens/SettingsScreen.tsx` — `S_DEFAULTS` + 2 baris kartu sesi.
- `src/src/App.tsx` — handler `openNotification`, state `focusSession`, wiring provider + TerminalScreen.
- `src/src/screens/TerminalScreen.tsx` — prop `focusSession` + efek penempatan.
- `internal/docs/adr/0036-notifikasi-human-decision.md` (+ index `internal/docs/README.md`) & `internal/docs/architecture/data-model.md` — SoT.

> **Catatan nomor ADR:** 0034 sudah dipakai `origin/hanoman/spec-182`. Sebelum menulis, verifikasi ulang nomor bebas lintas branch (memory "ADR/SPEC number collisions"): `for b in $(git branch -a --format='%(refname:short)'|grep -v HEAD); do git ls-tree -r --name-only "$b" -- internal/docs/adr/; done | grep -oE 'adr/[0-9]{4}' | sort -u | tail`. Pakai nomor bebas terkecil ≥ 0035 (0035 diklaim spec-187 → pakai 0036).

---

## Task 1: Skema Notification + migration

**Files:**
- Modify: `server/prisma/schema.prisma` (model `Notification`, ~baris 44-51)
- Create: `server/prisma/migrations/20260711160000_notification_decision/migration.sql`
- Modify (test): `server/test/notifications.test.ts`

**Interfaces:**
- Produces: kolom `Notification.type` (default `"done"`), `key String? @unique`, `sessionId String?`, `specId` nullable.

- [x] **Step 1: Ubah schema.prisma**

Ganti model `Notification`:

```prisma
// SPEC-180/184 · notifikasi. type "done" (backlog selesai) | "decision" (menunggu keputusan
// manusia). Dedup selesai lewat `key` unik ("done:<specId>"); decision di-dedup di sisi scan
// (key null; NULL berulang diizinkan Postgres pada kolom unik). sessionId = target redirect.
model Notification {
  id        String    @id @default(cuid())
  type      String    @default("done")
  key       String?   @unique
  specId    String?
  sessionId String?
  title     String
  projectId String?
  createdAt DateTime  @default(now())
  readAt    DateTime?
}
```

- [x] **Step 2: Tulis migration.sql**

Buat `server/prisma/migrations/20260711160000_notification_decision/migration.sql`:

```sql
-- SPEC-184 · Notification untuk human decision.
ALTER TABLE "Notification" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'done';
ALTER TABLE "Notification" ADD COLUMN "key" TEXT;
ALTER TABLE "Notification" ADD COLUMN "sessionId" TEXT;
ALTER TABLE "Notification" ALTER COLUMN "specId" DROP NOT NULL;
UPDATE "Notification" SET "key" = 'done:' || "specId" WHERE "key" IS NULL AND "specId" IS NOT NULL;
DROP INDEX "Notification_specId_key";
CREATE UNIQUE INDEX "Notification_key_key" ON "Notification"("key");
```

- [x] **Step 3: Terapkan migration ke kedua DB + generate client**

Jalankan (override env agar tak menyentuh prod; tiap DB dapat `migrate deploy` sendiri):

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-184
pnpm install
env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman" \
  pnpm --filter ./server exec prisma migrate deploy
env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman_test" \
  pnpm --filter ./server exec prisma migrate deploy
env -u NODE_ENV pnpm --filter ./server exec prisma generate
```

Expected: kedua `migrate deploy` melaporkan `1 migration ... applied` (atau "already applied" bila sudah). `generate` sukses. (Cek kredensial DB nyata dari `.env`/`docker-compose.yml` bila berbeda; Postgres jalan via Docker.)

- [x] **Step 4: Perbarui notifications.test.ts (dedup pindah dari specId ke key)**

Ganti kedua `describe` teratas di `server/test/notifications.test.ts`:

```ts
describe("Notification model", () => {
  beforeEach(async () => { await resetDb(); });

  it("membuat & membaca satu notifikasi; bentuknya lolos zNotification", async () => {
    await prisma.notification.create({ data: { key: "done:SPEC-1", specId: "SPEC-1", sessionId: "spec_1", title: "judul", projectId: "p1" } });
    const row = await prisma.notification.findFirstOrThrow({ where: { specId: "SPEC-1" } });
    const wire = { ...row, createdAt: row.createdAt.toISOString(), readAt: row.readAt?.toISOString() ?? null };
    expect(zNotification.safeParse(wire).success).toBe(true);
  });

  it("key unik: create kedua dengan key sama melempar P2002", async () => {
    await prisma.notification.create({ data: { key: "done:SPEC-2", specId: "SPEC-2", title: "a", projectId: null } });
    await expect(prisma.notification.create({ data: { key: "done:SPEC-2", specId: "SPEC-2", title: "b", projectId: null } }))
      .rejects.toMatchObject({ code: "P2002" });
  });

  it("dua baris decision (key null) tidak saling tabrakan", async () => {
    await prisma.notification.create({ data: { type: "decision", sessionId: "s1", title: "a", projectId: null } });
    await prisma.notification.create({ data: { type: "decision", sessionId: "s2", title: "b", projectId: null } });
    expect(await prisma.notification.count({ where: { type: "decision" } })).toBe(2);
  });
});
```

- [x] **Step 5: Jalankan test model**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run --no-file-parallelism test/notifications.test.ts
```
Expected: 3 test "Notification model" PASS (recordCompletion di-update Task 3 — abaikan kegagalannya untuk sekarang bila ada).

- [x] **Step 6: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260711160000_notification_decision/migration.sql server/test/notifications.test.ts
git commit -m "feat(notif): skema Notification +type/+key/+sessionId, specId nullable (SPEC-184)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Kontrak shared (zNotification + zSetting)

**Files:**
- Modify: `shared/src/entities.ts`
- Test: `shared/test/entities.test.ts` (buat bila belum ada)

**Interfaces:**
- Produces: tipe `Notification` (+`type: "done"|"decision"`, `specId: string|null`, `sessionId: string|null`), `Setting` (+`notifyDecision: boolean`, `notifyDecisionSound`).

- [x] **Step 1: Tulis failing test**

Buat/også tambah di `shared/test/entities.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { zNotification, zSetting } from "../src/entities";

describe("zNotification (SPEC-184)", () => {
  it("decision: specId null, sessionId terisi, type decision", () => {
    const r = zNotification.safeParse({ id: "1", type: "decision", specId: null, sessionId: "s1",
      title: "x", projectId: "p1", createdAt: "2026-07-11T00:00:00.000Z", readAt: null });
    expect(r.success).toBe(true);
  });
  it("type default done bila tak diberikan", () => {
    const r = zNotification.parse({ id: "1", specId: "SPEC-1", sessionId: null,
      title: "x", projectId: null, createdAt: "2026-07-11T00:00:00.000Z", readAt: null });
    expect(r.type).toBe("done");
  });
});
describe("zSetting (SPEC-184)", () => {
  it("mengisi default notifyDecision + notifyDecisionSound", () => {
    const s = zSetting.parse({ autoDefault: true, autoScaffold: true, notifyFail: true });
    expect(s.notifyDecision).toBe(true);
    expect(s.notifyDecisionSound).toBe("alert");
  });
});
```

- [x] **Step 2: Run → fail**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./shared exec vitest run test/entities.test.ts
```
Expected: FAIL (`notifyDecision`/`sessionId` belum ada).

- [x] **Step 3: Implementasi di entities.ts**

Ekstrak daftar nada jadi konstanta (DRY) tepat sebelum `zSetting`, dan pakai untuk kedua picker:

```ts
// SPEC-180/184 · nada notifikasi (aset .wav di src/public/sounds). "off" = senyap.
const NOTIFY_SOUNDS = ["off", "short", "medium", "long",
  "blip", "pop", "ping", "coin", "alert", "chime", "success", "bell", "marimba", "fanfare"] as const;
```

Di `zSetting`, ganti baris `notifySound` dan tambah 2 kunci decision:

```ts
  notifyDone: z.boolean().default(true),                                   // SPEC-180
  notifySound: z.enum(NOTIFY_SOUNDS).default("short"),                     // SPEC-180
  notifyDecision: z.boolean().default(true),                               // SPEC-184
  notifyDecisionSound: z.enum(NOTIFY_SOUNDS).default("alert"),             // SPEC-184
```

Ganti `zNotification`:

```ts
// SPEC-180/184 · notifikasi. type done|decision; specId null untuk sesi reverse; sessionId
// = target redirect terminal. Tanggal = string ISO (JSON). readAt null = unread.
export const zNotification = z.object({
  id: z.string(),
  type: z.enum(["done", "decision"]).default("done"),
  specId: z.string().nullable(),
  sessionId: z.string().nullable(),
  title: z.string(),
  projectId: z.string().nullable(),
  createdAt: z.string(), readAt: z.string().nullable(),
});
```

- [x] **Step 4: Run → pass + typecheck**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./shared exec vitest run test/entities.test.ts
env -u NODE_ENV pnpm --filter ./shared typecheck
```
Expected: PASS; typecheck clean.

- [x] **Step 5: Commit**

```bash
git add shared/src/entities.ts shared/test/entities.test.ts
git commit -m "feat(shared): kontrak Notification decision + setting nada decision (SPEC-184)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: recordCompletion (dedup via key + sessionId)

**Files:**
- Modify: `server/src/services/notifications.ts`
- Modify (test): `server/test/notifications.test.ts` (describe `recordCompletion`)

**Interfaces:**
- Consumes: model dari Task 1.
- Produces: `recordCompletion(specId, title, projectId)` — kini menyetel `key="done:<specId>"` & `sessionId=<idFor(specId)>`.

- [x] **Step 1: Perbarui test recordCompletion**

Ganti `describe("recordCompletion", …)`:

```ts
describe("recordCompletion", () => {
  beforeEach(async () => { await resetDb(); });

  it("idempoten via key: dua panggilan spec sama → satu baris", async () => {
    await recordCompletion("SPEC-3", "judul", "p1");
    await recordCompletion("SPEC-3", "judul", "p1");
    expect(await prisma.notification.count({ where: { specId: "SPEC-3" } })).toBe(1);
  });

  it("menyimpan sessionId turunan untuk aksi 'Buka'", async () => {
    await recordCompletion("SPEC-4", "judul", "p1");
    const row = await prisma.notification.findFirstOrThrow({ where: { specId: "SPEC-4" } });
    expect(row.sessionId).toBe("spec-4");
    expect(row.type).toBe("done");
  });
});
```

- [x] **Step 2: Run → fail**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run --no-file-parallelism test/notifications.test.ts -t recordCompletion
```
Expected: FAIL (`sessionId` null).

- [x] **Step 3: Implementasi**

Ganti isi `recordCompletion` di `server/src/services/notifications.ts` (biarkan komentar SPEC-180 di atasnya, sesuaikan):

```ts
export async function recordCompletion(specId: string, title: string, projectId: string | null): Promise<void> {
  // sessionId turunan = idFor(specId) (pty.ts): id sesi tmux backlog dapat ditebak dari spec-nya,
  // jadi aksi "Buka" pada notif bisa mengecek apakah sesinya masih hidup.
  const sessionId = specId.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  await prisma.notification.create({
    data: { type: "done", key: `done:${specId}`, specId, sessionId, title, projectId },
  }).catch(() => { /* P2002: sudah ada */ });
}
```

- [x] **Step 4: Run → pass**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run --no-file-parallelism test/notifications.test.ts
```
Expected: seluruh `notifications.test.ts` PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/services/notifications.ts server/test/notifications.test.ts
git commit -m "feat(notif): recordCompletion dedup via key + simpan sessionId (SPEC-184)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: guardSettings menyuntik hook decision

**Files:**
- Modify: `runner/src/settings.ts`
- Create (test): `runner/test/settings.test.ts`

**Interfaces:**
- Produces: `guardSettings(guardCommand: string, decisionFile?: string)` → `{ hooks }`. Dengan `decisionFile`: +`Notification` (grep → `echo waiting >> file`) +`UserPromptSubmit` (`: > file`).

- [x] **Step 1: Tulis failing test**

Buat `runner/test/settings.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { guardSettings } from "../src/settings";

describe("guardSettings", () => {
  it("tanpa decisionFile: hanya PreToolUse (tak berubah)", () => {
    const s = guardSettings("guard-cmd");
    expect(Object.keys(s.hooks)).toEqual(["PreToolUse"]);
  });
  it("dengan decisionFile: tambah Notification + UserPromptSubmit menunjuk berkasnya", () => {
    const s = guardSettings("guard-cmd", "/repo/.worktrees/.decisions/sess1") as any;
    expect(s.hooks.Notification[0].hooks[0].command).toContain("/repo/.worktrees/.decisions/sess1");
    expect(s.hooks.Notification[0].hooks[0].command).toMatch(/grep/);
    expect(s.hooks.UserPromptSubmit[0].hooks[0].command).toContain("/repo/.worktrees/.decisions/sess1");
    expect(s.hooks.PreToolUse[0].hooks[0].command).toBe("guard-cmd");
  });
});
```

- [x] **Step 2: Run → fail**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./runner exec vitest run test/settings.test.ts
```
Expected: FAIL (arity/hook belum ada).

- [x] **Step 3: Implementasi**

Ganti `guardSettings` di `runner/src/settings.ts` (pertahankan blok komentar ADR-0010 di atasnya):

```ts
export const guardSettings = (guardCommand: string, decisionFile?: string) => {
  const hooks: Record<string, unknown[]> = {
    PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: guardCommand }] }],
  };
  // SPEC-184 · sinyal "menunggu keputusan manusia" dari Claude sendiri. Notification idle/izin/
  // agent_needs_input menandai marker; UserPromptSubmit (manusia menjawab) mengosongkannya.
  // Path dikutip-single agar aman terhadap spasi. ponytail: path dengan single-quote tak didukung
  // (bagian variabel hanya <sessionId> = [a-z0-9_-]); naikkan bila repoDir bisa memuat "'".
  if (decisionFile) {
    const f = `'${decisionFile.split("'").join("'\\''")}'`;
    hooks.Notification = [{ hooks: [{ type: "command",
      command: `grep -qiE 'idle|permission|waiting for|needs.?input' && echo waiting >> ${f} || true` }] }];
    hooks.UserPromptSubmit = [{ hooks: [{ type: "command", command: `: > ${f}` }] }];
  }
  return { hooks };
};
```

- [x] **Step 4: Run → pass + typecheck**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./runner exec vitest run test/settings.test.ts
env -u NODE_ENV pnpm --filter ./runner typecheck
```
Expected: PASS; typecheck clean.

- [x] **Step 5: Commit**

```bash
git add runner/src/settings.ts runner/test/settings.test.ts
git commit -m "feat(runner): guardSettings menyuntik hook decision (Notification+UserPromptSubmit) (SPEC-184)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: decisionFilePath + plumbing pty

**Files:**
- Modify: `server/src/services/session-phases.ts` (tambah `decisionFilePath`)
- Modify: `server/src/services/pty.ts` (CreateOpts, Pane, FMT, listPanes, createSession, `liveDecisions`)
- Create/Modify (test): `server/test/session-phases.test.ts` (test `decisionFilePath`; buat bila belum ada)

**Interfaces:**
- Consumes: `guardSettings(cmd, decisionFile?)` (Task 4).
- Produces: `decisionFilePath(repoDir, sessionId): string`; `CreateOpts.decisionFile?`; `liveDecisions(): { id, specId?, projectId, decisionFile }[]`.

- [x] **Step 1: Tulis failing test decisionFilePath**

Tambah/buat `server/test/session-phases.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { decisionFilePath } from "../src/services/session-phases";

describe("decisionFilePath (SPEC-184)", () => {
  it("di .worktrees/.decisions/<id> (di dalam .gitignore)", () => {
    expect(decisionFilePath("/repo", "spec_9")).toBe("/repo/.worktrees/.decisions/spec_9");
  });
});
```

- [x] **Step 2: Run → fail**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run --no-file-parallelism test/session-phases.test.ts
```
Expected: FAIL (`decisionFilePath` belum ada).

- [x] **Step 3: Tambah decisionFilePath**

Di `server/src/services/session-phases.ts`, tepat di bawah `phaseFilePath`:

```ts
// SPEC-184 · marker "menunggu keputusan manusia" per sesi. Sekamar dengan berkas fase, di dalam
// `.worktrees` yang sudah `.gitignore` — tak pernah mendarat di branch mana pun. Kosong = tak
// menunggu; non-kosong (ditulis hook Notification) = butuh keputusan.
export const decisionFilePath = (repoDir: string, sessionId: string): string =>
  `${repoDir}/.worktrees/.decisions/${sessionId}`;
```

- [x] **Step 4: Plumbing pty.ts**

Di `server/src/services/pty.ts`:

(a) `Pane` type (baris ~38) — tambah `decisionFile?`:
```ts
type Pane = SessionInfo & { code: number; phaseFile?: string; decisionFile?: string };
```

(b) `FMT` (baris ~74-77) — tambah field di **akhir**:
```ts
const FMT = [
  "#{session_name}", "#{@hanoman_project}", "#{@hanoman_spec}", "#{@hanoman_flow}",
  "#{@hanoman_phase_file}", "#{@hanoman_cwd}", "#{pane_dead}", "#{pane_dead_status}",
  "#{@hanoman_decision_file}",
].join("\t");
```

(c) `listPanes` destructure (baris ~86-92) — tambah `decisionFile` (field ke-9):
```ts
    const [n, projectId, specId, flow, phaseFile, cwd, dead, code, decisionFile] = line.split("\t");
    if (!n?.startsWith(PREFIX)) return [];
    return [{
      id: n.slice(PREFIX.length), projectId: projectId ?? "", specId: specId || undefined,
      flow: (flow || undefined) as Flow | undefined, phaseFile: phaseFile || undefined,
      cwd: cwd ?? "", exited: dead === "1", code: Number(code) || 0,
      decisionFile: decisionFile || undefined,
    }];
```

(d) `CreateOpts` (baris ~101-104) — tambah `decisionFile?`:
```ts
export type CreateOpts = {
  id?: string; specId?: string; flow?: Flow; prompt?: string; phaseFile?: string;
  decisionFile?: string; model?: string; effort?: string;
};
```

(e) `createSession` — teruskan decisionFile ke settings, buat direktorinya, set opsi tmux.

Ganti baris `--settings` (baris ~124):
```ts
    "--settings", JSON.stringify(guardSettings(guardCommand(), opts.decisionFile)),
```
Setelah blok `if (opts.phaseFile) { … }` (sekitar baris 134) tambah:
```ts
  // SPEC-184 · direktori marker keputusan; hook Notification menulis absolute path di dalamnya.
  if (opts.decisionFile) mkdirSync(dirname(opts.decisionFile), { recursive: true });
```
Setelah `if (opts.phaseFile) tmux(...@hanoman_phase_file...)` (baris ~151) tambah:
```ts
  if (opts.decisionFile) tmux("set-option", "-t", name(id), "@hanoman_decision_file", opts.decisionFile);
```

(f) Tambah export `liveDecisions` (dekat `listSessions`, baris ~97):
```ts
// SPEC-184 · sesi hidup yang punya marker keputusan — masukan scanDecisions().
export const liveDecisions = (): { id: string; specId?: string; projectId: string; decisionFile: string }[] =>
  listPanes()
    .filter((p) => !p.exited && p.decisionFile)
    .map((p) => ({ id: p.id, specId: p.specId, projectId: p.projectId, decisionFile: p.decisionFile! }));
```

- [x] **Step 5: Run → pass + typecheck**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run --no-file-parallelism test/session-phases.test.ts
env -u NODE_ENV pnpm --filter ./server typecheck
```
Expected: PASS; typecheck clean.

- [x] **Step 6: Commit**

```bash
git add server/src/services/session-phases.ts server/src/services/pty.ts server/test/session-phases.test.ts
git commit -m "feat(server): decisionFilePath + marker keputusan di sesi tmux (SPEC-184)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Terminal route memasang decisionFile

**Files:**
- Modify: `server/src/routes/terminal.ts` (import + 2 `createSession`)

**Interfaces:**
- Consumes: `decisionFilePath` (Task 5), `createSession` (Task 5).

> Diverifikasi lewat live smoke (Task 13) — `createSession` menelurkan tmux+claude, tak diunit-test.

- [x] **Step 1: Import decisionFilePath**

Di `server/src/routes/terminal.ts` baris 5, tambah `decisionFilePath`:
```ts
import { phaseFilePath, decisionFilePath, readPhases, stageForRun } from "../services/session-phases";
```

- [x] **Step 2: Sesi spec (createSession ~baris 70)**

Tambah `decisionFile` di opts:
```ts
      const s = createSession(spec.projectId, `${repoDir}/.worktrees/${id}`, {
        specId: spec.id, flow: parsed.data.flow, model, effort,
        phaseFile: phaseFilePath(repoDir, id),
        decisionFile: decisionFilePath(repoDir, id),
        prompt: mkPrompt(parsed.data.flow, {
          id: spec.id, title: spec.title, source: spec.source,
          priority: spec.priority, objective: spec.objective, payload: spec.payload ?? undefined,
        }, `hanoman/${id}`),
      });
```

- [x] **Step 3: Sesi reverse (createSession ~baris 103)**

Tambah `decisionFile`:
```ts
      const s = createSession(project.id, `${project.repoDir}/.worktrees/${id}`, {
        id, flow: "reverse", model, effort,
        phaseFile: phaseFilePath(project.repoDir, id),
        decisionFile: decisionFilePath(project.repoDir, id),
        prompt: startProjectPrompt("reverse", {
          id: project.id, name: project.name, desc: project.desc, stack: project.stack,
        }, "reverse-docs"),
      });
```

- [x] **Step 4: Typecheck + build**

```bash
env -u NODE_ENV pnpm --filter ./server typecheck
```
Expected: clean.

- [x] **Step 5: Commit**

```bash
git add server/src/routes/terminal.ts
git commit -m "feat(server): sesi run & reverse memasang marker keputusan (SPEC-184)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: scanDecisions + wire ke GET /notifications

**Files:**
- Modify: `server/src/services/notifications.ts` (import, state, `scanDecisions`, `__resetAwaiting`)
- Modify: `server/src/routes/notifications.ts` (panggil `scanDecisions` di GET)
- Modify (test): `server/test/notifications.test.ts` (+describe scanDecisions)

**Interfaces:**
- Consumes: `liveDecisions` (Task 5), model (Task 1).
- Produces: `scanDecisions(read?)` — buat notif `decision` untuk marker yang baru terisi; `__resetAwaiting()` (test-only).

- [x] **Step 1: Tulis failing test scanDecisions**

Tambah di `server/test/notifications.test.ts` (impor di atas: `scanDecisions, __resetAwaiting` dari service; `mkdtempSync, writeFileSync, truncateSync` dari `node:fs`; `tmpdir` dari `node:os`; `join` dari `node:path`):

```ts
describe("scanDecisions", () => {
  beforeEach(async () => { await resetDb(); __resetAwaiting(); });

  const marker = (content = "waiting\n") => {
    const f = join(mkdtempSync(join(tmpdir(), "hanoman-dec-")), "sess");
    writeFileSync(f, content);
    return f;
  };

  it("marker terisi → satu notif decision (sessionId+projectId); scan ulang tak menambah", async () => {
    const f = marker();
    const read = () => [{ id: "sess1", specId: undefined, projectId: "p1", decisionFile: f }];
    await scanDecisions(read);
    await scanDecisions(read);
    const rows = await prisma.notification.findMany({ where: { type: "decision" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sessionId).toBe("sess1");
    expect(rows[0]!.projectId).toBe("p1");
  });

  it("dikosongkan (manusia menjawab) lalu terisi lagi → notif kedua", async () => {
    const f = marker();
    const read = () => [{ id: "sess1", specId: undefined, projectId: "p1", decisionFile: f }];
    await scanDecisions(read);
    truncateSync(f, 0); await scanDecisions(read);
    writeFileSync(f, "waiting\n"); await scanDecisions(read);
    expect(await prisma.notification.count({ where: { type: "decision" } })).toBe(2);
  });

  it("marker kosong diabaikan", async () => {
    const f = marker("");
    await scanDecisions(() => [{ id: "x", specId: undefined, projectId: "p1", decisionFile: f }]);
    expect(await prisma.notification.count({ where: { type: "decision" } })).toBe(0);
  });
});
```

- [x] **Step 2: Run → fail**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run --no-file-parallelism test/notifications.test.ts -t scanDecisions
```
Expected: FAIL (import tak ada).

- [x] **Step 3: Implementasi scanDecisions**

Tambah di `server/src/services/notifications.ts` (atas: `import { statSync } from "node:fs";` dan `import { liveDecisions } from "./pty";`):

```ts
type DecisionSession = { id: string; specId?: string; projectId: string; decisionFile: string };

// SPEC-184 · episode per-sesi. Di-rebuild tiap scan dari kondisi marker: sesi mati hilang dari
// liveDecisions() → otomatis ter-prune. Transisi kosong→terisi = satu notif; idle Claude yang
// berulang menambah baris tapi id sudah di set → tak dobel. Restart server: paling banter satu
// notif ulang untuk keputusan yang masih terbuka. ponytail: single-process; pindahkan dedup ke
// kolom DB bila server jadi multi-worker.
let awaiting = new Set<string>();
export function __resetAwaiting(): void { awaiting = new Set(); } // test-only

const nonEmpty = (f: string): boolean => { try { return statSync(f).size > 0; } catch { return false; } };

export async function scanDecisions(read: () => DecisionSession[] = liveDecisions): Promise<void> {
  const next = new Set<string>();
  const fresh: DecisionSession[] = [];
  for (const s of read()) {
    if (!nonEmpty(s.decisionFile)) continue;
    next.add(s.id);
    if (!awaiting.has(s.id)) fresh.push(s);
  }
  awaiting = next;
  for (const s of fresh) {
    const title = s.specId
      ? (await prisma.spec.findUnique({ where: { id: s.specId }, select: { title: true } }))?.title ?? s.specId
      : s.id;
    await prisma.notification.create({
      data: { type: "decision", specId: s.specId ?? null, sessionId: s.id, projectId: s.projectId || null, title },
    });
  }
}
```

- [x] **Step 4: Wire ke route**

Ganti handler `GET /notifications` di `server/src/routes/notifications.ts` (import `scanDecisions`):

```ts
import { scanDecisions } from "../services/notifications";
...
  app.get("/notifications", async () => {
    await scanDecisions();   // SPEC-184 · buat notif decision dari marker sesi sebelum membaca
    const items = await prisma.notification.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
    const unread = await prisma.notification.count({ where: { readAt: null } });
    return { items, unread };
  });
```

- [x] **Step 5: Run → pass (unit + route)**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run --no-file-parallelism test/notifications.test.ts test/notifications.route.test.ts
```
Expected: PASS. (Route test: tanpa tmux `scanDecisions()` no-op → tetap 2 item.)

- [x] **Step 6: Commit**

```bash
git add server/src/services/notifications.ts server/src/routes/notifications.ts server/test/notifications.test.ts
git commit -m "feat(notif): scanDecisions buat notif decision dari marker sesi di GET /notifications (SPEC-184)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Default setting + UI Settings

**Files:**
- Modify: `server/src/services/settings.ts` (`DEFAULT_SETTING`)
- Modify: `src/src/screens/SettingsScreen.tsx` (`S_DEFAULTS` + 2 baris kartu)
- Modify (test): `server/test/settings.test.ts`

**Interfaces:**
- Consumes: `Setting` (Task 2).

- [x] **Step 1: Tulis failing test default**

Tambah di `server/test/settings.test.ts`:
```ts
  it("default memuat notifyDecision + notifyDecisionSound (SPEC-184)", () => {
    expect(DEFAULT_SETTING.notifyDecision).toBe(true);
    expect(DEFAULT_SETTING.notifyDecisionSound).toBe("alert");
  });
```

- [x] **Step 2: Run → fail**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run --no-file-parallelism test/settings.test.ts -t SPEC-184
```
Expected: FAIL.

- [x] **Step 3: DEFAULT_SETTING**

Di `server/src/services/settings.ts`, `DEFAULT_SETTING`:
```ts
export const DEFAULT_SETTING: Setting = {
  ...STEP,
  autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short",
  notifyDecision: true, notifyDecisionSound: "alert",
};
```

- [x] **Step 4: Run → pass**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run --no-file-parallelism test/settings.test.ts
```
Expected: PASS (termasuk `getSetting()` toEqual DEFAULT_SETTING tetap konsisten).

- [x] **Step 5: UI — S_DEFAULTS + baris kartu**

Di `src/src/screens/SettingsScreen.tsx` `S_DEFAULTS` (baris ~32-36) tambah 2 kunci:
```ts
const S_DEFAULTS: Setting = {
  model: "claude-opus-4-8", effort: "xhigh",
  autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short",
  notifyDecision: true, notifyDecisionSound: "alert",
};
```

Di kartu "Sesi & notifikasi", tepat setelah `SettingRow` "Sound notifikasi" dan sebelum "Notifikasi saat sesi gagal", sisipkan:
```tsx
        <SettingRow title="Notifikasi butuh keputusan"
          desc="Toast + sound saat sesi Claude berhenti menunggu keputusanmu. Nada sengaja beda dari selesai.">
          <Switch checked={s.notifyDecision} onChange={sw("notifyDecision", "Notifikasi keputusan")} />
        </SettingRow>
        <SettingRow title="Sound keputusan" desc="Nada saat sebuah sesi menunggu keputusan.">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Select size="sm" value={s.notifyDecisionSound} options={S_SOUNDS} style={{ width: 160 }}
              onChange={(e) => save({ notifyDecisionSound: e.target.value as NotifySound }, "Sound keputusan → " + e.target.value)} />
            <Button size="sm" variant="ghost" leftIcon="volume-2" disabled={s.notifyDecisionSound === "off"}
              onClick={() => playNotifySound(s.notifyDecisionSound as NotifySound)}>Preview</Button>
          </div>
        </SettingRow>
```

- [x] **Step 6: Typecheck web**

```bash
env -u NODE_ENV pnpm --filter ./src typecheck
```
Expected: clean.

- [x] **Step 7: Commit**

```bash
git add server/src/services/settings.ts server/test/settings.test.ts src/src/screens/SettingsScreen.tsx
git commit -m "feat(settings): toggle + picker nada notifikasi keputusan (SPEC-184)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: NotificationsContext — cabang toast/sound + onOpen

**Files:**
- Modify: `src/src/notifications/NotificationsContext.tsx`
- Modify (test): `src/test/notifications-context.test.tsx`

**Interfaces:**
- Consumes: `Notification`, `Setting` (Task 2).
- Produces: `toastFor(n, prefs)`; `Ctx.onOpen?`; prop `onOpen?` di `NotificationsProvider`.

- [x] **Step 1: Tulis failing test toastFor**

Tambah di `src/test/notifications-context.test.tsx`:
```ts
import { toastFor } from "../src/notifications/NotificationsContext";

const prefs = { notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert" } as const;
const mk = (over: any) => ({ id: "1", specId: null, sessionId: "s", title: "x", projectId: "p", createdAt: "", readAt: null, ...over });

describe("toastFor (SPEC-184)", () => {
  it("done → tone ok + notifySound", () => {
    const t = toastFor(mk({ type: "done", specId: "SPEC-1", title: "judul" }), prefs);
    expect(t.tone).toBe("ok"); expect(t.sound).toBe("short"); expect(t.enabled).toBe(true);
  });
  it("decision → tone warn + notifyDecisionSound", () => {
    const t = toastFor(mk({ type: "decision", specId: "SPEC-1" }), prefs);
    expect(t.tone).toBe("warn"); expect(t.sound).toBe("alert");
  });
  it("toggle decision mati → enabled false", () => {
    const t = toastFor(mk({ type: "decision" }), { ...prefs, notifyDecision: false });
    expect(t.enabled).toBe(false);
  });
});
```

- [x] **Step 2: Run → fail**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/notifications-context.test.tsx
```
Expected: FAIL (`toastFor` tak ada).

- [x] **Step 3: Implementasi**

Di `src/src/notifications/NotificationsContext.tsx`:

(a) Tambah tipe + `toastFor` (setelah `newSince`):
```ts
export type NotifyPrefs = Pick<Setting, "notifyDone" | "notifySound" | "notifyDecision" | "notifyDecisionSound">;
export type ToastPlan = { msg: string; tone: "ok" | "warn"; icon: string; sound: NotifySound; enabled: boolean };

// SPEC-184 · satu tempat memutuskan bunyi/tampilan toast per tipe notifikasi.
export function toastFor(n: Notification, p: NotifyPrefs): ToastPlan {
  if (n.type === "decision")
    return { msg: `${n.specId ?? n.sessionId} · butuh keputusan`, tone: "warn", icon: "git-merge",
             sound: p.notifyDecisionSound as NotifySound, enabled: p.notifyDecision };
  return { msg: `${n.specId} · "${n.title}" selesai`, tone: "ok", icon: "check-circle-2",
           sound: p.notifySound as NotifySound, enabled: p.notifyDone };
}
```

(b) `Ctx` + context default — tambah `onOpen`:
```ts
type Ctx = { items: Notification[]; unread: number; markAllRead: () => void; clear: () => void; onOpen?: (n: Notification) => void };
export const NotificationsContext = React.createContext<Ctx>({ items: [], unread: 0, markAllRead: () => { }, clear: () => { } });
```

(c) Ganti dua ref (`soundRef`,`enabledRef`) dengan satu `prefs` ref:
```ts
  const prefs = React.useRef<NotifyPrefs>({ notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert" });
```

(d) Provider signature — tambah prop `onOpen`:
```ts
export function NotificationsProvider({ showToast, onOpen, children }: { showToast: ShowToast; onOpen?: (n: Notification) => void; children: React.ReactNode }) {
```

(e) Di `tick`, ganti pembacaan settings & blok toast:
```ts
    if (s) prefs.current = { notifyDone: s.notifyDone, notifySound: s.notifySound, notifyDecision: s.notifyDecision, notifyDecisionSound: s.notifyDecisionSound };
```
```ts
    const latest = fresh[0]; // items terbaru dulu (server orderBy desc)
    if (latest) {
      const t = toastFor(latest, prefs.current);
      if (t.enabled) { showToast(t.msg, t.tone, t.icon); playNotifySound(t.sound); }
    }
```

(f) Provider value — sertakan `onOpen`:
```ts
    <NotificationsContext.Provider value={{ items, unread, markAllRead, clear, onOpen }}>
```

- [x] **Step 4: Run → pass + typecheck**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/notifications-context.test.tsx
env -u NODE_ENV pnpm --filter ./src typecheck
```
Expected: PASS; typecheck clean.

- [x] **Step 5: Commit**

```bash
git add src/src/notifications/NotificationsContext.tsx src/test/notifications-context.test.tsx
git commit -m "feat(notif-ui): cabang toast/sound per tipe + onOpen di context (SPEC-184)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: NotificationBell — ikon per tipe + tombol aksi

**Files:**
- Modify: `src/src/notifications/NotificationBell.tsx`
- Modify (test): `src/test/notification-bell.test.tsx`

**Interfaces:**
- Consumes: `Ctx.onOpen` (Task 9).

- [x] **Step 1: Tulis failing test aksi**

Ganti `src/test/notification-bell.test.tsx` dengan (tambah `vi`):
```ts
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NotificationBell } from "../src/notifications/NotificationBell";
import { NotificationsContext } from "../src/notifications/NotificationsContext";

function Harness({ items, onOpen }: { items: any[]; onOpen?: (n: any) => void }) {
  const ctx = { items, unread: items.filter((n) => !n.readAt).length, markAllRead: () => {}, clear: () => {}, onOpen };
  return <NotificationsContext.Provider value={ctx}><NotificationBell /></NotificationsContext.Provider>;
}
const now = () => new Date().toISOString();

describe("NotificationBell", () => {
  it("menampilkan badge unread", () => {
    render(<Harness items={[{ id: "1", type: "done", specId: "SPEC-180", sessionId: "s", title: "x", projectId: null, createdAt: now(), readAt: null }]} />);
    expect(screen.getByText("1")).toBeInTheDocument();
  });
  it("done: tombol Buka memanggil onOpen dengan item", () => {
    const n = { id: "1", type: "done", specId: "SPEC-180", sessionId: "spec-180", title: "Selesai", projectId: "p", createdAt: now(), readAt: null };
    const onOpen = vi.fn();
    render(<Harness items={[n]} onOpen={onOpen} />);
    fireEvent.click(screen.getByLabelText("Notifikasi"));
    fireEvent.click(screen.getByText("Buka"));
    expect(onOpen).toHaveBeenCalledWith(n);
  });
  it("decision: tombol Buka terminal memanggil onOpen", () => {
    const n = { id: "2", type: "decision", specId: "SPEC-9", sessionId: "spec_9", title: "x", projectId: "p", createdAt: now(), readAt: null };
    const onOpen = vi.fn();
    render(<Harness items={[n]} onOpen={onOpen} />);
    fireEvent.click(screen.getByLabelText("Notifikasi"));
    fireEvent.click(screen.getByText("Buka terminal"));
    expect(onOpen).toHaveBeenCalledWith(n);
  });
});
```

- [x] **Step 2: Run → fail**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/notification-bell.test.tsx
```
Expected: FAIL (tombol belum ada).

- [x] **Step 3: Implementasi**

Di `src/src/notifications/NotificationBell.tsx`: ambil `onOpen` dari context dan render per tipe. Ganti baris `const { items, unread, markAllRead, clear } = useNotifications();`:
```ts
  const { items, unread, markAllRead, clear, onOpen } = useNotifications();
```
Ganti blok `items.map((n) => ( … ))` (baris ~70-85) dengan:
```tsx
          ) : items.map((n) => {
            const decision = n.type === "decision";
            return (
            <div key={n.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: "var(--radius-sm)" }}>
              <Icon name={decision ? "git-merge" : "check-circle-2"} size={16}
                color={decision ? "var(--amber-600)" : "var(--leaf-500)"} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: "var(--text-strong)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {(n.specId ?? n.sessionId)} · {n.title}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-subtle)" }}>
                  {decision ? "butuh keputusan" : "selesai"} · {timeAgo(n.createdAt)}
                </div>
              </div>
              {onOpen && (
                <button onClick={() => { onOpen(n); setOpen(false); }} style={{
                  flex: "0 0 auto", border: "none", background: "transparent", cursor: "pointer",
                  color: decision ? "var(--amber-600)" : "var(--text-muted)", fontSize: 12, fontFamily: "var(--font-ui)", whiteSpace: "nowrap" }}>
                  {decision ? "Buka terminal" : "Buka"}
                </button>
              )}
              {!n.readAt && <span style={{ flex: "0 0 auto", width: 7, height: 7, borderRadius: "50%", background: "var(--accent)" }} />}
            </div>
            );
          })}
```

- [x] **Step 4: Run → pass + typecheck**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/notification-bell.test.tsx
env -u NODE_ENV pnpm --filter ./src typecheck
```
Expected: PASS; typecheck clean.

- [x] **Step 5: Commit**

```bash
git add src/src/notifications/NotificationBell.tsx src/test/notification-bell.test.tsx
git commit -m "feat(notif-ui): ikon per tipe + tombol aksi Buka/Buka terminal di lonceng (SPEC-184)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: App wiring + arah aksi + fokus terminal

**Files:**
- Create: `src/src/notifications/target.ts` (`notifTarget`, pure)
- Create (test): `src/test/notif-target.test.ts`
- Modify: `src/src/App.tsx` (import, state `focusSession`, handler, props)
- Modify: `src/src/screens/TerminalScreen.tsx` (prop `focusSession` + efek)

**Interfaces:**
- Consumes: `Notification` (Task 2), `TerminalSession`, `Ctx.onOpen` (Task 9), `W.placeFirstEmptyInActive`.
- Produces: `notifTarget(n, sessions): { section, projectFilter?, focus? }`.

- [x] **Step 1: Tulis failing test notifTarget**

Buat `src/test/notif-target.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { notifTarget } from "../src/notifications/target";

const n = (over: any) => ({ id: "1", specId: null, sessionId: "s1", title: "x", projectId: "p1", createdAt: "", readAt: null, ...over });

describe("notifTarget (SPEC-184)", () => {
  it("decision → terminal, fokus sesi", () => {
    expect(notifTarget(n({ type: "decision" }), [])).toEqual({ section: "terminal", projectFilter: "p1", focus: "s1" });
  });
  it("done sesi hidup → terminal", () => {
    const sessions = [{ id: "s1", projectId: "p1", cwd: "", exited: false }] as any;
    expect(notifTarget(n({ type: "done" }), sessions).section).toBe("terminal");
  });
  it("done sesi mati/absen → backlog", () => {
    expect(notifTarget(n({ type: "done" }), []).section).toBe("backlog");
  });
});
```

- [x] **Step 2: Run → fail**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/notif-target.test.ts
```
Expected: FAIL (modul tak ada).

- [x] **Step 3: Buat target.ts**

`src/src/notifications/target.ts`:
```ts
import type { Notification } from "@hanoman/shared";
import type { TerminalSession } from "../api/client";

// SPEC-184 · ke mana aksi notifikasi mengarahkan. decision → terminal (fokus sesi yang menunggu).
// done → terminal bila sesinya masih hidup, kalau tidak Backlog item-nya.
export function notifTarget(n: Notification, sessions: TerminalSession[]): { section: string; projectFilter?: string; focus?: string } {
  const live = n.sessionId ? sessions.find((s) => s.id === n.sessionId && !s.exited) : undefined;
  if (n.type === "decision" || live)
    return { section: "terminal", projectFilter: n.projectId ?? undefined, focus: n.sessionId ?? undefined };
  return { section: "backlog", projectFilter: n.projectId ?? undefined };
}
```

- [x] **Step 4: Run → pass**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/notif-target.test.ts
```
Expected: PASS.

- [x] **Step 5: Wire App.tsx**

(a) Import — tambah `Notification` ke import shared di baris 6 (`import { Shell, … }` tetap; tambahkan baris impor tipe):
```ts
import { notifTarget } from "./notifications/target";
import type { Notification } from "@hanoman/shared";
```

(b) State — dekat `projectFilter` (baris ~275):
```ts
  const [focusSession, setFocusSession] = React.useState<string | null>(null);
```

(c) Handler — setelah definisi `openReview`/handler lain (mis. baris ~331):
```ts
  // SPEC-184 · klik aksi notifikasi. sessions = daftar ter-poll (liveness cek done).
  const openNotification = React.useCallback((nt: Notification) => {
    const t = notifTarget(nt, sessions);
    if (t.projectFilter) setProjectFilter(t.projectFilter);
    if (t.focus) setFocusSession(t.focus);
    setSection(t.section);
  }, [sessions]);
```

(d) Provider — teruskan `onOpen` (baris ~581):
```tsx
    <NotificationsProvider showToast={showToast} onOpen={openNotification}>
```

(e) TerminalScreen render — teruskan `focusSession` (baris ~530):
```tsx
          : <TerminalScreen projects={projectsView} backlog={backlog} focusSession={focusSession}
              onOpenReview={(specId) => { setReviewSpecId(specId); setSection("review"); }}
              titleOf={(id) => backlog.find((s) => s.id === id)?.title}
              onIntegrate={integrateSpec} specOf={(id) => backlog.find((s) => s.id === id)} />)}
```

- [x] **Step 6: Wire TerminalScreen.tsx**

(a) Prop di destructure + tipe (baris ~11-17):
```ts
export function TerminalScreen({ projects, backlog = [], focusSession, onOpenReview, titleOf, onIntegrate, specOf }: {
  projects: { id: string; name: string }[]; backlog?: Spec[]; focusSession?: string | null;
  onOpenReview?: (specId: string) => void;
  titleOf?: (specId: string) => string | undefined;
  onIntegrate?: (spec: Spec, op: "merge" | "rebase", target: string) => void;
  specOf?: (specId: string) => Spec | undefined;
}) {
```

(b) Efek fokus — setelah efek `W.save(ws)` (sekitar baris 40):
```ts
  // SPEC-184 · notifikasi mengarahkan ke sesi tertentu → tempatkan ke grid aktif begitu sesi itu
  // muncul di daftar hidup. Re-klik id yang sama saat sudah tampil = no-op (nilai tak berubah).
  React.useEffect(() => {
    if (!focusSession || !loaded) return;
    if (!sessions.some((s) => s.id === focusSession && !s.exited)) return;
    setWs((w) => W.placeFirstEmptyInActive(w, focusSession));
  }, [focusSession, loaded, sessions]);
```

- [x] **Step 7: Typecheck + full web test**

```bash
env -u NODE_ENV pnpm --filter ./src typecheck
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run
```
Expected: clean; semua test web PASS.

- [x] **Step 8: Commit**

```bash
git add src/src/notifications/target.ts src/test/notif-target.test.ts src/src/App.tsx src/src/screens/TerminalScreen.tsx
git commit -m "feat(app): aksi notifikasi mengarahkan ke terminal/backlog + fokus sesi (SPEC-184)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: ADR + SoT docs

**Files:**
- Create: `internal/docs/adr/0036-notifikasi-human-decision.md` (verifikasi nomor dulu — lihat catatan di File Structure)
- Modify: `internal/docs/README.md` (index ADR — sisipkan di puncak daftar)
- Modify: `internal/docs/architecture/data-model.md` (bagian `## Notification`)

- [x] **Step 1: Tulis ADR**

Buat `internal/docs/adr/0036-notifikasi-human-decision.md`:
```markdown
# ADR-0036 — Notifikasi human decision dari hook Claude

**Status:** aktif (SPEC-184)

## Konteks

Sesi Claude yang berhenti menunggu keputusan manusia (brainstorm interview, resolusi konflik,
reverse-docs) tak menghasilkan sinyal apa pun — harus dicek satu-satu. Pill `awaiting`
("Menunggu keputusan") ada di design-system tapi tak pernah terhubung ke deteksi. Mekanisme
lama `.hanoman-ask.json` (ADR-0022) sudah superseded ADR-0024: pertanyaan kini hidup di
terminal interaktif, bukan berkas ask headless.

## Keputusan

**Satu, deteksi lewat hook `Notification` Claude, bukan scraping TUI.** `guardSettings`
(sudah meng-inject hook, merge dengan milik user — ADR-0010) menambah hook `Notification`
yang menandai marker `.worktrees/.decisions/<sessionId>` untuk tipe idle/permission/needs-input,
dan hook `UserPromptSubmit` yang mengosongkannya saat manusia menjawab. Marker ada di dalam
`.worktrees` yang sudah `.gitignore`.

**Dua, notifikasi dibuat reaktif di poll, bukan interval baru.** `scanDecisions()` dipanggil
di `GET /notifications` (poll 10s), membaca marker tiap sesi hidup, dan membuat baris
`Notification` bertipe `decision` pada transisi kosong→terisi. Dedup episode via `Set`
in-memory yang di-rebuild dari kondisi marker (sesi mati otomatis ter-prune). Persis pola
`recordCompletion` yang reaktif.

**Tiga, skema Notification diperluas.** `+type ("done"|"decision")`, `+key String? @unique`
(dedup selesai pindah dari `specId @unique` ke `key`; decision key null), `+sessionId`
(target redirect), `specId` jadi nullable (sesi reverse tak punya spec).

**Empat, aksi item.** decision → buka Terminal + fokus sesi. done → Terminal bila sesinya
masih hidup, kalau tidak Backlog item-nya. Nada decision default `alert`, beda dari selesai
(`short`), diatur di Settings (`notifyDecision` + `notifyDecisionSound`).

## Konsekuensi

- Latensi ~60s: notifikasi idle Claude muncul sekitar semenit setelah agen benar-benar bertanya.
- Restart server: paling banter satu notif ulang untuk keputusan yang masih terbuka (Set hilang).
- Dedup single-process; jika server jadi multi-worker, pindahkan `awaiting` ke kolom DB.
- Marker tak pernah mendarat di branch (di `.worktrees`); `git add -A` agen tak melihatnya.

## Alternatif yang ditolak

- **Heuristik idle pane server** (sesi diam >N detik = menunggu): tak bisa membedakan "menunggu
  keputusan" dari "tool jalan senyap"; rapuh seperti sentinel yang ditolak ADR-0020/0022.
- **Filter notification_type lebih halus dari grep**: tak sepadan; grep substring cukup dan
  bebas dependency.
```

- [x] **Step 2: Update index README**

Di `internal/docs/README.md`, sisipkan di **puncak** daftar ADR (di atas baris 0034/0033):
```markdown
- [0035 — Notifikasi human decision dari hook Claude](adr/0036-notifikasi-human-decision.md)
```
(Konfirmasi baris tetangga dengan `grep -n '0033-notifikasi' internal/docs/README.md`; sisipkan tepat di atasnya bila 0034 belum ada di branch ini.)

- [x] **Step 3: Update data-model.md**

Ganti bagian `## Notification` di `internal/docs/architecture/data-model.md`:
```markdown
## Notification (SPEC-180/184, [ADR-0033](../adr/0033-notifikasi-backlog-selesai.md), [ADR-0036](../adr/0036-notifikasi-human-decision.md))
Dua tipe: `done` (backlog masuk `done`, dibuat di `advanceStage()` & write-through `GET /specs`)
dan `decision` (sesi Claude menunggu keputusan manusia, dibuat `scanDecisions()` di `GET /notifications`).
- `id` (cuid), `type` (`done|decision`, default `done`).
- `key` **@unique** nullable — dedup selesai `"done:<specId>"` (insert kedua kena P2002, diabaikan);
  `null` untuk decision (di-dedup di sisi scan via `Set` episode; NULL berulang diizinkan Postgres).
- `specId` (nullable — sesi reverse tak punya spec), `sessionId` (target redirect terminal),
  `title` (snapshot), `projectId` (opsional), `createdAt`.
- `readAt` (nullable) — `null` = belum dibaca. Read-state **global** (bukan per-user).
- Rute: `GET /notifications` (memicu `scanDecisions()`, lalu `{ items ≤50 terbaru dulu, unread }`),
  `POST /notifications/read` (tandai semua), `DELETE /notifications` (clear).
```

- [x] **Step 4: Verifikasi coverage SoT (tanpa boot server)**

```bash
env -u NODE_ENV pnpm --filter ./shared exec node --experimental-strip-types shared/src/coverage.ts 2>/dev/null || true
```
(Jika skrip coverage berbeda, lewati — cukup pastikan link ADR baru ada di index: `grep -c '0036-notifikasi-human-decision' internal/docs/README.md` → `1`.)

- [x] **Step 5: Commit**

```bash
git add internal/docs/adr/0036-notifikasi-human-decision.md internal/docs/README.md internal/docs/architecture/data-model.md
git commit -m "docs(sot): ADR-0036 notifikasi human decision + data-model Notification (SPEC-184)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 13: Verifikasi menyeluruh + live smoke

**Files:** tidak ada perubahan kode — hanya verifikasi.

- [x] **Step 1: Seluruh suite hijau**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-184
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./shared exec vitest run
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./runner exec vitest run
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run --no-file-parallelism
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run
env -u NODE_ENV pnpm -r typecheck
```
Expected: semua PASS; typecheck clean. (Bila ada flake `queue-durability`, jalankan ulang suite server penuh — lihat memory.)

- [x] **Step 2: Live smoke HTTP (DB throwaway migrated)**

Boot server terhadap DB khusus (jangan hanoman_test — sibling test bisa men-truncate mid-smoke; memory "live-smoke dedicated DB"), lalu curl endpoint tersentuh:

```bash
# DB smoke sekali pakai
env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman_smoke184" \
  pnpm --filter ./server exec prisma migrate deploy || \
  (docker exec hanoman-db-1 psql -U hanoman -d postgres -c 'CREATE DATABASE hanoman_smoke184' && \
   env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman_smoke184" pnpm --filter ./server exec prisma migrate deploy)

env -u NODE_ENV pnpm --filter ./server build
env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman_smoke184" HOST=127.0.0.1 PORT=8799 \
  HANOMAN_REQUIRE_AUTH=false node server/dist/server.js &   # cek nama flag auth-off di server.ts bila beda
sleep 2
echo "== GET /notifications (scanDecisions harus aman tanpa sesi) =="
curl -sS localhost:8799/api/notifications
echo; echo "== PUT /settings (kunci decision) =="
curl -sS -X PUT localhost:8799/api/settings -H 'content-type: application/json' \
  -d '{"model":"claude-opus-4-8","effort":"xhigh","autoDefault":true,"autoScaffold":true,"notifyFail":true,"notifyDone":true,"notifySound":"short","notifyDecision":true,"notifyDecisionSound":"alert"}'
echo; echo "== GET /settings =="
curl -sS localhost:8799/api/settings
kill %1
```
Expected: `GET /notifications` → `{"items":[],"unread":0}` (tak 500 — `scanDecisions` no-op tanpa sesi). `PUT`/`GET /settings` → JSON memuat `"notifyDecision":true,"notifyDecisionSound":"alert"`. (Cara mematikan auth & kredensial DB dikonfirmasi dari `server/src/server.ts` + `.env`.)

> **Deteksi decision end-to-end** (hook → marker → notif) sudah tercakup unit test `scanDecisions` + `guardSettings` (reader palsu + berkas temp). Menjalankan sesi Claude nyata di smoke butuh tmux+claude+worktree dan di luar cakupan smoke HTTP ini — nyatakan apa adanya di ringkasan.

- [x] **Step 3: Bereskan** DB smoke bila mau: `docker exec hanoman-db-1 psql -U hanoman -d postgres -c 'DROP DATABASE hanoman_smoke184'`.

- [x] **Step 4: Centang plan** — pastikan semua `- [x]` di file ini jadi `- [x]`, lalu commit centang terakhir + `Execute done` ke `$HANOMAN_PHASE_FILE`.

## Self-Review (diisi saat menulis plan)

- **Spec coverage:** deteksi (Task 4-7) · sound+setting (Task 2,8) · toast+list (Task 9,10) · aksi decision→terminal & success→terminal/backlog (Task 11) · migration+ADR (Task 1,12). Semua bagian spec tertutup.
- **Placeholder scan:** tak ada TBD/TODO; tiap step berisi kode nyata + perintah + expected.
- **Type consistency:** `decisionFile`, `liveDecisions()`, `scanDecisions(read?)`, `toastFor(n,prefs)`, `notifTarget(n,sessions)`, `NotifyPrefs`, `key`/`sessionId`/`type` konsisten lintas task.
