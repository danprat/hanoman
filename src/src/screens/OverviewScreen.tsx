/* OverviewScreen — workspace dashboard. Ported from the prototype;
   window globals → ds imports, run/project fields from view models. */
import React from "react";
import { fmtEstCost, parseEstCost } from "@hanoman/shared";
import { Card, StatusPill, Badge, ProgressBar, Icon, Button, StateBlock } from "../ds";
import type { ProjectVM, RunVM, Spec, Trigger } from "./types";

const O_TRIGGER_ICON: Record<string, string> = {
  commit: "git-commit-horizontal", schedule: "calendar-clock",
  manual: "mouse-pointer-click", interval: "timer",
};
function oCovTone(s: string) { return s === "broken" ? "err" : s === "drift" ? "warn" : "ok"; }
function oAttention(p: ProjectVM): "high" | "low" | "none" {
  if (p.docStatus === "broken" || p.run.status === "failed") return "high";
  if (p.docStatus === "drift") return "low";
  return "none";
}
const O_ATT: Record<string, { bar: string; tint: string; text: string; label: string }> = {
  high: { bar: "var(--clay-500)", tint: "var(--clay-100)", text: "var(--clay-600)", label: "perlu perhatian" },
  low: { bar: "var(--amber-500)", tint: "var(--amber-100)", text: "var(--amber-600)", label: "docs drift" },
};

function KpiStrip({ items }: { items: { label: string; value: React.ReactNode; sub?: string; dot: string }[] }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: `repeat(${items.length}, 1fr)`, gap: 1,
      background: "var(--border-hair)", border: "1px solid var(--border-hair)",
      borderRadius: "var(--radius-lg)", overflow: "hidden", marginBottom: 20,
    }}>
      {items.map((s) => (
        <div key={s.label} style={{ background: "var(--surface-card)", padding: "16px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.dot }} />
            <span style={{ fontFamily: "var(--font-display)", fontSize: 27, fontWeight: 600, color: "var(--text-strong)", lineHeight: 1 }}>{s.value}</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>{s.label}</div>
          {s.sub && <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-subtle)", marginTop: 3 }}>{s.sub}</div>}
        </div>
      ))}
    </div>
  );
}

function AttnRow({ p, onOpen }: { p: ProjectVM; onOpen: (p: ProjectVM) => void }) {
  const att = oAttention(p);
  const meta = O_ATT[att]!;
  const reason = p.run.status === "failed" ? "Plan gagal · docs stale"
    : p.docStatus === "broken" ? "Docs off-convention"
    : "Docs drift — sebagian kategori belum ter-index";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 4px", borderBottom: "1px solid var(--border-hair)", borderLeft: `3px solid ${meta.bar}`, paddingLeft: 12 }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="box" size={13} color="var(--text-muted)" />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13.5, fontWeight: 500, color: "var(--text-strong)" }}>{p.name}</span>
          <Badge tone={att === "high" ? "err" : "warn"} size="sm">{meta.label}</Badge>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{reason} · {p.coverage}% ter-index</div>
      </div>
      <Button size="sm" variant="secondary" leftIcon="book-open" onClick={() => onOpen(p)}>Buka SoT</Button>
    </div>
  );
}

function LiveRunRow({ r, onGoto }: { r: RunVM; onGoto: (s: string) => void }) {
  const phase = (r.phases.find((x) => x.state === "active") || {} as any).name || r.phase;
  return (
    <div onClick={() => onGoto("runs")} style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 4px", borderBottom: "1px solid var(--border-hair)", cursor: "pointer" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <StatusPill status={r.status} size="sm">{phase}</StatusPill>
        <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-strong)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)" }}>{r.id}</span>
      </div>
      <ProgressBar value={r.progress} tone="ok" size="sm" />
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="box" size={12} /> {r.project}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name={O_TRIGGER_ICON[r.trigger]!} size={12} /> {r.trigger}</span>
        <span>{r.cost}</span>
      </div>
    </div>
  );
}

