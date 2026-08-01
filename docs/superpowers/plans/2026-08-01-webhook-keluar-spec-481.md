# Webhook keluar untuk setiap perubahan (SPEC-481) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** hanoman mengirim webhook HTTP POST bertanda tangan HMAC ke endpoint yang didaftarkan
operator setiap kali sebuah baris DB yang terlacak berubah, dengan antrean durable + retry
berbackoff, pengelolaan di Settings, dan halaman dokumentasi in-app yang dihasilkan dari katalog
yang sama dengan pengirimnya.

**Architecture:** Satu Prisma client extension (`tap.ts`) di `server/src/db.ts` menangkap
`create|update|upsert|delete|updateMany|deleteMany` untuk model yang dienumerasi katalog
`WEBHOOK_ENTITIES` (`shared/src/webhook.ts`). Diff atas allowlist field → amplop v1 → baris
`WebhookDelivery` per endpoint yang cocok (antrean **dan** riwayat dalam satu tabel) → worker
`setInterval` in-process mengirimnya dengan backoff tabel. Tak ada message queue (ADR-0024 utuh).

**Tech Stack:** TypeScript strict · Prisma 6.19 (SQLite) · Fastify · zod · React+Vite · vitest ·
`node:crypto` (HMAC + AES-GCM lewat `services/secret-box.ts`) · `node:dns` · `node:async_hooks`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-01-spec-481-webhook-keluar-design.md` — baca sebelum
  mulai. ADR yang lahir: **ADR-0100**.
- **Verifikasi HANYA yang berubah** (ADR-0080). Jalankan path test yang disebut tiap task, bukan
  suite penuh. Wajib `--no-file-parallelism` untuk test server, dan wajib
  `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"` karena mesin ini menjalankan beberapa sesi
  (SPEC-479). Test web wajib `env -u NODE_ENV`.
- **Bahasa komentar & UI: Indonesia.** Kode, nama simbol, dan nama event tetap Inggris.
- **Tanpa message queue / Redis / worker terpisah** — ADR-0024 utuh.
- **`app.ts` bebas-timer**: semua `setInterval` di-`start` dari `server.ts` dan `.unref()`.
- **Model Prisma baru wajib masuk `PG_ORDER`** (`cli/src/commands/migrate-pg.ts`) — test DMMF merah
  bila lupa. Migration **ditulis tangan** + `migrate deploy` (jangan `migrate dev`).
- **Secret tak pernah keluar utuh** dari `GET`, tak pernah masuk log.
- Konstanta perilaku adalah **konstanta modul di `shared/src/webhook.ts`**, bukan konfigurasi
  (pola `LEAD_ACTIONS` / `MENTION_MAX_HOPS`).
- Commit tiap task selesai; pesan `feat(481): …` / `test(481): …` / `docs(481): …`.

---

### Task 1: Katalog peristiwa, amplop, dan DTO di `@hanoman/shared`

Satu modul murni yang jadi sumber tunggal untuk tap **dan** halaman dokumentasi. Tak ada I/O.

**Files:**
- Create: `shared/src/webhook.ts`
- Create: `shared/src/webhook.test.ts`
- Modify: `shared/src/index.ts` (tambah `export * from "./webhook";`)

**Interfaces:**
- Consumes: `zod` (sudah dipakai `shared/src/custom-agent.ts`).
- Produces: `WEBHOOK_ENTITIES`, `WEBHOOK_EVENTS`, `WEBHOOK_PING_TYPE`, `WEBHOOK_SPEC_VERSION`,
  `WEBHOOK_API_VERSION`, `WEBHOOK_BACKOFF_SEC`, `WEBHOOK_MAX_ATTEMPTS`, `WEBHOOK_FAIL_LIMIT`,
  `WEBHOOK_QUEUE_CAP`, `WEBHOOK_HISTORY_KEEP`, `WEBHOOK_MAX_BYTES`, `WEBHOOK_FIELD_MAX_CHARS`,
  `WEBHOOK_TIMEOUT_MS`, `WEBHOOK_TOLERANCE_SEC`, `WEBHOOK_SIG_HEADER` dkk;
  tipe `WebhookActor`, `WebhookEnvelope`, `WebhookEntityDef`, `WebhookEventDef`,
  `WebhookEndpointView`, `WebhookDeliveryView`;
  fungsi `entityDefForModel(model)`, `projectRow(def,row)`, `diffFields(def,before,after)`,
  `eventTypeFor(def,action,changed)`, `matchesEvent(subscribed,type)`, `clampEnvelope(env)`,
  `sampleEnvelope(type)`; skema `zCreateWebhookEndpoint`, `zUpdateWebhookEndpoint`.

- [x] **Step 1: Tulis test yang gagal**

Buat `shared/src/webhook.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  WEBHOOK_ENTITIES, WEBHOOK_EVENTS, WEBHOOK_PING_TYPE, WEBHOOK_MAX_BYTES,
  WEBHOOK_BACKOFF_SEC, WEBHOOK_MAX_ATTEMPTS,
  entityDefForModel, projectRow, diffFields, eventTypeFor, matchesEvent,
  clampEnvelope, sampleEnvelope, zCreateWebhookEndpoint,
} from "./webhook";
import type { WebhookEnvelope } from "./webhook";

describe("katalog", () => {
  it("tiap jenis peristiwa unik dan punya penjelasan kapan terpicu", () => {
    const types = WEBHOOK_EVENTS.map((e) => e.type);
    expect(new Set(types).size).toBe(types.length);
    for (const e of WEBHOOK_EVENTS) {
      expect(e.when.length).toBeGreaterThan(10);
      expect(e.label.length).toBeGreaterThan(2);
    }
  });

  it("memuat webhook.ping dan peristiwa inti yang dijanjikan brief", () => {
    const types = WEBHOOK_EVENTS.map((e) => e.type);
    for (const t of [
      WEBHOOK_PING_TYPE, "spec.created", "spec.updated", "spec.stage_changed", "spec.deleted",
      "session.started", "session.ended", "lead.decision", "ticket.created",
      "notification.created", "project.created",
    ]) expect(types).toContain(t);
  });

  it("tiap entitas menyebut model Prisma dan allowlist field yang tak kosong", () => {
    for (const d of WEBHOOK_ENTITIES) {
      expect(d.model[0]).toBe(d.model[0]?.toUpperCase());
      expect(d.fields.length).toBeGreaterThan(0);
      expect(d.fields).toContain("id");
    }
  });

  it("entityDefForModel memetakan nama model Prisma", () => {
    expect(entityDefForModel("Spec")?.entity).toBe("spec");
    expect(entityDefForModel("SessionHistory")?.entity).toBe("session");
    expect(entityDefForModel("SyncLog")).toBeUndefined();
  });
});

describe("projectRow", () => {
  it("hanya meloloskan field allowlist dan menormalkan Date jadi ISO", () => {
    const def = entityDefForModel("Spec")!;
    const row = { id: "SPEC-1", title: "t", stage: "planned", createdAt: new Date(0), rahasia: "x" };
    const out = projectRow(def, row);
    expect(out.id).toBe("SPEC-1");
    expect(out.createdAt).toBe("1970-01-01T00:00:00.000Z");
    expect(out).not.toHaveProperty("rahasia");
  });
});

describe("diffFields", () => {
  const def = entityDefForModel("Spec")!;
  it("mengabaikan version & updatedAt", () => {
    const a = { id: "S", stage: "planned", version: 1, updatedAt: new Date(0) };
    const b = { id: "S", stage: "planned", version: 2, updatedAt: new Date(1) };
    expect(diffFields(def, a, b)).toEqual([]);
  });
  it("melaporkan field yang benar-benar berubah", () => {
    expect(diffFields(def, { id: "S", stage: "planned" }, { id: "S", stage: "executing" }))
      .toEqual(["stage"]);
  });
});

describe("eventTypeFor", () => {
  const spec = entityDefForModel("Spec")!;
  const session = entityDefForModel("SessionHistory")!;
  it("peristiwa turunan MENGGANTIKAN updated", () => {
    expect(eventTypeFor(spec, "updated", ["stage"])).toBe("spec.stage_changed");
    expect(eventTypeFor(spec, "updated", ["title"])).toBe("spec.updated");
  });
  it("session tak punya updated polos", () => {
    expect(eventTypeFor(session, "created", [])).toBe("session.started");
    expect(eventTypeFor(session, "updated", ["endedAt"])).toBe("session.ended");
    expect(eventTypeFor(session, "updated", ["transcriptBytes"])).toBeNull();
  });
});

describe("matchesEvent", () => {
  it("mendukung bintang total dan wildcard per-keluarga", () => {
    expect(matchesEvent(["*"], "spec.created")).toBe(true);
    expect(matchesEvent(["spec.*"], "spec.stage_changed")).toBe(true);
    expect(matchesEvent(["spec.*"], "ticket.created")).toBe(false);
    expect(matchesEvent(["ticket.created"], "ticket.created")).toBe(true);
    expect(matchesEvent([], "ticket.created")).toBe(false);
  });
});

describe("clampEnvelope", () => {
  const base = (): WebhookEnvelope => sampleEnvelope("spec.updated");
  it("membiarkan amplop kecil apa adanya", () => {
    const e = clampEnvelope(base());
    expect(e.truncated).toBe(false);
    expect(e.truncatedFields).toEqual([]);
  });
  it("memotong field string raksasa dan menandainya", () => {
    const env = base();
    env.data.after = { ...env.data.after, objective: "x".repeat(50_000) };
    const out = clampEnvelope(env);
    expect(out.truncated).toBe(true);
    expect(out.truncatedFields).toContain("after.objective");
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(WEBHOOK_MAX_BYTES);
  });
  it("membuang before seluruhnya bila masih kelewat besar", () => {
    const env = base();
    const big: Record<string, string> = {};
    for (let i = 0; i < 200; i++) big[`f${i}`] = "y".repeat(1_500);
    env.data.before = big; env.data.after = { ...big };
    const out = clampEnvelope(env);
    expect(out.data.before).toBeNull();
    expect(out.truncatedFields).toContain("before");
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(WEBHOOK_MAX_BYTES);
  });
});

describe("sampleEnvelope", () => {
  it("ada untuk SETIAP jenis peristiwa (halaman docs membacanya)", () => {
    for (const e of WEBHOOK_EVENTS) {
      const s = sampleEnvelope(e.type);
      expect(s.type).toBe(e.type);
      expect(s.specVersion).toBe("hanoman.webhook/1");
    }
  });
});

describe("backoff", () => {
  it("tabel eksplisit sepanjang maxAttempts, naik monoton", () => {
    expect(WEBHOOK_BACKOFF_SEC.length).toBe(WEBHOOK_MAX_ATTEMPTS);
    expect(WEBHOOK_BACKOFF_SEC[0]).toBe(0);
    for (let i = 1; i < WEBHOOK_BACKOFF_SEC.length; i++)
      expect(WEBHOOK_BACKOFF_SEC[i]!).toBeGreaterThan(WEBHOOK_BACKOFF_SEC[i - 1]!);
  });
});

describe("zCreateWebhookEndpoint", () => {
  it("menolak events kosong", () => {
    expect(zCreateWebhookEndpoint.safeParse({ name: "n", url: "https://a.b", events: [] }).success)
      .toBe(false);
  });
  it("menerima bentuk minimal", () => {
    expect(zCreateWebhookEndpoint.safeParse({ name: "n", url: "https://a.b", events: ["*"] }).success)
      .toBe(true);
  });
});
```

- [x] **Step 2: Jalankan test untuk memastikan gagal**

```bash
./node_modules/.bin/vitest --run shared/src/webhook.test.ts
```
Expected: FAIL — `Failed to resolve import "./webhook"`.

- [x] **Step 3: Tulis `shared/src/webhook.ts`**

```ts
// SPEC-481 · ADR-0100 · sumber TUNGGAL peristiwa webhook: katalog ini menyetir tap Prisma
// (server/src/services/webhooks/tap.ts) DAN halaman dokumentasi in-app. Menambah peristiwa =
// menambah entri di sini; tak ada jalan lain, jadi dokumentasi tak bisa basi.
import { z } from "zod";

export const WEBHOOK_SPEC_VERSION = "hanoman.webhook/1";
export const WEBHOOK_API_VERSION = 1;

/** Jeda SEBELUM percobaan ke-n (detik). Tabel, bukan rumus — supaya bisa didokumentasikan apa adanya. */
export const WEBHOOK_BACKOFF_SEC = [0, 30, 120, 600, 1800, 7200] as const;
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_BACKOFF_SEC.length;
/** Pengiriman `failed` beruntun yang menonaktifkan endpoint. */
export const WEBHOOK_FAIL_LIMIT = 5;
/** Batas baris `pending` per endpoint; kelebihannya lahir sebagai `dropped` yang TERLIHAT. */
export const WEBHOOK_QUEUE_CAP = 1000;
/** Riwayat yang disimpan per endpoint. */
export const WEBHOOK_HISTORY_KEEP = 200;
export const WEBHOOK_MAX_BYTES = 64 * 1024;
export const WEBHOOK_FIELD_MAX_CHARS = 2000;
export const WEBHOOK_TIMEOUT_MS = 10_000;
/** Toleransi timestamp yang disarankan ke penerima (anti-replay). */
export const WEBHOOK_TOLERANCE_SEC = 300;
export const WEBHOOK_DEFAULT_PER_MINUTE = 60;
export const WEBHOOK_PING_TYPE = "webhook.ping";
export const WEBHOOK_USER_AGENT = "hanoman-webhooks/1";

export const WEBHOOK_HEADERS = {
  event: "X-Hanoman-Event",
  eventId: "X-Hanoman-Event-Id",
  delivery: "X-Hanoman-Delivery",
  attempt: "X-Hanoman-Attempt",
  timestamp: "X-Hanoman-Timestamp",
  signature: "X-Hanoman-Signature",
} as const;

export type WebhookActorKind = "user" | "agent" | "lead" | "scheduler" | "system";
export interface WebhookActor { kind: WebhookActorKind; id: string | null; label: string }
export const SYSTEM_ACTOR: WebhookActor = { kind: "system", id: null, label: "hanoman" };

export type WebhookAction = "created" | "updated" | "deleted";

export interface WebhookEnvelope {
  specVersion: string;
  id: string;
  type: string;
  createdAt: string;
  project: { id: string; name: string } | null;
  actor: WebhookActor;
  data: {
    entity: string;
    id: string;
    action: WebhookAction;
    changed: string[];
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    cascade?: Record<string, number>;
  };
  truncated: boolean;
  truncatedFields: string[];
}

/** Peristiwa turunan MENGGANTIKAN `updated` saat salah satu `changed` cocok. */
export interface WebhookDerived { type: string; label: string; when: string; changed: string[] }

export interface WebhookEntityDef {
  entity: string;
  /** Nama model Prisma yang di-tap. */
  model: string;
  label: string;
  /** ALLOWLIST — yang tak disebut tak pernah keluar. Pagar data sensitif sekaligus kontrak payload. */
  fields: string[];
  projectIdField: string | null;
  events: Partial<Record<WebhookAction, { type: string; label: string; when: string }>>;
  derived?: WebhookDerived[];
  /** Baris yang cocok predikat ini tak memancarkan apa pun (mis. notifikasi bertipe `webhook`). */
  skipWhen?: { field: string; equals: unknown };
  /** Model anak yang ikut terhapus cascade DB; dihitung sebelum delete → `data.cascade`. */
  cascade?: string[];
  sample: Record<string, unknown>;
}

// Field yang TAK PERNAH dihitung sebagai perubahan: keduanya bergerak sendiri (stempel sync &
// Prisma), dan tanpa pengecualian ini overlay stage-live `liveSpecs` jadi banjir peristiwa kosong.
const IGNORED_FIELDS = new Set(["version", "updatedAt"]);

export const WEBHOOK_ENTITIES: WebhookEntityDef[] = [
  {
    entity: "spec", model: "Spec", label: "Backlog item",
    fields: ["id", "projectId", "title", "source", "stage", "priority", "author", "objective",
      "branchFrom", "baseSha", "headSha", "dependsOn", "createdAt", "startedAt", "updatedAt"],
    projectIdField: "projectId",
    events: {
      created: { type: "spec.created", label: "Backlog dibuat", when: "Sebuah item backlog difilekan — lewat UI, `POST /specs`, breakdown PRD, triase tiket, atau tarik issue GitHub." },
      updated: { type: "spec.updated", label: "Backlog diubah", when: "Field backlog selain `stage` berubah: judul, objective, prioritas, dependency, branch, atau SHA basis/ujung." },
      deleted: { type: "spec.deleted", label: "Backlog dihapus", when: "Item backlog dihapus operator." },
    },
    derived: [{
      type: "spec.stage_changed", label: "Stage backlog berpindah", changed: ["stage"],
      when: "Stage berpindah — baik oleh fase sesi yang tercatat (otomatis) maupun revert manual operator. MENGGANTIKAN `spec.updated` untuk perubahan itu.",
    }],
    sample: {
      id: "SPEC-481", projectId: "hanoman", title: "Webhook keluar untuk setiap perubahan",
      source: "brief", stage: "executing", priority: "sedang", author: "dena@nafanesia.id",
      objective: "hanoman mengirim webhook HTTP POST …", branchFrom: null,
      baseSha: "5117298…", headSha: null, dependsOn: null,
      createdAt: "2026-08-01T02:10:00.000Z", startedAt: "2026-08-01T02:12:31.000Z",
      updatedAt: "2026-08-01T09:41:22.000Z",
    },
  },
  {
    entity: "project", model: "Project", label: "Project",
    fields: ["id", "name", "desc", "kind", "gitRemote", "stack", "helpEnabled",
      "schedulerOptIn", "leadOptIn", "createdAt", "updatedAt"],
    projectIdField: "id",
    cascade: ["spec", "ticket", "customAgent", "githubIssue"],
    events: {
      created: { type: "project.created", label: "Project ditambah", when: "Project baru terdaftar di workspace." },
      updated: { type: "project.updated", label: "Project diubah", when: "Nama, deskripsi, stack, remote, atau opt-in scheduler/lead/Help Center berubah." },
      deleted: { type: "project.deleted", label: "Project dihapus", when: "Project dihapus. `data.cascade` menyebut jumlah anak yang ikut terhapus — anaknya sendiri TIDAK memancarkan `deleted` (cascade dieksekusi SQLite, di luar jangkauan tap)." },
    },
    sample: {
      id: "hanoman", name: "hanoman", desc: "Orchestrator + dashboard docs-driven",
      kind: "web", gitRemote: "git@github.com:nafanesia/hanoman.git", stack: "ts",
      helpEnabled: false, schedulerOptIn: true, leadOptIn: false,
      createdAt: "2026-05-02T04:00:00.000Z", updatedAt: "2026-08-01T09:00:00.000Z",
    },
  },
  {
    entity: "session", model: "SessionHistory", label: "Sesi terminal",
    fields: ["id", "sessionId", "projectId", "specId", "title", "kind", "flow", "agent",
      "model", "effort", "branch", "startedAt", "endedAt", "exitCode"],
    projectIdField: "projectId",
    events: {
      created: { type: "session.started", label: "Sesi mulai", when: "Sebuah sesi agen lahir di tmux — backlog, PRD, reverse, scaffold, breakdown, konflik integrasi, terminal, atau konsol VPS." },
    },
    derived: [{
      type: "session.ended", label: "Sesi selesai atau gagal", changed: ["endedAt"],
      when: "Sesi ditutup dan `endedAt` terisi. `exitCode` bukan 0 berarti pane mati gagal; `null` berarti tak terbaca (mis. tmux mati di luar hanoman).",
    }],
    sample: {
      id: "6f0c…", sessionId: "spec_481", projectId: "hanoman", specId: "SPEC-481",
      title: "Webhook keluar untuk setiap perubahan", kind: "spec", flow: "feature",
      agent: "claude", model: "claude-opus-5", effort: "xhigh", branch: "hanoman/spec-481",
      startedAt: "2026-08-01T02:12:31.000Z", endedAt: "2026-08-01T09:44:02.000Z", exitCode: 0,
    },
  },
  {
    entity: "ticket", model: "Ticket", label: "Tiket Help Center",
    fields: ["id", "projectId", "number", "category", "title", "detail", "reporterEmail",
      "status", "specId", "createdAt", "updatedAt"],
    projectIdField: "projectId",
    events: {
      created: { type: "ticket.created", label: "Tiket masuk", when: "Pelapor mengirim keluhan lewat halaman Help Center publik project." },
      updated: { type: "ticket.updated", label: "Tiket ditriase", when: "Status tiket berubah (`new` → `accepted`/`rejected`) atau isinya disunting operator." },
    },
    sample: {
      id: "ckt…", projectId: "hanoman", number: 12, category: "bug",
      title: "Terminal tak bisa digulir", detail: "Di layar 13 inci pane terpotong…",
      reporterEmail: "pelapor@contoh.id", status: "accepted", specId: "SPEC-393",
      createdAt: "2026-07-28T01:00:00.000Z", updatedAt: "2026-07-28T02:00:00.000Z",
    },
  },
  {
    entity: "lead_decision", model: "LeadDecision", label: "Putusan hanoman-lead",
    fields: ["id", "projectId", "specId", "sessionId", "gate", "kind", "question", "answer",
      "reason", "refs", "confidence", "action", "status", "weighty", "choice", "choiceIndex",
      "missing", "createdAt"],
    projectIdField: "projectId",
    events: {
      created: { type: "lead.decision", label: "Lead memutuskan", when: "hanoman-lead menerbitkan satu baris jejak keputusan — lewat kontrak `POST /lead/decisions`, deteksi sesi yang menunggu, atau denyut proaktif." },
    },
    sample: {
      id: "cld…", projectId: "hanoman", specId: "SPEC-481", sessionId: "spec_481",
      gate: "detected", kind: "answer", question: "Pakai tap Prisma atau emit manual?",
      answer: "Tap Prisma — satu choke point.", reason: "Kelas bug SPEC-431/448/475.",
      refs: ["internal/docs/adr/0100-webhook-keluar-peristiwa.md"], confidence: "tinggi",
      action: "none", status: "berlaku", weighty: false, choice: "Tap di layer Prisma",
      choiceIndex: 1, missing: null, createdAt: "2026-08-01T03:00:00.000Z",
    },
  },
  {
    entity: "notification", model: "Notification", label: "Notifikasi",
    fields: ["id", "type", "key", "specId", "sessionId", "projectId", "title", "createdAt"],
    projectIdField: "projectId",
    // Nonaktif otomatis melahirkan notifikasi; meneruskannya berarti kegagalan satu endpoint
    // mengirim lalu lintas ke endpoint lain. Rantainya berhenti sendiri, tapi tak berguna.
    skipWhen: { field: "type", equals: "webhook" },
    events: {
      created: { type: "notification.created", label: "Notifikasi baru", when: "hanoman menerbitkan notifikasi: backlog selesai (`done`), sesi gagal (`fail`), sesi menunggu keputusan (`decision`), putusan lead (`lead`), tiket baru (`ticket`), atau drift kepatuhan VPS (`drift`). Notifikasi bertipe `webhook` sengaja TIDAK diteruskan." },
    },
    sample: {
      id: "cnt…", type: "done", key: "done:SPEC-480", specId: "SPEC-480", sessionId: "spec_480",
      projectId: "hanoman", title: "Putusan lead ringkas & terstruktur",
      createdAt: "2026-08-01T01:20:00.000Z",
    },
  },
  {
    entity: "github_issue", model: "GithubIssue", label: "Issue GitHub",
    fields: ["id", "projectId", "repoSlug", "number", "title", "authorLogin", "labels", "url",
      "issueState", "status", "specId", "issueCreatedAt", "issueUpdatedAt", "pulledAt"],
    projectIdField: "projectId",
    events: {
      created: { type: "github_issue.pulled", label: "Issue GitHub ditarik", when: "Issue baru tercermin ke backlog lewat tarik manual atau checker triase." },
      updated: { type: "github_issue.updated", label: "Issue GitHub berubah", when: "Cermin lokal issue diperbarui — judul/label/keadaan di GitHub, atau status triase di hanoman." },
    },
    sample: {
      id: "hanoman:nafanesia/hanoman#912", projectId: "hanoman", repoSlug: "nafanesia/hanoman",
      number: 912, title: "Tambah webhook keluar", authorLogin: "rekan",
      labels: ["enhancement"], url: "https://github.com/nafanesia/hanoman/issues/912",
      issueState: "open", status: "accepted", specId: "SPEC-481",
      issueCreatedAt: "2026-07-30T02:00:00.000Z", issueUpdatedAt: "2026-07-31T02:00:00.000Z",
      pulledAt: "2026-08-01T00:10:00.000Z",
    },
  },
];

const BY_MODEL = new Map(WEBHOOK_ENTITIES.map((d) => [d.model, d]));
export function entityDefForModel(model: string): WebhookEntityDef | undefined {
  return BY_MODEL.get(model);
}

export interface WebhookEventDef {
  type: string; entity: string; entityLabel: string; label: string; when: string;
  sample: Record<string, unknown>;
}

export const WEBHOOK_EVENTS: WebhookEventDef[] = [
  ...WEBHOOK_ENTITIES.flatMap((d) => [
    ...Object.values(d.events).map((e) => ({
      type: e.type, entity: d.entity, entityLabel: d.label, label: e.label, when: e.when, sample: d.sample,
    })),
    ...(d.derived ?? []).map((e) => ({
      type: e.type, entity: d.entity, entityLabel: d.label, label: e.label, when: e.when, sample: d.sample,
    })),
  ]),
  {
    type: WEBHOOK_PING_TYPE, entity: "webhook", entityLabel: "Webhook",
    label: "Ping percobaan",
    when: "Operator menekan tombol Test di Settings → Webhook. Satu-satunya peristiwa yang tak berasal dari perubahan data.",
    sample: { endpoint: "Dashboard internal", message: "ping dari hanoman" },
  },
];

export const webhookEventTypes = (): string[] => WEBHOOK_EVENTS.map((e) => e.type);

/** `["*"]` = semua; `"spec.*"` = satu keluarga; selain itu cocok persis. */
export function matchesEvent(subscribed: string[], type: string): boolean {
  for (const s of subscribed) {
    if (s === "*") return true;
    if (s === type) return true;
    if (s.endsWith(".*") && type.startsWith(s.slice(0, -1))) return true;
  }
  return false;
}

const iso = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : v);

/** Proyeksi allowlist. Yang tak disebut katalog tak pernah keluar. */
export function projectRow(def: WebhookEntityDef, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of def.fields) if (f in row) out[f] = iso(row[f]);
  return out;
}

/** Field allowlist yang benar-benar berubah, di luar stempel mekanis. */
export function diffFields(
  def: WebhookEntityDef, before: Record<string, unknown>, after: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  for (const f of def.fields) {
    if (IGNORED_FIELDS.has(f)) continue;
    if (JSON.stringify(iso(before[f]) ?? null) !== JSON.stringify(iso(after[f]) ?? null)) out.push(f);
  }
  return out;
}

/** `null` = tak ada peristiwa untuk kombinasi ini (mis. SessionHistory diperbarui tanpa `endedAt`). */
export function eventTypeFor(
  def: WebhookEntityDef, action: WebhookAction, changed: string[],
): string | null {
  if (action === "updated") {
    for (const d of def.derived ?? [])
      if (d.changed.some((f) => changed.includes(f))) return d.type;
  }
  return def.events[action]?.type ?? null;
}

/** Amplop yang melewati batas dipangkas BERTAHAP: string panjang dulu, `before` terakhir. */
export function clampEnvelope(env: WebhookEnvelope): WebhookEnvelope {
  const size = (e: WebhookEnvelope) => JSON.stringify(e).length;
  if (size(env) <= WEBHOOK_MAX_BYTES) return env;
  const fields: string[] = [];
  const trim = (side: "before" | "after") => {
    const obj = env.data[side];
    if (!obj) return;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string" && v.length > WEBHOOK_FIELD_MAX_CHARS) {
        next[k] = v.slice(0, WEBHOOK_FIELD_MAX_CHARS) + "…";
        fields.push(`${side}.${k}`);
      } else next[k] = v;
    }
    env.data[side] = next;
  };
  trim("before"); trim("after");
  if (size(env) > WEBHOOK_MAX_BYTES && env.data.before) {
    env.data.before = null;
    fields.push("before");
  }
  if (size(env) > WEBHOOK_MAX_BYTES && env.data.after) {
    env.data.after = null;
    fields.push("after");
  }
  return { ...env, truncated: true, truncatedFields: fields };
}

/** Amplop contoh untuk halaman dokumentasi — dibangun dari katalog, bukan ditulis tangan. */
export function sampleEnvelope(type: string): WebhookEnvelope {
  const def = WEBHOOK_EVENTS.find((e) => e.type === type);
  const entity = WEBHOOK_ENTITIES.find((d) => d.entity === def?.entity);
  const after = def?.sample ?? {};
  const created = type.endsWith(".created") || type === "github_issue.pulled" || type === "session.started";
  const deleted = type.endsWith(".deleted");
  const changed = type === "spec.stage_changed" ? ["stage"]
    : type === "session.ended" ? ["endedAt", "exitCode"]
    : created || deleted ? [] : ["title"];
  return {
    specVersion: WEBHOOK_SPEC_VERSION,
    id: "evt_9f2c4b1e7a3d4c58",
    type,
    createdAt: "2026-08-01T09:41:22.108Z",
    project: entity?.projectIdField ? { id: "hanoman", name: "hanoman" } : null,
    actor: { kind: "user", id: "usr_2k1", label: "dena@nafanesia.id" },
    data: {
      entity: def?.entity ?? "webhook",
      id: String((after as Record<string, unknown>).id ?? "evt"),
      action: created ? "created" : deleted ? "deleted" : "updated",
      changed,
      before: created ? null : changed.length
        ? Object.fromEntries(changed.map((f) => [f, null]))
        : null,
      after: deleted ? null : after,
    },
    truncated: false,
    truncatedFields: [],
  };
}

// ——— DTO ———

export const zCreateWebhookEndpoint = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().trim().min(1).max(2000),
  events: z.array(z.string().min(1)).min(1).max(64),
  projectIds: z.array(z.string().min(1)).nullable().optional(),
  enabled: z.boolean().optional(),
  allowPrivate: z.boolean().optional(),
  /** Batas laju per endpoint; melindungi PENERIMA, bukan hanoman. */
  maxPerMinute: z.number().int().min(1).max(600).optional(),
  /** Kosong = hanoman membangkitkan 32 byte acak. */
  secret: z.string().min(16).max(200).optional(),
});
export type CreateWebhookEndpoint = z.infer<typeof zCreateWebhookEndpoint>;

export const zUpdateWebhookEndpoint = zCreateWebhookEndpoint.partial()
  .extend({ rotateSecret: z.boolean().optional() });
export type UpdateWebhookEndpoint = z.infer<typeof zUpdateWebhookEndpoint>;

export interface WebhookEndpointView {
  id: string; name: string; url: string; events: string[]; projectIds: string[] | null;
  enabled: boolean; allowPrivate: boolean; apiVersion: number; maxPerMinute: number;
  secretHint: string;
  disabledAt: string | null; disabledReason: string | null;
  lastSuccessAt: string | null; lastFailureAt: string | null; failureStreak: number;
  pending: number;
  createdAt: string; updatedAt: string;
  /** HANYA pada respons create/rotate — sekali seumur hidup. */
  secret?: string;
}

export interface WebhookDeliveryView {
  id: string; endpointId: string; eventId: string; eventType: string; projectId: string | null;
  status: "pending" | "sending" | "sent" | "failed" | "dropped";
  attempt: number; maxAttempts: number;
  httpStatus: number | null; durationMs: number | null; error: string | null;
  nextAttemptAt: string | null; createdAt: string; sentAt: string | null;
  payload: unknown;
}

export interface WebhookTestResult {
  ok: boolean; httpStatus: number | null; durationMs: number; error: string | null;
}
```

