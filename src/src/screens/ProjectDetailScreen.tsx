/* ProjectDetailScreen — satu project: identitas, edit, dan tiga pintu ke docs/runs/backlog.
   Tak ada fetch sendiri: ProjectVM dari daftar sudah memuat setiap field yang dirender
   (SPEC-146). GET /projects/:id ada, tapi memanggilnya hanya menambah state loading. */
import React from "react";
import { Card, Badge, StatusPill, ProgressBar, Button, Icon } from "../ds";
import { api } from "../api/client";
import type { ProjectVM } from "./types";
import { IntegrationGuideModal } from "./IntegrationGuideModal";
import { ProjectLinksCard } from "./ProjectLinksCard";

const COV_TONE = (s: string) => (s === "broken" ? "err" : s === "drift" ? "warn" : "ok");

// SPEC-249 · kartu DSN error monitoring: generate/rotate/revoke. Plaintext DSN URL hanya
// ditampilkan SEKALI (pola DeviceTokensPanel). Init dari VM, update lokal saat aksi.
function DsnCard({ p, onToast, onProjectChanged }:
  { p: ProjectVM; onToast: (msg: string, kind?: string, icon?: string) => void;
    onProjectChanged?: (id: string) => void | Promise<void> }) {
  const [enabled, setEnabled] = React.useState(p.monitoringEnabled);
  const [prefix, setPrefix] = React.useState<string | null>(p.ingestKeyPrefix);
  const [freshDsn, setFreshDsn] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [guideOpen, setGuideOpen] = React.useState(false);

  async function rotate() {
    setBusy(true);
    try {
      const r = await api.rotateIngestKey(p.id);
      setEnabled(true); setPrefix(r.prefix); setFreshDsn(r.dsnUrl ?? null);
      onToast(enabled ? "DSN dirotasi" : "DSN dibuat", "ok", "key-round");
      // SPEC-258 · rambatkan status yang di-persist ke state project App. Tanpa ini, state lokal
      // kartu ini hilang saat layar re-mount (refresh) → tampil "belum ada DSN" yang ambigu.
      await onProjectChanged?.(p.id);
    } catch { onToast("Gagal membuat DSN", "err", "x-circle"); }
    finally { setBusy(false); }
  }
  async function revoke() {
    if (!window.confirm(`Revoke DSN project "${p.name}"? Ingest yang memakai key lama akan ditolak.`)) return;
    setBusy(true);
    try {
      await api.revokeIngestKey(p.id); setEnabled(false); setPrefix(null); setFreshDsn(null);
      onToast("DSN dicabut", "ok", "key-round");
      await onProjectChanged?.(p.id); // SPEC-258 · status revoke ikut persist ke state App
    }
    catch { onToast("Gagal revoke DSN", "err", "x-circle"); }
    finally { setBusy(false); }
  }

  return (
    <Card eyebrow="error monitoring" title="DSN ingest"
      actions={enabled
        ? <div style={{ display: "flex", gap: 8 }}>
            <Button size="sm" variant="secondary" leftIcon="refresh-cw" onClick={rotate} disabled={busy}>Rotate</Button>
            <Button size="sm" variant="ghost" leftIcon="ban" onClick={revoke} disabled={busy}>Revoke</Button>
          </div>
        : <Button size="sm" leftIcon="key-round" onClick={rotate} disabled={busy}>Generate DSN</Button>}>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
        Pasang DSN di SDK/snippet project agar error terkirim ke hanoman. Plaintext hanya tampil sekali saat generate/rotate.{" "}
        <a onClick={() => setGuideOpen(true)}
          style={{ color: "var(--brass-700)", cursor: "pointer", fontWeight: 600, textDecoration: "underline" }}>
          Lihat panduan integrasi
        </a>
      </div>
      <IntegrationGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
      {freshDsn && (
        <div style={{ padding: 12, marginBottom: 12, border: "1px solid var(--brass-300)", borderRadius: "var(--radius-sm)", background: "var(--brass-100)" }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>DSN — salin sekarang, tak akan ditampilkan lagi:</div>
          <code style={{ display: "block", wordBreak: "break-all", fontSize: 12 }}>{freshDsn}</code>
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <Button size="sm" leftIcon="copy" onClick={() => { void navigator.clipboard?.writeText(freshDsn); onToast("Disalin", "ok", "copy"); }}>Salin</Button>
            <Button size="sm" variant="ghost" onClick={() => setFreshDsn(null)}>Tutup</Button>
          </div>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Badge tone={enabled ? "ok" : "neutral"} size="sm">{enabled ? "aktif" : "nonaktif"}</Badge>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-body)" }}>
          {enabled ? `${prefix ?? "hnm_ing_…"}…` : "belum ada DSN"}
        </span>
      </div>
    </Card>
  );
}

// SPEC-253 · kartu Help Center: toggle aktif + link publik yang bisa disalin & disebar. Link terikat
// Project.id (slug), stabil. Init dari VM, update lokal saat aksi.
function HelpCenterCard({ p, onToast, onProjectChanged }:
  { p: ProjectVM; onToast: (msg: string, kind?: string, icon?: string) => void;
    onProjectChanged?: (id: string) => void | Promise<void> }) {
  const [enabled, setEnabled] = React.useState(p.helpEnabled);
  const [busy, setBusy] = React.useState(false);
  // Link publik same-origin — dibangun di klien (setara publicUrl server), tanpa fetch saat mount.
  const publicUrl = `${window.location.origin}/help/${encodeURIComponent(p.id)}`;

  async function enable() {
    setBusy(true);
    try {
      await api.enableHelpCenter(p.id); setEnabled(true); onToast("Help Center aktif", "ok", "inbox");
      await onProjectChanged?.(p.id); // SPEC-258 · cacat kembar DsnCard: status persist ke state App
    }
    catch { onToast("Gagal mengaktifkan Help Center", "err", "x-circle"); }
    finally { setBusy(false); }
  }
  async function disable() {
    if (!window.confirm(`Nonaktifkan Help Center project "${p.name}"? Link publik berhenti menerima keluhan baru (tiket lama tetap ada).`)) return;
    setBusy(true);
    try {
      await api.disableHelpCenter(p.id); setEnabled(false); onToast("Help Center nonaktif", "ok", "inbox");
      await onProjectChanged?.(p.id); // SPEC-258 · status persist ke state App
    }
    catch { onToast("Gagal menonaktifkan Help Center", "err", "x-circle"); }
    finally { setBusy(false); }
  }

  return (
    <Card eyebrow="help center" title="Link publik keluhan"
      actions={enabled
        ? <Button size="sm" variant="ghost" leftIcon="ban" onClick={disable} disabled={busy}>Nonaktifkan</Button>
        : <Button size="sm" leftIcon="inbox" onClick={enable} disabled={busy}>Aktifkan</Button>}>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
        Saat aktif, sebar link ini agar pengguna project melapor keluhan tanpa login. Keluhan masuk ke antrean Triase.
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Badge tone={enabled ? "ok" : "neutral"} size="sm">{enabled ? "aktif" : "nonaktif"}</Badge>
        {enabled && publicUrl && (
          <>
            <code style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-body)", wordBreak: "break-all" }}>{publicUrl}</code>
            <Button size="sm" leftIcon="copy" onClick={() => { void navigator.clipboard?.writeText(publicUrl); onToast("Link disalin", "ok", "copy"); }}>Salin</Button>
          </>
        )}
      </div>
    </Card>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="hn-eyebrow">{label}</div>
      <div style={{ marginTop: 4, fontSize: 12.5, color: "var(--text-body)",
        fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}

function Door({ icon, title, hint, onClick }:
  { icon: string; title: string; hint: string; onClick: () => void }) {
  return (
    <Card padding={0}>
      <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 12,
        padding: "14px 16px", cursor: "pointer" }}>
        <Icon name={icon} size={16} color="var(--text-muted)" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-strong)" }}>{title}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-subtle)", marginTop: 2 }}>{hint}</div>
        </div>
        <Icon name="chevron-right" size={14} color="var(--text-subtle)" />
      </div>
    </Card>
  );
}

