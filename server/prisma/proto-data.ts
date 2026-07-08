// Typed transcription of .prototype/app/data.js (window.HN) for seeding.
// Mapping per ADR-0004 + SPEC-001 plan:
//  - Project: stored cols only (drop UI-only run/backlog/topStage/triggers/
//    activity/commit); keep `stack`. createdAt defaults now().
//  - Spec: extra brief/qa fields fold into `payload`; demo specs carry only
//    `objective`, so payload is omitted (stored NULL).
//  - Run: worktree/branchFrom/branchTo are the values data.js derives at load;
//    title/startedAt/duration are UI-only and not in the schema.
import type { Prisma } from "@prisma/client";
import type { Setting } from "@hanoman/shared";
import { DOC_CONTENT } from "./proto-doc-content";

export const projects: Prisma.ProjectCreateManyInput[] = [
  { id: "sembada", name: "sembada", desc: "SaaS invoicing & pajak untuk UKM",
    kind: "from-scratch", stack: "Next.js · Postgres", docStatus: "drift", coverage: 62 },
  { id: "arta", name: "arta", desc: "Ledger pembayaran & wallet",
    kind: "existing", stack: "Go · Postgres", docStatus: "ok", coverage: 94 },
  { id: "loka-pos", name: "loka-pos", desc: "POS ritel + inventori",
    kind: "existing", stack: "TypeScript · SQLite", docStatus: "drift", coverage: 75 },
  { id: "wanara", name: "wanara", desc: "Admin operasional internal",
    kind: "existing", stack: "Python · Postgres", docStatus: "ok", coverage: 100 },
  { id: "candra", name: "candra", desc: "Analitik produk",
    kind: "existing", stack: "TypeScript · ClickHouse", docStatus: "broken", coverage: 38 },
  { id: "gapura", name: "gapura", desc: "API gateway & auth",
    kind: "from-scratch", stack: "Rust · Redis", docStatus: "ok", coverage: 88 },
];

export const backlog: Prisma.SpecCreateManyInput[] = [
  { id: "SPEC-142", projectId: "arta", title: "Saldo wallet multi-currency",
    source: "brief", stage: "planned", author: "Rangga", priority: "sedang",
    objective: "Simpan & tampilkan saldo per mata uang, FX dihitung saat display." },
  { id: "SPEC-141", projectId: "candra", title: "Funnel double-count sesi lintas tengah malam",
    source: "qa", stage: "spec-ready", author: "QA · Dinda", priority: "tinggi",
    objective: "Sesi yang melewati UTC midnight terhitung dua kali di funnel step 3." },
  { id: "SPEC-140", projectId: "sembada", title: "Jadwal invoice berulang",
    source: "brief", stage: "brainstorming", author: "Rangga", priority: "sedang",
    objective: "— masih memperjelas cadence, proration, dan dunning sebelum spec." },
  { id: "SPEC-139", projectId: "loka-pos", title: "Konflik sync offline pada stock count",
    source: "qa", stage: "objective", author: "QA · Bima", priority: "tinggi",
    objective: "Dua terminal mengedit SKU yang sama secara offline saling menimpa diam-diam." },
  { id: "SPEC-138", projectId: "arta", title: "Retry webhook dengan backoff",
    source: "brief", stage: "executing", author: "Rangga", priority: "sedang",
    objective: "Exponential backoff + dead-letter setelah 6 attempt." },
  { id: "SPEC-137", projectId: "gapura", title: "Rotasi signing key tanpa downtime",
    source: "brief", stage: "done", author: "Sekar", priority: "rendah",
    objective: "Jendela dua-kunci; kunci lama tetap valid 24 jam setelah rotasi." },
];

