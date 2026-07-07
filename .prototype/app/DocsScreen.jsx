/* DocsScreen — the internal/docs Source-of-Truth index for a project.
   Category tree with indexed / unlinked state, coverage, and
   generate-and-link guidance. */
const { Card: DCard, StatusPill: DPill, Badge: DBadge, Button: DBtn, ProgressBar: DBar, Icon: DIcon, Callout: DCallout } =
  window.HanomanDesignSystem_c639ad;

function CatRow({ node, defaultOpen }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div style={{ borderBottom: "1px solid var(--border-hair)" }}>
      <button onClick={() => setOpen((o) => !o)} style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%",
        padding: "10px 4px", border: "none", background: "transparent", cursor: "pointer", textAlign: "left",
      }}>
        <DIcon name={open ? "chevron-down" : "chevron-right"} size={15} color="var(--text-subtle)" />
        <DIcon name="folder" size={16} color={node.linked ? "var(--brass-500)" : "var(--clay-500)"} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-strong)", fontWeight: 500 }}>{node.cat}/</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)" }}>{node.files.length}</span>
        <span style={{ flex: 1 }} />
        {node.linked
          ? <DBadge tone="ok" size="sm" icon="link">indexed</DBadge>
          : <DBadge tone="err" size="sm" icon="unlink">unlinked</DBadge>}
      </button>
      {open && (
        <div style={{ padding: "0 4px 10px 40px", display: "flex", flexDirection: "column", gap: 4 }}>
          {node.files.map((f) => (
            <div key={f} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <DIcon name="file-text" size={13} color="var(--text-subtle)" />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: node.linked ? "var(--text-body)" : "var(--text-muted)" }}>{f}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DocsScreen({ projectName, docTree }) {
  const linked = docTree.filter((d) => d.linked).length;
  const coverage = Math.round((linked / docTree.length) * 100);
  const status = coverage >= 90 ? "ok" : coverage >= 65 ? "drift" : "broken";
  const covTone = status === "broken" ? "err" : status === "drift" ? "warn" : "ok";
  const unlinked = docTree.filter((d) => !d.linked);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.45fr 1fr", gap: 20, alignItems: "start" }}>
      <DCard eyebrow="internal/docs/README.md" title="Source of Truth"
        actions={<DBtn size="sm" variant="ghost" leftIcon="refresh-cw">Re-scan</DBtn>}>
        <div style={{ marginBottom: 6, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Docs yang mengendalikan build. Setiap dokumen di bawah <code>internal/docs/**</code> harus ter-link dari index ini sebelum plan boleh execute.
        </div>
        <div style={{ marginTop: 8 }}>
          {docTree.map((n) => <CatRow key={n.cat} node={n} defaultOpen={!n.linked} />)}
        </div>
      </DCard>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <DCard padding={18}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <span className="hn-eyebrow">SoT coverage · {projectName}</span>
            <DPill status={status} size="sm" />
          </div>
          <DBar value={coverage} showLabel label="Kategori doc ter-index" tone={covTone} />
          <div style={{ marginTop: 12, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>
            {linked}/{docTree.length} kategori ter-link
          </div>
        </DCard>

        {unlinked.length > 0 ? (
          <DCallout tone="warn" title={`${unlinked.length} kategori belum ter-index`}
            action={<DBtn size="sm" leftIcon="wand-sparkles">Generate & link</DBtn>}>
            {unlinked.map((u) => u.cat).join(", ")} belum ter-link dari index. hanoman bisa menyusunnya dari codebase lalu menyambungkannya.
          </DCallout>
        ) : (
          <DCallout tone="ok" title="Source of Truth lengkap" />
        )}

        <DCallout tone="brass" title="Gunung Dronagiri" icon="mountain">
          Ragu herb mana? Bawa seluruh gunung — dokumentasikan semuanya. Docs bertahan lebih lama dari satu commit.
        </DCallout>
      </div>
    </div>
  );
}

Object.assign(window, { DocsScreen });