- [x] **Step 4: Ekspor dari barrel**

Di `shared/src/index.ts`, tambahkan setelah baris `export * from "./telegram";`:

```ts
export * from "./webhook";
```

- [x] **Step 5: Jalankan test sampai hijau**

```bash
./node_modules/.bin/vitest --run shared/src/webhook.test.ts
```
Expected: PASS, ±20 test.

- [x] **Step 6: Typecheck paket shared**

```bash
pnpm --filter ./shared typecheck
```
Expected: keluar 0, tanpa output error.

- [x] **Step 7: Commit**

```bash
git add shared/src/webhook.ts shared/src/webhook.test.ts shared/src/index.ts
git commit -m "feat(481): katalog peristiwa webhook + amplop v1 di @hanoman/shared"
```

---

### Task 2: Skema Prisma, migration tulis tangan, dan `PG_ORDER`

**Files:**
- Modify: `server/prisma/schema.prisma` (tambah dua model di akhir berkas)
- Create: `server/prisma/migrations/20260801220000_webhook/migration.sql`
- Modify: `cli/src/commands/migrate-pg.ts:16-33` (`PG_ORDER`)
- Create: `server/test/webhook-catalog-dmmf.test.ts`

**Interfaces:**
- Consumes: `WEBHOOK_ENTITIES` (Task 1).
- Produces: model Prisma `WebhookEndpoint` & `WebhookDelivery`; klien Prisma ber-delegate
  `prisma.webhookEndpoint` / `prisma.webhookDelivery`.

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/webhook-catalog-dmmf.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { WEBHOOK_ENTITIES } from "@hanoman/shared";
import { PG_ORDER } from "../../cli/src/commands/migrate-pg";

const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));

// SPEC-481 · katalog webhook menyebut nama model & kolom Prisma sebagai STRING. Tanpa test ini
// rename kolom mengosongkan payload tanpa satu pun error — persis kelas gagal-senyap ADR-0094.
describe("katalog webhook vs DMMF", () => {
  it("setiap model katalog ada di skema", () => {
    for (const d of WEBHOOK_ENTITIES) expect(models.has(d.model), d.model).toBe(true);
  });

  it("setiap field allowlist ada di modelnya", () => {
    for (const d of WEBHOOK_ENTITIES) {
      const cols = new Set(models.get(d.model)!.fields.map((f) => f.name));
      for (const f of d.fields) expect(cols.has(f), `${d.model}.${f}`).toBe(true);
    }
  });

  it("projectIdField & skipWhen & cascade menunjuk kolom/model yang nyata", () => {
    for (const d of WEBHOOK_ENTITIES) {
      const cols = new Set(models.get(d.model)!.fields.map((f) => f.name));
      if (d.projectIdField) expect(cols.has(d.projectIdField), `${d.model}.${d.projectIdField}`).toBe(true);
      if (d.skipWhen) expect(cols.has(d.skipWhen.field), `${d.model}.${d.skipWhen.field}`).toBe(true);
      for (const c of d.cascade ?? [])
        expect(models.has(c[0]!.toUpperCase() + c.slice(1)), c).toBe(true);
    }
  });
});

describe("PG_ORDER", () => {
  it("memuat model webhook yang baru (kelas bug ADR-0094 gotcha 7)", () => {
    expect(PG_ORDER).toContain("WebhookEndpoint");
    expect(PG_ORDER).toContain("WebhookDelivery");
    expect(PG_ORDER.indexOf("WebhookDelivery")).toBeGreaterThan(PG_ORDER.indexOf("WebhookEndpoint"));
  });
});

describe("model webhook", () => {
  it("WebhookEndpoint TAK punya kolom `version` — LOCAL-only, tak disync", () => {
    const cols = models.get("WebhookEndpoint")!.fields.map((f) => f.name);
    expect(cols).not.toContain("version");
  });
});
```

- [x] **Step 2: Jalankan untuk memastikan gagal**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism --dir server server/test/webhook-catalog-dmmf.test.ts
```
Expected: FAIL — `models.has("Spec")` lolos tapi `PG_ORDER` tak memuat `WebhookEndpoint`, dan
`Prisma.dmmf` belum punya model webhook.

- [x] **Step 3: Tambah model ke `server/prisma/schema.prisma`**

Tempel di akhir berkas:

```prisma
// SPEC-481 · ADR-0100 · endpoint webhook keluar. LOCAL-only (cermin AgentToken/RuntimeConfig):
// barisnya memegang secret dan menunjuk pengiriman dari MESIN INI, jadi menyiarkannya ke hub
// akan mengirim kredensial dan riwayat yang tak berlaku di sana. Tanpa `version`/notifySynced.
//
// `secret` disimpan sebagai ciphertext `enc:v1:` (services/secret-box.ts, ADR-0097) dan TAK PERNAH
// dikembalikan utuh oleh API — hanya empat karakter terakhir sebagai `secretHint`.
model WebhookEndpoint {
  id             String    @id @default(cuid())
  name           String
  url            String
  secret         String
  events         Json      // string[]; ["*"] = semua, "spec.*" = satu keluarga
  projectIds     Json?     // string[] | null = semua project
  enabled        Boolean   @default(true)
  allowPrivate   Boolean   @default(false) // izin EKSPLISIT alamat internal/loopback (anti-SSRF)
  apiVersion     Int       @default(1)     // versi amplop yang diminta penerima
  maxPerMinute   Int       @default(60)
  disabledAt     DateTime?
  disabledReason String?
  lastSuccessAt  DateTime?
  lastFailureAt  DateTime?
  failureStreak  Int       @default(0)
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
  deliveries     WebhookDelivery[]
}

// SPEC-481 · ADR-0100 · satu tabel merangkap ANTREAN dan RIWAYAT.
//
// `payload` disimpan per pengiriman, bukan dirender ulang: retry wajib mengirim byte yang SAMA
// supaya `id` peristiwa stabil dan idempotensi penerima berlaku, dan riwayat harus memperlihatkan
// apa yang benar-benar dikirim, bukan keadaan hari ini.
model WebhookDelivery {
  id            String    @id @default(cuid())
  endpointId    String
  eventId       String    // SAMA untuk semua endpoint dari satu peristiwa
  eventType     String
  projectId     String?
  payload       Json
  status        String    @default("pending") // pending | sending | sent | failed | dropped
  attempt       Int       @default(0)
  maxAttempts   Int       @default(6)
  nextAttemptAt DateTime?
  httpStatus    Int?
  durationMs    Int?
  error         String?
  createdAt     DateTime  @default(now())
  sentAt        DateTime?
  endpoint      WebhookEndpoint @relation(fields: [endpointId], references: [id], onDelete: Cascade)

  @@index([status, nextAttemptAt])
  @@index([endpointId, createdAt])
  @@index([eventId])
}
```

- [x] **Step 4: Tulis migration tangan**

Buat `server/prisma/migrations/20260801220000_webhook/migration.sql`:

```sql
-- SPEC-481 · ADR-0100 · webhook keluar: endpoint + antrean/riwayat pengiriman.
--
-- Dua tabel BARU → `CREATE TABLE` polos; tak ada redefinisi tabel seperti migration SPEC-408.
-- Keduanya LOCAL-only (tanpa kolom `version`): barisnya memegang secret dan menunjuk pengiriman
-- dari mesin ini.
CREATE TABLE "WebhookEndpoint" (
    "id"             TEXT NOT NULL PRIMARY KEY,
    "name"           TEXT NOT NULL,
    "url"            TEXT NOT NULL,
    "secret"         TEXT NOT NULL,
    "events"         JSONB NOT NULL,
    "projectIds"     JSONB,
    "enabled"        BOOLEAN NOT NULL DEFAULT true,
    "allowPrivate"   BOOLEAN NOT NULL DEFAULT false,
    "apiVersion"     INTEGER NOT NULL DEFAULT 1,
    "maxPerMinute"   INTEGER NOT NULL DEFAULT 60,
    "disabledAt"     DATETIME,
    "disabledReason" TEXT,
    "lastSuccessAt"  DATETIME,
    "lastFailureAt"  DATETIME,
    "failureStreak"  INTEGER NOT NULL DEFAULT 0,
    "createdAt"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      DATETIME NOT NULL
);

CREATE TABLE "WebhookDelivery" (
    "id"            TEXT NOT NULL PRIMARY KEY,
    "endpointId"    TEXT NOT NULL,
    "eventId"       TEXT NOT NULL,
    "eventType"     TEXT NOT NULL,
    "projectId"     TEXT,
    "payload"       JSONB NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'pending',
    "attempt"       INTEGER NOT NULL DEFAULT 0,
    "maxAttempts"   INTEGER NOT NULL DEFAULT 6,
    "nextAttemptAt" DATETIME,
    "httpStatus"    INTEGER,
    "durationMs"    INTEGER,
    "error"         TEXT,
    "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt"        DATETIME,
    CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId")
        REFERENCES "WebhookEndpoint" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery" ("status", "nextAttemptAt");
CREATE INDEX "WebhookDelivery_endpointId_createdAt_idx" ON "WebhookDelivery" ("endpointId", "createdAt");
CREATE INDEX "WebhookDelivery_eventId_idx" ON "WebhookDelivery" ("eventId");
```

- [x] **Step 5: Tambah ke `PG_ORDER`**

Di `cli/src/commands/migrate-pg.ts`, sebelum baris `"GithubIssue",` sisipkan:

```ts
  // SPEC-481 · ADR-0100 · WebhookDelivery WAJIB sesudah WebhookEndpoint (FK endpointId).
  "WebhookEndpoint", "WebhookDelivery",
```

- [x] **Step 6: Generate klien & terapkan migrasi ke DB dev**

```bash
pnpm --filter ./server exec prisma generate
pnpm --filter ./server exec prisma migrate deploy
```
Expected: `Applied 1 migration` (atau "No pending migrations" bila sudah). **Jangan** `migrate dev`
— ia me-reset saat ada drift worktree tetangga.

- [x] **Step 7: Jalankan test sampai hijau**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism --dir server server/test/webhook-catalog-dmmf.test.ts
```
Expected: PASS, 5 test.

- [x] **Step 8: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260801220000_webhook \
        cli/src/commands/migrate-pg.ts server/test/webhook-catalog-dmmf.test.ts
git commit -m "feat(481): model WebhookEndpoint & WebhookDelivery + migration + PG_ORDER"
```

---

### Task 3: Tanda tangan HMAC dan pagar SSRF (modul murni)

**Files:**
- Create: `server/src/services/webhooks/sign.ts`
- Create: `server/src/services/webhooks/ssrf.ts`
- Create: `server/test/webhook-sign.test.ts`
- Create: `server/test/webhook-ssrf.test.ts`

**Interfaces:**
- Consumes: `WEBHOOK_HEADERS`, `WEBHOOK_TOLERANCE_SEC` (Task 1); `node:crypto`, `node:dns/promises`.
- Produces:
  - `signBody(secret: string, timestampSec: number, body: string): string` → `"v1=<hex>"`
  - `signedHeaders(o: {secret; body; eventType; eventId; deliveryId; attempt; nowSec}): Record<string,string>`
  - `validateWebhookUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string }`
  - `isBlockedAddress(ip: string): boolean`
  - `type Lookup = (host: string) => Promise<{ address: string }[]>`
  - `checkDestination(url: URL, allowPrivate: boolean, lookup?: Lookup): Promise<{ ok: true } | { ok: false; error: string }>`

- [x] **Step 1: Tulis test tanda tangan yang gagal**

Buat `server/test/webhook-sign.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { signBody, signedHeaders } from "../src/services/webhooks/sign";

describe("signBody", () => {
  // Vektor tetap: kalau format berubah, SEMUA penerima yang sudah berjalan patah tanpa suara.
  it("HMAC-SHA256 atas `<timestamp>.<body>` berprefix v1=", () => {
    const secret = "rahasia-uji-32-byte-atau-lebih!!";
    const body = '{"a":1}';
    const ts = 1785318082;
    const want = "v1=" + createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
    expect(signBody(secret, ts, body)).toBe(want);
  });

  it("berubah bila timestamp berubah (anti-replay bermakna)", () => {
    expect(signBody("s".repeat(32), 1, "{}")).not.toBe(signBody("s".repeat(32), 2, "{}"));
  });
});

describe("signedHeaders", () => {
  it("memuat seluruh header kontrak dan TIDAK memuat secret", () => {
    const h = signedHeaders({
      secret: "s".repeat(32), body: "{}", eventType: "spec.created",
      eventId: "evt_1", deliveryId: "dlv_1", attempt: 2, nowSec: 1785318082,
    });
    expect(h["X-Hanoman-Event"]).toBe("spec.created");
    expect(h["X-Hanoman-Event-Id"]).toBe("evt_1");
    expect(h["X-Hanoman-Delivery"]).toBe("dlv_1");
    expect(h["X-Hanoman-Attempt"]).toBe("2");
    expect(h["X-Hanoman-Timestamp"]).toBe("1785318082");
    expect(h["X-Hanoman-Signature"]).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(h["Content-Type"]).toBe("application/json");
    expect(JSON.stringify(h)).not.toContain("s".repeat(32));
  });
});
```

- [x] **Step 2: Tulis test SSRF yang gagal**

