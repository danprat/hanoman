/* VpsScreen — daftar VPS: reachable/hardened, audit per check, tombol
   Audit / Harden / Sesi Claude (SPEC-164). Screen mandiri (pola SettingsScreen):
   memuat datanya sendiri, App hanya memasang Shell. */
import React from "react";
import { Button, Modal, Field, Input, StateBlock, StatusPill, Icon } from "../ds";
import { api } from "../api/client";
import type { VpsView, VpsCheck } from "@hanoman/shared";

// reachable = healthcheck terakhir sukses dalam 2× interval 5 menit (SPEC-164 §4).
export const isReachable = (v: VpsView, now: number = Date.now()): boolean =>
  !!v.lastSeenAt && now - new Date(v.lastSeenAt).getTime() < 10 * 60_000;
export const hardenedLabel = (v: VpsView): "hardened" | "belum" | "unknown" =>
  !v.lastAuditAt ? "unknown" : v.hardened ? "hardened" : "belum";

// Kosakata status StatusPill yang ada: ok (hijau) · broken (merah) · idle (abu).
const HARDENED_PILL = {
  hardened: { status: "ok", label: "hardened" },
  belum: { status: "broken", label: "belum hardened" },
  unknown: { status: "idle", label: "belum diaudit" },
} as const;

const CHECK_ICON = { pass: "check", fail: "x", warn: "alert-triangle" } as const;
const CHECK_COLOR = { pass: "var(--leaf-600)", fail: "var(--clay-600)", warn: "var(--amber-600)" } as const;
function CheckRow({ c }: { c: VpsCheck }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "4px 0",
      borderBottom: "1px solid var(--border-hair)", fontSize: 13 }}>
      <Icon name={CHECK_ICON[c.status]} size={14} color={CHECK_COLOR[c.status]} />
      <span style={{ fontFamily: "var(--font-mono)" }}>{c.check}</span>
      <span style={{ color: "var(--text-subtle)", fontSize: 12 }}>{c.detail}</span>
    </div>
  );
}

type VpsForm = { name: string; host: string; user: string; port: string; keyPath: string };
function NewVpsModal({ open, onClose, onCreate }:
  { open: boolean; onClose: () => void; onCreate: (f: VpsForm) => void }) {
  const blank: VpsForm = { name: "", host: "", user: "", port: "22", keyPath: "" };
  const [f, setF] = React.useState(blank);
  React.useEffect(() => { if (open) setF(blank); }, [open]);
  const set = (k: keyof VpsForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));
  const canSubmit = !!(f.name.trim() && f.host.trim() && f.user.trim());
  return (
    <Modal open={open} onClose={onClose} icon="server" eyebrow="infra" title="Daftarkan VPS"
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose}>Batal</Button>
        <Button size="sm" leftIcon="check" onClick={() => canSubmit && onCreate(f)}>Daftarkan</Button>
      </>}>
      <Field label="Nama"><Input value={f.name} onChange={set("name")} placeholder="mis. web-1" style={{ width: "100%" }} /></Field>
      <Field label="Host" hint="hostname atau IP — tanpa user@">
        <Input value={f.host} onChange={set("host")} mono placeholder="203.0.113.10" style={{ width: "100%" }} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
        <Field label="User SSH" hint="root atau user ber-passwordless-sudo">
          <Input value={f.user} onChange={set("user")} mono placeholder="deploy" style={{ width: "100%" }} /></Field>
        <Field label="Port"><Input value={f.port} onChange={set("port")} mono style={{ width: "100%" }} /></Field>
      </div>
      <Field label="Key path" hint="opsional — kosong berarti key/agent default mesin server">
        <Input value={f.keyPath} onChange={set("keyPath")} mono placeholder="~/.ssh/id_ed25519" style={{ width: "100%" }} /></Field>
    </Modal>
  );
}