export function ProjectDetailScreen({ p, onEdit, onGotoDocs, onGotoTerminal, onGotoBacklog, onDelete, onReverse, onScaffold, onToast, onProjectChanged, others, onCrossAudit }:
  { p: ProjectVM; onEdit: () => void; onGotoDocs: () => void; onGotoTerminal: () => void;
    onGotoBacklog: () => void; onDelete: () => void; onReverse?: () => void; onScaffold?: () => void;
    onToast: (msg: string, kind?: string, icon?: string) => void;
    // SPEC-258 · dipanggil sesudah mutasi in-card (DSN/Help) agar App refetch VM & status persist.
    onProjectChanged?: (id: string) => void | Promise<void>;
    // SPEC-337 · project lain sebagai kandidat relasi + pembuka sesi audit lintas.
    others?: { id: string; name: string }[];
    onCrossAudit?: () => void | Promise<void> }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="box" size={15} color="var(--text-muted)" />
              <span style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600,
                color: "var(--text-strong)" }}>{p.name}</span>
              <Badge tone={p.kind === "from-scratch" ? "brass" : "neutral"} size="sm">{p.kind}</Badge>
              <StatusPill status={p.session.status} size="sm">{p.session.phase ?? undefined}</StatusPill>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-subtle)", marginTop: 6 }}>{p.desc}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
            <Button size="sm" variant="secondary" leftIcon="pencil" onClick={onEdit}>Edit project</Button>
            <Button size="sm" variant="ghost" leftIcon="trash-2" onClick={onDelete}>Hapus project</Button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginTop: 20 }}>
          <Meta label="ID" value={p.id} mono />
          {/* SPEC-217 · path EFEKTIF (binding per-mesin ?? default project). Label menandai override. */}
          <Meta label={p.binding ? "Repo · mesin ini" : "Repo"} value={(p.binding ?? p.repoDir) || "—"} mono />
          {/* SPEC-218 · remote resmi untuk clone di device lain (— bila belum diset). */}
          <Meta label="Git remote" value={p.gitRemote || "—"} mono />
          <Meta label="Stack" value={p.stack || "—"} />
          <Meta label="Backlog terbuka" value={`${p.backlog} · ${p.topStage}`} />
        </div>

        <div style={{ marginTop: 18 }}>
          <div className="hn-eyebrow" style={{ marginBottom: 6 }}>Docs · SoT</div>
          <ProgressBar value={p.coverage} showLabel tone={COV_TONE(p.docStatus)} size="sm" />
        </div>
      </Card>

      <DsnCard p={p} onToast={onToast} onProjectChanged={onProjectChanged} />
      <HelpCenterCard p={p} onToast={onToast} onProjectChanged={onProjectChanged} />
      <ProjectLinksCard p={p} others={others ?? []} onToast={onToast} onCrossAudit={onCrossAudit} />

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${onReverse || onScaffold ? 4 : 3}, 1fr)`, gap: 12 }}>
        <Door icon="book-open" title="Source of Truth" hint="baca & sunting docs" onClick={onGotoDocs} />
        <Door icon="terminal" title="Buka terminal" hint="sesi claude project ini" onClick={onGotoTerminal} />
        <Door icon="list-checks" title="Lihat backlog" hint={`${p.backlog} spec terbuka`} onClick={onGotoBacklog} />
        {onReverse && <Door icon="radar" title="Reverse docs" hint="susun Source of Truth dari kode" onClick={onReverse} />}
        {onScaffold && <Door icon="sparkles" title="Scaffold docs" hint="susun Source of Truth dari ide" onClick={onScaffold} />}
      </div>
    </div>
  );
}