Buat `server/test/webhook-ssrf.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateWebhookUrl, isBlockedAddress, checkDestination } from "../src/services/webhooks/ssrf";

describe("validateWebhookUrl", () => {
  it("menerima http & https", () => {
    expect(validateWebhookUrl("https://contoh.id/hook").ok).toBe(true);
    expect(validateWebhookUrl("http://contoh.id/hook").ok).toBe(true);
  });
  it("menolak skema selain http(s)", () => {
    for (const u of ["file:///etc/passwd", "ftp://a.b/c", "gopher://a.b", "javascript:alert(1)"])
      expect(validateWebhookUrl(u).ok, u).toBe(false);
  });
  it("menolak kredensial di URL (bocor ke log proxy)", () => {
    expect(validateWebhookUrl("https://user:pw@contoh.id/hook").ok).toBe(false);
  });
  it("menolak sampah yang bukan URL", () => {
    expect(validateWebhookUrl("bukan url").ok).toBe(false);
    expect(validateWebhookUrl("").ok).toBe(false);
  });
});

describe("isBlockedAddress", () => {
  it("memblokir loopback, private, link-local, ULA, multicast, unspecified", () => {
    for (const ip of [
      "127.0.0.1", "127.9.9.9", "0.0.0.0", "10.1.2.3", "172.16.0.1", "172.31.255.255",
      "192.168.1.1", "169.254.169.254", "100.64.0.1", "224.0.0.1",
      "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
    ]) expect(isBlockedAddress(ip), ip).toBe(true);
  });
  it("meloloskan alamat publik", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.169.0.1", "2001:4860:4860::8888"])
      expect(isBlockedAddress(ip), ip).toBe(false);
  });
});

describe("checkDestination", () => {
  const lookup = (addr: string) => async () => [{ address: addr }];
  it("menolak host yang resolve ke alamat internal", async () => {
    const r = await checkDestination(new URL("https://jebakan.id/h"), false, lookup("127.0.0.1"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("internal");
  });
  it("mengizinkannya saat allowPrivate dinyalakan eksplisit", async () => {
    expect((await checkDestination(new URL("http://localhost:9000/h"), true, lookup("127.0.0.1"))).ok)
      .toBe(true);
  });
  it("meloloskan alamat publik", async () => {
    expect((await checkDestination(new URL("https://contoh.id/h"), false, lookup("93.184.216.34"))).ok)
      .toBe(true);
  });
  it("menolak bila SATU dari beberapa alamat internal (jangan ambil yang pertama saja)", async () => {
    const many = async () => [{ address: "93.184.216.34" }, { address: "10.0.0.5" }];
    expect((await checkDestination(new URL("https://contoh.id/h"), false, many)).ok).toBe(false);
  });
  it("gagal-tertutup saat DNS tak bisa menjawab", async () => {
    const boom = async () => { throw new Error("ENOTFOUND"); };
    const r = await checkDestination(new URL("https://hantu.id/h"), false, boom);
    expect(r.ok).toBe(false);
  });
});
```

- [x] **Step 3: Jalankan keduanya untuk memastikan gagal**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism --dir server \
  server/test/webhook-sign.test.ts server/test/webhook-ssrf.test.ts
```
Expected: FAIL — modul `../src/services/webhooks/sign` & `…/ssrf` belum ada.

- [x] **Step 4: Tulis `server/src/services/webhooks/sign.ts`**

```ts
import { createHmac } from "node:crypto";
import { WEBHOOK_HEADERS, WEBHOOK_USER_AGENT } from "@hanoman/shared";

// SPEC-481 · ADR-0100 · tanda tangan v1 = HMAC-SHA256 atas `<timestamp>.<raw body>`.
//
// Timestamp IKUT ditandatangani: tanpa itu penerima tak punya cara menolak replay — badan yang
// sama akan selamanya lolos verifikasi. Penerima diminta menolak selisih > WEBHOOK_TOLERANCE_SEC.
// Prefix `v1=` supaya rotasi algoritma kelak tak menuntut menebak.
export function signBody(secret: string, timestampSec: number, body: string): string {
  return "v1=" + createHmac("sha256", secret).update(`${timestampSec}.${body}`).digest("hex");
}

export function signedHeaders(o: {
  secret: string; body: string; eventType: string; eventId: string;
  deliveryId: string; attempt: number; nowSec: number;
}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "User-Agent": WEBHOOK_USER_AGENT,
    [WEBHOOK_HEADERS.event]: o.eventType,
    [WEBHOOK_HEADERS.eventId]: o.eventId,
    [WEBHOOK_HEADERS.delivery]: o.deliveryId,
    [WEBHOOK_HEADERS.attempt]: String(o.attempt),
    [WEBHOOK_HEADERS.timestamp]: String(o.nowSec),
    [WEBHOOK_HEADERS.signature]: signBody(o.secret, o.nowSec, o.body),
  };
}
```

- [x] **Step 5: Tulis `server/src/services/webhooks/ssrf.ts`**

```ts
import { lookup as dnsLookup } from "node:dns/promises";
import { isIPv4 } from "node:net";

// SPEC-481 · ADR-0100 · pagar SSRF. Dua lapis dengan pertanyaan berbeda:
//   validateWebhookUrl  — bentuk URL, ditegakkan saat DISIMPAN.
//   checkDestination    — alamat yang benar-benar akan dihubungi, ditegakkan SETIAP percobaan.
// Lapis kedua wajib per-percobaan: host publik hari ini bisa menunjuk 127.0.0.1 besok. Ini
// mempersempit DNS rebinding, TIDAK menutupnya (jendela antara resolve dan connect tetap ada) —
// keterbatasan itu ditulis apa adanya di halaman dokumentasi.

export function validateWebhookUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return { ok: false, error: "URL tak valid" }; }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return { ok: false, error: "hanya http atau https" };
  if (url.username || url.password)
    return { ok: false, error: "kredensial di URL tak diizinkan" };
  if (!url.hostname) return { ok: false, error: "hostname kosong" };
  return { ok: true, url };
}

function blockedV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  if (a === 0 || a === 127) return true;                       // unspecified & loopback
  if (a === 10) return true;                                    // private
  if (a === 172 && b >= 16 && b <= 31) return true;             // private
  if (a === 192 && b === 168) return true;                      // private
  if (a === 169 && b === 254) return true;                      // link-local (metadata cloud)
  if (a === 100 && b >= 64 && b <= 127) return true;            // CGNAT
  if (a === 192 && b === 0) return true;                        // IETF protocol assignments
  if (a >= 224) return true;                                    // multicast + reserved + broadcast
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const v = ip.trim().toLowerCase();
  if (!v) return true;
  // IPv4-mapped IPv6 (`::ffff:10.0.0.1`) adalah cara paling murah menyelundupkan alamat internal.
  const mapped = v.startsWith("::ffff:") ? v.slice(7) : v;
  if (isIPv4(mapped)) return blockedV4(mapped);
  if (!v.includes(":")) return true;                            // bukan IP → jangan ditebak
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("fe80") || v.startsWith("fec0")) return true; // link-local / site-local
  if (/^f[cd]/.test(v)) return true;                             // unique local fc00::/7
  if (v.startsWith("ff")) return true;                           // multicast
  return false;
}

export type Lookup = (host: string) => Promise<{ address: string }[]>;
const defaultLookup: Lookup = (host) => dnsLookup(host, { all: true });

export async function checkDestination(
  url: URL, allowPrivate: boolean, lookup: Lookup = defaultLookup,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (allowPrivate) return { ok: true };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addrs: { address: string }[];
  // Gagal-TERTUTUP: DNS yang tak bisa menjawab bukan izin untuk mencoba menghubunginya.
  try { addrs = await lookup(host); } catch (e) {
    return { ok: false, error: `DNS gagal: ${(e as Error).message}` };
  }
  if (!addrs.length) return { ok: false, error: "DNS tak mengembalikan alamat" };
  // SETIAP alamat harus lolos: host round-robin yang satu recordnya 10.0.0.5 tetap jalan masuk.
  for (const a of addrs)
    if (isBlockedAddress(a.address))
      return { ok: false, error: `alamat internal ditolak (${a.address}) — nyalakan "izinkan alamat internal" bila memang disengaja` };
  return { ok: true };
}
```

- [x] **Step 6: Jalankan test sampai hijau**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism --dir server \
  server/test/webhook-sign.test.ts server/test/webhook-ssrf.test.ts
```
Expected: PASS, 12 test.

- [x] **Step 7: Commit**

```bash
git add server/src/services/webhooks/sign.ts server/src/services/webhooks/ssrf.ts \
        server/test/webhook-sign.test.ts server/test/webhook-ssrf.test.ts
git commit -m "feat(481): tanda tangan HMAC v1 + pagar SSRF dua lapis"
```

---

### Task 4: Konteks aktor (`AsyncLocalStorage`) + hook di `app.ts`

Amplop menjanjikan **siapa** yang memicu. Identitas itu hanya hidup di request; tap berjalan jauh
di bawahnya. Satu `AsyncLocalStorage` menjembataninya tanpa mengoper argumen lewat sepuluh lapis.

**Files:**
- Create: `server/src/services/webhooks/actor.ts`
- Create: `server/test/webhook-actor.test.ts`
- Modify: `server/src/app.ts` (satu hook `onRequest` setelah gate auth)
- Modify: `server/src/services/lead/apply.ts` (bungkus eksekusi tindakan dengan `withActor`)

**Interfaces:**
- Consumes: `WebhookActor`, `SYSTEM_ACTOR` (Task 1).
- Produces: `currentActor(): WebhookActor`, `setActor(a: WebhookActor): void`,
  `withActor<T>(a: WebhookActor, fn: () => Promise<T>): Promise<T>`,
  `actorFromRequest(req: { user?: {id:string;email:string}; agent?: {id:string;name:string} }): WebhookActor`.

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/webhook-actor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { currentActor, withActor, actorFromRequest } from "../src/services/webhooks/actor";

describe("currentActor", () => {
  it("default `system` di luar konteks mana pun", () => {
    expect(currentActor().kind).toBe("system");
  });

  it("withActor berlaku di dalam saja, tak bocor keluar", async () => {
    const inside = await withActor({ kind: "lead", id: null, label: "hanoman-lead" },
      async () => currentActor());
    expect(inside.kind).toBe("lead");
    expect(currentActor().kind).toBe("system");
  });

  it("withActor bersarang: yang terdalam menang, yang luar pulih", async () => {
    await withActor({ kind: "lead", id: null, label: "lead" }, async () => {
      const deep = await withActor({ kind: "scheduler", id: null, label: "scheduler" },
        async () => currentActor());
      expect(deep.kind).toBe("scheduler");
      expect(currentActor().kind).toBe("lead");
    });
  });

  it("konteks selamat melewati await (inti ALS)", async () => {
    await withActor({ kind: "lead", id: null, label: "lead" }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      expect(currentActor().kind).toBe("lead");
    });
  });
});

describe("actorFromRequest", () => {
  it("cookie sesi → user, berlabel email", () => {
    const a = actorFromRequest({ user: { id: "u1", email: "dena@nafanesia.id" } });
    expect(a).toEqual({ kind: "user", id: "u1", label: "dena@nafanesia.id" });
  });
  it("agent token → agent, berlabel nama token (BUKAN tokennya)", () => {
    const a = actorFromRequest({ agent: { id: "a1", name: "ci-bot" } });
    expect(a).toEqual({ kind: "agent", id: "a1", label: "ci-bot" });
  });
  it("tanpa keduanya → system", () => {
    expect(actorFromRequest({}).kind).toBe("system");
  });
});
```

- [x] **Step 2: Jalankan untuk memastikan gagal**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism --dir server server/test/webhook-actor.test.ts
```
Expected: FAIL — modul belum ada.

- [x] **Step 3: Tulis `server/src/services/webhooks/actor.ts`**

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { SYSTEM_ACTOR, type WebhookActor } from "@hanoman/shared";

// SPEC-481 · ADR-0100 · amplop menjanjikan SIAPA yang memicu, tapi identitas itu hanya hidup di
// request sementara tap berjalan di layer Prisma. AsyncLocalStorage menjembataninya tanpa mengoper
// argumen lewat setiap penulis. Di luar konteks mana pun jawabannya `system` — jujur, bukan tebakan.
const als = new AsyncLocalStorage<WebhookActor>();

export function currentActor(): WebhookActor {
  return als.getStore() ?? SYSTEM_ACTOR;
}

/** Untuk hook Fastify: `enterWith` menempel ke konteks async request yang sedang berjalan. */
export function setActor(a: WebhookActor): void {
  als.enterWith(a);
}

/** Untuk penulis latar yang punya identitas sendiri (mis. tindakan hanoman-lead). */
export function withActor<T>(a: WebhookActor, fn: () => Promise<T>): Promise<T> {
  return als.run(a, fn);
}

export function actorFromRequest(req: {
  user?: { id: string; email: string } | null;
  agent?: { id: string; name: string } | null;
}): WebhookActor {
  if (req.user) return { kind: "user", id: req.user.id, label: req.user.email };
  // Nama token, BUKAN tokennya — amplop keluar dari mesin ini.
  if (req.agent) return { kind: "agent", id: req.agent.id, label: req.agent.name };
  return SYSTEM_ACTOR;
}
```

- [x] **Step 4: Pasang hook di `server/src/app.ts`**

Tambah import di dekat import service lain:

```ts
import { actorFromRequest, setActor } from "./services/webhooks/actor";
```

Lalu, **tepat setelah** baris `api.addHook("preHandler", guardTelegramGatewayRequest);`, sisipkan:

```ts
    // SPEC-481 · ADR-0100 · stempel aktor untuk amplop webhook. Dipasang di `preHandler` (bukan
    // `onRequest`) supaya `req.user`/`req.agent` sudah terisi gate auth di atas; tanpa itu setiap
    // peristiwa yang lahir dari request akan berkata `system` dan riwayatnya kehilangan pelakunya.
    api.addHook("preHandler", async (req) => {
      setActor(actorFromRequest({ user: req.user ?? null, agent: req.agent ?? null }));
    });
```

- [x] **Step 5: Beri identitas pada tindakan hanoman-lead**

Di `server/src/services/lead/apply.ts`, temukan fungsi yang mengeksekusi tindakan (yang menerima
verdict lalu memanggil `integrateMain`/`stopSession`/dst — cari `export async function apply`).
Bungkus **badan** fungsi itu:

```ts
import { withActor } from "../webhooks/actor";
// …
export async function applyAction(/* argumen apa adanya */) {
  // SPEC-481 · tindakan lead adalah satu-satunya penulis latar yang punya identitas sendiri;
  // tanpa ini integrate/stop yang dilakukan lead terbaca `system` di amplop webhook.
  return withActor({ kind: "lead", id: null, label: "hanoman-lead" }, async () => {
    /* badan lama, tak diubah sebaris pun */
  });
}
```

Bila nama fungsinya berbeda, pilih **satu** titik terluar di `apply.ts` — jangan membungkus tiap
tindakan (itu N call site untuk satu keputusan; kelas bug SPEC-475).

- [x] **Step 6: Jalankan test sampai hijau + typecheck**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism --dir server \
  server/test/webhook-actor.test.ts server/test/app.test.ts
pnpm --filter ./server typecheck
```
Expected: PASS 7 test + app.test.ts tetap hijau; typecheck keluar 0.

- [x] **Step 7: Commit**

```bash
git add server/src/services/webhooks/actor.ts server/test/webhook-actor.test.ts \
        server/src/app.ts server/src/services/lead/apply.ts
git commit -m "feat(481): konteks aktor webhook lewat AsyncLocalStorage"
```

---

### Task 5: Store endpoint + cache gate (`endpoints.ts`)

Gate in-memory inilah yang membuat tap gratis saat webhook tak dipakai — dan default hanoman
memang tak dipakai. Tanpa cache ini setiap tulisan Prisma membayar satu query "ada endpoint?".

**Files:**
- Create: `server/src/services/webhooks/endpoints.ts`
- Create: `server/test/webhook-endpoints.test.ts`

**Interfaces:**
- Consumes: `prisma` (`../../db`), `encryptSecret`/`decryptSecret` (`../secret-box`),
  `matchesEvent`, `WebhookEndpointView` (Task 1), `validateWebhookUrl` (Task 3).
- Produces:
  - `type EndpointRow = { id; name; url; secret; events: string[]; projectIds: string[]|null; enabled; allowPrivate; apiVersion; maxPerMinute; ... }`
  - `refreshWebhookCache(): Promise<void>`
  - `webhooksActive(): boolean`
  - `activeEndpoints(): EndpointRow[]`
  - `matchingEndpoints(eventType: string, projectId: string | null): EndpointRow[]`
  - `newSecret(): string`
  - `secretOf(row: { secret: string }): string | null`
  - `endpointView(row, pending: number, plainSecret?: string): WebhookEndpointView`

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/webhook-endpoints.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import {
  refreshWebhookCache, webhooksActive, activeEndpoints, matchingEndpoints,
  newSecret, secretOf, endpointView,
} from "../src/services/webhooks/endpoints";
import { ENC_PREFIX } from "../src/services/secret-box";

const clean = async () => { await prisma.webhookDelivery.deleteMany(); await prisma.webhookEndpoint.deleteMany(); };
beforeEach(async () => { await clean(); await refreshWebhookCache(); });
afterAll(async () => { await clean(); await refreshWebhookCache(); });

const mk = (over: Record<string, unknown> = {}) => prisma.webhookEndpoint.create({
  data: {
    name: "n", url: "https://contoh.id/hook", secret: "enc-placeholder",
    events: ["*"] as never, ...over,
  } as never,
});

describe("cache gate", () => {
  it("mati saat tak ada endpoint sama sekali", () => {
    expect(webhooksActive()).toBe(false);
    expect(activeEndpoints()).toEqual([]);
  });

  it("menyala setelah endpoint aktif dibuat DAN cache disegarkan", async () => {
    await mk();
    expect(webhooksActive()).toBe(false);   // belum disegarkan — sengaja, bukan bug
    await refreshWebhookCache();
    expect(webhooksActive()).toBe(true);
  });

  it("endpoint nonaktif tak menyalakan gate", async () => {
    await mk({ enabled: false });
    await refreshWebhookCache();
    expect(webhooksActive()).toBe(false);
  });
});

describe("matchingEndpoints", () => {
  it("menyaring menurut jenis peristiwa", async () => {
    await mk({ name: "a", events: ["spec.*"] as never });
    await mk({ name: "b", events: ["ticket.created"] as never });
    await refreshWebhookCache();
    expect(matchingEndpoints("spec.created", "hanoman").map((e) => e.name)).toEqual(["a"]);
    expect(matchingEndpoints("ticket.created", "hanoman").map((e) => e.name)).toEqual(["b"]);
    expect(matchingEndpoints("lead.decision", "hanoman")).toEqual([]);
  });

  it("menyaring menurut project; null = semua project", async () => {
    await mk({ name: "semua", projectIds: null as never });
    await mk({ name: "khusus", projectIds: ["lain"] as never });
    await refreshWebhookCache();
    expect(matchingEndpoints("spec.created", "hanoman").map((e) => e.name)).toEqual(["semua"]);
    expect(matchingEndpoints("spec.created", "lain").map((e) => e.name).sort()).toEqual(["khusus", "semua"]);
  });

  it("peristiwa tanpa project hanya mengenai endpoint tanpa filter project", async () => {
    await mk({ name: "semua", projectIds: null as never });
    await mk({ name: "khusus", projectIds: ["hanoman"] as never });
    await refreshWebhookCache();
    expect(matchingEndpoints("notification.created", null).map((e) => e.name)).toEqual(["semua"]);
  });
});

describe("secret", () => {
  it("newSecret menghasilkan nilai acak cukup panjang", () => {
    const a = newSecret(), b = newSecret();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
  });

  it("secretOf membuka ciphertext dan mengembalikan null bila rusak", async () => {
    const plain = newSecret();
    const { encryptSecret } = await import("../src/services/secret-box");
    expect(secretOf({ secret: encryptSecret(plain) })).toBe(plain);
    expect(secretOf({ secret: `${ENC_PREFIX}rusak` })).toBeNull();
  });
});

describe("endpointView", () => {
  it("TIDAK PERNAH mengembalikan secret, hanya empat karakter terakhir", async () => {
    const { encryptSecret } = await import("../src/services/secret-box");
    const plain = "rahasia-panjang-sekali-1234";
    const row = await mk({ secret: encryptSecret(plain) });
    const v = endpointView(row as never, 3);
    expect(v.secretHint).toBe("1234");
    expect(v.pending).toBe(3);
    expect(JSON.stringify(v)).not.toContain(plain);
    expect(v.secret).toBeUndefined();
  });

  it("membawa secret plaintext HANYA bila diminta eksplisit (create/rotate)", async () => {
    const { encryptSecret } = await import("../src/services/secret-box");
    const row = await mk({ secret: encryptSecret("abcd1234efgh") });
    expect(endpointView(row as never, 0, "abcd1234efgh").secret).toBe("abcd1234efgh");
  });
});
```

- [x] **Step 2: Jalankan untuk memastikan gagal**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism --dir server server/test/webhook-endpoints.test.ts
```
Expected: FAIL — modul belum ada.

- [x] **Step 3: Tulis `server/src/services/webhooks/endpoints.ts`**

```ts
import { randomBytes } from "node:crypto";
import { matchesEvent, type WebhookEndpointView } from "@hanoman/shared";
import { prisma } from "../../db";
import { decryptSecret, encryptSecret } from "../secret-box";

// SPEC-481 · ADR-0100 · daftar endpoint aktif dipegang di MEMORI dan disegarkan tiap mutasi.
// Alasannya bukan kecepatan query melainkan gerbang tap: `webhooksActive()` dibaca pada SETIAP
// tulisan Prisma, dan default hanoman adalah nol endpoint. Cache sinkron (cermin katalog custom
// agent ADR-0094) karena tap tak boleh menunggu Prisma untuk memutuskan "tak ada apa-apa di sini".

export type EndpointRow = {
  id: string; name: string; url: string; secret: string;
  events: unknown; projectIds: unknown;
  enabled: boolean; allowPrivate: boolean; apiVersion: number; maxPerMinute: number;
  disabledAt: Date | null; disabledReason: string | null;
  lastSuccessAt: Date | null; lastFailureAt: Date | null; failureStreak: number;
  createdAt: Date; updatedAt: Date;
};

/** Bentuk yang sudah dinormalkan untuk pemakai. Kolom `Json` dibaca defensif. */
export type Endpoint = Omit<EndpointRow, "events" | "projectIds"> & {
  events: string[]; projectIds: string[] | null;
};

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];

export const normalize = (r: EndpointRow): Endpoint => ({
  ...r,
  events: strings(r.events),
  projectIds: Array.isArray(r.projectIds) ? strings(r.projectIds) : null,
});

let cache: Endpoint[] = [];

export function webhooksActive(): boolean { return cache.length > 0; }
export function activeEndpoints(): Endpoint[] { return cache; }

/** Wajib dipanggil tiap mutasi endpoint & sekali saat boot — perubahan berlaku tanpa restart. */
export async function refreshWebhookCache(): Promise<void> {
  try {
    const rows = await prisma.webhookEndpoint.findMany({ where: { enabled: true } });
    cache = (rows as unknown as EndpointRow[]).map(normalize);
  } catch {
    // DB kedip tak boleh menjatuhkan jalur tulis; daftar kosong = tap diam (degradasi yang benar).
    cache = [];
  }
}

/** `projectId` null = peristiwa tanpa project → hanya endpoint tanpa filter project yang cocok. */
export function matchingEndpoints(eventType: string, projectId: string | null): Endpoint[] {
  return cache.filter((e) => {
    if (!matchesEvent(e.events, eventType)) return false;
    if (e.projectIds === null) return true;
    return projectId !== null && e.projectIds.includes(projectId);
  });
}

/** 32 byte acak base64url — sama kelasnya dengan token perangkat & agent token. */
export const newSecret = (): string => randomBytes(32).toString("base64url");

export const encryptEndpointSecret = (plain: string): string => encryptSecret(plain);

/** `null` = ciphertext tak bisa dibuka (kunci berganti) → pengiriman gagal dengan alasan jelas. */
export const secretOf = (row: { secret: string }): string | null => decryptSecret(row.secret);

export function endpointView(r: EndpointRow, pending: number, plainSecret?: string): WebhookEndpointView {
  const n = normalize(r);
  const plain = plainSecret ?? secretOf(r);
  return {
    id: n.id, name: n.name, url: n.url, events: n.events, projectIds: n.projectIds,
    enabled: n.enabled, allowPrivate: n.allowPrivate, apiVersion: n.apiVersion,
    maxPerMinute: n.maxPerMinute,
    // Empat karakter terakhir cukup untuk mencocokkan dengan catatan operator, tak cukup untuk
    // memalsukan tanda tangan. Secret utuh HANYA pada respons create/rotate.
    secretHint: plain ? plain.slice(-4) : "????",
    disabledAt: n.disabledAt?.toISOString() ?? null,
    disabledReason: n.disabledReason,
    lastSuccessAt: n.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: n.lastFailureAt?.toISOString() ?? null,
    failureStreak: n.failureStreak,
    pending,
    createdAt: n.createdAt.toISOString(), updatedAt: n.updatedAt.toISOString(),
    ...(plainSecret ? { secret: plainSecret } : {}),
  };
}
```

