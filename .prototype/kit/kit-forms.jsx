// Forms: Button, IconButton, Input, Select, Checkbox, Switch.
const KFormsDS = window.HanomanDesignSystem_c639ad;

function FormsSection() {
  const { Button, IconButton, Input, Select, Checkbox, Switch } = KFormsDS;
  const { KSpec, KDemo, KItem } = window;

  return (
    <div>
      <KSpec id="button" name="Button" tag="DS.Button" desc="Four variants; brass primary is the single accented action per view. Three sizes, plus icon, loading, and disabled states.">
        <KDemo label="Variants">
          <KItem label="primary"><Button>Run spec</Button></KItem>
          <KItem label="secondary"><Button variant="secondary">Re-scan</Button></KItem>
          <KItem label="ghost"><Button variant="ghost">Dismiss</Button></KItem>
          <KItem label="danger"><Button variant="danger">Delete run</Button></KItem>
        </KDemo>
        <KDemo label="Sizes">
          <KItem label="sm"><Button size="sm">Small</Button></KItem>
          <KItem label="md"><Button size="md">Medium</Button></KItem>
          <KItem label="lg"><Button size="lg">Large</Button></KItem>
        </KDemo>
        <KDemo label="With icons · states" last>
          <KItem label="leftIcon"><Button leftIcon="play">Execute</Button></KItem>
          <KItem label="rightIcon"><Button variant="secondary" rightIcon="arrow-right">Next</Button></KItem>
          <KItem label="loading"><Button loading>Planning</Button></KItem>
          <KItem label="disabled"><Button disabled>Blocked</Button></KItem>
        </KDemo>
      </KSpec>

      <KSpec id="iconbutton" name="IconButton" tag="DS.IconButton" desc="Square icon-only control for toolbars and row actions. Ghost, outline, and solid variants across three sizes.">
        <KDemo label="Variants">
          <KItem label="ghost"><IconButton icon="refresh-cw" label="Refresh" /></KItem>
          <KItem label="outline"><IconButton icon="settings" label="Settings" variant="outline" /></KItem>
          <KItem label="solid"><IconButton icon="plus" label="Add" variant="solid" /></KItem>
          <KItem label="disabled"><IconButton icon="trash-2" label="Delete" variant="outline" disabled /></KItem>
        </KDemo>
        <KDemo label="Sizes" last>
          <KItem label="sm"><IconButton icon="more-horizontal" label="More" variant="outline" size="sm" /></KItem>
          <KItem label="md"><IconButton icon="more-horizontal" label="More" variant="outline" size="md" /></KItem>
          <KItem label="lg"><IconButton icon="more-horizontal" label="More" variant="outline" size="lg" /></KItem>
        </KDemo>
      </KSpec>

      <KSpec id="input" name="Input" tag="DS.Input" desc="Text field with an inset well and brass focus ring. Optional icons, monospace mode for paths, plus invalid and disabled states.">
        <KDemo label="Sizes" align="stretch" cols={3}>
          <div><Input size="sm" placeholder="Small" /></div>
          <div><Input size="md" placeholder="Medium" /></div>
          <div><Input size="lg" placeholder="Large" /></div>
        </KDemo>
        <KDemo label="With icons · mono" align="stretch" cols={3}>
          <div><Input leftIcon="search" placeholder="Search specs" /></div>
          <div><Input rightIcon="link" placeholder="Doc URL" /></div>
          <div><Input mono leftIcon="folder" defaultValue="internal/docs/README.md" /></div>
        </KDemo>
        <KDemo label="States" align="stretch" cols={3} last>
          <div><Input invalid defaultValue="stale-index" /></div>
          <div><Input disabled placeholder="Disabled" /></div>
          <div><Input defaultValue="On convention" /></div>
        </KDemo>
      </KSpec>

      <KSpec id="select" name="Select" tag="DS.Select" desc="Native select styled to match the input well, with a chevron affordance. Options accept strings or {value,label}.">
        <KDemo label="Sizes · states" align="stretch" cols={3}>
          <div><Select size="sm" options={["schedule", "commit", "manual", "interval"]} /></div>
          <div><Select size="md" defaultValue="kirana" options={[{ value: "kirana", label: "kirana" }, { value: "arta", label: "arta" }]} /></div>
          <div><Select size="lg" disabled options={["disabled"]} /></div>
        </KDemo>
        <KDemo label="Placeholder · invalid" align="stretch" cols={2} last>
          <div><Select placeholder="Choose a project" defaultValue="" options={["kirana", "arta", "candra"]} /></div>
          <div><Select invalid defaultValue="commit" options={["schedule", "commit"]} /></div>
        </KDemo>
      </KSpec>

      <KSpec id="checkbox" name="Checkbox" tag="DS.Checkbox" desc="Custom-drawn box with a brass fill when checked. Supports a label and a secondary description line.">
        <KDemo label="States · with description" cols={2} align="stretch" last>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Checkbox defaultChecked label="Docs are the source of truth" />
            <Checkbox label="Block on stale index" />
            <Checkbox disabled label="Disabled option" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Checkbox defaultChecked label="Re-run on commit" description="Fire plan + execute when main advances." />
            <Checkbox label="Notify on failure" description="Post a summary to the run channel." />
          </div>
        </KDemo>
      </KSpec>

      <KSpec id="switch" name="Switch" tag="DS.Switch" desc="Instant on/off toggle for settings. Two sizes; optional trailing label.">
        <KDemo label="Sizes · states" last>
          <KItem label="off"><Switch /></KItem>
          <KItem label="on"><Switch defaultChecked /></KItem>
          <KItem label="sm"><Switch size="sm" defaultChecked /></KItem>
          <KItem label="disabled"><Switch disabled /></KItem>
          <KItem label="labelled"><Switch defaultChecked label="Guardrail on" /></KItem>
        </KDemo>
      </KSpec>
    </div>
  );
}

Object.assign(window, { FormsSection });
