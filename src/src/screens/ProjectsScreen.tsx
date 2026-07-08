/* ProjectsScreen — multi-project monitor. Ported; window → ds imports.
   p.triggers comes from the App view model. */
import React from "react";
import { Card, StatusPill, Badge, ProgressBar, Icon, usePaged, Pager } from "../ds";
import type { ProjectVM, RunVM } from "./types";

const HN_TRIGGER_ICON: Record<string, string> = {
  commit: "git-commit-horizontal", schedule: "calendar-clock",
  manual: "mouse-pointer-click", interval: "timer",
};
function hnCovTone(s: string) { return s === "broken" ? "err" : s === "drift" ? "warn" : "ok"; }
function hnAttention(p: ProjectVM): "high" | "low" | "none" {
  if (p.docStatus === "broken" || p.run.status === "failed") return "high";
  if (p.docStatus === "drift") return "low";
  return "none";
}
const HN_ATT: Record<string, { bar: string; tint: string; text: string }> = {
  high: { bar: "var(--clay-500)", tint: "var(--clay-100)", text: "var(--clay-600)" },
  low: { bar: "var(--amber-500)", tint: "var(--amber-100)", text: "var(--amber-600)" },
};

function TriggerGlyphs({ list }: { list: string[] }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      {(list || []).map((t) => (
        <span key={t} title={t} style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 18, height: 18, borderRadius: "var(--radius-xs)",
          background: "var(--bone-200)", color: "var(--text-muted)",
        }}>
          <Icon name={HN_TRIGGER_ICON[t]!} size={11} />
        </span>
      ))}
    </span>
  );
}

function StatStrip({ projects, runs }: { projects: ProjectVM[]; runs: RunVM[] }) {
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
            <span style={{ fontFamily: "var(--font-display)", fontSize: 27, fontWeight: 600, color: "var(--text-strong)", lineHeight: 1 }}>{s.value}</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

function ProjectRow({ p, onOpen }: { p: ProjectVM; onOpen?: (p: ProjectVM) => void }) {
  const att = hnAttention(p);
  const running = p.run.status === "running" || p.run.status === "queued";
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={onOpen ? () => onOpen(p) : undefined}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: "grid", gridTemplateColumns: "1.7fr 1.2fr 1.5fr 1.1fr 0.9fr 1.4fr",
        alignItems: "center", gap: 12, padding: "11px 14px 11px 12px",
        borderBottom: "1px solid var(--border-hair)",
        borderLeft: `3px solid ${att === "none" ? "transparent" : HN_ATT[att]!.bar}`,
        cursor: onOpen ? "pointer" : "default",
        background: hover && onOpen ? "var(--bone-100)" : "transparent",
        transition: "background 120ms ease",
      }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <Icon name="box" size={13} color="var(--text-muted)" />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13.5, fontWeight: 500, color: "var(--text-strong)" }}>{p.name}</span>
          <Badge tone={p.kind === "from-scratch" ? "brass" : "neutral"} size="sm">{p.kind}</Badge>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-subtle)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.desc}</div>
      </div>
      <div><StatusPill status={p.run.status} size="sm">{running && p.run.phase ? p.run.phase : undefined}</StatusPill></div>
      <div style={{ paddingRight: 8 }}><ProgressBar value={p.coverage} showLabel tone={hnCovTone(p.docStatus)} size="sm" /></div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-muted)" }}>{p.backlog} · {p.topStage}</div>
      <div><TriggerGlyphs list={p.triggers} /></div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6, justifyContent: "space-between" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.activity}</span>
        {onOpen && <Icon name="chevron-right" size={14} color="var(--text-subtle)" />}
      </div>
    </div>
  );
}

export function ProjectsScreen({ projects, runs, onOpen, pageSize }:
  { projects: ProjectVM[]; runs: RunVM[]; variant?: string; onOpen?: (p: ProjectVM) => void; pageSize?: number }) {
  const cols = ["Project", "Status", "Docs · SoT", "Backlog", "Triggers", "Aktivitas"];
  const tmpl = "1.7fr 1.2fr 1.5fr 1.1fr 0.9fr 1.4fr";
  const pg = usePaged(projects, pageSize || projects.length, "proj");
  const rows = pageSize ? pg.pageItems : projects;
  return (
    <div>
      <StatStrip projects={projects} runs={runs} />
      <Card padding={0}>
        <div style={{ display: "grid", gridTemplateColumns: tmpl, gap: 12, padding: "10px 14px 10px 15px", borderBottom: "1px solid var(--border-hair)" }}>
          {cols.map((c) => <span key={c} className="hn-eyebrow">{c}</span>)}
        </div>
        {rows.map((p) => <ProjectRow key={p.id} p={p} onOpen={onOpen} />)}
        {pageSize && <Pager {...pg} onPage={pg.setPage} unit="project" />}
      </Card>
    </div>
  );
}
