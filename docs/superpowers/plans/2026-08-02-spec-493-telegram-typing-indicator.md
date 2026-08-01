# SPEC-493 — Indikator typing Telegram menggantikan pesan progress · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menghapus kedua pesan teks `gateway-progress` dari chat Telegram dan menggantinya dengan indikator "typing…" bawaan Telegram yang dinyalakan, di-refresh, dan di-arm ulang dari **loop `getUpdates` yang sudah ada**.

**Architecture:** `TelegramApiClient` mendapat `sendChatAction`. Satu kelas baru `TelegramTypingIndicator` memegang seluruh state typing in-memory (throttle + cooldown per chat) dan **tak pernah melempar**. `TelegramStore.chatsAwaitingReply()` menurunkan "chat mana yang masih menunggu" dari `TelegramUpdate.state` + `TelegramOutbox.kind`. Loop gateway memanggilnya tiap iterasi, me-refresh typing, lalu menurunkan timeout `getUpdates` ke 4 detik saat ada pekerjaan (25 detik saat idle) — **nol timer baru** (ADR-0024).

**Tech Stack:** TypeScript strict · Node 20 · Fastify · Prisma 6 (SQLite) · vitest.

Spec: [`docs/superpowers/specs/2026-08-02-spec-493-telegram-typing-indicator-design.md`](../specs/2026-08-02-spec-493-telegram-typing-indicator-design.md)

## Global Constraints

- **ADR-0024 utuh:** dilarang menambah `setInterval`, `setTimeout` berulang, scheduler, worker, atau task terpisah. Satu-satunya irama adalah loop `getUpdates` yang sudah ada.
- **Tanpa migration**, tanpa perubahan `server/prisma/schema.prisma`.
- **Tanpa endpoint API baru** dan **tanpa field setting baru** — `Setting.telegram.progress` sudah cukup. `shared/src/telegram.ts` **tidak disentuh** (SPEC-492 sedang menggarapnya di worktree tetangga).
- **Kegagalan `sendChatAction` TIDAK BOLEH** mengubah state `TelegramUpdate` maupun `TelegramOutbox`, dan tak boleh menggagalkan pengiriman balasan.
- **Dilarang `getUpdates` dengan `timeout: 0`** — itu busy-poll dan gampang kena 429.
- Kind `gateway-failure` **TETAP** pesan teks; hanya `gateway-progress` yang dihapus.
- Nilai tetap yang wajib dipakai apa adanya: poll aktif **4 detik**, poll idle **25 detik**, throttle refresh **3.000 ms**, cooldown dasar **5.000 ms**, pagar cooldown **1.000–300.000 ms**, umur maksimum menunggu **600.000 ms**.
- Semua test server dijalankan dengan `--no-file-parallelism` **dan** `TEST_DATABASE_URL` sendiri (mesin ini menjalankan beberapa sesi).

**Perintah test baku untuk seluruh plan ini** (salin apa adanya, ganti daftar berkasnya):

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-493
export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism --dir server server/test/<berkas>.test.ts
```

> `env -u NODE_ENV` wajib: shell mesin ini menunjuk `NODE_ENV=production` dan itu membuat test gagal palsu massal.
> `TEST_DATABASE_URL` wajib: tanpa itu run tetangga menghapus `~/.hanoman/hanoman.test.db` di tengah run ini.

---

## File Structure

| Berkas | Tanggung jawab |
| --- | --- |
| `server/src/services/telegram/client.ts` | **Modify** — `sendChatAction` + `retryAfter` pada `TelegramApiError` |
| `server/src/services/telegram/protocol.ts` | **Modify** — kosakata kind (`TELEGRAM_GATEWAY_FAILURE_KIND`, `TELEGRAM_FINAL_REPLY_KINDS`) |
| `server/src/services/telegram/typing.ts` | **Create** — `TelegramTypingIndicator`, konstanta, `pollTimeoutFor`, `clampTypingCooldown` |
| `server/src/services/telegram/store.ts` | **Modify** — `chatsAwaitingReply(since)` |
| `server/src/services/telegram/gateway.ts` | **Modify** — hapus `gateway-progress`, arm typing, loop adaptif |
| `server/test/telegram-client.test.ts` | **Modify** — kontrak `sendChatAction` + `retryAfter` |
| `server/test/telegram-store.test.ts` | **Modify** — kontrak `chatsAwaitingReply` |
| `server/test/telegram-typing.test.ts` | **Create** — kontrak indikator |
| `server/test/telegram-gateway.test.ts` | **Modify** — typing di gateway, senyap saat `progress:false`, `pollTimeoutFor` |
| `server/test/telegram-e2e.test.ts` | **Modify** — assertion pesan `Diterima.` dibuang |
| `internal/docs/adr/0104-telegram-typing-indicator-long-poll-adaptif.md` | **Create** — ADR |
| `internal/docs/README.md` · `internal/docs/adr/README.md` | **Modify** — tautan ADR-0104 |
| `internal/docs/architecture/api-contract.md` | **Modify** — paragraf outbox gateway |
| `internal/skills/hanoman/SKILL.md` | **Modify** — butir Telegram |

---

### Task 1: `sendChatAction` + `retry_after` yang bisa dibaca

**Files:**
- Modify: `server/src/services/telegram/client.ts:34-83` (envelope + `TelegramApiError` + `call`), sisipkan method sesudah `sendMessage` (`:101-111`)
- Test: `server/test/telegram-client.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
  - `TelegramChatAction = "typing"` (type export dari `client.ts`)
  - `TelegramApiClient.sendChatAction(chatId: string, action?: TelegramChatAction): Promise<boolean>`
  - `TelegramApiError.retryAfter?: number` — **detik**, bukan milidetik

**Kenapa `retryAfter` masuk di task ini:** Telegram mengirim 429 sebagai **HTTP 429** dengan `parameters.retry_after` di badan JSON, sementara `call()` hari ini melempar di `if (!response.ok)` **sebelum** badan itu dibaca. Tanpa perbaikan ini, cooldown di Task 3 akan selamanya memakai nilai default dan test-nya tetap hijau — kegagalan senyap.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `server/test/telegram-client.test.ts`, di dalam `describe("TelegramApiClient fake contract (SPEC-476)", …)`, tepat sesudah test `"sends and edits plain text without parse_mode"`:

```ts
  it("arms the Telegram typing indicator through sendChatAction (SPEC-493)", async () => {
    const { client, calls } = fakeClient([{ ok: true, result: true }]);
    expect(await client.sendChatAction("42", "typing")).toBe(true);
    expect(calls[0]!.url).toMatch(/\/sendChatAction$/);
    expect(calls[0]!.body).toEqual({ chat_id: "42", action: "typing" });
  });

  it("defaults the chat action to typing (SPEC-493)", async () => {
    const { client, calls } = fakeClient([{ ok: true, result: true }]);
    await client.sendChatAction("42");
    expect(calls[0]!.body).toEqual({ chat_id: "42", action: "typing" });
  });

  it("keeps retry_after readable when Telegram answers HTTP 429 (SPEC-493)", async () => {
    const transport: TelegramTransport = async () => new Response(JSON.stringify({
      ok: false, error_code: 429,
      description: "Too Many Requests: retry after 7",
      parameters: { retry_after: 7 },
    }), { status: 429, headers: { "content-type": "application/json" } });
    const client = new TelegramApiClient("123456:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz", transport);
    await expect(client.sendChatAction("42", "typing")).rejects.toMatchObject({
      name: "TelegramApiError", code: 429, retryAfter: 7,
    });
  });

  it("survives a non-JSON error body without losing the status code (SPEC-493)", async () => {
    const transport: TelegramTransport = async () => new Response("<html>502</html>", { status: 502 });
    const client = new TelegramApiClient("123456:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz", transport);
    await expect(client.sendChatAction("42", "typing")).rejects.toMatchObject({
      name: "TelegramApiError", code: 502, retryAfter: undefined,
    });
  });
```

- [ ] **Step 2: Jalankan test dan pastikan GAGAL**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-493
export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism --dir server server/test/telegram-client.test.ts
```

Harapan: GAGAL — `client.sendChatAction is not a function` pada tiga test pertama.

- [ ] **Step 3: Implementasi minimal**

Di `server/src/services/telegram/client.ts`, ganti tipe envelope (baris 34-39) menjadi:

```ts
type TelegramEnvelope<T> = {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
};

