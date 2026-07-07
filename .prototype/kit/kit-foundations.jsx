// Foundations: color, type, spacing, radii, elevation, iconography.
const KFDS = window.HanomanDesignSystem_c639ad;

function Swatch({ token, hex, name, textDark }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ height: 56, borderRadius: "var(--radius-md)", background: `var(${token})`, border: "1px solid var(--border-hair)", boxShadow: "var(--shadow-xs)" }} />
      <div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-strong)" }}>{name}</div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-subtle)" }}>{hex}</div>
      </div>
    </div>
  );
}

function ColorRow({ title, items }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-subtle)", marginBottom: 12 }}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px,1fr))", gap: 16 }}>
        {items.map((i) => <Swatch key={i.token} {...i} />)}
      </div>
    </div>
  );
}

function ColorFoundation() {
  return (
    <div style={{ background: "var(--surface-card)", border: "1px solid var(--border-hair)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)", padding: 24, marginBottom: 44 }}>
      <ColorRow title="Bone — paper neutrals" items={[
        { token: "--bone-000", name: "bone-000", hex: "#fffdf8" },
        { token: "--bone-100", name: "bone-100", hex: "#faf6ec" },
        { token: "--bone-200", name: "bone-200", hex: "#f2ebdc" },
        { token: "--bone-300", name: "bone-300", hex: "#e8dfcc" },
        { token: "--bone-400", name: "bone-400", hex: "#dccfb6" },
      ]} />
      <ColorRow title="Ink — warm text" items={[
        { token: "--ink-900", name: "ink-900", hex: "#17130c" },
        { token: "--ink-700", name: "ink-700", hex: "#3a3125" },
        { token: "--ink-500", name: "ink-500", hex: "#6f6250" },
        { token: "--ink-300", name: "ink-300", hex: "#b3a794" },
      ]} />
      <ColorRow title="Brass — wayang gold-leaf accent" items={[
        { token: "--brass-700", name: "brass-700", hex: "#7a5417" },
        { token: "--brass-500", name: "brass-500", hex: "#b8863b" },
        { token: "--brass-300", name: "brass-300", hex: "#e3c988" },
        { token: "--brass-100", name: "brass-100", hex: "#f3e6c4" },
      ]} />
      <ColorRow title="Wind — info & links" items={[
        { token: "--wind-700", name: "wind-700", hex: "#2f5560" },
        { token: "--wind-600", name: "wind-600", hex: "#3f6e7a" },
        { token: "--wind-100", name: "wind-100", hex: "#dbe7ea" },
      ]} />
      <ColorRow title="Earthy semantics" items={[
        { token: "--leaf-600", name: "leaf-600 · ok", hex: "#4d6b30" },
        { token: "--amber-600", name: "amber-600 · warn", hex: "#b3771a" },
        { token: "--clay-600", name: "clay-600 · err", hex: "#a23b2e" },
        { token: "--term-bg", name: "term-bg", hex: "#1c1810" },
      ]} />
      <div style={{ marginBottom: 0 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-subtle)", marginBottom: 0 }} />
      </div>
    </div>
  );
}

function TypeFoundation() {
  const rows = [
    { font: "var(--font-display)", size: "var(--text-4xl)", w: 600, ls: "-0.02em", label: "serif · display 38", text: "Documentation is the record" },
    { font: "var(--font-display)", size: "var(--text-2xl)", w: 600, ls: "-0.02em", label: "serif · title 24", text: "Needs attention" },
    { font: "var(--font-sans)", size: "var(--text-base)", w: 400, ls: "0", label: "sans · reading 16", text: "Plans execute against docs held as the source of truth." },
    { font: "var(--font-sans)", size: "var(--text-md)", w: 400, ls: "0", label: "sans · ui 14", text: "The Stop hook re-checks the index before every run." },
    { font: "var(--font-mono)", size: "var(--text-sm)", w: 400, ls: "0", label: "mono · data 13", text: "internal/docs/README.md · 94% indexed" },
    { font: "var(--font-mono)", size: "var(--text-2xs)", w: 500, ls: "0.14em", label: "mono · eyebrow 11", text: "ON CONVENTION" },
  ];
  return (
    <div style={{ background: "var(--surface-card)", border: "1px solid var(--border-hair)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)", padding: 24, marginBottom: 44 }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 24, padding: "14px 0", borderBottom: i < rows.length - 1 ? "1px solid var(--border-hair)" : "none" }}>
          <div style={{ width: 130, flex: "0 0 auto", fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-subtle)" }}>{r.label}</div>
          <div style={{ font: `${r.w} ${r.size}/1.2 ${r.font}`, letterSpacing: r.ls, textTransform: r.ls === "0.14em" ? "uppercase" : "none", color: "var(--text-strong)" }}>{r.text}</div>
        </div>
      ))}
    </div>
  );
}

