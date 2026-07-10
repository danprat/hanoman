/* BacklogScreen — specs on the brainstorm → execute lifecycle.
   Ported; spec.project → spec.projectId; window → ds imports. */
import React from "react";
import { Card, Badge, Tabs, Select, Button, IconButton, Icon, usePaged, Pager, Modal, StateBlock,
  LIST_SCROLL_STYLE, LIST_SCREEN_STYLE, FIXED_ROW_STYLE } from "../ds";
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

/* Aksi per-spec. Dipakai grid, list, dan board — satu-satunya jalan keyboard ke
   "mulai run", jadi board tetap bisa dipakai tanpa drag. */
function SpecActions({ spec, onStart, onDelete, onOpenRun, running }:
  { spec: Spec; onStart?: (s: Spec) => void; onDelete?: (s: Spec) => void;
    onOpenRun?: (s: Spec) => void; running?: boolean }) {
  return (
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
  );
}

function TitleButton({ spec, onOpenDetail, size = 15 }:
  { spec: Spec; onOpenDetail?: (s: Spec) => void; size?: number }) {
  return (
    <button onClick={() => onOpenDetail && onOpenDetail(spec)} style={{
      border: "none", background: "transparent", padding: 0, textAlign: "left", cursor: "pointer",
      fontFamily: "var(--font-sans)", fontSize: size, fontWeight: 600, color: "var(--text-strong)",
    }}>
      {spec.title}
    </button>
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
          <div style={{ marginTop: 8 }}><TitleButton spec={spec} onOpenDetail={onOpenDetail} /></div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.45 }}>{spec.objective}</div>
        </div>
        <Badge tone={prio.tone} size="sm" variant={spec.priority === "tinggi" ? "soft" : "outline"}>{prio.label}</Badge>
      </div>
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border-hair)" }}>
        <StageBar stage={spec.stage} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)" }}>{spec.author}</span>
          <SpecActions spec={spec} onStart={onStart} onDelete={onDelete} onOpenRun={onOpenRun} running={running} />
        </div>
      </div>
    </Card>
  );
}

/* ── List view ─────────────────────────────────────────────────────────────
   Baris padat: satu spec per baris, stage bar inline, aksi di kanan. */
function SpecRow({ spec, onStart, onDelete, onOpenRun, onOpenDetail, running }:
  { spec: Spec; onStart?: (s: Spec) => void; onDelete?: (s: Spec) => void;
    onOpenRun?: (s: Spec) => void; onOpenDetail?: (s: Spec) => void; running?: boolean }) {
  const qa = spec.source === "qa";
  const prio = B_PRIO[spec.priority] || B_PRIO.sedang!;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px",
      borderBottom: "1px solid var(--border-hair)", background: "var(--surface-card)" }}>
      <Icon name={qa ? "bug" : "lightbulb"} size={15} color={qa ? "var(--clay-500)" : "var(--brass-500)"} />
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-subtle)", flex: "0 0 84px" }}>{spec.id}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <TitleButton spec={spec} onOpenDetail={onOpenDetail} size={14} />
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, overflow: "hidden",
          textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{spec.objective}</div>
      </div>
      {spec.branchFrom && <Badge tone="neutral" size="sm" icon="git-branch">{spec.branchFrom}</Badge>}
      <Badge tone={prio.tone} size="sm" variant={spec.priority === "tinggi" ? "soft" : "outline"}>{prio.label}</Badge>
      <div style={{ flex: "0 0 auto" }}><StageBar stage={spec.stage} /></div>
      <SpecActions spec={spec} onStart={onStart} onDelete={onDelete} onOpenRun={onOpenRun} running={running} />
    </div>
  );
}

/* ── Board view ────────────────────────────────────────────────────────────
   Kolom = stage (+ backlog di depan, success/failed di belakang). Enam kolom
   tengah dimiliki runner: `spec.stage` cuma cermin fase run (SPEC-009), jadi
   kartu di sana tak bisa diangkat. Yang bisa didrag hanya dua kolom ujung,
   dan drop-nya memanggil aksi yang memang ada tombolnya: mulai / jalankan lagi. */
const BACKLOG_COL = "backlog", SUCCESS_COL = "success", FAILED_COL = "failed";
const WORK_COLS = B_STAGES.slice(0, 5).map((s) => s.key);   // brainstorming … executing
const COLUMNS: { key: string; label: string; icon?: string }[] = [
  { key: BACKLOG_COL, label: "Backlog", icon: "inbox" },
  ...B_STAGES.slice(0, 5).map((s) => ({ key: s.key, label: s.label })),
  { key: SUCCESS_COL, label: "Success", icon: "check-circle-2" },
  { key: FAILED_COL, label: "Failed", icon: "x-circle" },
];
const RUN_DEAD = new Set(["failed", "stopped"]);

