/* BacklogScreen — specs hanoman produced from human feature briefs
   and QA findings, each on the brainstorm → objective → spec → plan
   → execute → done lifecycle. */
const { Card: BCard, Badge: BBadge, Tabs: BTabs, Select: BSelect, Button: BBtn, IconButton: BIconBtn } = window.HanomanDesignSystem_c639ad;

// stage-appropriate primary action for a spec
const B_ACTION = {
  brainstorming: { label: "Kunci objective", icon: "target" },
  objective: { label: "Tulis spec", icon: "file-text" },
  "spec-ready": { label: "Buat plan", icon: "git-branch" },
  planned: { label: "Execute", icon: "play" },
  executing: { label: "Buka run", icon: "activity", run: true },
  done: null,
};

const B_STAGES = [
  { key: "brainstorming", label: "Brainstorm" },
  { key: "objective", label: "Objective" },
  { key: "spec-ready", label: "Spec" },
  { key: "planned", label: "Plan" },
  { key: "executing", label: "Execute" },
  { key: "done", label: "Done" },
];
const bStageIndex = (k) => B_STAGES.findIndex((s) => s.key === k);

const B_PRIO = {
  tinggi: { tone: "err", label: "prioritas tinggi" },
  sedang: { tone: "neutral", label: "prioritas sedang" },
  rendah: { tone: "neutral", label: "prioritas rendah" },
};

function StageBar({ stage }) {
  const idx = bStageIndex(stage);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {B_STAGES.map((s, i) => {
        const done = i < idx || stage === "done";
        const active = i === idx && stage !== "done";
        return (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: active ? "3px 9px" : 0, borderRadius: "var(--radius-pill)",
              background: active ? "var(--brass-100)" : "transparent",
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%",
                background: done ? "var(--leaf-500)" : active ? "var(--brass-500)" : "var(--bone-400)",
              }} />
              {active && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 500, color: "var(--brass-700)" }}>{s.label}</span>}
            </span>
            {i < B_STAGES.length - 1 && (
              <span style={{ width: 12, height: 1.5, background: (i < idx || stage === "done") ? "var(--leaf-500)" : "var(--bone-300)" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SpecCard({ spec, onAdvance, onDelete, onOpenRun }) {
  const qa = spec.source === "qa";
  const prio = B_PRIO[spec.priority] || B_PRIO.sedang;
  const act = B_ACTION[spec.stage];
  return (
    <BCard padding={16}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-subtle)" }}>{spec.id}</span>
            <BBadge tone={qa ? "err" : "brass"} size="sm" icon={qa ? "bug" : "lightbulb"}>
              {qa ? "QA finding" : "feature brief"}
            </BBadge>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>· {spec.project}</span>
          </div>
          <div style={{ fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 600, color: "var(--text-strong)", marginTop: 8 }}>
            {spec.title}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.45 }}>{spec.objective}</div>
        </div>
        <BBadge tone={prio.tone} size="sm" variant={spec.priority === "tinggi" ? "soft" : "outline"}>{prio.label}</BBadge>
      </div>
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border-hair)" }}>
        <StageBar stage={spec.stage} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)" }}>{spec.author}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {act && (
              <BBtn size="sm" variant={act.run ? "secondary" : "primary"} leftIcon={act.icon}
                onClick={() => act.run ? (onOpenRun && onOpenRun(spec)) : (onAdvance && onAdvance(spec))}>
                {act.label}
              </BBtn>
            )}
            {spec.stage === "done" && <BBadge tone="ok" size="sm" icon="check-circle-2">selesai</BBadge>}
            {onDelete && <BIconBtn size="sm" variant="ghost" icon="trash-2" label="Hapus spec" onClick={() => onDelete(spec)} />}
          </div>
        </div>
      </div>
    </BCard>
  );
}

function BacklogScreen({ backlog, projects, pageSize = 4, onAdvance, onDelete, onOpenRun }) {
  const [tab, setTab] = React.useState("all");
  const [proj, setProj] = React.useState("all");
  const { usePaged, Pager } = window;
  const projOptions = projects || [...new Set(backlog.map((s) => s.project))].map((id) => ({ id, name: id }));

  const filtered = backlog.filter((s) =>
    (tab === "all" || s.source === tab) && (proj === "all" || s.project === proj));
  const pg = usePaged(filtered, pageSize, tab + "|" + proj);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <BTabs variant="pill" value={tab} onChange={setTab} tabs={[
          { value: "all", label: "Semua spec" },
          { value: "brief", label: "Dari brief" },
          { value: "qa", label: "Dari QA" },
        ]} />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BSelect size="sm" value={proj} onChange={(e) => setProj(e.target.value)}
            options={[{ value: "all", label: "Semua project" }].concat(projOptions.map((p) => ({ value: p.id, label: p.name })))} />
          <span className="hn-eyebrow">{filtered.length} spec</span>
        </div>
      </div>
      {filtered.length === 0 ? (
        <div style={{ padding: "48px 0", textAlign: "center", color: "var(--text-muted)", fontFamily: "var(--font-sans)" }}>
          Tidak ada spec untuk filter ini.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {pg.pageItems.map((s) => <SpecCard key={s.id} spec={s} onAdvance={onAdvance} onDelete={onDelete} onOpenRun={onOpenRun} />)}
          </div>
          <div style={{ marginTop: 14, border: "1px solid var(--border-hair)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
            <Pager {...pg} onPage={pg.setPage} unit="spec" />
          </div>
        </>
      )}
    </div>
  );
}

Object.assign(window, { BacklogScreen });