function SpacingFoundation() {
  const space = [
    { t: "--space-1", n: "1", px: 4 }, { t: "--space-2", n: "2", px: 8 }, { t: "--space-3", n: "3", px: 12 },
    { t: "--space-4", n: "4", px: 16 }, { t: "--space-6", n: "6", px: 24 }, { t: "--space-7", n: "7", px: 32 }, { t: "--space-9", n: "9", px: 48 },
  ];
  const radii = [
    { t: "--radius-xs", n: "xs", px: 3 }, { t: "--radius-sm", n: "sm", px: 5 }, { t: "--radius-md", n: "md", px: 8 }, { t: "--radius-lg", n: "lg", px: 12 }, { t: "--radius-xl", n: "xl", px: 16 },
  ];
  const elev = [
    { t: "--shadow-xs", n: "xs" }, { t: "--shadow-sm", n: "sm · raised" }, { t: "--shadow-md", n: "md · float" }, { t: "--shadow-lg", n: "lg · overlay" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px,1fr))", gap: 20, marginBottom: 44 }}>
      <div style={{ background: "var(--surface-card)", border: "1px solid var(--border-hair)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)", padding: 20 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-subtle)", marginBottom: 16 }}>Spacing · 4px grid</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {space.map((s) => (
            <div key={s.t} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ height: 14, width: s.px, background: "var(--brass-400)", borderRadius: 2 }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-muted)" }}>space-{s.n} · {s.px}px</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ background: "var(--surface-card)", border: "1px solid var(--border-hair)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)", padding: 20 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-subtle)", marginBottom: 16 }}>Radii</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          {radii.map((r) => (
            <div key={r.t} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <div style={{ width: 44, height: 44, background: "var(--bone-200)", border: "1px solid var(--border-strong)", borderTopLeftRadius: `var(${r.t})`, borderTopRightRadius: `var(${r.t})`, borderBottomLeftRadius: `var(${r.t})`, borderBottomRightRadius: `var(${r.t})` }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-muted)" }}>{r.n} · {r.px}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ background: "var(--surface-card)", border: "1px solid var(--border-hair)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)", padding: 20 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-subtle)", marginBottom: 16 }}>Elevation</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
          {elev.map((e) => (
            <div key={e.t} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <div style={{ width: 52, height: 40, background: "var(--surface-card)", borderRadius: "var(--radius-md)", boxShadow: `var(${e.t})`, border: "1px solid var(--border-hair)" }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-muted)" }}>{e.n}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function IconFoundation() {
  const { Icon } = KFDS;
  const glyphs = ["layout-grid", "list-checks", "activity", "book-open", "zap", "box", "git-commit-horizontal", "calendar-clock", "mouse-pointer-click", "timer", "file-text", "folder", "refresh-cw", "radar", "lightbulb", "bug", "wind", "check-circle-2", "x-circle", "link", "unlink", "search", "plus", "settings", "chevron-down", "sparkles"];
  return (
    <div style={{ background: "var(--surface-card)", border: "1px solid var(--border-hair)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)", padding: 24, marginBottom: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px,1fr))", gap: 8 }}>
        {glyphs.map((g) => (
          <div key={g} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "16px 8px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-hair)", background: "var(--bone-100)" }}>
            <Icon name={g} size={22} color="var(--ink-700)" />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-subtle)", textAlign: "center", lineHeight: 1.3 }}>{g}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { ColorFoundation, TypeFoundation, SpacingFoundation, IconFoundation });