/** SPEC-493 · gateway hanoman tak pernah mengunggah berkas, jadi hanya satu aksi yang hidup. */
export type TelegramChatAction = "typing";
```

Ganti `TelegramApiError` (baris 41-46) menjadi:

```ts
export class TelegramApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly code: number | undefined,
    message: string,
    /** SPEC-493 · DETIK, dari `parameters.retry_after` Telegram. Dipakai cooldown typing. */
    public readonly retryAfter?: number,
  ) {
    super(`Telegram ${method} gagal${code ? ` (${code})` : ""}: ${message}`);
    this.name = "TelegramApiError";
  }
}
```

Ganti cabang `!response.ok` (baris 72) menjadi:

```ts
    if (!response.ok) {
      // SPEC-493 · `retry_after` hidup di BADAN respons 429; melempar sebelum membacanya membuat
      // nilai itu tak pernah punya pembaca. Badan non-JSON tetap sah — `catch` mengembalikan null.
      const failed = await response.json().catch(() => null) as TelegramEnvelope<T> | null;
      throw new TelegramApiError(method, response.status, `HTTP ${response.status}`, failed?.parameters?.retry_after);
    }
```

Ganti cabang `!envelope.ok` (baris 79-81) menjadi:

```ts
    if (!envelope.ok || envelope.result === undefined) {
      throw new TelegramApiError(
        method, envelope.error_code, this.safe(envelope.description ?? "respons tidak valid"),
        envelope.parameters?.retry_after,
      );
    }
```

Sisipkan method sesudah `sendMessage` (sesudah baris 111):

```ts
  /**
   * SPEC-493 · indikator "typing…". Argumennya posisional (beda dari tetangganya) sesuai kontrak
   * yang diminta. Telegram TAK punya API stop-typing: statusnya padam sendiri ~5 detik sesudah
   * panggilan terakhir, dan pesan masuk apa pun langsung menghapusnya.
   */
  sendChatAction(chatId: string, action: TelegramChatAction = "typing"): Promise<boolean> {
    return this.call("sendChatAction", { chat_id: chatId, action });
  }
```

- [ ] **Step 4: Jalankan test dan pastikan LULUS**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-493
export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism --dir server server/test/telegram-client.test.ts
```

Harapan: LULUS, semua test di berkas itu (termasuk test lama `"throws typed API errors without leaking the bot token"` yang **tak boleh** berubah).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/telegram/client.ts server/test/telegram-client.test.ts
git commit -m "feat(493): sendChatAction + retry_after yang bisa dibaca dari respons 429"
```

---

### Task 2: `chatsAwaitingReply` — siapa yang masih menunggu

**Files:**
- Modify: `server/src/services/telegram/protocol.ts` (tambah konstanta di akhir berkas)
- Modify: `server/src/services/telegram/store.ts` (method baru sesudah `markUpdateUncertain`, baris 148-152)
- Test: `server/test/telegram-store.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
  - `TELEGRAM_GATEWAY_FAILURE_KIND = "gateway-failure"` (dari `protocol.ts`)
  - `TELEGRAM_FINAL_REPLY_KINDS: ReadonlySet<string>` (dari `protocol.ts`)
  - `TelegramStore.chatsAwaitingReply(since: Date): Promise<string[]>` — daftar `chatId` unik

**Kenapa konstanta duduk di `protocol.ts`:** dua pemakainya adalah `gateway.ts` **dan** `store.ts`. Menaruhnya di `gateway.ts` memaksa `store.ts` meng-import `gateway.ts`, yang sudah meng-import `store.ts` — siklus. `protocol.ts` nol dependensi internal, jadi ia modul daun yang aman.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `server/test/telegram-store.test.ts` (setelah `describe` terakhir):

```ts
describe("TelegramStore typing liveness (SPEC-493)", () => {
  const dispatched = async (updateId: number, chatId: string) => {
    await store.recordUpdate({ updateId, chatId, userId: "7", kind: "text", digest: String(updateId).repeat(8).slice(0, 64) });
    await store.claimUpdate(updateId);
    await store.markDispatched(updateId);
  };
  const since = () => new Date(Date.now() - 600_000);

  it("lists a chat whose dispatched update has no reply at all", async () => {
    await dispatched(17, "42");
    expect(await store.chatsAwaitingReply(since())).toEqual(["42"]);
  });

  it("keeps listing while only a non-final progress reply is queued", async () => {
    await dispatched(17, "42");
    await store.enqueueReply({ chatId: "42", updateId: 17, kind: "progress", text: "sebentar" });
    expect(await store.chatsAwaitingReply(since())).toEqual(["42"]);
  });

  it("drops the chat as soon as a final reply is enqueued", async () => {
    await dispatched(17, "42");
    await store.enqueueReply({ chatId: "42", updateId: 17, kind: "final", text: "selesai" });
    expect(await store.chatsAwaitingReply(since())).toEqual([]);
  });

  it("treats decision, confirmation, failure and gateway-failure as final", async () => {
    const kinds = ["decision", "confirmation", "failure", "gateway-failure"];
    for (const [index, kind] of kinds.entries()) {
      const updateId = 100 + index;
      await dispatched(updateId, String(200 + index));
      await store.enqueueReply({ chatId: String(200 + index), updateId, kind, text: kind });
    }
    expect(await store.chatsAwaitingReply(since())).toEqual([]);
  });

  it("ignores updates that are not dispatched, and de-duplicates one chat", async () => {
    await store.recordUpdate({ updateId: 21, chatId: "42", userId: "7", kind: "text", digest: "c".repeat(64) });
    expect(await store.chatsAwaitingReply(since())).toEqual([]);
    await store.claimUpdate(21);
    await store.markDispatched(21);
    await dispatched(22, "42");
    expect(await store.chatsAwaitingReply(since())).toEqual(["42"]);
  });

  it("forgets updates older than the caller's window so typing cannot run forever", async () => {
    await dispatched(17, "42");
    expect(await store.chatsAwaitingReply(new Date(Date.now() + 60_000))).toEqual([]);
  });
});
```

- [ ] **Step 2: Jalankan test dan pastikan GAGAL**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-493
export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism --dir server server/test/telegram-store.test.ts
```

Harapan: GAGAL — `store.chatsAwaitingReply is not a function`.

- [ ] **Step 3: Implementasi minimal**

Tambahkan di **akhir** `server/src/services/telegram/protocol.ts`:

```ts
/**
 * SPEC-491 · amplop yang DIKARANG gateway, di luar `TELEGRAM_REPLY_KINDS`: `dedupeKey` outbox
 * adalah `chat:update:kind`, jadi memakai kind milik session operator akan membuat baris gateway
 * MENELAN reply session untuk update yang sama.
 */
export const TELEGRAM_GATEWAY_FAILURE_KIND = "gateway-failure";

/**
 * SPEC-493 · balasan yang MENGAKHIRI giliran. Sesudahnya typing tak di-arm ulang — Telegram tak
 * punya API stop-typing, jadi cara menghentikannya adalah membiarkan timernya habis. `decision` dan
 * `confirmation` ikut final karena keduanya mengembalikan giliran ke manusia: mengetik "hanoman
 * sedang mengetik" sementara yang ditunggu justru jawaban user adalah kebohongan. Non-final hanya
 * `progress`.
 */
export const TELEGRAM_FINAL_REPLY_KINDS: ReadonlySet<string> = new Set([
  "final", "decision", "failure", "confirmation", TELEGRAM_GATEWAY_FAILURE_KIND,
]);
```

Di `server/src/services/telegram/store.ts`, tambahkan import di baris 3-4:

```ts
import { TELEGRAM_FINAL_REPLY_KINDS } from "./protocol";
```

Sisipkan method sesudah `markUpdateUncertain` (sesudah baris 152):

```ts
  /**
   * SPEC-493 · chat yang masih menunggu jawaban: ada `TelegramUpdate` `dispatched` sesudah `since`
   * yang belum punya baris outbox ber-kind final. Dihitung pada saat **enqueue**, bukan `sent` —
   * baris outbox lahir begitu session operator memanggil `POST /telegram/replies`, dan jarak
   * enqueue→kirim paling banyak satu iterasi loop. Menunggu `sent` akan menahan typing melewati
   * pesan finalnya sendiri.
   *
   * `since` adalah pagar keras: update yang session operatornya mati mengendap `dispatched`
   * SELAMANYA, dan tanpa pagar ini gateway akan mengetik selamanya sekaligus mengunci long-poll
   * di 4 detik selamanya.
   */
  async chatsAwaitingReply(since: Date): Promise<string[]> {
    const pending = await this.db.telegramUpdate.findMany({
      where: { state: "dispatched", chatId: { not: null }, dispatchedAt: { gte: since } },
      select: { updateId: true, chatId: true },
      orderBy: { updateId: "asc" },
    });
    if (!pending.length) return [];
    const answered = new Set((await this.db.telegramOutbox.findMany({
      where: {
        updateId: { in: pending.map((row) => row.updateId) },
        kind: { in: [...TELEGRAM_FINAL_REPLY_KINDS] },
      },
      select: { updateId: true },
    })).map((row) => row.updateId));
    const chats: string[] = [];
    for (const row of pending) {
      if (answered.has(row.updateId) || !row.chatId || chats.includes(row.chatId)) continue;
      chats.push(row.chatId);
    }
    return chats;
  }
