// Shared primitives for the Hanoman component kit.
// Editorial documentation layout: mono eyebrows, serif titles,
// hairline-ruled spec blocks, bone demo surfaces.
const KDS = window.HanomanDesignSystem_c639ad;

// A top-level category header (Foundations, Forms, …).
function KSection({ id, eyebrow, title, lede }) {
  return (
    <header id={id} style={{ scrollMarginTop: 80, marginBottom: 28, paddingBottom: 20, borderBottom: "1px solid var(--border-strong)" }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--accent-hover)", marginBottom: 10 }}>{eyebrow}</div>
      <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "var(--text-4xl)", fontWeight: 600, letterSpacing: "var(--tracking-tight)", color: "var(--text-strong)", lineHeight: 1.1 }}>{title}</h2>
      {lede && <p style={{ margin: "12px 0 0", maxWidth: 640, fontFamily: "var(--font-sans)", fontSize: "var(--text-base)", lineHeight: "var(--leading-relaxed)", color: "var(--text-body)" }}>{lede}</p>}
    </header>
  );
}

// One component's spec: serif name, mono import tag, description, then demo panels.
function KSpec({ id, name, tag, desc, children }) {
  return (
    <section id={id} style={{ scrollMarginTop: 80, marginBottom: 44 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
        <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "var(--text-2xl)", fontWeight: 600, letterSpacing: "var(--tracking-tight)", color: "var(--text-strong)" }}>{name}</h3>
        {tag && <code style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-muted)", background: "var(--bone-200)", border: "1px solid var(--border-hair)", borderRadius: "var(--radius-xs)", padding: "2px 7px" }}>{tag}</code>}
      </div>
      {desc && <p style={{ margin: "0 0 16px", maxWidth: 620, fontFamily: "var(--font-sans)", fontSize: "var(--text-md)", lineHeight: "var(--leading-normal)", color: "var(--text-muted)" }}>{desc}</p>}
      <div style={{ border: "1px solid var(--border-hair)", borderRadius: "var(--radius-lg)", overflow: "hidden", boxShadow: "var(--shadow-sm)", background: "var(--surface-card)" }}>
        {children}
      </div>
    </section>
  );
}

// A labeled demo panel inside a spec. `dark` uses the terminal ink surface.
function KDemo({ label, children, cols, align = "center", dark = false, last = false }) {
  return (
    <div style={{ borderBottom: last ? "none" : "1px solid var(--border-hair)" }}>
      {label && (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-subtle)", padding: "12px 20px 0" }}>{label}</div>
      )}
      <div style={{
        display: cols ? "grid" : "flex",
        gridTemplateColumns: cols ? `repeat(${cols}, minmax(0,1fr))` : undefined,
        flexWrap: cols ? undefined : "wrap",
        alignItems: cols ? "stretch" : align,
        gap: 20,
        padding: 20,
        background: dark ? "var(--surface-code)" : "var(--surface-panel)",
      }}>
        {children}
      </div>
    </div>
  );
}

// Small caption under a single example (its variant/prop name).
function KCaption({ children }) {
  return <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-subtle)", marginTop: 8, textAlign: "center" }}>{children}</div>;
}

// A vertical stack: an example centered above its caption.
function KItem({ label, children, w }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", width: w }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1 }}>{children}</div>
      {label && <KCaption>{label}</KCaption>}
    </div>
  );
}

Object.assign(window, { KSection, KSpec, KDemo, KCaption, KItem });
