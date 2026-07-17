/* VpsChecklist — checklist kepatuhan per-seksi untuk satu VPS (SPEC-220 AC-9/10/11/12).
   Skor total + per-seksi, filter (seksi/mode/status/severity), aksi N/A (semua item) dan
   Attest (item INFO). Remediasi selektif AUTO ditambahkan terpisah (Task 11). */
import React from "react";
import { Button, StateBlock, Icon } from "../ds";
import { api } from "../api/client";
import type { ChecklistView, ChecklistItem, VpsItemStatus, VpsMode, VpsSeverity, RemediateStep } from "@hanoman/shared";

const STATUS_ICON: Record<VpsItemStatus, string> = {
  pass: "check", fail: "x", warn: "alert-triangle", na: "minus", unknown: "circle" };
const STATUS_COLOR: Record<VpsItemStatus, string> = {
  pass: "var(--leaf-600)", fail: "var(--clay-600)", warn: "var(--amber-600)",
  na: "var(--text-subtle)", unknown: "var(--text-subtle)" };
const MODE_COLOR: Record<VpsMode, string> = {
  AUTO: "var(--brass-700)", AUDIT: "var(--amber-600)", INFO: "var(--text-subtle)" };
const SEV_COLOR: Record<VpsSeverity, string> = {
  critical: "var(--clay-600)", high: "var(--amber-600)", medium: "var(--text-subtle)", low: "var(--text-subtle)" };

function Badge({ text, color }: { text: string; color: string }) {
  return <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em",
    color, border: `1px solid ${color}`, borderRadius: 3, padding: "0 4px", whiteSpace: "nowrap" }}>{text}</span>;
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 90 ? "var(--leaf-600)" : score >= 50 ? "var(--amber-600)" : "var(--clay-600)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 90 }}>
      <div style={{ flex: 1, height: 6, background: "var(--bone-200)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${score}%`, height: "100%", background: color }} />
      </div>
      <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-subtle)", minWidth: 28, textAlign: "right" }}>{score}%</span>
    </div>
  );
}