```

- [ ] **Step 4: Jalankan test dan pastikan LULUS**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-493
export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism --dir server server/test/telegram-store.test.ts
```

Harapan: LULUS, termasuk seluruh test lama di berkas itu.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/telegram/protocol.ts server/src/services/telegram/store.ts server/test/telegram-store.test.ts
git commit -m "feat(493): chatsAwaitingReply + kosakata kind balasan final"
```

---

### Task 3: `TelegramTypingIndicator` — throttle, cooldown, dan janji tak-pernah-melempar

**Files:**
- Create: `server/src/services/telegram/typing.ts`
- Test: `server/test/telegram-typing.test.ts`

**Interfaces:**
- Consumes: `TelegramApiError.retryAfter` (Task 1)
- Produces:
  - `TYPING_ACTIVE_POLL_SEC = 4` · `TYPING_MIN_INTERVAL_MS = 3_000` · `TYPING_COOLDOWN_BASE_MS = 5_000` · `TYPING_COOLDOWN_MIN_MS = 1_000` · `TYPING_COOLDOWN_MAX_MS = 300_000` · `TYPING_MAX_WAIT_MS = 600_000`
  - `clampTypingCooldown(ms: number): number`
  - `pollTimeoutFor(waiting: number, idle: number): number`
  - `type TelegramTypingSender = { sendChatAction(chatId: string, action: "typing"): Promise<boolean> }`
  - `class TelegramTypingIndicator` dengan `arm(chatId: string): Promise<void>` dan `refresh(chatIds: readonly string[]): Promise<void>`

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/telegram-typing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TelegramApiError } from "../src/services/telegram/client";
import {
  TelegramTypingIndicator, clampTypingCooldown, pollTimeoutFor,
  TYPING_COOLDOWN_MAX_MS, TYPING_COOLDOWN_MIN_MS,
} from "../src/services/telegram/typing";

function harness(options: { enabled?: boolean; fail?: () => unknown } = {}) {
  const calls: string[] = [];
  let clock = 1_000_000;
  const indicator = new TelegramTypingIndicator({
    enabled: options.enabled ?? true,
    now: () => clock,
    client: {
      sendChatAction: async (chatId) => {
        const failure = options.fail?.();
        if (failure) throw failure;
        calls.push(chatId);
        return true;
      },
    },
  });
  return { calls, indicator, advance: (ms: number) => { clock += ms; } };
}

describe("TelegramTypingIndicator (SPEC-493)", () => {
  it("arms immediately and bypasses the refresh throttle", async () => {
    const h = harness();
    await h.indicator.arm("42");
    await h.indicator.arm("42");
    expect(h.calls).toEqual(["42", "42"]);
  });

  it("throttles refresh below the minimum interval and resumes after it", async () => {
    const h = harness();
    await h.indicator.refresh(["42"]);
    h.advance(2_999);
    await h.indicator.refresh(["42"]);
    expect(h.calls).toEqual(["42"]);
    h.advance(1);
    await h.indicator.refresh(["42"]);
    expect(h.calls).toEqual(["42", "42"]);
  });

  it("stays completely silent when the progress flag is off", async () => {
    const h = harness({ enabled: false });
    await h.indicator.arm("42");
    await h.indicator.refresh(["42", "43"]);
    expect(h.calls).toEqual([]);
  });

  it("never throws, whatever sendChatAction does", async () => {
    const h = harness({ fail: () => new Error("boom") });
    await expect(h.indicator.arm("42")).resolves.toBeUndefined();
    await expect(h.indicator.refresh(["42"])).resolves.toBeUndefined();
  });

  it("honours retry_after as the per-chat cooldown", async () => {
    let fail = true;
    const h = harness({ fail: () => (fail ? new TelegramApiError("sendChatAction", 429, "429", 7) : null) });
    await h.indicator.arm("42");
    fail = false;
    h.advance(6_999);
    await h.indicator.arm("42");
    expect(h.calls).toEqual([]);
    h.advance(1);
    await h.indicator.arm("42");
    expect(h.calls).toEqual(["42"]);
  });

  it("backs off exponentially when no retry_after is offered", async () => {
    let fail = true;
    const h = harness({ fail: () => (fail ? new TelegramApiError("sendChatAction", 500, "500") : null) });
    await h.indicator.arm("42");          // gagal → cooldown 5s, berikutnya 10s
    h.advance(5_000);
    await h.indicator.arm("42");          // gagal lagi → cooldown 10s
    fail = false;
    h.advance(9_999);
    await h.indicator.arm("42");
    expect(h.calls).toEqual([]);
    h.advance(1);
    await h.indicator.arm("42");
    expect(h.calls).toEqual(["42"]);
  });

  it("clears the cooldown once a call succeeds", async () => {
    let fail = true;
    const h = harness({ fail: () => (fail ? new TelegramApiError("sendChatAction", 500, "500") : null) });
    await h.indicator.arm("42");
    fail = false;
    h.advance(5_000);
    await h.indicator.arm("42");
    fail = true;
    await h.indicator.arm("42");          // gagal → cooldown kembali ke DASAR 5s, bukan 10s
    fail = false;
    h.advance(4_999);
    await h.indicator.arm("42");
    expect(h.calls).toEqual(["42"]);
    h.advance(1);
    await h.indicator.arm("42");
    expect(h.calls).toEqual(["42", "42"]);
  });

  it("cools down one chat without silencing its neighbour", async () => {
    let fail = true;
    const h = harness({ fail: () => (fail && true ? new TelegramApiError("sendChatAction", 500, "500") : null) });
    await h.indicator.arm("42");
    fail = false;
    await h.indicator.arm("43");
    expect(h.calls).toEqual(["43"]);
  });

  it("clamps every cooldown into the 1s..300s fence", () => {
    expect(clampTypingCooldown(0)).toBe(TYPING_COOLDOWN_MIN_MS);
    expect(clampTypingCooldown(-5)).toBe(TYPING_COOLDOWN_MIN_MS);
    expect(clampTypingCooldown(9_999_999)).toBe(TYPING_COOLDOWN_MAX_MS);
    expect(clampTypingCooldown(42_000)).toBe(42_000);
  });

  it("shortens the long poll only while work is in flight, and never to zero", () => {
    expect(pollTimeoutFor(0, 25)).toBe(25);
    expect(pollTimeoutFor(1, 25)).toBe(4);
    expect(pollTimeoutFor(9, 25)).toBe(4);
    expect(pollTimeoutFor(1, 2)).toBe(2);
    expect(pollTimeoutFor(1, 25)).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Jalankan test dan pastikan GAGAL**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-493
export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism --dir server server/test/telegram-typing.test.ts
```

Harapan: GAGAL — `Failed to resolve import "../src/services/telegram/typing"`.

- [ ] **Step 3: Implementasi minimal**

Buat `server/src/services/telegram/typing.ts`:

