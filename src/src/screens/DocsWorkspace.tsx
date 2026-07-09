/* DocsWorkspace — interactive Source-of-Truth browser. Ported and wired
   to the API: tree+coverage from GET /docs, file bodies from GET/PUT
   /docs/*path (server-persisted, replacing the prototype's localStorage). */
import React from "react";
import { marked } from "marked";
import { Card, StatusPill, Badge, Button, ProgressBar, Icon, StateBlock } from "../ds";
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

type TreeNode = { path: string; label: string; cat?: DocCat; kids: TreeNode[] };

// A folder that owns no files and has a single child is just a longer path
// (`internal` + `docs`), so fold it into one row.
function collapse(n: TreeNode): TreeNode {
  let m: TreeNode = { ...n, kids: n.kids.map(collapse) };
  while (!m.cat && m.kids.length === 1) {
    const only = m.kids[0]!;
    m = { ...only, label: m.label + "/" + only.label };
  }
  return m;
}

// The API's `tree` is a flat list of full dir paths; nest it so siblings under
// the same parent live in one group.
export function buildTree(cats: DocCat[]): TreeNode[] {
  const root: TreeNode = { path: "", label: "", kids: [] };
  for (const c of cats) {
    if (c.cat === ".") { root.kids.push({ path: ".", label: ".", cat: c, kids: [] }); continue; }
    let cur = root;
    for (const seg of c.cat.split("/")) {
      const path = cur.path ? cur.path + "/" + seg : seg;
      let next = cur.kids.find((k) => k.path === path);
      if (!next) { next = { path, label: seg, kids: [] }; cur.kids.push(next); }
      cur = next;
    }
    cur.cat = c;
  }
  return root.kids.map(collapse);
}