export const runs: Prisma.RunCreateManyInput[] = [
  { id: "RUN-8842", projectId: "arta", specId: "SPEC-138", kind: "feature",
    status: "running", trigger: "commit", triggerDetail: "push a1b2c3 → main",
    phases: [
      { name: "Brainstorm", state: "done" }, { name: "Objective", state: "done" },
      { name: "Spec", state: "done" }, { name: "Plan", state: "done" },
      { name: "Execute", state: "active" },
    ],
    plan: [
      { label: "Retry queue (BullMQ)", state: "done" },
      { label: "Skema tabel dead_letter", state: "done" },
      { label: "Util exponential backoff", state: "done" },
      { label: "Wire producer → queue", state: "done" },
      { label: "Consumer + 6× retry", state: "active" },
      { label: "Dead-letter setelah 6 attempt", state: "pending" },
      { label: "Test integrasi + update docs", state: "pending" },
    ],
    files: [
      { path: "src/queue/retry.ts", add: 84, del: 2, status: "modified" },
      { path: "src/db/migrations/0007_dead_letter.sql", add: 31, del: 0, status: "added" },
      { path: "src/webhooks/dispatch.ts", add: 22, del: 14, status: "modified" },
      { path: "internal/docs/architecture/api-contract.md", add: 12, del: 3, status: "modified" },
    ],
    log: [
      { t: "$", s: "hanoman execute SPEC-138 --project arta" },
      { t: "›", s: "plan dimuat · 7 langkah" },
      { t: "✓", s: "langkah 4/7 · retry queue tersambung" },
      { t: "›", s: "langkah 5/7 · consumer + backoff…" },
    ],
    worktree: ".worktrees/run-8842", branchFrom: "main", branchTo: "feat/webhook-retry",
    model: "sonnet-4.5", tokensIn: "128.4k", tokensOut: "39.7k", cost: "$0.82", progress: 68 },

  { id: "RUN-8841", projectId: "sembada", specId: null, kind: "scaffold",
    status: "running", trigger: "manual", triggerDetail: "Rangga",
    phases: [
      { name: "Brainstorm", state: "done" }, { name: "Objective", state: "done" },
      { name: "Doc index", state: "active" },
    ],
    plan: [], files: [],
    log: [
      { t: "$", s: "hanoman scaffold --project sembada" },
      { t: "✓", s: "MVP objective terkunci" },
      { t: "›", s: "menulis internal/docs/** · 14/34" },
    ],
    worktree: ".worktrees/run-8841", branchFrom: "main", branchTo: "chore/scaffold-docs",
    model: "sonnet-4.5", tokensIn: "64.1k", tokensOut: "51.9k", cost: "$0.61", progress: 41 },

  { id: "RUN-8838", projectId: "candra", specId: "SPEC-141", kind: "qa",
    status: "failed", trigger: "schedule", triggerDetail: "nightly 02:00",
    phases: [
      { name: "Audit", state: "done" }, { name: "Spec", state: "done" },
      { name: "Plan", state: "failed" }, { name: "Execute", state: "pending" },
    ],
    plan: [], files: [],
    log: [
      { t: "$", s: "hanoman qa SPEC-141 --project candra" },
      { t: "✗", s: "plan diblok · data-model.md tak punya session TZ" },
      { t: " ", s: "exit 1 · docs stale (Source of Truth)" },
    ],
    worktree: ".worktrees/run-8838", branchFrom: "main", branchTo: "fix/funnel-tz",
    model: "sonnet-4.5", tokensIn: "92.7k", tokensOut: "18.3k", cost: "$0.44", progress: 55 },

  { id: "RUN-8835", projectId: "gapura", specId: "SPEC-137", kind: "feature",
    status: "done", trigger: "interval", triggerDetail: "setiap 6 jam",
    phases: [
      { name: "Brainstorm", state: "done" }, { name: "Objective", state: "done" },
      { name: "Spec", state: "done" }, { name: "Plan", state: "done" },
      { name: "Execute", state: "done" },
    ],
    plan: [], files: [],
    log: [
      { t: "$", s: "hanoman execute SPEC-137 --project gapura" },
      { t: "✓", s: "9 langkah selesai · test hijau" },
      { t: "✓", s: "docs diperbarui · index sinkron" },
    ],
    worktree: ".worktrees/run-8835", branchFrom: "main", branchTo: "feat/key-rotation",
    model: "sonnet-4.5", tokensIn: "141.2k", tokensOut: "58.0k", cost: "$1.04", progress: 100 },

  { id: "RUN-8830", projectId: "loka-pos", specId: "SPEC-139", kind: "qa",
    status: "queued", trigger: "commit", triggerDetail: "push 9f1e07 → develop",
    phases: [
      { name: "Audit", state: "pending" }, { name: "Spec", state: "pending" },
      { name: "Plan", state: "pending" }, { name: "Execute", state: "pending" },
    ],
    plan: [], files: [],
    log: [
      { t: "$", s: "hanoman qa SPEC-139 --project loka-pos" },
      { t: " ", s: "antre · menunggu runner…" },
    ],
    worktree: ".worktrees/run-8830", branchFrom: "develop", branchTo: "fix/offline-sync",
    model: "sonnet-4.5", tokensIn: "—", tokensOut: "—", cost: "—", progress: 0 },
];