- [x] **Step 4: Jalankan test sampai hijau**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism --dir server server/test/webhook-endpoints.test.ts
```
Expected: PASS, 10 test.

- [x] **Step 5: Commit**

```bash
git add server/src/services/webhooks/endpoints.ts server/test/webhook-endpoints.test.ts
git commit -m "feat(481): store endpoint webhook + cache gate + secret terenkripsi"
```

---

### Task 6: Bangun amplop & fan-out ke antrean (`emit.ts`)

**Files:**
- Create: `server/src/services/webhooks/emit.ts`
- Create: `server/test/webhook-emit.test.ts`

**Interfaces:**
- Consumes: katalog & `clampEnvelope` (Task 1), `currentActor` (Task 4),
  `matchingEndpoints`/`webhooksActive` (Task 5).
- Produces:
  - `type EmitInput = { def: WebhookEntityDef; action: WebhookAction; before: Record<string,unknown>|null; after: Record<string,unknown>|null; changed: string[]; cascade?: Record<string,number> }`
  - `buildEnvelope(input: EmitInput, projectName: string|null, nowIso: string, eventId: string): WebhookEnvelope | null`
  - `emitWebhook(input: EmitInput): Promise<void>` — fan-out + tulis baris `WebhookDelivery`
  - `enqueueEnvelope(env: WebhookEnvelope, endpoints: Endpoint[]): Promise<void>`

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/webhook-emit.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { entityDefForModel, WEBHOOK_QUEUE_CAP } from "@hanoman/shared";
import { prisma } from "../src/db";
import { refreshWebhookCache } from "../src/services/webhooks/endpoints";
import { buildEnvelope, emitWebhook } from "../src/services/webhooks/emit";
import { encryptSecret } from "../src/services/secret-box";
import { withActor } from "../src/services/webhooks/actor";

const spec = entityDefForModel("Spec")!;
const notif = entityDefForModel("Notification")!;

const clean = async () => {
  await prisma.webhookDelivery.deleteMany();
  await prisma.webhookEndpoint.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "hanoman", name: "hanoman", desc: "", kind: "web" } });
  await refreshWebhookCache();
});
afterAll(async () => { await clean(); await refreshWebhookCache(); });

const endpoint = async (over: Record<string, unknown> = {}) => {
  const r = await prisma.webhookEndpoint.create({ data: {
    name: "e", url: "https://contoh.id/hook", secret: encryptSecret("s".repeat(32)),
    events: ["*"] as never, ...over,
  } as never });
  await refreshWebhookCache();
  return r;
};

describe("buildEnvelope", () => {
  it("membentuk amplop v1 lengkap dengan aktor & project", () => {
    const env = buildEnvelope(
      { def: spec, action: "updated", before: { id: "SPEC-1", stage: "planned" },
        after: { id: "SPEC-1", stage: "executing" }, changed: ["stage"] },
      "hanoman", "2026-08-01T00:00:00.000Z", "evt_x");
    expect(env).not.toBeNull();
    expect(env!.type).toBe("spec.stage_changed");
    expect(env!.specVersion).toBe("hanoman.webhook/1");
    expect(env!.project).toEqual({ id: "hanoman", name: "hanoman" });
    expect(env!.actor.kind).toBe("system");
    expect(env!.data.changed).toEqual(["stage"]);
  });

  it("null saat kombinasi aksi/perubahan tak punya jenis peristiwa", () => {
    const sess = entityDefForModel("SessionHistory")!;
    expect(buildEnvelope(
      { def: sess, action: "updated", before: { id: "1" }, after: { id: "1" },
        changed: ["transcriptBytes"] }, null, "2026-08-01T00:00:00.000Z", "e")).toBeNull();
  });

  it("null untuk baris yang cocok skipWhen (notifikasi bertipe webhook)", () => {
    expect(buildEnvelope(
      { def: notif, action: "created", before: null,
        after: { id: "n1", type: "webhook", title: "…" }, changed: [] },
      null, "2026-08-01T00:00:00.000Z", "e")).toBeNull();
  });

  it("memakai aktor dari konteks", async () => {
    const env = await withActor({ kind: "lead", id: null, label: "hanoman-lead" }, async () =>
      buildEnvelope({ def: spec, action: "created", before: null, after: { id: "S" }, changed: [] },
        null, "2026-08-01T00:00:00.000Z", "e"));
    expect(env!.actor.label).toBe("hanoman-lead");
  });
});

describe("emitWebhook", () => {
  it("tak menulis apa pun bila tak ada endpoint", async () => {
    await emitWebhook({ def: spec, action: "created", before: null,
      after: { id: "SPEC-1", projectId: "hanoman" }, changed: [] });
    expect(await prisma.webhookDelivery.count()).toBe(0);
  });

  it("satu baris pengiriman per endpoint yang cocok, eventId SAMA", async () => {
    await endpoint({ name: "a" });
    await endpoint({ name: "b" });
    await emitWebhook({ def: spec, action: "created", before: null,
      after: { id: "SPEC-1", projectId: "hanoman" }, changed: [] });
    const rows = await prisma.webhookDelivery.findMany();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.eventId)).size).toBe(1);
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.eventType).toBe("spec.created");
  });

  it("melewati endpoint yang tak berlangganan jenisnya", async () => {
    await endpoint({ name: "a", events: ["ticket.created"] as never });
    await emitWebhook({ def: spec, action: "created", before: null,
      after: { id: "SPEC-1", projectId: "hanoman" }, changed: [] });
    expect(await prisma.webhookDelivery.count()).toBe(0);
  });

  it("payload memuat nama project, bukan hanya id", async () => {
    await endpoint();
    await emitWebhook({ def: spec, action: "created", before: null,
      after: { id: "SPEC-1", projectId: "hanoman" }, changed: [] });
    const r = await prisma.webhookDelivery.findFirst();
    expect((r!.payload as { project: { name: string } }).project.name).toBe("hanoman");
  });

  it("payload hanya memuat field allowlist", async () => {
    await endpoint();
    await emitWebhook({ def: spec, action: "created", before: null,
      after: { id: "SPEC-1", projectId: "hanoman", payload: { rahasia: 1 } }, changed: [] });
    const r = await prisma.webhookDelivery.findFirst();
    expect(JSON.stringify(r!.payload)).not.toContain("rahasia");
  });

  it("menjatuhkan peristiwa saat antrean endpoint penuh — TERLIHAT sebagai baris dropped", async () => {
    const e = await endpoint();
    await prisma.webhookDelivery.createMany({ data: Array.from({ length: WEBHOOK_QUEUE_CAP }, (_, i) => ({
      endpointId: e.id, eventId: `old${i}`, eventType: "spec.created", payload: {} as never,
    })) as never });
    await emitWebhook({ def: spec, action: "created", before: null,
      after: { id: "SPEC-9", projectId: "hanoman" }, changed: [] });
    const dropped = await prisma.webhookDelivery.findMany({ where: { status: "dropped" } });
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.error).toContain("antrean penuh");
  });

  it("kegagalan fan-out TIDAK melempar ke pemanggil (jalur tulis tak boleh ikut gagal)", async () => {
    await endpoint();
    await expect(emitWebhook({ def: spec, action: "created", before: null,
      after: null as never, changed: [] })).resolves.toBeUndefined();
  });
});
```

- [x] **Step 2: Jalankan untuk memastikan gagal**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism --dir server server/test/webhook-emit.test.ts
```
Expected: FAIL — modul belum ada.

- [x] **Step 3: Tulis `server/src/services/webhooks/emit.ts`**

```ts
import { randomUUID } from "node:crypto";
import {
  clampEnvelope, eventTypeFor, projectRow, WEBHOOK_QUEUE_CAP, WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_SPEC_VERSION,
  type WebhookAction, type WebhookEntityDef, type WebhookEnvelope,
} from "@hanoman/shared";
import { prisma } from "../../db";
import { currentActor } from "./actor";
import { matchingEndpoints, webhooksActive, type Endpoint } from "./endpoints";

// SPEC-481 · ADR-0100 · dari "sebuah baris berubah" menjadi "n baris antrean". Dipanggil
// fire-and-forget oleh tap: apa pun yang salah di sini TIDAK boleh menggagalkan tulisan yang
// memicunya — janji "endpoint lambat tak memperlambat hanoman" dimulai di titik ini.

export type EmitInput = {
  def: WebhookEntityDef;
  action: WebhookAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changed: string[];
  cascade?: Record<string, number>;
};

function skipped(def: WebhookEntityDef, row: Record<string, unknown> | null): boolean {
  if (!def.skipWhen || !row) return false;
  return row[def.skipWhen.field] === def.skipWhen.equals;
}

const rowId = (i: EmitInput): string => String((i.after ?? i.before ?? {}).id ?? "");

export function projectIdOf(i: EmitInput): string | null {
  const f = i.def.projectIdField;
  if (!f) return null;
  const v = (i.after ?? i.before ?? {})[f];
  return typeof v === "string" && v ? v : null;
}

/** `null` = tak ada peristiwa untuk keadaan ini (aksi tak berkatalog, atau baris di-skip). */
export function buildEnvelope(
  i: EmitInput, projectName: string | null, nowIso: string, eventId: string,
): WebhookEnvelope | null {
  if (skipped(i.def, i.after) || skipped(i.def, i.before)) return null;
  const type = eventTypeFor(i.def, i.action, i.changed);
  if (!type) return null;
  const projectId = projectIdOf(i);
  return clampEnvelope({
    specVersion: WEBHOOK_SPEC_VERSION,
    id: eventId,
    type,
    createdAt: nowIso,
    project: projectId ? { id: projectId, name: projectName ?? projectId } : null,
    actor: currentActor(),
    data: {
      entity: i.def.entity,
      id: rowId(i),
      action: i.action,
      changed: i.changed,
      before: i.before ? projectRow(i.def, i.before) : null,
      after: i.after ? projectRow(i.def, i.after) : null,
      ...(i.cascade ? { cascade: i.cascade } : {}),
    },
    truncated: false,
    truncatedFields: [],
  });
}

export async function enqueueEnvelope(env: WebhookEnvelope, endpoints: Endpoint[]): Promise<void> {
  for (const e of endpoints) {
    // Cap per endpoint. Penerima yang mati berhari-hari tak boleh menumbuhkan tabel tanpa batas,
    // tapi kehilangan peristiwa juga tak boleh SENYAP — karena itu barisnya tetap lahir, sebagai
    // `dropped` yang terbaca di riwayat.
    const pending = await prisma.webhookDelivery.count({
      where: { endpointId: e.id, status: { in: ["pending", "sending"] } },
    });
    const full = pending >= WEBHOOK_QUEUE_CAP;
    await prisma.webhookDelivery.create({ data: {
      endpointId: e.id, eventId: env.id, eventType: env.type,
      projectId: env.project?.id ?? null, payload: env as never,
      status: full ? "dropped" : "pending",
      maxAttempts: WEBHOOK_MAX_ATTEMPTS,
      error: full ? `antrean penuh (${WEBHOOK_QUEUE_CAP}) — endpoint tak menerima pengiriman` : null,
    } });
  }
}

export async function emitWebhook(i: EmitInput): Promise<void> {
  try {
    if (!webhooksActive()) return;
    const projectId = projectIdOf(i);
    const type = eventTypeFor(i.def, i.action, i.changed);
    if (!type) return;
    const targets = matchingEndpoints(type, projectId);
    if (!targets.length) return;
    // Nama project dibaca SEKALI per peristiwa, bukan per endpoint. Gagal baca bukan alasan
    // membatalkan peristiwa — id-nya tetap benar.
    const name = projectId
      ? (await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }))?.name ?? null
      : null;
    const env = buildEnvelope(i, name, new Date().toISOString(), `evt_${randomUUID().replace(/-/g, "")}`);
    if (!env) return;
    await enqueueEnvelope(env, targets);
  } catch (e) {
    // Jalur tulis produk TIDAK boleh gagal karena webhook. Satu baris log, lalu diam.
    console.error("webhook emit:", e);
  }
}
```

- [x] **Step 4: Jalankan test sampai hijau**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism --dir server server/test/webhook-emit.test.ts
```
Expected: PASS, 12 test.

- [x] **Step 5: Commit**

```bash
git add server/src/services/webhooks/emit.ts server/test/webhook-emit.test.ts
git commit -m "feat(481): bangun amplop v1 + fan-out ke antrean pengiriman"
```

---

### Task 7: Tap Prisma — satu choke point, nol call site

Inti spec ini. Sesudah task ini setiap penulis baris — hari ini maupun yang ditulis setahun lagi —
otomatis memancarkan peristiwa tanpa tahu webhook itu ada.

**Files:**
- Create: `server/src/services/webhooks/tap.ts`
- Create: `server/src/services/webhooks/install.ts`
- Create: `server/test/webhook-tap.test.ts`
- Create: `server/test/webhook-no-raw-writes.test.ts`
- Modify: `server/src/db.ts` (bungkus klien)
- Modify: `server/src/services/telegram/store.ts:43` (tipe konstruktor)

**Interfaces:**
- Consumes: `entityDefForModel`, `diffFields`, `projectRow` (Task 1); `emitWebhook` (Task 6);
  `webhooksActive` (Task 5).
- Produces:
  - `registerWebhookTap(sink: TapSink): void` — dipanggil `installWebhooks()`; sebelum itu tap diam.
  - `type TapSink = { active: () => boolean; emit: (i: EmitInput) => void }`
  - `webhookTap(base: TapBase): { name: string; query: … }` — objek extension untuk `$extends`
  - `installWebhooks(): Promise<void>` (di `install.ts`) — refresh cache + daftarkan sink

- [x] **Step 1: Tulis test tap yang gagal**

Buat `server/test/webhook-tap.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { refreshWebhookCache } from "../src/services/webhooks/endpoints";
import { installWebhooks } from "../src/services/webhooks/install";
import { encryptSecret } from "../src/services/secret-box";

const clean = async () => {
  await prisma.webhookDelivery.deleteMany();
  await prisma.webhookEndpoint.deleteMany();
  await prisma.sessionHistory.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};

const listen = async (events: string[] = ["*"]) => {
  await prisma.webhookEndpoint.create({ data: {
    name: "e", url: "https://contoh.id/hook", secret: encryptSecret("s".repeat(32)),
    events: events as never,
  } as never });
  await refreshWebhookCache();
};

// Tap fire-and-forget: beri satu putaran event loop supaya barisnya sempat ditulis.
const settle = () => new Promise((r) => setTimeout(r, 40));
const kinds = async () =>
  (await prisma.webhookDelivery.findMany({ orderBy: { createdAt: "asc" } })).map((d) => d.eventType);

beforeEach(async () => {
  await clean();
  await installWebhooks();
  await prisma.project.create({ data: { id: "hanoman", name: "hanoman", desc: "", kind: "web" } });
  await prisma.webhookDelivery.deleteMany();   // buang project.created dari seed
});
afterAll(async () => { await clean(); await refreshWebhookCache(); });

const mkSpec = (over: Record<string, unknown> = {}) => prisma.spec.create({ data: {
  id: "SPEC-1", projectId: "hanoman", title: "t", source: "brief", stage: "backlog",
  priority: "sedang", author: "a", objective: "o", ...over,
} as never });

describe("gerbang", () => {
  it("tanpa endpoint aktif tak ada satu pun baris pengiriman", async () => {
    await mkSpec(); await settle();
    expect(await prisma.webhookDelivery.count()).toBe(0);
  });
});

describe("tap · create/update/delete", () => {
  beforeEach(listen);

  it("create memancarkan spec.created", async () => {
    await mkSpec(); await settle();
    expect(await kinds()).toEqual(["spec.created"]);
  });

  it("update memancarkan spec.updated dengan before & after", async () => {
    await mkSpec(); await prisma.webhookDelivery.deleteMany();
    await prisma.spec.update({ where: { id: "SPEC-1" }, data: { title: "baru" } });
    await settle();
    const d = await prisma.webhookDelivery.findFirst();
    const p = d!.payload as { data: { before: Record<string, unknown>; after: Record<string, unknown>; changed: string[] } };
    expect(d!.eventType).toBe("spec.updated");
    expect(p.data.before.title).toBe("t");
    expect(p.data.after.title).toBe("baru");
    expect(p.data.changed).toEqual(["title"]);
  });

  it("perubahan stage jadi spec.stage_changed, BUKAN spec.updated", async () => {
    await mkSpec(); await prisma.webhookDelivery.deleteMany();
    await prisma.spec.update({ where: { id: "SPEC-1" }, data: { stage: "executing" } });
    await settle();
    expect(await kinds()).toEqual(["spec.stage_changed"]);
  });

  it("updateMany (CAS liveSpecs) juga memancarkan", async () => {
    await mkSpec(); await prisma.webhookDelivery.deleteMany();
    await prisma.spec.updateMany({ where: { id: "SPEC-1", stage: "backlog" }, data: { stage: "planned" } });
    await settle();
    expect(await kinds()).toEqual(["spec.stage_changed"]);
  });

  it("tulisan yang tak mengubah apa pun TIDAK memancarkan", async () => {
    await mkSpec(); await prisma.webhookDelivery.deleteMany();
    await prisma.spec.update({ where: { id: "SPEC-1" }, data: { title: "t" } });
    await settle();
    expect(await prisma.webhookDelivery.count()).toBe(0);
  });

  it("delete memancarkan spec.deleted dengan before terisi, after null", async () => {
    await mkSpec(); await prisma.webhookDelivery.deleteMany();
    await prisma.spec.delete({ where: { id: "SPEC-1" } });
    await settle();
    const d = await prisma.webhookDelivery.findFirst();
    const p = d!.payload as { data: { before: unknown; after: unknown } };
    expect(d!.eventType).toBe("spec.deleted");
    expect(p.data.before).not.toBeNull();
    expect(p.data.after).toBeNull();
  });

  it("model yang TIDAK di katalog tak memancarkan apa pun", async () => {
    await prisma.syncOutbox.create({ data: { entity: "spec", recordId: "SPEC-1" } });
    await settle();
    expect(await prisma.webhookDelivery.count()).toBe(0);
  });

  it("menulis WebhookDelivery sendiri tidak memicu rekursi", async () => {
    await mkSpec(); await settle();
    const n = await prisma.webhookDelivery.count();
    await settle();
    expect(await prisma.webhookDelivery.count()).toBe(n);
  });
});

describe("tap · sesi & notifikasi", () => {
  beforeEach(listen);

  it("SessionHistory create → session.started; endedAt terisi → session.ended", async () => {
    await prisma.sessionHistory.create({ data: {
      id: "h1", sessionId: "spec_1", projectId: "hanoman", kind: "spec", agent: "claude", cwd: "/tmp",
    } });
    await settle();
    expect(await kinds()).toEqual(["session.started"]);
    await prisma.webhookDelivery.deleteMany();
    await prisma.sessionHistory.update({ where: { id: "h1" }, data: { endedAt: new Date(), exitCode: 0 } });
    await settle();
    expect(await kinds()).toEqual(["session.ended"]);
  });

  it("pembaruan SessionHistory tanpa endedAt tak memancarkan", async () => {
    await prisma.sessionHistory.create({ data: {
      id: "h1", sessionId: "spec_1", projectId: "hanoman", kind: "spec", agent: "claude", cwd: "/tmp",
    } });
    await settle(); await prisma.webhookDelivery.deleteMany();
    await prisma.sessionHistory.update({ where: { id: "h1" }, data: { transcriptBytes: 10 } });
    await settle();
    expect(await prisma.webhookDelivery.count()).toBe(0);
  });

  it("notifikasi bertipe `webhook` TIDAK difan-out (anti-umpan-balik)", async () => {
    await prisma.notification.create({ data: { type: "webhook", title: "Endpoint dinonaktifkan" } });
    await settle();
    expect(await prisma.webhookDelivery.count()).toBe(0);
  });

  it("notifikasi biasa difan-out", async () => {
    await prisma.notification.create({ data: { type: "done", title: "Selesai", projectId: "hanoman" } });
    await settle();
    expect(await kinds()).toEqual(["notification.created"]);
  });
});

describe("tap · cascade project", () => {
  beforeEach(listen);
  it("project.deleted menyebut jumlah anak yang ikut terhapus", async () => {
    await mkSpec();
    await prisma.webhookDelivery.deleteMany();
    await prisma.project.delete({ where: { id: "hanoman" } });
    await settle();
    const d = await prisma.webhookDelivery.findFirst({ where: { eventType: "project.deleted" } });
    expect((d!.payload as { data: { cascade: Record<string, number> } }).data.cascade.spec).toBe(1);
  });
});
```

- [x] **Step 2: Tulis test penjaga "tak ada penulis mentah"**

