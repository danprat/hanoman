/* CustomAgentsPanel — katalog custom agent (SPEC-450 · ADR-0094). SATU komponen untuk DUA
   permukaan: Settings (`projectId={null}` → agen global) dan Project detail (`projectId="<id>"`
   → himpunan EFEKTIF, agen global tampil read-only bertanda "warisan global" supaya tak ada
   pertanyaan "lalu yang global mana").

   Yang penting ditampilkan apa adanya: kolom Tools merender HASIL RESOLUSI (`resolveTools`),
   bukan ketikan operator — jadi pencabutan `Task` untuk agen daun TERLIHAT, bukan tersembunyi.
   Itu lapis 2 anti-loop, dan lapis yang tak terlihat adalah lapis yang dikira tak ada. */
import React from "react";
import { Card, Button, Badge, Input, Switch, Checkbox, Field, HnTextarea, StateBlock, Callout } from "../ds";
import { api, ApiError } from "../api/client";
import { AGENT_NAME_RE, DEFAULT_AGENT_TOOLS, resolveTools, type CustomAgentView } from "@hanoman/shared";

type Draft = {
  name: string; description: string; instructions: string;
  tools: string; model: string; mentions: string[]; enabled: boolean;
};

const emptyDraft = (): Draft => ({
  name: "", description: "", instructions: "", tools: "", model: "", mentions: [], enabled: true,
});

const draftOf = (a: CustomAgentView): Draft => ({
  name: a.name, description: a.description, instructions: a.instructions,
  tools: (a.tools ?? []).join(", "), model: a.model ?? "",
  mentions: a.mentions, enabled: a.enabled,
});

/** "Read, Bash" → ["Read","Bash"]; kosong → null (= pakai DEFAULT_AGENT_TOOLS). */
const parseTools = (s: string): string[] | null => {
  const list = s.split(",").map((t) => t.trim()).filter(Boolean);
  return list.length ? list : null;
};

/**
 * Terjemahkan penolakan server jadi kalimat yang bisa ditindaklanjuti. 409 bersiklus membawa
 * jalurnya (`cycle`) dan scope mana yang pecah — tanpa itu operator cuma melihat "409".
 */
function errorText(e: unknown): string {
  if (!(e instanceof ApiError)) return (e as Error)?.message ?? "gagal";
  const d = (e.detail ?? {}) as { error?: unknown; cycle?: string[]; scope?: string; unknown?: string[] };
  if (Array.isArray(d.cycle) && d.cycle.length) {
    return `Mention membentuk siklus di scope ${d.scope ?? "?"}: ${d.cycle.join(" → ")}`;
  }
  if (Array.isArray(d.unknown) && d.unknown.length) {
    return `Mention tak dikenal: ${d.unknown.join(", ")}`;
  }
  if (typeof d.error === "string") return d.error;
  return `Gagal (${e.status})`;
}

export type CustomAgentsPanelProps = {
  projectId: string | null;
  onToast?: (msg: string, kind?: string, icon?: string) => void;
};

