/* SettingsScreen — workspace settings. Ported; persistence moved from
   localStorage to the API (GET/PUT /settings). Model per pipeline step. */
import React from "react";
import { Card, Switch, Select, Button, Input, Field, Icon, StateBlock } from "../ds";
import { api, ApiError } from "../api/client";
import type { Setting, UserView } from "@hanoman/shared";
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

// SPEC-169 · Akun: email, logout, ganti password sendiri.
function AccountPanel({ me, onLoggedOut, onToast }: { me: UserView; onLoggedOut: () => void; onToast?: ShowToast }) {
  const [cur, setCur] = React.useState("");
  const [next, setNext] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const canChange = cur.length >= 1 && next.length >= 8 && !busy;
  async function changePw() {
    if (!canChange) return;
    setBusy(true);
    try {
      await api.changePassword({ currentPassword: cur, newPassword: next });
      setCur(""); setNext("");
      onToast?.("Password diganti · perangkat lain ter-logout", "ok", "key-round");
    } catch (e) {
      onToast?.(e instanceof ApiError && e.status === 400 ? "Password lama salah" : "Gagal ganti password", "err", "x-circle");
    } finally { setBusy(false); }
  }
  async function logout() { try { await api.logout(); } finally { onLoggedOut(); } }
  return (
    <Card eyebrow="akun" title="Akun"
      actions={<Button size="sm" variant="ghost" leftIcon="log-out" onClick={logout}>Logout</Button>}>
      <SettingRow title="Masuk sebagai" desc={me.email}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-subtle)" }}>{me.id}</span>
      </SettingRow>
      <div style={{ paddingTop: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)", marginBottom: 10 }}>Ganti password</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "end" }}>
          <Field label="Password lama"><Input type="password" autoComplete="current-password" value={cur}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCur(e.target.value)} style={{ width: "100%" }} /></Field>
          <Field label={<>Password baru <span style={{ fontWeight: 400, color: "var(--text-subtle)" }}>· min 8</span></>}>
            <Input type="password" autoComplete="new-password" value={next}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNext(e.target.value)} style={{ width: "100%" }} /></Field>
          <Button size="sm" leftIcon="key-round" disabled={!canChange} onClick={changePw}>Ganti</Button>
        </div>
      </div>
    </Card>
  );
}

// SPEC-169 · Users: daftar, invite (set password langsung), hapus. Tanpa RBAC — semua setara.
function UsersPanel({ me, onToast }: { me: UserView; onToast?: ShowToast }) {
  const [users, setUsers] = React.useState<UserView[] | null>(null);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(() => { api.listUsers().then(setUsers).catch(() => setUsers([])); }, []);
  React.useEffect(() => { load(); }, [load]);
  const canInvite = /\S+@\S+\.\S+/.test(email) && password.length >= 8 && !busy;
  async function invite() {
    if (!canInvite) return;
    setBusy(true);
    try {
      await api.inviteUser({ email, password });
      setEmail(""); setPassword(""); load();
      onToast?.("User " + email + " diundang", "ok", "user-plus");
    } catch (e) {
      onToast?.(e instanceof ApiError && e.status === 409 ? "Email sudah dipakai" : "Gagal mengundang user", "err", "x-circle");
    } finally { setBusy(false); }
  }
  async function remove(u: UserView) {
    if (!window.confirm(`Hapus user "${u.email}"? Semua sesinya ikut dicabut.`)) return;
    try { await api.deleteUser(u.id); load(); onToast?.("User " + u.email + " dihapus", "warn", "trash-2"); }
    catch (e) { onToast?.(e instanceof ApiError && e.status === 400 ? "Tak bisa hapus user terakhir" : "Gagal hapus user", "err", "x-circle"); }
  }
  return (
    <Card eyebrow="users" title="Users">
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Undang user lain dengan menetapkan password-nya langsung — tanpa email undangan.
      </div>
      {users === null ? <StateBlock kind="loading" compact title="Memuat users…" /> : users.map((u, i) => (
        <SettingRow key={u.id} title={u.email} last={i === users.length - 1}
          desc={"dibuat " + new Date(u.createdAt).toLocaleDateString("id-ID") + (u.id === me.id ? " · kamu" : "")}>
          <Button size="sm" variant="ghost" leftIcon="trash-2" disabled={users.length <= 1} onClick={() => remove(u)}>Hapus</Button>
        </SettingRow>
      ))}
      <div style={{ paddingTop: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)", marginBottom: 10 }}>Invite user</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "end" }}>
          <Field label="Email"><Input type="email" value={email} placeholder="user@nafanesia.id"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} style={{ width: "100%" }} /></Field>
          <Field label={<>Password <span style={{ fontWeight: 400, color: "var(--text-subtle)" }}>· min 8</span></>}>
            <Input type="password" autoComplete="new-password" value={password}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} style={{ width: "100%" }} /></Field>
          <Button size="sm" leftIcon="user-plus" disabled={!canInvite} onClick={invite}>Invite</Button>
        </div>
      </div>
    </Card>
  );
}

