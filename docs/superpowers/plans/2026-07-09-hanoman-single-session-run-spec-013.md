# SPEC-013 — Satu backlog, satu sesi Claude, satu worktree · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Satu backlog dijalankan oleh satu proses `claude` di satu worktree, fase menjadi giliran di dalam satu sesi, dan sesi itu bisa dibuka interaktif dari layar Terminal.

**Architecture:** `runner` berhenti men-spawn satu proses per fase. `claude-cli.ts` membuka satu `ClaudeSession` per run (`claude -p --input-format stream-json`, hidup selama stdin terbuka). `turns.ts` memasangkan N pesan pengguna dengan N `result` berdasarkan urutan. `phase.ts` mengirim `/model` + `/effort` hanya saat step berubah, lalu prompt fase. `run.ts` membuka sesi sekali dan menutup stdin di akhir — inilah yang membunuh deadlock Execute. `sessionId` disimpan di kolom baru `Run.sessionId`, dan `pty.ts` memakainya untuk `claude --resume` di worktree run.

**Tech Stack:** TypeScript strict (ESM), Node ≥20, vitest, Prisma + Postgres, Fastify, node-pty, BullMQ + Redis, React + Vite.

## Global Constraints

- TypeScript strict. Tidak ada `any` baru di kode produksi.
- **Jangan ubah skema tanpa migration + ADR.** Task 6 membawa keduanya.
- **Update `internal/docs` yang tersentuh dalam commit yang sama.** Stop hook (`hanoman hook stop`) akan memblok kalau docs basi.
- **Jangan bypass Stop hook / guardrail Source of Truth.**
- **Jangan jalankan run di working tree utama** — selalu worktree terpisah.
- **Checkout ini dipakai sesi lain.** Jangan pernah `git stash`. Jangan pernah `git add -A` — selalu `git add <path eksplisit>`.
- Setiap task selesai: centang checklist di file ini (`- [ ]` → `- [x]`), lalu **test API-nya secara nyata di local** untuk task yang menyentuh HTTP (Task 7–9), bukan hanya unit test.
- Perintah test: `pnpm --filter @hanoman/runner test`, `pnpm --filter ./server test`, root `pnpm test`.
- **Kegagalan yang sudah ada sebelumnya:** `server/test/queue-durability` gagal setiap run. Bukan disebabkan plan ini. Jangan dikejar, jangan diperbaiki di sini.
- Kontrak berikut diverifikasi terhadap `claude` v2.1.205 dan **harus tetap dikunci oleh test**: satu proses `-p` melayani banyak giliran dengan satu `session_id`; proses hidup saat idle selama stdin terbuka; `/model` dan `/effort` menggeser sesi; giliran slash-command memancarkan `result` sintetis; `--resume` cwd-scoped.

---

## File Structure

| File | Tanggung jawab |
|---|---|
| `runner/src/types.ts` | modify — `ClaudeSession`, `OpenSession`, `RunEvent` varian `session` |
| `runner/src/claude-cli.ts` | modify — spawn sekali, `send`/`next`/`close` |
| `runner/src/turns.ts` | **create** — `takeTurn`: satu pesan → satu `result` |
| `runner/src/steer-queue.ts` | modify — buffer dengan `drain()`, bukan AsyncIterable |
| `runner/src/phase.ts` | modify — `/model` + `/effort` on-change, lalu prompt fase |
| `runner/src/run.ts` | modify — satu sesi per run, kuras steer antar giliran |
| `server/prisma/schema.prisma` | modify — `Run.sessionId String?` |
| `server/src/runner/deps.ts` | modify — `openSession` menggantikan `queryFn` |
| `server/src/runner/events-io.ts` | modify — persist `sessionId` |
| `server/src/services/pty.ts` | modify — guard `--settings` + mode resume |
| `server/src/routes/terminal.ts` | modify — terima `{ run }` |
| `shared/src/dto.ts` | modify — `zTerminalSession` jadi union |
| `src/src/api/client.ts` | modify — `createTerminalForRun` |
| `src/src/screens/TerminalScreen.tsx` | modify — label tab sesi run |
| `internal/docs/adr/0014-one-session-per-backlog.md` | **create** |
| `cli/src/commands/_run.ts` | modify — `runOne` tanpa `ctl` tetap jalan |

---

### Task 1: Kunci bug deadlock Execute dengan test yang merah

Fase Execute di worker tidak pernah selesai. `run.ts:42` memberi Execute prompt `ctl.steer.stream()`; `pump()` menutup stdin hanya setelah iterable itu habis; `claude` keluar hanya saat stdin EOF; loop keluaran berakhir hanya saat stdout EOF; dan `SteerQueue.close()` baru dipanggil di `worker.ts` **sesudah** `runOne` selesai. `cli/src/commands/_run.ts:31` memanggil `runOne` tanpa `ctl`, jadi jalur CLI selamat dan bug ini tak pernah terlihat.

Test ini merah sekarang (timeout) dan hijau setelah Task 5. Fake-nya memakai bentuk `queryFn` yang masih berlaku hari ini; Task 5 menulis ulang fake-nya ke `openSession` sambil **mempertahankan assertion yang sama**.

**Files:**
- Test: `runner/test/run.test.ts` (modify — tambah satu `it` di dalam `describe("runOne")`)

**Interfaces:**
- Consumes: `runOne`, `SteerQueue` (bentuk sekarang)
- Produces: assertion "runOne dengan steer menyelesaikan fase Execute" yang dipakai ulang di Task 5

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `runner/test/run.test.ts`, di dalam `describe("runOne", ...)`. Tambahkan juga import `SteerQueue`:

```ts
import { SteerQueue } from "../src/steer-queue";
```

```ts
  // REGRESI: worker.ts SELALU mengoper steer; cli/_run.ts tidak. Fake ini setia pada
  // semantik claude-cli.ts: pump() dipanggil `void` (tak di-await) sehingga result giliran
  // pertama terbit selagi pump masih menunggu pesan berikutnya, dan generator berakhir hanya
  // setelah prompt iterable habis — yang di produksi berarti stdin EOF.
  it("finishes the Execute phase when a steer queue is wired in", async () => {
    const faithful = (args: any) => (async function* () {
      if (typeof args.prompt === "string") { yield okResult; return; }
      const drained = (async () => { for await (const _ of args.prompt) { /* drain */ } })();
      yield okResult;
      await drained;
    })();
    const d = fakeDeps({ queryFn: faithful as any });
    const events: any[] = [];
    const r = await runOne(input(), d, (e) => events.push(e), { steer: new SteerQueue() });
    expect(r.status).toBe("done");
    const done = events.filter((e) => e.kind === "phase" && e.state === "done").map((e) => e.name);
    expect(done).toEqual(["Brainstorm", "Objective", "Spec", "Plan", "Execute"]);
  }, 5000);
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @hanoman/runner test -- -t "finishes the Execute phase"`
Expected: FAIL — `Test timed out in 5000ms`. Empat fase pertama masuk, Execute menggantung.

- [ ] **Step 3: Commit test merah**

Jangan perbaiki di sini. Bug ini diperbaiki oleh Task 5; test ini adalah alat ukurnya.

```bash
git add runner/test/run.test.ts
git commit -m "test(runner): kunci deadlock fase Execute saat steer terpasang (merah)"
```

---

### Task 2: `ClaudeSession` — satu spawn, banyak giliran

`makeClaudeCliQuery` mengembalikan generator sekali-pakai yang mati saat stdin ditutup. Ganti dengan sesi yang bisa dikirimi pesan berkali-kali.

**Files:**
- Modify: `runner/src/types.ts`
- Modify: `runner/src/claude-cli.ts`
- Modify: `runner/src/index.ts`
- Test: `runner/test/claude-cli.test.ts`

**Interfaces:**
- Produces:
  - `interface ClaudeSession { send(text: string): void; next(): Promise<SdkMessage | null>; close(): void; kill(): void }`
  - `type OpenSession = (o: CliOptions) => ClaudeSession`
  - `function makeClaudeCliSession(cfg: { bin?: string; guardCommand: string }): OpenSession`
  - `buildArgs` dan `guardSettings` tidak berubah.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `runner/test/claude-cli.test.ts`:

```ts
import { makeClaudeCliSession } from "../src/claude-cli";

describe("makeClaudeCliSession", () => {
  // /bin/cat menolak flag claude, jadi pakai node sebagai `claude` palsu: ia membaca
  // baris stream-json dari stdin dan membalas satu `result` per baris — persis kontrak
  // "N pesan → N result" yang diverifikasi terhadap binary asli.
  const FAKE = ["-e", `
    let n = 0;
    require("readline").createInterface({ input: process.stdin })
      .on("line", (l) => { if (!l.trim()) return; n++;
        process.stdout.write(JSON.stringify({ type: "result", subtype: "success",
          session_id: "sess-1", total_cost_usd: 0.01 * n,
          usage: { input_tokens: 1, output_tokens: n } }) + "\\n"); })
      .on("close", () => process.exit(0));
  `];

  it("keeps one process alive across many turns and pairs each send with one result", async () => {
    const open = makeClaudeCliSession({ bin: process.execPath, guardCommand: "true" });
    // buildArgs' flags are ignored by the fake; only stdin/stdout matter here.
    const s = open({ cwd: process.cwd(), model: "m", argvOverride: FAKE } as any);
    s.send("turn one");
    const a = await s.next();
    expect(a).toMatchObject({ type: "result", session_id: "sess-1", usage: { output_tokens: 1 } });
    s.send("turn two");
    const b = await s.next();
    expect(b).toMatchObject({ type: "result", usage: { output_tokens: 2 } });
    s.close();
    expect(await s.next()).toBeNull();
  }, 15000);

  it("fails loud when the binary is missing instead of killing the worker", async () => {
    const open = makeClaudeCliSession({ bin: "claude-does-not-exist-xyz", guardCommand: "true" });
    const s = open({ cwd: process.cwd(), model: "m" });
    await expect(s.next()).rejects.toThrow(/gagal menjalankan/);
  }, 15000);
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @hanoman/runner test -- -t "makeClaudeCliSession"`
Expected: FAIL — `makeClaudeCliSession is not a function`.

- [ ] **Step 3: Tambahkan tipe di `runner/src/types.ts`**

Ganti `QueryArgs`/`QueryFn` dengan sesi. Hapus keduanya — tidak ada lagi pemakainya setelah Task 5.

```ts
export interface ClaudeSession {
  /** Tulis satu pesan pengguna. Tiap pesan menghasilkan tepat satu `result`. */
  send(text: string): void;
  /** Pesan berikutnya dari stdout, atau null saat stream berakhir. Satu pembaca saja. */
  next(): Promise<SdkMessage | null>;
  /** Tutup stdin — inilah yang membuat `claude` keluar. */
  close(): void;
  kill(): void;
}
export type OpenSession = (o: CliOptions) => ClaudeSession;
```

Dan tambahkan varian event baru ke `RunEvent`:

```ts
  | { kind: "session"; sessionId: string }
```

Pindahkan `CliOptions` dari `claude-cli.ts` ke `types.ts` agar `OpenSession` tidak melingkar, lalu re-export dari `claude-cli.ts`. Tambahkan satu field opsional yang hanya dipakai test:

```ts
export type CliOptions = {
  cwd: string; model: string; effort?: string;
  abortController?: AbortController; disallowedTools?: string[];
  settingSources?: string[];
  /** Test-only: ganti argv sepenuhnya agar binary palsu tak perlu memahami flag claude. */
  argvOverride?: string[];
};
```

- [ ] **Step 4: Tulis `makeClaudeCliSession` di `runner/src/claude-cli.ts`**

Hapus `makeClaudeCliQuery` dan `pump`. `buildArgs` dan `guardSettings` tetap apa adanya.

```ts
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { ClaudeSession, CliOptions, OpenSession, SdkMessage } from "./types";
export type { CliOptions };

export function makeClaudeCliSession(cfg: { bin?: string; guardCommand: string }): OpenSession {
  return (o: CliOptions): ClaudeSession => {
    const bin = cfg.bin ?? process.env.HANOMAN_CLAUDE_BIN ?? "claude";
    const argv = o.argvOverride ?? buildArgs(o, cfg.guardCommand);
    const child = spawn(bin, argv, { cwd: o.cwd, stdio: ["pipe", "pipe", "pipe"] });

    let stderr = "";
    child.stderr.on("data", (c) => { stderr += c; });
    // Dibunuh di tengah tulis; kode keluar di bawah yang jadi sinyal sebenarnya.
    child.stdin.on("error", () => {});
    // ChildProcess 'error' (ENOENT: claude tak ada di PATH) tanpa listener adalah exception
    // TAK TERTANGKAP — ia akan membunuh worker, bukan menggagalkan run.
    let spawnError: Error | undefined;
    child.on("error", (e) => { spawnError = e; });
    const closed = new Promise<number | null>((res) => child.on("close", res));

    const onAbort = () => child.kill("SIGTERM");
    o.abortController?.signal.addEventListener("abort", onAbort);

    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })[Symbol.asyncIterator]();

    return {
      send(text: string) {
        child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n");
      },
      async next(): Promise<SdkMessage | null> {
        for (;;) {
          const { value, done } = await lines.next();
          if (done) {
            const code = await closed;
            o.abortController?.signal.removeEventListener("abort", onAbort);
            if (spawnError) throw new Error(`gagal menjalankan "${bin}" (cek PATH / HANOMAN_CLAUDE_BIN): ${spawnError.message}`);
            if (code !== 0 && !o.abortController?.signal.aborted) {
              throw new Error(`claude exited ${code}: ${(stderr || "no stderr").slice(0, 500)}`);
            }
            return null;
          }
          const line = String(value).trim();
          if (!line) continue;
          // ponytail: non-JSON di stdout adalah warning nyasar; kegagalan sesungguhnya
          // tiba di stderr dan dilaporkan lewat kode keluar di atas.
          try { return JSON.parse(line) as SdkMessage; } catch { continue; }
        }
      },
      close() { child.stdin.end(); },
      kill() { child.kill("SIGTERM"); },
    };
  };
}
```

Di `runner/src/index.ts`, `export * from "./claude-cli"` sudah mencakupnya. Tambahkan `export * from "./turns"` sekarang juga (file dibuat di Task 3) — **jangan**, tambahkan di Task 3 supaya build tidak pecah di sini.

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `pnpm --filter @hanoman/runner test -- -t "makeClaudeCliSession"`
Expected: PASS (2 test).

Test lama `describe("buildArgs")` harus tetap hijau. Test `live-smoke.test.ts` masih memakai `makeClaudeCliQuery` dan `runPhase` lama — ia hanya jalan saat `HANOMAN_LIVE=1`, tapi **typecheck akan merah**. Perbaiki di Task 5, atau sementara komentari blok `describe.runIf(LIVE)` dengan catatan `// SPEC-013 Task 5`.

- [ ] **Step 6: Commit**

```bash
git add runner/src/types.ts runner/src/claude-cli.ts runner/test/claude-cli.test.ts
git commit -m "feat(runner): ClaudeSession — satu spawn melayani banyak giliran"
```

---

### Task 3: `turns.ts` — satu pesan, satu `result`

Batas giliran dihitung, tidak ditebak. Orkestrator mengirim N pesan dan mengkonsumsi N `result` berpasangan berdasarkan urutan.

**Files:**
- Create: `runner/src/turns.ts`
- Create: `runner/test/turns.test.ts`
- Modify: `runner/src/index.ts`

**Interfaces:**
- Consumes: `ClaudeSession`, `SdkMessage` (Task 2)
- Produces: `type TurnResult = { sessionId?: string; subtype: string; tokensIn: number; tokensOut: number; costUsd: number }`
- Produces: `function takeTurn(s: ClaudeSession, text: string, onMessage?: (m: SdkMessage) => void): Promise<TurnResult>`

- [ ] **Step 1: Tulis test yang gagal**

