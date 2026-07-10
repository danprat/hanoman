# SPEC-157 — Agen bertanya, manusia memutuskan (`awaiting`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Saat agen menemui percabangan desain yang tak bisa ia putuskan sendiri, run berhenti di status `awaiting` dan dashboard menampilkan satu tombol per pilihan — bukan menebak diam-diam, dan bukan `failed`.

**Architecture:** Agen menulis `.hanoman-ask.json` di root worktree (preseden persis: `.hanoman-decision.json`). `runOne` membacanya di antara giliran, memancarkan event `ask`, menyetel status `awaiting`, lalu memblokir di sebuah promise. Jawaban dikirim lewat kanal Redis `run:<id>:control` yang sudah ada (`{type:"answer"}`), masuk ke sebuah `SteerQueue` khusus jawaban, dan diteruskan ke sesi `claude` yang sama sebagai satu giliran biasa lewat `takeTurn`. Tidak ada proses baru, tidak ada transport baru.

**Tech Stack:** TypeScript strict · pnpm workspaces (`shared`, `runner`, `server`, `src`, `cli`) · Vitest · Prisma + Postgres · BullMQ + Redis · Fastify · React 18.

**Spec:** [`docs/superpowers/specs/2026-07-10-hanoman-agent-ask-human-decision-spec-157-design.md`](../specs/2026-07-10-hanoman-agent-ask-human-decision-spec-157-design.md)

## Global Constraints

- TypeScript strict. Tidak ada `any` baru kecuali menembus batas Prisma `Json` (cast di satu tempat, berkomentar).
- Test untuk setiap logika orkestrasi (trigger, queue, worktree, guardrail). Jalankan `pnpm test` di paket yang tersentuh.
- Update `internal/docs` yang tersentuh **dalam commit yang sama** (Task 7 dan Task 9).
- Skema tidak berubah tanpa migration + ADR (Task 7).
- Jangan bypass Stop hook / guardrail Source of Truth. Fitur ini **tidak menyentuh** `deps.verify`.
- Jangan jalankan run di working tree utama.
- **Worktree ini dipakai bersama sesi lain.** Jangan pernah `git stash`, jangan pernah `git add -A`. Stage berkas satu per satu, persis seperti yang tertulis di tiap step Commit.
- Nilai literal yang dipakai lintas task: `ASK_FILE = ".hanoman-ask.json"` · `MAX_ASKS_PER_PHASE = 5` · `DEFAULT_ASK_TIMEOUT_MS = 30 * 60_000` · status baru `"awaiting"` · tipe pesan kontrol `"answer"`.
- Prisma dijalankan lewat Docker: `docker exec hanoman-db-1 psql -U hanoman -d hanoman …`. `psql -d hanoman` di socket unix akan gagal dan terlihat seperti DB mati.

---

### Task 1: Tipe `Ask` + `readAsk` (fail-safe)

`readAsk` adalah gerbang tunggal antara berkas yang ditulis agen dan orkestrator. Ia meniru `readDecision`: **fail-safe by construction** — apa pun yang cacat mengembalikan `null` dan run berjalan persis seperti hari ini. Ia juga **mengonsumsi** berkasnya, supaya satu tulis = satu pertanyaan dan berkas rusak tidak dibaca ulang tiap fase.

**Files:**
- Modify: `runner/src/types.ts` (tambah tipe `AskOption`, `Ask`)
- Modify: `runner/src/phases.ts:1` (import), tambah `ASK_FILE` + `readAsk`
- Test: `runner/test/phases.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
  - `type AskOption = { value: string; label: string; detail?: string }`
  - `type Ask = { question: string; options: AskOption[]; default: string }`
  - `const ASK_FILE = ".hanoman-ask.json"`
  - `function readAsk(worktree: string): Ask | null`

`Ask` sengaja hidup di `types.ts`, bukan `phases.ts`: `RunEvent` (Task 3) memerlukannya, dan `phases.ts` sudah meng-import dari `types.ts` — kebalikannya akan melingkar.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `runner/test/phases.test.ts`. Perhatikan import baru di baris 5 (`ASK_FILE`, `readAsk`) dan `existsSync`:

```ts
// tambahkan ke import node:fs yang sudah ada di baris 2:
//   import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
// tambahkan ke import ../src/phases yang sudah ada di baris 5:
//   ASK_FILE, readAsk

const askTree = (content?: string) => {
  const dir = mkdtempSync(join(tmpdir(), "hanoman-ask-"));
  if (content !== undefined) writeFileSync(join(dir, ASK_FILE), content);
  return dir;
};
const VALID = JSON.stringify({
  question: '"Orang" di sini siapa?',
  options: [
    { value: "pasien", label: "Pasien", detail: "Satu item katalog dibeli untuk >1 pasien." },
    { value: "pembayar", label: "Pembayar" },
  ],
  default: "pasien",
});