Buat `server/test/webhook-no-raw-writes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { WEBHOOK_ENTITIES } from "@hanoman/shared";

// SPEC-481 · tap Prisma tak bisa melihat SQL mentah maupun `createMany` (SQLite tak mengembalikan
// baris). Keduanya tak dipakai untuk model terlacak hari ini; test ini yang menjaga itu tetap
// benar, karena pelanggarannya gagal SENYAP — peristiwa hilang tanpa satu pun error.
const SRC = resolve(import.meta.dirname, "../src");
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
});

const delegates = WEBHOOK_ENTITIES.map((d) => d.model[0]!.toLowerCase() + d.model.slice(1));

describe("penulis yang tak terlihat tap", () => {
  it("tak ada createMany atas model terlacak", () => {
    const bad: string[] = [];
    for (const f of walk(SRC)) {
      const src = readFileSync(f, "utf8");
      for (const d of delegates)
        if (src.includes(`prisma.${d}.createMany`)) bad.push(`${f}: prisma.${d}.createMany`);
    }
    expect(bad).toEqual([]);
  });

  it("tak ada $executeRaw / $queryRaw di server/src", () => {
    const bad = walk(SRC).filter((f) => /\$(execute|query)Raw/.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
});
```

- [x] **Step 3: Jalankan keduanya untuk memastikan gagal**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism --dir server \
  server/test/webhook-tap.test.ts server/test/webhook-no-raw-writes.test.ts
```
Expected: `webhook-tap` FAIL (modul belum ada). `webhook-no-raw-writes` mungkin sudah PASS — itu
sah; ia penjaga, bukan pendorong. Bila ia MERAH, hentikan dan laporkan temuannya: ada penulis yang
tak akan terlihat tap dan spec ini harus menyebutkannya.

- [x] **Step 4: Tulis `server/src/services/webhooks/tap.ts`**

```ts
import {
  diffFields, entityDefForModel, projectRow,
  type WebhookAction, type WebhookEntityDef,
} from "@hanoman/shared";

// SPEC-481 · ADR-0100 · SATU choke point untuk seluruh peristiwa perubahan.
//
// Kenapa di layer Prisma dan bukan di call site: hanoman sudah tiga kali kena kelas bug "satu
// definisi, N call site" (SPEC-431 predikat, SPEC-448 env spawn, SPEC-475 efek samping), dan
// SPEC-475 mencatat bahwa efek samping paling licin karena tak punya tipe yang memaksanya
// konsisten. "Pancarkan peristiwa" adalah efek samping murni. Di sini ia tak bisa dilupakan.
//
// Modul ini sengaja TIDAK meng-import `../../db`: `db.ts` yang mem-`$extends` dengannya, jadi
// import balik akan melingkar. Klien dasar dioper sebagai argumen; sink didaftarkan belakangan
// (cermin `registerSessionHooks`, ADR-0079) sehingga sebelum `installWebhooks()` tap benar-benar
// tak melakukan apa pun.

export type TapEmit = {
  def: WebhookEntityDef;
  action: WebhookAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changed: string[];
  cascade?: Record<string, number>;
};

export type TapSink = { active: () => boolean; emit: (i: TapEmit) => void };

let sink: TapSink | null = null;
export function registerWebhookTap(s: TapSink): void { sink = s; }
export function __resetWebhookTap(): void { sink = null; }   // test-only

type Delegate = {
  findUnique: (a: unknown) => Promise<Record<string, unknown> | null>;
  findMany: (a: unknown) => Promise<Record<string, unknown>[]>;
  count: (a: unknown) => Promise<number>;
};
export type TapBase = Record<string, unknown>;

const delegateName = (model: string): string => model[0]!.toLowerCase() + model.slice(1);
const del = (base: TapBase, model: string): Delegate =>
  (base as Record<string, Delegate>)[delegateName(model)]!;

/** Aktif hanya bila sink terpasang DAN ada endpoint yang mendengarkan. */
const on = (model: string): WebhookEntityDef | null => {
  if (!sink?.active()) return null;
  return entityDefForModel(model) ?? null;
};

const fire = (i: TapEmit): void => { try { sink?.emit(i); } catch { /* jangan sentuh jalur tulis */ } };

/** Jumlah anak yang akan ikut terhapus cascade DB — satu-satunya jejak yang tersisa dari mereka. */
async function cascadeCounts(
  base: TapBase, def: WebhookEntityDef, id: string,
): Promise<Record<string, number> | undefined> {
  if (!def.cascade?.length) return undefined;
  const out: Record<string, number> = {};
  for (const child of def.cascade) {
    try { out[child] = await (base as Record<string, Delegate>)[child]!.count({ where: { projectId: id } }); }
    catch { /* anak yang tak bisa dihitung dilewati, bukan menggagalkan delete */ }
  }
  return out;
}

export function webhookTap(base: TapBase) {
  const pre = async (model: string, where: unknown): Promise<Record<string, unknown> | null> => {
    try { return await del(base, model).findUnique({ where }); } catch { return null; }
  };

  return {
    name: "hanoman-webhook-tap",
    query: {
      $allModels: {
        async create({ model, args, query }: never) {
          const a = args as unknown, q = query as unknown as (x: unknown) => Promise<Record<string, unknown>>;
          const after = await q(a);
          const def = on(model as unknown as string);
          if (def) fire({ def, action: "created", before: null, after, changed: [] });
          return after;
        },

        async update({ model, args, query }: never) {
          const m = model as unknown as string;
          const a = args as unknown as { where: unknown };
          const q = query as unknown as (x: unknown) => Promise<Record<string, unknown>>;
          const def = on(m);
          const before = def ? await pre(m, a.where) : null;
          const after = await q(a);
          if (def && before) {
            const changed = diffFields(def, before, after);
            if (changed.length) fire({ def, action: "updated", before, after, changed });
          }
          return after;
        },

        async upsert({ model, args, query }: never) {
          const m = model as unknown as string;
          const a = args as unknown as { where: unknown };
          const q = query as unknown as (x: unknown) => Promise<Record<string, unknown>>;
          const def = on(m);
          const before = def ? await pre(m, a.where) : null;
          const after = await q(a);
          if (def) {
            const changed = before ? diffFields(def, before, after) : [];
            if (!before) fire({ def, action: "created", before: null, after, changed: [] });
            else if (changed.length) fire({ def, action: "updated", before, after, changed });
          }
          return after;
        },

        async delete({ model, args, query }: never) {
          const m = model as unknown as string;
          const a = args as unknown as { where: unknown };
          const q = query as unknown as (x: unknown) => Promise<Record<string, unknown>>;
          const def = on(m);
          const before = def ? await pre(m, a.where) : null;
          const cascade = def && before ? await cascadeCounts(base, def, String(before.id)) : undefined;
          const out = await q(a);
          if (def && before) fire({ def, action: "deleted", before, after: null, changed: [], cascade });
          return out;
        },

        // `liveSpecs` memajukan stage lewat CAS `updateMany` — jalur perubahan stage yang PALING
        // sering dipakai. Melewatkannya berarti melewatkan peristiwa yang paling diminta.
        async updateMany({ model, args, query }: never) {
          const m = model as unknown as string;
          const a = args as unknown as { where?: unknown };
          const q = query as unknown as (x: unknown) => Promise<{ count: number }>;
          const def = on(m);
          if (!def) return q(a);
          let before: Record<string, unknown>[] = [];
          try { before = await del(base, m).findMany({ where: a.where }); } catch { /* biar lewat */ }
          const out = await q(a);
          if (before.length) {
            const ids = before.map((r) => r.id);
            let after: Record<string, unknown>[] = [];
            try { after = await del(base, m).findMany({ where: { id: { in: ids } } }); } catch { /* — */ }
            const byId = new Map(after.map((r) => [r.id, r]));
            for (const b of before) {
              const aft = byId.get(b.id);
              if (!aft) continue;
              const changed = diffFields(def, b, aft);
              if (changed.length) fire({ def, action: "updated", before: b, after: aft, changed });
            }
          }
          return out;
        },

        async deleteMany({ model, args, query }: never) {
          const m = model as unknown as string;
          const a = args as unknown as { where?: unknown };
          const q = query as unknown as (x: unknown) => Promise<{ count: number }>;
          const def = on(m);
          if (!def) return q(a);
          let before: Record<string, unknown>[] = [];
          try { before = await del(base, m).findMany({ where: a.where }); } catch { /* — */ }
          const out = await q(a);
          for (const b of before)
            fire({ def, action: "deleted", before: b, after: null, changed: [] });
          return out;
        },
      },
    },
  };
}

export { projectRow };
```

- [x] **Step 5: Tulis `server/src/services/webhooks/install.ts`**

```ts
import { refreshWebhookCache, webhooksActive } from "./endpoints";
import { registerWebhookTap } from "./tap";
import { emitWebhook } from "./emit";

// SPEC-481 · ADR-0100 · menghubungkan tap (yang tak boleh meng-import `db.ts`) dengan pengirimnya
// (yang harus). Dipanggil `server.ts` sebelum request pertama; sebelum itu tap diam total.
export async function installWebhooks(): Promise<void> {
  await refreshWebhookCache();
  registerWebhookTap({
    active: webhooksActive,
    // Fire-and-forget: tulisan yang memicunya tak boleh menunggu fan-out (AC "endpoint lambat tak
    // memperlambat hanoman"). `emitWebhook` sudah menelan galatnya sendiri.
    emit: (i) => { void emitWebhook(i); },
  });
}
```

- [x] **Step 6: Bungkus klien di `server/src/db.ts`**

Ganti baris terakhir `export const prisma = new PrismaClient();` dengan:

```ts
// SPEC-481 · ADR-0100 · tap webhook dipasang DI SINI, satu-satunya tempat klien Prisma lahir.
// `base` dipakai tap untuk membaca keadaan sebelum/sesudah TANPA melewati extension lagi
// (rekursi), sekaligus berbagi engine & koneksi yang sama dengan klien yang diekspor.
const base = new PrismaClient();
export const prisma = base.$extends(webhookTap(base as unknown as TapBase));
```

dan tambahkan importnya di kepala berkas:

```ts
import { webhookTap, type TapBase } from "./services/webhooks/tap";
```

- [x] **Step 7: Perbaiki tipe `TelegramStore`**

`prisma` bukan lagi `PrismaClient` telanjang. Di `server/src/services/telegram/store.ts:43` ganti:

```ts
  constructor(private readonly db: PrismaClient) {}
```
menjadi:

```ts
  // SPEC-481 · klien yang diekspor kini ber-extension (tap webhook), jadi ia tak assignable ke
  // `PrismaClient`. Yang dibutuhkan store hanya delegate model-nya — ambil tipenya dari sana.
  constructor(private readonly db: Pick<PrismaClient,
    "telegramGatewayState" | "telegramChat" | "telegramUpdate" | "telegramMemory"
    | "telegramOutbox" | "telegramConfirmation" | "telegramAudit" | "$transaction"> ) {}
```

Bila `pnpm --filter ./server typecheck` masih mengeluh, sempitkan lagi ke delegate yang benar-benar
dipakai berkas itu (baca error-nya; jangan `any`).

- [x] **Step 8: Panggil `installWebhooks()` dari `server.ts`**

Tambah import:

```ts
import { installWebhooks } from "./services/webhooks/install";
```

dan **setelah** `await installCustomAgents();`:

```ts
  // SPEC-481 · ADR-0100 · daftarkan tap SEBELUM apa pun bisa menulis baris. Sebelum ini tap diam,
  // jadi peristiwa yang lahir di antara boot dan pemasangan hilang — dan itu senyap.
  await installWebhooks();
```

- [x] **Step 9: Jalankan test sampai hijau**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism --dir server \
  server/test/webhook-tap.test.ts server/test/webhook-no-raw-writes.test.ts server/test/webhook-emit.test.ts
pnpm --filter ./server typecheck
```
Expected: PASS semua; typecheck keluar 0.

- [x] **Step 10: Buktikan tak ada regresi di jalur tulis yang paling ramai**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism --dir server \
  server/test/specs.route.test.ts server/test/live-specs.test.ts server/test/session-history.test.ts \
  server/test/telegram-store.test.ts
```
Expected: PASS. (Bila nama berkasnya berbeda, jalankan yang ada — inti langkah ini: `db.ts` kini
membungkus klien, jadi jalur tulis terpadat wajib diuji ulang.)

- [x] **Step 11: Commit**

```bash
git add server/src/services/webhooks/tap.ts server/src/services/webhooks/install.ts \
        server/src/db.ts server/src/server.ts server/src/services/telegram/store.ts \
        server/test/webhook-tap.test.ts server/test/webhook-no-raw-writes.test.ts
git commit -m "feat(481): tap Prisma sebagai satu-satunya sumber peristiwa webhook"
```

---

### Task 8: Pengirim + worker antrean (backoff, nonaktif otomatis, retensi)

**Files:**
- Create: `server/src/services/webhooks/sender.ts`
- Create: `server/src/services/webhooks/engine.ts`
- Create: `server/test/webhook-queue.test.ts`
- Modify: `server/src/server.ts` (start worker)

**Interfaces:**
- Consumes: `signedHeaders` (Task 3), `checkDestination`/`validateWebhookUrl` (Task 3),
  `secretOf` (Task 5), konstanta backoff (Task 1).
- Produces:
  - `type Fetcher = (url: string, init: { method: string; headers: Record<string,string>; body: string; signal: AbortSignal }) => Promise<{ status: number }>`
  - `sendOnce(o: {endpoint; deliveryId; eventId; eventType; attempt; body}, deps?): Promise<{ok; httpStatus; durationMs; error}>`
  - `deliverDue(now: Date, deps?): Promise<number>` — satu putaran antrean, mengembalikan jumlah yang dicoba
  - `pruneHistory(): Promise<number>`
  - `resetStuckDeliveries(): Promise<number>`
  - `startWebhookEngine(): void` / `stopWebhookEngine(): void`

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/webhook-queue.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { WEBHOOK_BACKOFF_SEC, WEBHOOK_FAIL_LIMIT, WEBHOOK_HISTORY_KEEP, WEBHOOK_MAX_ATTEMPTS } from "@hanoman/shared";
import { prisma } from "../src/db";
import { refreshWebhookCache } from "../src/services/webhooks/endpoints";
import { deliverDue, pruneHistory, resetStuckDeliveries, backoffAt } from "../src/services/webhooks/engine";
import { encryptSecret } from "../src/services/secret-box";

const clean = async () => {
  await prisma.webhookDelivery.deleteMany();
  await prisma.webhookEndpoint.deleteMany();
  await prisma.notification.deleteMany();
};
beforeEach(async () => { await clean(); await refreshWebhookCache(); });
afterAll(async () => { await clean(); await refreshWebhookCache(); });

const mkEndpoint = async (over: Record<string, unknown> = {}) => {
  const e = await prisma.webhookEndpoint.create({ data: {
    name: "e", url: "https://contoh.id/hook", secret: encryptSecret("s".repeat(32)),
    events: ["*"] as never, ...over,
  } as never });
  await refreshWebhookCache();
  return e;
};
const mkDelivery = (endpointId: string, over: Record<string, unknown> = {}) =>
  prisma.webhookDelivery.create({ data: {
    endpointId, eventId: "evt_1", eventType: "spec.created",
    payload: { id: "evt_1", type: "spec.created" } as never,
    maxAttempts: WEBHOOK_MAX_ATTEMPTS, ...over,
  } as never });

const ok = () => ({ fetcher: async () => ({ status: 200 }), lookup: async () => [{ address: "93.184.216.34" }] });
const bad = (status = 500) => ({ fetcher: async () => ({ status }), lookup: async () => [{ address: "93.184.216.34" }] });
const boom = () => ({
  fetcher: async () => { throw new Error("ECONNREFUSED"); },
  lookup: async () => [{ address: "93.184.216.34" }],
});

describe("backoffAt", () => {
  it("mengikuti tabel eksplisit", () => {
    const t0 = new Date("2026-08-01T00:00:00.000Z");
    for (let a = 1; a < WEBHOOK_MAX_ATTEMPTS; a++)
      expect(backoffAt(t0, a).getTime() - t0.getTime()).toBe(WEBHOOK_BACKOFF_SEC[a]! * 1000);
  });
});

describe("deliverDue · sukses", () => {
  it("menandai sent, mengisi httpStatus, mengosongkan streak", async () => {
    const e = await mkEndpoint({ failureStreak: 3 });
    await mkDelivery(e.id);
    expect(await deliverDue(new Date(), ok())).toBe(1);
    const d = await prisma.webhookDelivery.findFirst();
    expect(d!.status).toBe("sent");
    expect(d!.httpStatus).toBe(200);
    expect(d!.sentAt).not.toBeNull();
    const fresh = await prisma.webhookEndpoint.findUnique({ where: { id: e.id } });
    expect(fresh!.failureStreak).toBe(0);
    expect(fresh!.lastSuccessAt).not.toBeNull();
  });
});

describe("deliverDue · gagal", () => {
  it("menjadwalkan percobaan berikutnya, bukan langsung menyerah", async () => {
    const e = await mkEndpoint();
    await mkDelivery(e.id);
    await deliverDue(new Date("2026-08-01T00:00:00.000Z"), bad());
    const d = await prisma.webhookDelivery.findFirst();
    expect(d!.status).toBe("pending");
    expect(d!.attempt).toBe(1);
    expect(d!.httpStatus).toBe(500);
    expect(d!.nextAttemptAt!.toISOString()).toBe("2026-08-01T00:00:30.000Z");
  });

  it("menyimpan alasan galat jaringan yang terbaca operator", async () => {
    const e = await mkEndpoint();
    await mkDelivery(e.id);
    await deliverDue(new Date(), boom());
    expect((await prisma.webhookDelivery.findFirst())!.error).toContain("ECONNREFUSED");
  });

  it("percobaan terakhir habis → failed + streak endpoint naik", async () => {
    const e = await mkEndpoint();
    await mkDelivery(e.id, { attempt: WEBHOOK_MAX_ATTEMPTS - 1 });
    await deliverDue(new Date(), bad());
    expect((await prisma.webhookDelivery.findFirst())!.status).toBe("failed");
    expect((await prisma.webhookEndpoint.findUnique({ where: { id: e.id } }))!.failureStreak).toBe(1);
  });

  it("streak mencapai ambang → endpoint dinonaktifkan + satu notifikasi", async () => {
    const e = await mkEndpoint({ failureStreak: WEBHOOK_FAIL_LIMIT - 1 });
    await mkDelivery(e.id, { attempt: WEBHOOK_MAX_ATTEMPTS - 1 });
    await deliverDue(new Date(), bad());
    const fresh = await prisma.webhookEndpoint.findUnique({ where: { id: e.id } });
    expect(fresh!.enabled).toBe(false);
    expect(fresh!.disabledAt).not.toBeNull();
    expect(fresh!.disabledReason).toContain("gagal");
    const n = await prisma.notification.findMany({ where: { type: "webhook" } });
    expect(n).toHaveLength(1);
    expect(n[0]!.title).toContain(fresh!.name);
  });

  it("410 Gone menonaktifkan seketika tanpa menunggu enam percobaan", async () => {
    const e = await mkEndpoint();
    await mkDelivery(e.id);
    await deliverDue(new Date(), bad(410));
    expect((await prisma.webhookDelivery.findFirst())!.status).toBe("failed");
    expect((await prisma.webhookEndpoint.findUnique({ where: { id: e.id } }))!.enabled).toBe(false);
  });
});

describe("deliverDue · pagar", () => {
  it("tak mengirim ke alamat internal tanpa izin eksplisit", async () => {
    const e = await mkEndpoint();
    await mkDelivery(e.id);
    await deliverDue(new Date(), { fetcher: async () => ({ status: 200 }), lookup: async () => [{ address: "127.0.0.1" }] });
    const d = await prisma.webhookDelivery.findFirst();
    expect(d!.status).toBe("pending");
    expect(d!.error).toContain("internal");
  });

  it("melewati baris yang belum jatuh tempo", async () => {
    const e = await mkEndpoint();
    await mkDelivery(e.id, { nextAttemptAt: new Date("2030-01-01T00:00:00.000Z") });
    expect(await deliverDue(new Date("2026-08-01T00:00:00.000Z"), ok())).toBe(0);
  });

  it("menghormati batas laju per endpoint", async () => {
    const e = await mkEndpoint({ maxPerMinute: 2 });
    for (let i = 0; i < 5; i++) await mkDelivery(e.id, { eventId: `evt_${i}` });
    const now = new Date("2026-08-01T00:00:00.000Z");
    expect(await deliverDue(now, ok())).toBe(2);
    expect(await deliverDue(now, ok())).toBe(0);
  });
});

describe("resetStuckDeliveries", () => {
  it("mengembalikan baris `sending` yang tertinggal crash ke `pending`", async () => {
    const e = await mkEndpoint();
    await mkDelivery(e.id, { status: "sending" });
    expect(await resetStuckDeliveries()).toBe(1);
    expect((await prisma.webhookDelivery.findFirst())!.status).toBe("pending");
  });
});

describe("pruneHistory", () => {
  it("menyimpan hanya N terakhir per endpoint", async () => {
    const e = await mkEndpoint();
    for (let i = 0; i < WEBHOOK_HISTORY_KEEP + 7; i++)
      await mkDelivery(e.id, { eventId: `evt_${i}`, status: "sent" });
    expect(await pruneHistory()).toBe(7);
    expect(await prisma.webhookDelivery.count()).toBe(WEBHOOK_HISTORY_KEEP);
  });

  it("tak pernah memangkas baris yang masih mengantre", async () => {
    const e = await mkEndpoint();
    for (let i = 0; i < WEBHOOK_HISTORY_KEEP + 5; i++)
      await mkDelivery(e.id, { eventId: `evt_${i}`, status: "pending" });
    expect(await pruneHistory()).toBe(0);
  });
});
```

- [x] **Step 2: Jalankan untuk memastikan gagal**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism --dir server server/test/webhook-queue.test.ts
```
Expected: FAIL — `engine`/`sender` belum ada.

- [x] **Step 3: Tulis `server/src/services/webhooks/sender.ts`**

```ts
import { WEBHOOK_TIMEOUT_MS } from "@hanoman/shared";
import { signedHeaders } from "./sign";
import { checkDestination, validateWebhookUrl, type Lookup } from "./ssrf";
import { secretOf, type Endpoint } from "./endpoints";

// SPEC-481 · ADR-0100 · satu pengiriman HTTP. Murni terhadap DB — pemanggilnya yang membukukan
// hasilnya, supaya jalur ini bisa dites tanpa jaringan maupun tabel.

export type Fetcher = (url: string, init: {
  method: string; headers: Record<string, string>; body: string; signal: AbortSignal;
}) => Promise<{ status: number }>;

export type SenderDeps = { fetcher?: Fetcher; lookup?: Lookup };

export type SendResult = {
  ok: boolean; httpStatus: number | null; durationMs: number; error: string | null;
  /** Penerima menyatakan dirinya mati — jangan diulang, matikan endpointnya. */
  gone: boolean;
};

