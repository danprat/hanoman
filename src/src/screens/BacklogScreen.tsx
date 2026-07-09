/* BacklogScreen — specs on the brainstorm → execute lifecycle.
   Ported; spec.project → spec.projectId; window → ds imports. */
import React from "react";
import { Card, Badge, Tabs, Select, Button, IconButton, usePaged, Pager, Modal, StateBlock } from "../ds";
import { api } from "../api/client";
import { branchOptions } from "./branch";
import type { Spec } from "./types";
import type { ProjectVM } from "./types";

const B_STAGES = [
  { key: "brainstorming", label: "Brainstorm" }, { key: "objective", label: "Objective" },
  { key: "spec-ready", label: "Spec" }, { key: "planned", label: "Plan" },
  { key: "executing", label: "Execute" }, { key: "done", label: "Done" },
];
const bStageIndex = (k: string) => B_STAGES.findIndex((s) => s.key === k);
const B_PRIO: Record<string, { tone: any; label: string }> = {
  tinggi: { tone: "err", label: "prioritas tinggi" },
  sedang: { tone: "neutral", label: "prioritas sedang" },
  rendah: { tone: "neutral", label: "prioritas rendah" },
};

function StageBar({ stage }: { stage: string }) {
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
              <span style={{ width: 8, height: 8, borderRadius: "50%",
                background: done ? "var(--leaf-500)" : active ? "var(--brass-500)" : "var(--bone-400)" }} />
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

const BRIEF_FIELDS = [
  ["context", "Konteks"], ["outcome", "Outcome"], ["constraints", "Constraints"],
] as const;
const QA_FIELDS = [
  ["severity", "Severity"], ["steps", "Langkah reproduksi"], ["expected", "Diharapkan"],
  ["actual", "Aktual"], ["env", "Environment"],
] as const;

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="hn-eyebrow" style={{ marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13.5, color: "var(--text-strong)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
        {value || "—"}
      </div>
    </div>
  );
}

function SpecDetail({ spec, onClose, onEditBranch }:
  { spec: Spec | null; onClose: () => void; onEditBranch?: (s: Spec, b: string | null) => void }) {
  // Hook HARUS mendahului early-return `if (!spec)` — rules-of-hooks.
  const [branches, setBranches] = React.useState<string[]>([]);
  const projectId = spec?.projectId;
  React.useEffect(() => {
    if (!projectId) { setBranches([]); return; }
    let alive = true;
    api.listBranches(projectId)
      .then((r) => { if (alive) setBranches(r.branches); })
      .catch(() => { if (alive) setBranches([]); });
    return () => { alive = false; };
  }, [projectId]);
  if (!spec) return null;
  const qa = spec.source === "qa";
  const p = (spec.payload || {}) as Record<string, string>;
  const fields = qa ? QA_FIELDS : BRIEF_FIELDS;
  return (
    <Modal open title={spec.title} eyebrow={spec.id + " · " + spec.projectId}
      icon={qa ? "bug" : "lightbulb"} onClose={onClose}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <Badge tone={qa ? "err" : "brass"} size="sm">{qa ? "QA finding" : "feature brief"}</Badge>
        <Badge tone={(B_PRIO[spec.priority] || B_PRIO.sedang!).tone} size="sm" variant="outline">
          {(B_PRIO[spec.priority] || B_PRIO.sedang!).label}
        </Badge>
        <Badge tone="neutral" size="sm">{spec.author}</Badge>
      </div>
      <div style={{ marginBottom: 18 }}><StageBar stage={spec.stage} /></div>
      <DetailRow label="Objective" value={spec.objective} />
      {/* SPEC-143 · dapat diubah selama item masih di backlog; hanya menentukan basis run berikutnya. */}
      <div style={{ marginBottom: 14 }}>
        <div className="hn-eyebrow" style={{ marginBottom: 4 }}>Branch worktree</div>
        <Select size="sm" value={spec.branchFrom ?? ""} disabled={!branches.length}
          onChange={(e) => onEditBranch && onEditBranch(spec, e.target.value || null)}
          options={branchOptions(branches)} />
      </div>
      {fields.map(([k, label]) => <DetailRow key={k} label={label} value={p[k] ?? ""} />)}
    </Modal>
  );
}

function SpecCard({ spec, onStart, onDelete, onOpenRun, onOpenDetail, running }:
  { spec: Spec; onStart?: (s: Spec) => void; onDelete?: (s: Spec) => void;
    onOpenRun?: (s: Spec) => void; onOpenDetail?: (s: Spec) => void; running?: boolean }) {
  const qa = spec.source === "qa";
  const prio = B_PRIO[spec.priority] || B_PRIO.sedang!;
  return (
    <Card padding={16}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-subtle)" }}>{spec.id}</span>
            <Badge tone={qa ? "err" : "brass"} size="sm" icon={qa ? "bug" : "lightbulb"}>
              {qa ? "QA finding" : "feature brief"}
            </Badge>
            {spec.branchFrom && <Badge tone="neutral" size="sm" icon="git-branch">{spec.branchFrom}</Badge>}
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>· {spec.projectId}</span>
          </div>
          <button onClick={() => onOpenDetail && onOpenDetail(spec)} style={{
            border: "none", background: "transparent", padding: 0, textAlign: "left", cursor: "pointer",
            fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 600, color: "var(--text-strong)", marginTop: 8,
          }}>
            {spec.title}
          </button>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.45 }}>{spec.objective}</div>
        </div>
        <Badge tone={prio.tone} size="sm" variant={spec.priority === "tinggi" ? "soft" : "outline"}>{prio.label}</Badge>
      </div>
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border-hair)" }}>
        <StageBar stage={spec.stage} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)" }}>{spec.author}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {spec.stage !== "done" && running && (
              <Button size="sm" variant="secondary" leftIcon="activity" onClick={() => onOpenRun && onOpenRun(spec)}>
                Buka run
              </Button>
            )}
            {spec.stage !== "done" && !running && (
              <Button size="sm" variant="primary" leftIcon="play" onClick={() => onStart && onStart(spec)}>
                {spec.stage === "brainstorming" ? "Mulai" : "Jalankan lagi"}
              </Button>
            )}
            {spec.stage === "done" && <Badge tone="ok" size="sm" icon="check-circle-2">selesai</Badge>}
            {onDelete && <IconButton size="sm" variant="ghost" icon="trash-2" label="Hapus spec" onClick={() => onDelete(spec)} />}
          </div>
        </div>
      </div>
    </Card>
  );
}