function CoverageRow({ p, onOpen }: { p: ProjectVM; onOpen: (p: ProjectVM) => void }) {
  return (
    <div onClick={() => onOpen(p)} style={{ display: "grid", gridTemplateColumns: "92px 1fr 78px", alignItems: "center", gap: 12, padding: "9px 4px", cursor: "pointer", borderBottom: "1px solid var(--border-hair)" }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
      <ProgressBar value={p.coverage} tone={oCovTone(p.docStatus)} size="sm" />
      <StatusPill status={p.docStatus} size="sm" />
    </div>
  );
}

function MiniStat({ icon, label, value, tone }: { icon: string; label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--border-hair)", borderRadius: "var(--radius-md)", background: "var(--bone-100)" }}>
      <span style={{ width: 30, height: 30, borderRadius: "var(--radius-sm)", flex: "0 0 auto", background: "var(--surface-card)", border: "1px solid var(--border-hair)", color: tone || "var(--text-muted)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={15} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 600, color: "var(--text-strong)", lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3 }}>{label}</div>
      </div>
    </div>
  );
}

export function OverviewScreen({ projects, runs, backlog, triggers, onOpenProject, onGoto }:
  { projects: ProjectVM[]; runs: RunVM[]; backlog: Spec[]; triggers: Trigger[];
    onOpenProject: (p: ProjectVM) => void; onGoto: (s: string) => void }) {
  const activeRuns = runs.filter((r) => r.status === "running");
  const attention = projects.filter((p) => oAttention(p) !== "none")
    .sort((a, b) => (oAttention(a) === "high" ? 0 : 1) - (oAttention(b) === "high" ? 0 : 1));
  const onConv = projects.filter((p) => p.docStatus === "ok").length;
  const highAtt = projects.filter((p) => oAttention(p) === "high").length;
  const cost = runs.reduce((n, r) => n + parseEstCost(r.cost), 0);
  const coverageAvg = projects.length ? Math.round(projects.reduce((n, p) => n + p.coverage, 0) / projects.length) : 0;

  const briefN = backlog.filter((s) => s.source === "brief").length;
  const qaN = backlog.filter((s) => s.source === "qa").length;
  const hiPrio = backlog.filter((s) => s.priority === "tinggi").length;

  const trigOn = triggers.filter((t) => t.enabled).length;
  const trigByType = ["commit", "schedule", "manual", "interval"].map((k) => ({ k, n: triggers.filter((t) => t.type === k && t.enabled).length }));

  const coverageSorted = [...projects].sort((a, b) => a.coverage - b.coverage);
  const activity = projects.map((p) => ({ project: p.name, status: p.run.status, text: p.activity, commit: p.commit }));

  const kpis = [
    { label: "Run aktif", value: activeRuns.length, dot: "var(--brass-500)" },
    { label: "Perlu perhatian", value: highAtt, dot: "var(--clay-600)" },
    { label: "Docs on-convention", value: onConv + "/" + projects.length, sub: "rata-rata " + coverageAvg + "%", dot: "var(--leaf-600)" },
    { label: "Spec di backlog", value: backlog.length, sub: briefN + " brief · " + qaN + " QA", dot: "var(--wind-600)" },
    { label: "Estimasi biaya", value: fmtEstCost(cost), sub: "hari ini · bukan tagihan", dot: "var(--ink-500)" },
  ];

  return (
    <div>
      <KpiStrip items={kpis} />
      <div style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr", gap: 20, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Card eyebrow={"needs attention · " + attention.length} title="Perlu perhatian"
            actions={<Button size="sm" variant="ghost" leftIcon="layout-grid" onClick={() => onGoto("projects")}>Semua project</Button>}>
            {attention.length === 0
              ? <StateBlock kind="empty" compact icon="check-circle-2" title="Semua project on-convention"
                  hint="Source of Truth utuh — tidak ada yang perlu perhatian." />
              : <div style={{ marginTop: 4 }}>{attention.map((p) => <AttnRow key={p.id} p={p} onOpen={onOpenProject} />)}</div>}
          </Card>
          <Card eyebrow={"live · " + activeRuns.length + " berjalan"} title="Claude Code sedang jalan"
            actions={<Button size="sm" variant="ghost" leftIcon="activity" onClick={() => onGoto("runs")}>Buka Runs</Button>}>
            {activeRuns.length === 0
              ? <StateBlock kind="empty" compact icon="activity" title="Tidak ada run aktif"
                  hint="Jalankan spec dari backlog untuk melihat log Claude Code streaming di sini." />
              : <div style={{ marginTop: 4 }}>{activeRuns.map((r) => <LiveRunRow key={r.id} r={r} onGoto={onGoto} />)}</div>}
          </Card>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Card eyebrow="Source of Truth" title="Docs coverage"
            actions={<Button size="sm" variant="ghost" leftIcon="book-open" onClick={() => onGoto("docs")}>Docs</Button>}>
            {coverageSorted.length === 0
              ? <StateBlock kind="empty" compact icon="book-open" title="Belum ada project"
                  hint="Coverage Source of Truth muncul setelah project pertama ditambahkan." />
              : <div style={{ marginTop: 4 }}>{coverageSorted.map((p) => <CoverageRow key={p.id} p={p} onOpen={onOpenProject} />)}</div>}
          </Card>
          <Card eyebrow="brainstorm → execute" title="Backlog"
            actions={<Button size="sm" variant="ghost" leftIcon="list-checks" onClick={() => onGoto("backlog")}>Buka</Button>}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
              <MiniStat icon="lightbulb" label="dari brief" value={briefN} tone="var(--brass-600)" />
              <MiniStat icon="bug" label="dari QA" value={qaN} tone="var(--clay-500)" />
              <MiniStat icon="flame" label="prioritas tinggi" value={hiPrio} tone="var(--clay-500)" />
              <MiniStat icon="layers" label="total spec" value={backlog.length} tone="var(--wind-600)" />
            </div>
          </Card>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.35fr", gap: 20, alignItems: "start", marginTop: 20 }}>
        <Card eyebrow={trigOn + " aktif · " + triggers.length + " total"} title="Triggers"
          actions={<Button size="sm" variant="ghost" leftIcon="zap" onClick={() => onGoto("triggers")}>Kelola</Button>}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
            {trigByType.map((t) => (
              <MiniStat key={t.k} icon={O_TRIGGER_ICON[t.k]!} label={t.k} value={t.n} tone="var(--brass-600)" />
            ))}
          </div>
        </Card>
        <Card eyebrow="workspace" title="Aktivitas terbaru">
          {activity.length === 0
            ? <StateBlock kind="empty" compact icon="history" title="Belum ada aktivitas"
                hint="Commit, scan, dan run terakhir tiap project akan tampil di sini." />
            : <div style={{ marginTop: 4 }}>
            {activity.map((a, i) => {
              const dot = a.status === "running" ? "var(--brass-500)" : a.status === "failed" ? "var(--clay-500)"
                : a.status === "done" ? "var(--leaf-500)" : a.status === "queued" ? "var(--wind-600)" : "var(--bone-400)";
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 4px", borderBottom: "1px solid var(--border-hair)" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flex: "0 0 auto" }} />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-strong)", width: 84, flex: "0 0 auto" }}>{a.project}</span>
                  <span style={{ fontSize: 12.5, color: "var(--text-body)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.text}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>{a.commit}</span>
                </div>
              );
            })}
          </div>}
        </Card>
      </div>
    </div>
  );
}