export async function sendOnce(o: {
  endpoint: Pick<Endpoint, "url" | "secret" | "allowPrivate">;
  deliveryId: string; eventId: string; eventType: string; attempt: number; body: string;
  nowSec?: number;
}, deps: SenderDeps = {}): Promise<SendResult> {
  const started = Date.now();
  const fail = (error: string, httpStatus: number | null = null, gone = false): SendResult =>
    ({ ok: false, httpStatus, durationMs: Date.now() - started, error, gone });

  const parsed = validateWebhookUrl(o.endpoint.url);
  if (!parsed.ok) return fail(`URL tak sah: ${parsed.error}`);
  const guard = await checkDestination(parsed.url, o.endpoint.allowPrivate, deps.lookup);
  if (!guard.ok) return fail(guard.error);

  const secret = secretOf(o.endpoint);
  // Kunci enkripsi berganti → ciphertext tak terbuka. Mengirim TANPA tanda tangan lebih buruk
  // daripada tak mengirim: penerima yang benar akan menolaknya, penerima yang lalai menerimanya.
  if (!secret) return fail("secret tak bisa dibuka — rotasi secret endpoint ini");

  const headers = signedHeaders({
    secret, body: o.body, eventType: o.eventType, eventId: o.eventId,
    deliveryId: o.deliveryId, attempt: o.attempt,
    nowSec: o.nowSec ?? Math.floor(Date.now() / 1000),
  });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const f: Fetcher = deps.fetcher ?? ((u, init) => fetch(u, init as RequestInit));
    const res = await f(parsed.url.toString(), { method: "POST", headers, body: o.body, signal: ac.signal });
    const durationMs = Date.now() - started;
    if (res.status >= 200 && res.status < 300)
      return { ok: true, httpStatus: res.status, durationMs, error: null, gone: false };
    if (res.status === 410)
      return { ok: false, httpStatus: 410, durationMs, error: "penerima menjawab 410 Gone", gone: true };
    return { ok: false, httpStatus: res.status, durationMs, error: `HTTP ${res.status}`, gone: false };
  } catch (e) {
    const msg = (e as Error).name === "AbortError"
      ? `timeout ${WEBHOOK_TIMEOUT_MS} ms` : (e as Error).message;
    return fail(msg);
  } finally { clearTimeout(timer); }
}
```

- [x] **Step 4: Tulis `server/src/services/webhooks/engine.ts`**

```ts
import {
  WEBHOOK_BACKOFF_SEC, WEBHOOK_FAIL_LIMIT, WEBHOOK_HISTORY_KEEP, WEBHOOK_DEFAULT_PER_MINUTE,
} from "@hanoman/shared";
import { prisma } from "../../db";
import { normalize, refreshWebhookCache, type EndpointRow } from "./endpoints";
import { sendOnce, type SenderDeps } from "./sender";

// SPEC-481 · ADR-0100 · worker antrean in-process. Bukan message queue (ADR-0024 utuh): tabel
// durable + `setInterval` yang di-start dari `server.ts`, persis pola governor scheduler
// (ADR-0072) dan outbox Telegram (ADR-0096).

const TICK_MS = 2_000;
const MAX_IN_FLIGHT = 4;          // mesin ini juga menanggung sesi agen; jangan rakus
const PRUNE_EVERY_TICKS = 30;

/** Jeda percobaan ke-`attempt` (1-basis) dihitung dari tabel — bukan rumus, agar bisa didokumentasikan. */
export function backoffAt(from: Date, attempt: number): Date {
  const sec = WEBHOOK_BACKOFF_SEC[attempt] ?? WEBHOOK_BACKOFF_SEC[WEBHOOK_BACKOFF_SEC.length - 1]!;
  return new Date(from.getTime() + sec * 1000);
}

// Token bucket per endpoint, in-memory. Batas laju melindungi PENERIMA; kehilangan bucket saat
// restart tak berbahaya (paling banter satu menit lebih longgar).
const buckets = new Map<string, { tokens: number; at: number }>();
export function __resetBuckets(): void { buckets.clear(); }

function takeToken(id: string, perMinute: number, now: number): boolean {
  const cap = Math.max(1, perMinute || WEBHOOK_DEFAULT_PER_MINUTE);
  const b = buckets.get(id) ?? { tokens: cap, at: now };
  const refill = Math.floor((now - b.at) / 60_000) * cap;
  const tokens = Math.min(cap, b.tokens + Math.max(0, refill));
  const at = refill > 0 ? now : b.at;
  if (tokens <= 0) { buckets.set(id, { tokens, at }); return false; }
  buckets.set(id, { tokens: tokens - 1, at });
  return true;
}

async function disable(e: EndpointRow, reason: string): Promise<void> {
  const at = new Date();
  await prisma.webhookEndpoint.update({
    where: { id: e.id }, data: { enabled: false, disabledAt: at, disabledReason: reason },
  });
  // Dedup lewat `key` (pola recordCompletion): satu penonaktifan = paling banyak satu notifikasi.
  // Tipe `webhook` sengaja TIDAK difan-out lagi ke webhook (katalog `skipWhen`).
  await prisma.notification.create({ data: {
    type: "webhook", key: `webhook-disabled:${e.id}:${at.getTime()}`,
    title: `Webhook "${e.name}" dinonaktifkan otomatis — ${reason}`, projectId: null,
  } }).catch(() => { /* P2002: sudah ada */ });
  await refreshWebhookCache();
}

/** Satu putaran antrean. Mengembalikan jumlah pengiriman yang benar-benar DICOBA. */
export async function deliverDue(now: Date, deps: SenderDeps = {}): Promise<number> {
  const due = await prisma.webhookDelivery.findMany({
    where: { status: "pending", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
    orderBy: { createdAt: "asc" },
    take: MAX_IN_FLIGHT * 5,
  });
  if (!due.length) return 0;

  const ids = [...new Set(due.map((d) => d.endpointId))];
  const rows = await prisma.webhookEndpoint.findMany({ where: { id: { in: ids } } }) as unknown as EndpointRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));

  let tried = 0;
  for (const d of due) {
    if (tried >= MAX_IN_FLIGHT) break;
    const row = byId.get(d.endpointId);
    if (!row || !row.enabled) continue;              // dinonaktifkan selagi mengantre
    if (!takeToken(row.id, row.maxPerMinute, now.getTime())) continue;

    // Klaim atomis: `updateMany` ber-syarat status supaya dua tick yang tumpang tindih tak
    // mengirim baris yang sama dua kali.
    const claimed = await prisma.webhookDelivery.updateMany({
      where: { id: d.id, status: "pending" }, data: { status: "sending" },
    });
    if (claimed.count === 0) continue;
    tried++;

    const attempt = d.attempt + 1;
    const body = JSON.stringify(d.payload);
    const res = await sendOnce({
      endpoint: normalize(row), deliveryId: d.id, eventId: d.eventId,
      eventType: d.eventType, attempt, body,
    }, deps);

    if (res.ok) {
      await prisma.webhookDelivery.update({ where: { id: d.id }, data: {
        status: "sent", attempt, httpStatus: res.httpStatus, durationMs: res.durationMs,
        error: null, sentAt: new Date(),
      } });
      await prisma.webhookEndpoint.update({
        where: { id: row.id }, data: { failureStreak: 0, lastSuccessAt: new Date() },
      });
      continue;
    }

    const exhausted = res.gone || attempt >= d.maxAttempts;
    await prisma.webhookDelivery.update({ where: { id: d.id }, data: {
      status: exhausted ? "failed" : "pending",
      attempt, httpStatus: res.httpStatus, durationMs: res.durationMs, error: res.error,
      nextAttemptAt: exhausted ? null : backoffAt(now, attempt),
    } });
    if (!exhausted) continue;

    const streak = row.failureStreak + 1;
    await prisma.webhookEndpoint.update({
      where: { id: row.id }, data: { failureStreak: streak, lastFailureAt: new Date() },
    });
    if (res.gone) await disable(row, "penerima menjawab 410 Gone");
    else if (streak >= WEBHOOK_FAIL_LIMIT)
      await disable(row, `${streak} pengiriman gagal beruntun`);
  }
  return tried;
}

/** Baris `sending` yang tertinggal crash DIULANG — webhook adalah kontrak at-least-once, dan
 *  amplopnya membawa id stabil yang membuat penerima bisa idempoten. Sengaja BERLAWANAN dengan
 *  TelegramOutbox (ADR-0096), yang memilih `uncertain` karena pesan ganda ke manusia itu buruk. */
export async function resetStuckDeliveries(): Promise<number> {
  const { count } = await prisma.webhookDelivery.updateMany({
    where: { status: "sending" }, data: { status: "pending" },
  });
  return count;
}

/** Simpan N terakhir per endpoint. Baris yang masih mengantre TAK PERNAH dipangkas. */
export async function pruneHistory(): Promise<number> {
  let removed = 0;
  const groups = await prisma.webhookDelivery.groupBy({
    by: ["endpointId"], _count: { _all: true },
  });
  for (const g of groups) {
    if (g._count._all <= WEBHOOK_HISTORY_KEEP) continue;
    const keep = await prisma.webhookDelivery.findMany({
      where: { endpointId: g.endpointId }, orderBy: { createdAt: "desc" },
      take: WEBHOOK_HISTORY_KEEP, select: { id: true },
    });
    const { count } = await prisma.webhookDelivery.deleteMany({
      where: {
        endpointId: g.endpointId,
        status: { in: ["sent", "failed", "dropped"] },
        id: { notIn: keep.map((k) => k.id) },
      },
    });
    removed += count;
  }
  return removed;
}

let timer: NodeJS.Timeout | undefined;
let ticks = 0;
let busy = false;

export async function tick(): Promise<void> {
  if (busy) return;                 // satu putaran bisa memakan detik; jangan menumpuk
  busy = true;
  try {
    await deliverDue(new Date());
    if (++ticks % PRUNE_EVERY_TICKS === 0) await pruneHistory();
  } catch (e) { console.error("webhook engine:", e); }
  finally { busy = false; }
}

/** Dipanggil `server.ts` SAJA (app.ts bebas-timer). unref → tak menahan proses. */
export function startWebhookEngine(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
  void resetStuckDeliveries()
    .then((n) => { if (n) console.log(`webhook: ${n} pengiriman tertinggal dikembalikan ke antrean`); })
    .catch((e) => console.error("webhook reset:", e));
}
export function stopWebhookEngine(): void { if (timer) clearInterval(timer); timer = undefined; ticks = 0; }
```

- [x] **Step 5: Start worker di `server.ts`**

Tambah import:

```ts
import { startWebhookEngine } from "./services/webhooks/engine";
```

dan setelah `startLead();`:

```ts
  // SPEC-481 · ADR-0100 · worker antrean webhook (in-process, cermin scheduler). Idle penuh saat
  // tak ada baris `pending` — biayanya satu query ringan tiap 2 detik.
  startWebhookEngine();
```

- [x] **Step 6: Jalankan test sampai hijau**

Catatan: test memanggil `__resetBuckets()` secara implisit lewat `beforeEach` yang membersihkan
endpoint; bila test batas laju bocor antar-berkas, tambahkan `import { __resetBuckets }` +
`beforeEach(__resetBuckets)` di berkas test.

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism --dir server server/test/webhook-queue.test.ts
pnpm --filter ./server typecheck
```
Expected: PASS 13 test; typecheck keluar 0.

- [x] **Step 7: Commit**

```bash
git add server/src/services/webhooks/sender.ts server/src/services/webhooks/engine.ts \
        server/src/server.ts server/test/webhook-queue.test.ts
git commit -m "feat(481): pengirim bertanda tangan + worker antrean berbackoff & nonaktif otomatis"
```

---

### Task 9: Endpoint HTTP `/api/webhooks` (cookie-only) + api client

**Files:**
- Create: `server/src/routes/webhooks.ts`
- Modify: `server/src/app.ts` (register route)
- Modify: `server/src/services/agent-capabilities.ts` (peta `webhooks` → `COOKIE_ONLY`)
- Modify: `shared/src/api.ts` (path helper)
- Modify: `src/src/api/client.ts` (metode klien)
- Create: `server/test/webhook-routes.test.ts`

**Interfaces:**
- Consumes: Task 1 (DTO & view), Task 3 (`validateWebhookUrl`), Task 5 (store/cache),
  Task 8 (`sendOnce`, `backoffAt`).
- Produces path helper `paths.webhooks`, `paths.webhook(id)`, `paths.webhookTest(id)`,
  `paths.webhookDeliveries(id)`, `paths.webhookDeliveryRetry(id)`; metode klien
  `listWebhooks`, `createWebhook`, `updateWebhook`, `deleteWebhook`, `testWebhook`,
  `listWebhookDeliveries`, `retryWebhookDelivery`.

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/webhook-routes.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { capabilityForRoute } from "../src/services/agent-capabilities";
import { refreshWebhookCache } from "../src/services/webhooks/endpoints";

const app = buildApp({ requireAuth: false });
const clean = async () => {
  await prisma.webhookDelivery.deleteMany();
  await prisma.webhookEndpoint.deleteMany();
};
beforeEach(async () => { await clean(); await refreshWebhookCache(); });
afterAll(async () => { await clean(); await refreshWebhookCache(); });

const post = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/api/webhooks", payload });

// SPEC-477 · pengelolaan yang memegang secret tak pernah boleh lewat agent token.
describe("capabilityForRoute · webhooks", () => {
  it("COOKIE_ONLY untuk baca maupun tulis", () => {
    for (const m of ["GET", "POST", "PATCH", "DELETE"])
      expect(capabilityForRoute(m, "/api/webhooks")).toBe("COOKIE_ONLY");
    expect(capabilityForRoute("GET", "/api/webhooks/abc/deliveries")).toBe("COOKIE_ONLY");
  });
});

describe("POST /api/webhooks", () => {
  it("membuat endpoint dan mengembalikan secret SEKALI", async () => {
    const r = await post({ name: "CI", url: "https://contoh.id/hook", events: ["spec.*"] });
    expect(r.statusCode).toBe(201);
    const b = r.json();
    expect(typeof b.secret).toBe("string");
    expect(b.secret.length).toBeGreaterThan(20);
    expect(b.secretHint).toBe(b.secret.slice(-4));
  });

  it("secret TIDAK muncul lagi di GET", async () => {
    const secret = (await post({ name: "CI", url: "https://contoh.id/hook", events: ["*"] })).json().secret;
    const list = await app.inject({ method: "GET", url: "/api/webhooks" });
    expect(list.statusCode).toBe(200);
    expect(JSON.stringify(list.json())).not.toContain(secret);
    expect(list.json().endpoints[0].secret).toBeUndefined();
  });

  it("menyimpan secret dalam bentuk terenkripsi, bukan plaintext", async () => {
    const secret = (await post({ name: "CI", url: "https://contoh.id/hook", events: ["*"] })).json().secret;
    const row = await prisma.webhookEndpoint.findFirst();
    expect(row!.secret).not.toBe(secret);
    expect(row!.secret.startsWith("enc:v1:")).toBe(true);
  });

  it("menolak URL non-http(s) dan alamat internal tanpa izin", async () => {
    expect((await post({ name: "x", url: "file:///etc/passwd", events: ["*"] })).statusCode).toBe(400);
    const loop = await post({ name: "x", url: "http://127.0.0.1:9000/h", events: ["*"] });
    expect(loop.statusCode).toBe(400);
    expect(JSON.stringify(loop.json())).toContain("internal");
  });

  it("mengizinkan alamat internal saat allowPrivate dinyalakan", async () => {
    expect((await post({ name: "x", url: "http://127.0.0.1:9000/h", events: ["*"], allowPrivate: true }))
      .statusCode).toBe(201);
  });

  it("menolak jenis peristiwa yang tak ada di katalog", async () => {
    const r = await post({ name: "x", url: "https://contoh.id/h", events: ["spec.meledak"] });
    expect(r.statusCode).toBe(400);
    expect(JSON.stringify(r.json())).toContain("spec.meledak");
  });

  it("menyegarkan cache — endpoint baru langsung aktif tanpa restart", async () => {
    const { webhooksActive } = await import("../src/services/webhooks/endpoints");
    expect(webhooksActive()).toBe(false);
    await post({ name: "x", url: "https://contoh.id/h", events: ["*"] });
    expect(webhooksActive()).toBe(true);
  });
});

describe("PATCH /api/webhooks/:id", () => {
  it("mengubah langganan tanpa menyentuh secret", async () => {
    const c = (await post({ name: "x", url: "https://contoh.id/h", events: ["*"] })).json();
    const before = (await prisma.webhookEndpoint.findUnique({ where: { id: c.id } }))!.secret;
    const r = await app.inject({ method: "PATCH", url: `/api/webhooks/${c.id}`, payload: { events: ["spec.created"] } });
    expect(r.statusCode).toBe(200);
    expect(r.json().events).toEqual(["spec.created"]);
    expect(r.json().secret).toBeUndefined();
    expect((await prisma.webhookEndpoint.findUnique({ where: { id: c.id } }))!.secret).toBe(before);
  });

  it("rotateSecret mengembalikan secret baru SEKALI dan menggantinya di DB", async () => {
    const c = (await post({ name: "x", url: "https://contoh.id/h", events: ["*"] })).json();
    const r = await app.inject({ method: "PATCH", url: `/api/webhooks/${c.id}`, payload: { rotateSecret: true } });
    expect(r.json().secret).toBeTruthy();
    expect(r.json().secret).not.toBe(c.secret);
  });

  it("mengaktifkan ulang endpoint yang dinonaktifkan otomatis membersihkan jejaknya", async () => {
    const c = (await post({ name: "x", url: "https://contoh.id/h", events: ["*"] })).json();
    await prisma.webhookEndpoint.update({ where: { id: c.id }, data: {
      enabled: false, disabledAt: new Date(), disabledReason: "5 gagal", failureStreak: 5,
    } });
    const r = await app.inject({ method: "PATCH", url: `/api/webhooks/${c.id}`, payload: { enabled: true } });
    expect(r.json().disabledAt).toBeNull();
    expect(r.json().failureStreak).toBe(0);
  });

  it("404 untuk id yang tak ada", async () => {
    expect((await app.inject({ method: "PATCH", url: "/api/webhooks/hantu", payload: { name: "y" } }))
      .statusCode).toBe(404);
  });
});

describe("DELETE /api/webhooks/:id", () => {
  it("menghapus endpoint berikut riwayatnya", async () => {
    const c = (await post({ name: "x", url: "https://contoh.id/h", events: ["*"] })).json();
    await prisma.webhookDelivery.create({ data: {
      endpointId: c.id, eventId: "e", eventType: "spec.created", payload: {} as never,
    } as never });
    expect((await app.inject({ method: "DELETE", url: `/api/webhooks/${c.id}` })).statusCode).toBe(204);
    expect(await prisma.webhookDelivery.count()).toBe(0);
  });
});

describe("GET /api/webhooks/:id/deliveries", () => {
  it("mengembalikan riwayat terbaru lebih dulu", async () => {
    const c = (await post({ name: "x", url: "https://contoh.id/h", events: ["*"] })).json();
    for (const t of ["spec.created", "spec.updated"])
      await prisma.webhookDelivery.create({ data: {
        endpointId: c.id, eventId: t, eventType: t, payload: {} as never,
      } as never });
    const r = await app.inject({ method: "GET", url: `/api/webhooks/${c.id}/deliveries` });
    expect(r.statusCode).toBe(200);
    expect(r.json().items).toHaveLength(2);
    expect(r.json().items[0].eventType).toBe("spec.updated");
  });
});