Create `runner/test/turns.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { takeTurn } from "../src/turns";
import type { ClaudeSession, SdkMessage } from "../src/types";

const result = (over: Partial<Extract<SdkMessage, { type: "result" }>> = {}): SdkMessage => ({
  type: "result", subtype: "success", session_id: "s1", total_cost_usd: 0.42,
  usage: { input_tokens: 100, output_tokens: 20 }, ...over,
});

// Sesi palsu: tiap `send` mengantre satu skrip pesan yang berakhir dengan `result`.
function fakeSession(scripts: SdkMessage[][]): ClaudeSession & { sent: string[] } {
  const sent: string[] = [];
  let queue: SdkMessage[] = [];
  return {
    sent,
    send(t) { sent.push(t); queue = queue.concat(scripts.shift() ?? [result()]); },
    async next() { return queue.shift() ?? null; },
    close() {}, kill() {},
  };
}

describe("takeTurn", () => {
  it("sends one message and consumes exactly one result", async () => {
    const s = fakeSession([[result()]]);
    const r = await takeTurn(s, "do it");
    expect(s.sent).toEqual(["do it"]);
    expect(r).toEqual({ sessionId: "s1", subtype: "success", tokensIn: 100, tokensOut: 20, costUsd: 0.42 });
  });

  it("streams assistant messages to onMessage but stops at the result", async () => {
    const s = fakeSession([[
      { type: "assistant", message: { content: [{ type: "text", text: "hello" }] } },
      result(),
      result({ subtype: "leftover" }),
    ]]);
    const seen: SdkMessage[] = [];
    const r = await takeTurn(s, "x", (m) => seen.push(m));
    expect(seen).toHaveLength(2);
    expect(r.subtype).toBe("success");
    // The leftover belongs to the NEXT turn; takeTurn must not swallow it.
    expect(await s.next()).toMatchObject({ subtype: "leftover" });
  });

  it("pairs N sends with N results in order", async () => {
    const s = fakeSession([[result({ total_cost_usd: 0.01 })], [result({ total_cost_usd: 0.05 })]]);
    expect((await takeTurn(s, "a")).costUsd).toBe(0.01);
    expect((await takeTurn(s, "b")).costUsd).toBe(0.05);
    expect(s.sent).toEqual(["a", "b"]);
  });

  it("throws when the session ends before a result arrives", async () => {
    const s: ClaudeSession = { send: vi.fn(), next: async () => null, close: vi.fn(), kill: vi.fn() };
    await expect(takeTurn(s, "x")).rejects.toThrow(/berakhir sebelum `result`/);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @hanoman/runner test -- turns`
Expected: FAIL — `Failed to resolve import "../src/turns"`.

- [ ] **Step 3: Implementasi `runner/src/turns.ts`**

```ts
import type { ClaudeSession, SdkMessage } from "./types";

export type TurnResult = {
  sessionId?: string; subtype: string; tokensIn: number; tokensOut: number; costUsd: number;
};

// Satu pesan pengguna menghasilkan tepat satu `result` — diverifikasi terhadap claude
// v2.1.205. Karena itu batas giliran dihitung, bukan ditebak dari matinya proses. Inilah
// yang dulu bikin runPhase menyamakan "fase selesai" dengan "stream berakhir".
export async function takeTurn(
  s: ClaudeSession, text: string, onMessage?: (m: SdkMessage) => void,
): Promise<TurnResult> {
  s.send(text);
  let sessionId: string | undefined;
  for (;;) {
    const m = await s.next();
    if (m === null) throw new Error("sesi claude berakhir sebelum `result` tiba");
    onMessage?.(m);
    if (m.type === "assistant" || m.type === "system") sessionId = m.session_id ?? sessionId;
    else if (m.type === "result") {
      return {
        sessionId: m.session_id ?? sessionId, subtype: m.subtype,
        tokensIn: m.usage.input_tokens, tokensOut: m.usage.output_tokens, costUsd: m.total_cost_usd,
      };
    }
  }
}
```

- [ ] **Step 4: Ekspor dari `runner/src/index.ts`**

```ts
export * from "./turns";
```

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `pnpm --filter @hanoman/runner test -- turns`
Expected: PASS (4 test).

- [ ] **Step 6: Commit**

```bash
git add runner/src/turns.ts runner/test/turns.test.ts runner/src/index.ts
git commit -m "feat(runner): takeTurn — N pesan berpasangan dengan N result"
```

---

### Task 4: `phase.ts` — `/model` dan `/effort` hanya saat step berubah

Giliran slash-command memancarkan `result` sintetis (`assistant` dengan `model: <synthetic>`). Ia harus dibuang, bukan dibaca sebagai hasil fase — kalau kelewat, fase terbaca selesai sebelum bekerja.

**Files:**
- Modify: `runner/src/phase.ts`
- Modify: `runner/test/phase.test.ts` (tulis ulang penuh)

**Interfaces:**
- Consumes: `takeTurn`, `TurnResult` (Task 3); `ClaudeSession` (Task 2)
- Produces:
  - `type StepState = { model: string; effort?: string }` — mutable, dibawa `run.ts` lintas fase
  - `function runPhase(a: { session: ClaudeSession; step: { model: string; effort?: string }; current: StepState; prompt: string; onEvent: (e: RunEvent) => void }): Promise<TurnResult>`
  - `const DENY: string[]` (tetap diekspor untuk `run.ts`)

- [ ] **Step 1: Tulis test yang gagal**

Ganti seluruh isi `runner/test/phase.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { runPhase } from "../src/phase";
import type { ClaudeSession, SdkMessage } from "../src/types";

const result = (over: Partial<Extract<SdkMessage, { type: "result" }>> = {}): SdkMessage => ({
  type: "result", subtype: "success", session_id: "s1", total_cost_usd: 0.42,
  usage: { input_tokens: 100, output_tokens: 20 }, ...over,
});
const synthetic = (): SdkMessage => result({ subtype: "success", total_cost_usd: 0.001,
  usage: { input_tokens: 1, output_tokens: 1 } });

function fakeSession(scripts: SdkMessage[][]): ClaudeSession & { sent: string[] } {
  const sent: string[] = [];
  let queue: SdkMessage[] = [];
  return {
    sent,
    send(t) { sent.push(t); queue = queue.concat(scripts.shift() ?? [result()]); },
    async next() { return queue.shift() ?? null; },
    close() {}, kill() {},
  };
}

describe("runPhase", () => {
  it("sends no slash command when the step matches the current session state", async () => {
    const s = fakeSession([[result()]]);
    const cur = { model: "m1", effort: "low" };
    await runPhase({ session: s, step: { model: "m1", effort: "low" }, current: cur,
      prompt: "do it", onEvent: () => {} });
    expect(s.sent).toEqual(["do it"]);
  });

  it("switches model and effort, discarding one synthetic result each", async () => {
    const s = fakeSession([[synthetic()], [synthetic()], [result({ total_cost_usd: 9 })]]);
    const cur = { model: "m1", effort: "low" };
    const r = await runPhase({ session: s, step: { model: "m2", effort: "xhigh" }, current: cur,
      prompt: "do it", onEvent: () => {} });
    expect(s.sent).toEqual(["/model m2", "/effort xhigh", "do it"]);
    // Hasil fase adalah result prompt, BUKAN result sintetis slash-command.
    expect(r.costUsd).toBe(9);
    // current di-mutate agar fase berikutnya tak mengirim ulang slash command yang sama.
    expect(cur).toEqual({ model: "m2", effort: "xhigh" });
  });

  it("switches only the model when effort is unchanged", async () => {
    const s = fakeSession([[synthetic()], [result()]]);
    await runPhase({ session: s, step: { model: "m2", effort: "low" }, current: { model: "m1", effort: "low" },
      prompt: "p", onEvent: () => {} });
    expect(s.sent).toEqual(["/model m2", "p"]);
  });

  it("emits log events for assistant text and tool_use of the phase turn only", async () => {
    const s = fakeSession([[synthetic()], [
      { type: "assistant", message: { content: [{ type: "text", text: "hello" }, { type: "tool_use", name: "Bash" }] } },
      result(),
    ]]);
    const events: any[] = [];
    await runPhase({ session: s, step: { model: "m2" }, current: { model: "m1" },
      prompt: "p", onEvent: (e) => events.push(e) });
    const logs = events.filter((e) => e.kind === "log").map((e) => e.line.s);
    expect(logs).toEqual(["hello", "tool Bash"]);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @hanoman/runner test -- phase`
Expected: FAIL — `runPhase` masih menerima `queryFn`; TypeScript/vitest error pada properti `session`.

- [ ] **Step 3: Tulis ulang `runner/src/phase.ts`**