```ts
import { TelegramApiError } from "./client";

/**
 * SPEC-493 · umur status typing Telegram ~5 detik dan TIDAK ada API stop-typing. Semua angka di
 * bawah turunan dari fakta itu: poll aktif harus di bawah 5 detik, dan menghentikan indikator =
 * berhenti me-refresh.
 */
export const TYPING_ACTIVE_POLL_SEC = 4;
/** Iterasi loop bisa berulang jauh lebih cepat dari 4 dtk saat update datang beruntun. */
export const TYPING_MIN_INTERVAL_MS = 3_000;
export const TYPING_COOLDOWN_BASE_MS = 5_000;
/** Pagar cooldown, cermin hermes `max(1.0, min(delay, 300.0))`. */
export const TYPING_COOLDOWN_MIN_MS = 1_000;
export const TYPING_COOLDOWN_MAX_MS = 300_000;
/** Umur maksimum sebuah update boleh menahan typing & long-poll pendek. 6× giliran terlama (95 dtk). */
export const TYPING_MAX_WAIT_MS = 600_000;

export const clampTypingCooldown = (ms: number): number =>
  Math.min(TYPING_COOLDOWN_MAX_MS, Math.max(TYPING_COOLDOWN_MIN_MS, Math.round(ms)));

/**
 * Long-poll adaptif: satu-satunya cara memberi denyut ~4 detik TANPA timer baru (ADR-0024).
 * `Math.min` menjaga pemanggil yang menyuntik `idle` kecil (test) tetap bermakna, dan hasilnya
 * tak pernah 0 selama `idle > 0` — `timeout: 0` adalah busy-poll yang dilarang.
 */
export const pollTimeoutFor = (waiting: number, idle: number): number =>
  waiting > 0 ? Math.min(TYPING_ACTIVE_POLL_SEC, idle) : idle;

export type TelegramTypingSender = {
  sendChatAction(chatId: string, action: "typing"): Promise<boolean>;
};

type ChatTypingState = { lastArmedAt: number; cooldownUntil: number; nextDelayMs: number };

/**
 * SPEC-493 · seluruh state typing hidup DI SINI dan hanya di memori: ia kosmetik, jadi ia tak
 * berhak menyentuh jalur at-most-once update/outbox. Konsekuensi yang disengaja — tak satu pun
 * method di kelas ini bisa melempar.
 */
export class TelegramTypingIndicator {
  private readonly state = new Map<string, ChatTypingState>();
  private readonly now: () => number;

  constructor(private readonly deps: {
    client: TelegramTypingSender;
    /** `Setting.telegram.progress`. Mati = benar-benar senyap: nol panggilan API. */
    enabled: boolean;
    now?: () => number;
  }) {
    this.now = deps.now ?? (() => Date.now());
  }

  /** Paksa — MENGABAIKAN throttle. Telegram menghapus status typing tiap ada pesan masuk. */
  async arm(chatId: string): Promise<void> {
    await this.send(chatId, true);
  }

  /** Denyut loop; ter-throttle supaya iterasi cepat beruntun tak jadi banjir panggilan API. */
  async refresh(chatIds: readonly string[]): Promise<void> {
    for (const chatId of chatIds) await this.send(chatId, false);
    this.prune(new Set(chatIds));
  }

  private async send(chatId: string, force: boolean): Promise<void> {
    if (!this.deps.enabled) return;
    const now = this.now();
    const current = this.state.get(chatId);
    if (current && now < current.cooldownUntil) return;
    if (!force && current && now - current.lastArmedAt < TYPING_MIN_INTERVAL_MS) return;
    try {
      await this.deps.client.sendChatAction(chatId, "typing");
      this.state.set(chatId, { lastArmedAt: now, cooldownUntil: 0, nextDelayMs: TYPING_COOLDOWN_BASE_MS });
    } catch (error) {
      // Kegagalan permanen (403 diblokir, 400 chat hilang) ikut jalur yang sama dan mengendap di
      // 300 dtk. Membedakannya dari transien hanya menambah cabang tanpa mengubah keluaran.
      const retryAfterMs = error instanceof TelegramApiError
        && typeof error.retryAfter === "number" && error.retryAfter > 0
        ? error.retryAfter * 1_000
        : null;
      const delay = clampTypingCooldown(retryAfterMs ?? current?.nextDelayMs ?? TYPING_COOLDOWN_BASE_MS);
      this.state.set(chatId, {
        lastArmedAt: current?.lastArmedAt ?? 0,
        cooldownUntil: now + delay,
        nextDelayMs: clampTypingCooldown(delay * 2),
      });
    }
  }

  /** Chat yang sudah lama tak aktif dan tak sedang di-cooldown dibuang agar peta tak tumbuh. */
  private prune(active: ReadonlySet<string>): void {
    const now = this.now();
    for (const [chatId, entry] of this.state) {
      if (active.has(chatId)) continue;
      if (now < entry.cooldownUntil) continue;
      if (now - entry.lastArmedAt <= TYPING_MAX_WAIT_MS) continue;
      this.state.delete(chatId);
    }
  }
}
```

- [ ] **Step 4: Jalankan test dan pastikan LULUS**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-493
export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism --dir server server/test/telegram-typing.test.ts
```

Harapan: LULUS, 11 test.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/telegram/typing.ts server/test/telegram-typing.test.ts
git commit -m "feat(493): TelegramTypingIndicator dengan throttle, cooldown, dan poll adaptif"
```

---

### Task 4: Gateway — hapus pesan progress, pasang typing, jadikan loop adaptif

**Files:**
- Modify: `server/src/services/telegram/gateway.ts` (import & konstanta `:1-16`, `GatewayDeps` `:28-37`, konstruktor `:45`, jalur sukses `:113-129`, `flushOutbox` `:151-185`, `loop` `:200-223`)
- Test: `server/test/telegram-gateway.test.ts`
- Test: `server/test/telegram-e2e.test.ts` (assertion pesan `Diterima.`)

**Interfaces:**
- Consumes: `TelegramTypingIndicator`, `pollTimeoutFor`, `TYPING_MAX_WAIT_MS` (Task 3) · `TelegramStore.chatsAwaitingReply`, `TELEGRAM_FINAL_REPLY_KINDS`, `TELEGRAM_GATEWAY_FAILURE_KIND` (Task 2) · `TelegramApiClient.sendChatAction` (Task 1)
- Produces: `TelegramGatewayClient` bertambah `sendChatAction(chatId: string, action: "typing"): Promise<boolean>` · `GatewayDeps` bertambah `typing?: TelegramTypingIndicator`

- [ ] **Step 1: Tulis test yang gagal**

**(a)** Di `server/test/telegram-gateway.test.ts`, ganti `fakeClient()` (baris 18-33) menjadi:

```ts
function fakeClient(): TelegramGatewayClient & {
  sent: { chatId: string; text: string; replyMarkup?: unknown }[];
  answered: { callbackQueryId: string; text?: string }[];
  actions: string[];
  failAction: boolean;
} {
  const sent: { chatId: string; text: string; replyMarkup?: unknown }[] = [];
  const answered: { callbackQueryId: string; text?: string }[] = [];
  const actions: string[] = [];
  const client = {
    sent, answered, actions, failAction: false,
    getUpdates: async () => [],
    sendMessage: async (input: { chatId: string; text: string; replyMarkup?: unknown }) => {
      sent.push(input);
      return { message_id: sent.length, date: 1, chat: { id: Number(input.chatId), type: "private" }, text: input.text };
    },
    answerCallbackQuery: async (input: { callbackQueryId: string; text?: string }) => { answered.push(input); return true; },
    sendChatAction: async (chatId: string) => {
      if (client.failAction) throw new TelegramApiError("sendChatAction", 429, "429", 5);
      actions.push(chatId);
      return true;
    },
  };
  return client;
}
```

**(b)** Ganti helper `gateway()` (baris 54-67) menjadi:

```ts
function gateway(opts: { rateLimit?: number; progress?: boolean } = {}) {
  const client = fakeClient();
  const dispatch = dispatcher();
  return {
    client, dispatch,
    gateway: new TelegramGateway({
      client, store, dispatcher: dispatch,
      allowedUserIds: new Set(["7"]),
      rateLimit: { limit: opts.rateLimit ?? 20, windowMs: 60_000 },
      exactSecrets: ["123456:BOT_SECRET", "hnm_agt_AGENT_SECRET"],
      progress: opts.progress ?? true,
    }),
  };
}
```

**(c)** Tambahkan `describe` baru di **akhir** `server/test/telegram-gateway.test.ts`:

```ts
describe("TelegramGateway typing indicator (SPEC-493)", () => {
  it("arms typing on dispatch and queues no progress text at all", async () => {
    const x = gateway();
    await x.gateway.processUpdates([message(17)]);
    expect(x.client.actions).toEqual(["42"]);
    expect(await prisma.telegramOutbox.count()).toBe(0);
    expect(x.client.sent).toEqual([]);
  });

  it("re-arms typing after a non-final chunk but lets the timer die after the final one", async () => {
    const x = gateway();
    await x.gateway.processUpdates([message(17)]);
    x.client.actions.length = 0;
    await store.enqueueReply({ chatId: "42", updateId: 17, kind: "progress", text: "sebentar" });
    await x.gateway.flushOutbox();
    expect(x.client.actions).toEqual(["42"]);

    x.client.actions.length = 0;
    await store.enqueueReply({ chatId: "42", updateId: 17, kind: "final", text: "selesai" });
    await x.gateway.flushOutbox();
    expect(x.client.actions).toEqual([]);
  });

  it("keeps typing alive between chunks of one long final reply", async () => {
    const x = gateway();
    await x.gateway.processUpdates([message(17)]);
    x.client.actions.length = 0;
    await store.enqueueReply({ chatId: "42", updateId: 17, kind: "final", text: "x".repeat(9_000) });
    await x.gateway.flushOutbox();
    expect(x.client.sent.length).toBeGreaterThan(1);
    // satu arm per chunk KECUALI chunk terakhir
    expect(x.client.actions).toHaveLength(x.client.sent.length - 1);
  });

  it("stays silent end to end when the progress flag is off", async () => {
    const x = gateway({ progress: false });
    await x.gateway.processUpdates([message(17)]);
    await store.enqueueReply({ chatId: "42", updateId: 17, kind: "progress", text: "sebentar" });
    await x.gateway.flushOutbox();
    expect(x.client.actions).toEqual([]);
    expect(x.client.sent.map((item) => item.text)).toEqual(["sebentar"]);
  });

  it("never lets a failing chat action touch update or outbox state", async () => {
    const x = gateway();
    x.client.failAction = true;
    await x.gateway.processUpdates([message(17)]);
    expect((await prisma.telegramUpdate.findUnique({ where: { updateId: 17 } }))?.state).toBe("dispatched");
    await store.enqueueReply({ chatId: "42", updateId: 17, kind: "progress", text: "sebentar" });
    await x.gateway.flushOutbox();
    expect(x.client.sent.map((item) => item.text)).toEqual(["sebentar"]);
    expect((await prisma.telegramOutbox.findFirst())?.state).toBe("sent");
  });

  it("still reports dispatch failure as readable text, not a vanishing indicator", async () => {
    const client = fakeClient();
    const g = new TelegramGateway({
      client, store,
      dispatcher: { dispatch: async () => { throw new Error("pane hilang"); } },
      allowedUserIds: new Set(["7"]),
      rateLimit: { limit: 20, windowMs: 60_000 }, exactSecrets: [], progress: true,
    });
    await g.processUpdates([message(17)]);
    await g.flushOutbox();
    expect(client.sent[0]!.text).toContain("gagal diteruskan ke sesi operator");
    expect((await prisma.telegramOutbox.findFirst())?.kind).toBe("gateway-failure");
  });
});
```

**(d)** Di `server/test/telegram-e2e.test.ts`, tambahkan `sendChatAction` ke `client` (baris 34-41), sesudah `answerCallbackQuery`:

```ts
  sendChatAction: async () => true,
```

**(e)** Di `server/test/telegram-e2e.test.ts` baris 136-140, ganti blok assertion menjadi:

```ts
    // SPEC-493 · gateway TAK LAGI mengarang pesan teks progress; kehadirannya sekarang berupa
    // indikator "typing…" yang tak meninggalkan jejak di chat.
    expect(sent.map((item) => item.text)).toEqual([
      "Sedang memeriksa.", "Jawaban: status proyek",
    ]);
```

- [ ] **Step 2: Jalankan test dan pastikan GAGAL**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-493
export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism --dir server \
  server/test/telegram-gateway.test.ts server/test/telegram-e2e.test.ts
```

Harapan: GAGAL — `actions` tetap `[]` (gateway belum memanggil `sendChatAction`) dan `telegramOutbox.count()` masih 1 (baris `gateway-progress` masih diantrekan).

- [ ] **Step 3: Implementasi minimal**

Di `server/src/services/telegram/gateway.ts`:

**(a)** Ganti blok import & konstanta (baris 1-16) menjadi:

```ts
import { createHash } from "node:crypto";
import type { TelegramInlineKeyboardMarkup, TelegramMessage, TelegramUpdate } from "./client";
import { TelegramApiError } from "./client";
import {
  TELEGRAM_FINAL_REPLY_KINDS, TELEGRAM_GATEWAY_FAILURE_KIND,
  inboundDigest, parseTelegramUpdate, sanitizeTelegramOutput, splitTelegramText,
  type AcceptedTelegramInput,
} from "./protocol";
import type { TelegramStore } from "./store";
import { telegramRuntimeStatus, updateTelegramRuntimeStatus } from "./runtime";
import { TelegramTypingIndicator, TYPING_MAX_WAIT_MS, pollTimeoutFor } from "./typing";
```

**(b)** Ganti `TelegramGatewayClient` (baris 18-22) menjadi:

```ts
export type TelegramGatewayClient = {
  getUpdates(input: { offset: number; limit: number; timeout: number; signal?: AbortSignal }): Promise<TelegramUpdate[]>;
  sendMessage(input: { chatId: string; text: string; replyMarkup?: TelegramInlineKeyboardMarkup }): Promise<TelegramMessage>;
  answerCallbackQuery(input: { callbackQueryId: string; text?: string }): Promise<boolean>;
  sendChatAction(chatId: string, action: "typing"): Promise<boolean>;
};
```

**(c)** Tambahkan `typing?: TelegramTypingIndicator;` ke `GatewayDeps` (sesudah `pollTimeout?: number;`, baris 36).

**(d)** Ganti konstruktor (baris 41-45) menjadi:

```ts
export class TelegramGateway {
  private abort: AbortController | null = null;
  private loopPromise: Promise<void> | null = null;
  private readonly typing: TelegramTypingIndicator;