export function BacklogScreen({ backlog, projects, pageSize = 4, onStart, activeRunSpecs, onDelete, onOpenRun, onNew, onEditBranch }:
  { backlog: Spec[]; projects: ProjectVM[]; pageSize?: number;
    onStart?: (s: Spec) => void; activeRunSpecs?: Set<string>;
    onDelete?: (s: Spec) => void; onOpenRun?: (s: Spec) => void; onNew?: () => void;
    onEditBranch?: (s: Spec, b: string | null) => void }) {
  const [tab, setTab] = React.useState("all");
  const [proj, setProj] = React.useState("all");
  // keep the id, not the object: backlog re-polls and the stage bar must stay live
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const projOptions = projects || [...new Set(backlog.map((s) => s.projectId))].map((id) => ({ id, name: id }));
  const filtered = backlog.filter((s) =>
    (tab === "all" || s.source === tab) && (proj === "all" || s.projectId === proj));
  const pg = usePaged(filtered, pageSize, tab + "|" + proj);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <Tabs variant="pill" value={tab} onChange={setTab} tabs={[
          { value: "all", label: "Semua spec" }, { value: "brief", label: "Dari brief" }, { value: "qa", label: "Dari QA" },
        ]} />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Select size="sm" value={proj} onChange={(e) => setProj(e.target.value)}
            options={[{ value: "all", label: "Semua project" }].concat(projOptions.map((p) => ({ value: p.id, label: p.name })))} />
          <span className="hn-eyebrow">{filtered.length} spec</span>
        </div>
      </div>
      {filtered.length === 0 ? (
        backlog.length === 0
          ? <StateBlock kind="empty" icon="lightbulb" title="Backlog masih kosong"
              hint="Filekan feature brief atau QA finding — hanoman menjalankannya dari brainstorm sampai execute."
              action={onNew} actionLabel="Tambah spec" />
          : <StateBlock kind="empty" icon="filter" title="Tidak ada spec untuk filter ini"
              hint={`${backlog.length} spec ada di backlog, tapi tak ada yang cocok dengan filter aktif.`}
              action={() => { setTab("all"); setProj("all"); }} actionLabel="Reset filter" actionIcon="rotate-ccw" />
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {pg.pageItems.map((s) => <SpecCard key={s.id} spec={s} onStart={onStart}
              running={activeRunSpecs?.has(s.id)} onDelete={onDelete} onOpenRun={onOpenRun}
              onOpenDetail={(x) => setDetailId(x.id)} />)}
          </div>
          <div style={{ marginTop: 14, border: "1px solid var(--border-hair)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
            <Pager {...pg} onPage={pg.setPage} unit="spec" />
          </div>
        </>
      )}
      <SpecDetail spec={backlog.find((s) => s.id === detailId) || null} onClose={() => setDetailId(null)}
        onEditBranch={onEditBranch} />
    </div>
  );
}