```ts
import { takeTurn, type TurnResult } from "./turns";
import type { ClaudeSession, RunEvent } from "./types";

export const DENY = ["Bash(rm -rf *)", "Bash(git push * main*)", "Bash(git push origin main*)"];

/** State sesi yang berjalan. Di-mutate lintas fase agar slash command tak dikirim ulang. */
export type StepState = { model: string; effort?: string };

export interface RunPhaseArgs {
  session: ClaudeSession;
  step: { model: string; effort?: string };
  current: StepState;
  prompt: string;
  onEvent: (e: RunEvent) => void;
}

// Sebuah giliran slash-command memancarkan `result` sintetisnya sendiri (diverifikasi
// terhadap claude v2.1.205: assistant `model: <synthetic>`). Ia dibuang. Membacanya sebagai
// hasil fase akan menandai fase selesai sebelum ia bekerja.
export async function runPhase(a: RunPhaseArgs): Promise<TurnResult> {
  if (a.step.model !== a.current.model) {
    await takeTurn(a.session, `/model ${a.step.model}`);
    a.current.model = a.step.model;
  }
  if (a.step.effort && a.step.effort !== a.current.effort) {
    await takeTurn(a.session, `/effort ${a.step.effort}`);
    a.current.effort = a.step.effort;
  }
  const r = await takeTurn(a.session, a.prompt, (m) => {
    if (m.type !== "assistant") return;
    for (const b of m.message.content) {
      if (b.type === "text" && b.text) a.onEvent({ kind: "log", line: { t: "›", s: b.text } });
      else if (b.type === "tool_use" && b.name) a.onEvent({ kind: "log", line: { t: "$", s: `tool ${b.name}` } });
    }
  });
  a.onEvent({ kind: "cost", tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd: r.costUsd });
  return r;
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm --filter @hanoman/runner test -- phase`
Expected: PASS (4 test).

- [ ] **Step 5: Commit**

```bash
git add runner/src/phase.ts runner/test/phase.test.ts
git commit -m "feat(runner): fase jadi giliran; /model + /effort hanya saat step berubah"
```

---

### Task 5: `run.ts` — satu sesi per run; deadlock Execute mati

`runOne` membuka sesi sekali, mengurutkan fase sebagai giliran, menguras pesan steer di antara giliran, dan menutup stdin di akhir. `total_cost_usd` kumulatif per sesi — dan sekarang seluruh run adalah satu sesi, jadi cost **di-assign**, token **dijumlah**.

**Files:**
- Modify: `runner/src/run.ts`
- Modify: `runner/src/steer-queue.ts`
- Modify: `runner/test/steer-queue.test.ts`
- Modify: `runner/test/run.test.ts`
- Modify: `runner/test/live-smoke.test.ts`
- Modify: `server/src/worker.ts`
- Modify: `cli/src/commands/_run.ts` (tidak berubah isinya — verifikasi saja tetap kompilasi)

**Interfaces:**
- Consumes: `runPhase`, `StepState`, `DENY` (Task 4); `takeTurn` (Task 3); `OpenSession` (Task 2)
- Produces:
  - `interface RunDeps { openSession: OpenSession; git: GitOps; verify: (cwd: string) => VerifyResult }`
  - `class SteerQueue { push(text: string): void; drain(): string[] }`
  - `RunEvent` varian `{ kind: "session"; sessionId: string }` dipancarkan sekali per run

- [ ] **Step 1: Sederhanakan `runner/src/steer-queue.ts`**

Tidak ada lagi AsyncIterable — pesan steer jadi giliran biasa di antara fase.

```ts
// Pesan steer menjadi giliran tambahan yang dikuras di antara fase. Ia tidak lagi
// menjadi prompt sebuah fase: itulah yang dulu menahan stdin tetap terbuka selamanya.
export class SteerQueue {
  private buf: string[] = [];
  push(text: string) { this.buf.push(text); }
  drain(): string[] { const out = this.buf; this.buf = []; return out; }
}
```

- [ ] **Step 2: Ganti `runner/test/steer-queue.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { SteerQueue } from "../src/steer-queue";
describe("SteerQueue", () => {
  it("drains pushed messages in order and empties itself", () => {
    const q = new SteerQueue();
    q.push("a"); q.push("b");
    expect(q.drain()).toEqual(["a", "b"]);
    expect(q.drain()).toEqual([]);
  });
});
```

- [ ] **Step 3: Tulis ulang `runner/src/run.ts`**

```ts
import type { OpenSession, RunEvent, RunInput, RunResult, GitOps } from "./types";
import { PIPELINES, phasePrompt, stepFor } from "./phases";
import { DENY, runPhase, type StepState } from "./phase";
import { takeTurn } from "./turns";
import { SteerQueue } from "./steer-queue";

export interface RunDeps {
  openSession: OpenSession; git: GitOps;
  verify: (cwd: string) => { blocked: boolean; reason?: string; error?: string };
}

export async function runOne(
  input: RunInput, deps: RunDeps, onEvent: (e: RunEvent) => void,
  ctl: { abortController?: AbortController; steer?: SteerQueue } = {},
): Promise<RunResult> {
  const abortController = ctl.abortController ?? new AbortController();
  const worktree = `${input.repoDir}/.worktrees/${input.runId.toLowerCase()}`;
  let costUsd = 0, tokensIn = 0, tokensOut = 0, sessionId: string | undefined;
  const phases = PIPELINES[input.flow].filter((p) => !input.only || p === input.only);
  const stopped = (): RunResult => ({ status: "stopped", costUsd, tokensIn, tokensOut });
  const failed = (): RunResult => ({ status: "failed", costUsd, tokensIn, tokensOut });

  onEvent({ kind: "status", status: "running" });
  deps.git.addWorktree(input.repoDir, worktree, input.branchFrom);

  // Satu proses `claude` untuk seluruh backlog. Model/effort fase pertama masuk lewat argv;
  // fase berikutnya menggesernya lewat `/model` + `/effort` di dalam sesi yang sama.
  const first = input.steps[stepFor(phases[0]!)];
  const current: StepState = { model: first.model, effort: first.effort };
  const session = deps.openSession({
    cwd: worktree, model: first.model, effort: first.effort,
    abortController, disallowedTools: DENY, settingSources: ["user", "project", "local"],
  });

  try {
    for (const phase of phases) {
      if (abortController.signal.aborted) { onEvent({ kind: "status", status: "stopped" }); return stopped(); }
      onEvent({ kind: "phase", name: phase, state: "active" });

      if (phase === "Execute") {
        const v = deps.verify(worktree);
        if (v.error !== undefined || v.blocked) {
          const why = v.error !== undefined
            ? `guardrail tool error · ${v.error}`
            : `plan diblok · ${v.reason ?? "docs stale (Source of Truth)"}`;
          onEvent({ kind: "log", line: { t: "✗", s: why } });
          onEvent({ kind: "phase", name: phase, state: "failed" });
          onEvent({ kind: "status", status: "failed" });
          return failed();
        }
      }

      const r = await runPhase({ session, step: input.steps[stepFor(phase)], current,
        prompt: phasePrompt(input.flow, phase, input), onEvent });
      // total_cost_usd kumulatif per sesi; usage.*_tokens per giliran (claude v2.1.205).
      costUsd = r.costUsd; tokensIn += r.tokensIn; tokensOut += r.tokensOut;
      if (!sessionId && r.sessionId) { sessionId = r.sessionId; onEvent({ kind: "session", sessionId }); }

      // Setiap subtype error_* (error_during_execution, error_max_turns, …) menggagalkan fase.
      if (r.subtype.startsWith("error")) {
        onEvent({ kind: "log", line: { t: "✗", s: `fase ${phase} gagal · ${r.subtype}` } });
        onEvent({ kind: "phase", name: phase, state: "failed" });
        onEvent({ kind: "status", status: "failed" });
        return failed();
      }
      onEvent({ kind: "phase", name: phase, state: "done" });

      // Pesan steer yang tiba selama fase berjalan menjadi giliran tambahan, dikuras
      // sampai habis sebelum fase berikutnya dimulai.
      for (const msg of ctl.steer?.drain() ?? []) {
        if (abortController.signal.aborted) break;
        const t = await takeTurn(session, msg, (m) => {
          if (m.type !== "assistant") return;
          for (const b of m.message.content) {
            if (b.type === "text" && b.text) onEvent({ kind: "log", line: { t: "›", s: b.text } });
          }
        });
        costUsd = t.costUsd; tokensIn += t.tokensIn; tokensOut += t.tokensOut;
      }
    }
  } finally {
    // Menutup stdin adalah satu-satunya cara `claude` keluar. Tanpa ini prosesnya menggantung.
    session.close();
  }

  if (abortController.signal.aborted) { onEvent({ kind: "status", status: "stopped" }); return stopped(); }
  deps.git.commitAndPush(worktree, `hanoman ${input.flow} ${input.specId ?? ""}`.trim(), input.branchTo, input.remoteUrl);
  deps.git.removeWorktree(input.repoDir, worktree);
  onEvent({ kind: "status", status: "done" });
  return { status: "done", costUsd, tokensIn, tokensOut };
}
```

