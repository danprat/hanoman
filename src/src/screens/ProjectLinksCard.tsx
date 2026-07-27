/* SPEC-337 · ADR-0074 · kartu "Integrasi antar project": deklarasikan relasi dependency, lalu
   buka sesi audit lintas dari sini. Relasi berarah (project ini bergantung pada X / X bergantung
   pada project ini); catatannya dibaca agen apa adanya saat sesi audit lahir. */
import React from "react";
import { Card, Badge, Button, Select, Input, Icon } from "../ds";
import { api } from "../api/client";
import type { LinkView } from "@hanoman/shared";
import type { ProjectVM } from "./types";

const KINDS = [
  { value: "api", label: "API" }, { value: "sdk", label: "SDK / paket" },
  { value: "data", label: "Data / DB" }, { value: "event", label: "Event / queue" },
  { value: "lainnya", label: "Lainnya" },
];

export function ProjectLinksCard({ p, others, onToast, onCrossAudit }:
  { p: ProjectVM; others: { id: string; name: string }[];
    onToast: (msg: string, kind?: string, icon?: string) => void;
    onCrossAudit?: () => void | Promise<void> }) {
  const [links, setLinks] = React.useState<LinkView[]>([]);
  const [to, setTo] = React.useState(others[0]?.id ?? "");
  const [kind, setKind] = React.useState("api");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try { setLinks((await api.listProjectLinks(p.id)).links); } catch { /* biarkan daftar apa adanya */ }
  }, [p.id]);
  React.useEffect(() => { void load(); }, [load]);

  async function add() {
    if (!to) return;
    setBusy(true);
    try {
      await api.createProjectLink(p.id, { to, kind, note: note.trim() || undefined });
      setNote("");
      await load();
      onToast("Relasi ditambahkan", "ok", "link");
    } catch { onToast("Gagal menambah relasi · mungkin sudah ada", "err", "x-circle"); }
    finally { setBusy(false); }
  }
  async function remove(l: LinkView) {
    if (!window.confirm(`Hapus relasi ${l.fromProjectId} → ${l.toProjectId}?`)) return;
    setBusy(true);
    try { await api.deleteProjectLink(p.id, l.id); await load(); onToast("Relasi dihapus", "ok", "link"); }
    catch { onToast("Gagal menghapus relasi", "err", "x-circle"); }
    finally { setBusy(false); }
  }

  return (
    <Card eyebrow="integrasi" title="Integrasi antar project"
      actions={
        <Button size="sm" leftIcon="radar" disabled={!links.length || busy}
          onClick={() => { if (links.length) void onCrossAudit?.(); }}>
          Audit lintas project
        </Button>
      }>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Daftarkan project yang saling berintegrasi. Sesi audit lintas melihat semua project di sini sekaligus —
        kode, docs, dan log error-nya dalam satu timeline.
      </div>

      {links.length === 0
        ? <div style={{ fontSize: 12.5, color: "var(--text-subtle)", marginBottom: 12 }}>
            Belum ada relasi. Tambahkan satu agar audit lintas project bisa dibuka.
          </div>
        : <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {links.map((l) => (
              <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <Icon name={l.direction === "keluar" ? "arrow-right" : "arrow-left"} size={14} color="var(--text-subtle)" />
                <span style={{ fontSize: 13, color: "var(--text-strong)", fontWeight: 500 }}>{l.other.name}</span>
                <Badge tone="neutral" size="sm">{l.kind}</Badge>
                <span style={{ fontSize: 12, color: "var(--text-subtle)" }}>
                  {l.direction === "keluar"
                    ? `${p.name} bergantung pada ${l.other.name}`
                    : `${l.other.name} bergantung pada ${p.name}`}
                </span>
                {l.note && <span style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>{l.note}</span>}
                <Button size="sm" variant="ghost" leftIcon="trash-2" disabled={busy} onClick={() => remove(l)}>Hapus</Button>
              </div>
            ))}
          </div>}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Select value={to} onChange={(e) => setTo(e.target.value)} style={{ minWidth: 160 }}
          options={others.map((o) => ({ value: o.id, label: o.name }))} />
        <Select value={kind} onChange={(e) => setKind(e.target.value)} style={{ minWidth: 140 }} options={KINDS} />
        <Input value={note} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNote(e.target.value)} style={{ flex: 1, minWidth: 220 }}
          placeholder="bentuk integrasinya — mis. web memanggil /api/orders, auth lewat cookie" />
        <Button size="sm" leftIcon="plus" disabled={!to || busy} onClick={add}>Tambah relasi</Button>
      </div>
    </Card>
  );
}
