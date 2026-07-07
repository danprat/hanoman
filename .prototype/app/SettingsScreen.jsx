/* SettingsScreen.jsx — workspace settings. Functional controls with
   local state persisted to localStorage; each change confirms via
   onToast. Model can be set PER STEP (each pipeline step can run a
   different model), defaulting to opus at x-high effort. */
const { Card: SCard, Switch: SSwitch, Select: SSelect, Input: SInput, Badge: SBadge,
        Button: SBtn, Icon: SIcon } = window.HanomanDesignSystem_c639ad;

const S_KEY = "hn-settings-v2";
const S_STEPS = [
  { key: "brainstorm", label: "Brainstorm", icon: "messages-square" },
  { key: "spec", label: "Spec", icon: "file-text" },
  { key: "plan", label: "Plan", icon: "git-branch" },
  { key: "execute", label: "Execute", icon: "play" },
  { key: "audit", label: "Audit (QA)", icon: "radar" },
];
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
const S_DEFAULTS = {
  steps: S_STEPS.reduce((o, s) => (o[s.key] = { ...S_DEFAULT_STEP }, o), {}),
  autoDefault: true,
  blockStale: true, requireLinks: true, autoScaffold: true,
  maxConcurrent: "3", dailyBudget: "25", notifyFail: true,
};
function sLoad() {
  try {
    const raw = JSON.parse(localStorage.getItem(S_KEY) || "{}");
    return { ...S_DEFAULTS, ...raw, steps: { ...S_DEFAULTS.steps, ...(raw.steps || {}) } };
  } catch (e) { return JSON.parse(JSON.stringify(S_DEFAULTS)); }
}

function SettingRow({ title, desc, children, last }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 16, padding: "14px 0",
      borderBottom: last ? "none" : "1px solid var(--border-hair)",
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)" }}>{title}</div>
        {desc && <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.5 }}>{desc}</div>}
      </div>
      <div style={{ flex: "0 0 auto" }}>{children}</div>
    </div>
  );
}

function SettingsScreen({ onToast }) {
  const [s, setS] = React.useState(sLoad);
  const persist = (next, msg, tone, icon) => {
    setS(next);
    try { localStorage.setItem(S_KEY, JSON.stringify(next)); } catch (e) {}
    if (msg && onToast) onToast(msg, tone || "ok", icon || "check-circle-2");
  };
  const save = (patch, msg) => persist({ ...s, ...patch }, msg);
  const sw = (k, msg) => (v) => save({ [k]: v }, msg + (v ? " · aktif" : " · nonaktif"));
  const sel = (k, msg) => (e) => save({ [k]: e.target.value }, msg + " → " + e.target.value);
  const num = (k) => (e) => save({ [k]: e.target.value });
  const setStep = (key, field) => (e) => {
    const step = S_STEPS.find((x) => x.key === key);
    persist({ ...s, steps: { ...s.steps, [key]: { ...s.steps[key], [field]: e.target.value } } },
      step.label + " · " + field + " → " + e.target.value);
  };
  const applyAll = (field, value, label) => persist(
    { ...s, steps: S_STEPS.reduce((o, x) => (o[x.key] = { ...s.steps[x.key], [field]: value }, o), {}) },
    "Semua step → " + label);

  return (
    <div style={{ maxWidth: 760, display: "flex", flexDirection: "column", gap: 20 }}>
      {/* General */}
      <SCard eyebrow="general" title="Umum">
        <SettingRow title="Full-auto sebagai default" last
          desc="Run baru jalan sendiri sampai selesai. Manusia tetap bisa steer / interupsi kapan pun.">
          <SSwitch checked={s.autoDefault} onChange={sw("autoDefault", "Full-auto default")} />
        </SettingRow>
      </SCard>

      {/* Model per step */}
      <SCard eyebrow="model" title="Model per step"
        actions={<div style={{ display: "flex", gap: 8 }}>
          <SBtn size="sm" variant="ghost" onClick={() => applyAll("model", "opus", "opus")}>Semua opus</SBtn>
          <SBtn size="sm" variant="ghost" onClick={() => applyAll("effort", "xhigh", "x-high")}>Semua x-high</SBtn>
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
                <SIcon name={step.icon} size={14} />
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-strong)" }}>{step.label}</span>
            </span>
            <SSelect size="sm" value={s.steps[step.key].model} onChange={setStep(step.key, "model")} options={S_MODELS} style={{ width: 190 }} />
            <SSelect size="sm" value={s.steps[step.key].effort} onChange={setStep(step.key, "effort")} options={S_EFFORT} style={{ width: 130 }} />
          </div>
        ))}
      </SCard>

      {/* Source of Truth */}
      <SCard eyebrow="guardrails" title="Source of Truth">
        <SettingRow title="Blok plan saat docs stale"
          desc="Stop hook menahan plan sampai docs acuannya diperbarui. Inti workflow docs-driven.">
          <SSwitch checked={s.blockStale} onChange={sw("blockStale", "Blok docs stale")} />
        </SettingRow>
        <SettingRow title="Wajib link setiap doc"
          desc="Setiap dokumen di internal/docs harus ter-link dari index sebelum execute.">
          <SSwitch checked={s.requireLinks} onChange={sw("requireLinks", "Wajib link doc")} />
        </SettingRow>
        <SettingRow title="Auto-scaffold doc index" last
          desc="Project from-scratch otomatis di-scaffold doc index-nya setelah objective terkunci.">
          <SSwitch checked={s.autoScaffold} onChange={sw("autoScaffold", "Auto-scaffold")} />
        </SettingRow>
      </SCard>

      {/* Runs & budget */}
      <SCard eyebrow="runs" title="Run & anggaran">
        <SettingRow title="Run konkuren maksimum" desc="Berapa run Claude Code boleh jalan bersamaan.">
          <SSelect size="sm" value={s.maxConcurrent} onChange={sel("maxConcurrent", "Konkuren maks")} style={{ width: 90 }}
            options={["1", "2", "3", "4", "6"].map((v) => ({ value: v, label: v }))} />
        </SettingRow>
        <SettingRow title="Anggaran harian" desc="hanoman menjeda run baru bila anggaran harian tercapai.">
          <SInput size="sm" value={s.dailyBudget} onChange={num("dailyBudget")} leftIcon="dollar-sign"
            onBlur={() => onToast && onToast("Anggaran harian → $" + s.dailyBudget, "ok", "check-circle-2")}
            style={{ width: 120 }} />
        </SettingRow>
        <SettingRow title="Notifikasi saat run gagal" last desc="Kirim notifikasi ketika plan diblok atau execute gagal.">
          <SSwitch checked={s.notifyFail} onChange={sw("notifyFail", "Notifikasi gagal")} />
        </SettingRow>
      </SCard>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        padding: "4px 2px", color: "var(--text-subtle)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
        <span>hanoman · nafanesia.id</span>
        <SBtn size="sm" variant="ghost" leftIcon="rotate-ccw"
          onClick={() => persist(JSON.parse(JSON.stringify(S_DEFAULTS)), "Pengaturan dikembalikan ke default", "warn", "rotate-ccw")}>
          Reset ke default
        </SBtn>
      </div>
    </div>
  );
}

Object.assign(window, { SettingsScreen });
