/* SettingsScreen — workspace settings. Ported; persistence moved from
   localStorage to the API (GET/PUT /settings). Model per pipeline step. */
import React from "react";
import { Card, Switch, Select, Button, Input, Field, Icon, StateBlock } from "../ds";
import { api, ApiError } from "../api/client";
import type { Setting, UserView, DeviceTokenView, SessionResultView, ConfigResponse, ConfigEntryView } from "@hanoman/shared";
import type { ShowToast } from "../ds";
import { playNotifySound, type NotifySound } from "../notifications/sound";

// Valid Claude model ids, diteruskan apa adanya ke `claude --model`. Keep in
// sync with the server default in services/settings.ts.
const S_MODELS = [
  { value: "claude-opus-4-8", label: "Opus 4.8" },
  { value: "claude-sonnet-5", label: "Sonnet 5" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5" },
  { value: "claude-fable-5", label: "Fable 5" },      // SPEC-238
];
// Effort keys diteruskan apa adanya ke `claude --effort`.
const S_EFFORT = [
  { value: "xhigh", label: "x-high" }, { value: "high", label: "high" },
  { value: "medium", label: "medium" }, { value: "low", label: "low" },
  { value: "max", label: "max" }, { value: "ultracode", label: "ultracode" }, // SPEC-238
];
// SPEC-252 · ADR-0061 · matrix model/effort per fase (SPEC-238) dicabut — model/effort kini per SESI,
// dipilih saat Start (StartSessionModal). Yang tersisa di sini hanya default global.
// SPEC-180 · nada notifikasi backlog selesai (durasi bervariasi). "off" = senyap (toast+daftar tetap jalan).
const S_SOUNDS = [
  { value: "blip", label: "Blip · 0.1s" }, { value: "pop", label: "Pop · 0.1s" },
  { value: "short", label: "Short · 0.15s" }, { value: "ping", label: "Ping · 0.2s" },
  { value: "coin", label: "Coin · 0.3s" }, { value: "alert", label: "Alert · 0.3s" },
  { value: "medium", label: "Medium · 0.4s" }, { value: "chime", label: "Chime · 0.4s" },
  { value: "success", label: "Success · 0.4s" }, { value: "bell", label: "Bell · 0.5s" },
  { value: "marimba", label: "Marimba · 0.6s" }, { value: "long", label: "Long · 0.8s" },
  { value: "fanfare", label: "Fanfare · 0.9s" }, { value: "off", label: "Senyap" },
];
const S_DEFAULTS: Setting = {
  model: "claude-opus-4-8", effort: "xhigh",
  autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short",
  notifyDecision: true, notifyDecisionSound: "alert",
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
          {/* marginBottom = Field.marginBottom (kit.tsx). alignItems:end mendasarkan tombol
              ke dasar baris, tapi margin bawah Field mengangkat input 14px dari sana; tanpa
              ini tombol jatuh 14px di bawah input. */}
          <Button size="sm" leftIcon="key-round" disabled={!canChange} onClick={changePw}
            style={{ marginBottom: 14 }}>Ganti</Button>
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
          {/* marginBottom = Field.marginBottom — sejajarkan dasar tombol dengan dasar input (lihat AccountPanel). */}
          <Button size="sm" leftIcon="user-plus" disabled={!canInvite} onClick={invite}
            style={{ marginBottom: 14 }}>Invite</Button>
        </div>
      </div>
    </Card>
  );
}