- [ ] **Step 4: Perbarui `runner/test/run.test.ts`**

Ganti `fakeDeps` ke bentuk sesi. **Assertion Task 1 tidak berubah**; hanya fake-nya.

```ts
import { describe, it, expect, vi } from "vitest";
import { runOne } from "../src/run";
import { SteerQueue } from "../src/steer-queue";
import type { ClaudeSession, RunDeps, RunInput, SdkMessage } from "../src/index";

const steps = Object.fromEntries(["brainstorm", "spec", "plan", "execute", "audit"]
  .map((k) => [k, { model: "claude-opus-4-8", effort: "x-high" }])) as any;
const input = (over: Partial<RunInput> = {}): RunInput => ({ runId: "RUN-1", repoDir: "/repo",
  branchFrom: "main", branchTo: "feat/x", flow: "feature", steps, ...over });
const okResult = (over: Partial<Extract<SdkMessage, { type: "result" }>> = {}): SdkMessage => ({
  type: "result", subtype: "success", session_id: "s", total_cost_usd: 0.1,
  usage: { input_tokens: 10, output_tokens: 5 }, ...over });

// Sesi palsu: satu `result` per `send`, seperti binary aslinya.
function fakeSession(res: () => SdkMessage = okResult): ClaudeSession & { sent: string[]; closed: boolean } {
  const self = { sent: [] as string[], closed: false, queue: [] as SdkMessage[] };
  return Object.assign(self, {
    send(t: string) { self.sent.push(t); self.queue.push(res()); },
    async next() { return self.queue.shift() ?? null; },
    close() { self.closed = true; }, kill() {},
  }) as any;
}
const fakeDeps = (over: Partial<RunDeps> = {}): RunDeps => ({
  openSession: () => fakeSession(),
  git: { addWorktree: vi.fn(), removeWorktree: vi.fn(), commitAndPush: vi.fn(), switchBase: vi.fn() },
  verify: () => ({ blocked: false }), ...over });

describe("runOne", () => {
  it("runs every feature phase and commits on success", async () => {
    const d = fakeDeps(); const events: any[] = [];
    const r = await runOne(input(), d, (e) => events.push(e));
    expect(r.status).toBe("done");
    expect(d.git.addWorktree).toHaveBeenCalled();
    expect(d.git.commitAndPush).toHaveBeenCalled();
    expect(d.git.removeWorktree).toHaveBeenCalled();
    const done = events.filter((e) => e.kind === "phase" && e.state === "done").map((e) => e.name);
    expect(done).toEqual(["Brainstorm", "Objective", "Spec", "Plan", "Execute"]);
  });

  // Inti SPEC-013: satu backlog, satu spawn.
  it("opens exactly one claude session for the whole run", async () => {
    const openSession = vi.fn(() => fakeSession());
    await runOne(input(), fakeDeps({ openSession }), () => {});
    expect(openSession).toHaveBeenCalledTimes(1);
  });

  it("closes stdin when the run ends", async () => {
    const s = fakeSession();
    await runOne(input(), fakeDeps({ openSession: () => s }), () => {});
    expect(s.closed).toBe(true);
  });

  it("emits the session id once so the terminal can resume it", async () => {
    const events: any[] = [];
    await runOne(input(), fakeDeps(), (e) => events.push(e));
    expect(events.filter((e) => e.kind === "session")).toEqual([{ kind: "session", sessionId: "s" }]);
  });

  // REGRESI (Task 1): worker.ts SELALU mengoper steer; dulu ini menggantung selamanya.
  it("finishes the Execute phase when a steer queue is wired in", async () => {
    const d = fakeDeps(); const events: any[] = [];
    const r = await runOne(input(), d, (e) => events.push(e), { steer: new SteerQueue() });
    expect(r.status).toBe("done");
    const done = events.filter((e) => e.kind === "phase" && e.state === "done").map((e) => e.name);
    expect(done).toEqual(["Brainstorm", "Objective", "Spec", "Plan", "Execute"]);
  }, 5000);

  it("drains steer messages as extra turns between phases", async () => {
    const s = fakeSession();
    const steer = new SteerQueue();
    steer.push("belok kiri");
    await runOne(input({ only: "Execute" }), fakeDeps({ openSession: () => s }), () => {}, { steer });
    expect(s.sent).toEqual([expect.stringContaining("fase Execute"), "belok kiri"]);
  });

  it("blocks at execute when docs are stale and does NOT commit", async () => {
    const d = fakeDeps({ verify: () => ({ blocked: true, reason: "docs stale" }) }); const events: any[] = [];
    const r = await runOne(input(), d, (e) => events.push(e));
    expect(r.status).toBe("failed");
    expect(d.git.commitAndPush).not.toHaveBeenCalled();
    expect(events.some((e) => e.kind === "log" && e.line.s.includes("docs stale"))).toBe(true);
  });

  it("fails at execute with a tool-error log when the guardrail crashes", async () => {
    const d = fakeDeps({ verify: () => ({ blocked: true, error: "boom" }) }); const events: any[] = [];
    const r = await runOne(input(), d, (e) => events.push(e));
    expect(r.status).toBe("failed");
    expect(d.git.commitAndPush).not.toHaveBeenCalled();
    expect(events.some((e) => e.kind === "log" && e.line.s === "guardrail tool error · boom")).toBe(true);
    expect(events.some((e) => e.kind === "log" && e.line.s.includes("plan diblok"))).toBe(false);
  });

  it("stops and keeps the worktree when aborted before finishing", async () => {
    const ac = new AbortController();
    const d = fakeDeps({ openSession: () => { ac.abort(); return fakeSession(); } });
    const r = await runOne(input(), d, () => {}, { abortController: ac });
    expect(r.status).toBe("stopped");
    expect(d.git.removeWorktree).not.toHaveBeenCalled();
  });

  it.each(["error_during_execution", "error_max_turns", "error_max_budget_usd"])(
    "fails the run on result subtype %s", async (subtype) => {
      const d = fakeDeps({ openSession: () => fakeSession(() => okResult({ subtype })) });
      const r = await runOne(input(), d, () => {});
      expect(r.status).toBe("failed");
      expect(d.git.commitAndPush).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 5: Perbarui `server/src/worker.ts`**

Hapus `steer.close()` — `SteerQueue` tidak lagi punya method itu, dan `runOne` yang menutup sesi.

```ts
  } finally {
    await pending;
    await sub.quit();
    await pub.quit();
  }
```

- [ ] **Step 6: Perbarui `runner/test/live-smoke.test.ts`**

Kunci kontrak yang diverifikasi terhadap binary asli: satu sesi, dua fase, model berbeda, konteks terbawa.

```ts
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { makeClaudeCliSession } from "../src/claude-cli";
import { takeTurn } from "../src/turns";
// Spends real tokens against the real `claude` binary — off by default.
//   HANOMAN_LIVE=1 pnpm --filter @hanoman/runner test
const LIVE = process.env.HANOMAN_LIVE === "1";
describe.runIf(LIVE)("live smoke", () => {
  it("keeps one session across turns, switches model, and carries context", async () => {
    const guardCommand = `node "${join(process.cwd(), "..", "cli", "dist", "hanoman.js")}" hook pretooluse`;
    const s = makeClaudeCliSession({ guardCommand })({ cwd: process.cwd(), model: "haiku", effort: "low" });
    const a = await takeTurn(s, "Remember the word ZEBRA. Reply with exactly: OK");
    expect(a.subtype).toBe("success");
    expect(a.sessionId).toBeTruthy();
    expect(a.tokensOut).toBeGreaterThan(0);

    await takeTurn(s, "/model sonnet"); // giliran sintetis, dibuang
    let text = "";
    const b = await takeTurn(s, "Which word did I ask you to remember? One word.", (m) => {
      if (m.type === "assistant") for (const c of m.message.content) if (c.type === "text") text += c.text;
    });
    expect(b.sessionId).toBe(a.sessionId);        // satu sesi sepanjang run
    expect(text.toUpperCase()).toContain("ZEBRA"); // konteks terbawa lintas fase
    s.close();
    expect(await s.next()).toBeNull();
  }, 240000);

  it("fails loud when the binary is missing instead of killing the worker", async () => {
    const s = makeClaudeCliSession({ bin: "claude-does-not-exist-xyz", guardCommand: "true" })(
      { cwd: process.cwd(), model: "haiku" });
    await expect(s.next()).rejects.toThrow(/gagal menjalankan/);
  }, 30000);
});
```

- [ ] **Step 7: Jalankan seluruh test runner, pastikan hijau — termasuk test Task 1**

Run: `pnpm --filter @hanoman/runner test`
Expected: PASS semua. Test `"finishes the Execute phase when a steer queue is wired in"` yang merah di Task 1 kini hijau.

Run: `pnpm --filter @hanoman/runner typecheck`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add runner/src/run.ts runner/src/steer-queue.ts runner/test/run.test.ts \
        runner/test/steer-queue.test.ts runner/test/live-smoke.test.ts server/src/worker.ts
git commit -m "fix(runner): satu sesi per run; deadlock fase Execute mati

runOne membuka satu proses claude untuk seluruh backlog dan menutup stdin di
akhir. Fase jadi giliran; pesan steer jadi giliran tambahan yang dikuras di
antara fase, bukan prompt yang menahan stdin terbuka selamanya."
```

