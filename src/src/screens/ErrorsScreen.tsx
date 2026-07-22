/* ErrorsScreen — area Error (Sentry ringan, SPEC-249). Screen mandiri (pola VpsScreen):
   memuat datanya sendiri + silent poll (pola GitGraph). Master (daftar grup) → detail grup
   dengan tombol "Eskalasi ke backlog". Realtime via HTTP polling (ADR-0060), bukan WS. */
import React from "react";
import { Button, Badge, Select, StateBlock, Icon, ConfirmDialog } from "../ds";
import { api } from "../api/client";
import type { ErrorGroupView, ErrorGroupDetail, Spec, SymbolicatedFrame } from "@hanoman/shared";
import type { ProjectVM } from "./types";
import { IntegrationGuideModal } from "./IntegrationGuideModal";
import { specDeepLink } from "./deeplink";
import { SyncButton } from "./SyncButton";

const POLL_MS = 5000;

// Waktu relatif ringkas (tanpa dependensi): "baru saja" · "5m" · "3j" · "2h".
function ago(iso: string, now = Date.now()): string {
  const d = Math.max(0, now - new Date(iso).getTime());
  const m = Math.floor(d / 60_000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}j`;
  return `${Math.floor(h / 24)}h`;
}

const STATUS_TONE = { new: "err", escalated: "warn", resolved: "ok" } as const;

function GroupRow({ g, onOpen }: { g: ErrorGroupView; onOpen: (id: string) => void }) {
  return (
    <button
      onClick={() => onOpen(g.id)}
      style={{
        display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
        padding: "12px 14px", border: "1px solid var(--border-hair)", borderRadius: "var(--radius-md)",
        background: "var(--surface-card)", cursor: "pointer", marginBottom: 8,
      }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text-strong)" }}>{g.type}</span>
          <Badge tone={STATUS_TONE[g.status]} size="sm">{g.status}</Badge>
        </span>
        <span style={{
          display: "block", color: "var(--text-body)", fontSize: "var(--text-sm)", marginTop: 2,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{g.message}</span>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)", marginTop: 2, display: "block" }}>
          {g.projectId} · {g.environment}{g.release ? ` · ${g.release}` : ""} · {ago(g.lastSeenAt)} lalu
        </span>
      </span>
      <Badge tone="neutral">{g.count}×</Badge>
      <Icon name="chevron-right" size={16} color="var(--text-subtle)" />
    </button>
  );
}

// SPEC-276 · frame tersimbolikasi: fungsi + posisi sumber (.tsx) + context line. Frame in_app
// ditonjolkan (bone paper); frame vendor/raw diredupkan.
function FrameList({ frames }: { frames: SymbolicatedFrame[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {frames.map((f, i) => {
        const loc = f.symbolicated
          ? `${f.source}:${f.sourceLine ?? "?"}${f.sourceColumn != null ? ":" + f.sourceColumn : ""}`
          : `${f.filename ?? "?"}${f.lineno != null ? ":" + f.lineno : ""}`;
        return (
          <div key={i} style={{
            padding: "6px 10px", borderRadius: "var(--radius-sm)",
            background: f.in_app ? "var(--bone-100)" : "transparent",
            border: "1px solid var(--border-hair)", opacity: f.in_app ? 1 : 0.65,
            fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
          }}>
            <div style={{ color: "var(--text-strong)" }}>
              {f.function ?? "<anonymous>"}{f.symbolicated ? "" : " · raw"}
            </div>
            <div style={{ color: "var(--text-subtle)" }}>{loc}</div>
            {f.contextLine != null && f.contextLine.trim() !== "" && (
              <pre style={{ margin: "4px 0 0", whiteSpace: "pre-wrap", color: "var(--text-body)" }}>{f.contextLine.trim()}</pre>
            )}
          </div>
        );
      })}
    </div>
  );
}

function GroupDetail({ id, onBack, onEscalated, onDeleted, onToast }:
  { id: string; onBack: () => void; onEscalated: (spec: Spec, already: boolean) => void;
    onDeleted: () => void;
    onToast: (msg: string, kind?: string, icon?: string) => void }) {
  const [g, setG] = React.useState<ErrorGroupDetail | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);

  const load = React.useCallback(() => {
    api.getError(id).then((d) => { setG(d); setState("ready"); }).catch(() => setState("error"));
  }, [id]);
  React.useEffect(() => { load(); }, [load]);

  if (state === "loading") return <StateBlock kind="loading" />;
  if (state === "error" || !g) return <StateBlock kind="error" hint="Gagal memuat grup." action={load} actionLabel="Coba lagi" />;

  async function escalate() {
    setBusy(true);
    try {
      const r = await api.escalateError(id);
      onEscalated(r.spec, !!r.alreadyEscalated);
    } catch { onToast("Gagal eskalasi", "err", "x-circle"); }
    finally { setBusy(false); }
  }
  async function unlink() {
    setBusy(true);
    try {
      const r = await api.unlinkError(id);
      setG({ ...g!, specId: r.specId, status: r.status as ErrorGroupDetail["status"] });
      onToast("Tautan backlog dilepas", "ok", "unlink");
    } catch { onToast("Gagal melepas tautan", "err", "x-circle"); }
    finally { setBusy(false); }
  }
  async function changeStatus(status: string) {
    setBusy(true);
    try { await api.patchError(id, status); setG({ ...g!, status: status as ErrorGroupDetail["status"] }); onToast("Status diperbarui", "ok"); }
    catch { onToast("Gagal update status", "err", "x-circle"); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try { await api.deleteError(id); onToast("Grup error dihapus", "ok", "trash-2"); onDeleted(); }
    catch { onToast("Gagal menghapus", "err", "x-circle"); setBusy(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Button size="sm" variant="ghost" leftIcon="arrow-left" onClick={onBack}>Kembali</Button>
        <Badge tone={STATUS_TONE[g.status]}>{g.status}</Badge>
        <span style={{ flex: 1 }} />
        {g.specId
          ? <>
              <Badge tone="warn" icon="link">→ {g.specId}</Badge>
              {/* SPEC-293 · paritas triase: buka/salin link backlog tertaut (deep-link #spec=). */}
              <Button size="sm" variant="ghost" leftIcon="external-link" onClick={() => window.open(specDeepLink(g.specId!), "_blank", "noreferrer")}>Buka backlog</Button>
              <Button size="sm" variant="ghost" leftIcon="copy" onClick={() => { void navigator.clipboard?.writeText(specDeepLink(g.specId!)); onToast("Link backlog disalin", "ok", "copy"); }}>Salin link</Button>
              <Button size="sm" variant="ghost" leftIcon="unlink" onClick={unlink} disabled={busy}>Lepas tautan</Button>
            </>
          : <Button size="sm" leftIcon="arrow-up-right" onClick={escalate} disabled={busy}>Eskalasi ke backlog</Button>}
        <Select size="sm" value={g.status} disabled={busy}
          onChange={(e) => changeStatus(e.target.value)}
          options={[{ value: "new", label: "new" }, { value: "escalated", label: "escalated" }, { value: "resolved", label: "resolved" }]} />
        <Button size="sm" variant="ghost" leftIcon="trash-2" onClick={() => setConfirm(true)} disabled={busy}>Hapus</Button>
      </div>
      <div>
        <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: "var(--text-lg)", color: "var(--text-strong)" }}>{g.type}</div>
        <div style={{ color: "var(--text-body)", marginTop: 4 }}>{g.message}</div>
      </div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
        <span><b style={{ color: "var(--text-body)" }}>{g.count}</b> kejadian</span>
        <span>env: <b style={{ color: "var(--text-body)" }}>{g.environment}</b></span>
        <span>project: <b style={{ color: "var(--text-body)" }}>{g.projectId}</b></span>
        {g.release && <span>release: <b style={{ color: "var(--text-body)" }}>{g.release}</b></span>}
        <span>first: {ago(g.firstSeenAt)} lalu</span>
        <span>last: {ago(g.lastSeenAt)} lalu</span>
      </div>
      {/* SPEC-276 · frame tersimbolikasi bila ada; fallback ke stack mentah lama. */}
      {g.sampleFrames && g.sampleFrames.length > 0 ? (
        <div>
          <div className="hn-eyebrow" style={{ marginBottom: 6 }}>Stack (symbolicated)</div>
          <FrameList frames={g.sampleFrames} />
        </div>
      ) : g.sampleStack ? (
        <div>
          <div className="hn-eyebrow" style={{ marginBottom: 6 }}>Stack sampel</div>
          <pre style={{
            margin: 0, padding: 12, borderRadius: "var(--radius-md)", background: "var(--bone-100)",
            border: "1px solid var(--border-hair)", overflowX: "auto", fontFamily: "var(--font-mono)",
            fontSize: "var(--text-xs)", color: "var(--text-body)", maxHeight: 320,
          }}>{g.sampleStack}</pre>
        </div>
      ) : null}
      <ConfirmDialog open={confirm} title="Hapus grup error?" eyebrow={g.type}
        message={`Grup "${g.message}" beserta ${g.count} kejadiannya akan dihapus permanen. Tindakan ini tak bisa dibatalkan.`}
        busy={busy} onCancel={() => setConfirm(false)} onConfirm={remove} />
    </div>
  );
}

export function ErrorsScreen({ projects, onEscalated, onToast }:
  { projects: ProjectVM[]; onEscalated: (spec: Spec, already: boolean) => void;
    onToast: (msg: string, kind?: string, icon?: string) => void }) {
  const [list, setList] = React.useState<ErrorGroupView[]>([]);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [project, setProject] = React.useState("");
  const [environment, setEnvironment] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [guideOpen, setGuideOpen] = React.useState(false);

  const load = React.useCallback((silent = false) => {
    if (!silent) setState("loading");
    api.listErrors({ project: project || undefined, environment: environment || undefined, status: status || undefined })
      .then((r) => { setList(r.items); setState("ready"); })
      .catch(() => { if (!silent) setState("error"); });   // silent poll never blanks data
  }, [project, environment, status]);

  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(true); }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  if (openId) return <GroupDetail id={openId} onBack={() => { setOpenId(null); load(true); }} onEscalated={onEscalated} onDeleted={() => { setOpenId(null); load(true); }} onToast={onToast} />;

  // environment options: production selalu + apa pun yang muncul di daftar.
  const envs = Array.from(new Set(["production", ...list.map((g) => g.environment)]));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0, flex: 1 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <Select size="sm" value={project} onChange={(e) => setProject(e.target.value)}
          options={[{ value: "", label: "Semua project" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
        <Select size="sm" value={environment} onChange={(e) => setEnvironment(e.target.value)}
          options={[{ value: "", label: "Semua environment" }, ...envs.map((e) => ({ value: e, label: e }))]} />
        <Select size="sm" value={status} onChange={(e) => setStatus(e.target.value)}
          options={[{ value: "", label: "Semua status" }, { value: "new", label: "new" }, { value: "escalated", label: "escalated" }, { value: "resolved", label: "resolved" }]} />
        <span style={{ flex: 1 }} />
        <SyncButton onDone={() => load(true)} onToast={onToast} />
        <Button size="sm" variant="secondary" leftIcon="book-open" onClick={() => setGuideOpen(true)}>Panduan integrasi</Button>
      </div>
      <IntegrationGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
      {state === "loading" ? <StateBlock kind="loading" />
        : state === "error" ? <StateBlock kind="error" hint="Gagal memuat error." action={() => load()} actionLabel="Coba lagi" />
        : list.length === 0 ? <StateBlock kind="empty" icon="triangle-alert" title="Belum ada error"
            hint="Pasang SDK/snippet di project (DSN dari detail project) agar error mulai terkirim."
            action={() => setGuideOpen(true)} actionLabel="Panduan integrasi" />
        : <div style={{ overflowY: "auto", minHeight: 0 }}>
            {list.map((g) => <GroupRow key={g.id} g={g} onOpen={setOpenId} />)}
          </div>}
    </div>
  );
}
