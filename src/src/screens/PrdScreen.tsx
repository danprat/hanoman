/* PrdScreen — dokumen PRD per project (SPEC-210). Daftar docs/prd/*.md (freshest-wins),
   preview MarkdownView, buat PRD baru (sesi prd interaktif), take PRD → backlog (prefill
   NewSpecModal di App). PRD adalah dokumen, bukan entitas DB (ADR-0011/0041). */
import React from "react";
import {
  Card, Badge, Button, Select, Modal, Field, Input, HnTextarea, StateBlock, MarkdownView, Icon,
  LIST_SCREEN_STYLE, LIST_SCROLL_STYLE, FIXED_ROW_STYLE,
} from "../ds";
import { api, type PrdDoc } from "../api/client";
import type { ProjectVM } from "./types";

export type PrdBriefForm = { title: string; context: string; outcome: string; constraints?: string };
export type PrdPrefill = { project: string; title: string; context: string; outcome: string; prdPath: string };

function NewPrdModal({ onClose, onCreate }:
  { onClose: () => void; onCreate: (brief: PrdBriefForm) => void }) {
  const [f, setF] = React.useState({ title: "", context: "", outcome: "", constraints: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<any>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const submit = () => {
    if (!f.title.trim()) return;
    onCreate({ title: f.title.trim(), context: f.context, outcome: f.outcome, constraints: f.constraints || undefined });
  };
  return (
    <Modal open onClose={onClose} icon="scroll-text" eyebrow="PM → hanoman" title="PRD baru"
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose}>Batal</Button>
        <Button size="sm" leftIcon="messages-square" onClick={submit}>Buat brief → brainstorm PRD</Button>
      </>}>
      <div style={{ fontSize: 12, color: "var(--text-subtle)", marginBottom: 12, lineHeight: 1.5 }}>
        hanoman membuka sesi brainstorm interaktif di terminal, lalu menulis dokumen PRD ke <code>docs/prd/</code>.
      </div>
      <Field label="Judul">
        <Input value={f.title} onChange={set("title")} placeholder="mis. Jadwal Invoice Berulang" style={{ width: "100%" }} />
      </Field>
      <Field label="Konteks" hint="Latar belakang & alasan fitur ini dibutuhkan">
        <HnTextarea value={f.context} onChange={set("context")} rows={3} placeholder="Situasi & motivasi…" />
      </Field>
      <Field label="Hasil yang diharapkan">
        <HnTextarea value={f.outcome} onChange={set("outcome")} rows={2} placeholder="Kondisi setelah selesai…" />
      </Field>
      <Field label="Batasan" hint="opsional">
        <Input value={f.constraints} onChange={set("constraints")} placeholder="mis. reuse queue yang ada" style={{ width: "100%" }} />
      </Field>
    </Modal>
  );
}

function PrdPreview({ project, prd, onClose, onTake }:
  { project: string; prd: PrdDoc; onClose: () => void; onTake: (p: PrdPrefill) => void }) {
  const [content, setContent] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    api.getPrd(project, prd.path)
      .then((r) => { if (alive) setContent(r.content); })
      .catch(() => { if (alive) setContent(""); });
    return () => { alive = false; };
  }, [project, prd.path]);
  return (
    <Modal open onClose={onClose} icon="scroll-text" eyebrow={prd.path} title={prd.title}
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose}>Tutup</Button>
        <Button size="sm" leftIcon="list-checks"
          onClick={() => onTake({ project, title: prd.title, context: `Dari PRD: ${prd.path}`, outcome: "", prdPath: prd.path })}>
          Take ke backlog
        </Button>
      </>}>
      {content === null ? <StateBlock kind="loading" title="Memuat PRD…" />
        : <MarkdownView text={content} name={prd.name} />}
    </Modal>
  );
}

export function PrdScreen({ projects, projectFilter, onProjectFilter, onNewPrd, onTakeToBacklog, dataVersion }:
  {
    projects: ProjectVM[]; projectFilter: string; onProjectFilter: (id: string) => void;
    onNewPrd: (project: string, brief: PrdBriefForm) => void;
    onTakeToBacklog: (p: PrdPrefill) => void; dataVersion?: number;
  }) {
  const [items, setItems] = React.useState<PrdDoc[]>([]);
  const [sel, setSel] = React.useState<PrdDoc | null>(null);
  const [creating, setCreating] = React.useState(false);
  // Filter "all" → project pertama: PRD selalu berkonteks satu project (docs/prd/ hidup di repo-nya).
  const proj = projectFilter === "all" ? (projects[0]?.id ?? "") : projectFilter;
  React.useEffect(() => {
    if (!proj) { setItems([]); return; }
    let alive = true;
    api.listPrds(proj).then((r) => { if (alive) setItems(r.items); }).catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [proj, dataVersion]);
  return (
    <div style={LIST_SCREEN_STYLE}>
      <div style={{ ...FIXED_ROW_STYLE, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
        <Select size="sm" value={proj} aria-label="Project"
          onChange={(e) => onProjectFilter(e.target.value)}
          options={projects.map((p) => ({ value: p.id, label: p.name }))} />
        <Button size="sm" leftIcon="plus" disabled={!proj} onClick={() => setCreating(true)}>PRD baru</Button>
      </div>
      {items.length === 0 ? (
        <StateBlock kind="empty" icon="scroll-text" title="Belum ada PRD"
          hint="Buat PRD dari brief + brainstorm; hanoman menulisnya ke docs/prd/ lalu bisa di-take jadi backlog."
          action={proj ? () => setCreating(true) : undefined} actionLabel="PRD baru" />
      ) : (
        <div style={{ ...LIST_SCROLL_STYLE, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
          {items.map((p) => (
            <Card key={p.path} padding={16}>
              <button onClick={() => setSel(p)} style={{
                border: "none", background: "transparent", padding: 0, textAlign: "left", cursor: "pointer", width: "100%",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                  <Icon name="scroll-text" size={15} color="var(--brass-500)" />
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 600, color: "var(--text-strong)" }}>{p.title}</span>
                  {p.live && <Badge tone="brass" size="sm">draft hidup</Badge>}
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)" }}>{p.path}</div>
              </button>
            </Card>
          ))}
        </div>
      )}
      {sel && <PrdPreview project={proj} prd={sel} onClose={() => setSel(null)}
        onTake={(pf) => { setSel(null); onTakeToBacklog(pf); }} />}
      {creating && <NewPrdModal onClose={() => setCreating(false)}
        onCreate={(brief) => { setCreating(false); onNewPrd(proj, brief); }} />}
    </div>
  );
}