function ItemRow({ item, busy, selected, onToggle, onNa, onAttest }: {
  item: ChecklistItem; busy: boolean; selected: boolean;
  onToggle: (item: ChecklistItem) => void;
  onNa: (item: ChecklistItem, na: boolean) => void; onAttest: (item: ChecklistItem) => void }) {
  const selectable = item.mode === "AUTO" && !item.na;
  return (
    <div data-testid={`item-${item.id}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0",
      borderBottom: "1px solid var(--border-hair)", fontSize: 13, opacity: item.na ? 0.55 : 1 }}>
      {selectable
        ? <input type="checkbox" aria-label={`pilih ${item.id}`} checked={selected} onChange={() => onToggle(item)} />
        : <span style={{ display: "inline-block", width: 13 }} />}
      <Icon name={STATUS_ICON[item.status]} size={14} color={STATUS_COLOR[item.status]} />
      <span style={{ flex: 1, minWidth: 0 }}>{item.title}</span>
      {item.drifted && <Badge text="drift" color="var(--clay-600)" />}
      <Badge text={item.mode} color={MODE_COLOR[item.mode]} />
      <Badge text={item.severity} color={SEV_COLOR[item.severity]} />
      {item.mode === "INFO" && !item.attested && (
        <Button size="sm" variant="ghost" leftIcon="check-circle" loading={busy}
          onClick={() => onAttest(item)}>Attest</Button>
      )}
      <Button size="sm" variant="ghost" leftIcon={item.na ? "rotate-ccw" : "minus-circle"} loading={busy}
        onClick={() => onNa(item, !item.na)}>{item.na ? "Batal N/A" : "N/A"}</Button>
    </div>
  );
}

type Filter = { section: string; mode: string; status: string; severity: string };
const BLANK_FILTER: Filter = { section: "", mode: "", status: "", severity: "" };

function Select({ value, onChange, options, label }: {
  value: string; onChange: (v: string) => void; options: [string, string][]; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
      style={{ fontSize: 12, padding: "3px 6px", border: "1px solid var(--border-hair)",
        borderRadius: "var(--radius-sm)", background: "var(--bone-50)", color: "var(--text)" }}>
      <option value="">{label}: semua</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

export function VpsChecklist({ vpsId, onToast }:
  { vpsId: string; onToast: (msg: string, kind?: string, icon?: string) => void }) {
  const [view, setView] = React.useState<ChecklistView | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [filter, setFilter] = React.useState<Filter>(BLANK_FILTER);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [preview, setPreview] = React.useState<RemediateStep[] | null>(null);
  const [action, setAction] = React.useState<"" | "preview" | "apply">("");

  const load = React.useCallback(() => {
    setStatus("loading");
    api.vpsChecklist(vpsId).then((v) => { setView(v); setStatus("ready"); }).catch(() => setStatus("error"));
  }, [vpsId]);
  React.useEffect(() => { load(); setSelected(new Set()); setPreview(null); }, [load]);

  const toggle = (item: ChecklistItem) => setSelected((s) => {
    const n = new Set(s); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n; });
  const clearSel = () => { setSelected(new Set()); setPreview(null); };

  async function doPreview() {
    setAction("preview");
    try { setPreview((await api.remediatePreview(vpsId, [...selected])).steps); }
    catch { onToast("Preview remediasi gagal", "err", "x-circle"); }
    finally { setAction(""); }
  }
  async function doApply() {
    if (!window.confirm(`Terapkan ${selected.size} item AUTO ke VPS ini?\nIdempoten & anti-lockout, lalu audit ulang.`)) return;
    setAction("apply");
    try { await api.remediate(vpsId, [...selected]); clearSel(); load(); onToast("Remediasi diterapkan · audit ulang", "ok", "shield"); }
    catch { onToast("Remediasi gagal", "err", "x-circle"); }
    finally { setAction(""); }
  }

  async function act(item: ChecklistItem, fn: () => Promise<unknown>, msg: string) {
    setBusy(item.id);
    try { await fn(); load(); onToast(msg, "ok", "shield"); }
    catch { onToast(`Gagal memperbarui ${item.id}`, "err", "x-circle"); }
    finally { setBusy(null); }
  }
  const onNa = (item: ChecklistItem, na: boolean) =>
    act(item, () => api.markNa(vpsId, item.id, na, na ? "ditandai dari checklist" : undefined),
      na ? `${item.id} ditandai N/A` : `${item.id} kembali applicable`);
  const onAttest = (item: ChecklistItem) =>
    act(item, () => api.attestItem(vpsId, item.id), `${item.id} di-attest`);

  // SPEC-221 · tandai seluruh item satu seksi N/A (advisory app-layer). Manusia yang memicu.
  async function onSectionNa(section: { id: string; title: string; items: ChecklistItem[] }) {
    const ids = section.items.map((i) => i.id);
    if (!window.confirm(`Tandai ${ids.length} item seksi "${section.title}" sebagai N/A?\nStack-nya tak terdeteksi — cek Docker manual bila ragu.`)) return;
    setBusy(`section:${section.id}`);
    try {
      await api.markNaBulk(vpsId, ids, true, "app-layer: stack tak terdeteksi");
      load(); onToast(`Seksi ${section.title} ditandai N/A`, "ok", "shield");
    } catch { onToast("Gagal tandai seksi N/A", "err", "x-circle"); }
    finally { setBusy(null); }
  }

  if (status === "loading") return <StateBlock kind="loading" compact title="Memuat checklist…" />;
  if (status === "error" || !view) return <StateBlock kind="error" compact title="Gagal memuat checklist" action={load} />;

  const match = (i: ChecklistItem) =>
    (!filter.section || i.section === filter.section) &&
    (!filter.mode || i.mode === filter.mode) &&
    (!filter.status || i.status === filter.status) &&
    (!filter.severity || i.severity === filter.severity);

  const set = (k: keyof Filter) => (v: string) => setFilter((f) => ({ ...f, [k]: v }));
  const sections = view.sections
    .map((s) => ({ ...s, items: s.items.filter(match) }))
    .filter((s) => !filter.section || s.id === filter.section);
  // SPEC-221 · jumlah item drift (dari set penuh, tak terpengaruh filter).
  const driftCount = view.sections.reduce((a, s) => a + s.items.filter((i) => i.drifted).length, 0);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div data-testid="score-total" style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-mono)" }}>{view.scoreTotal}%</div>
        <div style={{ flex: 1 }}><ScoreBar score={view.scoreTotal} /></div>
        <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>skor kepatuhan</span>
      </div>
      {driftCount > 0 && (
        <div data-testid="drift-summary" style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10,
          padding: "6px 10px", fontSize: 12, color: "var(--clay-700)",
          background: "var(--clay-50, var(--bone-100))", border: "1px solid var(--clay-600)", borderRadius: "var(--radius-sm)" }}>
          <Icon name="alert-triangle" size={14} color="var(--clay-600)" />
          {driftCount} item drift (regresi) sejak audit sebelumnya
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        <Select label="seksi" value={filter.section} onChange={set("section")}
          options={view.sections.map((s) => [s.id, s.title])} />
        <Select label="mode" value={filter.mode} onChange={set("mode")}
          options={[["AUTO", "AUTO"], ["AUDIT", "AUDIT"], ["INFO", "INFO"]]} />
        <Select label="status" value={filter.status} onChange={set("status")}
          options={[["pass", "pass"], ["fail", "fail"], ["warn", "warn"], ["na", "na"], ["unknown", "unknown"]]} />
        <Select label="severity" value={filter.severity} onChange={set("severity")}
          options={[["critical", "critical"], ["high", "high"], ["medium", "medium"], ["low", "low"]]} />
        {(filter.section || filter.mode || filter.status || filter.severity) &&
          <Button size="sm" variant="ghost" onClick={() => setFilter(BLANK_FILTER)}>Reset</Button>}
      </div>
      {selected.size > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, padding: "8px 10px",
          background: "var(--bone-100)", border: "1px solid var(--brass-300)", borderRadius: "var(--radius-sm)" }}>
          <span style={{ fontSize: 12, flex: 1 }}>{selected.size} item AUTO dipilih</span>
          <Button size="sm" variant="secondary" leftIcon="eye" loading={action === "preview"} onClick={doPreview}>Preview</Button>
          <Button size="sm" leftIcon="shield" loading={action === "apply"} onClick={doApply}>Apply</Button>
          <Button size="sm" variant="ghost" onClick={clearSel}>Batal</Button>
        </div>
      )}
      {preview && (
        <div data-testid="remediate-preview" style={{ marginBottom: 12, padding: "8px 10px", fontSize: 12,
          fontFamily: "var(--font-mono)", background: "var(--bone-50)", border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)" }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Pratinjau (dry-run) — belum diterapkan:</div>
          {preview.map((s) => (
            <div key={s.item} style={{ color: "var(--text-subtle)" }}>{s.item} · {s.status} {s.detail}</div>
          ))}
        </div>
      )}
      {sections.map((s) => s.items.length > 0 && (
        <div key={s.id} style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 14 }}>{s.icon}</span>
            <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{s.title}</span>
            <ScoreBar score={s.score} />
          </div>
          {/* SPEC-221 · saran applicability app-layer (advisory) — stack tak terdeteksi → sarankan N/A. */}
          {s.suggestion && !s.suggestion.applicable && (
            <div data-testid={`suggestion-${s.id}`} style={{ display: "flex", alignItems: "center", gap: 8,
              marginBottom: 6, padding: "6px 10px", fontSize: 12, color: "var(--text-subtle)",
              background: "var(--bone-50)", border: "1px dashed var(--border-hair)", borderRadius: "var(--radius-sm)" }}>
              <Icon name="info" size={13} color="var(--brass-700)" />
              <span style={{ flex: 1 }}>Stack tak terdeteksi ({s.suggestion.detail}) — kemungkinan N/A. Cek Docker manual bila ragu.</span>
              <Button size="sm" variant="ghost" leftIcon="minus-circle" loading={busy === `section:${s.id}`}
                onClick={() => onSectionNa(s)}>Tandai seksi N/A</Button>
            </div>
          )}
          {s.items.map((i) => (
            <ItemRow key={i.id} item={i} busy={busy === i.id} selected={selected.has(i.id)}
              onToggle={toggle} onNa={onNa} onAttest={onAttest} />
          ))}
        </div>
      ))}
    </div>
  );
}
