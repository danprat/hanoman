import React from "react";
import { Button, Select, StateBlock } from "../ds";
import { api, type TerminalSession } from "../api/client";
import { TerminalPane } from "./TerminalPane";

export function TerminalScreen({ projects }: { projects: { id: string; name: string }[] }) {
  const [sessions, setSessions] = React.useState<TerminalSession[]>([]);
  const [active, setActive] = React.useState<string | null>(null);
  const [project, setProject] = React.useState(projects[0]?.id ?? "");

  React.useEffect(() => {
    api.listTerminals().then((list) => {
      setSessions(list);
      setActive((cur) => cur ?? list[0]?.id ?? null);
    }).catch(() => setSessions([]));
  }, []);

  async function open() {
    if (!project) return;
    const { id } = await api.createTerminal(project);
    setSessions((s) => [...s, { id, projectId: project, cwd: "", exited: false }]);
    setActive(id);
  }

  async function close(id: string) {
    await api.deleteTerminal(id).catch(() => {});
    setSessions((s) => {
      const next = s.filter((x) => x.id !== id);
      setActive((cur) => (cur === id ? next[0]?.id ?? null : cur));
      return next;
    });
  }

  const markExited = React.useCallback((id: string) => {
    setSessions((s) => s.map((x) => (x.id === id ? { ...x, exited: true } : x)));
  }, []);

  const current = sessions.find((s) => s.id === active) ?? null;
  const nameOf = (pid: string) => projects.find((p) => p.id === pid)?.name ?? pid;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "calc(100vh - 180px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div role="tablist" style={{ display: "flex", gap: 6, flex: 1, minWidth: 0, overflowX: "auto" }}>
          {sessions.map((s) => (
            <div key={s.id} role="tab" aria-selected={s.id === active} onClick={() => setActive(s.id)}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", cursor: "pointer",
                borderRadius: "var(--radius-sm)", fontFamily: "var(--font-mono)", fontSize: 12,
                background: s.id === active ? "var(--brass-100)" : "var(--bone-200)",
                color: s.exited ? "var(--text-muted)" : "var(--text-body)",
                border: "1px solid var(--border-hair)",
              }}>
              <span>{nameOf(s.projectId)} · {s.id.slice(0, 6)}</span>
              {s.exited && <span style={{ color: "var(--status-warn)" }}>berakhir</span>}
              <span aria-label={`Tutup sesi ${s.id}`} onClick={(e) => { e.stopPropagation(); void close(s.id); }}
                style={{ color: "var(--text-subtle)" }}>×</span>
            </div>
          ))}
        </div>
        <Select size="sm" value={project} onChange={(e) => setProject(e.target.value)}
          options={projects.map((p) => ({ value: p.id, label: p.name }))} />
        <Button size="sm" leftIcon="plus" onClick={() => void open()}>Sesi baru</Button>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        {current
          // key: pindah tab harus me-remount pane, bukan mendaur-ulang WebSocket lama.
          ? <TerminalPane key={current.id} sessionId={current.id} onExit={() => markExited(current.id)} />
          : <StateBlock kind="empty" icon="terminal" title="Belum ada sesi terminal"
              hint="Pilih project lalu buka sesi — hanoman menjalankan claude --dangerously-skip-permissions di direktori project itu."
              action={() => void open()} actionLabel="Sesi baru" />}
      </div>
    </div>
  );
}
