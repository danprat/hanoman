/* VpsChecklist — checklist kepatuhan per-seksi untuk satu VPS (SPEC-220 AC-9/10/11/12).
   Skor total + per-seksi, filter (seksi/mode/status/severity), aksi N/A (semua item) dan
   Attest (item INFO). Remediasi selektif AUTO ditambahkan terpisah (Task 11). */
import React from "react";
import { Button, StateBlock, Icon } from "../ds";
import { api } from "../api/client";
import type { ChecklistView, ChecklistItem, VpsItemStatus, VpsMode, VpsSeverity } from "@hanoman/shared";

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

function ItemRow({ item, busy, onNa, onAttest }: {
  item: ChecklistItem; busy: boolean;
  onNa: (item: ChecklistItem, na: boolean) => void; onAttest: (item: ChecklistItem) => void }) {
  return (
    <div data-testid={`item-${item.id}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0",
      borderBottom: "1px solid var(--border-hair)", fontSize: 13, opacity: item.na ? 0.55 : 1 }}>
      <Icon name={STATUS_ICON[item.status]} size={14} color={STATUS_COLOR[item.status]} />
      <span style={{ flex: 1, minWidth: 0 }}>{item.title}</span>
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

  const load = React.useCallback(() => {
    setStatus("loading");
    api.vpsChecklist(vpsId).then((v) => { setView(v); setStatus("ready"); }).catch(() => setStatus("error"));
  }, [vpsId]);
  React.useEffect(() => { load(); }, [load]);

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

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div data-testid="score-total" style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-mono)" }}>{view.scoreTotal}%</div>
        <div style={{ flex: 1 }}><ScoreBar score={view.scoreTotal} /></div>
        <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>skor kepatuhan</span>
      </div>
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
      {sections.map((s) => s.items.length > 0 && (
        <div key={s.id} style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 14 }}>{s.icon}</span>
            <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{s.title}</span>
            <ScoreBar score={s.score} />
          </div>
          {s.items.map((i) => (
            <ItemRow key={i.id} item={i} busy={busy === i.id} onNa={onNa} onAttest={onAttest} />
          ))}
        </div>
      ))}
    </div>
  );
}
