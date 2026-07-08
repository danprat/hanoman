/* TriggersScreen — automation. Ported; t.project → t.projectId. */
import { Card, Badge, Switch, Icon, Button, usePaged, Pager } from "../ds";
import type { Trigger } from "./types";

const T_META: Record<string, { icon: string; label: string; blurb: string }> = {
  commit:   { icon: "git-commit-horizontal", label: "On commit", blurb: "Jalan saat code di-push ke branch yang dipantau." },
  schedule: { icon: "calendar-clock", label: "Scheduled", blurb: "Jalan di waktu tetap (cron)." },
  manual:   { icon: "mouse-pointer-click", label: "Manual", blurb: "Dipicu manusia sesuai kebutuhan." },
  interval: { icon: "timer", label: "Interval", blurb: "Berulang tiap N menit/jam." },
};

function TypeLegend() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 22 }}>
      {Object.entries(T_META).map(([k, m]) => (
        <Card key={k} padding={14}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ width: 28, height: 28, borderRadius: "var(--radius-sm)", background: "var(--brass-100)", color: "var(--brass-700)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name={m.icon} size={15} />
            </span>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-strong)" }}>{m.label}</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45 }}>{m.blurb}</div>
        </Card>
      ))}
    </div>
  );
}

function TriggerRow({ t, onToggle }: { t: Trigger; onToggle?: (id: string) => void }) {
  const m = T_META[t.type]!;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderBottom: "1px solid var(--border-hair)" }}>
      <span style={{ width: 32, height: 32, borderRadius: "var(--radius-sm)", background: "var(--bone-200)", color: "var(--text-muted)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
        <Icon name={m.icon} size={16} />
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-strong)", fontWeight: 500 }}>{t.projectId}</span>
          <Badge tone="neutral" size="sm">{m.label}</Badge>
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-muted)", marginTop: 3 }}>{t.detail}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginRight: 6 }}>
        <Icon name="arrow-right" size={13} color="var(--text-subtle)" />
        <Badge tone="brass" size="sm">{t.target}</Badge>
      </div>
      <Switch checked={t.enabled} onChange={onToggle ? () => onToggle(t.id) : undefined} />
    </div>
  );
}

export function TriggersScreen({ triggers, onToggle, onNew, pageSize = 5 }:
  { triggers: Trigger[]; onToggle?: (id: string) => void; onNew?: () => void; pageSize?: number }) {
  const pg = usePaged(triggers, pageSize, "triggers");
  return (
    <div>
      <TypeLegend />
      <Card padding={0}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid var(--border-hair)" }}>
          <span className="hn-eyebrow">Automation · {triggers.length} triggers</span>
          <Button size="sm" leftIcon="plus" onClick={onNew}>New trigger</Button>
        </div>
        <div>
          {pg.pageItems.map((t) => <TriggerRow key={t.id} t={t} onToggle={onToggle} />)}
        </div>
        <Pager {...pg} onPage={pg.setPage} unit="trigger" />
      </Card>
    </div>
  );
}