  constructor(private readonly deps: GatewayDeps) {
    this.typing = deps.typing ?? new TelegramTypingIndicator({
      client: deps.client,
      enabled: deps.progress,
    });
  }
```

**(e)** Ganti blok progress di jalur sukses (baris 119-128) menjadi:

```ts
      // SPEC-493 · gateway TAK LAGI mengarang pesan teks (ADR-0104, mengamandemen ADR-0096 §5).
      // Kehadirannya sekarang indikator "typing…" yang tak meninggalkan jejak di chat, digerbangi
      // `Setting.telegram.progress` di dalam indikator. `arm` tak pernah melempar, jadi ia tak
      // butuh `catch` sendiri dan tak bisa mengubah dispatch yang SUDAH berhasil jadi kegagalan.
      await this.typing.arm(input.chatId);
```

**(f)** Ganti kind kegagalan (baris 140) dari `GATEWAY_FAILURE_KIND` menjadi `TELEGRAM_GATEWAY_FAILURE_KIND` (konstanta lokal `GATEWAY_PROGRESS_KIND`/`GATEWAY_FAILURE_KIND` **dihapus** oleh langkah (a)).

**(g)** Di `flushOutbox`, ganti badan loop chunk (baris 164-174) menjadi:

```ts
        for (let index = 0; index < chunks.length; index++) {
          const isLast = index === chunks.length - 1;
          const replyMarkup = isLast && confirmation ? {
            inline_keyboard: [[
              { text: "Lanjutkan", callback_data: `tgcf:${confirmation.callbackToken}:approve` },
              { text: "Batalkan", callback_data: `tgcf:${confirmation.callbackToken}:deny` },
            ]],
          } : undefined;
          const message = await this.deps.client.sendMessage({ chatId: row.chatId, text: chunks[index]!, replyMarkup });
          messageId = message.message_id;
          // SPEC-493 · Telegram MENGHAPUS status typing begitu ada pesan masuk, jadi tiap chunk
          // harus mengembalikannya — kecuali chunk terakhir dari balasan final: di sana giliran
          // memang sudah selesai dan Telegram tak punya API stop-typing, jadi timernya dibiarkan
          // habis sendiri.
          if (!(isLast && TELEGRAM_FINAL_REPLY_KINDS.has(row.kind))) await this.typing.arm(row.chatId);
        }
```

**(h)** Ganti `loop` (baris 200-223) menjadi:

```ts
  private async loop(signal: AbortSignal): Promise<void> {
    const idlePollTimeout = this.deps.pollTimeout ?? 25;
    while (!signal.aborted) {
      try {
        // SPEC-493 · ADR-0104 · long-poll adaptif = denyut typing TANPA timer baru (ADR-0024).
        // Refresh mendahului `getUpdates` supaya indikator sudah menyala saat poll mulai memblokir;
        // dengan pekerjaan in-flight timeout turun ke 4 dtk, jadi tiap iterasi jadi tick alami
        // untuk typing SEKALIGUS `flushOutbox()` — jeda kirim balasan 10-12 dtk ikut hilang.
        const waiting = await this.deps.store.chatsAwaitingReply(new Date(Date.now() - TYPING_MAX_WAIT_MS));
        await this.typing.refresh(waiting);
        const updates = await this.deps.client.getUpdates({
          offset: await this.deps.store.offset(), limit: 100,
          timeout: pollTimeoutFor(waiting.length, idlePollTimeout), signal,
        });
        // SPEC-491 · poll yang berhasil MEMULIHKAN status. Tanpa ini satu kedip jaringan
        // meninggalkan `readiness: "error"` selamanya — hanya `processUpdate` yang sukses yang
        // membersihkan `lastError`, dan itu tak terjadi pada poll kosong (kasus lazim).
        if (telegramRuntimeStatus().readiness === "error") {
          updateTelegramRuntimeStatus({ running: true, readiness: "running", lastError: null });
        }
        // `finally`: outbox tetap harus terkuras walau pemrosesan batch melempar — di dalamnya
        // ada justru pemberitahuan kegagalan yang harus sampai ke operator.
        try { await this.processUpdates(updates); } finally { await this.flushOutbox(); }
      } catch (error) {
        if (signal.aborted) return;
        const message = sanitizeTelegramOutput((error as Error).message, this.deps.exactSecrets).slice(0, 500);
        updateTelegramRuntimeStatus({ running: false, readiness: "error", lastError: message });
        if (error instanceof TelegramApiError && error.code === 409) return;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  }
```

> `setTimeout` 1 detik di cabang `catch` **sudah ada sebelum spec ini** — ia backoff satu kali di dalam loop, bukan scheduler. Jangan hitung sebagai timer baru.

- [ ] **Step 4: Jalankan test dan pastikan LULUS**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-493
export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism --dir server \
  server/test/telegram-gateway.test.ts server/test/telegram-e2e.test.ts
```

Harapan: LULUS, termasuk seluruh test lama kedua berkas (`gateway-failure`, lifecycle, konfirmasi inline).

- [ ] **Step 5: Typecheck paket server**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-493
pnpm --filter ./server typecheck
```

Harapan: keluar tanpa error.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/telegram/gateway.ts server/test/telegram-gateway.test.ts server/test/telegram-e2e.test.ts
git commit -m "feat(493): gateway memakai indikator typing dan long-poll adaptif, pesan progress dihapus"
```

---

### Task 5: Docs — ADR-0104 + tiga permukaan yang tersentuh

**Files:**
- Create: `internal/docs/adr/0104-telegram-typing-indicator-long-poll-adaptif.md`
- Modify: `internal/docs/README.md` (bagian `## adr`, sisipkan **di atas** baris 0103)
- Modify: `internal/docs/adr/README.md` (narasi, di posisi yang sama dengan urutan berkas itu)
- Modify: `internal/docs/architecture/api-contract.md` (paragraf outbox gateway, sekitar baris 1047-1053)
- Modify: `internal/skills/hanoman/SKILL.md` (butir Telegram, sesudah butir ADR-0097 yang berakhir `(ADR-0096 gotcha 4 utuh).`)

**Interfaces:**
- Consumes: seluruh perilaku Task 1-4
- Produces: —

**Nomor ADR:** 0104. Sudah dienumerasi lintas `git branch -a` **dan** `git worktree list` (main = 0103; worktree tetangga `spec-492` eksplisit "tanpa ADR baru"). **Enumerasi ulang tepat sebelum push** (Task 6) — sesi lain bisa mengklaimnya di sela waktu.

- [ ] **Step 1: Tulis ADR**

Buat `internal/docs/adr/0104-telegram-typing-indicator-long-poll-adaptif.md`:

```markdown
# ADR-0104 — Kehadiran gateway Telegram adalah indikator typing, dan long-poll adaptif yang jadi denyutnya

- **Status:** Accepted
- **Tanggal:** 2026-08-02
- **Spec:** SPEC-493
- **Hubungan:** **mengamandemen** [0096](0096-telegram-gateway-session-operator-persisten.md) §5 ·
  **menegakkan** [0024](0024-sesi-interaktif-menggantikan-run.md) · [0097](0097-kredensial-telegram-di-settings-terenkripsi.md) utuh

## Konteks

SPEC-491 memberi gateway sebuah suara: satu baris `TelegramOutbox` ber-kind `gateway-progress` tiap
update berhasil di-dispatch. Itu memperbaiki masalah nyata — chat yang diam total — tapi ongkosnya
terbaca langsung di layar user: pada sesi 2026-08-01, **7 update menghasilkan 7 pesan robot**
terpisah sebelum satu pun jawaban asli keluar. Satu-satunya kendali, `Setting.telegram.progress`,
bersifat semua-atau-tidak-sama-sekali: mematikannya mengembalikan diam total, padahal satu giliran
bisa makan **95 detik**.

Telegram sudah menyediakan bentuk yang tepat untuk "sedang dikerjakan": `sendChatAction` dengan
indikator typing — sesaat, tak meninggalkan jejak di riwayat chat, dan sudah dipahami setiap
pengguna Telegram. Hambatannya arsitektural: status itu **padam ~5 detik** sesudah panggilan
terakhir dan **tak punya API stop-typing**, jadi ia menuntut denyut di bawah 5 detik — sementara
gateway hanoman adalah satu loop sekuensial yang **memblokir 25 detik** di `getUpdates`, dan
ADR-0024 melarang menambah timer/scheduler/worker.

Loop yang sama juga sudah terbukti membuat balasan telat: terukur **10,8 / 11,3 / 11,9 detik**
antara balasan siap dan mulai dikirim, padahal `sendMessage` sendiri 0,4 detik.

## Keputusan

### 1. Kehadiran gateway = indikator typing, bukan pesan teks

Kedua varian teks `gateway-progress` dihapus; kind itu tak lagi dipakai untuk pesan teks apa pun.
Sebagai gantinya `TelegramApiClient.sendChatAction(chatId, action)` dipanggil (a) begitu update
selesai di-dispatch dan (b) sesudah tiap chunk keluar dari `flushOutbox()` — karena pesan masuk
menghapus status typing di sisi Telegram. **Tidak** di-arm ulang sesudah chunk terakhir dari
balasan final: giliran memang sudah selesai, dan cara menghentikan indikator adalah membiarkan
timernya habis.

`Setting.telegram.progress` tetap saklarnya, sekarang mengendalikan typing. Mati = **nol panggilan
`sendChatAction`**, benar-benar senyap.

### 2. `gateway-failure` TETAP pesan teks

Kegagalan harus terbaca. Indikator yang hilang diam-diam tidak bisa membedakan "sudah selesai
dijawab" dari "pesanmu hilang" — dan jalur kegagalan justru satu-satunya tempat user tak punya
sumber informasi lain. Kind ini juga tetap **tak digerbangi** `progress` (SPEC-491).

### 3. Long-poll adaptif adalah denyutnya — tanpa satu pun timer baru

Saat ada `TelegramUpdate` `dispatched` yang belum punya balasan final, timeout `getUpdates` turun
dari 25 detik ke **4 detik**; saat idle kembali ke 25. Tiap iterasi loop lalu menjadi tick alami
untuk refresh typing **sekaligus** `flushOutbox()`.

ADR-0024 dengan demikian **ditegakkan, bukan dilanggar**: yang bertambah adalah satu argumen pada
panggilan yang sudah terjadi tiap iterasi, bukan sumber waktu baru. Efek sampingnya jeda pengiriman
balasan 10–12 detik itu ikut hilang.

**Bukan `timeout: 0`.** Itu berubah jadi busy-poll ke API Telegram dan gampang kena 429.

### 4. Typing adalah kosmetik, jadi ia tak punya jalur untuk merusak apa pun

Seluruh state typing hidup **di memori** dalam satu kelas (`services/telegram/typing.ts`) yang
**tak satu pun method-nya bisa melempar**. Kegagalan `sendChatAction` hanya menyetel cooldown
per-chat: `retry_after` dihormati bila ada, selain itu backoff berlipat dari 5 detik, keduanya
dipagari **1–300 detik**. Ia tak pernah menyentuh state `TelegramUpdate` maupun `TelegramOutbox` —
jalur at-most-once pengiriman balasan (ADR-0096 §4) tetap utuh apa adanya.

### 5. Keaktifan diturunkan dari DB, bukan disimpan sebagai penanda

"Chat mana yang sedang diproses" = ada `TelegramUpdate` ber-`state = "dispatched"` yang belum punya
baris `TelegramOutbox` ber-kind final (`final|decision|failure|confirmation|gateway-failure`;
non-final hanya `progress`). Nol kolom baru, nol migration, dan restart proses memulihkan keadaan
tanpa rekonsiliasi apa pun. `TelegramChat.lastProgressKey` tetap tak dipakai.

## Konsekuensi

- Riwayat chat kini hanya berisi kalimat yang benar-benar ditulis session operator, plus
  pemberitahuan kegagalan. Tak ada lagi kebisingan robot.
- Trafik `getUpdates` naik ~6× **selama ada pekerjaan in-flight** dan tak berubah saat idle. Ini
  harga yang dibayar sadar untuk indikator hidup + balasan yang tak telat 12 detik.
- Indikator bisa berkedip bila satu langkah di dalam loop melebihi ~5 detik. Arm paksa di dua titik
  terpanas (sesudah dispatch, sesudah tiap chunk) menutup jeda terpanjangnya; sisanya kosmetik.
- Operator kehilangan konfirmasi tekstual "pesanmu diterima". Yang menggantikannya bersifat
  sesaat: kalau user melihat chat setelah giliran selesai, tak ada jejak bahwa ia pernah diproses.
  Diterima sadar — itulah persis keluhan yang memicu spec ini.

## Gotcha yang wajib diingat

1. **`retry_after` hidup di BADAN respons 429.** `call()` dulu melempar di `if (!response.ok)`
   **sebelum** `response.json()`, jadi nilai itu tak pernah punya pembaca. Menambah cooldown tanpa
   memperbaiki ini menghasilkan cooldown yang selamanya memakai default — dan test-nya tetap hijau.
2. **Umur menunggu wajib berpagar.** Update yang session operatornya mati mengendap `dispatched`
   selamanya; tanpa `TYPING_MAX_WAIT_MS` (10 menit) gateway mengetik selamanya **dan** mengunci
   long-poll di 4 detik selamanya.
3. **Arm sesudah chunk harus memaksa, refresh tidak.** Telegram menghapus status typing tiap ada
   pesan masuk, jadi arm pasca-chunk yang ikut throttle akan diam persis saat ia paling dibutuhkan.
   Sebaliknya refresh tanpa throttle berubah jadi banjir saat update datang beruntun dan
   `getUpdates` kembali seketika.
4. **Poll adaptif tetap hidup saat `progress` mati.** Flag itu menggerbangi **suara**, bukan
   **latensi**. Operator yang mematikan indikator tak sedang meminta balasannya telat 12 detik.
5. **Kosakata kind duduk di `protocol.ts`, bukan `gateway.ts`.** Pemakainya gateway **dan** store;
   menaruhnya di gateway membuat store meng-import gateway yang sudah meng-import store.
6. **`decision` dan `confirmation` itu final.** Keduanya mengembalikan giliran ke manusia;
   indikator "hanoman sedang mengetik" saat yang ditunggu justru jawaban user adalah kebohongan.

## Alternatif yang ditolak

- **`setInterval` khusus typing.** Melanggar ADR-0024 langsung, dan menambah sumber waktu kedua yang
  harus dihentikan bersama gateway (kelas bug "dua irama, satu flag" SPEC-432).
- **`getUpdates` dengan `timeout: 0` + sleep sendiri.** Busy-poll ke API Telegram, gampang kena 429,
  dan sleep-nya toh sebuah timer.
- **Loop kedua khusus outbox/typing.** Dua pembaca `getUpdates` atas satu bot = Telegram 409
  (ADR-0096 konsekuensi 1); memisahkan hanya outbox berarti dua penulis untuk satu antrean
  at-most-once.
- **Mempertahankan pesan teks di belakang flag ketiga.** Field setting baru untuk memilih
  teks-vs-typing hanya memindahkan keluhannya ke halaman Settings; brief meminta pesannya hilang.
- **Menyimpan status typing sebagai kolom (`TelegramChat.lastProgressKey`).** Butuh migration untuk
  keadaan yang sudah bisa diturunkan penuh dari `TelegramUpdate.state` + `TelegramOutbox.kind`
  (ADR-0018: turunkan bila bisa dihitung ulang).
```

- [ ] **Step 2: Tautkan ADR di kedua index**

Di `internal/docs/README.md`, bagian `## adr`, sisipkan **tepat di atas** baris `- [0103 — Auto-merge…`:

```markdown
- [0104 — Kehadiran gateway Telegram adalah indikator typing, dan long-poll adaptif yang jadi denyutnya](adr/0104-telegram-typing-indicator-long-poll-adaptif.md)
```

Di `internal/docs/adr/README.md`, temukan entri narasi ADR-0103 dan sisipkan entri 0104 **di atasnya**, mengikuti format yang dipakai berkas itu (baca 2-3 entri di sekitarnya lebih dulu dan tiru bentuknya persis — jangan mengarang format baru). Isinya: mengamandemen 0096 §5 (suara gateway jadi sesaat), menegakkan 0024 (long-poll adaptif, bukan timer baru), dan tiga gotcha teratas dari ADR-nya.

- [ ] **Step 3: Perbarui `api-contract.md`**

Di `internal/docs/architecture/api-contract.md`, ganti kalimat yang berbunyi
"Gateway sendiri **juga** boleh mengantre amplop (ADR-0096 §5, dipasang SPEC-491) — fakta server
saja: satu baris saat update berhasil di-dispatch (digerbangi `Setting.telegram.progress`) dan satu
baris kegagalan saat dispatch gagal (**tak** digerbangi; kegagalan bukan progress). `kind`-nya
`gateway-progress`/`gateway-failure`, di luar enum reply, karena `dedupeKey` outbox adalah
`chat:update:kind` — memakai `"progress"` akan membuat baris gateway menelan reply session operator
untuk update yang sama."
menjadi:

```markdown
Gateway sendiri **hanya** mengantre satu jenis amplop sejak SPEC-493 · [ADR-0104](../adr/0104-telegram-typing-indicator-long-poll-adaptif.md):
`gateway-failure` saat dispatch gagal — **tak** digerbangi `Setting.telegram.progress`, karena
kegagalan bukan progress dan harus terbaca. `kind`-nya di luar enum reply karena `dedupeKey` outbox
adalah `chat:update:kind`: memakai `"progress"` akan membuat baris gateway menelan reply session
operator untuk update yang sama. Kind `gateway-progress` **dihapus** — kehadiran gateway sekarang
berupa indikator `sendChatAction` "typing…" yang sesaat (tak meninggalkan jejak di chat),
dinyalakan saat update di-dispatch, di-arm ulang sesudah tiap chunk, dan **tidak** sesudah balasan
final. `Setting.telegram.progress` menggerbangi indikator itu: mati = nol panggilan
`sendChatAction`. Denyutnya adalah long-poll `getUpdates` yang **adaptif** (4 detik saat ada update
`dispatched` tanpa balasan final, 25 detik saat idle) — nol timer baru, ADR-0024 utuh.
```

- [ ] **Step 4: Perbarui `SKILL.md`**

Di `internal/skills/hanoman/SKILL.md`, sisipkan butir baru **tepat sesudah** butir ADR-0097 yang
berakhir dengan `**tetap tak pernah masuk sesi** (ADR-0096 gotcha 4 utuh).`:

```markdown
- **Kehadiran gateway Telegram = indikator typing, denyutnya long-poll adaptif** (SPEC-493/**ADR-0104**,
  mengamandemen ADR-0096 §5; ADR-0024 **ditegakkan**): kedua varian teks `gateway-progress`
  **dihapus** — 7 update pernah menghasilkan 7 pesan robot. Penggantinya `sendChatAction` "typing…"
  yang sesaat: nyala saat update di-dispatch, di-arm ulang **sesudah tiap chunk** `flushOutbox()`
  (Telegram MENGHAPUS status typing tiap ada pesan masuk), dan **tidak** sesudah chunk terakhir
  balasan final — Telegram tak punya API stop-typing, jadi menghentikannya = membiarkan timernya
  habis. `Setting.telegram.progress` tetap saklarnya, sekarang atas typing; mati = **nol** panggilan
  API. `gateway-failure` **TETAP** pesan teks (kegagalan harus terbaca, bukan indikator yang hilang
  diam-diam). Denyut ~4 detik didapat **tanpa timer baru**: timeout `getUpdates` turun 25 → **4
  detik** selama ada `TelegramUpdate` `dispatched` tanpa balasan final (`store.chatsAwaitingReply`,
  nol kolom baru) — jeda kirim balasan **10,8/11,3/11,9 detik** yang terukur ikut hilang karena
  `flushOutbox()` kini dijangkau tiap ≤4 detik. **Enam gotcha:** (1) `retry_after` hidup di **BADAN**
  respons 429 dan `call()` dulu melempar sebelum membacanya → cooldown akan selamanya memakai default
  **dengan test hijau**; (2) umur menunggu wajib berpagar (`TYPING_MAX_WAIT_MS` 10 mnt) — update
  yang sesinya mati mengendap `dispatched` selamanya dan akan mengunci long-poll di 4 detik
  selamanya; (3) arm pasca-chunk **memaksa**, refresh **ter-throttle** (3 dtk) — tertukar berarti
  diam persis saat paling dibutuhkan, atau banjir saat update beruntun; (4) poll adaptif **tetap
  hidup** saat `progress` mati (flag itu menggerbangi suara, bukan latensi); (5) kosakata kind
  (`TELEGRAM_FINAL_REPLY_KINDS`) duduk di `protocol.ts` — dua pemakainya gateway **dan** store, dan
  menaruhnya di gateway = siklus import; (6) `decision`/`confirmation` **final** (giliran kembali ke
  manusia). Seluruh state typing in-memory di `services/telegram/typing.ts` dan **tak satu pun
  method-nya bisa melempar** — jalur at-most-once update/outbox tak tersentuh.
```

- [ ] **Step 5: Verifikasi integritas index docs**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-493
node cli/dist/index.js docs index --check 2>/dev/null || npx tsx cli/src/index.ts docs index --check
```

Harapan: melaporkan index utuh (ADR-0104 ter-link). Bila CLI belum ter-build dan `tsx` gagal,
verifikasi manual: `grep -n "0104" internal/docs/README.md internal/docs/adr/README.md` harus
memberi **dua** baris.

- [ ] **Step 6: Commit**

```bash
git add internal/docs internal/skills
git commit -m "docs(493): ADR-0104 indikator typing + long-poll adaptif, api-contract & SKILL"
```

---

### Task 6: Verifikasi akhir & push

**Files:** tidak ada perubahan kode — hanya verifikasi.

**Interfaces:**
- Consumes: seluruh Task 1-5
- Produces: —

- [ ] **Step 1: Jalankan seluruh test yang tersentuh, sekali, serial**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-493
export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism --dir server \
  server/test/telegram-client.test.ts \
  server/test/telegram-store.test.ts \
  server/test/telegram-typing.test.ts \
  server/test/telegram-gateway.test.ts \
  server/test/telegram-e2e.test.ts \
  server/test/telegram-protocol.test.ts \
  server/test/telegram-bootstrap-config.test.ts \
  server/test/telegram-lifecycle.test.ts \
  server/test/telegram-routes.test.ts \
  server/test/telegram-inbound-guard.test.ts \
  server/test/telegram-confirmation.test.ts \
  server/test/telegram-session.test.ts \
  server/test/telegram-credentials.test.ts \
  server/test/telegram-schema.test.ts
```

Harapan: **semua LULUS**, nol berkas "no test files". Jangan menerima `passWithNoTests` sebagai
bukti — hitung jumlah berkas yang benar-benar berjalan (harus 14).

- [ ] **Step 2: Typecheck paket server**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-493
pnpm --filter ./server typecheck
```

Harapan: keluar tanpa error. **Jangan** `pnpm -r typecheck`.

- [ ] **Step 3: Smoke runtime — server hidup & gateway tak merusak boot**

Perubahan ini menyentuh perilaku runtime gateway (loop yang dijalankan `server.ts`), jadi sekali di
akhir buktikan server benar-benar boot dan permukaan Telegram menjawab. **Pakai DB khusus dan port
non-8787** (mesin ini menjalankan sesi lain):

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-493
SMOKE_HOME="$(mktemp -d)"
HANOMAN_HOME="$SMOKE_HOME" npx prisma migrate deploy --schema server/prisma/schema.prisma
HANOMAN_HOME="$SMOKE_HOME" PORT=8811 npx tsx server/src/server.ts &
sleep 6
curl -s -o /dev/null -w "health=%{http_code}\n" http://127.0.0.1:8811/health
curl -s -o /dev/null -w "telegram-status=%{http_code}\n" http://127.0.0.1:8811/api/telegram/status
```

Harapan: `health=200` dan `telegram-status=401` (tanpa cookie auth — 401 adalah **bukti gate hidup**,
bukan kegagalan). Bunuh **per-PID**:

```bash
lsof -ti:8811 | xargs -r kill
```

**JANGAN** `pkill -f node` / `pkill -f tsx` — itu membunuh agen sesi tetangga.

- [ ] **Step 4: Enumerasi ulang nomor ADR tepat sebelum push**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman
git worktree list
for b in $(git branch -a --format='%(refname)'); do
  git ls-tree -r --name-only "$b" -- internal/docs/adr 2>/dev/null | grep -oE '/0[0-9]{3}-' | grep -oE '[0-9]{4}'
done | sort -n | tail -3
ls .worktrees/*/internal/docs/adr/0104-* 2>/dev/null
```

Harapan: nomor tertinggi di branch lain adalah **0103**, dan tak ada worktree tetangga yang punya
berkas `0104-*` selain milik sesi ini. Bila ada tabrakan: rename berkas ADR ke nomor bebas
berikutnya dan perbarui **seluruh** rujukannya (`internal/docs/README.md`,
`internal/docs/adr/README.md`, `api-contract.md`, `SKILL.md`, kedua dokumen di
`docs/superpowers/`, dan komentar `gateway.ts`/`typing.ts`).

- [ ] **Step 5: Pastikan worktree bersih lalu push**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-493
git status --porcelain          # harus KOSONG
git push origin HEAD:refs/heads/hanoman/spec-493
```

---

## Self-Review

**Cakupan spec → task**

| Kriteria spec | Task |
| --- | --- |
| AC-1 kedua teks `gateway-progress` dihapus | Task 4 (e) + test (c) `telegramOutbox.count() === 0` + e2e (e) |
| AC-2 `sendChatAction(chatId, action)` | Task 1 |
| AC-3 typing nyala saat dispatch, di-refresh, interval < 5 dtk | Task 4 (e) + (h) · `pollTimeoutFor` Task 3 |
| AC-4 arm ulang tiap chunk, tidak sesudah final | Task 4 (g) + test "keeps typing alive between chunks" |
| AC-5 cooldown, `retry_after`, pagar 1-300 dtk, tak menggagalkan balasan | Task 1 (`retryAfter`) + Task 3 (cooldown) + Task 4 test "never lets a failing chat action touch update or outbox state" |
| AC-6 `telegram.progress` menggerbangi typing, mati = senyap | Task 3 (`enabled`) + Task 4 test "stays silent end to end" |
| AC-7 `gateway-failure` tetap teks | Task 4 (f) + test "still reports dispatch failure as readable text" |
| Constraint ADR-0024 tanpa timer baru | Task 4 (h) — hanya argumen `timeout` yang berubah |
| Constraint tanpa endpoint/field setting baru | Tak satu pun task menyentuh `shared/src/telegram.ts` atau `server/src/routes/**` |
| Constraint kegagalan typing tak menyentuh state | Task 3 (`send` ber-`try/catch` total) + Task 4 test |
| Constraint dilarang `timeout: 0` | `pollTimeoutFor` + test `toBeGreaterThan(0)` |
| Docs tersentuh (§7 spec) | Task 5 |

**Konsistensi tipe:** `chatsAwaitingReply(since: Date): Promise<string[]>` dipakai identik di Task 2
(definisi) dan Task 4 (h) (pemanggil). `pollTimeoutFor(waiting: number, idle: number)` didefinisikan
Task 3 dan dipanggil `pollTimeoutFor(waiting.length, idlePollTimeout)` di Task 4. `TelegramApiError`
bertambah `retryAfter?: number` (**detik**) di Task 1 dan dikali `1_000` di Task 3.
`TELEGRAM_FINAL_REPLY_KINDS` didefinisikan Task 2, dipakai Task 2 (store) dan Task 4 (g).
`sendChatAction(chatId, action)` posisional konsisten di client (Task 1), port `TelegramGatewayClient`
(Task 4 b), fake client test (Task 4 a), dan `TelegramTypingSender` (Task 3).

**Placeholder:** nihil — tiap langkah berisi kode/perintah lengkap. Satu-satunya langkah yang menyuruh
"tiru format sekitarnya" adalah Task 5 Step 2 pada `adr/README.md`, yang memang berkas ber-format
naratif bebas; isinya sudah ditentukan eksplisit.
