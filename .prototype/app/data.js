/* ============================================================
   Hanoman — mock data for nafanesia.id's Claude Code orchestrator.
   Docs-driven workflow: brainstorm → objective → spec → plan →
   execute, monitored across every project. Copy is mixed-language:
   Indonesian narrative, English for the technical vocabulary
   (spec / plan / execute / commit / trigger / Source of Truth …).
   Project names here are illustrative placeholders — swap for the
   real nafanesia.id projects.
   ============================================================ */
window.HN = {
  owner: { name: "Rangga", initials: "Ra", role: "Founder · nafanesia.id" },

  projects: [
    {
      id: "sembada", name: "sembada", desc: "SaaS invoicing & pajak untuk UKM",
      kind: "from-scratch", stack: "Next.js · Postgres",
      docStatus: "drift", coverage: 62,
      run: { status: "running", phase: "Doc index", kind: "scaffold" },
      backlog: 4, topStage: "brainstorm", triggers: ["manual"],
      activity: "scaffold docs · baru saja", commit: "belum ada commit",
    },
    {
      id: "arta", name: "arta", desc: "Ledger pembayaran & wallet",
      kind: "existing", stack: "Go · Postgres",
      docStatus: "ok", coverage: 94,
      run: { status: "running", phase: "Execute", kind: "feature" },
      backlog: 6, topStage: "execute", triggers: ["commit", "schedule", "interval"],
      activity: "execute SPEC-138 · 2 mnt", commit: "push a1b2c3 → main",
    },
    {
      id: "loka-pos", name: "loka-pos", desc: "POS ritel + inventori",
      kind: "existing", stack: "TypeScript · SQLite",
      docStatus: "drift", coverage: 75,
      run: { status: "queued", phase: "Audit", kind: "qa" },
      backlog: 3, topStage: "audit", triggers: ["commit"],
      activity: "antre di runner · 5 mnt", commit: "push 9f1e07 → develop",
    },
    {
      id: "wanara", name: "wanara", desc: "Admin operasional internal",
      kind: "existing", stack: "Python · Postgres",
      docStatus: "ok", coverage: 100,
      run: { status: "idle", phase: null, kind: null },
      backlog: 1, topStage: "spec", triggers: ["schedule", "manual"],
      activity: "idle · 3 jam", commit: "push 4c2d81 → main",
    },
    {
      id: "candra", name: "candra", desc: "Analitik produk",
      kind: "existing", stack: "TypeScript · ClickHouse",
      docStatus: "broken", coverage: 38,
      run: { status: "failed", phase: "Plan", kind: "qa" },
      backlog: 5, topStage: "plan", triggers: ["schedule"],
      activity: "plan gagal · 26 mnt", commit: "push 7b3a55 → main",
    },
    {
      id: "gapura", name: "gapura", desc: "API gateway & auth",
      kind: "from-scratch", stack: "Rust · Redis",
      docStatus: "ok", coverage: 88,
      run: { status: "done", phase: "Execute", kind: "feature" },
      backlog: 2, topStage: "done", triggers: ["commit", "schedule", "manual", "interval"],
      activity: "shipped v0.4 · 1 jam", commit: "tag v0.4.0",
    },
  ],

  // Backlog — specs hanoman produced from human briefs / QA findings.
  backlog: [
    {
      id: "SPEC-142", project: "arta", title: "Saldo wallet multi-currency",
      source: "brief", stage: "planned", author: "Rangga", priority: "sedang",
      objective: "Simpan & tampilkan saldo per mata uang, FX dihitung saat display.",
    },
    {
      id: "SPEC-141", project: "candra", title: "Funnel double-count sesi lintas tengah malam",
      source: "qa", stage: "spec-ready", author: "QA · Dinda", priority: "tinggi",
      objective: "Sesi yang melewati UTC midnight terhitung dua kali di funnel step 3.",
    },
    {
      id: "SPEC-140", project: "sembada", title: "Jadwal invoice berulang",
      source: "brief", stage: "brainstorming", author: "Rangga", priority: "sedang",
      objective: "— masih memperjelas cadence, proration, dan dunning sebelum spec.",
    },
    {
      id: "SPEC-139", project: "loka-pos", title: "Konflik sync offline pada stock count",
      source: "qa", stage: "objective", author: "QA · Bima", priority: "tinggi",
      objective: "Dua terminal mengedit SKU yang sama secara offline saling menimpa diam-diam.",
    },
    {
      id: "SPEC-138", project: "arta", title: "Retry webhook dengan backoff",
      source: "brief", stage: "executing", author: "Rangga", priority: "sedang",
      objective: "Exponential backoff + dead-letter setelah 6 attempt.",
    },
    {
      id: "SPEC-137", project: "gapura", title: "Rotasi signing key tanpa downtime",
      source: "brief", stage: "done", author: "Sekar", priority: "rendah",
      objective: "Jendela dua-kunci; kunci lama tetap valid 24 jam setelah rotasi.",
    },
  ],

  // Claude Code runs — spec → plan → execute (atau audit → … untuk QA).
  runs: [
    {
      id: "RUN-8842", project: "arta", spec: "SPEC-138",
      title: "Retry webhook dengan backoff", kind: "feature",
      status: "running", trigger: "commit", triggerDetail: "push a1b2c3 → main",
      startedAt: "2 mnt lalu", duration: "2 mnt 14 dtk", model: "sonnet-4.5",
      tokensIn: "128.4k", tokensOut: "39.7k", cost: "$0.82", progress: 68,
      phases: [
        { name: "Brainstorm", state: "done" },
        { name: "Objective", state: "done" },
        { name: "Spec", state: "done" },
        { name: "Plan", state: "done" },
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
    },
    {
      id: "RUN-8841", project: "sembada", spec: null,
      title: "Scaffold docs dari MVP objective", kind: "scaffold",
      status: "running", trigger: "manual", triggerDetail: "Rangga",
      startedAt: "baru saja", duration: "48 dtk", model: "sonnet-4.5",
      tokensIn: "64.1k", tokensOut: "51.9k", cost: "$0.61", progress: 41,
      phases: [
        { name: "Brainstorm", state: "done" },
        { name: "Objective", state: "done" },
        { name: "Doc index", state: "active" },
      ],
      plan: [],
      files: [],
      log: [
        { t: "$", s: "hanoman scaffold --project sembada" },
        { t: "✓", s: "MVP objective terkunci" },
        { t: "›", s: "menulis internal/docs/** · 14/34" },
      ],
    },
    {
      id: "RUN-8838", project: "candra", spec: "SPEC-141",
      title: "Audit funnel double-count", kind: "qa",
      status: "failed", trigger: "schedule", triggerDetail: "nightly 02:00",
      startedAt: "26 mnt lalu", duration: "3 mnt 02 dtk", model: "sonnet-4.5",
      tokensIn: "92.7k", tokensOut: "18.3k", cost: "$0.44", progress: 55,
      phases: [
        { name: "Audit", state: "done" },
        { name: "Spec", state: "done" },
        { name: "Plan", state: "failed" },
        { name: "Execute", state: "pending" },
      ],
      plan: [],
      files: [],
      log: [
        { t: "$", s: "hanoman qa SPEC-141 --project candra" },
        { t: "✗", s: "plan diblok · data-model.md tak punya session TZ" },
        { t: " ", s: "exit 1 · docs stale (Source of Truth)" },
      ],
    },
    {
      id: "RUN-8835", project: "gapura", spec: "SPEC-137",
      title: "Rotasi signing key", kind: "feature",
      status: "done", trigger: "interval", triggerDetail: "setiap 6 jam",
      startedAt: "1 jam lalu", duration: "6 mnt 40 dtk", model: "sonnet-4.5",
      tokensIn: "141.2k", tokensOut: "58.0k", cost: "$1.04", progress: 100,
      phases: [
        { name: "Brainstorm", state: "done" },
        { name: "Objective", state: "done" },
        { name: "Spec", state: "done" },
        { name: "Plan", state: "done" },
        { name: "Execute", state: "done" },
      ],
      plan: [],
      files: [],
      log: [
        { t: "$", s: "hanoman execute SPEC-137 --project gapura" },
        { t: "✓", s: "9 langkah selesai · test hijau" },
        { t: "✓", s: "docs diperbarui · index sinkron" },
      ],
    },
    {
      id: "RUN-8830", project: "loka-pos", spec: "SPEC-139",
      title: "Audit konflik sync offline", kind: "qa",
      status: "queued", trigger: "commit", triggerDetail: "push 9f1e07 → develop",
      startedAt: "5 mnt lalu", duration: "—", model: "sonnet-4.5",
      tokensIn: "—", tokensOut: "—", cost: "—", progress: 0,
      phases: [
        { name: "Audit", state: "pending" },
        { name: "Spec", state: "pending" },
        { name: "Plan", state: "pending" },
        { name: "Execute", state: "pending" },
      ],
      plan: [],
      files: [],
      log: [
        { t: "$", s: "hanoman qa SPEC-139 --project loka-pos" },
        { t: " ", s: "antre · menunggu runner…" },
      ],
    },
  ],

  triggers: [
    { id: "t1", project: "arta", type: "commit", detail: "push → main", target: "plan + execute", enabled: true },
    { id: "t2", project: "arta", type: "schedule", detail: "nightly 02:00", target: "audit", enabled: true },
    { id: "t3", project: "sembada", type: "manual", detail: "on demand", target: "scaffold docs", enabled: true },
    { id: "t4", project: "candra", type: "schedule", detail: "nightly 02:00", target: "qa audit", enabled: false },
    { id: "t5", project: "gapura", type: "interval", detail: "setiap 6 jam", target: "plan + execute", enabled: true },
    { id: "t6", project: "loka-pos", type: "commit", detail: "push → develop", target: "audit", enabled: true },
  ],

  // internal/docs — Source of Truth index. Fixed category vocabulary.
  // Shown for a mid-coverage project (loka-pos): a few categories drift.
  docsProject: "loka-pos",
  docTree: [
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
  ],

  // ---- From-scratch flow: idea → brainstorm → locked MVP objective ----
  idea: {
    project: "kirana",
    tagline: "Marketplace jasa lokal",
    thread: [
      { who: "human", name: "Rangga",
        text: "Ide: marketplace jasa lokal — tukang, cleaning, servis AC. Pelanggan cari tukang terverifikasi di sekitarnya, booking, bayar in-app." },
      { who: "hanoman",
        text: "Sebelum kunci objective, tiga hal dulu. (1) Sisi mana yang paling sakit sekarang — pelanggan susah cari, atau tukang susah dapat order? (2) Pembayaran in-app wajib di MVP atau boleh cash? (3) Satu kota dulu atau nasional?" },
      { who: "human", name: "Rangga",
        text: "Yang sakit: pelanggan susah cari tukang tepercaya. Pembayaran boleh cash dulu, in-app menyusul. Satu kota — Bandung." },
      { who: "hanoman",
        text: "Jadi MVP-nya discovery + booking, bukan payment. Payment, rating multi-kriteria, dan multi-kota kita tandai out-of-scope. Setuju kalau tukang di-verifikasi manual dulu (bukan otomatis) untuk menjaga kepercayaan?" },
      { who: "human", name: "Rangga", text: "Setuju. Verifikasi manual dulu." },
      { who: "hanoman",
        text: "Objective terkunci. Selanjutnya aku scaffold seluruh doc index dari objective ini sebagai Source of Truth — baru fitur bisa masuk spec → plan → execute." },
    ],
    objective: "Warga Bandung bisa menemukan tukang jasa terverifikasi di sekitarnya dan memesan dalam ≤ 3 langkah, dengan pembayaran cash saat MVP.",
    inScope: ["Discovery jasa berbasis lokasi", "Booking + jadwal", "Verifikasi tukang manual"],
    outScope: ["Pembayaran in-app", "Rating multi-kriteria", "Multi-kota"],
  },

  // ---- Human feature brief (prefilled example) ----
  brief: {
    project: "arta",
    title: "Retry webhook dengan backoff",
    problem: "Webhook ke merchant kadang gagal saat endpoint mereka down sesaat. Sekarang sekali gagal langsung hangus — merchant kehilangan event pembayaran.",
    outcome: "Setiap webhook di-retry otomatis dengan exponential backoff; setelah 6 attempt masuk dead-letter untuk ditinjau, bukan hilang.",
    constraints: "Tidak boleh double-deliver. Latency normal tak terpengaruh. Reuse queue yang sudah ada (BullMQ).",
    priority: "sedang",
    nextSteps: [
      { icon: "messages-square", label: "Brainstorm sampai objective jelas" },
      { icon: "target", label: "Kunci objective" },
      { icon: "file-text", label: "Tulis spec" },
      { icon: "list-checks", label: "Masuk backlog" },
    ],
  },

  // ---- Human QA finding (prefilled example) ----
  qa: {
    project: "candra",
    title: "Funnel drop-off double-count sesi",
    severity: "major",
    steps: "1. Buka funnel report step 3\n2. Set rentang tanggal melewati tengah malam UTC\n3. Bandingkan total sesi dengan raw events",
    expected: "Tiap sesi dihitung sekali di setiap step funnel.",
    actual: "Sesi yang melintasi UTC midnight terhitung dua kali di step 3 → drop-off tampak lebih kecil dari seharusnya.",
    env: "prod · web · v0.9.2",
    evidence: "funnel-oct.png",
    flow: [
      { icon: "radar", label: "Audit — hanoman telusuri akar masalah" },
      { icon: "file-text", label: "Spec — tulis perbaikan" },
      { icon: "git-branch", label: "Plan — rencanakan langkah" },
      { icon: "play", label: "Execute — jalankan & test" },
    ],
  },

  // ---- hanoman scaffolds the full doc index from the objective ----
  scaffold: {
    project: "kirana", mode: "objective", done: 14, total: 34,
    cats: [
      { cat: "entrypoints", n: 5, state: "done" },
      { cat: "product", n: 3, state: "done" },
      { cat: "business", n: 2, state: "done" },
      { cat: "requirements", n: 4, state: "writing" },
      { cat: "architecture", n: 4, state: "queued" },
      { cat: "adr", n: 2, state: "queued" },
      { cat: "operations", n: 3, state: "queued" },
      { cat: "security", n: 1, state: "queued" },
      { cat: "research", n: 3, state: "done" },
      { cat: "brand", n: 3, state: "queued" },
      { cat: "frontend", n: 1, state: "queued" },
      { cat: "design-system", n: 2, state: "queued" },
    ],
    log: [
      { t: "$", s: "hanoman scaffold --project kirana --from objective" },
      { t: "✓", s: "objective dimuat · MVP terkunci" },
      { t: "✓", s: "internal/docs/entrypoints/** · 5 file" },
      { t: "›", s: "menulis requirements/prd.md…" },
    ],
  },
};

// ---- Git worktrees: setiap run terisolasi di worktree sendiri, bisa
// pull dari branch mana pun dan push hasilnya ke branch mana pun. ----
window.HN.branches = [
  "main", "develop", "staging", "release/v1.0",
  "feat/webhook-retry", "chore/scaffold-docs", "fix/funnel-tz",
  "feat/key-rotation", "fix/offline-sync",
];
window.HN._worktree = {
  "RUN-8842": ["main", "feat/webhook-retry"],
  "RUN-8841": ["main", "chore/scaffold-docs"],
  "RUN-8838": ["main", "fix/funnel-tz"],
  "RUN-8835": ["main", "feat/key-rotation"],
  "RUN-8830": ["develop", "fix/offline-sync"],
};
window.HN.runs.forEach((r) => {
  const w = window.HN._worktree[r.id] || ["main", "main"];
  r.worktree = ".worktrees/" + r.id.toLowerCase();
  r.branchFrom = w[0];
  r.branchTo = w[1];
});
