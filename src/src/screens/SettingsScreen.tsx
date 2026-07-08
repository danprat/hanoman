/* SettingsScreen — workspace settings. Ported; persistence moved from
   localStorage to the API (GET/PUT /settings). Model per pipeline step. */
import React from "react";
import { Card, Switch, Select, Input, Button, Icon } from "../ds";
import { api } from "../api/client";
import type { Setting } from "@hanoman/shared";
import type { ShowToast } from "../ds";

const S_STEPS = [
  { key: "brainstorm", label: "Brainstorm", icon: "messages-square" },
  { key: "spec", label: "Spec", icon: "file-text" },
  { key: "plan", label: "Plan", icon: "git-branch" },
  { key: "execute", label: "Execute", icon: "play" },
  { key: "audit", label: "Audit (QA)", icon: "radar" },
] as const;
const S_MODELS = [
  { value: "opus", label: "claude-opus-4" },
  { value: "sonnet", label: "claude-sonnet-4.5" },
  { value: "haiku", label: "claude-haiku-4" },
];
const S_EFFORT = [
  { value: "xhigh", label: "x-high" }, { value: "high", label: "high" },
  { value: "medium", label: "medium" }, { value: "low", label: "low" },
];
const S_DEFAULT_STEP = { model: "opus", effort: "xhigh" };
const S_DEFAULTS: Setting = {
  steps: { brainstorm: { ...S_DEFAULT_STEP }, spec: { ...S_DEFAULT_STEP }, plan: { ...S_DEFAULT_STEP },
    execute: { ...S_DEFAULT_STEP }, audit: { ...S_DEFAULT_STEP } },
  autoDefault: true, blockStale: true, requireLinks: true, autoScaffold: true,
  maxConcurrent: 3, dailyBudget: 50, notifyFail: true,
};

function SettingRow({ title, desc, children, last }: { title: string; desc?: string; children?: React.ReactNode; last?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 0", borderBottom: last ? "none" : "1px solid var(--border-hair)" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)" }}>{title}</div>
        {desc && <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.5 }}>{desc}</div>}
      </div>
      <div style={{ flex: "0 0 auto" }}>{children}</div>
    </div>
  );
}

