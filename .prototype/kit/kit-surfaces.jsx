// Surfaces & Navigation: Card, Tabs.
const KSnDS = window.HanomanDesignSystem_c639ad;

function SurfacesSection() {
  const { Card, Tabs, Badge, Button, StatusPill, IconButton } = KSnDS;
  const { KSpec, KDemo } = window;

  return (
    <div>
      <KSpec id="card" name="Card" tag="DS.Card" desc="Paper surface with a 12px radius and hairline border. Header pattern is mono eyebrow → serif title → optional actions; optional tinted footer. Elevation and interactive lift are configurable.">
        <KDemo label="Header · footer · interactive" cols={2} align="stretch">
          <Card eyebrow="project" title="kirana" actions={<StatusPill status="running" size="sm" />}
            footer={<span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>34 docs · 3 skills · 2 ADRs</span>}>
            <p style={{ margin: 0, fontFamily: "var(--font-sans)", fontSize: "var(--text-md)", lineHeight: 1.5, color: "var(--text-body)" }}>
              Execute · SPEC-138 in progress. The index is on convention at 94% linked.
            </p>
          </Card>
          <Card interactive eyebrow="spec" title="Backlog item" actions={<IconButton icon="more-horizontal" label="More" size="sm" />}>
            <p style={{ margin: 0, fontFamily: "var(--font-sans)", fontSize: "var(--text-md)", lineHeight: 1.5, color: "var(--text-body)" }}>
              Interactive card — hover to see it lift one pixel and deepen its shadow.
            </p>
          </Card>
        </KDemo>
        <KDemo label="Elevation" cols={3} align="stretch" last>
          <Card elevation="flat" title="flat"><span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>no shadow</span></Card>
          <Card elevation="raised" title="raised"><span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>shadow-sm</span></Card>
          <Card elevation="float" title="float"><span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>shadow-md</span></Card>
        </KDemo>
      </KSpec>

      <KSpec id="tabs" name="Tabs" tag="DS.Tabs" desc="Section switcher in underline or pill variant. Tabs accept an icon and a count badge.">
        <KDemo label="Underline" cols={1} align="stretch">
          <div>
            <Tabs variant="underline" defaultValue="backlog" tabs={[
              { value: "runs", label: "Runs", icon: "activity" },
              { value: "backlog", label: "Backlog", icon: "list-checks", count: 12 },
              { value: "docs", label: "Docs", icon: "book-open" },
              { value: "triggers", label: "Triggers", icon: "zap" },
            ]} />
          </div>
        </KDemo>
        <KDemo label="Pill" cols={1} align="stretch" last>
          <div>
            <Tabs variant="pill" defaultValue="grid" tabs={[
              { value: "grid", label: "Grid" },
              { value: "list", label: "List" },
              { value: "compact", label: "Compact" },
            ]} />
          </div>
        </KDemo>
      </KSpec>
    </div>
  );
}

Object.assign(window, { SurfacesSection });