---

### Task 6: `Run.sessionId` — kolom, migration, ADR-0014

Dengan satu sesi per run, `sessionId` naik jadi fakta tingkat-run. `CLAUDE.md` mewajibkan migration + ADR.

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/<timestamp>_run_session_id/migration.sql` (dibuat `prisma migrate dev`)
- Modify: `server/src/runner/events-io.ts`
- Modify: `server/src/runner/deps.ts`
- Modify: `server/test/events-io.test.ts`
- Create: `internal/docs/adr/0014-one-session-per-backlog.md`
- Modify: `internal/docs/README.md` (tautkan ADR-0014)

**Interfaces:**
- Consumes: `RunEvent` varian `session` (Task 5)
- Produces: `prodDeps.openSession`; kolom `Run.sessionId String?`

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/events-io.test.ts`:

```ts
describe("persistEvent sessionId (SPEC-013)", () => {
  beforeEach(async () => { await resetDb(); await makeProject(); await makeRun({ id: "RUN-1", projectId: "p1", status: "running" }); });

  it("stores the claude session id so the terminal can resume the run", async () => {
    await persistEvent("RUN-1", { kind: "session", sessionId: "abc-123" });
    const run = await prisma.run.findUniqueOrThrow({ where: { id: "RUN-1" } });
    expect(run.sessionId).toBe("abc-123");
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./server test -- events-io`
Expected: FAIL — `Unknown field 'sessionId'` / properti tidak ada di tipe `Run`.

- [ ] **Step 3: Tambah kolom di `server/prisma/schema.prisma`**

Di `model Run`, tepat setelah `worktree`:

```prisma
  sessionId     String?
```

Nullable: run yang masih mengantre belum punya sesi, dan baris lama tidak punya nilai.

- [ ] **Step 4: Buat migration**

```bash
pnpm --filter ./server migrate -- --name run_session_id
```

Expected: file baru `server/prisma/migrations/<timestamp>_run_session_id/migration.sql` berisi
`ALTER TABLE "Run" ADD COLUMN "sessionId" TEXT;`

- [ ] **Step 5: Persist di `server/src/runner/events-io.ts`**

Tambahkan cabang di `persistEvent`, sebelum baris `if (e.kind === "phase" || e.kind === "status")`:

```ts
  } else if (e.kind === "session") {
    await prisma.run.update({ where: { id: runId }, data: { sessionId: e.sessionId } });
```

- [ ] **Step 6: Tukar `queryFn` → `openSession` di `server/src/runner/deps.ts`**

```ts
import { makeClaudeCliSession, realGit, type RunDeps } from "@hanoman/runner";
// …
export const prodDeps: RunDeps = {
  openSession: makeClaudeCliSession({ guardCommand: guardCommand() }),
  git: realGit, verify: verifyViaCli,
};
```

Lakukan hal yang sama di `cli/src/commands/_deps.ts`:

```ts
  openSession: makeClaudeCliSession({ guardCommand: `node "${process.argv[1]}" hook pretooluse` }),
```

- [ ] **Step 7: Tulis ADR-0014**

Create `internal/docs/adr/0014-one-session-per-backlog.md`:

```markdown
# ADR 0014 — Satu backlog, satu sesi Claude

**Status:** accepted
**Melengkapi:** ADR-0010 (runner spawn `claude` CLI), ADR-0003 (per-step model selection)

## Konteks
`runOne` men-spawn satu proses `claude` per fase. Akibatnya konteks fase Brainstorm hilang bagi
fase Spec kecuali yang sempat ditulis ke file, dan `sessionId` yang sudah dihitung `runPhase`
dibuang begitu saja.

Lebih buruk: fase Execute memakai `SteerQueue.stream()` sebagai prompt. `pump()` menutup stdin
hanya setelah iterable itu habis, `claude` keluar hanya saat stdin EOF, dan `SteerQueue.close()`
baru dipanggil sesudah `runOne` selesai. Ketiganya saling menunggu — fase Execute di worker tidak
pernah selesai. `cli/src/commands/_run.ts` memanggil `runOne` tanpa `ctl`, jadi jalur CLI selamat
dan bug ini lolos dari test.

## Keputusan
Satu backlog dijalankan oleh **satu proses `claude`** di worktree-nya sendiri. Fase menjadi
**giliran** di dalam sesi itu.

Diverifikasi langsung terhadap binary `claude` v2.1.205, bukan disimpulkan dari dokumen:

- Satu proses `-p --input-format stream-json` melayani banyak giliran, mempertahankan satu
  `session_id`, dan membawa konteks antar giliran.
- Proses tetap hidup saat menganggur selama stdin terbuka; ia keluar hanya saat stdin EOF.
- `/model <m>` dan `/effort <l>` menggeser sesi di tengah jalan, jadi **ADR-0003 tetap berlaku**
  tanpa menuntut satu proses per fase.
- Giliran slash-command memancarkan `result` sintetis sendiri, yang harus dibuang.
- `--output-format` bertuliskan "only works with --print", jadi sesi PTY interaktif tidak dapat
  melaporkan `subtype`. Eksekusi fase karena itu **tidak** dipindahkan ke PTY.

Batas giliran **dihitung**: N pesan pengguna berpasangan dengan N `result` menurut urutan
(`runner/src/turns.ts`). Tidak ada lagi penyamaan "fase selesai" dengan "stream proses berakhir".

`sessionId` naik jadi kolom `Run.sessionId`, dipakai layar Terminal untuk `claude --resume`.

## Konsekuensi
- (+) `claude -p` oneshot per fase hilang; satu backlog, satu spawn, satu worktree, satu sesi.
- (+) Konteks terbawa antar fase, seperti sesi terminal harian — tujuan yang sama dengan ADR-0010.
- (+) Deadlock Execute mati, karena batas fase tidak lagi bergantung pada matinya proses.
- (+) `subtype`, token, cost, `steer`, dan ADR-0003 semuanya utuh.
- (−) **Token per giliran tumbuh**: konteks menumpuk lintas fase. Itu harga dari "menyerupai sesi
  harian"; ADR-0012 sudah menetapkan biaya tidak menggerakkan apa pun, dan plafon sesungguhnya
  adalah rate limit.
- (−) Satu proses menahan seluruh run: matinya proses mematikan sisa fase. Jendelanya kini lebih
  panjang daripada saat tiap fase punya prosesnya sendiri.
- (−) Ketergantungan baru pada slash command `/model` dan `/effort` sebagai antarmuka. Keduanya
  tidak dijamin stabil lintas versi `claude`; `runner/test/live-smoke.test.ts` menguncinya
  terhadap binary asli, seperti ADR-0010 mengunci kontrak `stream-json`.
- (−) Pesan steer kini diterapkan di **batas giliran**, bukan di tengah giliran. Sebelumnya ia
  ditulis ke stdin kapan saja — dan itu justru yang menahan stdin terbuka selamanya.
```

Tautkan dari `internal/docs/README.md`, di bawah baris ADR-0013:

```markdown
- [0014 — Satu backlog, satu sesi Claude](adr/0014-one-session-per-backlog.md)
```

