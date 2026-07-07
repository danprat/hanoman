// Feedback: Badge, StatusPill, Callout, ProgressBar, Tooltip.
const KFbDS = window.HanomanDesignSystem_c639ad;

function FeedbackSection() {
  const { Badge, StatusPill, Callout, ProgressBar, Tooltip, Button } = KFbDS;
  const { KSpec, KDemo, KItem } = window;

  return (
    <div>
      <KSpec id="badge" name="Badge" tag="DS.Badge" desc="Small count/label chip. Six tones × soft / solid / outline variants, two sizes, optional icon.">
        <KDemo label="Tones · soft">
          <KItem label="neutral"><Badge>34 docs</Badge></KItem>
          <KItem label="brass"><Badge tone="brass">MVP</Badge></KItem>
          <KItem label="info"><Badge tone="info">linked</Badge></KItem>
          <KItem label="ok"><Badge tone="ok">indexed</Badge></KItem>
          <KItem label="warn"><Badge tone="warn">drift</Badge></KItem>
          <KItem label="err"><Badge tone="err">stale</Badge></KItem>
        </KDemo>
        <KDemo label="Variants · icon · size" last>
          <KItem label="solid"><Badge tone="brass" variant="solid">3 skills</Badge></KItem>
          <KItem label="outline"><Badge tone="info" variant="outline">2 ADRs</Badge></KItem>
          <KItem label="icon"><Badge tone="ok" icon="check">verified</Badge></KItem>
          <KItem label="sm"><Badge tone="neutral" size="sm">92%</Badge></KItem>
        </KDemo>
      </KSpec>

      <KSpec id="statuspill" name="StatusPill" tag="DS.StatusPill" desc="Fixed vocabulary for repo & doc health and Claude Code run states. Each status carries its own color and dot; running / scanning pulse.">
        <KDemo label="Doc & convention health">
          <KItem label="ok"><StatusPill status="ok" /></KItem>
          <KItem label="drift"><StatusPill status="drift" /></KItem>
          <KItem label="broken"><StatusPill status="broken" /></KItem>
          <KItem label="idle"><StatusPill status="idle" /></KItem>
        </KDemo>
        <KDemo label="Run states · custom label" last>
          <KItem label="running"><StatusPill status="running" /></KItem>
          <KItem label="queued"><StatusPill status="queued" /></KItem>
          <KItem label="done"><StatusPill status="done" /></KItem>
          <KItem label="failed"><StatusPill status="failed" /></KItem>
          <KItem label="scanning"><StatusPill status="scanning" /></KItem>
          <KItem label="custom"><StatusPill status="running" size="sm">2 aktif</StatusPill></KItem>
        </KDemo>
      </KSpec>

      <KSpec id="callout" name="Callout" tag="DS.Callout" desc="Boxed inline message with a left accent rule. Five tones with default icons; supports a title, body, and an action slot.">
        <KDemo label="Tones" cols={1} align="stretch">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Callout tone="info" title="Reverse-engineering docs">Reading the codebase to rebuild the Source of Truth index.</Callout>
            <Callout tone="ok" title="Source of Truth complete">All 34 docs linked · 92% coverage.</Callout>
            <Callout tone="warn" title="Index drifting">Three docs changed since the last plan. Re-scan before executing.</Callout>
            <Callout tone="err" title="Plan blocked" action={<Button size="sm" variant="secondary" leftIcon="refresh-cw">Fix index</Button>}>The docs it depends on are stale. Fix the index, then re-run.</Callout>
            <Callout tone="brass" title="Carry the ring">Trust isn't asked for — it's proven. Every plan executes against the evidence.</Callout>
          </div>
        </KDemo>
      </KSpec>

      <KSpec id="progressbar" name="ProgressBar" tag="DS.ProgressBar" desc="Thin determinate track for coverage and run progress. Five tones, three heights, optional inline label + percentage.">
        <KDemo label="Tones · with label" cols={1} align="stretch">
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <ProgressBar tone="brass" value={92} label="Docs indexed" showLabel />
            <ProgressBar tone="ok" value={100} label="Source of Truth" showLabel />
            <ProgressBar tone="warn" value={64} label="Coverage" showLabel />
            <ProgressBar tone="info" value={38} label="Execute · SPEC-138" showLabel />
          </div>
        </KDemo>
        <KDemo label="Sizes" cols={1} align="stretch" last>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <ProgressBar size="sm" value={70} />
            <ProgressBar size="md" value={70} />
            <ProgressBar size="lg" value={70} />
          </div>
        </KDemo>
      </KSpec>

      <KSpec id="tooltip" name="Tooltip" tag="DS.Tooltip" desc="Dark ink label on hover/focus. Four placements. Hover a trigger below to reveal it.">
        <KDemo label="Placements" last>
          <KItem label="top"><Tooltip content="Re-scan the index" placement="top"><Button variant="secondary" size="sm">Top</Button></Tooltip></KItem>
          <KItem label="bottom"><Tooltip content="internal/docs/README.md" placement="bottom"><Button variant="secondary" size="sm">Bottom</Button></Tooltip></KItem>
          <KItem label="left"><Tooltip content="On convention" placement="left"><Button variant="secondary" size="sm">Left</Button></Tooltip></KItem>
          <KItem label="right"><Tooltip content="Carry the ring" placement="right"><Button variant="secondary" size="sm">Right</Button></Tooltip></KItem>
        </KDemo>
      </KSpec>
    </div>
  );
}

Object.assign(window, { FeedbackSection });
