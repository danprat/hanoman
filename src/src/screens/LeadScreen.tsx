/* LeadScreen — panel hanoman-lead (SPEC-409, ADR-0091). Screen mandiri (pola SchedulerScreen /
   VpsScreen): memuat statusnya sendiri + silent poll HTTP; TIDAK menambah kanal WebSocket (AC-26).

   Isinya empat: rem darurat + setelan (ControlBar), status per project + opt-in, sesi yang sedang
   dilayani (menunggu / sedang diputuskan), dan jejak keputusan — pertanyaan → jawaban → alasan →
   rujukan — dengan tombol Timpa & Batalkan per baris (AC-27/28, US-2/3/4). */
import React from "react";
import { Card, Button, Badge, Input, Select, StateBlock, Icon } from "../ds";
import { api } from "../api/client";
import type { Lead, LeadStatusView, LeadDecisionView } from "@hanoman/shared";
import type { ProjectVM } from "./types";

const POLL_MS = 5000;

function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const d = Math.max(0, now - new Date(iso).getTime());
  const m = Math.floor(d / 60_000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}j` : `${Math.floor(h / 24)}h`;
}

// Tone DS (feedback.tsx) — disempitkan supaya salah tulis nada tertangkap tsc, bukan tampil pucat.
type Tone = "neutral" | "brass" | "info" | "ok" | "warn" | "err";
const CONF_TONE: Record<string, Tone> = { tinggi: "ok", sedang: "neutral", ragu: "warn" };
const STATUS_TONE: Record<string, Tone> = { berlaku: "ok", ditimpa: "warn", dibatalkan: "neutral", gagal: "err" };
const KIND_LABEL: Record<string, string> = {
  answer: "jawaban", order: "urutan kerja", collision: "tabrakan area",
  quality: "mutu hasil", refusal: "tindakan ditolak",
};
const GATE_LABEL: Record<string, string> = {
  contract: "kontrak", detected: "deteksi otomatis", pulse: "denyut",
};

function RowShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
      border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)",
      background: "var(--surface-card)", marginBottom: 6 }}>
      {children}
    </div>
  );
}

function Section({ title, count, empty, children }:
  { title: string; count: number; empty: string; children?: React.ReactNode }) {
  return (
    <Card eyebrow={`lead · ${title.toLowerCase()}`} title={`${title} (${count})`}>
      {count === 0
        ? <div style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>{empty}</div>
        : children}
    </Card>
  );
}

/** Rem darurat + knob. Pause menghentikan keputusan BARU; sesi yang berjalan tak disentuh (AC-27). */
function ControlBar({ cfg, onWrite, busy }: { cfg: Lead; onWrite: (n: Lead) => void; busy: boolean }) {
  const num = (v: string, min: number) => Math.max(min, Number(v) || min);
  return (
    <Card eyebrow="lead · kendali" title="hanoman-lead">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <Badge tone={cfg.enabled ? (cfg.paused ? "warn" : "ok") : "neutral"}>
          {cfg.enabled ? (cfg.paused ? "dijeda" : "aktif") : "mati"}
        </Badge>
        {cfg.enabled
          ? <Button size="sm" variant="ghost" leftIcon="ban" disabled={busy}
              onClick={() => onWrite({ ...cfg, enabled: false, paused: false })}>Matikan</Button>
          : <Button size="sm" leftIcon="play" disabled={busy}
              onClick={() => onWrite({ ...cfg, enabled: true })}>Nyalakan</Button>}
        {cfg.enabled && (cfg.paused
          ? <Button size="sm" leftIcon="play" disabled={busy} onClick={() => onWrite({ ...cfg, paused: false })}>Lanjutkan</Button>
          : <Button size="sm" variant="ghost" leftIcon="pause" disabled={busy} onClick={() => onWrite({ ...cfg, paused: true })}>Pause</Button>)}
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-xs)" }}>
          denyut tiap
          <Input type="number" min={1} style={{ width: 76 }} aria-label="denyut lead (menit)"
            value={String(cfg.everyMin)} disabled={busy}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onWrite({ ...cfg, everyMin: num(e.target.value, 1) })} />
          menit
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-xs)" }}>
          batas waktu putusan
          <Input type="number" min={10} style={{ width: 84 }} aria-label="batas waktu putusan (detik)"
            value={String(cfg.timeoutSec)} disabled={busy}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onWrite({ ...cfg, timeoutSec: num(e.target.value, 10) })} />
          detik
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-xs)" }}>
          maks jawaban otomatis/sesi
          <Input type="number" min={1} style={{ width: 76 }} aria-label="maksimum jawaban otomatis per sesi"
            value={String(cfg.maxAutoAnswers)} disabled={busy}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onWrite({ ...cfg, maxAutoAnswers: num(e.target.value, 1) })} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-xs)" }}>
          syarat sebelum integrasi ke main
          <Select size="sm" aria-label="syarat sebelum integrasi ke main"
            value={cfg.requireGreenBeforeIntegrate ? "wajib" : "bebas"} disabled={busy}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              onWrite({ ...cfg, requireGreenBeforeIntegrate: e.target.value === "wajib" })}
            options={[{ value: "wajib", label: "plan tuntas" }, { value: "bebas", label: "tanpa syarat" }]} />
        </label>
      </div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)", marginTop: 10 }}>
        Lead memutuskan lalu melapor. Produksi/VPS dan penghapusan data terkunci secara teknis — apa pun setelannya.
      </div>
    </Card>
  );
}

function DecisionRow({ d, onOverride, onCancel, busyId }: {
  d: LeadDecisionView;
  onOverride: (id: string, answer: string) => void;
  onCancel: (id: string) => void;
  busyId: string | null;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  return (
    <div style={{ padding: "10px 12px", border: "1px solid var(--border-hair)",
      borderRadius: "var(--radius-sm)", background: "var(--surface-card)", marginBottom: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Badge tone={STATUS_TONE[d.status] ?? "neutral"} size="sm">{d.status}</Badge>
        <Badge tone={CONF_TONE[d.confidence] ?? "neutral"} size="sm">{d.confidence}</Badge>
        <Badge tone="neutral" size="sm">{KIND_LABEL[d.kind] ?? d.kind}</Badge>
        <Badge tone="neutral" size="sm">{GATE_LABEL[d.gate] ?? d.gate}</Badge>
        {d.weighty && <Badge tone="warn" size="sm">berbobot</Badge>}
        {/* SPEC-480 · pilihan sebagai data: operator membacanya sekilas, bukan dari prosanya.
            `?? []` bukan kehati-hatian berlebih — dashboard bisa lebih baru daripada server yang
            dilayaninya (paket npm global, ADR-0087), dan baris tanpa field ini akan meruntuhkan
            SELURUH panel, bukan cuma badge-nya. */}
        {d.choiceIndex != null && (d.options ?? []).length > 0 &&
          <Badge tone="brass" size="sm">{`opsi ${d.choiceIndex}/${d.options.length}`}</Badge>}
        {(d.missing ?? []).length > 0 && <Badge tone="warn" size="sm">kurang konteks</Badge>}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{ago(d.createdAt)}</span>
      </div>
      <div style={{ marginTop: 6, fontSize: "var(--text-sm)", color: "var(--text-subtle)", whiteSpace: "pre-wrap" }}>
        {d.question.slice(0, 400)}
      </div>
      <div style={{ marginTop: 4, color: "var(--text-strong)", fontWeight: 500, whiteSpace: "pre-wrap" }}>
        {/* Label opsi terpilih menang atas prosa: itulah yang benar-benar dikirim ke peminta. */}
        {d.choice ?? (d.answer || <em style={{ fontWeight: 400, color: "var(--text-muted)" }}>tak ada jawaban</em>)}
      </div>
      <div style={{ marginTop: 4, fontSize: "var(--text-xs)", color: "var(--text-subtle)", whiteSpace: "pre-wrap" }}>
        {d.reason}
      </div>
      {d.refs.length > 0 && (
        <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {d.refs.map((r) => (
            <span key={r} style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
              color: "var(--text-muted)", border: "1px solid var(--border-hair)",
              borderRadius: "var(--radius-sm)", padding: "1px 6px" }}>{r}</span>
          ))}
        </div>
      )}
      {(d.missing ?? []).length > 0 && (
        <div style={{ marginTop: 6, fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
          Yang kurang: {d.missing.join(" · ")}
        </div>
      )}
      <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {d.projectId}{d.specId ? ` · ${d.specId}` : ""}{d.sessionId ? ` · ${d.sessionId}` : ""}
          {d.action !== "none" ? ` · ${d.action}` : ""}
        </span>
        <span style={{ flex: 1 }} />
        {d.status === "berlaku" && !open &&
          <Button size="sm" variant="ghost" leftIcon="edit-3" onClick={() => setOpen(true)}>Timpa</Button>}
        {d.status === "berlaku" &&
          <Button size="sm" variant="ghost" leftIcon="x-circle" disabled={busyId === d.id}
            onClick={() => onCancel(d.id)}>Batalkan</Button>}
      </div>
      {open && (
        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          <Input style={{ flex: 1 }} aria-label={`jawaban operator untuk ${d.id}`}
            placeholder="Jawaban kamu — dikirim ke sesi bila panenya masih hidup"
            value={draft} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)} />
          <Button size="sm" leftIcon="check" disabled={!draft.trim() || busyId === d.id}
            onClick={() => { onOverride(d.id, draft.trim()); setOpen(false); setDraft(""); }}>Simpan</Button>
        </div>
      )}
    </div>
  );
}

export type LeadScreenProps = {
  projects: ProjectVM[];
  onProjectChanged: (id: string) => void | Promise<void>;
  onToast: (msg: string, kind?: string, icon?: string) => void;
  onGotoTerminal: (sessionId?: string) => void;
};

export function LeadScreen({ projects, onProjectChanged, onToast, onGotoTerminal }: LeadScreenProps) {
  const [state, setState] = React.useState<LeadStatusView | null>(null);
  const [decisions, setDecisions] = React.useState<LeadDecisionView[]>([]);
  const [phase, setPhase] = React.useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState("all");

  const load = React.useCallback((silent = false) => {
    if (!silent) setPhase("loading");
    Promise.all([
      api.getLeadStatus(),
      api.getLeadDecisions({ projectId: filter === "all" ? undefined : filter, take: 50 }),
    ])
      .then(([s, d]) => { setState(s); setDecisions(d.items); setPhase("ready"); })
      .catch(() => { if (!silent) setPhase("error"); });   // silent poll tak pernah mem-blank layar
  }, [filter]);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(true); }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const writeConfig = React.useCallback(async (next: Lead) => {
    setBusy(true);
    try { await api.putLeadConfig(next); onToast("Setelan lead tersimpan", "ok", "save"); load(true); }
    catch { onToast("Gagal menyimpan setelan lead", "err", "x-circle"); }
    finally { setBusy(false); }
  }, [load, onToast]);

  const toggleOptIn = React.useCallback(async (id: string, next: boolean) => {
    setBusyId(id);
    try { await api.updateProject(id, { leadOptIn: next }); await onProjectChanged(id); load(true); onToast(next ? "Project dipimpin lead" : "Project dilepas dari lead", "ok"); }
    catch { onToast("Gagal mengubah opt-in", "err", "x-circle"); }
    finally { setBusyId(null); }
  }, [load, onProjectChanged, onToast]);

  const togglePause = React.useCallback(async (id: string, paused: boolean) => {
    if (!state) return;
    const set = new Set(state.config.pausedProjects);
    if (paused) set.add(id); else set.delete(id);
    await writeConfig({ ...state.config, pausedProjects: [...set] });
  }, [state, writeConfig]);

  const override = React.useCallback(async (id: string, answer: string) => {
    setBusyId(id);
    try {
      const r = await api.overrideLeadDecision(id, answer);
      onToast(r.delivered ? "Jawaban kamu dikirim ke sesi" : "Keputusan ditimpa", "ok", "check");
      load(true);
    } catch { onToast("Gagal menimpa keputusan", "err", "x-circle"); }
    finally { setBusyId(null); }
  }, [load, onToast]);

  const cancel = React.useCallback(async (id: string) => {
    setBusyId(id);
    try { await api.cancelLeadDecision(id); onToast("Keputusan dibatalkan", "ok"); load(true); }
    catch { onToast("Gagal membatalkan keputusan", "err", "x-circle"); }
    finally { setBusyId(null); }
  }, [load, onToast]);

  if (phase === "loading") return <StateBlock kind="loading" />;
  if (phase === "error" || !state) {
    return <StateBlock kind="error" hint="Gagal memuat status lead." action={() => load()} actionLabel="Coba lagi" />;
  }

  const optIn = new Set(state.projects.map((p) => p.projectId));
  const waiting = state.waiting;
  const deciding = new Set(state.deciding);
  // SPEC-479 · `queued`/`gate` punya default di `zLeadStatusView`, tapi respons instance lama
  // (atau hub yang belum di-update) tetap bisa datang tanpa keduanya — jangan andalkan zod di sini.
  const queued = new Set(state.queued ?? []);
  const gate = state.gate ?? { inFlight: 0, queued: 0, capacity: 1 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
      <ControlBar cfg={state.config} onWrite={writeConfig} busy={busy} />

      <Card eyebrow="lead · project" title="Project yang dipimpin">
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)", marginBottom: 10 }}>
          Lead hanya menyentuh project yang di-opt-in. Default mati.
        </div>
        {projects.length === 0
          ? <div style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>Belum ada project.</div>
          : projects.map((p) => {
            const row = state.projects.find((x) => x.projectId === p.id);
            return (
              <RowShell key={p.id}>
                <span style={{ flex: 1, minWidth: 0, color: "var(--text-strong)", fontWeight: 500 }}>{p.name}</span>
                {row && <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                  {row.decisions24h} keputusan/24j · {row.openSessions} sesi
                </span>}
                <Badge tone={optIn.has(p.id) ? (row?.paused ? "warn" : "ok") : "neutral"} size="sm">
                  {optIn.has(p.id) ? (row?.paused ? "dijeda" : "dipimpin") : "mati"}
                </Badge>
                {optIn.has(p.id) && (row?.paused
                  ? <Button size="sm" variant="ghost" leftIcon="play" disabled={busy} onClick={() => togglePause(p.id, false)}>Lanjutkan</Button>
                  : <Button size="sm" variant="ghost" leftIcon="pause" disabled={busy} onClick={() => togglePause(p.id, true)}>Pause</Button>)}
                {optIn.has(p.id)
                  ? <Button size="sm" variant="ghost" leftIcon="ban" disabled={busyId === p.id} onClick={() => toggleOptIn(p.id, false)}>Lepas</Button>
                  : <Button size="sm" leftIcon="check" disabled={busyId === p.id} onClick={() => toggleOptIn(p.id, true)}>Pimpin</Button>}
              </RowShell>
            );
          })}
      </Card>

      <Section title="Sesi menunggu keputusan" count={waiting.length}
        empty="Tak ada sesi yang menunggu keputusan.">
        {/* SPEC-479 · gerbang konkurensi. Ditampilkan hanya saat ia benar-benar mengikat: batas
            yang diam tak perlu diumumkan, batas yang menahan antrean wajib. Tanpa baris ini
            "lead sedang penuh" tak terbedakan dari "lead diam" — salah baca yang melahirkan
            tiket SPEC-479. */}
        {gate.queued > 0 && (
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginBottom: 8 }}>
            Gerbang lead: {gate.inFlight}/{gate.capacity} diputuskan · {gate.queued} antre menunggu slot.
          </div>
        )}
        {waiting.map((id) => {
          // TIGA keadaan, bukan dua. Di pane ketiganya terlihat sama — marker terisi, agen diam —
          // tapi hanya "menunggu" yang benar-benar butuh manusia.
          const state = deciding.has(id) ? "sedang diputuskan"
            : queued.has(id) ? "antre"
            : "menunggu";
          return (
            <RowShell key={id}>
              <Icon name={state === "sedang diputuskan" ? "loader" : state === "antre" ? "clock" : "help-circle"} />
              <span style={{ flex: 1, fontFamily: "var(--font-mono)", color: "var(--text-strong)" }}>{id}</span>
              <Badge tone={state === "menunggu" ? "warn" : "ok"} size="sm">{state}</Badge>
              <Button size="sm" variant="ghost" leftIcon="terminal" onClick={() => onGotoTerminal(id)}>Ambil alih</Button>
            </RowShell>
          );
        })}
      </Section>

      <Card eyebrow="lead · jejak keputusan" title={`Keputusan (${decisions.length})`}
        actions={
          <Select size="sm" value={filter} aria-label="saring project"
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilter(e.target.value)}
            options={[{ value: "all", label: "semua project" },
              ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
        }>
        {decisions.length === 0
          ? <div style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>
              Belum ada keputusan. Lead menulis satu baris di sini setiap kali ia memutuskan.
            </div>
          : decisions.map((d) => (
            <DecisionRow key={d.id} d={d} onOverride={override} onCancel={cancel} busyId={busyId} />
          ))}
      </Card>
    </div>
  );
}
