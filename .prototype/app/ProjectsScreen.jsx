/* ProjectsScreen — the multi-project monitor (home).
   Three layout variants for comparison on the canvas:
     variant="grid"    → comfortable 2-col cards (primary)
     variant="list"    → dense table rows
     variant="compact" → tight 3-col cards
   Each project surfaces: run status, docs (SoT) coverage, backlog
   count + stage, active triggers, last commit, attention. */
const { Card: PCard, StatusPill: PPill, Badge: PBadge, ProgressBar: PBar, Icon: PIcon } =
  window.HanomanDesignSystem_c639ad;

const HN_TRIGGER_ICON = {
  commit: "git-commit-horizontal", schedule: "calendar-clock",
  manual: "mouse-pointer-click", interval: "timer",
};

function hnCovTone(s) { return s === "broken" ? "err" : s === "drift" ? "warn" : "ok"; }
function hnAttention(p) {
  if (p.docStatus === "broken" || p.run.status === "failed") return "high";
  if (p.docStatus === "drift") return "low";
  return "none";
}
const HN_ATT = {
  high: { bar: "var(--clay-500)", tint: "var(--clay-100)", text: "var(--clay-600)" },
  low: { bar: "var(--amber-500)", tint: "var(--amber-100)", text: "var(--amber-600)" },
};

function TriggerGlyphs({ list }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      {list.map((t) => (
        <span key={t} title={t} style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 18, height: 18, borderRadius: "var(--radius-xs)",
          background: "var(--bone-200)", color: "var(--text-muted)",
        }}>
          <PIcon name={HN_TRIGGER_ICON[t]} size={11} />
        </span>
      ))}
    </span>
  );
}

function StatStrip({ projects, runs }) {
  const activeRuns = runs.filter((r) => r.status === "running").length;
  const backlog = projects.reduce((n, p) => n + p.backlog, 0);
  const onConv = projects.filter((p) => p.docStatus === "ok").length;
  const attention = projects.filter((p) => hnAttention(p) === "high").length;
  const stats = [
    { label: "Run aktif", value: activeRuns, dot: "var(--brass-500)" },
    { label: "Total di backlog", value: backlog, dot: "var(--wind-600)" },
    { label: "On convention", value: onConv + "/" + projects.length, dot: "var(--leaf-600)" },
    { label: "Perlu perhatian", value: attention, dot: "var(--clay-600)" },
  ];
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1,
      background: "var(--border-hair)", border: "1px solid var(--border-hair)",
      borderRadius: "var(--radius-lg)", overflow: "hidden", marginBottom: 20,
    }}>
      {stats.map((s) => (
        <div key={s.label} style={{ background: "var(--surface-card)", padding: "15px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.dot }} />
            <span style={{ fontFamily: "var(--font-display)", fontSize: 27, fontWeight: 600, color: "var(--text-strong)", lineHeight: 1 }}>
              {s.value}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

/* ---------- comfortable / compact card ---------- */
function ProjectCard({ p, compact }) {
  const att = hnAttention(p);
  const running = p.run.status === "running" || p.run.status === "queued";
  const pad = compact ? 14 : 18;
  return (
    <PCard interactive padding={0}>
      <div style={{ display: "flex" }}>
        {att !== "none" && <span style={{ width: 3, flex: "0 0 auto", background: HN_ATT[att].bar }} />}
        <div style={{ flex: 1, minWidth: 0, padding: pad }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <PIcon name="box" size={15} color="var(--text-muted)" />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: compact ? 14 : 15, fontWeight: 500, color: "var(--text-strong)" }}>
                  {p.name}
                </span>
                <PBadge tone={p.kind === "from-scratch" ? "brass" : "neutral"} size="sm">{p.kind}</PBadge>
              </div>
              {!compact && <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 5 }}>{p.desc}</div>}
            </div>
            <PPill status={p.run.status} size="sm">
              {running && p.run.phase ? p.run.phase : undefined}
            </PPill>
          </div>

          <div style={{ margin: compact ? "12px 0 10px" : "16px 0 12px" }}>
            <PBar value={p.coverage} showLabel label="Docs · SoT" tone={hnCovTone(p.docStatus)} size={compact ? "sm" : "md"} />
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-muted)" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <PIcon name="list-checks" size={13} /> {p.backlog} spec · {p.topStage}
              </span>
              <TriggerGlyphs list={p.triggers} />
            </div>
            {att === "high" && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px",
                borderRadius: "var(--radius-pill)", background: HN_ATT.high.tint, color: HN_ATT.high.text,
                fontSize: 11, fontWeight: 600,
              }}>
                <PIcon name="alert-triangle" size={11} /> perlu perhatian
              </span>
            )}
          </div>

          {!compact && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, paddingTop: 11, borderTop: "1px solid var(--border-hair)", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)" }}>
              <PIcon name="git-commit-horizontal" size={12} /> {p.commit}
              <span style={{ color: "var(--bone-400)" }}>·</span>
              {p.activity}
            </div>
          )}
        </div>
      </div>
    </PCard>
  );
}

