/* ReconcileModal — SPEC-270 · ADR-0067. Daftar konflik sync dua-sisi; tiap kartu side-by-side
   (Lokal | Server), sisi updatedAt terbaru jadi default; user pilih "Pakai Lokal / Pakai Server". */
import React from "react";
import { Modal, Button } from "../ds";
import { api } from "../api/client";
import type { SyncConflictView } from "@hanoman/shared";

function newerSide(c: SyncConflictView): "local" | "server" {
  return new Date(c.localUpdatedAt) >= new Date(c.serverUpdatedAt) ? "local" : "server";
}
function fmt(v: unknown): string { try { return JSON.stringify(v, null, 2); } catch { return String(v); } }

export function ReconcileModal({ open, onClose, onResolved }:
  { open: boolean; onClose: () => void; onResolved: () => void }) {
  const [items, setItems] = React.useState<SyncConflictView[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const load = React.useCallback(async () => {
    try { setItems((await api.listConflicts()).conflicts); } catch { setItems([]); }
  }, []);
  React.useEffect(() => { if (open) void load(); }, [open, load]);

  async function resolve(c: SyncConflictView, choice: "local" | "server") {
    setBusy(`${c.entity}:${c.recordId}`);
    try { await api.resolveConflict(c.entity, c.recordId, choice); await load(); onResolved(); }
    finally { setBusy(null); }
  }

  return (
    <Modal open={open} title="Rekonsil konflik sync" eyebrow="SPEC-270" icon="git-merge" width={720} onClose={onClose}>
      {items.length === 0 && <div style={{ fontSize: 13.5, color: "var(--text-muted)" }}>Tak ada konflik. Semua sinkron.</div>}
      {items.map((c) => {
        const dflt = newerSide(c);
        const id = `${c.entity}:${c.recordId}`;
        return (
          <div key={id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
              {c.entity} · {c.recordId} · <span data-testid="default-side">default: {dflt === "local" ? "Lokal" : "Server"} (updatedAt terbaru)</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <SideView label="Lokal" data={c.localData} at={c.localUpdatedAt} ver={c.localVersion} active={dflt === "local"} />
              <SideView label="Server" data={c.serverData} at={c.serverUpdatedAt} ver={c.serverVersion} active={dflt === "server"} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
              <Button size="sm" variant={dflt === "local" ? "primary" : "secondary"} disabled={busy === id}
                onClick={() => resolve(c, "local")}>Pakai Lokal</Button>
              <Button size="sm" variant={dflt === "server" ? "primary" : "secondary"} disabled={busy === id}
                onClick={() => resolve(c, "server")}>Pakai Server</Button>
            </div>
          </div>
        );
      })}
    </Modal>
  );
}

function SideView({ label, data, at, ver, active }:
  { label: string; data: unknown; at: string; ver: number; active: boolean }) {
  return (
    <div style={{ border: active ? "1px solid var(--brass)" : "1px solid var(--line)", borderRadius: 6, padding: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600 }}>{label} · v{ver}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{new Date(at).toLocaleString()}</div>
      <pre style={{ fontSize: 11, whiteSpace: "pre-wrap", margin: 0, maxHeight: 200, overflow: "auto" }}>{fmt(data)}</pre>
    </div>
  );
}