- [ ] **Step 8: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./server test -- events-io`
Expected: PASS.

Run: `pnpm -r typecheck`
Expected: exit 0.

- [ ] **Step 9: Commit — kode + migration + ADR bersama**

```bash
git add server/prisma/schema.prisma server/prisma/migrations \
        server/src/runner/events-io.ts server/src/runner/deps.ts cli/src/commands/_deps.ts \
        server/test/events-io.test.ts \
        internal/docs/adr/0014-one-session-per-backlog.md internal/docs/README.md
git commit -m "feat(server): Run.sessionId + ADR-0014 satu sesi per backlog"
```

---

### Task 7: `pty.ts` — pasang guard yang hilang, tambah mode resume

`pty.ts:35` men-spawn `claude --dangerously-skip-permissions` **tanpa `--settings`**. Layar Terminal hari ini berjalan tanpa PreToolUse guard sama sekali. ADR-0010 menyebut hook itu satu-satunya gerbang yang tersisa di bawah flag tersebut. Lubang ini ada sebelum SPEC-013 dan ditutup di sini.

**Files:**
- Modify: `server/src/services/pty.ts`
- Modify: `server/test/pty.test.ts`

**Interfaces:**
- Consumes: `guardSettings` dari `@hanoman/runner`; `guardCommand` dari `../runner/deps`
- Produces: `createSession(projectId: string, cwd: string, opts?: { runId?: string; resume?: string }): Session`
- Produces: `Session`/`SessionInfo` bertambah `runId?: string`

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/pty.test.ts`:

```ts
  it("always registers the PreToolUse guard hook (ADR-0010)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const s = createSession("p1", process.cwd());
    const c = fakeClient();
    attach(s, c);
    await waitFor(() => lastFrame(c)?.t === "exit");
    const argv = allData(c);
    expect(argv).toContain("--settings");
    expect(argv).toContain("hook pretooluse");
  });

  it("resumes a run's own claude session in the run worktree", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const s = createSession("p1", process.cwd(), { runId: "RUN-7", resume: "sess-abc" });
    const c = fakeClient();
    attach(s, c);
    await waitFor(() => lastFrame(c)?.t === "exit");
    expect(allData(c)).toContain("--resume sess-abc");
    expect(allData(c)).toContain("--settings");
    expect(listSessions()[0]).toMatchObject({ runId: "RUN-7" });
  });
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./server test -- pty`
Expected: FAIL — `--settings` tidak ada di argv; `createSession` hanya menerima 2 argumen.

- [ ] **Step 3: Perbarui `server/src/services/pty.ts`**

Tambahkan import dan ganti `spawnPty` + `createSession`:

```ts
import { guardSettings } from "@hanoman/runner";
import { guardCommand } from "../runner/deps";
```

```ts
export type Session = {
  id: string; projectId: string; runId?: string; cwd: string; pty: IPty;
  scrollback: string; exited: boolean; exitCode?: number; clients: Set<Client>;
};
export type SessionInfo = { id: string; projectId: string; runId?: string; cwd: string; exited: boolean };
```

```ts
function spawnPty(cwd: string, resume?: string): IPty {
  // `--dangerously-skip-permissions` melewati prompt izin, bukan sistem hook. Tanpa
  // `--settings` di bawah, sesi ini tidak punya gerbang sama sekali (ADR-0010).
  const args = [
    ...(resume ? ["--resume", resume] : []),
    "--dangerously-skip-permissions",
    "--settings", JSON.stringify(guardSettings(guardCommand())),
  ];
  try {
    return spawn(claudeBin(), args, {
      cwd, name: "xterm-256color", cols: 80, rows: 24,
      env: process.env as Record<string, string>,
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (!msg.includes("posix_spawnp")) throw e;
    throw new Error(
      `${msg} — spawn-helper node-pty kemungkinan kehilangan exec bit. ` +
      `Jalankan: pnpm --filter ./server run postinstall`,
    );
  }
}

export function createSession(
  projectId: string, cwd: string, opts: { runId?: string; resume?: string } = {},
): Session {
  const pty = spawnPty(cwd, opts.resume);
  const s: Session = {
    id: randomUUID().slice(0, 8), projectId, runId: opts.runId, cwd, pty,
    scrollback: "", exited: false, clients: new Set(),
  };
  // … sisanya tidak berubah
}
```

Dan `listSessions`:

```ts
export const listSessions = (): SessionInfo[] =>
  [...sessions.values()].map(({ id, projectId, runId, cwd, exited }) => ({ id, projectId, runId, cwd, exited }));
```

Perbarui juga test lama `"forwards stdin to a live process and keeps it listed"` — `listSessions()` kini mengandung `runId: undefined`. Gunakan `toMatchObject` alih-alih `toEqual`:

```ts
    expect(listSessions()[0]).toMatchObject({ id: s.id, projectId: "p2", cwd: process.cwd(), exited: false });
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./server test -- pty`
Expected: PASS (6 test).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/pty.ts server/test/pty.test.ts
git commit -m "fix(server): PTY tanpa PreToolUse guard; tambah mode --resume sesi run"
```

---

### Task 8: Route + UI — buka sesi run dari layar Terminal

**Files:**
- Modify: `shared/src/dto.ts`
- Modify: `server/src/routes/terminal.ts`
- Create: `server/test/terminal.route.test.ts`
- Modify: `src/src/api/client.ts`
- Modify: `src/src/screens/TerminalScreen.tsx`

**Interfaces:**
- Consumes: `createSession(projectId, cwd, { runId, resume })` (Task 7); `Run.sessionId`, `Run.worktree` (Task 6)
- Produces: `POST /api/terminal/sessions` menerima `{ project }` **atau** `{ run }`
- Produces: `api.createTerminalForRun(runId: string): Promise<{ id: string }>`

- [ ] **Step 1: Tulis test yang gagal**

Create `server/test/terminal.route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../src/app";
import { prisma } from "../src/db";
import { killAll } from "../src/services/pty";
import { resetDb, makeProject, makeRun } from "./factory";

const app = build();
afterEach(() => { killAll(); });
beforeEach(async () => { process.env.HANOMAN_CLAUDE_BIN = "/bin/echo"; await resetDb(); await makeProject(); });

const post = (body: unknown) => app.inject({ method: "POST", url: "/api/terminal/sessions", payload: body });

describe("POST /terminal/sessions { run }", () => {
  it("400 when the run has no session id yet", async () => {
    await makeRun({ id: "RUN-1", projectId: "p1", status: "queued" });
    const r = await post({ run: "RUN-1" });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/belum punya sesi/);
  });

  it("400 for a done run — its worktree is removed on purpose", async () => {
    await makeRun({ id: "RUN-2", projectId: "p1", status: "done", sessionId: "s2", worktree: "/nope" });
    const r = await post({ run: "RUN-2" });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/sudah selesai/);
  });

  it("400 when the worktree is gone, naming the path it looked for", async () => {
    await makeRun({ id: "RUN-3", projectId: "p1", status: "failed", sessionId: "s3", worktree: "/tmp/hilang-xyz" });
    const r = await post({ run: "RUN-3" });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toContain("/tmp/hilang-xyz");
  });

  it("201 and attaches the session to the run when the worktree exists", async () => {
    const wt = mkdtempSync(join(tmpdir(), "hanoman-wt-"));
    try {
      await makeRun({ id: "RUN-4", projectId: "p1", status: "stopped", sessionId: "s4", worktree: wt });
      const r = await post({ run: "RUN-4" });
      expect(r.statusCode).toBe(201);
      const list = await app.inject({ method: "GET", url: "/api/terminal/sessions" });
      expect(list.json()[0]).toMatchObject({ runId: "RUN-4", cwd: wt });
    } finally { rmSync(wt, { recursive: true, force: true }); }
  });

  it("404 for an unknown run", async () => {
    expect((await post({ run: "RUN-NOPE" })).statusCode).toBe(404);
  });
});
```

Pastikan `server/test/factory.ts` menerima `sessionId` dan `worktree` di `makeRun`. Kalau ia membangun `data` secara eksplisit, tambahkan kedua field itu ke `Partial` yang di-spread.

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./server test -- terminal.route`
Expected: FAIL — `invalid body`, karena `zTerminalSession` hanya menerima `{ project }`.

- [ ] **Step 3: Longgarkan DTO di `shared/src/dto.ts`**

```ts
export const zTerminalSession = z.union([
  z.object({ project: z.string() }),
  z.object({ run: z.string() }),
]);
```

- [ ] **Step 4: Cabangkan route di `server/src/routes/terminal.ts`**

