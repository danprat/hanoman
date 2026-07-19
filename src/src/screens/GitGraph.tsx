/* GitGraph — DAG commit read + aksi (SPEC-182). Lane dihitung computeLanes (nol dep).
   Baris = grid [svg lane | subject | refs | meta]; klik = detail; klik-kanan = context-menu. */
import React from "react";
import { Card, Button, StateBlock, Badge } from "../ds";
import { api, type GraphCommit, type CommitDetail, type GitOp } from "../api/client";
import { computeLanes, rowEdges, type GraphRow, type Edge } from "./git-graph";

const LANE_W = 14, ROW_H = 30, DOT = 4;
const COLORS = ["#a9791c", "#3b7a57", "#8a5a44", "#4a6fa5", "#7d5ba6", "#b0503a"]; // brass-leaf-clay-ink
const laneColor = (i: number) => COLORS[i % COLORS.length];
const rel = (iso: string): string => {
  const t = new Date(iso).getTime();
  if (!t) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 2592000) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString();
};

// Segmen edge → path SVG. Kurva-S (bezier) saat pindah lane, garis lurus saat sejajar.
function edgePath(e: Edge): string {
  const x = (i: number) => LANE_W / 2 + i * LANE_W;
  const y1 = e.half === "bottom" ? ROW_H / 2 : 0;
  const y2 = e.half === "top" ? ROW_H / 2 : ROW_H;
  const x1 = x(e.fromLane), x2 = x(e.toLane), ym = (y1 + y2) / 2;
  return x1 === x2 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}C${x1} ${ym},${x2} ${ym},${x2} ${y2}`;
}

function RowSvg({ row, edges, maxLanes }: { row: GraphRow; edges: Edge[]; maxLanes: number }) {
  const cx = LANE_W / 2 + row.lane * LANE_W;
  return (
    <svg width={maxLanes * LANE_W} height={ROW_H} style={{ flex: "0 0 auto" }}>
      {edges.map((e, i) => (
        <path key={i} d={edgePath(e)} fill="none" stroke={laneColor(e.colorLane)} strokeWidth={1.5} />
      ))}
      <circle cx={cx} cy={ROW_H / 2} r={DOT} fill={laneColor(row.lane)} stroke="var(--surface-card)" strokeWidth={1.5} />
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

type MenuItem = { label: string; run: () => void };

// Item context-menu untuk satu commit. Aksi hapus branch sadar local vs origin (SPEC-206):
// ref `origin/<b>` dikelompokkan dengan branch lokal `<b>` bila keduanya menunjuk commit ini.
// SPEC-229 · aksi merge lewat `merge` (jalur worktree isolasi + sesi claude), bukan `act`/onRunGit.
type MergeFn = (source: string, opts?: { ff?: "no-ff" | "ff-only"; deleteBranch?: string }) => void;
function menuItems(c: GraphCommit, current: string, act: (op: GitOp) => void, merge: MergeFn): MenuItem[] {
  const locals = c.refs.filter((r) => !r.startsWith("origin/"));
  const origins = c.refs.filter((r) => r.startsWith("origin/") && r !== "origin/HEAD").map((r) => r.slice("origin/".length));
  const names = [...new Set([...locals, ...origins])];
  return [
    { label: `Checkout ${c.sha.slice(0, 7)}`, run: () => act({ op: "checkout", ref: c.sha }) },
    { label: "Merge (fast-forward bila bisa)", run: () => merge(c.sha) },
    { label: "Merge tanpa fast-forward", run: () => merge(c.sha, { ff: "no-ff" }) },
    { label: "Merge fast-forward saja", run: () => merge(c.sha, { ff: "ff-only" }) },
    { label: "Cherry-pick", run: () => act({ op: "cherry-pick", sha: c.sha }) },
    { label: "Revert", run: () => act({ op: "revert", sha: c.sha }) },
    { label: "Buat branch di sini…", run: () => { const name = window.prompt("Nama branch baru:"); if (name) act({ op: "branch", name, at: c.sha, checkout: true }); } },
    // Merge branch ini lalu hapus (local + origin bila ada). Hanya branch lokal selain yang aktif.
    ...locals.filter((r) => r !== current).map((r) => ({
      label: `Merge ${r} lalu hapus (local${origins.includes(r) ? " + origin" : ""})`,
      run: () => merge(r, { deleteBranch: r }),
    })),
    // Hapus mandiri per branch: local &/atau origin. Local tak boleh branch aktif; origin selalu boleh.
    ...names.flatMap((r) => {
      const localOk = locals.includes(r) && r !== current, hasOrigin = origins.includes(r);
      const items: MenuItem[] = [];
      if (localOk && hasOrigin) items.push({ label: `Hapus ${r} (local + origin)`, run: () => act({ op: "delete-branch", name: r, remote: true }) });
      if (localOk) items.push({ label: `Hapus ${r} (local)`, run: () => act({ op: "delete-branch", name: r }) });
      if (hasOrigin) items.push({ label: `Hapus origin/${r}`, run: () => act({ op: "delete-branch", name: r, local: false, remote: true }) });
      return items;
    }),
  ];
}

export function GitGraph({ projectId, onRunGit, onMerge, onOpenFile }:
  { projectId: string; onRunGit: (op: GitOp) => Promise<unknown>;
    onMerge: (source: string, opts?: { ff?: "no-ff" | "ff-only"; deleteBranch?: string }) => Promise<void>;
    onOpenFile: (path: string, ref: string) => void }) {
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
  // SPEC-229 · merge lewat jalur isolasi; sukses → reload graph, konflik/error ditangani onMerge (toast/nav).
  async function mergeAct(source: string, opts?: { ff?: "no-ff" | "ff-only"; deleteBranch?: string }) {
    setMenu(null); await onMerge(source, opts).then(load).catch(() => {});
  }

  const maxLanes = Math.max(1, ...rows.map((r) => r.width));
  const allEdges = React.useMemo(() => rowEdges(rows), [rows]);

  if (state === "loading") return <StateBlock kind="loading" title="Memuat git graph…" />;
  if (state === "error") return <StateBlock kind="error" title="Gagal memuat git graph" action={load} />;
  if (rows.length === 0) return <StateBlock kind="empty" icon="git-commit" title="Belum ada commit" />;

  return (
    <div style={{ display: "grid", gridTemplateColumns: detail ? "1fr 340px" : "1fr", gap: 16, alignItems: "start" }}>
      <Card padding={0}>
        {rows.map((r, i) => {
          const c = r.commit;
          const isHead = c.refs.includes(current);
          const sel = detail?.sha === c.sha;
          return (
            <div key={c.sha} onClick={() => api.ideCommit(projectId, c.sha).then(setDetail).catch(() => {})}
              onContextMenu={(e) => openMenu(e, c)}
              onMouseEnter={(e) => { if (!sel) e.currentTarget.style.background = "var(--bone-100)"; }}
              onMouseLeave={(e) => { if (!sel) e.currentTarget.style.background = "transparent"; }}
              style={{ display: "flex", alignItems: "center", gap: 10, height: ROW_H, padding: "0 12px",
                cursor: "pointer", borderBottom: "1px solid var(--border-hair)",
                background: sel ? "var(--brass-100)" : "transparent" }}>
              <RowSvg row={r} edges={allEdges[i] ?? []} maxLanes={maxLanes} />
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
                {c.refs.map((ref) => (
                  <span key={ref} style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, padding: "1px 6px",
                    borderRadius: 999, background: isHead && ref === current ? "var(--brass-500)" : "var(--brass-100)",
                    color: isHead && ref === current ? "#fff" : "var(--brass-700)", flex: "0 0 auto" }}>{ref}</span>
                ))}
                <span style={{ fontSize: 12.5, color: "var(--text-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.subject}</span>
              </div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)",
                flex: "0 0 auto", width: 88, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right" }}>{c.author}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)",
                flex: "0 0 auto", width: 40, textAlign: "right" }}>{rel(c.at)}</span>
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

      {menu && <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={menuItems(menu.c, current, act, mergeAct)} />}
    </div>
  );
}