export const triggers: Prisma.TriggerCreateManyInput[] = [
  { id: "t1", projectId: "arta", type: "commit", detail: "push → main", target: "plan + execute", enabled: true },
  { id: "t2", projectId: "arta", type: "schedule", detail: "nightly 02:00", target: "audit", enabled: true },
  { id: "t3", projectId: "sembada", type: "manual", detail: "on demand", target: "scaffold docs", enabled: true },
  { id: "t4", projectId: "candra", type: "schedule", detail: "nightly 02:00", target: "qa audit", enabled: false },
  { id: "t5", projectId: "gapura", type: "interval", detail: "setiap 6 jam", target: "plan + execute", enabled: true },
  { id: "t6", projectId: "loka-pos", type: "commit", detail: "push → develop", target: "audit", enabled: true },
];

// data-model.md §Settings defaults, coerced to the zSetting shape (numbers, not
// the prototype's string form). opus / x-high per pipeline step.
const STEP = { model: "claude-opus-4-8", effort: "xhigh" };
export const defaultSetting: Setting = {
  steps: { brainstorm: STEP, spec: STEP, plan: STEP, execute: STEP, audit: STEP },
  autoDefault: true, blockStale: true, requireLinks: true, autoScaffold: true,
  maxConcurrent: 3, dailyBudget: 50, notifyFail: true,
};

// loka-pos Source-of-Truth tree (data.js docTree). Each category is uniformly
// linked/unlinked in the demo, so coverageOf → linked categories / total.
type Cat = { cat: string; files: string[]; linked: boolean; root?: boolean };
const lokaTree: Cat[] = [
  { cat: "entrypoints", files: ["blueprint.md", "brd.md", "prd.md", "frd.md", "rd.md"], linked: true },
  { cat: "product", files: ["blueprint.md", "scope-principles.md", "onboarding.md"], linked: true },
  { cat: "business", files: ["brd.md", "pricing-rationale.md"], linked: true },
  { cat: "requirements", files: ["prd.md", "frd.md", "rd.md", "acceptance-criteria-ears-standard.md"], linked: true },
  { cat: "research", files: ["market-sizing.md", "competitor-analysis.md", "moat.md"], linked: false },
  { cat: "architecture", files: ["stack.md", "data-model.md", "api-contract.md", "nfr.md"], linked: true },
  { cat: "adr", files: ["0001-inventory-events.md", "0002-offline-sync.md"], linked: true },
  { cat: "operations", files: ["roadmap.md", "gtm.md", "agent-documentation-workflow.md"], linked: true },
  { cat: "security", files: ["security-standard.md"], linked: false },
  { cat: "brand", files: ["brand-strategy.md", "color.md", "pattern-system.md"], linked: false },
  { cat: "frontend", files: ["frontend-implementation.md"], linked: true },
  { cat: "design-system", files: ["design-system.md", "implementation-plan.md"], linked: true },
  { cat: "agents", root: true, files: ["AGENTS.md", "CLAUDE.md", "README.md", ".claude/settings.json", ".codex/config.toml"], linked: true },
];

const lokaDocs: Prisma.DocFileCreateManyInput[] = lokaTree.flatMap((c) =>
  c.files.map((f) => {
    const path = `${c.cat}/${f}`;
    return { projectId: "loka-pos", path, category: c.cat,
      content: DOC_CONTENT[path] ?? `# ${f}\n`, linked: c.linked, root: c.root ?? false };
  })
);

// ponytail: other projects get a placeholder SoT index (all-linked) so their
// Docs tab renders. `scan` would recompute their coverage to 100 until real
// repo docs arrive in SPEC-003; the stored card values stay until then.
const SOT_CATS = ["entrypoints", "product", "business", "requirements", "research",
  "architecture", "adr", "operations", "security", "design-system", "frontend"];
const otherDocs: Prisma.DocFileCreateManyInput[] = projects
  .filter((p) => p.id !== "loka-pos")
  .flatMap((p) => SOT_CATS.map((cat) => ({
    projectId: p.id!, path: `${cat}/index.md`, category: cat,
    content: `# ${cat}\n`, linked: true, root: false,
  })));

export const docFiles: Prisma.DocFileCreateManyInput[] = [...lokaDocs, ...otherDocs];
