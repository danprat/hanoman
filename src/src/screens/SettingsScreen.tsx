/* SettingsScreen — workspace settings. Ported; persistence moved from
   localStorage to the API (GET/PUT /settings). Model per pipeline step. */
import React from "react";
import { Card, Switch, Select, Button, StateBlock } from "../ds";
import { api } from "../api/client";
import type { Setting } from "@hanoman/shared";
import type { ShowToast } from "../ds";

// Valid Claude model ids, diteruskan apa adanya ke `claude --model`. Keep in
// sync with the server default in services/settings.ts.
const S_MODELS = [
  { value: "claude-opus-4-8", label: "Opus 4.8" },
  { value: "claude-sonnet-5", label: "Sonnet 5" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5" },
];
// Effort keys diteruskan apa adanya ke `claude --effort`.
const S_EFFORT = [
  { value: "xhigh", label: "x-high" }, { value: "high", label: "high" },
  { value: "medium", label: "medium" }, { value: "low", label: "low" },
];
const S_DEFAULTS: Setting = {
  model: "claude-opus-4-8", effort: "xhigh",
  autoDefault: true, autoScaffold: true, notifyFail: true,
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
  const [failed, setFailed] = React.useState(false);
  // Jangan fallback ke S_DEFAULTS saat GET gagal: toggle berikutnya akan mem-PUT
  // default itu menimpa pengaturan asli di server.
  const load = React.useCallback(() => {
    setFailed(false); setS(null);
    api.getSettings().then(setS).catch(() => setFailed(true));
  }, []);
  React.useEffect(() => { load(); }, [load]);

  if (failed) return <StateBlock kind="error" title="Gagal memuat pengaturan"
    hint="Pengaturan tidak ditampilkan agar tidak menimpa nilai di server." action={load} />;
  if (!s) return <StateBlock kind="loading" title="Memuat pengaturan…" />;

  const persist = (next: Setting, msg?: string, tone?: string, icon?: string) => {
    setS(next);
    api.putSettings(next).catch(() => {});
    if (msg && onToast) onToast(msg, tone || "ok", icon || "check-circle-2");
  };
  const save = (patch: Partial<Setting>, msg: string) => persist({ ...s, ...patch }, msg);
  const sw = (k: keyof Setting, msg: string) => (v: boolean) => save({ [k]: v } as Partial<Setting>, msg + (v ? " · aktif" : " · nonaktif"));

  return (
    <div style={{ maxWidth: 760, display: "flex", flexDirection: "column", gap: 20 }}>
      <Card eyebrow="general" title="Umum">
        <SettingRow title="Full-auto sebagai default"
          desc="Run baru jalan sendiri sampai selesai. Manusia tetap bisa steer / interupsi kapan pun.">
          <Switch checked={s.autoDefault} onChange={sw("autoDefault", "Full-auto default")} />
        </SettingRow>
        <SettingRow title="Auto-scaffold doc index" last
          desc="Project from-scratch otomatis di-scaffold doc index-nya setelah objective terkunci.">
          <Switch checked={s.autoScaffold} onChange={sw("autoScaffold", "Auto-scaffold")} />
        </SettingRow>
      </Card>

      {/* SPEC-162 · satu model per sesi, dipakai sebagai argv saat sesi lahir. Manusia tetap
          bebas mengetik `/model` di dalam terminal — itu justru gunanya interaktif. */}
      <Card eyebrow="model" title="Model sesi">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
          Dipakai saat sesi Claude Code dibuka dari backlog. Di dalam terminal, <code>/model</code> mengubahnya kapan saja.
        </div>
        <SettingRow title="Model">
          <Select size="sm" value={s.model} options={S_MODELS} style={{ width: 190 }}
            onChange={(e) => save({ model: e.target.value }, "Model → " + e.target.value)} />
        </SettingRow>
        <SettingRow title="Effort" last desc="Anggaran berpikir per giliran.">
          <Select size="sm" value={s.effort} options={S_EFFORT} style={{ width: 130 }}
            onChange={(e) => save({ effort: e.target.value }, "Effort → " + e.target.value)} />
        </SettingRow>
      </Card>

      <Card eyebrow="sesi" title="Sesi">
        <SettingRow title="Notifikasi saat sesi gagal" last desc="Kirim notifikasi ketika sesi Claude Code berakhir dengan error.">
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