export function VpsScreen({ onToast, onGotoTerminal }:
  { onToast: (msg: string, kind?: string, icon?: string) => void; onGotoTerminal: () => void }) {
  const [list, setList] = React.useState<VpsView[]>([]);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [sel, setSel] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null); // "<aksi>:<id>"
  const [modal, setModal] = React.useState(false);

  const load = React.useCallback(() => {
    api.listVps().then((l) => { setList(l); setStatus("ready"); })
      .catch(() => setStatus("error"));
  }, []);
  React.useEffect(() => {
    load();
    const t = setInterval(load, 30_000); // status reachable/hardened tetap segar tanpa klik
    return () => clearInterval(t);
  }, [load]);

  async function run(label: string, id: string, fn: () => Promise<unknown>, okMsg: string) {
    setBusy(`${label}:${id}`);
    try { await fn(); load(); onToast(okMsg, "ok", "server"); }
    catch { onToast(`Gagal ${label}`, "err", "x-circle"); }
    finally { setBusy(null); }
  }
  const audit = (v: VpsView) => run("audit", v.id, () => api.auditVps(v.id), `${v.name} · audit selesai`);
  function harden(v: VpsView) {
    // window.confirm cukup (pola deleteProject di App): sebut persis apa yang berubah.
    if (!window.confirm(
      `Harden "${v.name}"?\n\nYang diterapkan: firewall (allow ${v.port}/80/443), fail2ban, ` +
      `auto security update, PermitRootLogin & PasswordAuthentication off, NTP.\n` +
      `Pastikan akses key SSH non-password kamu sudah bekerja.`)) return;
    void run("harden", v.id, () => api.hardenVps(v.id), `${v.name} · harden selesai`);
  }
  const session = (v: VpsView) =>
    run("sesi", v.id, async () => { await api.vpsSession(v.id); onGotoTerminal(); }, `${v.name} · sesi Claude dibuka`);
  async function remove(v: VpsView) {
    if (!window.confirm(`Hapus registrasi VPS "${v.name}"? Server-nya sendiri tak disentuh.`)) return;
    await api.deleteVps(v.id).then(load).catch(() => onToast("Gagal hapus", "err", "x-circle"));
  }

  async function create(f: VpsForm) {
    try {
      const v = await api.createVps({ name: f.name.trim(), host: f.host.trim(), user: f.user.trim(),
        port: Number(f.port) || 22, keyPath: f.keyPath.trim() || undefined });
      setModal(false); load();
      onToast(`${v.name} terdaftar · jalankan audit`, "ok", "server");
    } catch { onToast("Gagal mendaftarkan VPS — cek format host/user", "err", "x-circle"); }
  }

  if (status === "loading") return <StateBlock kind="loading" title="Memuat daftar VPS…" />;
  if (status === "error") return <StateBlock kind="error" title="Gagal memuat daftar VPS"
    hint="Pastikan server hanoman berjalan." action={load} />;
  if (list.length === 0) return (
    <>
      <StateBlock kind="empty" icon="server" title="Belum ada VPS"
        hint="Daftarkan VPS untuk mulai audit & hardening." action={() => setModal(true)} actionLabel="Daftarkan VPS" />
      <NewVpsModal open={modal} onClose={() => setModal(false)} onCreate={create} />
    </>
  );

  const selected = list.find((v) => v.id === sel);
  return (
    <div style={{ display: "grid", gridTemplateColumns: selected ? "1.4fr 1fr" : "1fr", gap: 16 }}>
      <div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <Button size="sm" leftIcon="plus" onClick={() => setModal(true)}>Daftarkan VPS</Button>
        </div>
        {list.map((v) => {
          const h = HARDENED_PILL[hardenedLabel(v)];
          return (
            <div key={v.id} onClick={() => setSel(v.id === sel ? null : v.id)}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", cursor: "pointer",
                border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", marginBottom: 8,
                background: v.id === sel ? "var(--bone-100)" : "transparent" }}>
              <Icon name="server" size={16} color="var(--brass-700)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{v.name}</div>
                <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-subtle)" }}>
                  {v.user}@{v.host}{v.port !== 22 ? `:${v.port}` : ""}</div>
              </div>
              <StatusPill size="sm" status={isReachable(v) ? "ok" : "broken"}>
                {isReachable(v) ? "reachable" : "unreachable"}</StatusPill>
              <StatusPill size="sm" status={h.status}>{h.label}</StatusPill>
              <Button size="sm" variant="secondary" leftIcon="radar" loading={busy === `audit:${v.id}`}
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); void audit(v); }}>Audit</Button>
              <Button size="sm" leftIcon="shield" loading={busy === `harden:${v.id}`}
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); harden(v); }}>Harden</Button>
              <Button size="sm" variant="ghost" leftIcon="terminal" loading={busy === `sesi:${v.id}`}
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); void session(v); }}>Sesi Claude</Button>
              <Button size="sm" variant="ghost" leftIcon="trash-2"
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); void remove(v); }} />
            </div>
          );
        })}
      </div>
      {selected && (
        <div style={{ border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{selected.name}</div>
          <div style={{ fontSize: 12, color: "var(--text-subtle)", marginBottom: 10 }}>
            {selected.lastAuditAt
              ? `Audit terakhir ${new Date(selected.lastAuditAt).toLocaleString()}`
              : "Belum pernah diaudit"}
            {selected.health && ` · disk ${selected.health.disk} · mem ${selected.health.mem} · load ${selected.health.load}`}
          </div>
          {(selected.audit ?? []).map((c) => <CheckRow key={c.check} c={c} />)}
          {!selected.audit && <StateBlock kind="empty" compact icon="radar" title="Belum ada hasil audit"
            hint="Jalankan Audit untuk melihat status per check." />}
        </div>
      )}
      <NewVpsModal open={modal} onClose={() => setModal(false)} onCreate={create} />
    </div>
  );
}
