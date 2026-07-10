import React from "react";
import { Button, IconButton, Select, StateBlock } from "../ds";
import { api, type TerminalSession, type Phase } from "../api/client";
import { TerminalPane } from "./TerminalPane";
import * as L from "./terminal-layout";
import * as W from "./terminal-workspace";

export function TerminalScreen({ projects }: { projects: { id: string; name: string }[] }) {
  const [sessions, setSessions] = React.useState<TerminalSession[]>([]);
  const [ws, setWs] = React.useState<W.Workspace>(() => W.load() ?? W.emptyWorkspace());
  const [project, setProject] = React.useState(projects[0]?.id ?? "");
  const [maxed, setMaxed] = React.useState(false);

  const [loaded, setLoaded] = React.useState(false);
  React.useEffect(() => {
    api.listTerminals().then(setSessions).catch(() => setSessions([])).finally(() => setLoaded(true));
  }, []);

  // Sesi hidup di tmux dan selamat dari restart server (ADR-0016): workspace ter-load bisa
  // menunjuk sesi yang masih hidup (disambung ulang) atau yang sudah di-kill (dikosongkan).
  // Ditahan sampai `loaded`: sebelum listTerminals() resolve, `sessions` masih [] dan
  // rekonsiliasi dini akan mengosongkan workspace yang baru saja dipulihkan dari localStorage.
  React.useEffect(() => {
    if (!loaded) return;
    setWs((w) => W.reconcileAll(w, new Set(sessions.map((s) => s.id))));
  }, [loaded, sessions]);

  React.useEffect(() => { W.save(ws); }, [ws]);

  const byId = (id: string) => sessions.find((s) => s.id === id) ?? null;
  const nameOf = (pid: string) => projects.find((p) => p.id === pid)?.name ?? pid;

  async function openNew() {
    if (!project) return;
    const { id } = await api.createTerminal(project);
    setSessions((s) => [...s, { id, projectId: project, cwd: "", exited: false }]);
    setWs((w) => W.placeFirstEmptyInActive(w, id));
  }

  // Tutup = perilaku hari ini: kill sesi. Selnya dikosongkan oleh efek rekonsiliasi.
  async function close(id: string) {
    await api.deleteTerminal(id).catch(() => {});
    setSessions((s) => s.filter((x) => x.id !== id));
  }

  const markExited = React.useCallback((id: string) => {
    setSessions((s) => s.map((x) => (x.id === id ? { ...x, exited: true } : x)));
  }, []);

  const place = (idx: number, id: string) => setWs((w) => W.placeInActive(w, idx, id));
  const placeFirst = (id: string) => setWs((w) => W.placeFirstEmptyInActive(w, id));
  const detach = (id: string) => setWs((w) => W.detach(w, id));

  const placed = W.placedIds(ws);
  const unplaced = sessions.filter((s) => !placed.has(s.id));

  const layout = W.activeGroup(ws).layout;
  const showEmpty = layout.rows === 1 && layout.cols === 1 && !layout.cells[0] && sessions.length === 0;

  // Overlay menimpa Shell, bukan melepas screen darinya. zIndex 100: di atas konten halaman,
  // di bawah modal (150) dan toast (200) di ds/kit.tsx — kalau dibalik, dialog konfirmasi
  // terkubur di belakang terminal.
  // ponytail: Escape sengaja TIDAK di-bind untuk keluar. Ia tombol tersibuk di TUI Claude Code;
  // merebutnya demi menutup overlay menukar hal yang dipakai tiap menit dengan hal yang dipakai
  // sekali. Keluar lewat tombol saja. Ada test yang menjaga ini.
  const rootStyle: React.CSSProperties = {
    display: "flex", flexDirection: "column", gap: maxed ? 8 : 12,
    ...(maxed
      ? { position: "fixed", inset: 0, zIndex: 100, background: "var(--surface-page)", padding: 12 }
      : { height: "calc(100vh - 180px)" }),
  };

  return (
    <div data-testid="terminal-root" style={rootStyle}>
      {/* Saat maximize, tabbar & toolbar melebur jadi satu baris supaya ~110px chrome
          kembali ke grid — itu inti permintaannya. */}
      <div style={{ display: "flex", gap: 8,
        flexDirection: maxed ? "row" : "column", alignItems: maxed ? "center" : "stretch" }}>
        <GroupTabs
          compact={maxed}
          ws={ws}
          onSelect={(id) => setWs((w) => W.selectGroup(w, id))}
          onAdd={() => setWs((w) => W.addGroup(w, `Grup ${w.groups.length + 1}`))}
          onRename={(id, name) => setWs((w) => W.renameGroup(w, id, name))}
          onRemove={(id) => setWs((w) => W.removeGroup(w, id))}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
          ...(maxed ? { flex: 1, minWidth: 0 } : {}) }}>
          <Button size="sm" variant="ghost" onClick={() => setWs((w) => W.mapActiveLayout(w, L.addColumn))}>+ Kolom</Button>
          <Button size="sm" variant="ghost" onClick={() => setWs((w) => W.mapActiveLayout(w, L.addRow))}>+ Baris</Button>
          <div style={{ flex: 1, minWidth: 0 }} />
          <Select size="sm" value={project} onChange={(e) => setProject(e.target.value)}
            options={projects.map((p) => ({ value: p.id, label: p.name }))} />
          <Button size="sm" leftIcon="plus" onClick={() => void openNew()}>Sesi baru</Button>
          <IconButton size="sm" icon={maxed ? "minimize-2" : "maximize-2"}
            label={maxed ? "Keluar layar penuh" : "Layar penuh"}
            aria-pressed={maxed} onClick={() => setMaxed((m) => !m)} />
        </div>
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
              <button onClick={() => placeFirst(s.id)} title="Taruh di sel kosong pertama grup ini"
                style={{ all: "unset", cursor: "pointer" }}>
                {s.specId ?? nameOf(s.projectId)} · {s.id.slice(0, 6)}
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
          gridTemplateColumns: `18px repeat(${layout.cols}, minmax(0, 1fr))`,
          gridTemplateRows: `16px repeat(${layout.rows}, minmax(0, 1fr))`,
        }}>
          <div />{/* pojok kiri-atas: perpotongan kedua gutter */}
          {Array.from({ length: layout.cols }, (_, c) => (
            <GutterX key={`col-${c}`} label={`Tutup kolom ${c + 1}`} disabled={layout.cols === 1}
              onClick={() => setWs((w) => W.mapActiveLayout(w, (l) => L.removeColumn(l, c)))} />
          ))}
          {Array.from({ length: layout.rows }, (_, r) => (
            <React.Fragment key={`row-${r}`}>
              <GutterX label={`Tutup baris ${r + 1}`} disabled={layout.rows === 1}
                onClick={() => setWs((w) => W.mapActiveLayout(w, (l) => L.removeRow(l, r)))} />
              {Array.from({ length: layout.cols }, (_, c) => {
                const idx = r * layout.cols + c;
                const id = layout.cells[idx] ?? null;
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
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

// Tab = grup, tiap grup punya grid sendiri. Grup non-aktif tak dirender: pane-nya unmount
// dan WebSocket-nya tertutup. Kembali ke tab itu meng-attach ulang ke sesi tmux yang sama —
// scrollback dipegang tmux (ADR-0016), bukan buffer xterm di memori.
function GroupTabs({ ws, compact = false, onSelect, onAdd, onRename, onRemove }: {
  ws: W.Workspace; compact?: boolean; onSelect: (id: string) => void; onAdd: () => void;
  onRename: (id: string, name: string) => void; onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = React.useState<string | null>(null);
  const active = W.activeGroup(ws);
  const only = ws.groups.length === 1;

  return (
    <div role="tablist" aria-label="Grup terminal"
      style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap",
        // Baris digabung → garis bawah tabbar akan memotong baris chrome di tengah.
        ...(compact ? {} : { borderBottom: "1px solid var(--border-hair)", paddingBottom: 4 }) }}>
      {ws.groups.map((g) => {
        const isActive = g.id === active.id;
        if (editing === g.id)
          return <RenameInput key={g.id} initial={g.name}
            onCommit={(name) => { if (name.trim()) onRename(g.id, name.trim()); setEditing(null); }}
            onCancel={() => setEditing(null)} />;
        return (
          <span key={g.id} style={{
            display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 6px",
            borderRadius: "var(--radius-sm)", fontSize: 12,
            background: isActive ? "var(--bone-200)" : "transparent",
            border: `1px solid ${isActive ? "var(--border-hair)" : "transparent"}`,
          }}>
            <button role="tab" aria-selected={isActive} onClick={() => onSelect(g.id)}
              style={{ all: "unset", cursor: "pointer", color: isActive ? "var(--text-strong)" : "var(--text-muted)" }}>
              {g.name}
            </button>
            {isActive && (
              <>
                <button aria-label={`Ganti nama grup ${g.name}`} title="Ganti nama"
                  onClick={() => setEditing(g.id)}
                  style={{ all: "unset", cursor: "pointer", color: "var(--text-subtle)", fontSize: 10 }}>✎</button>
                <button aria-label={`Hapus grup ${g.name}`}
                  title={only ? "Grup terakhir tak bisa dihapus" : "Hapus grup (sesi tetap hidup)"}
                  disabled={only} onClick={() => onRemove(g.id)}
                  style={{ all: "unset", cursor: only ? "not-allowed" : "pointer",
                    color: "var(--text-subtle)", opacity: only ? 0.35 : 1 }}>×</button>
              </>
            )}
          </span>
        );
      })}
      <button aria-label="Grup baru" title="Grup baru" onClick={onAdd}
        style={{ all: "unset", cursor: "pointer", padding: "3px 8px", color: "var(--text-subtle)", fontSize: 12 }}>+</button>
    </div>
  );
}

// Menutup kolom/baris TIDAK mematikan sesi — selnya lenyap, sesinya jatuh ke tray lewat
// placedIds. Karena itu tak ada konfirmasi, sama seperti "lepas".
function GutterX({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={disabled ? "Grid tak boleh menyusut ke nol" : label}
      disabled={disabled} onClick={onClick}
      style={{ all: "unset", display: "grid", placeItems: "center", fontSize: 11, lineHeight: 1,
        color: "var(--text-subtle)", opacity: disabled ? 0.3 : 1,
        cursor: disabled ? "not-allowed" : "pointer" }}>×</button>
  );
}

function RenameInput({ initial, onCommit, onCancel }: {
  initial: string; onCommit: (name: string) => void; onCancel: () => void;
}) {
  const [value, setValue] = React.useState(initial);
  return (
    <input autoFocus aria-label="Nama grup" value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(value);
        else if (e.key === "Escape") onCancel();
      }}
      style={{ width: 100, padding: "3px 6px", fontSize: 12, fontFamily: "var(--font-ui)",
        border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)",
        background: "var(--surface-card)", color: "var(--text-strong)" }} />
  );
}

// Fase yang DILAPORKAN agen, bukan yang disimpulkan server (SPEC-162). Agen yang lupa menulis
// berkas fasenya meninggalkan strip ini diam — terminalnya sendiri yang jadi kebenaran.
const PHASE_COLOR: Record<Phase["state"], string> = {
  done: "var(--brass)",
  active: "var(--text-strong)",
  skipped: "var(--text-subtle)",
  pending: "var(--text-subtle)",
};
export function PhaseStrip({ phases }: { phases: Phase[] | null }) {
  if (!phases?.length) return null;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, padding: "3px 8px", flex: "0 0 auto",
      borderBottom: "1px solid var(--border-hair)", fontSize: 10, fontFamily: "var(--font-mono)",
    }}>
      {phases.map((p) => (
        <span key={p.name} data-state={p.state} title={p.state}
          style={{
            color: PHASE_COLOR[p.state],
            fontWeight: p.state === "active" ? 600 : 400,
            textDecoration: p.state === "skipped" ? "line-through" : "none",
            opacity: p.state === "pending" ? 0.5 : 1,
          }}>
          {p.name}
        </span>
      ))}
    </div>
  );
}

function Cell({ session, nameOf, onClose, onDetach, onExit }: {
  session: TerminalSession; nameOf: (pid: string) => string;
  onClose: () => void; onDetach: () => void; onExit: (code: number) => void;
}) {
  const [phases, setPhases] = React.useState<Phase[] | null>(null);
  const label = session.specId ?? nameOf(session.projectId);
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
      <PhaseStrip phases={phases} />
      {/* key = identitas sesi: pindah antar sel memindah subtree, bukan me-remount WebSocket. */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <TerminalPane key={session.id} sessionId={session.id} onExit={onExit} onPhases={setPhases} />
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
            label: `${s.specId ?? nameOf(s.projectId)} · ${s.id.slice(0, 6)}`,
          })))} />
    </div>
  );
}
