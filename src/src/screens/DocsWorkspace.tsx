/* DocsWorkspace — interactive Source-of-Truth browser. Ported and wired
   to the API: tree+coverage from GET /docs, file bodies from GET/PUT
   /docs/*path (server-persisted, replacing the prototype's localStorage). */
import React from "react";
import { marked } from "marked";
import { Card, StatusPill, Badge, Button, ProgressBar, Icon } from "../ds";
import { api } from "../api/client";

type DocCat = { cat: string; files: string[]; linked: boolean; root?: boolean };

function hnRender(md: string) {
  try { return marked.parse(md || "", { gfm: true, breaks: false }) as string; }
  catch { return "<pre>" + String(md || "").replace(/[&<>]/g, (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;" } as any)[c])) + "</pre>"; }
}
function hnLang(name: string) {
  return /\.json$/.test(name) ? "json" : /\.toml$/.test(name) ? "toml"
    : /\.ya?ml$/.test(name) ? "yaml" : /\.(ts|tsx|js)$/.test(name) ? "ts" : "";
}
function hnDocHtml(text: string, name: string) {
  const md = /\.md$/.test(name) ? (text || "") : ("```" + hnLang(name) + "\n" + (text || "") + "\n```");
  return hnRender(md);
}

function DocTreeCat({ node, selected, onSelect }: { node: DocCat; selected: string; onSelect: (k: string) => void }) {
  const anyOpen = node.files.some((f) => (node.cat + "/" + f) === selected);
  const [open, setOpen] = React.useState(!node.linked || anyOpen);
  return (
    <div style={{ borderBottom: "1px solid var(--border-hair)" }}>
      <button onClick={() => setOpen((o) => !o)} style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%",
        padding: "9px 6px", border: "none", background: "transparent", cursor: "pointer", textAlign: "left",
      }}>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={14} color="var(--text-subtle)" />
        <Icon name="folder" size={15} color={node.linked ? "var(--brass-500)" : "var(--clay-500)"} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-strong)", fontWeight: 500 }}>{node.cat}/</span>
        <span style={{ flex: 1 }} />
        {node.linked
          ? <Icon name="link" size={13} color="var(--leaf-600)" />
          : <Icon name="unlink" size={13} color="var(--clay-500)" />}
      </button>
      {open && (
        <div style={{ padding: "0 6px 8px 12px", display: "flex", flexDirection: "column", gap: 1 }}>
          {node.files.map((f) => {
            const key = node.cat + "/" + f;
            const on = key === selected;
            return (
              <button key={f} onClick={() => onSelect(key)} style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%",
                padding: "6px 8px", borderRadius: "var(--radius-sm)", border: "none", cursor: "pointer", textAlign: "left",
                background: on ? "var(--brass-100)" : "transparent",
              }}>
                <Icon name="file-text" size={13} color={on ? "var(--brass-700)" : "var(--text-subtle)"} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12,
                  color: on ? "var(--brass-700)" : (node.linked ? "var(--text-body)" : "var(--text-muted)"),
                  fontWeight: on ? 600 : 400 }}>{f}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MarkdownView({ text, name }: { text: string; name: string }) {
  return <div className="hn-md" dangerouslySetInnerHTML={{ __html: hnDocHtml(text, name) }} />;
}

export function DocsWorkspace({ projectId, projectName, docStatus }:
  { projectId: string; projectName: string; docStatus: string }) {
  const [tree, setTree] = React.useState<DocCat[]>([]);
  const [coverage, setCoverage] = React.useState(0);
  const [selected, setSelected] = React.useState("");
  const [cache, setCache] = React.useState<Record<string, string>>({});
  const [mode, setMode] = React.useState<"preview" | "edit">("preview");
  const [draft, setDraft] = React.useState("");

  // load index when the project changes
  React.useEffect(() => {
    let alive = true;
    api.getDocs(projectId).then((ix) => {
      if (!alive) return;
      const t = ix.tree as DocCat[];
      setTree(t); setCoverage(ix.coverage); setCache({}); setMode("preview");
      const first = t.find((n) => n.linked) || t[0];
      setSelected(first ? `${first.cat}/${first.files[0]}` : "");
    }).catch(() => { if (alive) { setTree([]); setSelected(""); } });
    return () => { alive = false; };
  }, [projectId]);

  // load file content when selection changes (once, cached)
  React.useEffect(() => {
    if (!selected || selected in cache) return;
    let alive = true;
    api.getDoc(projectId, selected)
      .then((d) => { if (alive) setCache((c) => ({ ...c, [selected]: d.content })); })
      .catch(() => { if (alive) setCache((c) => ({ ...c, [selected]: "# " + selected + "\n\n*Belum ada isi.*" })); });
    return () => { alive = false; };
  }, [selected, projectId]);

  const current = cache[selected] ?? "";
  const cat = selected.split("/")[0];
  const node = tree.find((n) => n.cat === cat);
  const relPath = selected.split("/").slice(1).join("/");
  const displayPath = node && node.root ? relPath : "internal/docs/" + selected;

  const covTone = docStatus === "broken" ? "err" : docStatus === "drift" ? "warn" : "ok";
  const status = docStatus === "broken" ? "broken" : docStatus === "drift" ? "drift" : "ok";

  function startEdit() { setDraft(current); setMode("edit"); }
  function cancelEdit() { setMode("preview"); }
  async function save() {
    await api.putDoc(projectId, selected, draft);
    setCache((c) => ({ ...c, [selected]: draft }));
    setMode("preview");
  }
  function selectFile(k: string) { setSelected(k); setMode("preview"); }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "288px 1fr", gap: 20, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, position: "sticky", top: 12 }}>
        <Card padding={0}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: "1px solid var(--border-hair)" }}>
            <span className="hn-eyebrow">internal/docs</span>
            <StatusPill status={status} size="sm" />
          </div>
          <div style={{ padding: "4px 8px" }}>
            {tree.map((n) => <DocTreeCat key={n.cat} node={n} selected={selected} onSelect={selectFile} />)}
          </div>
        </Card>
        <Card padding={16}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span className="hn-eyebrow">SoT coverage</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>{projectName}</span>
          </div>
          <ProgressBar value={coverage} showLabel label="Kategori ter-index" tone={covTone} />
        </Card>
      </div>

      <Card padding={0}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--border-hair)", flexWrap: "wrap" }}>
          <Icon name="file-text" size={15} color="var(--text-muted)" />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-strong)", fontWeight: 500 }}>{displayPath}</span>
          {node && (node.linked
            ? <Badge tone="ok" size="sm" icon="link">indexed</Badge>
            : <Badge tone="err" size="sm" icon="unlink">unlinked</Badge>)}
          <span style={{ flex: 1 }} />
          {mode === "preview" ? (
            <Button size="sm" variant="secondary" leftIcon="pencil" onClick={startEdit} disabled={!selected}>Edit</Button>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Button size="sm" variant="ghost" onClick={cancelEdit}>Batal</Button>
              <Button size="sm" leftIcon="check" onClick={save}>Simpan</Button>
            </div>
          )}
        </div>

        {mode === "preview" ? (
          <div style={{ padding: "8px 30px 34px", maxHeight: 620, overflow: "auto" }}>
            <MarkdownView text={current} name={selected} />
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", height: 620 }}>
            <div style={{ display: "flex", flexDirection: "column", borderRight: "1px solid var(--border-hair)", minHeight: 0 }}>
              <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border-hair)", background: "var(--bone-100)" }}>
                <span className="hn-eyebrow">Markdown</span>
              </div>
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} style={{
                flex: 1, width: "100%", boxSizing: "border-box", resize: "none", border: "none", outline: "none",
                padding: "16px 18px", fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.7,
                color: "var(--text-body)", background: "var(--surface-card)",
              }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border-hair)", background: "var(--bone-100)" }}>
                <span className="hn-eyebrow">Preview langsung</span>
              </div>
              <div style={{ flex: 1, overflow: "auto", padding: "4px 24px 24px" }}>
                <MarkdownView text={draft} name={selected} />
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