describe("POST /api/webhooks/deliveries/:id/retry", () => {
  it("mengembalikan baris failed ke antrean dengan attempt direset", async () => {
    const c = (await post({ name: "x", url: "https://contoh.id/h", events: ["*"] })).json();
    const d = await prisma.webhookDelivery.create({ data: {
      endpointId: c.id, eventId: "e", eventType: "spec.created", payload: {} as never,
      status: "failed", attempt: 6, error: "HTTP 500",
    } as never });
    const r = await app.inject({ method: "POST", url: `/api/webhooks/deliveries/${d.id}/retry` });
    expect(r.statusCode).toBe(200);
    const fresh = await prisma.webhookDelivery.findUnique({ where: { id: d.id } });
    expect(fresh!.status).toBe("pending");
    expect(fresh!.attempt).toBe(0);
    expect(fresh!.nextAttemptAt).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan untuk memastikan gagal**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism --dir server server/test/webhook-routes.test.ts
```
Expected: FAIL — 404 di semua route.

- [x] **Step 3: Petakan capability**

Di `server/src/services/agent-capabilities.ts`, tepat setelah blok `if (top === "telegram") { … }`:

```ts
  // SPEC-481 · ADR-0100 · pengelolaan webhook memegang SECRET penandatanganan dan menentukan ke
  // mana data workspace mengalir keluar. Tak ada capability yang cukup untuk itu — cookie-only,
  // apa pun methodnya (preseden /telegram/{settings,test,credentials}, ADR-0097).
  if (top === "webhooks") return "COOKIE_ONLY";
```

- [x] **Step 4: Tulis `server/src/routes/webhooks.ts`**

```ts
import type { FastifyInstance } from "fastify";
import {
  webhookEventTypes, zCreateWebhookEndpoint, zUpdateWebhookEndpoint,
  WEBHOOK_MAX_ATTEMPTS, WEBHOOK_PING_TYPE, WEBHOOK_SPEC_VERSION,
  type WebhookDeliveryView, type WebhookTestResult,
} from "@hanoman/shared";
import { prisma } from "../db";
import {
  encryptEndpointSecret, endpointView, newSecret, normalize, refreshWebhookCache,
  secretOf, type EndpointRow,
} from "../services/webhooks/endpoints";
import { checkDestination, validateWebhookUrl } from "../services/webhooks/ssrf";
import { sendOnce } from "../services/webhooks/sender";

// SPEC-481 · ADR-0100 · pengelolaan endpoint webhook. COOKIE_ONLY ditegakkan
// `capabilityForRoute`; route ini tak perlu memeriksanya lagi.

const KNOWN = new Set(webhookEventTypes());

/** `*` dan `<keluarga>.*` sah; sisanya harus ada di katalog — salah ketik tak boleh diam. */
function unknownEvents(events: string[]): string[] {
  const families = new Set([...KNOWN].map((t) => t.split(".")[0] + ".*"));
  return events.filter((e) => e !== "*" && !families.has(e) && !KNOWN.has(e));
}

async function checkUrl(url: string, allowPrivate: boolean): Promise<string | null> {
  const parsed = validateWebhookUrl(url);
  if (!parsed.ok) return parsed.error;
  const guard = await checkDestination(parsed.url, allowPrivate);
  return guard.ok ? null : guard.error;
}

const pendingOf = (endpointId: string) => prisma.webhookDelivery.count({
  where: { endpointId, status: { in: ["pending", "sending"] } },
});

const deliveryView = (d: {
  id: string; endpointId: string; eventId: string; eventType: string; projectId: string | null;
  status: string; attempt: number; maxAttempts: number; httpStatus: number | null;
  durationMs: number | null; error: string | null; nextAttemptAt: Date | null;
  createdAt: Date; sentAt: Date | null; payload: unknown;
}): WebhookDeliveryView => ({
  id: d.id, endpointId: d.endpointId, eventId: d.eventId, eventType: d.eventType,
  projectId: d.projectId, status: d.status as WebhookDeliveryView["status"],
  attempt: d.attempt, maxAttempts: d.maxAttempts, httpStatus: d.httpStatus,
  durationMs: d.durationMs, error: d.error,
  nextAttemptAt: d.nextAttemptAt?.toISOString() ?? null,
  createdAt: d.createdAt.toISOString(), sentAt: d.sentAt?.toISOString() ?? null,
  payload: d.payload,
});

export default async function (app: FastifyInstance) {
  app.get("/webhooks", async () => {
    const rows = await prisma.webhookEndpoint.findMany({ orderBy: { createdAt: "asc" } }) as unknown as EndpointRow[];
    const endpoints = [];
    for (const r of rows) endpoints.push(endpointView(r, await pendingOf(r.id)));
    return { endpoints, eventTypes: [...KNOWN] };
  });

  app.post("/webhooks", async (req, reply) => {
    const parsed = zCreateWebhookEndpoint.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const p = parsed.data;

    const unknown = unknownEvents(p.events);
    if (unknown.length) return reply.code(400).send({ error: "jenis peristiwa tak dikenal", unknown });
    const urlErr = await checkUrl(p.url, p.allowPrivate ?? false);
    if (urlErr) return reply.code(400).send({ error: urlErr });

    const secret = p.secret ?? newSecret();
    const row = await prisma.webhookEndpoint.create({ data: {
      name: p.name, url: p.url.trim(), secret: encryptEndpointSecret(secret),
      events: p.events as never, projectIds: (p.projectIds ?? null) as never,
      enabled: p.enabled ?? true, allowPrivate: p.allowPrivate ?? false,
      ...(p.maxPerMinute !== undefined ? { maxPerMinute: p.maxPerMinute } : {}),
    } }) as unknown as EndpointRow;
    // Cache WAJIB disegarkan tiap mutasi — itulah "berlaku tanpa restart".
    await refreshWebhookCache();
    // Secret plaintext SEKALI seumur hidup (pola AgentToken).
    return reply.code(201).send(endpointView(row, 0, secret));
  });

  app.patch("/webhooks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zUpdateWebhookEndpoint.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const p = parsed.data;

    const existing = await prisma.webhookEndpoint.findUnique({ where: { id } }) as unknown as EndpointRow | null;
    if (!existing) return reply.code(404).send({ error: "not found" });

    if (p.events) {
      const unknown = unknownEvents(p.events);
      if (unknown.length) return reply.code(400).send({ error: "jenis peristiwa tak dikenal", unknown });
    }
    const url = p.url ?? existing.url;
    const allowPrivate = p.allowPrivate ?? existing.allowPrivate;
    if (p.url !== undefined || p.allowPrivate !== undefined) {
      const urlErr = await checkUrl(url, allowPrivate);
      if (urlErr) return reply.code(400).send({ error: urlErr });
    }

    const rotated = p.rotateSecret ? newSecret() : p.secret;
    // Mengaktifkan ulang = memberi kesempatan baru: jejak nonaktif & streak dibersihkan, kalau tidak
    // satu kegagalan berikutnya langsung mematikannya lagi (streak sudah di ambang).
    const reviving = p.enabled === true && !existing.enabled;

    const row = await prisma.webhookEndpoint.update({ where: { id }, data: {
      ...(p.name !== undefined ? { name: p.name } : {}),
      ...(p.url !== undefined ? { url: p.url.trim() } : {}),
      ...(p.events !== undefined ? { events: p.events as never } : {}),
      ...(p.projectIds !== undefined ? { projectIds: (p.projectIds ?? null) as never } : {}),
      ...(p.enabled !== undefined ? { enabled: p.enabled } : {}),
      ...(p.allowPrivate !== undefined ? { allowPrivate: p.allowPrivate } : {}),
      ...(p.maxPerMinute !== undefined ? { maxPerMinute: p.maxPerMinute } : {}),
      ...(rotated ? { secret: encryptEndpointSecret(rotated) } : {}),
      ...(reviving ? { disabledAt: null, disabledReason: null, failureStreak: 0 } : {}),
    } }) as unknown as EndpointRow;
    await refreshWebhookCache();
    return endpointView(row, await pendingOf(id), rotated);
  });

  app.delete("/webhooks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await prisma.webhookEndpoint.findUnique({ where: { id } })))
      return reply.code(404).send({ error: "not found" });
    await prisma.webhookEndpoint.delete({ where: { id } });   // deliveries ikut cascade
    await refreshWebhookCache();
    return reply.code(204).send();
  });

  // Uji koneksi SINKRON: ini aksi operator yang menunggu jawaban, bukan peristiwa produk. Tetap
  // mencatat baris riwayat supaya hasilnya bisa dibaca lagi nanti.
  app.post("/webhooks/:id/test", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await prisma.webhookEndpoint.findUnique({ where: { id } }) as unknown as EndpointRow | null;
    if (!row) return reply.code(404).send({ error: "not found" });
    if (!secretOf(row)) return reply.code(409).send({ error: "secret tak bisa dibuka — rotasi dulu" });

    const eventId = `evt_ping_${Date.now().toString(36)}`;
    const envelope = {
      specVersion: WEBHOOK_SPEC_VERSION, id: eventId, type: WEBHOOK_PING_TYPE,
      createdAt: new Date().toISOString(), project: null,
      actor: { kind: "user", id: null, label: req.user?.email ?? "operator" },
      data: { entity: "webhook", id: row.id, action: "created", changed: [],
        before: null, after: { endpoint: row.name, message: "ping dari hanoman" } },
      truncated: false, truncatedFields: [],
    };
    const body = JSON.stringify(envelope);
    const delivery = await prisma.webhookDelivery.create({ data: {
      endpointId: row.id, eventId, eventType: WEBHOOK_PING_TYPE, payload: envelope as never,
      status: "sending", attempt: 1, maxAttempts: WEBHOOK_MAX_ATTEMPTS,
    } });

    const res = await sendOnce({
      endpoint: normalize(row), deliveryId: delivery.id, eventId,
      eventType: WEBHOOK_PING_TYPE, attempt: 1, body,
    });
    await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: {
      // Ping yang gagal TIDAK diulang: operator sedang berdiri di depannya dan akan menekan lagi.
      status: res.ok ? "sent" : "failed",
      httpStatus: res.httpStatus, durationMs: res.durationMs, error: res.error,
      sentAt: res.ok ? new Date() : null,
    } });
    const out: WebhookTestResult = {
      ok: res.ok, httpStatus: res.httpStatus, durationMs: res.durationMs, error: res.error,
    };
    return out;
  });

  app.get("/webhooks/:id/deliveries", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await prisma.webhookEndpoint.findUnique({ where: { id } })))
      return reply.code(404).send({ error: "not found" });
    const limit = Math.min(Math.max(Number((req.query as { limit?: string }).limit) || 50, 1), 200);
    const rows = await prisma.webhookDelivery.findMany({
      where: { endpointId: id }, orderBy: { createdAt: "desc" }, take: limit,
    });
    return { items: rows.map(deliveryView) };
  });

  app.post("/webhooks/deliveries/:id/retry", async (req, reply) => {
    const { id } = req.params as { id: string };
    const d = await prisma.webhookDelivery.findUnique({ where: { id } });
    if (!d) return reply.code(404).send({ error: "not found" });
    if (d.status === "pending" || d.status === "sending")
      return reply.code(409).send({ error: "masih dalam antrean" });
    const row = await prisma.webhookDelivery.update({ where: { id }, data: {
      status: "pending", attempt: 0, nextAttemptAt: null, error: null,
      httpStatus: null, durationMs: null, sentAt: null,
    } });
    return deliveryView(row);
  });
}
```

- [x] **Step 5: Daftarkan route di `app.ts`**

Tambah import `import webhooks from "./routes/webhooks";` dan, setelah
`await api.register(telegram);`:

```ts
    await api.register(webhooks);     // SPEC-481 · ADR-0100 · webhook keluar (cookie-only)
```

- [x] **Step 6: Tambah path helper di `shared/src/api.ts`**

Di dalam objek `paths`, setelah baris `custom-agents`:

```ts
  // SPEC-481 · ADR-0100 · webhook keluar (cookie-only)
  webhooks: `${API}/webhooks`,
  webhook: (id: string) => `${API}/webhooks/${encodeURIComponent(id)}`,
  webhookTest: (id: string) => `${API}/webhooks/${encodeURIComponent(id)}/test`,
  webhookDeliveries: (id: string) => `${API}/webhooks/${encodeURIComponent(id)}/deliveries`,
  webhookDeliveryRetry: (id: string) => `${API}/webhooks/deliveries/${encodeURIComponent(id)}/retry`,
```

- [x] **Step 7: Tambah metode klien di `src/src/api/client.ts`**

Tambahkan tipe ke daftar import dari `@hanoman/shared`:
`type WebhookEndpointView, type WebhookDeliveryView, type WebhookTestResult, type CreateWebhookEndpoint, type UpdateWebhookEndpoint`.

Lalu, sebelum penutup objek `api` (setelah `deleteCustomAgent`):

```ts
  // SPEC-481 · ADR-0100 · webhook keluar. Semua cookie-only; tak ada jalur agent token.
  listWebhooks: () => j<{ endpoints: WebhookEndpointView[]; eventTypes: string[] }>(paths.webhooks),
  createWebhook: (b: CreateWebhookEndpoint) =>
    j<WebhookEndpointView>(paths.webhooks, { method: "POST", ...body(b) }),
  updateWebhook: (id: string, b: UpdateWebhookEndpoint) =>
    j<WebhookEndpointView>(paths.webhook(id), { method: "PATCH", ...body(b) }),
  deleteWebhook: (id: string) => j<void>(paths.webhook(id), { method: "DELETE" }),
  testWebhook: (id: string) => j<WebhookTestResult>(paths.webhookTest(id), { method: "POST", ...body({}) }),
  listWebhookDeliveries: (id: string, limit = 50) =>
    j<{ items: WebhookDeliveryView[] }>(paths.webhookDeliveries(id) + qs({ limit })),
  retryWebhookDelivery: (id: string) =>
    j<WebhookDeliveryView>(paths.webhookDeliveryRetry(id), { method: "POST", ...body({}) }),
```

- [x] **Step 8: Jalankan test sampai hijau**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism --dir server \
  server/test/webhook-routes.test.ts server/test/agent-capabilities.test.ts
pnpm --filter ./server typecheck && pnpm --filter ./shared typecheck
```
Expected: PASS; typecheck keluar 0.

- [x] **Step 9: Commit**

```bash
git add server/src/routes/webhooks.ts server/src/app.ts server/src/services/agent-capabilities.ts \
        shared/src/api.ts src/src/api/client.ts server/test/webhook-routes.test.ts
git commit -m "feat(481): endpoint /api/webhooks cookie-only + klien"
```

---

### Task 10: Panel Settings → Webhook

**Files:**
- Create: `src/src/screens/WebhooksPanel.tsx`
- Create: `src/src/screens/WebhooksPanel.test.tsx`
- Modify: `src/src/screens/SettingsScreen.tsx` (`S_SECTIONS` + cabang `content`)

**Interfaces:**
- Consumes: `api.listWebhooks/createWebhook/updateWebhook/deleteWebhook/testWebhook/
  listWebhookDeliveries/retryWebhookDelivery` (Task 9); `WEBHOOK_EVENTS` (Task 1); DS
  (`Card`, `Button`, `Input`, `Select`, `Switch`, `Checkbox`, `Badge`, `StateBlock`,
  `ConfirmDialog`, `Field`, `Icon`).
- Produces: `<WebhooksPanel onToast={…} onOpenDocs={() => void} />`.

- [x] **Step 1: Tulis test yang gagal**

Buat `src/src/screens/WebhooksPanel.test.tsx`:

```tsx
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebhooksPanel } from "./WebhooksPanel";

const endpoint = {
  id: "w1", name: "Dashboard internal", url: "https://contoh.id/hook",
  events: ["spec.*"], projectIds: null, enabled: true, allowPrivate: false, apiVersion: 1,
  secretHint: "9f2c", disabledAt: null, disabledReason: null,
  lastSuccessAt: "2026-08-01T09:00:00.000Z", lastFailureAt: null, failureStreak: 0, pending: 0,
  createdAt: "2026-08-01T08:00:00.000Z", updatedAt: "2026-08-01T09:00:00.000Z",
};
const delivery = {
  id: "d1", endpointId: "w1", eventId: "evt_1", eventType: "spec.stage_changed", projectId: "hanoman",
  status: "failed", attempt: 6, maxAttempts: 6, httpStatus: 500, durationMs: 120,
  error: "HTTP 500", nextAttemptAt: null, createdAt: "2026-08-01T09:10:00.000Z",
  sentAt: null, payload: {},
};

const json = (value: unknown, statusCode = 200) =>
  Promise.resolve({ ok: statusCode < 400, status: statusCode, json: async () => value } as Response);

function mockFetch(over: Record<string, unknown> = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url.endsWith("/deliveries")) return json({ items: [delivery] });
    if (url.endsWith("/test")) return json(over.test ?? { ok: true, httpStatus: 200, durationMs: 88, error: null });
    if (url.endsWith("/api/webhooks")) return json({ endpoints: over.endpoints ?? [endpoint], eventTypes: ["spec.created"] });
    return json({});
  });
}

afterEach(() => vi.restoreAllMocks());

describe("WebhooksPanel", () => {
  it("menampilkan endpoint beserta URL dan petunjuk secret, tanpa secret utuh", async () => {
    mockFetch();
    render(<WebhooksPanel />);
    expect(await screen.findByText("Dashboard internal")).toBeTruthy();
    expect(screen.getByText(/contoh\.id\/hook/)).toBeTruthy();
    expect(screen.getByText(/9f2c/)).toBeTruthy();
  });

  it("keadaan kosong mengajak membuat endpoint pertama", async () => {
    mockFetch({ endpoints: [] });
    render(<WebhooksPanel />);
    expect(await screen.findByText(/belum ada endpoint/i)).toBeTruthy();
  });

  it("endpoint yang dinonaktifkan otomatis diberi penanda beserta alasannya", async () => {
    mockFetch({ endpoints: [{ ...endpoint, enabled: false, disabledAt: "2026-08-01T09:30:00.000Z",
      disabledReason: "5 pengiriman gagal beruntun" }] });
    render(<WebhooksPanel />);
    expect(await screen.findByText(/dinonaktifkan otomatis/i)).toBeTruthy();
    expect(screen.getByText(/5 pengiriman gagal beruntun/)).toBeTruthy();
  });

  it("tombol Test mengirim ping dan melaporkan hasilnya", async () => {
    const f = mockFetch();
    render(<WebhooksPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /test/i }));
    await waitFor(() => expect(f.mock.calls.some(([u, i]) =>
      String(u).endsWith("/test") && (i as RequestInit)?.method === "POST")).toBe(true));
    expect(await screen.findByText(/HTTP 200/)).toBeTruthy();
  });

  it("tombol Test yang gagal memperlihatkan pesan galatnya, bukan sekadar `gagal`", async () => {
    mockFetch({ test: { ok: false, httpStatus: null, durationMs: 10_002, error: "timeout 10000 ms" } });
    render(<WebhooksPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /test/i }));
    expect(await screen.findByText(/timeout 10000 ms/)).toBeTruthy();
  });

  it("riwayat pengiriman memperlihatkan status, kode HTTP, percobaan, dan galat", async () => {
    mockFetch();
    render(<WebhooksPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /riwayat/i }));
    expect(await screen.findByText("spec.stage_changed")).toBeTruthy();
    expect(screen.getByText("500")).toBeTruthy();
    expect(screen.getByText(/6\s*\/\s*6/)).toBeTruthy();
    expect(screen.getByText("HTTP 500")).toBeTruthy();
  });

  it("menautkan halaman dokumentasi", async () => {
    mockFetch();
    const onOpenDocs = vi.fn();
    render(<WebhooksPanel onOpenDocs={onOpenDocs} />);
    fireEvent.click(await screen.findByRole("button", { name: /dokumentasi webhook/i }));
    expect(onOpenDocs).toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Jalankan untuk memastikan gagal**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run --dir src src/src/screens/WebhooksPanel.test.tsx
```
Expected: FAIL — komponen belum ada.

- [x] **Step 3: Tulis `src/src/screens/WebhooksPanel.tsx`**

Bangun komponen dengan struktur ini (ikuti design system: `Card` untuk tiap blok, `SettingRow`
tidak tersedia di luar `SettingsScreen` jadi pakai baris flex sendiri, warna dari token CSS
`var(--text-muted)` / `var(--brass-700)` / `var(--status-err-tint)`):

```tsx
import React from "react";
import { Badge, Button, Card, Checkbox, ConfirmDialog, Field, Icon, Input, StateBlock, Switch } from "../ds";
import type { ShowToast } from "../ds";
import { api } from "../api/client";
import { WEBHOOK_EVENTS } from "@hanoman/shared";
import type { WebhookDeliveryView, WebhookEndpointView, WebhookTestResult } from "@hanoman/shared";

// SPEC-481 · ADR-0100 · pengelolaan endpoint webhook. Daftar jenis peristiwa dibaca dari KATALOG
// (@hanoman/shared) — sumber yang sama dengan pengirimnya, jadi pilihan di sini tak bisa basi.

type Draft = {
  id?: string; name: string; url: string; events: string[];
  projectIds: string[] | null; enabled: boolean; allowPrivate: boolean;
};
const EMPTY: Draft = { name: "", url: "", events: ["*"], projectIds: null, enabled: true, allowPrivate: false };

const FAMILIES = [...new Set(WEBHOOK_EVENTS.map((e) => e.entity))];

export function WebhooksPanel({ onToast, onOpenDocs }:
  { onToast?: ShowToast; onOpenDocs?: () => void } = {}) {
  const [rows, setRows] = React.useState<WebhookEndpointView[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [secretOnce, setSecretOnce] = React.useState<string | null>(null);
  const [testing, setTesting] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<Record<string, WebhookTestResult>>({});
  const [historyFor, setHistoryFor] = React.useState<string | null>(null);
  const [history, setHistory] = React.useState<WebhookDeliveryView[]>([]);
  const [doomed, setDoomed] = React.useState<WebhookEndpointView | null>(null);

  const load = React.useCallback(async () => {
    try { setRows((await api.listWebhooks()).endpoints); setFailed(false); }
    catch { setFailed(true); }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  // … handler: save(draft), remove(id), test(id), openHistory(id), retry(deliveryId), toggle(id, on)

  return (
    <>
      <Card eyebrow="integrasi" title="Webhook keluar">
        {/* Paragraf pengantar + tombol "Dokumentasi webhook" (onClick={onOpenDocs}) */}
        {/* Daftar endpoint: nama · URL mono · pil status · secretHint · pending · tombol
            Test / Riwayat / Ubah / Hapus / Switch aktif */}
        {/* rows?.length === 0 → <StateBlock> "Belum ada endpoint webhook." */}
        {/* failed → <StateBlock> galat + tombol coba lagi */}
      </Card>
      {/* Card form draft (tambah/ubah): Field nama, Field URL, pemilih peristiwa
          (Checkbox "Semua peristiwa" + Checkbox per keluarga `${entity}.*` + daftar per jenis),
          Switch allowPrivate dengan peringatan SSRF, Switch aktif, tombol Simpan/Batal,
          tombol "Rotasi secret" saat mengubah */}
      {/* Card secretOnce: Callout brass "Salin sekarang — secret tak ditampilkan lagi" */}
      {/* Card riwayat saat historyFor: tabel waktu · jenis · status · HTTP · percobaan · durasi ·
          galat · tombol "Antre ulang" untuk baris failed/dropped */}
      <ConfirmDialog open={!!doomed} /* … */ />
    </>
  );
}
```

Aturan yang harus dipenuhi test (dan operator):
1. Pil status: `enabled` → `aktif`; `!enabled && disabledAt` → **`dinonaktifkan otomatis`** +
   `disabledReason` terbaca; `!enabled && !disabledAt` → `nonaktif`.
2. Hasil Test dirender sebagai teks: sukses → `HTTP <status> · <durationMs> ms`;
   gagal → pesan `error` **verbatim** (jangan diringkas jadi "gagal" — SPEC-472: alasan yang
   hilang membuat kegagalan tak bisa ditindaklanjuti).
3. Secret hanya muncul dari respons create/rotate, di satu `Callout`, dengan tombol salin;
   `secretHint` yang tampil di daftar.
4. Tabel riwayat menulis percobaan sebagai `${attempt}/${maxAttempts}`.
5. Tombol berlabel: `Test`, `Riwayat`, `Ubah`, `Hapus`, `Dokumentasi webhook`, `Antre ulang`.
6. Setiap mutasi memanggil `load()` lagi — daftar tak boleh basi setelah aksi.

- [x] **Step 4: Sambungkan ke `SettingsScreen.tsx`**

Di `S_SECTIONS`, setelah baris `telegram`:

```ts
  { key: "webhook", label: "Webhook", icon: "webhook" },       // SPEC-481 · ADR-0100 · webhook keluar
```

Tambah state di komponen: `const [webhookDocs, setWebhookDocs] = React.useState(false);`
dan di rantai `content`, sebelum `: prefs()`:

```tsx
    : tab === "webhook" ? (webhookDocs
      ? <WebhookDocs onBack={() => setWebhookDocs(false)} />
      : <WebhooksPanel onToast={onToast} onOpenDocs={() => setWebhookDocs(true)} />)
```

(`WebhookDocs` lahir di Task 11; untuk sementara buat stub `export function WebhookDocs() { return null; }`
di `src/src/screens/WebhookDocs.tsx` supaya task ini bisa dites sendiri, lalu isi di Task 11.)

Import keduanya di kepala berkas:

```ts
import { WebhooksPanel } from "./WebhooksPanel";
import { WebhookDocs } from "./WebhookDocs";
```

- [x] **Step 5: Jalankan test sampai hijau**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run --dir src \
  src/src/screens/WebhooksPanel.test.tsx src/src/screens/SettingsScreen.test.tsx
pnpm --filter ./src typecheck
```
Expected: PASS 7 test baru + SettingsScreen tetap hijau; typecheck keluar 0.

- [x] **Step 6: Commit**

```bash
git add src/src/screens/WebhooksPanel.tsx src/src/screens/WebhooksPanel.test.tsx \
        src/src/screens/WebhookDocs.tsx src/src/screens/SettingsScreen.tsx