// SPEC-213 · Perangkat: device token per-device untuk auth sync ke hub. Token plaintext hanya
// ditampilkan SEKALI saat dibuat (server simpan hash). Revoke = cabut satu device, yang lain aman.
function DeviceTokensPanel({ onToast }: { onToast?: ShowToast }) {
  const [tokens, setTokens] = React.useState<DeviceTokenView[] | null>(null);
  const [name, setName] = React.useState("");
  const [fresh, setFresh] = React.useState<{ name: string; token: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(() => { api.listDeviceTokens().then(setTokens).catch(() => setTokens([])); }, []);
  React.useEffect(() => { load(); }, [load]);
  async function create() {
    if (name.trim().length < 1 || busy) return;
    setBusy(true);
    try {
      const t = await api.createDeviceToken({ name: name.trim() });
      setFresh({ name: t.name, token: t.token }); setName(""); load();
      onToast?.("Token perangkat dibuat — salin sekarang", "ok", "key-round");
    } catch { onToast?.("Gagal membuat token", "err", "x-circle"); }
    finally { setBusy(false); }
  }
  async function revoke(t: DeviceTokenView) {
    if (!window.confirm(`Cabut token "${t.name}"? Perangkat itu tak bisa sync lagi.`)) return;
    try { await api.revokeDeviceToken(t.id); load(); onToast?.("Token dicabut", "warn", "trash-2"); }
    catch { onToast?.("Gagal mencabut token", "err", "x-circle"); }
  }
  const active = (tokens ?? []).filter((t) => !t.revokedAt);
  return (
    <Card eyebrow="perangkat" title="Device tokens">
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Token per-perangkat untuk menyinkronkan instance lokal ke hub (Bearer). Tempel di
        <code style={{ margin: "0 4px" }}>SYNC_DEVICE_TOKEN</code> pada instance client. Plaintext hanya tampil sekali.
      </div>
      {fresh && (
        <div style={{ padding: 12, marginBottom: 12, border: "1px solid var(--brass-300)", borderRadius: "var(--radius-sm)", background: "var(--brass-100)" }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Token untuk “{fresh.name}” — salin sekarang, tak akan ditampilkan lagi:</div>
          <code style={{ display: "block", wordBreak: "break-all", fontSize: 12 }}>{fresh.token}</code>
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <Button size="sm" leftIcon="copy" onClick={() => { void navigator.clipboard?.writeText(fresh.token); onToast?.("Disalin", "ok", "copy"); }}>Salin</Button>
            <Button size="sm" variant="ghost" onClick={() => setFresh(null)}>Tutup</Button>
          </div>
        </div>
      )}
      {tokens === null ? <StateBlock kind="loading" compact title="Memuat token…" />
        : active.length === 0 ? <div style={{ fontSize: 13, color: "var(--text-subtle)", padding: "8px 0" }}>Belum ada token perangkat.</div>
        : active.map((t, i) => (
          <SettingRow key={t.id} title={t.name} last={i === active.length - 1}
            desc={"dibuat " + new Date(t.createdAt).toLocaleDateString("id-ID") + (t.lastSeenAt ? " · terlihat " + new Date(t.lastSeenAt).toLocaleString("id-ID") : " · belum dipakai")}>
            <Button size="sm" variant="ghost" leftIcon="trash-2" onClick={() => revoke(t)}>Cabut</Button>
          </SettingRow>
        ))}
      <div style={{ paddingTop: 14, display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
        <Field label="Nama perangkat"><Input value={name} placeholder="laptop-dena"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} style={{ width: "100%" }} /></Field>
        <Button size="sm" leftIcon="plus" disabled={name.trim().length < 1 || busy} onClick={create} style={{ marginBottom: 14 }}>Buat token</Button>
      </div>
    </Card>
  );
}

// SPEC-213 · Aktivitas: activity log ringkasan hasil sesi (append-only, disync dari semua device).
function ActivityPanel({ onToast }: { onToast?: ShowToast }) {
  const [projectId, setProjectId] = React.useState("");
  const [rows, setRows] = React.useState<SessionResultView[] | null>(null);
  const load = React.useCallback(() => { api.listSessionResults(projectId || undefined).then(setRows).catch(() => setRows([])); }, [projectId]);
  React.useEffect(() => { load(); }, [load]);
  async function purge() {
    if (!projectId) { onToast?.("Isi project id untuk purge", "warn", "alert-triangle"); return; }
    if (!window.confirm(`Purge activity log project "${projectId}"?`)) return;
    try { const r = await api.purgeSessionResults(projectId); load(); onToast?.(`${r.purged} entri dihapus`, "warn", "trash-2"); }
    catch { onToast?.("Gagal purge", "err", "x-circle"); }
  }
  return (
    <Card eyebrow="aktivitas" title="Activity log">
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Ringkasan hasil sesi lintas device (transisi stage, commit, PR) — append-only. Filter per project.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end", marginBottom: 12 }}>
        <Field label="Project id (opsional)"><Input value={projectId} placeholder="semua project"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setProjectId(e.target.value)} style={{ width: "100%" }} /></Field>
        <Button size="sm" variant="ghost" leftIcon="trash-2" disabled={!projectId} onClick={purge} style={{ marginBottom: 14 }}>Purge</Button>
      </div>
      {rows === null ? <StateBlock kind="loading" compact title="Memuat aktivitas…" />
        : rows.length === 0 ? <div style={{ fontSize: 13, color: "var(--text-subtle)", padding: "8px 0" }}>Belum ada aktivitas.</div>
        : rows.map((r, i) => (
          <SettingRow key={r.id} last={i === rows.length - 1}
            title={`${r.specId ?? r.projectId}${r.oldStage && r.newStage ? ` · ${r.oldStage} → ${r.newStage}` : ""}`}
            desc={[r.status, r.commitSha ? r.commitSha.slice(0, 8) : null, r.branch, r.author, new Date(r.createdAt).toLocaleString("id-ID")].filter(Boolean).join(" · ")}>
            {r.prUrl && <a href={r.prUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost" leftIcon="external-link">PR</Button></a>}
          </SettingRow>
        ))}
    </Card>
  );
}

// SPEC-215 · atur env non-bootstrap via Settings. Secret: mask + "Ganti"; bootstrap read-only.
const GROUP_LABEL: Record<string, string> = {
  sync: "Sync", claude: "Claude", vps: "VPS", runtime: "Runtime", bootstrap: "Bootstrap (read-only)",
};
function ConfigPanel({ onToast }: { onToast?: ShowToast }) {
  const [data, setData] = React.useState<ConfigResponse | null>(null);
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const load = React.useCallback(() => { api.getConfig().then(setData).catch(() => setData(null)); }, []);
  React.useEffect(() => { load(); }, [load]);
  if (!data) return <StateBlock kind="loading" title="Memuat konfigurasi…" />;

  const clearDraft = (key: string) => setDrafts((d) => { const n = { ...d }; delete n[key]; return n; });
  const save = async (e: ConfigEntryView) => {
    const v = drafts[e.key] ?? "";
    try { await api.putConfig(e.key, v); clearDraft(e.key); load();
      onToast?.(`${e.label} disimpan`, "ok", "check-circle-2"); }
    catch { onToast?.(`Gagal menyimpan ${e.label}`, "err", "x-circle"); }
  };
  const reset = async (e: ConfigEntryView) => {
    try { await api.deleteConfig(e.key); clearDraft(e.key); load(); onToast?.(`${e.label} direset`, "warn", "rotate-ccw"); }
    catch { onToast?.("Gagal reset", "err", "x-circle"); }
  };

  const groups = [...new Set(data.entries.map((e) => e.group))];
  return (
    <>
      {groups.map((g) => (
        <Card key={g} eyebrow={g} title={GROUP_LABEL[g] ?? g}>
          {g === "sync" && (
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 8 }}>
              {data.sync.running ? (data.sync.connected ? "● Tersambung ke hub" : "◐ Sync aktif, menyambung…") : "○ Tidak sync (HUB murni)"}
            </div>
          )}
          {data.entries.filter((e) => e.group === g).map((e) => (
            <SettingRow key={e.key} title={e.label} desc={e.help}>
              <ConfigField entry={e} draft={drafts[e.key]}
                onDraft={(v) => setDrafts((d) => ({ ...d, [e.key]: v }))}
                onSave={() => save(e)} onReset={() => reset(e)} />
            </SettingRow>
          ))}
        </Card>
      ))}
    </>
  );
}

function ConfigField({ entry, draft, onDraft, onSave, onReset }: {
  entry: ConfigEntryView; draft?: string; onDraft: (v: string) => void; onSave: () => void; onReset: () => void;
}) {
  const badge = <span style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", color: "var(--text-subtle)", marginRight: 8 }}>{entry.source} · {entry.apply}</span>;
  if (!entry.editable) { // bootstrap read-only
    return <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{badge}
      <code style={{ fontSize: 12 }}>{entry.masked ?? entry.value ?? "—"}</code></div>;
  }
  if (entry.kind === "secret") {
    return <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{badge}
      {entry.hasValue && draft === undefined
        ? <><code style={{ fontSize: 12 }}>{entry.masked}</code>
            <Button size="sm" variant="ghost" leftIcon="pencil" onClick={() => onDraft("")}>Ganti</Button>
            <Button size="sm" variant="ghost" leftIcon="trash-2" onClick={onReset}>Hapus</Button></>
        : <><Input aria-label={entry.label} type="password" placeholder={entry.hasValue ? "biarkan kosong = pertahankan" : "tempel token…"}
              value={draft ?? ""} onChange={(ev: React.ChangeEvent<HTMLInputElement>) => onDraft(ev.target.value)} style={{ width: 240 }} />
            <Button size="sm" leftIcon="save" onClick={onSave}>Simpan</Button></>}
    </div>;
  }
  if (entry.kind === "bool") {
    const on = (draft ?? entry.value) === "1";
    return <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{badge}
      <Switch checked={on} onChange={(v: boolean) => { onDraft(v ? "1" : "0"); }} />
      {draft !== undefined && <Button size="sm" leftIcon="save" onClick={onSave}>Simpan</Button>}</div>;
  }
  // url | int | string | path
  return <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{badge}
    <Input aria-label={entry.label} type={entry.kind === "int" ? "number" : "text"}
      value={draft ?? entry.value ?? ""} onChange={(ev: React.ChangeEvent<HTMLInputElement>) => onDraft(ev.target.value)} style={{ width: 240 }} />
    <Button size="sm" leftIcon="save" onClick={onSave}>Simpan</Button>
    {entry.source === "db" && <Button size="sm" variant="ghost" leftIcon="rotate-ccw" onClick={onReset}>Reset</Button>}</div>;
}

// Grup navigasi settings — sidebar kiri. Akun & Users tak bergantung GET /settings; umum/model/
// sesi bergantung dan menampilkan loading/error-nya sendiri.
const S_SECTIONS = [
  { key: "akun", label: "Akun", icon: "user-round" },
  { key: "users", label: "Users", icon: "users" },
  { key: "perangkat", label: "Perangkat", icon: "key-round" },   // SPEC-213 · device tokens
  { key: "aktivitas", label: "Aktivitas", icon: "activity" },    // SPEC-213 · activity log
  { key: "konfigurasi", label: "Konfigurasi", icon: "sliders" }, // SPEC-215 · env runtime
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
      // SPEC-252 · ADR-0061 · default global saja. Model & effort dipilih PER SESI saat Start
      // (picker StartSessionModal); matrix per-fase (SPEC-238) dicabut. Manusia tetap bebas mengetik
      // `/model`/`/effort` di dalam terminal — itu justru gunanya interaktif.
      <Card eyebrow="model" title="Model sesi — default global">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
          Default untuk sesi baru; bisa di-override per sesi saat <b>Start</b>. Di terminal, <code>/model</code>
          mengubahnya kapan saja. Sesi = satu proses, satu model seumur hidup.
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
      <Card eyebrow="sesi" title="Sesi & notifikasi">
        <SettingRow title="Notifikasi backlog selesai"
          desc="Toast + sound saat sebuah backlog mencapai stage done. Daftar lonceng tetap terisi meski dimatikan.">
          <Switch checked={s.notifyDone} onChange={sw("notifyDone", "Notifikasi backlog selesai")} />
        </SettingRow>
        <SettingRow title="Sound notifikasi" desc="Durasi nada saat backlog selesai.">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Select size="sm" value={s.notifySound} options={S_SOUNDS} style={{ width: 160 }}
              onChange={(e) => save({ notifySound: e.target.value as NotifySound }, "Sound → " + e.target.value)} />
            <Button size="sm" variant="ghost" leftIcon="volume-2" disabled={s.notifySound === "off"}
              onClick={() => playNotifySound(s.notifySound as NotifySound)}>Preview</Button>
          </div>
        </SettingRow>
        <SettingRow title="Notifikasi butuh keputusan"
          desc="Toast + sound saat sesi Claude berhenti menunggu keputusanmu. Nada sengaja beda dari selesai.">
          <Switch checked={s.notifyDecision} onChange={sw("notifyDecision", "Notifikasi keputusan")} />
        </SettingRow>
        <SettingRow title="Sound keputusan" desc="Nada saat sebuah sesi menunggu keputusan.">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Select size="sm" value={s.notifyDecisionSound} options={S_SOUNDS} style={{ width: 160 }}
              onChange={(e) => save({ notifyDecisionSound: e.target.value as NotifySound }, "Sound keputusan → " + e.target.value)} />
            <Button size="sm" variant="ghost" leftIcon="volume-2" disabled={s.notifyDecisionSound === "off"}
              onClick={() => playNotifySound(s.notifyDecisionSound as NotifySound)}>Preview</Button>
          </div>
        </SettingRow>
        <SettingRow title="Notifikasi saat sesi gagal" last desc="Kirim notifikasi ketika sesi Claude Code berakhir dengan error.">
          <Switch checked={s.notifyFail} onChange={sw("notifyFail", "Notifikasi gagal")} />
        </SettingRow>
      </Card>
    );
  }

  const content = tab === "akun" ? <AccountPanel me={me} onLoggedOut={onLoggedOut} onToast={onToast} />
    : tab === "users" ? <UsersPanel me={me} onToast={onToast} />
    : tab === "perangkat" ? <DeviceTokensPanel onToast={onToast} />
    : tab === "aktivitas" ? <ActivityPanel onToast={onToast} />
    : tab === "konfigurasi" ? <ConfigPanel onToast={onToast} />
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