Ganti handler `POST /terminal/sessions`:

```ts
import { existsSync } from "node:fs";
```

```ts
  app.post("/terminal/sessions", async (req, reply) => {
    const parsed = zTerminalSession.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });

    if ("run" in parsed.data) {
      const run = await prisma.run.findUnique({ where: { id: parsed.data.run } });
      if (!run) return reply.code(404).send({ error: "run not found" });
      // Run sukses menghapus worktree-nya dengan sengaja; kerjanya sudah di-commit.
      if (run.status === "done") return reply.code(400).send({ error: `run "${run.id}" sudah selesai — worktree-nya dihapus` });
      if (!run.sessionId) return reply.code(400).send({ error: `run "${run.id}" belum punya sesi claude` });
      // Jangan diam-diam jatuh ke repoDir: itu membuka sesi di working tree utama (ADR-0002).
      if (!existsSync(run.worktree)) return reply.code(400).send({ error: `worktree hilang: ${run.worktree}` });
      const s = createSession(run.projectId, run.worktree, { runId: run.id, resume: run.sessionId });
      return reply.code(201).send({ id: s.id });
    }

    const project = await prisma.project.findUnique({ where: { id: parsed.data.project } });
    if (!project) return reply.code(404).send({ error: "project not found" });
    if (!project.repoDir) return reply.code(400).send({ error: `project "${project.id}" belum punya repoDir` });
    const s = createSession(project.id, project.repoDir);
    return reply.code(201).send({ id: s.id });
  });
```

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./server test -- terminal.route`
Expected: PASS (5 test).

- [ ] **Step 6: Tambah klien API di `src/src/api/client.ts`**

```ts
export type TerminalSession = { id: string; projectId: string; runId?: string; cwd: string; exited: boolean };
```

```ts
  createTerminalForRun: (run: string) => j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body({ run }) }),
```

- [ ] **Step 7: Tandai tab sesi run di `src/src/screens/TerminalScreen.tsx`**

Ganti isi `<span>` label tab:

```tsx
              <span>{s.runId ? `${s.runId} · resume` : nameOf(s.projectId)} · {s.id.slice(0, 6)}</span>
```

- [ ] **Step 8: Verifikasi API secara nyata (wajib per CLAUDE.md)**

Boot server dan panggil endpoint-nya sungguhan — jangan hanya andalkan unit test.

```bash
docker compose up -d --wait
pnpm --filter ./server build && node server/dist/server.js &
curl -s -X POST localhost:3000/api/terminal/sessions -H 'content-type: application/json' -d '{"run":"RUN-NOPE"}'
```
Expected: `{"error":"run not found"}` dengan status 404.

Untuk kasus 201, pakai run nyata yang berstatus `stopped` dan worktree-nya masih ada, lalu buka `ws://localhost:3000/api/terminal/sessions/<id>/ws` dan pastikan `claude` benar-benar melanjutkan percakapan yang sama (riwayat fase sebelumnya terlihat), bukan memulai sesi kosong.

**Kalau masih ada issue, perbaiki sampai hijau sebelum lanjut.**

- [ ] **Step 9: Commit**

```bash
git add shared/src/dto.ts server/src/routes/terminal.ts server/test/terminal.route.test.ts \
        server/test/factory.ts src/src/api/client.ts src/src/screens/TerminalScreen.tsx
git commit -m "feat(web): buka sesi claude milik sebuah run dari layar Terminal"
```

---

### Task 9: Rapikan kosakata warisan SDK dan tutup docs

`runner/src/types.ts` masih menamai tipenya `SdkMessage` dan `SdkUserMessage` — nama peninggalan Agent SDK yang sudah dicabut ADR-0010. Siapa pun yang meng-grep "SDK" akan menyimpulkan hal yang keliru. `SdkUserMessage` kini tak dipakai sama sekali (`pump` hilang di Task 2).

**Files:**
- Modify: `runner/src/types.ts`
- Modify: pemakai `SdkMessage` (`claude-cli.ts`, `turns.ts`, `phase.ts`, test terkait)
- Modify: `internal/docs/architecture/stack.md` dan `internal/docs/operations/agent-documentation-workflow.md` (bila menyebut spawn per-fase)

**Interfaces:**
- Produces: `type CliMessage` menggantikan `SdkMessage`; `SdkUserMessage` dihapus

- [ ] **Step 1: Rename `SdkMessage` → `CliMessage`, hapus `SdkUserMessage`**

Di `runner/src/types.ts`:

```ts
export type CliMessage =
  | { type: "assistant"; session_id?: string; message: { content: Array<{ type: string; text?: string; name?: string }> } }
  | { type: "result"; subtype: string; session_id: string; total_cost_usd: number; usage: { input_tokens: number; output_tokens: number } }
  | { type: "system"; session_id?: string };
```

Hapus `SdkUserMessage`, `QueryArgs`, dan `QueryFn` (tak ada pemakainya setelah Task 5).

- [ ] **Step 2: Perbarui pemakainya**

```bash
grep -rln "SdkMessage\|SdkUserMessage\|QueryFn\|QueryArgs" runner/src runner/test server/src cli/src
```

Ganti setiap `SdkMessage` menjadi `CliMessage`. Tidak ada perubahan perilaku.

- [ ] **Step 3: Jalankan seluruh test dan typecheck**

Run: `pnpm -r typecheck`
Expected: exit 0.

Run: `pnpm test`
Expected: PASS, **kecuali** `server/test/queue-durability` yang memang sudah merah sebelum plan ini. Jangan kejar.

- [ ] **Step 4: Perbarui `internal/docs` yang tersentuh**

Cari pernyataan yang kini salah — "satu proses per fase", "SDK", "oneshot":

```bash
grep -rln "per fase\|Agent SDK\|oneshot" internal/docs
```

Perbarui `internal/docs/architecture/stack.md` agar berbunyi: runner men-spawn **satu** proses `claude` per backlog di worktree terpisah; fase adalah giliran di dalam sesi itu; sesi yang sama dapat dibuka interaktif lewat `claude --resume`.

Stop hook (`hanoman hook stop`) akan memblok commit kalau docs basi — itu memang gunanya.

- [ ] **Step 5: Commit**

```bash
git add runner/src/types.ts runner/src/claude-cli.ts runner/src/turns.ts runner/src/phase.ts \
        runner/test internal/docs
git commit -m "refactor(runner): CliMessage menggantikan kosakata SdkMessage warisan Agent SDK"
```

---

## Self-Review

**Spec coverage.** Keputusan 1 (satu sesi) → Task 2, 3, 5. Keputusan 2 (batas giliran dihitung) → Task 3, 4. Keputusan 3 (`Run.sessionId` + migration + ADR) → Task 6. Keputusan 4 (terminal masuk lewat sesi yang sama) → Task 7, 8. Keputusan 5 (guard PreToolUse di PTY) → Task 7. Bug deadlock → Task 1 (merah) → Task 5 (hijau). Rencana pengujian spec → tercakup Task 1–8; `live-smoke` diperluas di Task 5 Step 6. "Yang sengaja tidak dikerjakan" (rename `Sdk*`) ternyata **harus** dikerjakan karena `SdkUserMessage` jadi kode mati setelah `pump` hilang — Task 9 menanganinya, dan spec diperbarui di commit yang sama.

**Placeholder scan.** Tidak ada "TBD"/"handle edge cases"/"similar to Task N". Setiap step yang mengubah kode memuat kodenya.

**Type consistency.** `ClaudeSession` (`send`/`next`/`close`/`kill`) dipakai identik di Task 2, 3, 4, 5. `TurnResult` dari `turns.ts` adalah nilai balik `runPhase`. `StepState` di-mutate `runPhase`, dimiliki `run.ts`. `createSession(projectId, cwd, opts)` di Task 7 dipanggil persis begitu di Task 8. `RunEvent` varian `session` dibuat Task 2, dipancarkan Task 5, di-persist Task 6. `openSession` menggantikan `queryFn` di `RunDeps` (Task 5) dan di kedua `_deps`/`deps` (Task 6).

**Risiko yang diketahui.** `argvOverride` adalah jalan pintas khusus test di `CliOptions`; ia menghindari binary palsu harus memahami flag `claude`. Kalau reviewer menolaknya, ganti dengan fixture shell yang mengabaikan argv seperti `server/test/fixtures/fake-claude.sh` — tandai dengan komentar `ponytail:`.
