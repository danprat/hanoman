/* Shell — sidebar + topbar chrome. Fills its frame (height:100%).
   Nav/section names stay in the product's technical vocabulary;
   surrounding copy is Indonesian. */
const { Icon: HnIcon, Input: HnInput } = window.HanomanDesignSystem_c639ad;
const { Mark: HnMark } = window;

const HN_NAV = [
  { key: "overview", label: "Overview", icon: "layout-dashboard" },
  { key: "projects", label: "Projects", icon: "layout-grid" },
  { key: "backlog", label: "Backlog", icon: "list-checks" },
  { key: "runs", label: "Runs", icon: "activity" },
  { key: "docs", label: "Docs · SoT", icon: "book-open" },
  { key: "triggers", label: "Triggers", icon: "zap" },
  { key: "settings", label: "Settings", icon: "settings" },
];

function HnWordmark() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 26, height: 26, borderRadius: "var(--radius-sm)",
          background: "var(--accent)", color: "var(--ink-900)",
        }}>
          <HnMark id="buntut" size={17} color="#fff" />
        </span>
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 500,
          letterSpacing: "-0.01em", color: "var(--text-strong)",
        }}>
          hanoman
        </span>
      </div>
    </div>
  );
}

function HnSidebarItem({ item, active, onNavigate }) {
  const on = active === item.key;
  const [hover, setHover] = React.useState(false);
  const interactive = !!onNavigate;
  return (
    <div
      onClick={interactive ? () => onNavigate(item.key) : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%",
        padding: "8px 10px", cursor: interactive ? "pointer" : "default",
        borderRadius: "var(--radius-sm)", textAlign: "left",
        background: on ? "var(--brass-100)" : (hover && interactive ? "var(--bone-200)" : "transparent"),
        color: on ? "var(--brass-700)" : "var(--text-body)",
        fontFamily: "var(--font-ui)", fontSize: "var(--text-md)",
        fontWeight: on ? "var(--weight-semibold)" : "var(--weight-medium)",
        transition: "background var(--dur-fast, 120ms) ease",
      }}
    >
      <HnIcon name={item.icon} size={17} color={on ? "var(--accent-hover)" : "var(--text-muted)"} />
      {item.label}
    </div>
  );
}

function Shell({ active, title, breadcrumb, actions, showSearch = false, searchValue = "", onSearchChange, onNavigate, wide = false, children }) {
  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0, background: "var(--surface-page)", color: "var(--text-body)" }}>
      {/* Sidebar */}
      <aside style={{
        width: "var(--sidebar-w)", flex: "0 0 auto", display: "flex", flexDirection: "column",
        borderRight: "1px solid var(--border-hair)", background: "var(--bone-100)",
        padding: "18px 14px",
      }}>
        <div style={{ padding: "2px 4px 20px" }}><HnWordmark /></div>

        <div className="hn-eyebrow" style={{ padding: "0 10px 8px" }}>Workspace</div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {HN_NAV.map((n) => <HnSidebarItem key={n.key} item={n} active={active} onNavigate={onNavigate} />)}
        </nav>
      </aside>

      {/* Main column */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* Topbar */}
        <header style={{
          height: "var(--topbar-h)", flex: "0 0 auto", display: "flex", alignItems: "center",
          gap: 16, padding: "0 22px", borderBottom: "1px solid var(--border-hair)",
          background: "color-mix(in srgb, var(--bone-100) 80%, transparent)",
          backdropFilter: "blur(8px)",
        }}>
          <div style={{ minWidth: 0 }}>
            {breadcrumb && (
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)", marginBottom: 1 }}>
                {breadcrumb}
              </div>
            )}
            <div style={{
              fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 600,
              letterSpacing: "-0.02em", color: "var(--text-strong)", lineHeight: 1.1,
            }}>
              {title}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          {showSearch && (
            <HnInput placeholder="Cari project…" leftIcon="search" size="sm" style={{ width: 220 }}
              value={searchValue}
              onChange={onSearchChange ? (e) => onSearchChange(e.target.value) : undefined}
              readOnly={!onSearchChange} />
          )}
          {actions}
        </header>

        {/* Content */}
        <main style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <div style={{ maxWidth: wide ? "none" : "var(--content-max)", margin: "0 auto", padding: "24px 28px 32px" }}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

Object.assign(window, { Shell });