/* Kolom sebuah spec. `lastRun` = status run TERAKHIR spec itu (undefined = belum pernah
   jalan). Spec yang belum pernah jalan tapi stage-nya sudah maju (run-nya dihapus) tetap
   tampil di kolom stage-nya — bukan diklaim balik ke Backlog. */
export function specColumn(spec: Spec, lastRun?: string): string {
  if (spec.stage === "done") return SUCCESS_COL;
  if (lastRun && RUN_DEAD.has(lastRun)) return FAILED_COL;
  if (!lastRun && spec.stage === "brainstorming") return BACKLOG_COL;
  return spec.stage;
}

/* Satu-satunya aturan drop. Keduanya berujung pada POST /runs — tak ada field spec
   yang ditulis, jadi state machine tak pernah dibohongi. */
export const canDrop = (from: string, to: string): boolean =>
  (from === BACKLOG_COL && WORK_COLS.includes(to)) || (from === FAILED_COL && to === BACKLOG_COL);

function BoardCard({ spec, col, onOpenDetail, onDragStart, onDragEnd, dragging }:
  { spec: Spec; col: string; onOpenDetail?: (s: Spec) => void;
    onDragStart: () => void; onDragEnd: () => void; dragging: boolean }) {
  const qa = spec.source === "qa";
  const prio = B_PRIO[spec.priority] || B_PRIO.sedang!;
  const draggable = col === BACKLOG_COL || col === FAILED_COL;
  return (
    <div draggable={draggable}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", spec.id); onDragStart(); }}
      onDragEnd={onDragEnd}
      title={draggable ? "Seret ke kolom lain untuk menjalankan run" : "Stage dikelola runner — kartu tak bisa dipindah"}
      style={{
        // `0 0 auto`: tanpa ini kartu menyusut mengisi kolom, bukan kolomnya yang menggulir.
        flex: "0 0 auto",
        background: "var(--surface-card)", border: "1px solid var(--border-hair)",
        borderRadius: "var(--radius-md)", padding: 10, boxShadow: "var(--shadow-xs)",
        cursor: draggable ? "grab" : "default", opacity: dragging ? 0.4 : 1,
      }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <Icon name={qa ? "bug" : "lightbulb"} size={13} color={qa ? "var(--clay-500)" : "var(--brass-500)"} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)" }}>{spec.id}</span>
        <span style={{ flex: 1 }} />
        <Badge tone={prio.tone} size="sm" variant={spec.priority === "tinggi" ? "soft" : "outline"}>{spec.priority}</Badge>
      </div>
      <TitleButton spec={spec} onOpenDetail={onOpenDetail} size={13} />
      {spec.branchFrom && (
        <div style={{ marginTop: 6 }}><Badge tone="neutral" size="sm" icon="git-branch">{spec.branchFrom}</Badge></div>
      )}
    </div>
  );
}