/* ---------- dense table row ---------- */
function ProjectRow({ p, onOpen }) {
  const att = hnAttention(p);
  const running = p.run.status === "running" || p.run.status === "queued";
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={onOpen ? () => onOpen(p) : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
      display: "grid", gridTemplateColumns: "1.7fr 1.2fr 1.5fr 1.1fr 0.9fr 1.4fr",
      alignItems: "center", gap: 12, padding: "11px 14px 11px 12px",
      borderBottom: "1px solid var(--border-hair)",
      borderLeft: `3px solid ${att === "none" ? "transparent" : HN_ATT[att].bar}`,
      cursor: onOpen ? "pointer" : "default",
      background: hover && onOpen ? "var(--bone-100)" : "transparent",
      transition: "background 120ms ease",
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <PIcon name="box" size={13} color="var(--text-muted)" />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13.5, fontWeight: 500, color: "var(--text-strong)" }}>{p.name}</span>
          <PBadge tone={p.kind === "from-scratch" ? "brass" : "neutral"} size="sm">{p.kind}</PBadge>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-subtle)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.desc}</div>
      </div>
      <div><PPill status={p.run.status} size="sm">{running && p.run.phase ? p.run.phase : undefined}</PPill></div>
      <div style={{ paddingRight: 8 }}><PBar value={p.coverage} showLabel tone={hnCovTone(p.docStatus)} size="sm" /></div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-muted)" }}>{p.backlog} · {p.topStage}</div>
      <div><TriggerGlyphs list={p.triggers} /></div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6, justifyContent: "space-between" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.activity}</span>
        {onOpen && <PIcon name="chevron-right" size={14} color="var(--text-subtle)" />}
      </div>
    </div>
  );
}

function ProjectsScreen({ projects, runs, variant = "grid", onOpen, pageSize }) {
  if (variant === "list") {
    const cols = ["Project", "Status", "Docs · SoT", "Backlog", "Triggers", "Aktivitas"];
    const tmpl = "1.7fr 1.2fr 1.5fr 1.1fr 0.9fr 1.4fr";
    const { usePaged, Pager } = window;
    const pg = usePaged(projects, pageSize || projects.length, "proj");
    const rows = pageSize ? pg.pageItems : projects;
    return (
      <div>
        <StatStrip projects={projects} runs={runs} />
        <PCard padding={0}>
          <div style={{ display: "grid", gridTemplateColumns: tmpl, gap: 12, padding: "10px 14px 10px 15px", borderBottom: "1px solid var(--border-hair)" }}>
            {cols.map((c) => <span key={c} className="hn-eyebrow">{c}</span>)}
          </div>
          {rows.map((p) => <ProjectRow key={p.id} p={p} onOpen={onOpen} />)}
          {pageSize && <Pager {...pg} onPage={pg.setPage} unit="project" />}
        </PCard>
      </div>
    );
  }
  const compact = variant === "compact";
  return (
    <div>
      <StatStrip projects={projects} runs={runs} />
      <div className="hn-eyebrow" style={{ marginBottom: 12 }}>{projects.length} project</div>
      <div style={{ display: "grid", gridTemplateColumns: compact ? "repeat(3, 1fr)" : "repeat(2, 1fr)", gap: compact ? 12 : 16 }}>
        {projects.map((p) => <ProjectCard key={p.id} p={p} compact={compact} />)}
      </div>
    </div>
  );
}

Object.assign(window, { ProjectsScreen });