describe("readAsk (SPEC-157, fail-safe)", () => {
  it("membaca ask yang sah, lengkap dengan detail opsional", () => {
    expect(readAsk(askTree(VALID))).toEqual({
      question: '"Orang" di sini siapa?',
      options: [
        { value: "pasien", label: "Pasien", detail: "Satu item katalog dibeli untuk >1 pasien." },
        { value: "pembayar", label: "Pembayar" },
      ],
      default: "pasien",
    });
  });

  // Satu tulis = satu pertanyaan. Tanpa ini, fase berikutnya membaca ask yang sama lagi.
  it("mengonsumsi berkasnya, bahkan saat isinya rusak", () => {
    const ok = askTree(VALID);
    readAsk(ok);
    expect(existsSync(join(ok, ASK_FILE))).toBe(false);

    const bad = askTree("{not json");
    readAsk(bad);
    expect(existsSync(join(bad, ASK_FILE))).toBe(false);
  });

  it("null saat berkas absen", () => expect(readAsk(askTree())).toBeNull());
  it("null saat JSON rusak", () => expect(readAsk(askTree("{not json"))).toBeNull());
  it("null saat json bukan objek", () => expect(readAsk(askTree('"pasien"'))).toBeNull());

  it("null saat question kosong", () =>
    expect(readAsk(askTree(JSON.stringify({ question: "  ", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], default: "a" })))).toBeNull());

  it("null saat opsi kurang dari dua — pertanyaan satu pilihan bukan pertanyaan", () =>
    expect(readAsk(askTree(JSON.stringify({ question: "q", options: [{ value: "a", label: "A" }], default: "a" })))).toBeNull());

  it("null saat sebuah opsi tak punya value/label string", () =>
    expect(readAsk(askTree(JSON.stringify({ question: "q", options: [{ value: "a", label: "A" }, { value: 2, label: "B" }], default: "a" })))).toBeNull());

  // `default` adalah jawaban saat tak ada manusia. Kalau ia menunjuk ke luar menu,
  // tak ada yang bisa diterapkan saat timeout — jadi ask-nya batal seluruhnya.
  it("null saat default bukan salah satu option value", () =>
    expect(readAsk(askTree(JSON.stringify({ question: "q", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], default: "z" })))).toBeNull());

  it("null saat default bukan string", () =>
    expect(readAsk(askTree(JSON.stringify({ question: "q", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], default: 0 })))).toBeNull());

  it("membuang detail yang bukan string alih-alih menolak ask-nya", () => {
    const r = readAsk(askTree(JSON.stringify({ question: "q", options: [{ value: "a", label: "A", detail: 42 }, { value: "b", label: "B" }], default: "a" })));
    expect(r?.options[0]).toEqual({ value: "a", label: "A" });
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./runner exec vitest run test/phases.test.ts`
Expected: FAIL — `readAsk is not a function` / `ASK_FILE` tidak ter-export.

- [x] **Step 3: Tambah tipe di `runner/src/types.ts`**

Sisipkan tepat di atas `export type PhaseState` (baris 34):

```ts
// Pertanyaan yang diajukan agen ke manusia (SPEC-157). `default` WAJIB salah satu
// `options[].value`: ia yang diterapkan kalau tak ada yang menjawab sebelum timeout.
export type AskOption = { value: string; label: string; detail?: string };
export type Ask = { question: string; options: AskOption[]; default: string };
```

- [x] **Step 4: Tambah `ASK_FILE` + `readAsk` di `runner/src/phases.ts`**

Ubah baris 1-2 menjadi:

```ts
import { readFileSync, rmSync } from "node:fs";
import type { Ask, AskOption, Flow, RunInput, StepModels } from "./types";
```

Sisipkan tepat setelah `readDecision` (setelah baris 30):

```ts
// Pertanyaan agen ke manusia (SPEC-157). Ditulis agen di root worktree, dibaca `runOne` di
// antara giliran, dan — seperti DECISION_FILE — dihapus TANPA SYARAT sebelum commit.
export const ASK_FILE = ".hanoman-ask.json";

// Fail-safe by construction, persis seperti `readDecision`: berkas absen, JSON rusak, bukan
// objek, opsi < 2, atau `default` di luar menu → `null`, dan run berjalan seperti tanpa fitur
// ini. Berkas yang cacat tidak boleh bisa menyandera run. Tidak pernah melempar.
//
// Berkasnya DIKONSUMSI (unlink) sebelum diparse, bukan sesudah: satu tulis = satu pertanyaan,
// dan ask rusak yang tertinggal akan dibaca ulang di setiap fase berikutnya selamanya.
export function readAsk(worktree: string): Ask | null {
  const path = `${worktree}/${ASK_FILE}`;
  let raw: string;
  try { raw = readFileSync(path, "utf8"); } catch { return null; }
  rmSync(path, { force: true });
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (typeof j?.question !== "string" || !j.question.trim()) return null;
    if (!Array.isArray(j.options) || j.options.length < 2) return null;
    const options: AskOption[] = [];
    for (const raw of j.options as Record<string, unknown>[]) {
      if (typeof raw?.value !== "string" || !raw.value) return null;
      if (typeof raw?.label !== "string" || !raw.label) return null;
      options.push({ value: raw.value, label: raw.label, ...(typeof raw.detail === "string" ? { detail: raw.detail } : {}) });
    }
    if (typeof j.default !== "string" || !options.some((o) => o.value === j.default)) return null;
    return { question: j.question, options, default: j.default };
  } catch { return null; }
}
```

- [x] **Step 5: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./runner exec vitest run test/phases.test.ts`
Expected: PASS — seluruh `readDecision` lama tetap hijau, 10 test `readAsk` baru hijau.

- [x] **Step 6: Commit**

```bash
git add runner/src/types.ts runner/src/phases.ts runner/test/phases.test.ts
git commit -m "feat(runner): readAsk — gerbang fail-safe untuk pertanyaan agen (SPEC-157)"
```

---

### Task 2: `SteerQueue.next()`

Jawaban bisa ter-publish di celah antara `readAsk` dan awal `await`. Resolver promise telanjang akan kehilangannya dan run menggantung sampai timeout. Buffer yang sudah ada di `SteerQueue` menutup balapan itu — jadi memakai ulang kelas ini benar, bukan sekadar hemat.

**Files:**
- Modify: `runner/src/steer-queue.ts`
- Test: `runner/test/steer-queue.test.ts`

**Interfaces:**
- Consumes: —
- Produces: `SteerQueue.next(): Promise<string>` (di samping `push`/`drain` yang tidak berubah)

- [x] **Step 1: Tulis test yang gagal**

Ganti seluruh isi `runner/test/steer-queue.test.ts`:

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

  it("next() menunggu push berikutnya", async () => {
    const q = new SteerQueue();
    const p = q.next();
    q.push("jawab");
    await expect(p).resolves.toBe("jawab");
  });

  // Balapan yang membuat fitur ini benar: jawaban tiba SEBELUM ada yang menunggu.
  it("next() langsung selesai kalau pesannya sudah lebih dulu masuk buffer", async () => {
    const q = new SteerQueue();
    q.push("duluan");
    await expect(q.next()).resolves.toBe("duluan");
  });

  it("pesan yang diambil next() tidak ikut ter-drain lagi", async () => {
    const q = new SteerQueue();
    q.push("a");
    await q.next();
    expect(q.drain()).toEqual([]);
  });

  it("dua penunggu dilayani sesuai urutan datang", async () => {
    const q = new SteerQueue();
    const first = q.next(); const second = q.next();
    q.push("1"); q.push("2");
    await expect(first).resolves.toBe("1");
    await expect(second).resolves.toBe("2");
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./runner exec vitest run test/steer-queue.test.ts`
Expected: FAIL — `q.next is not a function`.

- [x] **Step 3: Implementasi minimal**

Ganti seluruh isi `runner/src/steer-queue.ts`:

```ts
// Pesan steer menjadi giliran tambahan yang dikuras di antara fase. Ia tidak lagi menjadi
// prompt sebuah fase: prompt berupa AsyncIterable-lah yang dulu menahan stdin tetap terbuka
// selamanya, sehingga `claude` tak pernah keluar dan fase Execute tak pernah selesai.
//
// SPEC-157 memakai kelas yang sama untuk antrian JAWABAN (instans terpisah). `next()` ada
// demi itu: buffer menutup balapan "jawaban ter-publish sebelum runner sempat menunggu".
export class SteerQueue {
  private buf: string[] = [];
  private waiters: ((text: string) => void)[] = [];
  push(text: string) {
    const w = this.waiters.shift();
    if (w) w(text);
    else this.buf.push(text);
  }
  drain(): string[] { const out = this.buf; this.buf = []; return out; }
  /** Pesan berikutnya — dari buffer kalau sudah ada, kalau tidak menunggu `push`. */
  next(): Promise<string> {
    const t = this.buf.shift();
    return t !== undefined ? Promise.resolve(t) : new Promise((r) => this.waiters.push(r));
  }
}
```

- [x] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./runner exec vitest run test/steer-queue.test.ts`
Expected: PASS (5 test).

- [x] **Step 5: Commit**

```bash
git add runner/src/steer-queue.ts runner/test/steer-queue.test.ts
git commit -m "feat(runner): SteerQueue.next() — buffer menutup balapan jawaban-sebelum-tunggu (SPEC-157)"
```

---

### Task 3: `runOne` berhenti, bertanya, melanjutkan

Fase belum `done` selama masih ada yang ditanyakan. Task ini menangani jalur manusia-menjawab dan jalur abort. Timeout dan cap menyusul di Task 4 — di sini `askTimeoutMs` sudah diterima tapi cukup dipakai apa adanya.

**Files:**
- Modify: `runner/src/types.ts` (RunEvent: `ask` + status `awaiting`)
- Modify: `runner/src/run.ts`
- Test: `runner/test/run.test.ts`

**Interfaces:**
- Consumes: `Ask`, `ASK_FILE`, `readAsk` (Task 1) · `SteerQueue.next()` (Task 2)
- Produces:
  - `RunEvent` bertambah `{ kind: "ask"; ask: Ask | null }`; varian `status` bertambah `"awaiting"`
  - `runOne(input, deps, onEvent, ctl)` — `ctl` bertambah `answers?: SteerQueue` dan `askTimeoutMs?: number`
  - konstanta modul `MAX_ASKS_PER_PHASE = 5`, `DEFAULT_ASK_TIMEOUT_MS = 30 * 60_000`

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `runner/test/run.test.ts`. Helper `askTree` meniru `qaTree` yang sudah ada di baris 256:

```ts
// tambahkan ke import ../src/phases yang sudah ada di baris 7:
//   ASK_FILE
// `writeFileSync`, `mkdirSync`, `mkdtempSync`, `existsSync` sudah ter-import di baris 2.

describe("runOne · pertanyaan agen (SPEC-157)", () => {
  const ASK = {
    question: '"Orang" di sini siapa?',
    options: [{ value: "pasien", label: "Pasien" }, { value: "pembayar", label: "Pembayar" }],
    default: "pasien",
  };
  // Worktree nyata + berkas ask yang sudah menunggu sebelum fase pertama selesai.
  const askTree = (ask: unknown = ASK) => {
    const repoDir = mkdtempSync(join(tmpdir(), "hanoman-ask-run-"));
    const wt = join(repoDir, ".worktrees", "run-1");
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, ASK_FILE), JSON.stringify(ask));
    return { repoDir, wt };
  };

  it("memancarkan ask + awaiting, lalu running lagi setelah dijawab", async () => {
    const { repoDir } = askTree();
    const answers = new SteerQueue();
    answers.push("pembayar"); // jawaban sudah di buffer: run tak pernah benar-benar menunggu
    const events: any[] = [];
    const r = await runOne(input({ repoDir, only: "Brainstorm" }), fakeDeps(), (e) => events.push(e), { answers });

    expect(r.status).toBe("done");
    const kinds = events.filter((e) => e.kind === "ask" || e.kind === "status").map((e) =>
      e.kind === "ask" ? (e.ask ? "ask" : "ask:null") : `status:${e.status}`);
    expect(kinds).toEqual(["status:running", "ask", "status:awaiting", "ask:null", "status:running", "status:done"]);
  });

  it("menyuntikkan jawaban manusia ke sesi sebagai satu giliran", async () => {
    const { repoDir } = askTree();
    const s = fakeSession();
    const answers = new SteerQueue(); answers.push("pembayar");
    await runOne(input({ repoDir, only: "Brainstorm" }), fakeDeps({ openSession: () => s }), () => {}, { answers });

    expect(s.sent).toHaveLength(2); // prompt fase + jawaban
    expect(s.sent[1]).toContain("Jawaban manusia atas pertanyaanmu");
    expect(s.sent[1]).toContain("Pembayar (pembayar)");
  });

  it("menandai fase done hanya setelah pertanyaan habis", async () => {
    const { repoDir } = askTree();
    const answers = new SteerQueue(); answers.push("pasien");
    const events: any[] = [];
    await runOne(input({ repoDir, only: "Brainstorm" }), fakeDeps(), (e) => events.push(e), { answers });

    const seq = events.filter((e) => e.kind === "ask" || (e.kind === "phase" && e.state === "done"));
    expect(seq[0].kind).toBe("ask");
    expect(seq[seq.length - 1]).toEqual({ kind: "phase", name: "Brainstorm", state: "done" });
  });

  it("agen boleh bertanya lagi setelah dijawab", async () => {
    const { repoDir, wt } = askTree();
    const answers = new SteerQueue(); answers.push("pasien"); answers.push("pembayar");
    const s = fakeSession();
    // Giliran jawaban pertama menuliskan ask kedua.
    const openSession = () => {
      const inner = s;
      return { ...inner, send(t: string) { inner.send(t); if (inner.sent.length === 2) writeFileSync(join(wt, ASK_FILE), JSON.stringify(ASK)); } };
    };
    const events: any[] = [];
    await runOne(input({ repoDir, only: "Brainstorm" }), fakeDeps({ openSession: openSession as never }), (e) => events.push(e), { answers });

    expect(events.filter((e) => e.kind === "ask" && e.ask).length).toBe(2);
  });

  // Abort saat menunggu adalah permintaan berhenti, BUKAN kegagalan.
  it("abort saat menunggu → stopped, bukan failed", async () => {
    const { repoDir } = askTree();
    const abortController = new AbortController();
    const answers = new SteerQueue();
    const events: any[] = [];
    const p = runOne(input({ repoDir, only: "Brainstorm" }), fakeDeps(), (e) => {
      events.push(e);
      if (e.kind === "status" && e.status === "awaiting") abortController.abort();
    }, { answers, abortController });

    const r = await p;
    expect(r.status).toBe("stopped");
    expect(events.some((e) => e.kind === "status" && e.status === "failed")).toBe(false);
    expect(events.filter((e) => e.kind === "ask").at(-1)).toEqual({ kind: "ask", ask: null });
  });

  it("ask yang cacat tidak menghentikan apa pun", async () => {
    const { repoDir } = askTree({ question: "q", options: [{ value: "a", label: "A" }], default: "a" });
    const events: any[] = [];
    const r = await runOne(input({ repoDir, only: "Brainstorm" }), fakeDeps(), (e) => events.push(e), { answers: new SteerQueue() });
    expect(r.status).toBe("done");
    expect(events.some((e) => e.kind === "ask")).toBe(false);
  });

  it("menghapus artefak ask sebelum commitAndPush", async () => {
    const { repoDir, wt } = askTree();
    const answers = new SteerQueue(); answers.push("pasien");
    const d = fakeDeps();
    (d.git.commitAndPush as any).mockImplementation(() => {
      expect(existsSync(join(wt, ASK_FILE))).toBe(false);
      return "head99";
    });
    await runOne(input({ repoDir, only: "Brainstorm" }), d, () => {}, { answers });
    expect(d.git.commitAndPush).toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./runner exec vitest run test/run.test.ts -t "pertanyaan agen"`
Expected: FAIL — tak ada event `ask`; status `awaiting` tak pernah muncul.

- [x] **Step 3: Perluas `RunEvent` di `runner/src/types.ts`**

Ganti baris 37-43 (blok `export type RunEvent`) menjadi:

```ts
export type RunEvent =
  | { kind: "log"; line: { t: string; s: string } }
  | { kind: "phase"; name: string; state: PhaseState }
  | { kind: "cost"; tokensIn: number; tokensOut: number; costUsd: number }
  | { kind: "session"; sessionId: string }
  | { kind: "commit"; base?: string; head?: string }
  // `ask: null` menutup pertanyaan (dijawab, timeout, atau abort) — UI membersihkan tombolnya.
  | { kind: "ask"; ask: Ask | null }
  // `awaiting` BUKAN `paused`. `paused` = proses claude sudah mati, sesi dilanjutkan dari
  // sessionId. `awaiting` = proses hidup, stdin terbuka, runOne terblokir di sebuah promise.
  | { kind: "status"; status: "running" | "paused" | "awaiting" | "stopped" | "failed" | "done" };
```

- [x] **Step 4: Tulis helper di `runner/src/run.ts`**

Ubah baris 1-6 (import) menjadi:

```ts
import { existsSync, rmSync } from "node:fs";
import type { Ask, OpenSession, RunEvent, RunInput, RunResult, GitOps, CliMessage } from "./types";
import { PIPELINES, phasePrompt, stepFor, readDecision, readAsk, DECISION_FILE, ASK_FILE, QA_PLANNING } from "./phases";
import { DENY, runPhase, type StepState } from "./phase";
import { takeTurn } from "./turns";
import { SteerQueue } from "./steer-queue";
```

Sisipkan setelah blok `export interface RunDeps { … }` (setelah baris 11):

```ts
// ponytail: 5 pertanyaan per fase. Agen bingung bisa bertanya tanpa henti, dan tiap pertanyaan
// membakar satu giliran. Ini satu-satunya loop tak berhingga di jalur ini. Naikkan kalau ada
// alur sah yang melewatinya.
const MAX_ASKS_PER_PHASE = 5;
const DEFAULT_ASK_TIMEOUT_MS = 30 * 60_000;

type Answer = { value: string; byHuman: boolean };
const optionOf = (ask: Ask, value: string) => ask.options.find((o) => o.value === value);
const labelOf = (ask: Ask, value: string) => optionOf(ask, value)?.label ?? value;

// `null` = run di-abort saat menunggu. Berhenti atas permintaan bukan kegagalan.
// Buffer `SteerQueue` menutup balapan "jawaban ter-publish sebelum next() dipanggil".
function awaitAnswer(ask: Ask, answers: SteerQueue, timeoutMs: number, signal: AbortSignal): Promise<Answer | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: Answer | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(v);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish({ value: ask.default, byHuman: false }), timeoutMs);
    signal.addEventListener("abort", onAbort);
    // ponytail: `next()` yang kalah balapan tetap menggantung sampai proses keluar. Satu run =
    // satu proses, dan run yang di-abort sedang menuju penutupan sesi — tak ada yang bocor.
    void answers.next().then((value) => finish({ value, byHuman: true }));
  });
}

// Agen tidak boleh mengira tebakannya sendiri sudah dikonfirmasi manusia.
function answerText(ask: Ask, a: Answer, timeoutMs: number): string {
  const o = optionOf(ask, a.value);
  const tail = `${o?.label ?? a.value} (${a.value})${o?.detail ? ` — ${o.detail}` : ""}`;
  if (a.byHuman) return `Jawaban manusia atas pertanyaanmu: ${tail}`;
  return timeoutMs > 0
    ? `Tidak ada jawaban dalam ${Math.round(timeoutMs / 60_000)}m — memakai pilihanmu sendiri: ${tail}`
    : `Run berjalan tanpa penunggu — memakai pilihanmu sendiri: ${tail}`;
}
```

- [x] **Step 5: Terima `answers` + `askTimeoutMs` di `runOne`**

Ganti tanda tangan `runOne` (baris 13-16) menjadi:

```ts
export async function runOne(
  input: RunInput, deps: RunDeps, onEvent: (e: RunEvent) => void,
  ctl: { abortController?: AbortController; steer?: SteerQueue; answers?: SteerQueue; askTimeoutMs?: number } = {},
): Promise<RunResult> {
  const abortController = ctl.abortController ?? new AbortController();
  const askTimeoutMs = ctl.askTimeoutMs ?? DEFAULT_ASK_TIMEOUT_MS;
```

- [x] **Step 6: Sisipkan loop ask**

Di `runner/src/run.ts`, tepat **setelah** blok error fase (yang berakhir `return failed();` di baris 99) dan **sebelum** `onEvent({ kind: "phase", name: phase, state: "done" });` (baris 100), sisipkan:

```ts
        // Agen boleh berhenti dan bertanya (SPEC-157). Fase belum `done` selama masih ada yang
        // ditanyakan: jawabannya menjadi giliran lanjutan dari pekerjaan fase ini, bukan fase baru.
        // `readAsk` mengonsumsi berkasnya, jadi loop ini berhenti sendiri saat agen tak bertanya lagi.
        for (let asked = 0; ; asked++) {
          const ask = readAsk(worktree);
          if (!ask) break;
          if (!ctl.answers) break; // tak ada kanal jawaban (mis. `hanoman run` lokal) → jalan terus

          onEvent({ kind: "ask", ask });
          onEvent({ kind: "status", status: "awaiting" });
          const a = await awaitAnswer(ask, ctl.answers, askTimeoutMs, abortController.signal);
          onEvent({ kind: "ask", ask: null });
          if (a === null) { onEvent({ kind: "status", status: "stopped" }); return stopped(); }
          onEvent({ kind: "status", status: "running" });
          onEvent({ kind: "log", line: { t: "»", s: `jawaban: ${labelOf(ask, a.value)}` } });

          const t = await takeTurn(session, answerText(ask, a, askTimeoutMs), onLog);
          costUsd = t.costUsd; tokensIn += t.tokensIn; tokensOut += t.tokensOut;
          if (t.subtype.startsWith("error") || t.isError) {
            const why = t.apiErrorStatus ? `API ${t.apiErrorStatus}` : t.subtype;
            onEvent({ kind: "log", line: { t: "✗", s: `fase ${phase} gagal saat menjawab · ${why}` } });
            onEvent({ kind: "phase", name: phase, state: "failed" });
            onEvent({ kind: "status", status: "failed" });
            return failed();
          }
        }
```

- [x] **Step 7: Bersihkan artefak ask sebelum commit**

Ganti baris `rmSync(\`${worktree}/${DECISION_FILE}\`, { force: true });` (baris 144) menjadi dua baris:

```ts
  rmSync(`${worktree}/${DECISION_FILE}`, { force: true });
  rmSync(`${worktree}/${ASK_FILE}`, { force: true });
```

Komentar di atasnya sudah menjelaskan alasannya (`git add -A` men-stage berkas ber-titik di root); perluas kalimat pertamanya menjadi `Artefak keputusan DAN pertanyaan.`

- [x] **Step 8: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./runner exec vitest run`
Expected: PASS — 7 test `pertanyaan agen` baru hijau, seluruh test `runOne` lama tetap hijau.

- [x] **Step 9: Commit**

```bash
git add runner/src/types.ts runner/src/run.ts runner/test/run.test.ts
git commit -m "feat(runner): runOne berhenti di awaiting dan melanjutkan sesi dengan jawaban (SPEC-157)"
```

---

### Task 4: Timeout ke pilihan agen + cap 5 pertanyaan

Tebakan diterima kembali di sini — jadi ia wajib **terlihat**. Baris log bertanda `✗` membuat run yang menebak tidak pernah identik dengan run yang kamu putuskan.

**Files:**
- Modify: `runner/src/run.ts` (loop ask dari Task 3)
- Test: `runner/test/run.test.ts`

**Interfaces:**
- Consumes: `awaitAnswer`, `answerText`, `labelOf`, `MAX_ASKS_PER_PHASE` (Task 3)
- Produces: perilaku `askTimeoutMs <= 0` (langsung pakai default, tanpa pernah `awaiting`) dan cap per fase

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di dalam `describe("runOne · pertanyaan agen (SPEC-157)")`:

```ts
  it("timeout memakai pilihan agen dan mencatatnya sebagai ✗", async () => {
    const { repoDir } = askTree();
    const events: any[] = [];
    const r = await runOne(input({ repoDir, only: "Brainstorm" }), fakeDeps(), (e) => events.push(e),
      { answers: new SteerQueue(), askTimeoutMs: 10 });

    expect(r.status).toBe("done");
    const miss = events.find((e) => e.kind === "log" && e.line.t === "✗");
    expect(miss.line.s).toContain("tak terjawab");
    expect(miss.line.s).toContain("Pasien"); // label default
  });

  it("timeout menyuntikkan teks yang menolak mengaku sudah dikonfirmasi", async () => {
    const { repoDir } = askTree();
    const s = fakeSession();
    await runOne(input({ repoDir, only: "Brainstorm" }), fakeDeps({ openSession: () => s }), () => {},
      { answers: new SteerQueue(), askTimeoutMs: 10 });
    expect(s.sent[1]).toContain("memakai pilihanmu sendiri");
    expect(s.sent[1]).not.toContain("Jawaban manusia");
  });

  // askTimeoutMin: 0 → batch tak berpenunggu. Tak pernah `awaiting`, tak pernah menahan slot.
  it("askTimeoutMs 0 langsung memakai default tanpa pernah masuk awaiting", async () => {
    const { repoDir } = askTree();
    const events: any[] = [];
    const r = await runOne(input({ repoDir, only: "Brainstorm" }), fakeDeps(), (e) => events.push(e),
      { answers: new SteerQueue(), askTimeoutMs: 0 });

    expect(r.status).toBe("done");
    expect(events.some((e) => e.kind === "status" && e.status === "awaiting")).toBe(false);
    expect(events.some((e) => e.kind === "log" && e.line.t === "✗" && e.line.s.includes("tanpa penunggu"))).toBe(true);
  });

  it("berhenti bertanya setelah 5 pertanyaan dalam satu fase", async () => {
    const { repoDir, wt } = askTree();
    const answers = new SteerQueue();
    for (let i = 0; i < 10; i++) answers.push("pasien");
    const s = fakeSession();
    // Setiap giliran jawaban menuliskan ask baru — agen yang tak pernah berhenti bertanya.
    const openSession = () => ({ ...s, send(t: string) { s.send(t); writeFileSync(join(wt, ASK_FILE), JSON.stringify(ASK)); } });
    const events: any[] = [];
    const r = await runOne(input({ repoDir, only: "Brainstorm" }), fakeDeps({ openSession: openSession as never }), (e) => events.push(e), { answers });

    expect(r.status).toBe("done");
    expect(events.filter((e) => e.kind === "ask" && e.ask).length).toBe(MAX_ASKS_PER_PHASE);
    expect(events.some((e) => e.kind === "log" && e.line.t === "✗" && e.line.s.includes("batas"))).toBe(true);
  });
```

Tambahkan `MAX_ASKS_PER_PHASE` ke import dari `../src/run` di baris 5:
`import { runOne, MAX_ASKS_PER_PHASE } from "../src/run";`

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./runner exec vitest run test/run.test.ts -t "pertanyaan agen"`
Expected: FAIL — `MAX_ASKS_PER_PHASE` tak ter-export; test timeout menggantung 30 menit (batalkan) atau gagal karena tak ada baris `✗`.

- [x] **Step 3: Export konstanta cap**

Di `runner/src/run.ts`, ubah `const MAX_ASKS_PER_PHASE = 5;` menjadi `export const MAX_ASKS_PER_PHASE = 5;`

- [x] **Step 4: Ganti loop ask dengan versi ber-timeout dan ber-cap**

Ganti seluruh blok `for (let asked = 0; ; asked++) { … }` dari Task 3 dengan:

```ts
        // Agen boleh berhenti dan bertanya (SPEC-157). Fase belum `done` selama masih ada yang
        // ditanyakan: jawabannya menjadi giliran lanjutan dari pekerjaan fase ini, bukan fase baru.
        // `readAsk` mengonsumsi berkasnya, jadi loop ini berhenti sendiri saat agen tak bertanya lagi.
        //
        // `waits` salah → agen tetap dijawab, langsung dengan pilihannya sendiri. Ini jalur batch
        // tak berpenunggu (askTimeoutMin 0) dan jalur CLI lokal yang tak punya kanal jawaban.
        const waits = Boolean(ctl.answers) && askTimeoutMs > 0;
        for (let asked = 0; ; asked++) {
          const ask = readAsk(worktree);
          if (!ask) break;
          const capped = asked >= MAX_ASKS_PER_PHASE;
          let a: Answer;

          if (capped) {
            onEvent({ kind: "log", line: { t: "✗", s: `batas ${MAX_ASKS_PER_PHASE} pertanyaan per fase terlampaui — memakai pilihan agen: ${labelOf(ask, ask.default)}` } });
            a = { value: ask.default, byHuman: false };
          } else if (!waits) {
            onEvent({ kind: "log", line: { t: "✗", s: `run berjalan tanpa penunggu — memakai pilihan agen: ${labelOf(ask, ask.default)}` } });
            a = { value: ask.default, byHuman: false };
          } else {
            onEvent({ kind: "ask", ask });
            onEvent({ kind: "status", status: "awaiting" });
            const got = await awaitAnswer(ask, ctl.answers!, askTimeoutMs, abortController.signal);
            onEvent({ kind: "ask", ask: null });
            if (got === null) { onEvent({ kind: "status", status: "stopped" }); return stopped(); }
            onEvent({ kind: "status", status: "running" });
            a = got;
            onEvent(a.byHuman
              ? { kind: "log", line: { t: "»", s: `jawaban: ${labelOf(ask, a.value)}` } }
              : { kind: "log", line: { t: "✗", s: `pertanyaan tak terjawab ${Math.round(askTimeoutMs / 60_000)}m — memakai pilihan agen: ${labelOf(ask, a.value)}` } });
          }

          const t = await takeTurn(session, answerText(ask, a, waits ? askTimeoutMs : 0), onLog);
          costUsd = t.costUsd; tokensIn += t.tokensIn; tokensOut += t.tokensOut;
          if (t.subtype.startsWith("error") || t.isError) {
            const why = t.apiErrorStatus ? `API ${t.apiErrorStatus}` : t.subtype;
            onEvent({ kind: "log", line: { t: "✗", s: `fase ${phase} gagal saat menjawab · ${why}` } });
            onEvent({ kind: "phase", name: phase, state: "failed" });
            onEvent({ kind: "status", status: "failed" });
            return failed();
          }
          if (capped) break;
        }
```

Catatan: test Task 3 `"ask yang cacat tidak menghentikan apa pun"` tetap hijau — `readAsk` mengembalikan `null`, loop `break` di iterasi pertama. Test Task 3 `"agen boleh bertanya lagi setelah dijawab"` tetap hijau — `waits` benar karena `answers` ada dan timeout default > 0.

- [x] **Step 5: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./runner exec vitest run`
Expected: PASS — 11 test `pertanyaan agen`, seluruh test runner lama hijau.

- [x] **Step 6: Commit**

```bash
git add runner/src/run.ts runner/test/run.test.ts
git commit -m "feat(runner): timeout ask jatuh ke pilihan agen, dicatat ✗; cap 5 per fase (SPEC-157)"
```

---

### Task 5: Instruksi `ASK` di prompt fase

Tanpa ini agen tidak tahu berkasnya ada. Instruksi dipancarkan **tanpa syarat** — percabangan desain bisa muncul di fase mana pun, termasuk di tengah Execute.

**Files:**
- Modify: `runner/src/phases.ts` (konstanta `ASK` + `phasePrompt`)
- Test: `runner/test/phases.test.ts`

**Interfaces:**
- Consumes: `ASK_FILE` (Task 1)
- Produces: `phasePrompt` selalu memuat `ASK_FILE`

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `describe("phasePrompt · instruksi keputusan")` di `runner/test/phases.test.ts`:

```ts
  it("meminta setiap fase menulis ask saat ragu, di semua flow", () => {
    for (const [flow, phases] of [["feature", ["Brainstorm", "Objective", "Spec", "Plan", "Execute"]], ["qa", ["Audit", "Spec", "Plan", "Execute"]]] as const)
      for (const phase of phases) {
        const p = phasePrompt(flow, phase, { ...input(), flow });
        expect(p).toContain(ASK_FILE);
        expect(p).toContain("JANGAN menebak");
      }
  });

  // Dua artefak, dua nama. Test lama memastikan hanya qa/Audit yang diminta menulis DECISION_FILE.
  it("instruksi ask tidak mencemari instruksi decision", () => {
    expect(phasePrompt("feature", "Execute", input())).not.toContain(DECISION_FILE);
  });
```

Tambahkan `ASK_FILE` ke import baris 5.

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./runner exec vitest run test/phases.test.ts -t "phasePrompt"`
Expected: FAIL — prompt tidak memuat `.hanoman-ask.json`.

- [x] **Step 3: Tambah konstanta `ASK` dan pasang di `phasePrompt`**

Di `runner/src/phases.ts`, sisipkan tepat setelah konstanta `DECIDE` (setelah baris 52):

```ts
// Dipancarkan di SETIAP fase dan setiap flow: percabangan desain bisa muncul di mana saja,
// termasuk di tengah Execute. `default` wajib — ia yang dipakai kalau tak ada manusia menjawab.
const ASK = `\n\nKalau sebuah keputusan menentukan bentuk data model, kontrak API, atau ruang lingkup, `
  + `dan kamu tidak yakin: JANGAN menebak. Tulis \`${ASK_FILE}\` di root worktree lalu akhiri gilirannmu. `
  + `Bentuknya: {"question":"<satu pertanyaan>","options":[{"value":"<slug>","label":"<singkat>","detail":"<satu kalimat>"}, …],`
  + `"default":"<value yang kamu condongi>"}. Minimal dua opsi; \`default\` wajib salah satu \`value\`. `
  + `Run akan berhenti dan menunggu manusia menjawab; kalau tak ada yang menjawab, \`default\` yang dipakai.`;
```

Ganti `return` di `phasePrompt` (baris 59) menjadi:

```ts
  return `hanoman ${flow} — fase ${phase}. Ikuti internal/docs sebagai Source of Truth. ${scope} Perbarui docs yang tersentuh dan link di index.${specBlock(input)}${decide}${ASK}`;
```

- [x] **Step 4: Perbaiki salah ketik**

`gilirannmu` → `giliranmu`. Periksa ulang dengan `rtk proxy grep -n "gilirannmu" runner/src/phases.ts` — harus kosong.

- [x] **Step 5: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./runner exec vitest run`
Expected: PASS — termasuk test lama `"asks no feature phase for a decision"` (ASK_FILE ≠ DECISION_FILE).

- [x] **Step 6: Commit**

```bash
git add runner/src/phases.ts runner/test/phases.test.ts
git commit -m "feat(runner): instruksi ASK di setiap prompt fase (SPEC-157)"
```

---

### Task 6: Kontrak bersama — status `awaiting`, `zAsk`, `zAnswer`, `askTimeoutMin`

**Files:**
- Modify: `shared/src/enums.ts`
- Modify: `shared/src/entities.ts` (`zAsk`, `zRun.pendingAsk`, `zSetting.askTimeoutMin`)
- Modify: `shared/src/dto.ts` (`zAnswer`)
- Modify: `shared/src/api.ts` (`paths.runAnswer`)
- Modify: `server/src/services/settings.ts` (`DEFAULT_SETTING.askTimeoutMin`)
- Test: `shared/test/enums.test.ts` (buat kalau belum ada)

`DEFAULT_SETTING` ikut di task ini, bukan Task 8: `Setting` adalah `z.infer<typeof zSetting>`, jadi begitu `askTimeoutMin` menjadi field wajib, `server/src/services/settings.ts` tidak lagi ter-kompilasi. Menundanya ke Task 8 meninggalkan satu commit yang merah `tsc`.

**Interfaces:**
- Consumes: —
- Produces:
  - `zRunStatus` memuat `"awaiting"`; `isRunActive("awaiting") === true`
  - `zAsk` / `type Ask` (bentuk identik dengan `Ask` di runner); `zRun.pendingAsk: Ask | null`
  - `zAnswer = z.object({ value: z.string().min(1) })`
  - `paths.runAnswer(id) === "/api/runs/<id>/answer"`
  - `zSetting.askTimeoutMin: number` (default `30`, min `0`)

- [x] **Step 1: Tulis test yang gagal**

Buat `shared/test/enums.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { zRunStatus, isRunActive, zAsk, zAnswer, zSetting, paths } from "../src/index";

describe("SPEC-157 · kontrak awaiting", () => {
  it("awaiting adalah status run yang sah", () =>
    expect(zRunStatus.safeParse("awaiting").success).toBe(true));

  // `awaiting` = proses claude hidup. Gate poll harus terus menariknya, dan daftar run
  // tidak boleh membeku sampai operator refresh manual.
  it("awaiting terhitung aktif", () => expect(isRunActive("awaiting")).toBe(true));
  it("status terminal tetap tidak aktif", () => {
    for (const s of ["done", "failed", "stopped"]) expect(isRunActive(s)).toBe(false);
  });

  it("zAsk menolak opsi kurang dari dua", () =>
    expect(zAsk.safeParse({ question: "q", options: [{ value: "a", label: "A" }], default: "a" }).success).toBe(false));

  it("zAsk menerima ask yang sah", () =>
    expect(zAsk.safeParse({ question: "q", options: [{ value: "a", label: "A" }, { value: "b", label: "B", detail: "d" }], default: "a" }).success).toBe(true));

  it("zAnswer menolak value kosong", () => expect(zAnswer.safeParse({ value: "" }).success).toBe(false));

  it("askTimeoutMin default 30 menit dan menerima 0", () => {
    const base = { steps: { brainstorm: { model: "m", effort: "e" }, spec: { model: "m", effort: "e" }, plan: { model: "m", effort: "e" }, execute: { model: "m", effort: "e" }, audit: { model: "m", effort: "e" } },
      autoDefault: true, blockStale: true, requireLinks: true, autoScaffold: true, maxConcurrent: 3, notifyFail: true };
    expect(zSetting.parse(base).askTimeoutMin).toBe(30);
    expect(zSetting.parse({ ...base, askTimeoutMin: 0 }).askTimeoutMin).toBe(0);
    expect(zSetting.safeParse({ ...base, askTimeoutMin: -1 }).success).toBe(false);
  });

  it("paths.runAnswer", () => expect(paths.runAnswer("RUN-1")).toBe("/api/runs/RUN-1/answer"));
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./shared exec vitest run`
Expected: FAIL — `zAsk` tidak ter-export.

- [x] **Step 3: `shared/src/enums.ts`**

Ganti baris 4 dan baris 19-20:

```ts
export const zRunStatus = z.enum(["queued","running","awaiting","paused","stopped","failed","done"]);
```

```ts
// Beda dari "punya proses hidup" (running|awaiting|paused, untuk steer/pause/stop) dan dari
// "boleh di-enqueue" (queued|running|awaiting, dedupe di server/src/queue.ts).
export const isRunActive = (status: string): boolean =>
  status === "queued" || status === "running" || status === "awaiting" || status === "paused";
```

Perbarui juga komentar baris 13-18 agar menyebut `awaiting`.

- [x] **Step 4: `shared/src/entities.ts`**

Sisipkan tepat di atas `export const zRun` (baris 31):

```ts
// SPEC-157 · pertanyaan agen yang sedang menunggu jawaban manusia. Bentuknya identik dengan
// `Ask` di @hanoman/runner — runner menulisnya, server menyimpannya, UI merendernya.
export const zAskOption = z.object({ value: z.string().min(1), label: z.string().min(1), detail: z.string().optional() });
export const zAsk = z.object({
  question: z.string().min(1),
  options: z.array(zAskOption).min(2),
  default: z.string().min(1),
});
export type Ask = z.infer<typeof zAsk>;
```

Tambahkan field ke `zRun` (setelah `createdAt`/`finishedAt`, baris 40):

```ts
  createdAt: z.string(), finishedAt: z.string().nullable(),
  pendingAsk: zAsk.nullable(),
```

Tambahkan ke `zSetting` (baris 50-55), setelah `notifyFail`:

```ts
  notifyFail: z.boolean(),
  // Menit menunggu jawaban manusia sebelum `default` milik agen dipakai. `0` = jangan pernah
  // menunggu (batch tak berpenunggu). `.default(30)` menjaga body PUT lama tetap sah.
  askTimeoutMin: z.number().int().min(0).default(30) });
```

- [x] **Step 5: `shared/src/dto.ts` + `shared/src/api.ts`**

Di `dto.ts`, setelah `zCommand` (baris 43):

```ts
// Jawaban atas `Run.pendingAsk`. `value` divalidasi terhadap `options` di route — batas
// kepercayaan: klien tak boleh menyuntik teks sembarang ke stdin agen lewat sini.
export const zAnswer = z.object({ value: z.string().min(1) });
```

Di `api.ts`, setelah `runSteer` (baris 17):

```ts
  runAnswer: (id: string) => `${API}/runs/${id}/answer`,
```

- [x] **Step 6: Jaga `DEFAULT_SETTING` tetap ter-kompilasi**

Di `server/src/services/settings.ts`, baris 10-14:

```ts
export const DEFAULT_SETTING: Setting = {
  steps: { brainstorm: STEP, spec: STEP, plan: STEP, execute: STEP, audit: STEP },
  autoDefault: true, blockStale: true, requireLinks: true, autoScaffold: true,
  maxConcurrent: 3, notifyFail: true, askTimeoutMin: 30,
};
```

- [x] **Step 7: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./shared exec vitest run && pnpm --filter ./shared exec tsc --noEmit && pnpm --filter ./server exec tsc --noEmit`
Expected: PASS + tanpa error tipe di kedua paket.

- [x] **Step 8: Commit**

```bash
git add shared/src/enums.ts shared/src/entities.ts shared/src/dto.ts shared/src/api.ts shared/test/enums.test.ts server/src/services/settings.ts
git commit -m "feat(shared): status awaiting, zAsk/zAnswer, askTimeoutMin, paths.runAnswer (SPEC-157)"
```

---

### Task 7: Migration `Run.pendingAsk` + ADR-0022 + persist event `ask`

**Files:**
- Modify: `server/prisma/schema.prisma` (model `Run`)
- Create: `server/prisma/migrations/<timestamp>_run_pending_ask/migration.sql` (dihasilkan Prisma)
- Create: `internal/docs/adr/0022-pertanyaan-agen-berstatus-awaiting.md`
- Modify: `internal/docs/architecture/data-model.md`
- Modify: `server/src/runner/events-io.ts`
- Test: `server/test/events-io.test.ts`

**Interfaces:**
- Consumes: `RunEvent` varian `ask` (Task 3)
- Produces: kolom `Run.pendingAsk Json?`; `persistEvent` menulis/mengosongkannya

Postgres dev dipakai bersama semua worktree. Kolom nullable-aditif aman: branch lain tetap membaca dan menulis baris `Run` tanpa tahu kolomnya ada.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/events-io.test.ts` (ikuti pola factory yang sudah dipakai berkas itu untuk membuat baris Run):

`makeRun` (factory) memakai `id: "RUN-1"` secara default, jadi tiap test di bawah **wajib** memberi id sendiri — dua `makeRun()` telanjang akan bentrok kunci primer.

```ts
describe("persistEvent · ask (SPEC-157)", () => {
  const ASK = { question: "q", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], default: "a" };

  it("menyimpan pertanyaan yang sedang menunggu", async () => {
    await makeRun({ id: "RUN-ASK-1", projectId: "p1" });
    await persistEvent("RUN-ASK-1", { kind: "ask", ask: ASK });
    const row = await prisma.run.findUniqueOrThrow({ where: { id: "RUN-ASK-1" } });
    expect(row.pendingAsk).toEqual(ASK);
  });

  it("mengosongkan pertanyaan saat ask null", async () => {
    await makeRun({ id: "RUN-ASK-2", projectId: "p1" });
    await persistEvent("RUN-ASK-2", { kind: "ask", ask: ASK });
    await persistEvent("RUN-ASK-2", { kind: "ask", ask: null });
    const row = await prisma.run.findUniqueOrThrow({ where: { id: "RUN-ASK-2" } });
    expect(row.pendingAsk).toBeNull();
  });

  // `awaiting` bukan status terminal: jangan pernah menulis finishedAt.
  it("status awaiting tidak menulis finishedAt", async () => {
    await makeRun({ id: "RUN-ASK-3", projectId: "p1" });
    await persistEvent("RUN-ASK-3", { kind: "status", status: "awaiting" });
    const row = await prisma.run.findUniqueOrThrow({ where: { id: "RUN-ASK-3" } });
    expect(row.status).toBe("awaiting");
    expect(row.finishedAt).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./server exec vitest run test/events-io.test.ts`
Expected: FAIL — `Unknown field pendingAsk`.

- [x] **Step 3: Ubah skema**

Di `server/prisma/schema.prisma`, model `Run`, sisipkan setelah `sessionId` (baris 55):

```prisma
  // SPEC-157 · pertanyaan agen yang sedang menunggu jawaban manusia (bentuk `Ask`), atau NULL
  // saat tak ada. Hanya terisi selama status `awaiting`. Lihat ADR-0022.
  pendingAsk    Json?
```

- [x] **Step 4: Jalankan migration**

```bash
pnpm --filter ./server exec prisma migrate dev --name run_pending_ask
```

Expected: migration baru dibuat + diterapkan; `prisma generate` jalan otomatis.
Verifikasi kolomnya benar-benar ada:

```bash
docker exec hanoman-db-1 psql -U hanoman -d hanoman -c '\d "Run"' | rtk proxy grep pendingAsk
```
Expected: satu baris `pendingAsk | jsonb | | |`.

- [x] **Step 5: Tulis ADR-0022**

Buat `internal/docs/adr/0022-pertanyaan-agen-berstatus-awaiting.md`. Ikuti bentuk `0020-fase-perencanaan-qa-dipangkas-keputusan-audit.md` (Status / Konteks / Keputusan / Konsekuensi). Isi yang harus ada:

- **Konteks.** Run tak berpenunggu; agen yang menemui percabangan desain menebak. Bukti: RUN-90012 bertanya A/B/C/D soal bentuk data model invoice, tak dijawab, tetap membangun tujuh task ke arah tebakannya, dan mengakuinya di ringkasan Execute.
- **Keputusan.** (1) Agen menulis `.hanoman-ask.json`, dibaca `runOne` di antara giliran, fail-safe seperti `.hanoman-decision.json`. (2) Status baru `awaiting` — **bukan** `paused`. `paused` berarti proses `claude` sudah mati dan sesi dilanjutkan dari `sessionId`; `awaiting` berarti prosesnya hidup dan `runOne` terblokir. (3) Kolom `Run.pendingAsk Json?`. (4) Jawaban lewat kanal `run:<id>:control` yang sudah ada, tipe `answer`, divalidasi terhadap `options`.
- **Konsekuensi.** Run `awaiting` menahan satu slot `maxConcurrent` dan satu proses `claude`. Timeout (`askTimeoutMin`, default 30) jatuh ke `default` milik agen dan **wajib** dicatat sebagai baris log `✗` — tanpa itu tebakan kembali tak terlihat, persis masalah yang dipecahkan ADR ini. Worker mati saat `awaiting` → `reconcileRuns` menandainya `failed`, setara run `running` yatim hari ini.
- **Alternatif ditolak.** Memakai ulang `paused` (menabrak semantik "proses mati" dan membuat `enqueueRun` menulis `status: "queued"` di atas run yang hidup). Tombol override guardrail (bypass Source of Truth — dilarang `CLAUDE.md`).

- [x] **Step 6: Link ADR di index dan perbarui data-model**

Cari tempat ADR-0021 di-link dan sisipkan 0022 sebaris:

```bash
rtk proxy grep -rn "0021-nomor-spec" internal/docs/
```

Tambahkan entri `pendingAsk` ke tabel kolom `Run` di `internal/docs/architecture/data-model.md`, dan status `awaiting` ke daftar status run di berkas yang sama.

Verifikasi guardrail Source of Truth:

```bash
pnpm build && node cli/dist/hanoman.js docs verify --block-if-stale --json
```
Expected: exit 0. Kalau ada `unlinked`, tambahkan link — **jangan** turunkan ambang.

- [x] **Step 7: Persist event `ask`**

Di `server/src/runner/events-io.ts`, tambahkan import Prisma di baris 4:

```ts
import { Prisma } from "@prisma/client";
```

Sisipkan cabang baru sebelum penutup rantai `if/else if` (setelah cabang `commit`, sebelum baris 75):

```ts
  } else if (e.kind === "ask") {
    // `Json?` membedakan "tak ada nilai" (DbNull) dari JSON literal `null` (JsonNull).
    // Yang benar di sini DbNull: kolomnya kosong, bukan berisi null.
    // Cast: `Ask` adalah tipe struktural, Prisma menuntut `InputJsonValue`. Satu-satunya
    // cast di jalur ini, tepat di batas Prisma.
    const pendingAsk = e.ask ? (e.ask as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
    await prisma.run.update({ where: { id: runId }, data: { pendingAsk } });
  }
```

`mirrorSpecStage` di baris 75 tidak berubah: `ask` bukan `phase` maupun `status`, jadi ia tidak menggerakkan stage spec.

- [x] **Step 8: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./server exec vitest run test/events-io.test.ts`
Expected: PASS (3 test baru + seluruh test lama).

- [x] **Step 9: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations server/src/runner/events-io.ts server/test/events-io.test.ts internal/docs/adr/0022-pertanyaan-agen-berstatus-awaiting.md internal/docs/architecture/data-model.md internal/docs/README.md
git commit -m "feat(server): Run.pendingAsk + persist event ask + ADR-0022 (SPEC-157)"
```

(Kalau `rtk proxy grep` di Step 6 menemukan index ADR di berkas lain, ganti `internal/docs/README.md` dengan berkas itu.)

---

### Task 8: Worker menerima jawaban; `awaiting` diakui di seluruh server

**Files:**
- Modify: `server/src/services/settings.ts` (`askTimeoutMs()`)
- Modify: `server/src/worker.ts` (antrian `answers`, cabang `answer`, `reconcileRuns`)
- Modify: `server/src/queue.ts:39` (dedupe enqueue)
- Modify: `server/src/routes/runs.ts:108,236`
- Test: `server/test/worker.test.ts`, `server/test/queue.test.ts`

**Interfaces:**
- Consumes: `isRunActive` (Task 6) · `runOne(ctl.answers, ctl.askTimeoutMs)` (Task 3/4)
- Produces: `askTimeoutMs(): Promise<number>` di `services/settings.ts`

`server/src/github/status.ts` **tidak diubah**: `STATE` hanya memetakan status yang dikenal, dan `awaiting` — seperti `paused` — tidak ada di sana, jadi `postStatus` sudah diam dengan sendirinya. Jangan tambahkan apa pun ke sana.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/worker.test.ts`. Ini test jalur nyata: run betulan, worktree betulan berisi `ASK_FILE`, jawaban betulan lewat Redis.

```ts
// tambahkan ke import node:fs baris 2: writeFileSync
// tambahkan import: import { publisher } from "../src/redis";

describe("worker · jawaban atas pertanyaan agen (SPEC-157)", () => {
  const ASK = { question: "q", options: [{ value: "pasien", label: "Pasien" }, { value: "pembayar", label: "Pembayar" }], default: "pasien" };

  // Worktree tempat runOne akan membaca ASK_FILE: `${repoDir}/.worktrees/${runId.toLowerCase()}`.
  const askRepo = (runId: string) => {
    const repoDir = mkdtempSync(join(tmpdir(), "hanoman-worker-ask-"));
    const wt = join(repoDir, ".worktrees", runId.toLowerCase());
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, ".hanoman-ask.json"), JSON.stringify(ASK));
    return repoDir;
  };

  it("pesan answer melanjutkan run dan tidak menyisakan pendingAsk", async () => {
    await resetDb(); await makeProject({ id: "p1" }); await makeSetting({ askTimeoutMin: 30 });
    await makeRun({ id: "RUN-ASK", projectId: "p1", status: "queued" });
    const repoDir = askRepo("RUN-ASK");
    const steps = await (await import("../src/services/settings")).stepModels();

    // Diterbitkan berulang: runProcessor baru subscribe setelah beberapa await, dan
    // pub/sub Redis tidak punya replay. Buffer SteerQueue menyerap yang tiba lebih awal.
    const pub = publisher();
    const beat = setInterval(() => void pub.publish("run:RUN-ASK:control", JSON.stringify({ type: "answer", value: "pembayar" })), 20);
    try {
      await runProcessor({ data: { runId: "RUN-ASK", repoDir, branchFrom: "main", branchTo: "x", flow: "feature", only: "Brainstorm", steps } } as any, fakeDeps);
    } finally { clearInterval(beat); await pub.quit(); }

    const row = await prisma.run.findUniqueOrThrow({ where: { id: "RUN-ASK" } });
    expect(row.status).toBe("done");
    expect(row.pendingAsk).toBeNull();
    expect((row.log as { t: string; s: string }[]).some((l) => l.t === "»" && l.s.includes("Pembayar"))).toBe(true);
  });

  // Antrian terpisah: steer menjadi giliran EKSTRA setelah fase, bukan jawaban.
  it("pesan steer tidak menjawab pertanyaan — ia menjadi giliran tersendiri", async () => {
    await resetDb(); await makeProject({ id: "p1" }); await makeSetting({ askTimeoutMin: 30 });
    await makeRun({ id: "RUN-ASK2", projectId: "p1", status: "queued" });
    const repoDir = askRepo("RUN-ASK2");
    const steps = await (await import("../src/services/settings")).stepModels();
    const sent: string[] = [];
    const deps: RunDeps = { ...fakeDeps, openSession: () => fakeSession(sent) };

    const pub = publisher();
    await pub.publish("run:RUN-ASK2:control", JSON.stringify({ type: "steer", message: "halo" }));
    const beat = setInterval(() => void pub.publish("run:RUN-ASK2:control", JSON.stringify({ type: "answer", value: "pembayar" })), 20);
    try {
      await runProcessor({ data: { runId: "RUN-ASK2", repoDir, branchFrom: "main", branchTo: "x", flow: "feature", only: "Brainstorm", steps } } as any, deps);
    } finally { clearInterval(beat); await pub.quit(); }

    // [0] prompt fase · [1] jawaban (menutup ask) · [2] steer, dikuras setelah fase
    expect(sent[1]).toContain("Jawaban manusia atas pertanyaanmu");
    expect(sent[1]).toContain("Pembayar");
    expect(sent).toContain("halo");
    expect(sent.indexOf("halo")).toBeGreaterThan(1);
  });
});
```

Tambahkan ke `describe` `reconcileRuns` yang sudah ada di `server/test/worker.test.ts`:

```ts
  it("menandai run awaiting yatim sebagai failed", async () => {
    await makeRun({ id: "RUN-ORPH", projectId: "p1", status: "awaiting" });
    const orphans = await reconcileRuns({ getJob: async () => null });
    expect(orphans).toContain("RUN-ORPH");
    expect((await prisma.run.findUnique({ where: { id: "RUN-ORPH" } }))?.status).toBe("failed");
  });
```

Tambahkan ke `server/test/queue.test.ts`:

```ts
  // Tanpa gate ini, Resume atas run `awaiting` lolos, `add` no-op karena jobId sama, tapi
  // `upsert` tetap menulis `status: "queued"` di atas run yang prosesnya hidup dan terblokir.
  it("menolak enqueue run yang sedang awaiting", async () => {
    await makeRun({ id: "RUN-AW", projectId: "p1", status: "awaiting" });
    const r = await enqueueRun({ runId: "RUN-AW", projectId: "p1", repoDir: "/tmp/abs",
      branchFrom: "main", branchTo: "x", flow: "feature", steps: DEFAULT_SETTING.steps });
    expect(r).toEqual({ enqueued: false, reason: "run RUN-AW masih awaiting" });
  });
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./server exec vitest run test/worker.test.ts test/queue.test.ts`
Expected: FAIL — `RUN-ASK` selesai `done` tapi tanpa baris `»` (worker belum meneruskan `answer`); `RUN-AW` ter-enqueue; `RUN-ORPH` tidak ikut orphans.

- [x] **Step 3: `services/settings.ts`**

Tambahkan di akhir berkas — pola `?? default` sama seperti `maxConcurrent`, karena baris `Setting` lama di DB tak punya field ini (`DEFAULT_SETTING` sudah diperbarui di Task 6):

```ts
/** Menit → milidetik. `0` berarti jangan pernah menunggu jawaban manusia. */
export async function askTimeoutMs(): Promise<number> { return ((await getSetting()).askTimeoutMin ?? 30) * 60_000; }
```

- [x] **Step 4: `server/src/worker.ts`**

Baris 35, `reconcileRuns` — run `awaiting` yang kehilangan worker-nya juga yatim:

```ts
    where: { status: { in: ["queued", "running", "awaiting"] } }, select: { id: true },
```

(`paused` tetap dikecualikan: prosesnya memang sudah mati dan job-nya memang sudah tak ada — memasukkannya akan menandai `failed` setiap run yang di-pause dengan sengaja.)

Baris 51 — baca `Setting` sekali, pakai dua kali:

```ts
  const setting = await getSetting();
  const d = deps ?? depsWithGuard(setting);
```

Baris 83-93 — antrian jawaban terpisah:

```ts
  const abortController = new AbortController();
  const steer = new SteerQueue();
  // Antrian terpisah: sebuah pesan `steer` tidak boleh tak sengaja menjawab pertanyaan desain.
  const answers = new SteerQueue();
  const pub = publisher();
  const sub = subscriber();
  await sub.subscribe(`run:${id}:control`);
  sub.on("message", (_ch, raw) => {
    try {
      const msg = JSON.parse(raw) as { type: string; message?: string; value?: string };
      if (msg.type === "steer" && msg.message) steer.push(msg.message);
      else if (msg.type === "answer" && msg.value) answers.push(msg.value);
      else if (msg.type === "pause" || msg.type === "stop") abortController.abort();
    } catch { /* ignore malformed control */ }
  });
```

Baris 100:

```ts
    await runOne(input, d, onEvent, { abortController, steer, answers, askTimeoutMs: (setting.askTimeoutMin ?? 30) * 60_000 });
```

- [x] **Step 5: `server/src/queue.ts`**

Baris 38-40:

```ts
  const live = await prisma.run.findUnique({ where: { id: input.runId }, select: { status: true } });
  // `awaiting` ikut: prosesnya HIDUP dan terblokir menunggu jawaban. Tanpa baris ini Resume
  // lolos gate, `add` no-op karena jobId sama, tapi `upsert` di bawah tetap menulis
  // `status: "queued"` di atas run yang hidup — status berbohong dan tombol jawabannya lenyap.
  if (live && (live.status === "queued" || live.status === "running" || live.status === "awaiting"))
    return { enqueued: false, reason: `run ${input.runId} masih ${live.status}` };
```

- [x] **Step 6: `server/src/routes/runs.ts`**

Baris 108 — run hidup tak boleh dihapus:

```ts
    if (["queued", "running", "awaiting", "paused"].includes(run.status))
```

Baris 236 — verb terminal `pause`/`stop`/`status` tetap jalan saat menunggu:

```ts
    const active = run.status === "running" || run.status === "awaiting" || run.status === "paused";
```

Perbarui komentar baris 26 (`active` = run is running|awaiting|paused).

- [x] **Step 7: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./server exec vitest run`
Expected: PASS. Kalau `queue-durability` gagal saat dijalankan sendirian, jalankan seluruh suite server — test itu memang order-dependent dan tidak ada hubungannya dengan perubahan ini.

- [x] **Step 8: Commit**

```bash
git add server/src/services/settings.ts server/src/worker.ts server/src/queue.ts server/src/routes/runs.ts server/test
git commit -m "feat(server): worker menerima answer; awaiting diakui enqueue/reconcile/delete (SPEC-157)"
```

---

### Task 9: `POST /runs/:id/answer`

Validasi `value` terhadap `pendingAsk.options` adalah batas kepercayaan: tanpa itu klien mana pun bisa menyuntik teks sembarang ke stdin agen.

**Files:**
- Modify: `server/src/routes/runs.ts`
- Modify: `internal/docs/architecture/api-contract.md`
- Test: `server/test/runs.route.test.ts` (atau berkas route run yang sudah ada)

**Interfaces:**
- Consumes: `zAnswer`, `paths.runAnswer`, `type Ask` (Task 6) · `publishControl` (sudah ada, `runs.ts:17`)
- Produces: `POST /api/runs/:id/answer` → `202 { accepted: true }` · `404` · `409` · `400`

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/runs-control.test.ts`, yang sudah punya `app`/`resetDb`/`makeRun` di puncaknya. Ikuti gayanya: route test menegakkan **kode status**, bukan isi pesan Redis — bahwa `{type:"answer"}` benar-benar sampai ke runner sudah dibuktikan test worker di Task 8.

```ts
describe("POST /runs/:id/answer (SPEC-157)", () => {
  const ASK = { question: "q", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], default: "a" };
  const answer = (id: string, value: unknown) =>
    app.inject({ method: "POST", url: `/api/runs/${id}/answer`, payload: { value } });

  it("202 saat value ada di menu", async () => {
    await makeRun({ id: "RUN-AW-1", projectId: "p1", status: "awaiting", pendingAsk: ASK });
    const r = await answer("RUN-AW-1", "b");
    expect(r.statusCode).toBe(202);
    expect(r.json().accepted).toBe(true);
  });

  it("404 saat run tidak ada", async () => expect((await answer("RUN-hantu", "a")).statusCode).toBe(404));

  it("409 saat run tidak sedang menunggu", async () => {
    await makeRun({ id: "RUN-AW-2", projectId: "p1", status: "running" });
    expect((await answer("RUN-AW-2", "a")).statusCode).toBe(409);
  });

  // Run `awaiting` tanpa pendingAsk adalah baris yang tak konsisten — jangan teruskan apa pun.
  it("409 saat awaiting tapi pendingAsk kosong", async () => {
    await makeRun({ id: "RUN-AW-3", projectId: "p1", status: "awaiting" });
    expect((await answer("RUN-AW-3", "a")).statusCode).toBe(409);
  });

  // Batas kepercayaan: value di luar menu tidak boleh sampai ke stdin agen.
  it("400 saat value bukan salah satu option", async () => {
    await makeRun({ id: "RUN-AW-4", projectId: "p1", status: "awaiting", pendingAsk: ASK });
    expect((await answer("RUN-AW-4", "z")).statusCode).toBe(400);
  });

  it("400 saat body tidak sah", async () => {
    await makeRun({ id: "RUN-AW-5", projectId: "p1", status: "awaiting", pendingAsk: ASK });
    expect((await answer("RUN-AW-5", "")).statusCode).toBe(400);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./server exec vitest run test/runs-control.test.ts`
Expected: FAIL — 404 pada setiap kasus (route belum ada).

- [x] **Step 3: Implementasi route**

Tambahkan `zAnswer` ke import baris 3 dan `type Ask` ke import `@hanoman/shared`. Sisipkan tepat setelah route `/runs/:id/steer` (setelah baris 190):

```ts
  // Jawab pertanyaan agen (SPEC-157). `safeParse` + validasi terhadap menu, persis seperti
  // steer/control: body cacat → 400, bukan 500.
  app.post("/runs/:id/answer", async (req, reply) => {
    const parsed = zAnswer.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid value" });
    const { id } = req.params as { id: string };
    const run = await prisma.run.findUnique({ where: { id } });
    if (!run) return reply.code(404).send({ error: "not found" });
    if (run.status !== "awaiting" || !run.pendingAsk)
      return reply.code(409).send({ error: `run "${id}" tidak sedang menunggu jawaban` });
    // Batas kepercayaan: hanya `value` yang ditawarkan agen boleh mendarat di stdin-nya.
    const ask = run.pendingAsk as unknown as Ask;
    if (!ask.options.some((o) => o.value === parsed.data.value))
      return reply.code(400).send({ error: `pilihan "${parsed.data.value}" tidak ada di pertanyaan run ini` });
    await publishControl(id, { type: "answer", value: parsed.data.value });
    return reply.code(202).send({ accepted: true });
  });
```

- [x] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./server exec vitest run test/runs-control.test.ts`
Expected: PASS (6 test baru + 4 test control lama).

- [x] **Step 5: Dokumentasikan kontrak**

Tambahkan `POST /runs/:id/answer` ke `internal/docs/architecture/api-contract.md` sebaris dengan `/steer` dan `/control`: body `{ value }`, respons `202 { accepted }`, error `400` (body/value tak sah), `404`, `409` (run tidak `awaiting`).

Verifikasi guardrail: `node cli/dist/hanoman.js docs verify --block-if-stale --json` → exit 0.

- [x] **Step 6: Commit**

```bash
git add server/src/routes/runs.ts server/test internal/docs/architecture/api-contract.md
git commit -m "feat(server): POST /runs/:id/answer dengan validasi menu (SPEC-157)"
```

---

### Task 10: Tombol pilihan di dashboard

**Files:**
- Modify: `src/src/ds/components/feedback.tsx:83-95` (`STATUS`)
- Modify: `src/src/api/client.ts` (`api.runAnswer`, `RunLiveEvent`)
- Modify: `src/src/screens/RunsScreen.tsx` (`RunAsk`, gating `RunControls`, `RunDetail`)
- Test: `src/test/run-ask.test.tsx`

**Interfaces:**
- Consumes: `paths.runAnswer`, `type Ask` (Task 6) · `Run.pendingAsk` (Task 7)
- Produces: `api.runAnswer(id, value): Promise<{accepted:boolean}>` · komponen `RunAsk`

**Berkas ini sedang disunting sesi lain.** `git status` menunjukkan `src/src/ds/**` dan `src/src/screens/**` sudah termodifikasi. Jangan `git add -A`; stage hanya berkas yang tertulis di step Commit, dan jangan sentuh perubahan yang bukan milikmu.

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/run-ask.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const runAnswer = vi.fn(async (_id: string, _value: string) => ({ accepted: true }));

vi.mock("../src/api/client", () => ({
  api: {
    runAnswer: (id: string, value: string) => runAnswer(id, value),
    runControl: vi.fn(async () => ({ accepted: true })),
    runCommand: vi.fn(async () => ({ lines: [] })),
    runChanges: vi.fn(async () => ({ base: null, head: null, commits: [], files: [] })),
  },
  subscribeRun: vi.fn(() => () => {}),
  ApiError: class extends Error {},
}));
import { RunsScreen } from "../src/screens/RunsScreen";

const ASK = {
  question: '"Orang" di sini siapa?',
  options: [
    { value: "pasien", label: "Pasien", detail: "Satu item katalog dibeli untuk >1 pasien." },
    { value: "pembayar", label: "Pembayar" },
  ],
  default: "pasien",
};
const RUN = {
  id: "RUN-1", projectId: "arta", specId: "SPEC-156", kind: "feature", status: "awaiting",
  trigger: "manual", triggerDetail: "", phases: [], plan: [], log: [],
  worktree: ".worktrees/run-1", branchFrom: "main", branchTo: "hanoman/run-1",
  baseSha: null, headSha: null, model: "", tokensIn: "—", tokensOut: "—", cost: "$0.00", progress: 0,
  createdAt: "2026-07-10T00:00:00.000Z", finishedAt: null, pendingAsk: ASK,
  project: "arta", spec: "SPEC-156", title: "Multiple Invoice", phase: null,
};

describe("tombol keputusan untuk run awaiting (SPEC-157)", () => {
  beforeEach(() => runAnswer.mockClear());

  it("menampilkan pertanyaan, label, dan detail", () => {
    render(<RunsScreen runs={[RUN] as never[]} />);
    expect(screen.getByText(ASK.question)).toBeTruthy();
    expect(screen.getByText("Pasien")).toBeTruthy();
    expect(screen.getByText("Pembayar")).toBeTruthy();
    expect(screen.getByText(/Satu item katalog/)).toBeTruthy();
  });

  it("klik tombol mengirim value-nya, bukan label-nya", () => {
    render(<RunsScreen runs={[RUN] as never[]} />);
    fireEvent.click(screen.getByText("Pembayar"));
    expect(runAnswer).toHaveBeenCalledWith("RUN-1", "pembayar");
  });

  // Teks bebas tidak menjawab: pesan steer baru dikuras SETELAH fase selesai, padahal fase
  // itu sedang diblokir menunggu. Kotak yang tampak bekerja tapi diam = jebakan.
  it("menyembunyikan kotak steer dan tombol Resume saat awaiting", () => {
    render(<RunsScreen runs={[RUN] as never[]} />);
    expect(screen.queryByPlaceholderText(/ketik perintah/)).toBeNull();
    expect(screen.queryByText("Resume")).toBeNull();
    expect(screen.getByText("Stop")).toBeTruthy();
  });

  it("run running tidak menampilkan tombol keputusan, dan kotak steer kembali", () => {
    render(<RunsScreen runs={[{ ...RUN, status: "running", pendingAsk: null }] as never[]} />);
    expect(screen.queryByText(ASK.question)).toBeNull();
    expect(screen.getByPlaceholderText(/ketik perintah/)).toBeTruthy();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./src exec vitest run test/run-ask.test.tsx`
Expected: FAIL — pertanyaan tidak dirender.

- [x] **Step 3: `StatusPill` varian `awaiting`**

Di `src/src/ds/components/feedback.tsx`, sisipkan setelah baris `running:` (baris 87):

```ts
  awaiting: { label: "Menunggu keputusan", color: "var(--amber-600)", bg: "var(--status-warn-tint)", pulse: true },
```

`pulse: true` — prosesnya hidup dan sedang menunggumu, tidak diam seperti `paused`.

- [x] **Step 4: `api.runAnswer` + event SSE**

Di `src/src/api/client.ts`, setelah `runSteer` (baris 41):

```ts
  runAnswer: (id: string, value: string) =>
    j<{ accepted: boolean }>(paths.runAnswer(id), { method: "POST", ...body({ value }) }),
```

Tambahkan varian `ask` ke `RunLiveEvent` (baris 64-68) supaya tombol muncul lewat SSE tanpa polling:

```ts
export type RunLiveEvent =
  | { kind: "log"; line: { t: string; s: string } }
  | { kind: "status"; status: string }
  | { kind: "phase"; name: string; state: string }
  | { kind: "ask"; ask: Ask | null }
  | { kind: "cost"; tokensIn: number; tokensOut: number; costUsd: number };
```

Tambahkan `type Ask` ke import baris 1. Kalau reducer run (`src/src/…/run-reduce.ts`, lihat `src/test/run-reduce.test.ts`) melakukan pencocokan lengkap atas `kind`, tangani `ask` di sana dengan menyetel `pendingAsk`.

- [x] **Step 5: Komponen `RunAsk`**

Di `src/src/screens/RunsScreen.tsx`, sisipkan tepat sebelum `function RunDetail` (baris 342):

```tsx
// Run `awaiting`: proses claude hidup dan terblokir menunggu satu keputusan. Satu tombol per
// opsi; `value` yang dikirim, bukan label. Tak ada opsi yang cocok → Stop, perbaiki brief, Retry.
function RunAsk({ run }: { run: RunVM }) {
  // `useState` mendahului early-return: hook tidak boleh dipanggil bersyarat.
  const [sending, setSending] = React.useState(false);
  const ask = run.pendingAsk;
  if (!ask) return null;
  const answer = (value: string) => async () => {
    if (sending) return;
    setSending(true);
    try { await api.runAnswer(run.id, value); } finally { setSending(false); }
  };
  return (
    <Card padding={20}>
      <div className="hn-eyebrow" style={{ marginBottom: 8 }}>Menunggu keputusanmu</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--text-strong)", marginBottom: 16 }}>
        {ask.question}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {ask.options.map((o) => (
          <div key={o.value} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <Button size="sm" variant={o.value === ask.default ? "primary" : "secondary"} disabled={sending} onClick={answer(o.value)}>
              {o.label}
            </Button>
            {o.detail && <div style={{ fontSize: 12, color: "var(--text-muted)", paddingTop: 6 }}>{o.detail}</div>}
          </div>
        ))}
      </div>
    </Card>
  );
}
```

- [x] **Step 6: Pasang di `RunDetail` dan sesuaikan `RunControls`**

Ganti baris 383-384 `RunDetail` menjadi:

```tsx
      {run.status === "awaiting" && <RunAsk run={run} />}
      {(run.status === "running" || run.status === "awaiting" || run.status === "paused") && <RunControls run={run} />}
      {run.status === "failed" && <RunRetry run={run} />}
```

Di `RunControls`, satu-satunya yang berubah adalah kotak teks. Blok Pause/Resume **tidak disentuh**: ia sudah `run.status === "paused" ? Resume : Pause`, dan `awaiting !== "paused"` — jadi Resume sudah otomatis tak muncul dan Pause sudah otomatis muncul. Jangan tambahkan cabang apa pun di sana.

Ganti baris 311-319 (dari `return (` sampai tombol `Kirim`) menjadi:

```tsx
  // Saat awaiting, teks bebas TIDAK menjawab: pesan steer baru dikuras setelah fase selesai,
  // sedangkan fase itu justru sedang diblokir menunggu jawaban. Kotak yang tampak bekerja tapi
  // diam adalah jebakan — sembunyikan, sisakan tombol keputusan di kartu RunAsk.
  const awaiting = run.status === "awaiting";
  return (
    <Card padding={14}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {awaiting ? (
          <div style={{ flex: 1, fontSize: 12, color: "var(--text-muted)" }}>Pilih salah satu di atas untuk melanjutkan run.</div>
        ) : (
          <>
            <input value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void send(); }}
              placeholder="ketik perintah / arahan untuk run… (steer, pause, resume, stop, docs <path>)"
              style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 12, padding: "8px 10px",
                border: "1px solid var(--border-hair)", borderRadius: "var(--radius-md)", background: "var(--surface-code)", color: "var(--term-fg)" }} />
            <Button size="sm" leftIcon="send" onClick={() => void send()}>Kirim</Button>
          </>
        )}
```

Sisanya (blok Pause/Resume, Stop, penutup `</div></Card>`) tetap apa adanya.

- [x] **Step 7: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./src exec vitest run && pnpm --filter ./src exec tsc --noEmit`
Expected: PASS — 4 test baru + `run-retry`, `run-poll`, `project-detail` tetap hijau.

- [x] **Step 8: Commit**

```bash
git add src/src/ds/components/feedback.tsx src/src/api/client.ts src/src/screens/RunsScreen.tsx src/test/run-ask.test.tsx
git commit -m "feat(ui): tombol keputusan untuk run awaiting (SPEC-157)"
```

---

### Task 11: Verifikasi end-to-end di local

Unit test tidak membuktikan run benar-benar berhenti dan melanjutkan. CLAUDE.md menuntut API-nya diuji nyata.

**Files:** tidak ada (verifikasi saja) · Modify: `docs/superpowers/plans/2026-07-10-hanoman-agent-ask-human-decision-spec-157.md` (centang checklist)

- [x] **Step 1: Seluruh suite hijau**

Run: `pnpm test`
Expected: PASS di `shared`, `server`, `src`, `runner`, `cli`.
Kalau `queue-durability` gagal, jalankan ulang seluruh suite server — ia order-dependent dan bukan akibat perubahan ini.

- [x] **Step 2: Guardrail Source of Truth hijau**

```bash
pnpm build && node cli/dist/hanoman.js docs verify --block-if-stale --json
```
Expected: exit 0.

- [x] **Step 3: Boot server + worker**

```bash
pnpm dev
```
Tunggu `worker up · queue hanoman-runs`.

- [x] **Step 4: `awaiting` bisa dijawab lewat API**

Tanpa run nyata: sisipkan baris uji langsung ke DB dev, lalu tembak route-nya.

```bash
docker exec hanoman-db-1 psql -U hanoman -d hanoman -c "
insert into \"Run\" (id,\"projectId\",kind,status,trigger,\"triggerDetail\",phases,plan,log,worktree,\"branchFrom\",\"branchTo\",model,\"tokensIn\",\"tokensOut\",cost,progress,\"pendingAsk\")
select 'RUN-ASK-TEST', id, 'feature','awaiting','manual','', '[]','[]','[]','.worktrees/x','main','x','','—','—','\$0.00',0,
'{\"question\":\"q\",\"options\":[{\"value\":\"a\",\"label\":\"A\"},{\"value\":\"b\",\"label\":\"B\"}],\"default\":\"a\"}'
from \"Project\" limit 1;"

curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/api/runs/RUN-ASK-TEST/answer -H 'content-type: application/json' -d '{"value":"z"}'   # 400
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/api/runs/RUN-ASK-TEST/answer -H 'content-type: application/json' -d '{"value":"b"}'   # 202
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/api/runs/RUN-HANTU/answer   -H 'content-type: application/json' -d '{"value":"b"}'   # 404
```

Expected: `400`, `202`, `404` — persis dalam urutan itu.

Bersihkan:
```bash
docker exec hanoman-db-1 psql -U hanoman -d hanoman -c "delete from \"Run\" where id='RUN-ASK-TEST';"
```

- [ ] **Step 5: Run nyata berhenti, menunggu, lalu lanjut**

Jalankan satu run `feature` dari dashboard atas sebuah backlog item yang **sengaja ambigu** (mis. objective "pecah invoice untuk treatment yang butuh lebih dari 2 orang" — brief RUN-90012 yang memicu SPEC-157 ini).

Expected, berurutan:
1. `StatusPill` berubah menjadi **Menunggu keputusan** (kuning, berdenyut).
2. Kartu pertanyaan muncul dengan ≥2 tombol; kotak steer dan Resume hilang.
3. `docker exec hanoman-db-1 psql -U hanoman -d hanoman -c "select status, \"pendingAsk\" from \"Run\" order by id desc limit 1;"` menunjukkan `awaiting` + JSON ask.
4. Klik satu tombol → status kembali `running`, `pendingAsk` `NULL`, dan log run memuat baris `» jawaban: <label>`.
5. Run selesai `done`.

**Kalau ada yang merah, perbaiki dulu sampai hijau sebelum menutup task ini.**

- [ ] **Step 6: Uji jalur timeout**

Setel `askTimeoutMin: 0` lewat dashboard Settings (atau `PUT /api/settings`), jalankan ulang run yang sama.
Expected: run **tidak pernah** masuk `awaiting`; log memuat baris `✗ run berjalan tanpa penunggu — memakai pilihan agen: <label>`; run selesai `done`.
Kembalikan `askTimeoutMin` ke `30`.

- [ ] **Step 7: Centang seluruh checklist plan ini dan commit**

```bash
git add docs/superpowers/plans/2026-07-10-hanoman-agent-ask-human-decision-spec-157.md
git commit -m "docs: centang checklist SPEC-157"
```
