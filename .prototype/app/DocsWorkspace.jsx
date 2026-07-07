/* DocsWorkspace.jsx — the interactive Source-of-Truth browser.
   Left: category tree (expand + click a file). Right: the file, either
   RENDERED markdown (preview) or an editor (raw markdown + live preview).
   Edits persist to localStorage so they survive refresh. Markdown is
   rendered with `marked` and styled by the .hn-md rules in the page. */
const { Card: WCard, StatusPill: WPill, Badge: WBadge, Button: WBtn, ProgressBar: WBar,
        Icon: WIcon, Callout: WCallout } = window.HanomanDesignSystem_c639ad;

const HN_EDIT_KEY = "hn-docs-edits-v1";
function hnLoadEdits() {
  try { return JSON.parse(localStorage.getItem(HN_EDIT_KEY) || "{}"); } catch (e) { return {}; }
}
function hnSaveEdits(map) {
  try { localStorage.setItem(HN_EDIT_KEY, JSON.stringify(map)); } catch (e) {}
}
function hnRender(md) {
  try {
    if (window.marked) return window.marked.parse(md || "", { gfm: true, breaks: false });
  } catch (e) {}
  return "<pre>" + String(md || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])) + "</pre>";
}
function hnLang(name) {
  return /\.json$/.test(name) ? "json" : /\.toml$/.test(name) ? "toml"
    : /\.ya?ml$/.test(name) ? "yaml" : /\.(ts|tsx|js)$/.test(name) ? "ts" : "";
}
// Non-markdown files render as a fenced code block so the preview is
// styled (not raw plain text); .md renders as markdown.
function hnDocHtml(text, name) {
  const md = /\.md$/.test(name) ? (text || "") : ("```" + hnLang(name) + "\n" + (text || "") + "\n```");
  return hnRender(md);
}

/* ---------- left tree ---------- */
function DocTreeCat({ node, selected, onSelect }) {
  const anyOpen = node.files.some((f) => (node.cat + "/" + f) === selected);
  const [open, setOpen] = React.useState(!node.linked || anyOpen);
  return (
    <div style={{ borderBottom: "1px solid var(--border-hair)" }}>
      <button onClick={() => setOpen((o) => !o)} style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%",
        padding: "9px 6px", border: "none", background: "transparent", cursor: "pointer", textAlign: "left",
      }}>
        <WIcon name={open ? "chevron-down" : "chevron-right"} size={14} color="var(--text-subtle)" />
        <WIcon name="folder" size={15} color={node.linked ? "var(--brass-500)" : "var(--clay-500)"} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-strong)", fontWeight: 500 }}>{node.cat}/</span>
        <span style={{ flex: 1 }} />
        {node.linked
          ? <WIcon name="link" size={13} color="var(--leaf-600)" />
          : <WIcon name="unlink" size={13} color="var(--clay-500)" />}
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
                <WIcon name="file-text" size={13} color={on ? "var(--brass-700)" : "var(--text-subtle)"} />
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 12,
                  color: on ? "var(--brass-700)" : (node.linked ? "var(--text-body)" : "var(--text-muted)"),
                  fontWeight: on ? 600 : 400,
                }}>{f}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- rendered markdown / code ---------- */
function MarkdownView({ text, name }) {
  return <div className="hn-md" dangerouslySetInnerHTML={{ __html: hnDocHtml(text, name) }} />;
}

/* ---------- the workspace ---------- */
function DocsWorkspace({ projectName, docTree, coverage, docStatus }) {
  const first = docTree.find((n) => n.linked) || docTree[0];
  const [edits, setEdits] = React.useState(hnLoadEdits);
  const [selected, setSelected] = React.useState(first.cat + "/" + first.files[0]);
  const [mode, setMode] = React.useState("preview"); // preview | edit
  const [draft, setDraft] = React.useState("");

  const base = window.HN_DOCS[selected] || "# " + selected + "\n\n*Belum ada isi. Klik Edit untuk menulis.*";
  const current = selected in edits ? edits[selected] : base;
  const edited = selected in edits;

  // find the category node for the selected file (for linked/unlinked state)
  const cat = selected.split("/")[0];
  const node = docTree.find((n) => n.cat === cat);
  // path shown: repo-root files keep their real path; the rest sit under internal/docs
  const relPath = selected.split("/").slice(1).join("/");
  const displayPath = node && node.root ? relPath : "internal/docs/" + selected;

  function startEdit() { setDraft(current); setMode("edit"); }
  function cancelEdit() { setMode("preview"); }
  function save() {
    const next = { ...edits, [selected]: draft };
    setEdits(next); hnSaveEdits(next); setMode("preview");
  }
  function revert() {
    const next = { ...edits }; delete next[selected];
    setEdits(next); hnSaveEdits(next);
  }
  function selectFile(k) { setSelected(k); setMode("preview"); }

  const covTone = docStatus === "broken" ? "err" : docStatus === "drift" ? "warn" : "ok";
  const status = docStatus === "broken" ? "broken" : docStatus === "drift" ? "drift" : "ok";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "288px 1fr", gap: 20, alignItems: "start" }}>
      {/* ---- tree column ---- */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16, position: "sticky", top: 12 }}>
        <WCard padding={0}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: "1px solid var(--border-hair)" }}>
            <span className="hn-eyebrow">internal/docs</span>
            <WPill status={status} size="sm" />
          </div>
          <div style={{ padding: "4px 8px" }}>
            {docTree.map((n) => <DocTreeCat key={n.cat} node={n} selected={selected} onSelect={selectFile} />)}
          </div>
        </WCard>
        <WCard padding={16}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span className="hn-eyebrow">SoT coverage</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>{projectName}</span>
          </div>
          <WBar value={coverage} showLabel label="Kategori ter-index" tone={covTone} />
        </WCard>
      </div>

      {/* ---- viewer / editor column ---- */}
      <WCard padding={0}>
        <div style={{
          display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
          borderBottom: "1px solid var(--border-hair)", flexWrap: "wrap",
        }}>
          <WIcon name="file-text" size={15} color="var(--text-muted)" />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-strong)", fontWeight: 500 }}>
            {displayPath}
          </span>
          {node && (node.linked
            ? <WBadge tone="ok" size="sm" icon="link">indexed</WBadge>
            : <WBadge tone="err" size="sm" icon="unlink">unlinked</WBadge>)}
          {edited && <WBadge tone="brass" size="sm" icon="pencil">diedit</WBadge>}
          <span style={{ flex: 1 }} />
          {mode === "preview" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {edited && <WBtn size="sm" variant="ghost" leftIcon="rotate-ccw" onClick={revert}>Kembalikan</WBtn>}
              <WBtn size="sm" variant="secondary" leftIcon="pencil" onClick={startEdit}>Edit</WBtn>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <WBtn size="sm" variant="ghost" onClick={cancelEdit}>Batal</WBtn>
              <WBtn size="sm" leftIcon="check" onClick={save}>Simpan</WBtn>
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
      </WCard>
    </div>
  );
}

Object.assign(window, { DocsWorkspace });
