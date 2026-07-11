/* GitGraph — DAG commit read + aksi (SPEC-182). Lane dihitung computeLanes (nol dep).
   Baris = grid [svg lane | subject | refs | meta]; klik = detail; klik-kanan = context-menu. */
import React from "react";
import { Card, Button, StateBlock, Badge } from "../ds";
import { api, type GraphCommit, type CommitDetail, type GitOp } from "../api/client";
import { computeLanes, type GraphRow } from "./git-graph";

const LANE_W = 14, ROW_H = 30, DOT = 4;
const COLORS = ["#a9791c", "#3b7a57", "#8a5a44", "#4a6fa5", "#7d5ba6", "#b0503a"]; // brass-leaf-clay-ink
const laneColor = (i: number) => COLORS[i % COLORS.length];
const rel = (iso: string): string => { try { return new Date(iso).toLocaleDateString(); } catch { return ""; } };

function RowSvg({ row, maxLanes }: { row: GraphRow; maxLanes: number }) {
  const x = (i: number) => LANE_W / 2 + i * LANE_W;
  return (
    <svg width={maxLanes * LANE_W} height={ROW_H} style={{ flex: "0 0 auto" }}>
      {/* garis vertikal untuk tiap lane aktif setelah commit ini */}
      {row.lanes.map((s, i) => s ? <line key={i} x1={x(i)} y1={0} x2={x(i)} y2={ROW_H} stroke={laneColor(i)} strokeWidth={1.5} /> : null)}
      {/* garis dari commit ke lane parent-nya di baris berikut */}
      <line x1={x(row.lane)} y1={ROW_H / 2} x2={x(row.lane)} y2={ROW_H} stroke={laneColor(row.lane)} strokeWidth={1.5} />
      <circle cx={x(row.lane)} cy={ROW_H / 2} r={DOT} fill={laneColor(row.lane)} />
    </svg>
  );
}

function Menu({ x, y, items, onClose }: { x: number; y: number; items: { label: string; run: () => void }[]; onClose: () => void }) {
  React.useEffect(() => { const h = () => onClose(); window.addEventListener("click", h); return () => window.removeEventListener("click", h); }, [onClose]);
  return (
    <div style={{ position: "fixed", left: x, top: y, zIndex: 150, background: "var(--surface-card)",
      border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow-pop, 0 6px 24px rgba(0,0,0,.15))",
      padding: 4, minWidth: 180 }}>
      {items.map((it) => (
        <button key={it.label} onClick={it.run} style={{ display: "block", width: "100%", textAlign: "left",
          padding: "7px 10px", border: "none", background: "transparent", cursor: "pointer",
          fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--text-body)", borderRadius: 4 }}>{it.label}</button>
      ))}
    </div>
  );
}

export function GitGraph({ projectId, onRunGit, onOpenFile }:
  { projectId: string; onRunGit: (op: GitOp) => Promise<unknown>; onOpenFile: (path: string, ref: string) => void }) {
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [rows, setRows] = React.useState<GraphRow[]>([]);
  const [current, setCurrent] = React.useState("");
  const [detail, setDetail] = React.useState<CommitDetail | null>(null);
  const [menu, setMenu] = React.useState<{ x: number; y: number; c: GraphCommit } | null>(null);

  const load = React.useCallback(() => {
    setState("loading");
    api.ideGraph(projectId).then((g) => { setRows(computeLanes(g.commits)); setCurrent(g.current); setState("ready"); })
      .catch(() => setState("error"));
  }, [projectId]);
  React.useEffect(() => { load(); }, [load]);

  function openMenu(e: React.MouseEvent, c: GraphCommit) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, c });
  }
  async function act(op: GitOp) { setMenu(null); await onRunGit(op).then(load).catch(() => {}); }

  const maxLanes = Math.max(1, ...rows.map((r) => r.width));

  if (state === "loading") return <StateBlock kind="loading" title="Memuat git graph…" />;
  if (state === "error") return <StateBlock kind="error" title="Gagal memuat git graph" action={load} />;
  if (rows.length === 0) return <StateBlock kind="empty" icon="git-commit" title="Belum ada commit" />;

  return (
    <div style={{ display: "grid", gridTemplateColumns: detail ? "1fr 340px" : "1fr", gap: 16, alignItems: "start" }}>
      <Card padding={0}>
        {rows.map((r) => {
          const c = r.commit;
          const isHead = c.refs.includes(current);
          return (
            <div key={c.sha} onClick={() => api.ideCommit(projectId, c.sha).then(setDetail).catch(() => {})}
              onContextMenu={(e) => openMenu(e, c)}
              style={{ display: "flex", alignItems: "center", gap: 10, height: ROW_H, padding: "0 12px",
                cursor: "pointer", borderBottom: "1px solid var(--border-hair)",
                background: detail?.sha === c.sha ? "var(--brass-100)" : "transparent" }}>
              <RowSvg row={r} maxLanes={maxLanes} />
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
                {c.refs.map((ref) => (
                  <span key={ref} style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, padding: "1px 6px",
                    borderRadius: 999, background: isHead && ref === current ? "var(--brass-500)" : "var(--brass-100)",
                    color: isHead && ref === current ? "#fff" : "var(--brass-700)", flex: "0 0 auto" }}>{ref}</span>
                ))}
                <span style={{ fontSize: 12.5, color: "var(--text-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.subject}</span>
              </div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)", flex: "0 0 auto" }}>{c.author}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)", flex: "0 0 auto" }}>{rel(c.at)}</span>
            </div>
          );
        })}
      </Card>

      {detail && (
        <Card padding={16}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span className="hn-eyebrow">commit {detail.sha.slice(0, 8)}</span>
            <Button size="sm" variant="ghost" leftIcon="x" onClick={() => setDetail(null)}>Tutup</Button>
          </div>
          <div style={{ fontSize: 13, color: "var(--text-strong)", fontWeight: 600, marginBottom: 4 }}>{detail.subject}</div>
          {detail.body && <pre style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, whiteSpace: "pre-wrap", color: "var(--text-muted)", marginBottom: 10 }}>{detail.body}</pre>}
          <div className="hn-eyebrow" style={{ marginBottom: 6 }}>{detail.changed.length} file berubah</div>
          {detail.changed.map((f) => (
            <button key={f.path} onClick={() => onOpenFile(f.path, detail.sha)} style={{ display: "flex", alignItems: "center", gap: 8,
              width: "100%", textAlign: "left", padding: "4px 6px", border: "none", background: "transparent", cursor: "pointer" }}>
              <Badge tone={f.status === "A" ? "ok" : f.status === "D" ? "err" : "warn"} size="sm">{f.status}</Badge>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-body)" }}>{f.path}</span>
            </button>
          ))}
        </Card>
      )}

      {menu && <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
        { label: `Checkout ${menu.c.sha.slice(0, 7)}`, run: () => act({ op: "checkout", ref: menu.c.sha }) },
        { label: "Merge ke branch ini", run: () => act({ op: "merge", ref: menu.c.sha }) },
        { label: "Cherry-pick", run: () => act({ op: "cherry-pick", sha: menu.c.sha }) },
        { label: "Revert", run: () => act({ op: "revert", sha: menu.c.sha }) },
        { label: "Buat branch di sini…", run: () => { const name = window.prompt("Nama branch baru:"); if (name) act({ op: "branch", name, at: menu.c.sha, checkout: true }); } },
        ...menu.c.refs.filter((r) => !r.startsWith("origin/")).map((r) => ({ label: `Hapus branch ${r}`, run: () => act({ op: "delete-branch", name: r }) })),
      ]} />}
    </div>
  );
}
