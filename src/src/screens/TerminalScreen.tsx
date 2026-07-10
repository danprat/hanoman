import React from "react";
import { Button, Select, StateBlock } from "../ds";
import { api, type TerminalSession } from "../api/client";
import { TerminalPane } from "./TerminalPane";
import * as L from "./terminal-layout";

export function TerminalScreen({ projects }: { projects: { id: string; name: string }[] }) {
  const [sessions, setSessions] = React.useState<TerminalSession[]>([]);
  const [layout, setLayout] = React.useState<L.Layout>(() => L.load() ?? L.emptyLayout());
  const [project, setProject] = React.useState(projects[0]?.id ?? "");

  const [loaded, setLoaded] = React.useState(false);
  React.useEffect(() => {
    api.listTerminals().then(setSessions).catch(() => setSessions([])).finally(() => setLoaded(true));
  }, []);

  // Sesi hidup di tmux dan selamat dari restart server (ADR-0016): layout ter-load bisa
  // menunjuk sesi yang masih hidup (disambung ulang) atau yang sudah di-kill (dikosongkan).
  // Ditahan sampai `loaded`: sebelum listTerminals() resolve, `sessions` masih [] dan
  // rekonsiliasi dini akan mengosongkan layout yang baru saja dipulihkan dari localStorage.
  React.useEffect(() => {
    if (!loaded) return;
    setLayout((l) => L.reconcile(l, new Set(sessions.map((s) => s.id))));
  }, [loaded, sessions]);

  React.useEffect(() => { L.save(layout); }, [layout]);

  const byId = (id: string) => sessions.find((s) => s.id === id) ?? null;
  const nameOf = (pid: string) => projects.find((p) => p.id === pid)?.name ?? pid;

  async function openNew() {
    if (!project) return;
    const { id } = await api.createTerminal(project);
    setSessions((s) => [...s, { id, projectId: project, cwd: "", exited: false }]);
    setLayout((l) => L.placeFirstEmpty(l, id));
  }

  // Tutup = perilaku hari ini: kill sesi. Sel-nya dikosongkan oleh efek rekonsiliasi.
  async function close(id: string) {
    await api.deleteTerminal(id).catch(() => {});
    setSessions((s) => s.filter((x) => x.id !== id));
  }

  const markExited = React.useCallback((id: string) => {
    setSessions((s) => s.map((x) => (x.id === id ? { ...x, exited: true } : x)));
  }, []);

  const place = (idx: number, id: string) => setLayout((l) => L.setCell(l, idx, id));
  const placeFirst = (id: string) => setLayout((l) => L.placeFirstEmpty(l, id));
  const detach = (id: string) => setLayout((l) => L.setCell(l, l.cells.indexOf(id), null));

  const placedIds = new Set(layout.cells.filter((c): c is string => c !== null));
  const unplaced = sessions.filter((s) => !placedIds.has(s.id));

  const showEmpty = layout.rows === 1 && layout.cols === 1 && !layout.cells[0] && sessions.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "calc(100vh - 180px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Button size="sm" variant="ghost" onClick={() => setLayout(L.addColumn)}>+ Kolom</Button>
        <Button size="sm" variant="ghost" onClick={() => setLayout(L.addRow)}>+ Baris</Button>
        <div style={{ flex: 1, minWidth: 0 }} />
        <Select size="sm" value={project} onChange={(e) => setProject(e.target.value)}
          options={projects.map((p) => ({ value: p.id, label: p.name }))} />
        <Button size="sm" leftIcon="plus" onClick={() => void openNew()}>Sesi baru</Button>
      </div>

      {unplaced.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>Belum di grid:</span>
          {unplaced.map((s) => (
            <span key={s.id} style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px",
              borderRadius: "var(--radius-sm)", background: "var(--bone-200)",
              border: "1px solid var(--border-hair)", fontFamily: "var(--font-mono)", fontSize: 11,
            }}>
              <button onClick={() => placeFirst(s.id)} title="Taruh di sel kosong pertama"
                style={{ all: "unset", cursor: "pointer" }}>
                {(s.runId ? `${s.runId} · resume` : nameOf(s.projectId))} · {s.id.slice(0, 6)}
              </button>
              <span aria-label={`Tutup sesi ${s.id}`} onClick={() => void close(s.id)}
                style={{ cursor: "pointer", color: "var(--text-subtle)" }}>×</span>
            </span>
          ))}
        </div>
      )}

      {showEmpty ? (
        // Tanpa `action`: toolbar di atas sudah menawarkan "Sesi baru" — tombol kedua
        // dengan label identik hanya duplikasi, bukan affordance tambahan.
        <StateBlock kind="empty" icon="terminal" title="Belum ada sesi terminal"
          hint="Pilih project lalu buka sesi — hanoman menjalankan claude --dangerously-skip-permissions di direktori project itu." />
      ) : (
        <div style={{
          flex: 1, minHeight: 0, display: "grid", gap: 8,
          gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
        }}>
          {layout.cells.map((id, idx) => {
            const s = id ? byId(id) : null;
            return (
              <div key={id ?? `empty-${idx}`} style={{
                minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column",
                border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", overflow: "hidden",
              }}>
                {s
                  ? <Cell session={s} nameOf={nameOf} onClose={() => void close(s.id)}
                      onDetach={() => detach(s.id)} onExit={() => markExited(s.id)} />
                  : <EmptyCell unplaced={unplaced} nameOf={nameOf} onPick={(sid) => place(idx, sid)} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Cell({ session, nameOf, onClose, onDetach, onExit }: {
  session: TerminalSession; nameOf: (pid: string) => string;
  onClose: () => void; onDetach: () => void; onExit: (code: number) => void;
}) {
  const label = session.runId ? `${session.runId} · resume` : nameOf(session.projectId);
  return (
    <>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", flex: "0 0 auto",
        background: "var(--bone-200)", borderBottom: "1px solid var(--border-hair)",
        fontFamily: "var(--font-mono)", fontSize: 11, color: session.exited ? "var(--text-muted)" : "var(--text-body)",
      }}>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label} · {session.id.slice(0, 6)}{session.exited && " · berakhir"}
        </span>
        <span onClick={onDetach} title="Lepas dari grid (sesi tetap hidup)"
          style={{ cursor: "pointer", color: "var(--text-subtle)" }}>lepas</span>
        <span aria-label={`Tutup sesi ${session.id}`} onClick={onClose}
          style={{ cursor: "pointer", color: "var(--text-subtle)" }}>×</span>
      </div>
      {/* key = identitas sesi: pindah antar sel memindah subtree, bukan me-remount WebSocket. */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <TerminalPane key={session.id} sessionId={session.id} onExit={onExit} />
      </div>
    </>
  );
}

function EmptyCell({ unplaced, nameOf, onPick }: {
  unplaced: TerminalSession[]; nameOf: (pid: string) => string; onPick: (id: string) => void;
}) {
  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 12 }}>
      <Select size="sm" value="" aria-label="Pilih sesi untuk sel" disabled={!unplaced.length}
        onChange={(e) => e.target.value && onPick(e.target.value)}
        options={[{ value: "", label: unplaced.length ? "Pilih sesi…" : "tidak ada sesi bebas" }]
          .concat(unplaced.map((s) => ({
            value: s.id,
            label: `${s.runId ? `${s.runId} · resume` : nameOf(s.projectId)} · ${s.id.slice(0, 6)}`,
          })))} />
    </div>
  );
}