// Grup navigasi settings — sidebar kiri. Akun & Users tak bergantung GET /settings; umum/model/
// sesi bergantung dan menampilkan loading/error-nya sendiri.
const S_SECTIONS = [
  { key: "akun", label: "Akun", icon: "user-round" },
  { key: "users", label: "Users", icon: "users" },
  { key: "umum", label: "Umum", icon: "sliders-horizontal" },
  { key: "model", label: "Model sesi", icon: "cpu" },
  { key: "sesi", label: "Sesi", icon: "bell" },
] as const;

export function SettingsScreen({ onToast, me, onLoggedOut }:
  { onToast?: ShowToast; me: UserView; onLoggedOut: () => void }) {
  const [s, setS] = React.useState<Setting | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [tab, setTab] = React.useState<string>("akun");
  // Jangan fallback ke S_DEFAULTS saat GET gagal: toggle berikutnya akan mem-PUT
  // default itu menimpa pengaturan asli di server.
  const load = React.useCallback(() => {
    setFailed(false); setS(null);
    api.getSettings().then(setS).catch(() => setFailed(true));
  }, []);
  React.useEffect(() => { load(); }, [load]);

  // Kartu yang bergantung settings (umum/model/sesi). Loading/failed hanya relevan di sini.
  function prefs() {
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

    if (tab === "umum") return (
      <>
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
        {/* Reset menyentuh SEMUA settings → taruh di grup umum saja, tak diulang tiap tab. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "4px 2px", color: "var(--text-subtle)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
          <span>hanoman · nafanesia.id</span>
          <Button size="sm" variant="ghost" leftIcon="rotate-ccw"
            onClick={() => persist(JSON.parse(JSON.stringify(S_DEFAULTS)), "Pengaturan dikembalikan ke default", "warn", "rotate-ccw")}>
            Reset ke default
          </Button>
        </div>
      </>
    );
    if (tab === "model") return (
      // SPEC-162 · satu model per sesi, dipakai sebagai argv saat sesi lahir. Manusia tetap
      // bebas mengetik `/model` di dalam terminal — itu justru gunanya interaktif.
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
    );
    return ( // sesi
      <Card eyebrow="sesi" title="Sesi">
        <SettingRow title="Notifikasi saat sesi gagal" last desc="Kirim notifikasi ketika sesi Claude Code berakhir dengan error.">
          <Switch checked={s.notifyFail} onChange={sw("notifyFail", "Notifikasi gagal")} />
        </SettingRow>
      </Card>
    );
  }

  const content = tab === "akun" ? <AccountPanel me={me} onLoggedOut={onLoggedOut} onToast={onToast} />
    : tab === "users" ? <UsersPanel me={me} onToast={onToast} />
    : prefs();

  return (
    <div style={{ display: "grid", gridTemplateColumns: "196px 1fr", gap: 24, alignItems: "start", maxWidth: 920 }}>
      <nav aria-label="Navigasi pengaturan" style={{ display: "flex", flexDirection: "column", gap: 2, position: "sticky", top: 0 }}>
        {S_SECTIONS.map((sec) => {
          const on = sec.key === tab;
          return (
            <button key={sec.key} aria-current={on ? "page" : undefined} onClick={() => setTab(sec.key)} style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 12px",
              border: "none", cursor: "pointer", textAlign: "left", borderRadius: "var(--radius-sm)",
              background: on ? "var(--brass-100)" : "transparent",
              color: on ? "var(--brass-700)" : "var(--text-muted)", fontWeight: on ? 600 : 500,
              fontFamily: "var(--font-ui)", fontSize: 13.5,
            }}>
              <Icon name={sec.icon} size={16} color={on ? "var(--brass-700)" : "var(--text-subtle)"} />
              {sec.label}
            </button>
          );
        })}
      </nav>
      <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>{content}</div>
    </div>
  );
}