function Board({ specs, lastRunStatus, onStart, onOpenDetail }:
  { specs: Spec[]; lastRunStatus?: Map<string, string>;
    onStart?: (s: Spec) => void; onOpenDetail?: (s: Spec) => void }) {
  const [drag, setDrag] = React.useState<{ spec: Spec; from: string } | null>(null);
  const [over, setOver] = React.useState<string | null>(null);
  const byCol = new Map<string, Spec[]>(COLUMNS.map((c) => [c.key, []]));
  for (const s of specs) byCol.get(specColumn(s, lastRunStatus?.get(s.id)))?.push(s);

  const drop = (to: string) => {
    if (drag && canDrop(drag.from, to) && onStart) onStart(drag.spec);
    setDrag(null); setOver(null);
  };
  return (
    /* Baris kolom menggulir mendatar; tiap KOLOM menggulir tegak sendiri, jadi judul
       kolom tak pernah tergulir keluar dan kolom terpanjang tak menyeret yang lain. */
    <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", gap: 10,
      overflowX: "auto", overflowY: "hidden", alignItems: "stretch", paddingBottom: 4 }}>
      {COLUMNS.map((c) => {
        const items = byCol.get(c.key)!;
        const active = !!drag && canDrop(drag.from, c.key);
        const hot = active && over === c.key;
        return (
          <div key={c.key}
            onDragOver={(e) => { if (active) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(c.key); } }}
            onDragLeave={() => setOver((o) => (o === c.key ? null : o))}
            onDrop={(e) => { e.preventDefault(); drop(c.key); }}
            style={{
              flex: "0 0 244px", display: "flex", flexDirection: "column", minHeight: 0, padding: 10,
              borderRadius: "var(--radius-lg)",
              background: hot ? "var(--brass-100)" : "var(--bone-100)",
              border: `1px ${active ? "dashed" : "solid"} ${hot ? "var(--brass-500)" : "var(--border-hair)"}`,
              opacity: drag && !active ? 0.5 : 1, transition: "var(--transition-fast)",
            }}>
            <div style={{ ...FIXED_ROW_STYLE, display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              {c.icon && <Icon name={c.icon} size={13} color="var(--text-muted)" />}
              <span className="hn-eyebrow">{c.label}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)" }}>{items.length}</span>
            </div>
            {/* Zona drop mencakup ruang kosong di bawah kartu: event menggelembung ke kolom. */}
            <div style={{ ...LIST_SCROLL_STYLE, display: "flex", flexDirection: "column", gap: 8 }}>
              {items.map((s) => (
                <BoardCard key={s.id} spec={s} col={c.key} onOpenDetail={onOpenDetail}
                  dragging={drag?.spec.id === s.id}
                  onDragStart={() => setDrag({ spec: s, from: c.key })}
                  onDragEnd={() => { setDrag(null); setOver(null); }} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const VIEWS = [
  { value: "grid", label: "Grid", icon: "layout-grid" },
  { value: "list", label: "List", icon: "list" },
  { value: "board", label: "Board", icon: "kanban" },
];

export function BacklogScreen({ backlog, projects, pageSize = 20, onStart, activeRunSpecs, lastRunStatus, onDelete, onOpenRun, onNew, onEditBranch, projectFilter, onProjectFilter }:
  { backlog: Spec[]; projects: ProjectVM[]; pageSize?: number;
    onStart?: (s: Spec) => void; activeRunSpecs?: Set<string>; lastRunStatus?: Map<string, string>;
    onDelete?: (s: Spec) => void; onOpenRun?: (s: Spec) => void; onNew?: () => void;
    onEditBranch?: (s: Spec, b: string | null) => void;
    projectFilter: string; onProjectFilter: (id: string) => void }) {
  const [tab, setTab] = React.useState("all");
  const [view, setView] = React.useState("grid");
  // Filter project dimiliki App (SPEC-146): detail project membuka layar ini sudah tersaring.
  const proj = projectFilter;
  const setProj = onProjectFilter;
  // keep the id, not the object: backlog re-polls and the stage bar must stay live
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const projOptions = projects || [...new Set(backlog.map((s) => s.projectId))].map((id) => ({ id, name: id }));
  const filtered = backlog.filter((s) =>
    (tab === "all" || s.source === tab) && (proj === "all" || s.projectId === proj));
  const pg = usePaged(filtered, pageSize, tab + "|" + proj);
  return (
    <div style={LIST_SCREEN_STYLE}>
      <div style={{ ...FIXED_ROW_STYLE, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <Tabs variant="pill" value={tab} onChange={setTab} tabs={[
          { value: "all", label: "Semua spec" }, { value: "brief", label: "Dari brief" }, { value: "qa", label: "Dari QA" },
        ]} />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Select size="sm" value={proj} onChange={(e) => setProj(e.target.value)}
            options={[{ value: "all", label: "Semua project" }].concat(projOptions.map((p) => ({ value: p.id, label: p.name })))} />
          <Tabs variant="pill" value={view} onChange={setView} tabs={VIEWS} aria-label="Mode tampilan" />
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
      ) : view === "board" ? (
        // Board tak dipaginasi: kolom yang terpotong halaman bukan board.
        <Board specs={filtered} lastRunStatus={lastRunStatus} onStart={onStart}
          onOpenDetail={(x) => setDetailId(x.id)} />
      ) : (
        <>
          {view === "list" ? (
            // overflowX, bukan `overflow` — `overflow: hidden` akan menimpa overflowY dari spread.
            <div style={{ ...LIST_SCROLL_STYLE, border: "1px solid var(--border-hair)",
              borderRadius: "var(--radius-lg)", overflowX: "hidden" }}>
              {pg.pageItems.map((s) => <SpecRow key={s.id} spec={s} onStart={onStart}
                running={activeRunSpecs?.has(s.id)} onDelete={onDelete} onOpenRun={onOpenRun}
                onOpenDetail={(x) => setDetailId(x.id)} />)}
            </div>
          ) : (
            <div style={{ ...LIST_SCROLL_STYLE, display: "grid", gap: 12,
              gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
              {pg.pageItems.map((s) => <SpecCard key={s.id} spec={s} onStart={onStart}
                running={activeRunSpecs?.has(s.id)} onDelete={onDelete} onOpenRun={onOpenRun}
                onOpenDetail={(x) => setDetailId(x.id)} />)}
            </div>
          )}
          <div style={{ ...FIXED_ROW_STYLE, marginTop: 14, border: "1px solid var(--border-hair)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
            <Pager {...pg} onPage={pg.setPage} unit="spec" />
          </div>
        </>
      )}
      <SpecDetail spec={backlog.find((s) => s.id === detailId) || null} onClose={() => setDetailId(null)}
        onEditBranch={onEditBranch} />
    </div>
  );
}
