/* GitGraph — DAG commit read + aksi (SPEC-182). Lane dihitung computeLanes (nol dep).
   Baris = grid [svg lane | subject | refs | meta]; klik = detail; klik-kanan = context-menu. */
import React from "react";
import { Card, Button, StateBlock, Badge } from "../ds";
import { api, type GraphCommit, type CommitDetail, type GitOp, type RepoStatus, type Stash } from "../api/client";
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
type RefFn = (ref: string) => void; // rebase(onto) / drop(sha) / pull(source)
function menuItems(c: GraphCommit, current: string, act: (op: GitOp) => void, merge: MergeFn, rebase: RefFn, drop: RefFn): MenuItem[] {
  const locals = c.refs.filter((r) => !r.startsWith("origin/"));
  const origins = c.refs.filter((r) => r.startsWith("origin/") && r !== "origin/HEAD").map((r) => r.slice("origin/".length));
  const names = [...new Set([...locals, ...origins])];
  const copy = (t: string) => { void navigator.clipboard?.writeText(t); };
  return [
    { label: `Checkout ${c.sha.slice(0, 7)}`, run: () => act({ op: "checkout", ref: c.sha }) },
    { label: "Merge (fast-forward bila bisa)", run: () => merge(c.sha) },
    { label: "Merge tanpa fast-forward", run: () => merge(c.sha, { ff: "no-ff" }) },
    { label: "Merge fast-forward saja", run: () => merge(c.sha, { ff: "ff-only" }) },
    { label: "Cherry-pick", run: () => act({ op: "cherry-pick", sha: c.sha }) },
    { label: "Revert", run: () => act({ op: "revert", sha: c.sha }) },
    // SPEC-233 · rebase current ke commit ini / buang commit ini (isolasi + konflik → sesi claude)
    { label: "Rebase current → sini", run: () => rebase(c.sha) },
    { label: "Drop commit", run: () => drop(c.sha) },
    // SPEC-233 · reset branch current ke commit ini (soft/mixed/hard). hard ireversibel → gate force.
    { label: "Reset current → sini (soft)", run: () => act({ op: "reset", sha: c.sha, mode: "soft" }) },
    { label: "Reset current → sini (mixed)", run: () => act({ op: "reset", sha: c.sha, mode: "mixed" }) },
    { label: "Reset current → sini (hard)", run: () => act({ op: "reset", sha: c.sha, mode: "hard" }) },
    { label: "Copy hash", run: () => copy(c.sha) },
    { label: "Copy subject", run: () => copy(c.subject) },
    { label: "Buat branch di sini…", run: () => { const name = window.prompt("Nama branch baru:"); if (name) act({ op: "branch", name, at: c.sha, checkout: true }); } },
    // SPEC-233 · buat tag di commit ini. Pesan kosong = lightweight; terisi = annotated. Konfirmasi push.
    { label: "Add tag…", run: () => {
      const name = window.prompt("Nama tag:"); if (!name) return;
      const message = window.prompt("Pesan (kosong = lightweight):") || undefined;
      const push = window.confirm("Dorong tag ke origin?");
      act({ op: "tag", name, message, at: c.sha, push });
    } },
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

// SPEC-233 · menu klik-kanan pada pill branch. Local vs origin dibedakan prefix `origin/`.
// Branch aktif (== current) hanya Rename/Push/Copy (tak boleh checkout/merge/hapus diri sendiri).
function branchMenuItems(ref: string, current: string, allRefs: string[], act: (op: GitOp) => void, merge: MergeFn, rebase: RefFn, pull: RefFn): MenuItem[] {
  const isOrigin = ref.startsWith("origin/");
  const name = isOrigin ? ref.slice("origin/".length) : ref;
  const copy = () => { void navigator.clipboard?.writeText(ref); };
  if (isOrigin) return [
    { label: `Checkout ${ref}`, run: () => act({ op: "checkout", ref }) },
    { label: `Merge ${ref} → current`, run: () => merge(ref) },
    { label: `Pull ${name} → current`, run: () => pull(name) },
    { label: `Hapus origin/${name}`, run: () => act({ op: "delete-branch", name, local: false, remote: true }) },
    { label: "Copy nama branch", run: copy },
  ];
  const self = ref === current;
  const hasOrigin = allRefs.includes(`origin/${name}`);
  const items: MenuItem[] = [];
  if (!self) items.push({ label: `Checkout ${ref}`, run: () => act({ op: "checkout", ref }) });
  items.push({ label: "Rename…", run: () => { const to = window.prompt(`Nama baru untuk ${ref}:`, ref); if (to && to !== ref) act({ op: "rename-branch", from: ref, to }); } });
  items.push({ label: "Push ke origin", run: () => act({ op: "push-branch", name: ref, setUpstream: true }) });
  if (!self) items.push({ label: `Merge ${ref} → current`, run: () => merge(ref) });
  if (!self) items.push({ label: `Rebase current → ${ref}`, run: () => rebase(ref) });
  if (!self) {
    items.push({ label: hasOrigin ? `Hapus ${ref} (local + origin)` : `Hapus ${ref} (local)`, run: () => act({ op: "delete-branch", name: ref, remote: hasOrigin }) });
    if (hasOrigin) items.push({ label: `Hapus ${ref} (local saja)`, run: () => act({ op: "delete-branch", name: ref }) });
  }
  items.push({ label: "Copy nama branch", run: copy });
  return items;
}

export function GitGraph({ projectId, onRunGit, onMerge, onRebase, onPull, onDrop, onOpenFile }:
  { projectId: string; onRunGit: (op: GitOp) => Promise<unknown>;
    onMerge: (source: string, opts?: { ff?: "no-ff" | "ff-only"; deleteBranch?: string }) => Promise<void>;
    onRebase: (onto: string) => Promise<void>;
    onPull: (source: string) => Promise<void>;
    onDrop: (sha: string) => Promise<void>;
    onOpenFile: (path: string, ref: string) => void }) {
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [rows, setRows] = React.useState<GraphRow[]>([]);
  const [current, setCurrent] = React.useState("");
  const [detail, setDetail] = React.useState<CommitDetail | null>(null);
  const [menu, setMenu] = React.useState<{ x: number; y: number; c: GraphCommit } | null>(null);
  const [tagMenu, setTagMenu] = React.useState<{ x: number; y: number; tag: string } | null>(null);
  const [status, setStatus] = React.useState<RepoStatus | null>(null);
  const [uncMenu, setUncMenu] = React.useState<{ x: number; y: number } | null>(null);
  const [stashes, setStashes] = React.useState<Stash[]>([]);
  const [stashMenu, setStashMenu] = React.useState<{ x: number; y: number; s: Stash } | null>(null);
  const [branchMenu, setBranchMenu] = React.useState<{ x: number; y: number; ref: string } | null>(null);
  const allRefs = React.useMemo(() => rows.flatMap((r) => r.commit.refs), [rows]);

  const load = React.useCallback(() => {
    setState("loading");
    api.ideGraph(projectId).then((g) => { setRows(computeLanes(g.commits)); setCurrent(g.current); setState("ready"); })
      .catch(() => setState("error"));
    api.ideStatus(projectId).then(setStatus).catch(() => setStatus(null));
    api.ideStashes(projectId).then(setStashes).catch(() => setStashes([]));
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
  // SPEC-233 · rebase/pull/drop lewat jalur isolasi (pola merge); konflik/error ditangani host (toast/nav).
  async function rebaseAct(onto: string) { setMenu(null); setBranchMenu(null); await onRebase(onto).then(load).catch(() => {}); }
  async function pullAct(source: string) { setMenu(null); setBranchMenu(null); await onPull(source).then(load).catch(() => {}); }
  async function dropAct(sha: string) { setMenu(null); await onDrop(sha).then(load).catch(() => {}); }

  const maxLanes = Math.max(1, ...rows.map((r) => r.width));
  const allEdges = React.useMemo(() => rowEdges(rows), [rows]);

  if (state === "loading") return <StateBlock kind="loading" title="Memuat git graph…" />;
  if (state === "error") return <StateBlock kind="error" title="Gagal memuat git graph" action={load} />;
  if (rows.length === 0) return <StateBlock kind="empty" icon="git-commit" title="Belum ada commit" />;

  return (
    <div style={{ display: "grid", gridTemplateColumns: detail ? "1fr 340px" : "1fr", gap: 16, alignItems: "start" }}>
      <Card padding={0}>
        {/* SPEC-233 · baris uncommitted changes (lingkaran terbuka) di puncak bila working tree kotor */}
        {status && !status.clean && (() => {
          const n = status.staged.length + status.unstaged.length + status.untracked.length;
          const first = status.unstaged[0] ?? status.untracked[0] ?? status.staged[0];
          return (
            <div onClick={() => { if (first) onOpenFile(first, ""); }}
              onContextMenu={(e) => { e.preventDefault(); setUncMenu({ x: e.clientX, y: e.clientY }); }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bone-100)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              style={{ display: "flex", alignItems: "center", gap: 10, height: ROW_H, padding: "0 12px",
                cursor: "pointer", borderBottom: "1px solid var(--border-hair)" }}>
              <svg width={maxLanes * LANE_W} height={ROW_H} style={{ flex: "0 0 auto" }}>
                <circle cx={LANE_W / 2} cy={ROW_H / 2} r={DOT} fill="none" stroke={laneColor(0)} strokeWidth={1.5} />
              </svg>
              <span style={{ fontSize: 12.5, fontStyle: "italic", color: "var(--text-muted)", flex: 1 }}>
                Uncommitted changes · {n} file
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)", flex: "0 0 auto", width: 88, textAlign: "right" }}>working tree</span>
              <span style={{ width: 40, flex: "0 0 auto" }} />
            </div>
          );
        })()}
        {/* SPEC-233 · stash sebagai chip di puncak; klik-kanan → apply/pop/drop/branch/copy */}
        {stashes.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "6px 12px", borderBottom: "1px solid var(--border-hair)" }}>
            <span className="hn-eyebrow" style={{ marginRight: 4 }}>stash</span>
            {stashes.map((s) => (
              <span key={s.ref} title={s.message}
                onClick={(e) => { e.stopPropagation(); setStashMenu({ x: e.clientX, y: e.clientY, s }); }}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setStashMenu({ x: e.clientX, y: e.clientY, s }); }}
                style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, padding: "2px 8px", borderRadius: 999,
                  cursor: "pointer", background: "var(--ink-100, #e7e6e1)", color: "var(--text-muted)", flex: "0 0 auto" }}>
                {s.ref}: {s.message.length > 40 ? s.message.slice(0, 40) + "…" : s.message}
              </span>
            ))}
          </div>
        )}
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
                  <span key={ref} title="branch — klik-kanan untuk aksi"
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setBranchMenu({ x: e.clientX, y: e.clientY, ref }); }}
                    style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, padding: "1px 6px", cursor: "context-menu",
                    borderRadius: 999, background: isHead && ref === current ? "var(--brass-500)" : "var(--brass-100)",
                    color: isHead && ref === current ? "#fff" : "var(--brass-700)", flex: "0 0 auto" }}>{ref}</span>
                ))}
                {/* SPEC-233 · tag = pill terpisah (warna leaf, ikon tag); klik-kanan → menu tag */}
                {c.tags.map((t) => (
                  <span key={`tag:${t}`} title="tag — klik-kanan untuk aksi"
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setTagMenu({ x: e.clientX, y: e.clientY, tag: t }); }}
                    style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, padding: "1px 6px 1px 4px", borderRadius: 999,
                      display: "inline-flex", alignItems: "center", gap: 3, background: "var(--leaf-100, #e6efe9)",
                      color: "var(--leaf-600, #3b7a57)", flex: "0 0 auto" }}>⌂{t}</span>
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

      {menu && <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={menuItems(menu.c, current, act, mergeAct, rebaseAct, dropAct)} />}
      {tagMenu && <Menu x={tagMenu.x} y={tagMenu.y} onClose={() => setTagMenu(null)} items={[
        { label: `Hapus tag ${tagMenu.tag} (local)`, run: () => { setTagMenu(null); void act({ op: "delete-tag", name: tagMenu.tag }); } },
        { label: `Hapus tag ${tagMenu.tag} (local + origin)`, run: () => { setTagMenu(null); void act({ op: "delete-tag", name: tagMenu.tag, remote: true }); } },
        { label: "Push tag ke origin", run: () => { setTagMenu(null); void act({ op: "push-tag", name: tagMenu.tag }); } },
        { label: "Copy nama tag", run: () => { setTagMenu(null); void navigator.clipboard?.writeText(tagMenu.tag); } },
      ]} />}
      {uncMenu && <Menu x={uncMenu.x} y={uncMenu.y} onClose={() => setUncMenu(null)} items={[
        // SPEC-233 · aksi baris uncommitted. reset --hard & clean ireversibel → gate force via act.
        { label: "Stash perubahan…", run: () => { setUncMenu(null); const m = window.prompt("Pesan stash (opsional):") || undefined; void act({ op: "stash", message: m, includeUntracked: true }); } },
        { label: "Reset working tree (mixed — unstage)", run: () => { setUncMenu(null); void act({ op: "reset-worktree", mode: "mixed" }); } },
        { label: "Reset working tree (hard — buang semua)", run: () => { setUncMenu(null); void act({ op: "reset-worktree", mode: "hard" }); } },
        { label: "Clean untracked", run: () => { setUncMenu(null); void act({ op: "clean", directories: true }); } },
      ]} />}
      {stashMenu && <Menu x={stashMenu.x} y={stashMenu.y} onClose={() => setStashMenu(null)} items={[
        { label: "Apply (jaga stash)", run: () => { const s = stashMenu.s; setStashMenu(null); void act({ op: "stash-apply", ref: s.ref }); } },
        { label: "Pop (apply + buang)", run: () => { const s = stashMenu.s; setStashMenu(null); void act({ op: "stash-pop", ref: s.ref }); } },
        { label: "Drop (buang stash)", run: () => { const s = stashMenu.s; setStashMenu(null); void act({ op: "stash-drop", ref: s.ref }); } },
        { label: "Buat branch dari stash…", run: () => { const s = stashMenu.s; setStashMenu(null); const name = window.prompt("Nama branch baru:"); if (name) void act({ op: "stash-branch", ref: s.ref, name }); } },
        { label: "Copy nama stash", run: () => { const s = stashMenu.s; setStashMenu(null); void navigator.clipboard?.writeText(s.ref); } },
      ]} />}
      {branchMenu && <Menu x={branchMenu.x} y={branchMenu.y} onClose={() => setBranchMenu(null)}
        items={branchMenuItems(branchMenu.ref, current, allRefs, act, mergeAct, rebaseAct, pullAct)} />}
    </div>
  );
}