function DocTreeCat({ node, selected, onSelect, depth = 0 }:
  { node: TreeNode; selected: string; onSelect: (k: string) => void; depth?: number }) {
  const [open, setOpen] = React.useState(false);
  const linked = node.cat?.linked ?? true;
  return (
    <div style={depth === 0 ? { borderBottom: "1px solid var(--border-hair)" } : undefined}>
      <button onClick={() => setOpen((o) => !o)} style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%",
        padding: "9px 6px", paddingLeft: 6 + depth * 12,
        border: "none", background: "transparent", cursor: "pointer", textAlign: "left",
      }}>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={14} color="var(--text-subtle)" />
        <Icon name="folder" size={15} color={linked ? "var(--brass-500)" : "var(--clay-500)"} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-strong)", fontWeight: 500 }}>{node.label}/</span>
        <span style={{ flex: 1 }} />
        {node.cat && (node.cat.linked
          ? <Icon name="link" size={13} color="var(--leaf-600)" />
          : <Icon name="unlink" size={13} color="var(--clay-500)" />)}
      </button>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 1, paddingBottom: 4 }}>
          {node.kids.map((k) => <DocTreeCat key={k.path} node={k} selected={selected} onSelect={onSelect} depth={depth + 1} />)}
          {node.cat?.files.map((f) => {
            const key = node.path + "/" + f;
            const on = key === selected;
            return (
              <button key={f} onClick={() => onSelect(key)} style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%",
                padding: "6px 8px", paddingLeft: 18 + depth * 12,
                borderRadius: "var(--radius-sm)", border: "none", cursor: "pointer", textAlign: "left",
                background: on ? "var(--brass-100)" : "transparent",
              }}>
                <Icon name="file-text" size={13} color={on ? "var(--brass-700)" : "var(--text-subtle)"} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12,
                  color: on ? "var(--brass-700)" : (linked ? "var(--text-body)" : "var(--text-muted)"),
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
  // null = fetch-nya gagal (bukan "isi kosong"), supaya error state bisa dibedakan.
  const [cache, setCache] = React.useState<Record<string, string | null>>({});
  const [mode, setMode] = React.useState<"preview" | "edit">("preview");
  const [draft, setDraft] = React.useState("");
  const [scanning, setScanning] = React.useState(false);
  const [ixStatus, setIxStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [ixTry, setIxTry] = React.useState(0);

  // load index when the project changes
  React.useEffect(() => {
    let alive = true;
    setIxStatus("loading");
    api.getDocs(projectId).then((ix) => {
      if (!alive) return;
      const t = ix.tree as DocCat[];
      setTree(t); setCoverage(ix.coverage); setCache({}); setMode("preview"); setIxStatus("ready");
      const first = t.find((n) => n.linked) || t[0];
      setSelected(first ? `${first.cat}/${first.files[0]}` : "");
    }).catch(() => { if (alive) { setTree([]); setSelected(""); setIxStatus("error"); } });
    return () => { alive = false; };
  }, [projectId, ixTry]);

  // load file content when selection changes (once, cached)
  React.useEffect(() => {
    if (!selected || selected in cache) return;
    let alive = true;
    api.getDoc(projectId, selected)
      .then((d) => { if (alive) setCache((c) => ({ ...c, [selected]: d.content })); })
      .catch(() => { if (alive) setCache((c) => ({ ...c, [selected]: null })); });
    return () => { alive = false; };
  }, [selected, projectId, cache]);

  const docLoading = !!selected && !(selected in cache);
  const docFailed = selected ? cache[selected] === null : false;
  const retryDoc = () => setCache((c) => { const n = { ...c }; delete n[selected]; return n; });

  const nested = React.useMemo(() => buildTree(tree), [tree]);
  const current = cache[selected] ?? "";
  // `selected` is the full repo-relative path (cat + "/" + basename); category is
  // everything before the last slash.
  const cat = selected.includes("/") ? selected.slice(0, selected.lastIndexOf("/")) : ".";
  const node = tree.find((n) => n.cat === cat);
  const displayPath = selected;

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

  async function reloadIndex() {
    const ix = await api.getDocs(projectId);
    const t = ix.tree as DocCat[];
    setTree(t); setCoverage(ix.coverage);
    if (!t.some((n) => `${n.cat}/${n.files[0]}` === selected)) {
      const first = t.find((n) => n.linked) || t[0];
      setSelected(first ? `${first.cat}/${first.files[0]}` : "");
    }
  }
  async function rescan() {
    if (scanning) return;
    setScanning(true);
    try { await api.scanProject(projectId); await reloadIndex(); } finally { setScanning(false); }
  }
  async function removeDoc() {
    if (!selected || !window.confirm(`Hapus ${selected}? File aslinya di disk akan dihapus.`)) return;
    await api.deleteDoc(projectId, selected);
    setCache((c) => { const n = { ...c }; delete n[selected]; return n; });
    await reloadIndex();
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "288px 1fr", gap: 20, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, position: "sticky", top: 12 }}>
        <Card padding={0}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--border-hair)" }}>
            <span className="hn-eyebrow">docs · {projectName}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <StatusPill status={status} size="sm" />
              <Button size="sm" variant="ghost" leftIcon={scanning ? "loader" : "radar"} onClick={rescan} disabled={scanning}>
                {scanning ? "…" : "Scan"}
              </Button>
            </div>
          </div>
          <div style={{ padding: "4px 8px" }}>
            {ixStatus === "loading" ? <StateBlock kind="loading" compact title="Memuat index…" />
              : ixStatus === "error" ? <StateBlock kind="error" compact title="Gagal memuat index docs"
                  hint={projectName} action={() => setIxTry((n) => n + 1)} />
              : tree.length === 0 ? <StateBlock kind="empty" compact icon="folder-open" title="Belum ada docs"
                  hint="Scan project untuk menyusun Source of Truth-nya."
                  action={rescan} actionLabel="Scan sekarang" actionIcon="radar" />
              : nested.map((n) => <DocTreeCat key={n.path} node={n} selected={selected} onSelect={selectFile} />)}
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
            <div style={{ display: "flex", gap: 8 }}>
              <Button size="sm" variant="ghost" leftIcon="trash-2" onClick={removeDoc} disabled={!selected}>Hapus</Button>
              <Button size="sm" variant="secondary" leftIcon="pencil" onClick={startEdit}
                disabled={!selected || docLoading || docFailed}>Edit</Button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Button size="sm" variant="ghost" onClick={cancelEdit}>Batal</Button>
              <Button size="sm" leftIcon="check" onClick={save}>Simpan</Button>
            </div>
          )}
        </div>

        {mode === "preview" ? (
          <div style={{ padding: "8px 30px 34px", maxHeight: 620, overflow: "auto" }}>
            {!selected ? <StateBlock kind="empty" icon="file-text" title="Tidak ada dokumen dipilih"
                hint="Pilih file dari pohon docs di kiri." />
              : docLoading ? <StateBlock kind="loading" title="Memuat dokumen…" hint={selected} />
              : docFailed ? <StateBlock kind="error" title="Gagal memuat dokumen" hint={selected} action={retryDoc} />
              : <MarkdownView text={current} name={selected} />}
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