export function CustomAgentsPanel({ projectId, onToast }: CustomAgentsPanelProps) {
  const [rows, setRows] = React.useState<CustomAgentView[] | null>(null);
  const [err, setErr] = React.useState<string>("");
  const [editing, setEditing] = React.useState<{ id: string | null; draft: Draft } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try { setRows(await api.listCustomAgents(projectId ?? undefined)); }
    catch (e) { setErr(errorText(e)); setRows([]); }
  }, [projectId]);

  React.useEffect(() => { void load(); }, [load]);

  // Agen yang boleh disebut dari draft ini: semua yang terlihat, kecuali dirinya sendiri.
  const mentionable = (rows ?? []).filter((a) => a.name !== editing?.draft.name);
  const nameValid = !editing?.draft.name || AGENT_NAME_RE.test(editing.draft.name);

  async function save() {
    if (!editing) return;
    const d = editing.draft;
    setBusy(true); setErr("");
    try {
      const payload = {
        description: d.description, instructions: d.instructions,
        tools: parseTools(d.tools), model: d.model || null,
        mentions: d.mentions, enabled: d.enabled,
      };
      if (editing.id) await api.updateCustomAgent(editing.id, payload);
      else await api.createCustomAgent({ ...payload, name: d.name, projectId });
      setEditing(null);
      await load();
      onToast?.(editing.id ? "Agen diperbarui" : "Agen dibuat", "ok");
    } catch (e) { setErr(errorText(e)); }
    finally { setBusy(false); }
  }

  async function toggleEnabled(a: CustomAgentView, on: boolean) {
    setErr("");
    try { await api.updateCustomAgent(a.id, { enabled: on }); await load(); }
    catch (e) { setErr(errorText(e)); }
  }

  async function remove(a: CustomAgentView) {
    setErr("");
    try { await api.deleteCustomAgent(a.id); await load(); onToast?.("Agen dihapus", "ok"); }
    catch (e) { setErr(errorText(e)); }
  }

  if (rows === null) return <StateBlock kind="loading" title="Memuat custom agent…" />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
          {projectId
            ? "Agen project ini, ditambah agen global yang berlaku di sini. Agen project menimpa agen global bernama sama."
            : "Agen global — tersedia di semua project. Satu project bisa menimpanya dengan agen bernama sama."}
        </div>
        <Button size="sm" onClick={() => { setErr(""); setEditing({ id: null, draft: emptyDraft() }); }}>
          Agen baru
        </Button>
      </div>

      {err && <Callout tone="err">{err}</Callout>}

      {rows.length === 0 && !editing && (
        <StateBlock kind="empty" compact title="Belum ada custom agent"
          hint="Custom agent adalah persona yang bisa dipilih sesi claude & codex — misalnya peninjau keamanan atau penulis migration." />
      )}

      {rows.map((a) => {
        const tools = resolveTools({ tools: a.tools, mentions: a.mentions });
        const readOnly = Boolean(projectId && a.inherited);
        return (
          <Card key={a.id} padding={14}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text-strong)" }}>{a.name}</span>
              {readOnly && <Badge tone="neutral" size="sm">warisan global</Badge>}
              {!a.enabled && <Badge tone="warn" size="sm">nonaktif</Badge>}
              <span style={{ flex: 1 }} />
              <Switch checked={a.enabled} disabled={readOnly} aria-label={`Aktifkan ${a.name}`}
                onChange={(on) => void toggleEnabled(a, on)} />
              <Button size="sm" variant="ghost" disabled={readOnly}
                onClick={() => { setErr(""); setEditing({ id: a.id, draft: draftOf(a) }); }}>Ubah</Button>
              <Button size="sm" variant="ghost" disabled={readOnly}
                onClick={() => void remove(a)}>Hapus</Button>
            </div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginBottom: 6 }}>{a.description}</div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
              {/* HASIL RESOLUSI, bukan ketikan operator: `Task` muncul hanya untuk agen ber-mention,
                  dan dicabut untuk agen daun walau operator mengetiknya (lapis 2 anti-loop). */}
              <span data-testid={`tools-${a.name}`}>Tools: {tools.join(", ")}</span>
              <span data-testid={`mentions-${a.name}`}>
                Mention: {a.mentions.length ? a.mentions.map((m) => `@${m}`).join(", ") : "—"}
              </span>
              {a.model && <span>Model: {a.model}</span>}
            </div>
          </Card>
        );
      })}

      {editing && (
        <Card padding={16}>
          <Field label="Nama" hint={editing.id
            ? "Nama tak bisa diubah — hapus lalu buat baru (definisi ini menyeberang lewat sync)."
            : "huruf kecil, angka, dan tanda hubung; minimal 2 karakter"}>
            <Input value={editing.draft.name} aria-label="Nama" disabled={Boolean(editing.id)}
              invalid={!nameValid}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setEditing({ ...editing, draft: { ...editing.draft, name: e.target.value } })} />
          </Field>
          <Field label="Deskripsi" hint="Kapan agen ini dipakai — inilah yang dibaca agen untuk MEMILIH.">
            <Input value={editing.draft.description} aria-label="Deskripsi"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setEditing({ ...editing, draft: { ...editing.draft, description: e.target.value } })} />
          </Field>
          <Field label="Instruksi" hint="System prompt agen.">
            <HnTextarea value={editing.draft.instructions} aria-label="Instruksi" rows={6}
              onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, instructions: e.target.value } })} />
          </Field>
          <Field label="Tools" hint={`Kosongkan untuk memakai default: ${DEFAULT_AGENT_TOOLS.join(", ")}. Alat delegasi (Task) diatur otomatis dari Mention.`}>
            <Input value={editing.draft.tools} aria-label="Tools" mono
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setEditing({ ...editing, draft: { ...editing.draft, tools: e.target.value } })} />
          </Field>
          <Field label="Model" hint="Kosongkan untuk mewarisi model sesi.">
            <Input value={editing.draft.model} aria-label="Model" mono
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setEditing({ ...editing, draft: { ...editing.draft, model: e.target.value } })} />
          </Field>
          <Field label="Mention" hint="Agen yang boleh dipanggil agen ini. Graf mention wajib asiklik — server menolak yang membentuk lingkaran.">
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {mentionable.length === 0 && <span style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>Belum ada agen lain.</span>}
              {mentionable.map((m) => (
                <Checkbox key={m.id} label={m.name} aria-label={`Mention ${m.name}`}
                  checked={editing.draft.mentions.includes(m.name)}
                  onChange={(on) => setEditing({ ...editing, draft: { ...editing.draft,
                    mentions: on
                      ? [...editing.draft.mentions, m.name]
                      : editing.draft.mentions.filter((x) => x !== m.name) } })} />
              ))}
            </div>
          </Field>
          <div style={{ display: "flex", gap: 8 }}>
            <Button onClick={() => void save()} loading={busy} disabled={!nameValid}>Simpan</Button>
            <Button variant="ghost" onClick={() => { setEditing(null); setErr(""); }}>Batal</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