export function SettingsScreen({ onToast }: { onToast?: ShowToast }) {
  const [s, setS] = React.useState<Setting | null>(null);
  React.useEffect(() => { api.getSettings().then(setS).catch(() => setS(S_DEFAULTS)); }, []);

  if (!s) return <div style={{ padding: "48px 0", textAlign: "center", color: "var(--text-muted)" }}>Memuat pengaturan…</div>;

  const persist = (next: Setting, msg?: string, tone?: string, icon?: string) => {
    setS(next);
    api.putSettings(next).catch(() => {});
    if (msg && onToast) onToast(msg, tone || "ok", icon || "check-circle-2");
  };
  const save = (patch: Partial<Setting>, msg: string) => persist({ ...s, ...patch }, msg);
  const sw = (k: keyof Setting, msg: string) => (v: boolean) => save({ [k]: v } as Partial<Setting>, msg + (v ? " · aktif" : " · nonaktif"));
  const setStep = (key: string, field: "model" | "effort") => (e: React.ChangeEvent<HTMLSelectElement>) => {
    const step = S_STEPS.find((x) => x.key === key)!;
    persist({ ...s, steps: { ...s.steps, [key]: { ...(s.steps as any)[key], [field]: e.target.value } } },
      step.label + " · " + field + " → " + e.target.value);
  };
  const applyAll = (field: "model" | "effort", value: string, label: string) => persist(
    { ...s, steps: S_STEPS.reduce((o, x) => { (o as any)[x.key] = { ...(s.steps as any)[x.key], [field]: value }; return o; }, {} as any) },
    "Semua step → " + label);

  return (
    <div style={{ maxWidth: 760, display: "flex", flexDirection: "column", gap: 20 }}>
      <Card eyebrow="general" title="Umum">
        <SettingRow title="Full-auto sebagai default" last
          desc="Run baru jalan sendiri sampai selesai. Manusia tetap bisa steer / interupsi kapan pun.">
          <Switch checked={s.autoDefault} onChange={sw("autoDefault", "Full-auto default")} />
        </SettingRow>
      </Card>

      <Card eyebrow="model" title="Model per step"
        actions={<div style={{ display: "flex", gap: 8 }}>
          <Button size="sm" variant="ghost" onClick={() => applyAll("model", "opus", "opus")}>Semua opus</Button>
          <Button size="sm" variant="ghost" onClick={() => applyAll("effort", "xhigh", "x-high")}>Semua x-high</Button>
        </div>}>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
          Tiap step pipeline bisa pakai model & effort berbeda. Default: opus, effort x-high.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 190px 130px", gap: 10, padding: "0 2px 8px", borderBottom: "1px solid var(--border-hair)" }}>
          <span className="hn-eyebrow">Step</span>
          <span className="hn-eyebrow">Model</span>
          <span className="hn-eyebrow">Effort</span>
        </div>
        {S_STEPS.map((step, i) => (
          <div key={step.key} style={{ display: "grid", gridTemplateColumns: "1fr 190px 130px", gap: 10, alignItems: "center", padding: "10px 2px", borderBottom: i < S_STEPS.length - 1 ? "1px solid var(--border-hair)" : "none" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
              <span style={{ width: 26, height: 26, borderRadius: "var(--radius-sm)", flex: "0 0 auto", background: "var(--brass-100)", color: "var(--brass-700)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name={step.icon} size={14} />
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-strong)" }}>{step.label}</span>
            </span>
            <Select size="sm" value={(s.steps as any)[step.key].model} onChange={setStep(step.key, "model")} options={S_MODELS} style={{ width: 190 }} />
            <Select size="sm" value={(s.steps as any)[step.key].effort} onChange={setStep(step.key, "effort")} options={S_EFFORT} style={{ width: 130 }} />
          </div>
        ))}
      </Card>

      <Card eyebrow="guardrails" title="Source of Truth">
        <SettingRow title="Blok plan saat docs stale"
          desc="Stop hook menahan plan sampai docs acuannya diperbarui. Inti workflow docs-driven.">
          <Switch checked={s.blockStale} onChange={sw("blockStale", "Blok docs stale")} />
        </SettingRow>
        <SettingRow title="Wajib link setiap doc"
          desc="Setiap dokumen di internal/docs harus ter-link dari index sebelum execute.">
          <Switch checked={s.requireLinks} onChange={sw("requireLinks", "Wajib link doc")} />
        </SettingRow>
        <SettingRow title="Auto-scaffold doc index" last
          desc="Project from-scratch otomatis di-scaffold doc index-nya setelah objective terkunci.">
          <Switch checked={s.autoScaffold} onChange={sw("autoScaffold", "Auto-scaffold")} />
        </SettingRow>
      </Card>

      <Card eyebrow="runs" title="Run & anggaran">
        <SettingRow title="Run konkuren maksimum" desc="Berapa run Claude Code boleh jalan bersamaan.">
          <Select size="sm" value={String(s.maxConcurrent)}
            onChange={(e) => save({ maxConcurrent: Number(e.target.value) }, "Konkuren maks → " + e.target.value)} style={{ width: 90 }}
            options={["1", "2", "3", "4", "6"].map((v) => ({ value: v, label: v }))} />
        </SettingRow>
        <SettingRow title="Anggaran harian" desc="hanoman menjeda run baru bila anggaran harian tercapai.">
          <Input size="sm" value={String(s.dailyBudget)} leftIcon="dollar-sign"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, dailyBudget: Number(e.target.value) || 0 })}
            onBlur={() => persist(s, "Anggaran harian → $" + s.dailyBudget, "ok", "check-circle-2")}
            style={{ width: 120 }} />
        </SettingRow>
        <SettingRow title="Notifikasi saat run gagal" last desc="Kirim notifikasi ketika plan diblok atau execute gagal.">
          <Switch checked={s.notifyFail} onChange={sw("notifyFail", "Notifikasi gagal")} />
        </SettingRow>
      </Card>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "4px 2px", color: "var(--text-subtle)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
        <span>hanoman · nafanesia.id</span>
        <Button size="sm" variant="ghost" leftIcon="rotate-ccw"
          onClick={() => persist(JSON.parse(JSON.stringify(S_DEFAULTS)), "Pengaturan dikembalikan ke default", "warn", "rotate-ccw")}>
          Reset ke default
        </Button>
      </div>
    </div>
  );
}