git commit -m "feat(481): panel Settings untuk pengelolaan endpoint webhook"
```

---

### Task 11: Halaman dokumentasi in-app

Syarat mengikat brief: **tak satu pun daftar jenis peristiwa ditulis tangan di berkas ini.** Judul,
"kapan terpicu", dan contoh payload semuanya dibaca dari `WEBHOOK_EVENTS` / `sampleEnvelope()`.

**Files:**
- Modify: `src/src/screens/WebhookDocs.tsx` (isi stub dari Task 10)
- Create: `src/src/screens/WebhookDocs.test.tsx`

**Interfaces:**
- Consumes: `WEBHOOK_EVENTS`, `sampleEnvelope`, `WEBHOOK_BACKOFF_SEC`, `WEBHOOK_MAX_ATTEMPTS`,
  `WEBHOOK_FAIL_LIMIT`, `WEBHOOK_MAX_BYTES`, `WEBHOOK_TOLERANCE_SEC`, `WEBHOOK_HEADERS`.
- Produces: `<WebhookDocs onBack={() => void} />`.

- [x] **Step 1: Tulis test yang gagal**

Buat `src/src/screens/WebhookDocs.test.tsx`:

```tsx
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WEBHOOK_EVENTS, WEBHOOK_MAX_ATTEMPTS, WEBHOOK_TOLERANCE_SEC } from "@hanoman/shared";
import { WebhookDocs } from "./WebhookDocs";

describe("WebhookDocs", () => {
  it("mendaftar SETIAP jenis peristiwa dari katalog — tak ada yang ditulis tangan", () => {
    render(<WebhookDocs />);
    for (const e of WEBHOOK_EVENTS) expect(screen.getAllByText(e.type).length).toBeGreaterThan(0);
  });

  it("menyebut kapan tiap peristiwa terpicu", () => {
    render(<WebhookDocs />);
    for (const e of WEBHOOK_EVENTS) expect(screen.getByText(e.when)).toBeTruthy();
  });

  it("menampilkan contoh payload yang bisa disalin", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<WebhookDocs />);
    fireEvent.click(screen.getAllByRole("button", { name: /salin/i })[0]!);
    expect(writeText).toHaveBeenCalled();
    expect(String(writeText.mock.calls[0]![0])).toContain("hanoman.webhook/1");
  });

  it("memuat potongan verifikasi tanda tangan siap pakai untuk Node dan Python", () => {
    render(<WebhookDocs />);
    expect(screen.getByText(/createHmac/)).toBeTruthy();
    expect(screen.getByText(/timingSafeEqual/)).toBeTruthy();
    expect(screen.getByText(/hmac\.new/)).toBeTruthy();
    expect(screen.getByText(/compare_digest/)).toBeTruthy();
  });

  it("menyebut aturan retry, pengiriman ganda, dan idempotensi dengan angkanya", () => {
    render(<WebhookDocs />);
    expect(screen.getByText(new RegExp(String(WEBHOOK_MAX_ATTEMPTS)))).toBeTruthy();
    expect(screen.getByText(/idempoten/i)).toBeTruthy();
    expect(screen.getByText(new RegExp(String(WEBHOOK_TOLERANCE_SEC)))).toBeTruthy();
  });

  it("memuat panduan langkah demi langkah penerima pertama", () => {
    render(<WebhookDocs />);
    expect(screen.getByText(/penerima pertama/i)).toBeTruthy();
    expect(screen.getAllByText(/Langkah \d/).length).toBeGreaterThanOrEqual(4);
  });

  it("menyebut nama seluruh header kontrak", () => {
    render(<WebhookDocs />);
    for (const h of ["X-Hanoman-Event", "X-Hanoman-Event-Id", "X-Hanoman-Delivery",
      "X-Hanoman-Attempt", "X-Hanoman-Timestamp", "X-Hanoman-Signature"])
      expect(screen.getAllByText(new RegExp(h)).length).toBeGreaterThan(0);
  });

  it("tombol kembali memanggil onBack", () => {
    const onBack = vi.fn();
    render(<WebhookDocs onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /kembali/i }));
    expect(onBack).toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Jalankan untuk memastikan gagal**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run --dir src src/src/screens/WebhookDocs.test.tsx
```
Expected: FAIL — stub mengembalikan `null`.

- [x] **Step 3: Isi `src/src/screens/WebhookDocs.tsx`**

Struktur wajib (semua prosa Indonesia; blok kode dalam `<pre>` ber-`font-mono`):

```tsx
import React from "react";
import { Badge, Button, Callout, Card, Icon } from "../ds";
import {
  WEBHOOK_BACKOFF_SEC, WEBHOOK_EVENTS, WEBHOOK_FAIL_LIMIT, WEBHOOK_HEADERS,
  WEBHOOK_MAX_ATTEMPTS, WEBHOOK_MAX_BYTES, WEBHOOK_QUEUE_CAP, WEBHOOK_TOLERANCE_SEC,
  sampleEnvelope,
} from "@hanoman/shared";

// SPEC-481 · ADR-0100 · dokumentasi webhook DI DALAM aplikasi, dibangun dari katalog yang sama
// dengan pengirimnya. Tak ada daftar jenis peristiwa yang ditulis tangan di berkas ini — brief
// mensyaratkan dokumentasi yang tak bisa basi saat peristiwa baru ditambahkan.

function Copyable({ text }: { text: string }) { /* <pre> + tombol "Salin" → navigator.clipboard */ }

export function WebhookDocs({ onBack }: { onBack?: () => void } = {}) { /* … */ }
```

Bagian yang harus ada, berurutan:

1. **Kepala** — judul "Dokumentasi webhook", tombol `Kembali`, satu paragraf: apa itu webhook
   hanoman, arah satu-arah, amplop ber-versi `hanoman.webhook/1`.
2. **Daftar jenis peristiwa** — `WEBHOOK_EVENTS.map(...)`: `<code>{e.type}</code>`, `e.label`,
   `<Badge>{e.entityLabel}</Badge>`, dan `e.when` **verbatim** (test membandingkan persis).
   Kelompokkan per `entity`.
3. **Anatomi amplop** — tabel field (`id`, `type`, `createdAt`, `project`, `actor`, `data.entity`,
   `data.action`, `data.changed`, `data.before/after`, `truncated`) + catatan bahwa
   `spec.stage_changed` **menggantikan** `spec.updated`, dan cascade delete hanya melahirkan
   peristiwa induk.
4. **Contoh payload per jenis** — untuk setiap `e` render
   `<Copyable text={JSON.stringify(sampleEnvelope(e.type), null, 2)} />`.
5. **Header & verifikasi tanda tangan** — daftar `Object.values(WEBHOOK_HEADERS)`, rumus
   `HMAC-SHA256(secret, "<timestamp>.<raw body>")`, lalu dua potongan **siap tempel**:

```js
// Node.js (Express) — verifikasi tanda tangan webhook hanoman
import express from "express";
import { createHmac, timingSafeEqual } from "node:crypto";

const app = express();
const SECRET = process.env.HANOMAN_WEBHOOK_SECRET;
const TOLERANCE_SEC = 300;

app.post("/hanoman", express.raw({ type: "application/json" }), (req, res) => {
  const ts = Number(req.get("X-Hanoman-Timestamp"));
  const got = req.get("X-Hanoman-Signature") || "";
  if (!ts || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SEC) return res.sendStatus(400);

  const want = "v1=" + createHmac("sha256", SECRET).update(`${ts}.${req.body}`).digest("hex");
  const a = Buffer.from(want), b = Buffer.from(got);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return res.sendStatus(401);

  const event = JSON.parse(req.body.toString("utf8"));
  // Idempoten: retry mengirim event.id yang SAMA.
  if (alreadyHandled(event.id)) return res.sendStatus(200);
  handle(event);
  res.sendStatus(200);        // balas 2xx dulu, kerjakan yang berat di latar
});
```

```python
# Python (Flask) — verifikasi tanda tangan webhook hanoman
import hmac, hashlib, os, time
from flask import Flask, request, abort

app = Flask(__name__)
SECRET = os.environ["HANOMAN_WEBHOOK_SECRET"].encode()
TOLERANCE_SEC = 300

@app.post("/hanoman")
def hanoman():
    ts = request.headers.get("X-Hanoman-Timestamp", "")
    got = request.headers.get("X-Hanoman-Signature", "")
    if not ts.isdigit() or abs(time.time() - int(ts)) > TOLERANCE_SEC:
        abort(400)
    body = request.get_data()
    want = "v1=" + hmac.new(SECRET, f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(want, got):
        abort(401)
    event = request.get_json()
    if already_handled(event["id"]):   # retry membawa id yang sama
        return "", 200
    handle(event)
    return "", 200
```

6. **Retry & pengiriman ganda** — tabel `WEBHOOK_BACKOFF_SEC` (percobaan 1..N, jeda), sebutkan
   `WEBHOOK_MAX_ATTEMPTS` percobaan, kontrak **at-least-once**, dan aturan: *balas 2xx secepatnya;
   `410 Gone` menonaktifkan endpoint seketika; `WEBHOOK_FAIL_LIMIT` kegagalan beruntun
   menonaktifkan otomatis dan operator diberi notifikasi.* Tegaskan idempotensi lewat `event.id`,
   dan sebutkan toleransi `WEBHOOK_TOLERANCE_SEC` detik.
7. **Batas** — `WEBHOOK_MAX_BYTES` byte per amplop (dipangkas bertahap, ditandai `truncated`),
   batas laju per endpoint, `WEBHOOK_QUEUE_CAP` antrean (kelebihannya `dropped` dan **terlihat**
   di riwayat).
8. **Keamanan** — secret per endpoint disimpan terenkripsi & tak pernah dikembalikan utuh; data
   sensitif tak pernah masuk payload (allowlist field); alamat internal ditolak kecuali diizinkan
   eksplisit, dan pemeriksaannya berjalan tiap percobaan — **jendela DNS rebinding tetap ada,
   jangan menaruh penerima di jaringan yang tak Anda percayai.**
9. **Panduan penerima pertama** — minimal empat blok berlabel `Langkah 1` … `Langkah 4`:
   buat penerima (kode di atas) → jalankan & buka lewat URL publik → daftarkan di
   Settings → Webhook, salin secret → tekan **Test**, lalu cek riwayat pengiriman.

- [x] **Step 4: Jalankan test sampai hijau**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run --dir src \
  src/src/screens/WebhookDocs.test.tsx src/src/screens/WebhooksPanel.test.tsx
pnpm --filter ./src typecheck
```
Expected: PASS 8 test; typecheck keluar 0.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/WebhookDocs.tsx src/src/screens/WebhookDocs.test.tsx
git commit -m "feat(481): halaman dokumentasi webhook in-app dari katalog"
```

---

### Task 12: ADR-0100, docs Source of Truth, dan smoke end-to-end

**Files:**
- Create: `internal/docs/adr/0100-webhook-keluar-peristiwa.md`
- Modify: `internal/docs/README.md` (baris ADR + seksi integrasi)
- Modify: `internal/docs/adr/README.md` (narasi)
- Modify: `internal/docs/architecture/api-contract.md`
- Modify: `internal/docs/architecture/data-model.md`
- Modify: `internal/docs/security/security-standard.md`
- Modify: `internal/skills/hanoman/SKILL.md`

- [x] **Step 1: Klaim nomor ADR (enumerasi lintas branch — ADR-0021)**

```bash
git worktree list
for b in $(git for-each-ref --format='%(refname)' refs/heads refs/remotes); do
  git ls-tree -r --name-only "$b" -- internal/docs/adr; done \
  | sed -n 's#.*/\([0-9]\{4\}\)-.*#\1#p' | sort -u | tail -3
for w in ../*/internal/docs/adr; do ls "$w" 2>/dev/null | tail -2; done
```
Expected: tertinggi `0098`. Bila sudah ada `0099` di worktree/branch tetangga, **pakai nomor
berikutnya** dan ganti seluruh rujukan `0099` di spec, plan, dan kode komentar.

- [x] **Step 2: Tulis ADR**

Buat `internal/docs/adr/0100-webhook-keluar-peristiwa.md` dengan bagian:
**Status** (Diterima, 2026-08-01, SPEC-481) · **Konteks** (polling itu boros & selalu terlambat;
gateway Telegram ADR-0096 adalah bukti bahwa integrasi keluar terpaksa dibangun *di dalam*
hanoman) · **Keputusan** — enam butir:

1. **Sumber peristiwa = tap di layer Prisma**, satu client extension di `db.ts` atas katalog model
   yang dienumerasi. Alasannya kelas bug "satu definisi, N call site" yang sudah tiga kali dibayar
   (SPEC-431/448/475) dan yang paling licin justru pada **efek samping** — dan "pancarkan
   peristiwa" adalah efek samping murni.
2. **Katalog `WEBHOOK_ENTITIES` di `@hanoman/shared` menyetir tap DAN halaman dokumentasi.**
   Menambah peristiwa = menambah satu entri; dokumentasi karena itu tak bisa basi.
3. **Antrean = tabel SQLite + timer in-process** (`WebhookDelivery` merangkap antrean & riwayat),
   bukan message queue — **ADR-0024 tetap utuh**. `payload` disimpan per baris supaya retry
   mengirim byte identik dan riwayat memperlihatkan apa yang benar-benar dikirim.
4. **Amplop ber-versi sejak awal** (`hanoman.webhook/1` + `apiVersion` per endpoint), **allowlist
   field** sebagai pagar data sensitif sekaligus kontrak payload, dan **`spec.stage_changed`
   MENGGANTIKAN `spec.updated`** — satu perubahan, satu peristiwa.
5. **Kontrak at-least-once dengan `id` stabil.** Baris `sending` yang tertinggal crash **diulang**
   — sengaja **berlawanan** dengan `TelegramOutbox` (ADR-0096) yang memilih `uncertain`, karena di
   sana kembarannya adalah pesan ganda ke manusia sedangkan di sini penerima diwajibkan idempoten.
6. **Pengelolaan COOKIE_ONLY** (memegang secret + menentukan ke mana data mengalir), secret
   terenkripsi lewat `secret-box.ts` (ADR-0097), SSRF diperiksa **saat simpan dan tiap percobaan**.

Lalu **Konsekuensi** — termasuk yang pahit: cascade delete tingkat-DB tak terlihat (`data.cascade`
sebagai gantinya), `$executeRaw`/`createMany` di luar jangkauan (dijaga test penjaga), tap membayar
satu pre-read per tulisan **hanya saat ada endpoint aktif**, jendela DNS rebinding tetap ada,
notifikasi bertipe `webhook` sengaja tak difan-out. **Alternatif yang ditolak:** emit eksplisit di
call site (menghidupkan kembali kelas bug SPEC-475), polling diff periodik (changefeed kedua),
menumpang `SyncLog` (role-dependent: peran client tak menulis changefeed, jadi before/after hilang
justru di separuh topologi).

- [x] **Step 3: Tautkan di kedua index**

`internal/docs/README.md` — di seksi `## adr`, **di atas** baris 0098:

```markdown
- [0099 — Webhook keluar: tap Prisma sebagai satu sumber peristiwa, amplop ber-versi, antrean SQLite](adr/0100-webhook-keluar-peristiwa.md)
```

dan di seksi `## integrasi (untuk project yang memakai hanoman)`:

```markdown
- Webhook keluar — dokumentasinya hidup **di dalam aplikasi** (Settings → Webhook → Dokumentasi webhook), dibangun dari katalog `WEBHOOK_ENTITIES` yang sama dengan pengirimnya; tak ada salinan markdown yang bisa basi (SPEC-481 · ADR-0100)
```

`internal/docs/adr/README.md` — tambahkan narasi ADR-0100 di posisi paling atas daftar, mengikuti
gaya entri 0098 (apa yang diperluas/diamandemen + gotcha-nya).

- [x] **Step 4: Perbarui doc arsitektur & keamanan**

- `architecture/api-contract.md` — tujuh endpoint `/webhooks` (method, path, body, respons, catatan
  cookie-only + "secret hanya sekali").
- `architecture/data-model.md` — `WebhookEndpoint` & `WebhookDelivery`, **LOCAL-only**, alasan
  `payload` disimpan per baris, dan retensi `WEBHOOK_HISTORY_KEEP`.
- `security/security-standard.md` — tanda tangan `v1=HMAC-SHA256("<ts>.<body>")` + toleransi 300
  dtk, secret terenkripsi & tak pernah dikembalikan, allowlist field, pagar SSRF dua lapis berikut
  batasnya yang jujur, dan pengelolaan cookie-only.
- `internal/skills/hanoman/SKILL.md` — satu butir di **Aturan Arsitektur**, ±12 baris: tap sebagai
  choke point + gerbang cache + empat konsekuensi + kebijakan crash yang berlawanan dengan
  ADR-0096 + "notifikasi `webhook` tak difan-out".

- [x] **Step 5: Verifikasi integritas index**

```bash
node cli/dist/index.js docs index --check 2>/dev/null || pnpm --filter ./cli exec tsx src/index.ts docs index --check
```
Expected: tak ada doc yatim. Bila CLI belum ter-build, cukup pastikan setiap berkas baru ter-link
dari `internal/docs/README.md`.

- [x] **Step 6: Smoke end-to-end sungguhan (sekali, di akhir)**

Task ini menyentuh endpoint **dan** perilaku runtime, jadi wajib diuji nyata (bukan hanya unit).

Terminal A — penerima uji:

```bash
cat > /tmp/hanoman-webhook-receiver.mjs <<'JS'
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
const SECRET = process.env.SECRET;
createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const ts = req.headers["x-hanoman-timestamp"];
    const want = "v1=" + createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
    const got = String(req.headers["x-hanoman-signature"] || "");
    const a = Buffer.from(want), b = Buffer.from(got);
    const ok = a.length === b.length && timingSafeEqual(a, b);
    console.log(ok ? "OK  " : "BAD ", req.headers["x-hanoman-event"], String(body).slice(0, 120));
    res.writeHead(ok ? 200 : 401).end();
  });
}).listen(9911, () => console.log("penerima di :9911"));
JS
SECRET=ganti-setelah-endpoint-dibuat node /tmp/hanoman-webhook-receiver.mjs
```

Terminal B — server hanoman di DB & port khusus (jangan 8787, jangan DB test bersama):

```bash
export HANOMAN_HOME="$(mktemp -d)"
pnpm --filter ./server exec prisma migrate deploy
pnpm --filter ./server build && PORT=8801 node server/dist/server.js
```

Terminal C — jalankan skenarionya:

```bash
B=http://127.0.0.1:8801/api
curl -s -X POST $B/auth/setup -H 'content-type: application/json' \
  -d '{"email":"smoke@t.id","password":"rahasia-panjang-1"}' -c /tmp/hnm.jar >/dev/null
curl -s -X POST $B/projects -b /tmp/hnm.jar -H 'content-type: application/json' \
  -d '{"id":"smoke","name":"smoke","desc":"","kind":"web"}' >/dev/null

# allowPrivate WAJIB — penerima ada di loopback (pagar SSRF bekerja seperti seharusnya)
curl -s -X POST $B/webhooks -b /tmp/hnm.jar -H 'content-type: application/json' \
  -d '{"name":"lokal","url":"http://127.0.0.1:9911/hook","events":["*"],"allowPrivate":true}'
# → salin `secret`, restart Terminal A dengan SECRET=<nilai itu>

curl -s -X POST $B/webhooks/<ID>/test -b /tmp/hnm.jar          # → {"ok":true,"httpStatus":200,…}
curl -s -X POST $B/specs -b /tmp/hnm.jar -H 'content-type: application/json' \
  -d '{"projectId":"smoke","title":"uji webhook","source":"brief","priority":"sedang",
       "payload":{"context":"c","outcome":"o","constraints":"-","priority":"sedang"}}' >/dev/null
sleep 4
curl -s "$B/webhooks/<ID>/deliveries?limit=5" -b /tmp/hnm.jar
```

Yang harus terlihat:
1. Terminal A mencetak `OK   webhook.ping …` lalu `OK   spec.created …` — tanda tangan **cocok**.
2. `deliveries` menunjukkan dua baris `sent` ber-`httpStatus: 200`.
3. Matikan Terminal A, buat satu spec lagi, tunggu ±35 dtk → baris `pending` ber-`attempt: 1`
   dan `nextAttemptAt` **30 detik** setelah percobaan pertama. Hidupkan lagi penerima → jadi `sent`.
4. `curl -s $B/webhooks -b /tmp/hnm.jar | grep -c '"secret"'` → **0**.
5. Endpoint publik yang menunjuk internal ditolak:
   `curl -s -X POST $B/webhooks -b /tmp/hnm.jar -H 'content-type: application/json' -d '{"name":"x","url":"http://169.254.169.254/latest","events":["*"]}'`
   → 400 memuat `internal`.

Bereskan: `kill <pid>` per-PID (`lsof -ti:8801`, `lsof -ti:9911`). **Jangan** `pkill -f node` —
itu membunuh sesi tetangga (SPEC-402).

- [x] **Step 7: Jalankan seluruh test yang tersentuh spec ini**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism --dir server \
  server/test/webhook-catalog-dmmf.test.ts server/test/webhook-sign.test.ts \
  server/test/webhook-ssrf.test.ts server/test/webhook-actor.test.ts \
  server/test/webhook-endpoints.test.ts server/test/webhook-emit.test.ts \
  server/test/webhook-tap.test.ts server/test/webhook-no-raw-writes.test.ts \
  server/test/webhook-queue.test.ts server/test/webhook-routes.test.ts \
  server/test/agent-capabilities.test.ts server/test/app.test.ts
./node_modules/.bin/vitest --run shared/src/webhook.test.ts
env -u NODE_ENV ./node_modules/.bin/vitest --run --dir src \
  src/src/screens/WebhooksPanel.test.tsx src/src/screens/WebhookDocs.test.tsx \
  src/src/screens/SettingsScreen.test.tsx
pnpm --filter ./server typecheck && pnpm --filter ./shared typecheck && pnpm --filter ./src typecheck
```
Expected: semuanya hijau.

- [x] **Step 8: Commit & push**

```bash
git add internal/docs internal/skills
git commit -m "docs(481): ADR-0100 webhook keluar + docs SoT tersentuh"
git push origin HEAD:refs/heads/hanoman/spec-481
```

---

## Catatan untuk pelaksana

- **Jangan** menambah `emitWebhook()` di call site mana pun. Kalau sebuah perubahan tak muncul
  sebagai peristiwa, jawabannya ada di **katalog** atau di **tap** — bukan di penulisnya. Itu
  seluruh maksud spec ini.
- **Jangan** memakai `$executeRaw` atau `createMany` untuk model terlacak; `webhook-no-raw-writes`
  akan merah dan memang itu tugasnya.
- Tap membaca `webhooksActive()` pada **setiap** tulisan Prisma. Apa pun yang ditambahkan di jalur
  itu dibayar oleh seluruh aplikasi — jaga tetap satu pembacaan boolean.
